"""گزارش‌های روزانه، هفتگی، ماهانه و خروجی اکسل."""
from __future__ import annotations

import urllib.parse
from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import AnyUser, DbSession
from app.core.jalali import (
    jalali_long,
    jalali_month_range,
    jalali_str,
    parse_jalali,
    to_jalali as gregorian_to_jalali,
    today_tehran,
    week_range,
)
from app.models.attendance import AttendanceRecord
from app.models.employee import Employee, FaceEmbedding
from app.models.enums import DayStatus, LeaveStatus, TaskStatus
from app.models.leave import LeaveRequest
from app.models.organization import Department
from app.models.task import Task
from app.services import export_service
from app.services.report_service import (
    PeriodSummary,
    compute_days,
    load_employees,
    summarize_period,
)

router = APIRouter()

Period = Literal["daily", "weekly", "monthly", "custom"]

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# --------------------------------------------------------------------- بازه زمانی


def resolve_range(
    period: Period,
    jalali_date: str | None,
    jalali_year: int | None,
    jalali_month: int | None,
    from_jalali: str | None,
    to_jalali: str | None,
) -> tuple[date, date, str]:
    """بازه گزارش و عنوان فارسی آن را برمی‌گرداند."""
    if period == "daily":
        day = parse_jalali(jalali_date) if jalali_date else today_tehran()
        return day, day, f"گزارش روزانه — {jalali_long(day)}"

    if period == "weekly":
        anchor = parse_jalali(jalali_date) if jalali_date else today_tehran()
        start, end = week_range(anchor)
        return start, end, f"گزارش هفتگی — {jalali_str(start)} تا {jalali_str(end)}"

    if period == "monthly":
        j_today = gregorian_to_jalali(today_tehran())
        year = jalali_year or j_today.year
        month = jalali_month or j_today.month
        if not 1 <= month <= 12:
            raise HTTPException(status_code=400, detail="ماه شمسی باید بین ۱ تا ۱۲ باشد")
        start, end = jalali_month_range(year, month)
        from app.core.jalali import MONTH_NAMES_FA

        return start, end, f"گزارش ماهانه — {MONTH_NAMES_FA[month - 1]} {year}"

    if not from_jalali or not to_jalali:
        raise HTTPException(status_code=400, detail="برای بازه دلخواه، تاریخ شروع و پایان لازم است")
    start, end = parse_jalali(from_jalali), parse_jalali(to_jalali)
    if end < start:
        raise HTTPException(status_code=400, detail="تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد")
    if (end - start).days > 400:
        raise HTTPException(status_code=400, detail="حداکثر بازه گزارش ۴۰۰ روز است")
    return start, end, f"گزارش بازه دلخواه — {jalali_str(start)} تا {jalali_str(end)}"


def _summaries(
    db,
    period: Period,
    jalali_date: str | None,
    jalali_year: int | None,
    jalali_month: int | None,
    from_jalali: str | None,
    to_jalali: str | None,
    department_id: int | None,
    employee_id: int | None,
) -> tuple[list[PeriodSummary], date, date, str]:
    start, end, title = resolve_range(
        period, jalali_date, jalali_year, jalali_month, from_jalali, to_jalali
    )
    employees = load_employees(
        db,
        department_id=department_id,
        employee_ids=[employee_id] if employee_id else None,
    )
    return summarize_period(db, employees, start, end), start, end, title


# ------------------------------------------------------------------------- JSON


@router.get("/summary", summary="گزارش خلاصه (روزانه/هفتگی/ماهانه/دلخواه)")
def summary_report(
    db: DbSession,
    _: AnyUser,
    period: Period = "monthly",
    jalali_date: Annotated[str | None, Query(description="نمونه: 1403/05/12")] = None,
    jalali_year: int | None = None,
    jalali_month: int | None = None,
    from_jalali: str | None = None,
    to_jalali: str | None = None,
    department_id: int | None = None,
    employee_id: int | None = None,
    include_days: bool = False,
) -> dict:
    summaries, start, end, title = _summaries(
        db, period, jalali_date, jalali_year, jalali_month,
        from_jalali, to_jalali, department_id, employee_id,
    )
    items = []
    for ps in summaries:
        row = ps.as_row()
        if include_days:
            row["days"] = [d.as_row() for d in ps.days]
        items.append(row)

    totals = {
        "employees": len(summaries),
        "present_days": sum(s.present_days for s in summaries),
        "absent_days": sum(s.absent_days for s in summaries),
        "leave_days": sum(s.leave_days for s in summaries),
        "mission_days": sum(s.mission_days for s in summaries),
        "incomplete_days": sum(s.incomplete_days for s in summaries),
        "worked_minutes": sum(s.worked_minutes for s in summaries),
        "overtime_minutes": sum(s.overtime_minutes for s in summaries),
        "late_minutes": sum(s.late_minutes for s in summaries),
        "late_count": sum(s.late_count for s in summaries),
    }
    return {
        "title": title,
        "period": period,
        "from": {"gregorian": start.isoformat(), "jalali": jalali_str(start), "long": jalali_long(start)},
        "to": {"gregorian": end.isoformat(), "jalali": jalali_str(end), "long": jalali_long(end)},
        "totals": totals,
        "items": items,
    }


