"""مشاهده، ثبت دستی و اصلاح ترددها (پنل مدیریت)."""
from __future__ import annotations

from datetime import date, datetime, time
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import AnyUser, DbSession, ManagerUser
from app.core.jalali import (
    TEHRAN,
    normalize_digits,
    parse_jalali,
    range_bounds_utc,
    to_utc,
    today_tehran,
)
from app.models.attendance import AttendanceRecord
from app.models.employee import Employee
from app.models.enums import PunchKind, PunchMethod
from app.schemas.attendance import (
    AttendanceOut,
    AttendanceUpdate,
    ManualPunch,
    TodayStatus,
)
from app.schemas.common import Message, Page
from app.services import attendance_service
from app.services.report_service import compute_days, load_employees

router = APIRouter()


def parse_clock(value: str) -> time:
    raw = normalize_digits(value).strip().replace(".", ":")
    parts = raw.split(":")
    if len(parts) < 2 or not all(p.isdigit() for p in parts[:2]):
        raise HTTPException(status_code=400, detail="ساعت باید به قالب HH:MM باشد")
    hour, minute = int(parts[0]), int(parts[1])
    if not (0 <= hour < 24 and 0 <= minute < 60):
        raise HTTPException(status_code=400, detail="ساعت وارد شده معتبر نیست")
    return time(hour, minute)


def to_out(rec: AttendanceRecord) -> AttendanceOut:
    return AttendanceOut(
        id=rec.id,
        employee_id=rec.employee_id,
        device_id=rec.device_id,
        kind=rec.kind,
        method=rec.method,
        happened_at=rec.happened_at,
        work_date=rec.work_date,
        confidence=rec.confidence,
        snapshot_path=rec.snapshot_path,
        created_offline=rec.created_offline,
        note=rec.note,
        employee_name=rec.employee.full_name if rec.employee else None,
        personnel_code=rec.employee.personnel_code if rec.employee else None,
        device_name=rec.device.name if rec.device else None,
    )