@router.get("/daily", summary="جزئیات یک روز برای همه پرسنل")
def daily_report(
    db: DbSession,
    _: AnyUser,
    jalali_date: str | None = None,
    department_id: int | None = None,
) -> dict:
    day = parse_jalali(jalali_date) if jalali_date else today_tehran()
    employees = load_employees(db, department_id=department_id)
    per_day = compute_days(db, employees, day, day)

    rows = []
    counters: dict[str, int] = {}
    for emp in employees:
        summaries = per_day.get(emp.id) or []
        if not summaries:
            continue
        s = summaries[0]
        row = s.as_row()
        row.update(
            {
                "full_name": emp.full_name,
                "personnel_code": emp.personnel_code,
                "department_name": emp.department.name if emp.department else None,
                "position": emp.position,
                "shift_name": emp.shift.name if emp.shift else None,
                "photo_path": emp.photo_path,
            }
        )
        rows.append(row)
        counters[s.status] = counters.get(s.status, 0) + 1

    return {
        "date": {"gregorian": day.isoformat(), "jalali": jalali_str(day), "long": jalali_long(day)},
        "counters": counters,
        "total": len(rows),
        "items": rows,
    }


@router.get("/absentees", summary="فهرست غایبان یک روز")
def absentees(
    db: DbSession,
    _: AnyUser,
    jalali_date: str | None = None,
    department_id: int | None = None,
) -> dict:
    data = daily_report(db, _, jalali_date, department_id)
    absent = [
        r for r in data["items"]
        if r["status"] in (DayStatus.ABSENT.value, DayStatus.INCOMPLETE.value)
    ]
    return {"date": data["date"], "total": len(absent), "items": absent}


@router.get("/dashboard", summary="آمار صفحه اصلی پنل")
def dashboard(db: DbSession, _: AnyUser) -> dict:
    today = today_tehran()
    employees = load_employees(db)
    per_day = compute_days(db, employees, today, today)

    counters = {s.value: 0 for s in DayStatus}
    inside = 0
    late_today = 0
    for emp in employees:
        rows = per_day.get(emp.id) or []
        if not rows:
            continue
        s = rows[0]
        counters[s.status] = counters.get(s.status, 0) + 1
        if s.open_session:
            inside += 1
        if s.late_minutes > 0:
            late_today += 1

    # روند ۷ روز گذشته
    trend = []
    week_start = today - timedelta(days=6)
    week_days = compute_days(db, employees, week_start, today)
    for offset in range(7):
        day = week_start + timedelta(days=offset)
        present = absent = 0
        for emp in employees:
            for s in week_days.get(emp.id, []):
                if s.day != day:
                    continue
                if s.status in (DayStatus.PRESENT.value, DayStatus.INCOMPLETE.value):
                    present += 1
                elif s.status == DayStatus.ABSENT.value:
                    absent += 1
        trend.append(
            {
                "date": day.isoformat(),
                "jalali": jalali_str(day),
                "long": jalali_long(day),
                "present": present,
                "absent": absent,
            }
        )

    dept_rows = db.execute(
        select(Department.name, func.count(Employee.id))
        .join(Employee, Employee.department_id == Department.id, isouter=True)
        .where(Employee.is_active.is_(True))
        .group_by(Department.name)
    ).all()

    open_tasks = db.execute(
        select(func.count()).select_from(Task).where(
            Task.is_active.is_(True),
            Task.status.in_([TaskStatus.TODO.value, TaskStatus.IN_PROGRESS.value]),
        )
    ).scalar_one()
    overdue_tasks = db.execute(
        select(func.count()).select_from(Task).where(
            Task.is_active.is_(True),
            Task.due_date < today,
            Task.status.in_([TaskStatus.TODO.value, TaskStatus.IN_PROGRESS.value]),
        )
    ).scalar_one()
    pending_leaves = db.execute(
        select(func.count()).select_from(LeaveRequest).where(
            LeaveRequest.status == LeaveStatus.PENDING.value
        )
    ).scalar_one()
    # پرسنلی که هنوز چهره‌شان ثبت نشده و روی تبلت قابل شناسایی نیستند
    face_not_enrolled = db.execute(
        select(func.count()).select_from(Employee).where(
            Employee.is_active.is_(True),
            Employee.id.not_in(
                select(FaceEmbedding.employee_id).where(FaceEmbedding.is_active.is_(True))
            ),
        )
    ).scalar_one()

    return {
        "date": {"gregorian": today.isoformat(), "jalali": jalali_str(today), "long": jalali_long(today)},
        "total_employees": len(employees),
        "counters": counters,
        "currently_inside": inside,
        "late_today": late_today,
        "trend": trend,
        "departments": [{"name": n or "بدون واحد", "count": c} for n, c in dept_rows],
        "open_tasks": open_tasks,
        "overdue_tasks": overdue_tasks,
        "pending_leaves": pending_leaves,
        "face_not_enrolled": face_not_enrolled,
    }


# ------------------------------------------------------------------ خروجی اکسل


def _xlsx_response(content: bytes, filename: str) -> Response:
    quoted = urllib.parse.quote(filename)
    return Response(
        content=content,
        media_type=XLSX_MIME,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quoted}",
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.get("/export/summary.xlsx", summary="خروجی اکسل گزارش دوره‌ای")
def export_summary(
    db: DbSession,
    _: AnyUser,
    period: Period = "monthly",
    jalali_date: str | None = None,
    jalali_year: int | None = None,
    jalali_month: int | None = None,
    from_jalali: str | None = None,
    to_jalali: str | None = None,
    department_id: int | None = None,
    employee_id: int | None = None,
    include_details: bool = True,
) -> Response:
    summaries, start, end, title = _summaries(
        db, period, jalali_date, jalali_year, jalali_month,
        from_jalali, to_jalali, department_id, employee_id,
    )
    content = export_service.build_period_workbook(
        summaries, start, end, title, include_details=include_details
    )
    return _xlsx_response(content, export_service.filename_for(f"gozaresh-{period}", start, end))


@router.get("/export/daily.xlsx", summary="خروجی اکسل گزارش یک روز")
def export_daily(
    db: DbSession,
    _: AnyUser,
    jalali_date: str | None = None,
    department_id: int | None = None,
) -> Response:
    data = daily_report(db, _, jalali_date, department_id)
    day = parse_jalali(jalali_date) if jalali_date else today_tehran()
    content = export_service.build_daily_workbook(
        data["items"], day, "گزارش حضور و غیاب روزانه"
    )
    return _xlsx_response(content, export_service.filename_for("gozaresh-rooz", day))


@router.get("/export/punches.xlsx", summary="خروجی اکسل ریز ترددها")
def export_punches(
    db: DbSession,
    _: AnyUser,
    from_jalali: str | None = None,
    to_jalali: str | None = None,
    department_id: int | None = None,
    employee_id: int | None = None,
) -> Response:
    start = parse_jalali(from_jalali) if from_jalali else today_tehran()
    end = parse_jalali(to_jalali) if to_jalali else start
    if end < start:
        raise HTTPException(status_code=400, detail="تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد")

    stmt = (
        select(AttendanceRecord)
        .options(
            selectinload(AttendanceRecord.employee).selectinload(Employee.department),
            selectinload(AttendanceRecord.device),
        )
        .where(AttendanceRecord.work_date >= start, AttendanceRecord.work_date <= end)
    )
    if employee_id:
        stmt = stmt.where(AttendanceRecord.employee_id == employee_id)
    if department_id:
        stmt = stmt.where(
            AttendanceRecord.employee_id.in_(
                select(Employee.id).where(Employee.department_id == department_id)
            )
        )

    from app.api.v1.endpoints.attendance import to_out as punch_to_out

    rows = [
        punch_to_out(r).model_dump()
        | {"department_name": r.employee.department.name if r.employee and r.employee.department else None}
        for r in db.execute(stmt.order_by(AttendanceRecord.happened_at)).scalars()
    ]
    content = export_service.build_punches_workbook(rows, start, end)
    return _xlsx_response(content, export_service.filename_for("riz-tardod", start, end))


@router.get("/export/tasks.xlsx", summary="خروجی اکسل وظایف")
def export_tasks(
    db: DbSession,
    _: AnyUser,
    employee_id: int | None = None,
    department_id: int | None = None,
    status: str | None = None,
) -> Response:
    from app.api.v1.endpoints.tasks import _dept_names, _base_query, to_out as task_to_out

    stmt = _base_query().where(Task.is_active.is_(True))
    if employee_id:
        stmt = stmt.where(Task.employee_id == employee_id)
    if department_id:
        stmt = stmt.where(Task.department_id == department_id)
    if status:
        stmt = stmt.where(Task.status == status)

    names = _dept_names(db)
    rows = []
    for t in db.execute(stmt.order_by(Task.due_date.is_(None), Task.due_date)).scalars():
        item = task_to_out(t, names).model_dump()
        item["personnel_code"] = t.employee.personnel_code if t.employee else None
        rows.append(item)

    today = today_tehran()
    content = export_service.build_tasks_workbook(
        rows, "گزارش وظایف پرسنل", f"تاریخ تهیه: {jalali_long(today)}"
    )
    return _xlsx_response(content, export_service.filename_for("vazayef", today))