@router.get("", response_model=Page[AttendanceOut], summary="فهرست ترددها")
def list_punches(
    db: DbSession,
    _: AnyUser,
    employee_id: int | None = None,
    department_id: int | None = None,
    from_jalali: Annotated[str | None, Query(description="نمونه: 1403/05/01")] = None,
    to_jalali: str | None = None,
    kind: str | None = None,
    method: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 50,
) -> Page[AttendanceOut]:
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
    count_stmt = select(func.count()).select_from(AttendanceRecord).where(
        AttendanceRecord.work_date >= start, AttendanceRecord.work_date <= end
    )

    filters = []
    if employee_id:
        filters.append(AttendanceRecord.employee_id == employee_id)
    if department_id:
        sub = select(Employee.id).where(Employee.department_id == department_id)
        filters.append(AttendanceRecord.employee_id.in_(sub))
    if kind:
        filters.append(AttendanceRecord.kind == kind)
    if method:
        filters.append(AttendanceRecord.method == method)
    if filters:
        stmt = stmt.where(*filters)
        count_stmt = count_stmt.where(*filters)

    total = db.execute(count_stmt).scalar_one()
    rows = (
        db.execute(
            stmt.order_by(AttendanceRecord.happened_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )
    return Page[AttendanceOut](
        items=[to_out(r) for r in rows], total=total, page=page, page_size=page_size
    )


@router.post("/manual", response_model=AttendanceOut, status_code=201, summary="ثبت دستی تردد")
def manual_punch(payload: ManualPunch, db: DbSession, user: ManagerUser) -> AttendanceOut:
    emp = db.get(Employee, payload.employee_id)
    if emp is None:
        raise HTTPException(status_code=404, detail="پرسنل یافت نشد")
    if payload.kind not in (PunchKind.IN.value, PunchKind.OUT.value):
        raise HTTPException(status_code=400, detail="نوع تردد باید ورود یا خروج باشد")

    day = parse_jalali(payload.jalali_date)
    clock = parse_clock(payload.clock)
    happened_at = to_utc(datetime.combine(day, clock, tzinfo=TEHRAN))

    try:
        result = attendance_service.record_punch(
            db,
            employee=emp,
            kind=payload.kind,
            happened_at=happened_at,
            method=PunchMethod.MANUAL.value,
            note=payload.note,
            created_by_user_id=user.id,
            enforce_cooldown=False,
        )
    except attendance_service.PunchError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    db.commit()
    rec = db.execute(
        select(AttendanceRecord)
        .options(
            selectinload(AttendanceRecord.employee),
            selectinload(AttendanceRecord.device),
        )
        .where(AttendanceRecord.id == result.record_id)
    ).scalar_one()
    return to_out(rec)


@router.patch("/{record_id}", response_model=AttendanceOut, summary="اصلاح تردد")
def update_punch(
    record_id: int, payload: AttendanceUpdate, db: DbSession, user: ManagerUser
) -> AttendanceOut:
    rec = db.execute(
        select(AttendanceRecord)
        .options(
            selectinload(AttendanceRecord.employee),
            selectinload(AttendanceRecord.device),
        )
        .where(AttendanceRecord.id == record_id)
    ).scalar_one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail="تردد یافت نشد")

    if payload.kind:
        if payload.kind not in (PunchKind.IN.value, PunchKind.OUT.value):
            raise HTTPException(status_code=400, detail="نوع تردد باید ورود یا خروج باشد")
        rec.kind = payload.kind
    if payload.jalali_date or payload.clock:
        current_local = rec.happened_at.astimezone(TEHRAN)
        day = parse_jalali(payload.jalali_date) if payload.jalali_date else current_local.date()
        clock = parse_clock(payload.clock) if payload.clock else current_local.time()
        rec.happened_at = to_utc(datetime.combine(day, clock, tzinfo=TEHRAN))
        rec.work_date = attendance_service.resolve_work_date(rec.employee, rec.happened_at)
    if payload.note is not None:
        rec.note = payload.note

    rec.method = PunchMethod.ADMIN_FIX.value
    rec.created_by_user_id = user.id
    db.commit()
    db.refresh(rec)
    return to_out(rec)


@router.delete("/{record_id}", response_model=Message, summary="حذف تردد")
def delete_punch(record_id: int, db: DbSession, _: ManagerUser) -> Message:
    rec = db.get(AttendanceRecord, record_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="تردد یافت نشد")
    db.delete(rec)
    db.commit()
    return Message(detail="تردد حذف شد")


@router.get("/status/today", response_model=list[TodayStatus], summary="وضعیت لحظه‌ای امروز")
def today_status(
    db: DbSession,
    _: AnyUser,
    department_id: int | None = None,
    jalali_date: str | None = None,
) -> list[TodayStatus]:
    day: date = parse_jalali(jalali_date) if jalali_date else today_tehran()
    employees = load_employees(db, department_id=department_id)
    per_day = compute_days(db, employees, day, day)

    out: list[TodayStatus] = []
    for emp in employees:
        summaries = per_day.get(emp.id) or []
        if not summaries:
            continue
        s = summaries[0]
        row = s.as_row()
        out.append(
            TodayStatus(
                employee_id=emp.id,
                full_name=emp.full_name,
                personnel_code=emp.personnel_code,
                photo_path=emp.photo_path,
                department_name=emp.department.name if emp.department else None,
                first_in=row["first_in"],
                last_out=row["last_out"],
                is_inside=s.open_session,
                worked_minutes=s.worked_minutes,
                late_minutes=s.late_minutes,
                status=s.status,
            )
        )
    return out


@router.get("/status/live-count", summary="شمارش لحظه‌ای حاضران")
def live_count(db: DbSession, _: AnyUser) -> dict:
    day = today_tehran()
    start_utc, end_utc = range_bounds_utc(day, day)
    total_active = db.execute(
        select(func.count()).select_from(Employee).where(Employee.is_active.is_(True))
    ).scalar_one()
    punched = db.execute(
        select(func.count(func.distinct(AttendanceRecord.employee_id))).where(
            AttendanceRecord.work_date == day
        )
    ).scalar_one()
    inside = 0
    for emp_id in db.execute(
        select(func.distinct(AttendanceRecord.employee_id)).where(
            AttendanceRecord.work_date == day
        )
    ).scalars():
        if attendance_service.is_inside(db, emp_id):
            inside += 1
    return {
        "date": day.isoformat(),
        "total_employees": total_active,
        "present_today": punched,
        "currently_inside": inside,
        "absent_today": max(0, total_active - punched),
        "range_utc": [start_utc.isoformat(), end_utc.isoformat()],
    }
