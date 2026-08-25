"""ساخت گزارش‌های روزانه، هفتگی و ماهانه حضور و غیاب."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.jalali import (
    TEHRAN,
    WEEKDAY_NAMES_FA,
    daterange,
    fmt_duration,
    fmt_time,
    iran_weekday,
    jalali_long,
    jalali_str,
    range_bounds_utc,
    today_tehran,
)
from app.models.attendance import AttendanceRecord
from app.models.employee import Employee
from app.models.enums import DayStatus, LeaveStatus, LeaveType, PunchKind, fa
from app.models.leave import LeaveRequest
from app.models.organization import Holiday, Shift


@dataclass
class DaySummary:
    """وضعیت یک پرسنل در یک روز."""

    employee_id: int
    day: date
    status: str = DayStatus.ABSENT.value
    first_in: datetime | None = None
    last_out: datetime | None = None
    worked_minutes: int = 0
    expected_minutes: int = 0
    late_minutes: int = 0
    early_leave_minutes: int = 0
    overtime_minutes: int = 0
    punch_count: int = 0
    open_session: bool = False  # ورود بدون خروج
    leave_minutes: int = 0
    note: str = ""

    @property
    def is_workday(self) -> bool:
        return self.status not in (DayStatus.HOLIDAY.value, DayStatus.WEEKEND.value)

    def as_row(self) -> dict:
        return {
            "employee_id": self.employee_id,
            "date": self.day.isoformat(),
            "jalali_date": jalali_str(self.day),
            "jalali_long": jalali_long(self.day),
            "weekday": WEEKDAY_NAMES_FA[iran_weekday(self.day)],
            "status": self.status,
            "status_fa": fa(self.status),
            "first_in": fmt_time(self.first_in),
            "last_out": fmt_time(self.last_out),
            "worked_minutes": self.worked_minutes,
            "worked_hhmm": fmt_duration(self.worked_minutes),
            "expected_minutes": self.expected_minutes,
            "expected_hhmm": fmt_duration(self.expected_minutes),
            "late_minutes": self.late_minutes,
            "early_leave_minutes": self.early_leave_minutes,
            "overtime_minutes": self.overtime_minutes,
            "overtime_hhmm": fmt_duration(self.overtime_minutes),
            "punch_count": self.punch_count,
            "open_session": self.open_session,
            "leave_minutes": self.leave_minutes,
            "note": self.note,
        }


@dataclass
class PeriodSummary:
    """جمع‌بندی یک پرسنل در یک بازه زمانی."""

    employee_id: int
    full_name: str = ""
    personnel_code: str = ""
    department_name: str | None = None
    position: str | None = None
    present_days: int = 0
    absent_days: int = 0
    leave_days: int = 0
    mission_days: int = 0
    holiday_days: int = 0
    weekend_days: int = 0
    incomplete_days: int = 0
    worked_minutes: int = 0
    expected_minutes: int = 0
    late_minutes: int = 0
    late_count: int = 0
    early_leave_minutes: int = 0
    overtime_minutes: int = 0
    days: list[DaySummary] = field(default_factory=list)

    @property
    def attendance_rate(self) -> float:
        work_days = self.present_days + self.absent_days + self.incomplete_days
        if work_days == 0:
            return 100.0
        return round((self.present_days + self.incomplete_days) * 100.0 / work_days, 1)

    def as_row(self) -> dict:
        return {
            "employee_id": self.employee_id,
            "full_name": self.full_name,
            "personnel_code": self.personnel_code,
            "department_name": self.department_name or "",
            "position": self.position or "",
            "present_days": self.present_days,
            "absent_days": self.absent_days,
            "leave_days": self.leave_days,
            "mission_days": self.mission_days,
            "holiday_days": self.holiday_days,
            "weekend_days": self.weekend_days,
            "incomplete_days": self.incomplete_days,
            "worked_minutes": self.worked_minutes,
            "worked_hhmm": fmt_duration(self.worked_minutes),
            "expected_minutes": self.expected_minutes,
            "expected_hhmm": fmt_duration(self.expected_minutes),
            "late_minutes": self.late_minutes,
            "late_count": self.late_count,
            "early_leave_minutes": self.early_leave_minutes,
            "overtime_minutes": self.overtime_minutes,
            "overtime_hhmm": fmt_duration(self.overtime_minutes),
            "attendance_rate": self.attendance_rate,
        }


# --------------------------------------------------------------------------- کمکی


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _shift_bounds(day: date, shift: Shift) -> tuple[datetime, datetime]:
    start = datetime.combine(day, shift.start_time, tzinfo=TEHRAN)
    end_day = day + timedelta(days=1) if shift.crosses_midnight else day
    end = datetime.combine(end_day, shift.end_time, tzinfo=TEHRAN)
    return start, end


def _pair_sessions(punches: list[AttendanceRecord]) -> tuple[int, bool]:
    """مجموع دقایق حضور از جفت‌های ورود/خروج، و اینکه جلسه بازی مانده یا نه."""
    total = 0
    open_at: datetime | None = None
    for p in punches:
        ts = _aware(p.happened_at)
        if p.kind == PunchKind.IN.value:
            if open_at is None:
                open_at = ts
        else:
            if open_at is not None:
                total += max(0, int((ts - open_at).total_seconds() // 60))
                open_at = None
    return total, open_at is not None


# --------------------------------------------------------------------------- محاسبه


def compute_days(
    db: Session, employees: list[Employee], start: date, end: date
) -> dict[int, list[DaySummary]]:
    """وضعیت روزانه همه پرسنل داده‌شده در بازه [start, end].

    بازه هرگز از «امروز» جلوتر نمی‌رود: روزهایی که هنوز نرسیده‌اند غیبت نیستند.
    بدون این محدودیت، گزارش ماهانهٔ ماه جاری، تمام روزهای باقی‌مانده ماه را
    غیبت حساب می‌کرد.
    """
    emp_ids = [e.id for e in employees]
    if not emp_ids:
        return {}

    end = min(end, today_tehran())
    if start > end:
        return {e.id: [] for e in employees}

    start_utc, end_utc = range_bounds_utc(start - timedelta(days=1), end + timedelta(days=1))

    punches = (
        db.execute(
            select(AttendanceRecord)
            .where(
                AttendanceRecord.employee_id.in_(emp_ids),
                AttendanceRecord.happened_at >= start_utc,
                AttendanceRecord.happened_at < end_utc,
            )
            .order_by(AttendanceRecord.happened_at)
        )
        .scalars()
        .all()
    )
    by_key: dict[tuple[int, date], list[AttendanceRecord]] = defaultdict(list)
    for p in punches:
        by_key[(p.employee_id, p.work_date)].append(p)

    holidays = {
        h.day: h.title
        for h in db.execute(
            select(Holiday).where(Holiday.day >= start, Holiday.day <= end)
        ).scalars()
    }

    leaves = (
        db.execute(
            select(LeaveRequest).where(
                LeaveRequest.employee_id.in_(emp_ids),
                LeaveRequest.status == LeaveStatus.APPROVED.value,
                LeaveRequest.end_at >= start_utc,
                LeaveRequest.start_at < end_utc,
            )
        )
        .scalars()
        .all()
    )
    leaves_by_emp: dict[int, list[LeaveRequest]] = defaultdict(list)
    for lv in leaves:
        leaves_by_emp[lv.employee_id].append(lv)

    result: dict[int, list[DaySummary]] = {}
    for emp in employees:
        rows: list[DaySummary] = []
        for day in daterange(start, end):
            rows.append(
                _summarize_day(
                    emp,
                    emp.shift,
                    day,
                    by_key.get((emp.id, day), []),
                    holidays,
                    leaves_by_emp.get(emp.id, []),
                )
            )
        result[emp.id] = rows
    return result


def _summarize_day(
    emp: Employee,
    shift: Shift | None,
    day: date,
    punches: list[AttendanceRecord],
    holidays: dict[date, str],
    leaves: list[LeaveRequest],
) -> DaySummary:
    s = DaySummary(employee_id=emp.id, day=day, punch_count=len(punches))

    if shift is not None:
        s.expected_minutes = shift.expected_minutes

    worked, open_session = _pair_sessions(punches)
    s.worked_minutes = worked
    s.open_session = open_session
    ins = [p for p in punches if p.kind == PunchKind.IN.value]
    outs = [p for p in punches if p.kind == PunchKind.OUT.value]
    s.first_in = _aware(ins[0].happened_at) if ins else None
    s.last_out = _aware(outs[-1].happened_at) if outs else None

    # مرخصی یا مأموریت تأییدشده‌ای که با این روز هم‌پوشانی دارد
    day_start = datetime.combine(day, time.min, tzinfo=TEHRAN)
    day_end = day_start + timedelta(days=1)
    day_leave: LeaveRequest | None = None
    for lv in leaves:
        if _aware(lv.start_at) < day_end and _aware(lv.end_at) > day_start:
            overlap_start = max(_aware(lv.start_at), day_start)
            overlap_end = min(_aware(lv.end_at), day_end)
            s.leave_minutes += max(0, int((overlap_end - overlap_start).total_seconds() // 60))
            day_leave = lv

    # اولویت تعیین وضعیت: تعطیل رسمی، تعطیل هفتگی، پیش از استخدام
    if day in holidays:
        s.status = DayStatus.HOLIDAY.value
        s.expected_minutes = 0
        s.note = holidays[day]
    elif shift is not None and iran_weekday(day) not in shift.work_day_set:
        s.status = DayStatus.WEEKEND.value
        s.expected_minutes = 0
    elif emp.hire_date and day < emp.hire_date:
        s.status = DayStatus.WEEKEND.value
        s.expected_minutes = 0
        s.note = "پیش از تاریخ استخدام"

    if punches:
        if s.status in (DayStatus.HOLIDAY.value, DayStatus.WEEKEND.value):
            # کار کردن در روز تعطیل، تماماً اضافه‌کاری محسوب می‌شود
            s.overtime_minutes = worked
            s.status = DayStatus.INCOMPLETE.value if open_session else DayStatus.PRESENT.value
        else:
            s.status = DayStatus.INCOMPLETE.value if open_session else DayStatus.PRESENT.value
            if shift is not None:
                shift_start, shift_end = _shift_bounds(day, shift)
                if s.first_in:
                    late = int((s.first_in - shift_start).total_seconds() // 60)
                    s.late_minutes = max(0, late - shift.grace_in_minutes)
                if s.last_out and not open_session:
                    early = int((shift_end - s.last_out).total_seconds() // 60)
                    s.early_leave_minutes = max(0, early - shift.grace_out_minutes)
                s.overtime_minutes = max(0, worked - shift.expected_minutes)
    elif s.status not in (DayStatus.HOLIDAY.value, DayStatus.WEEKEND.value):
        if day_leave is not None:
            s.status = (
                DayStatus.MISSION.value
                if day_leave.leave_type == LeaveType.MISSION.value
                else DayStatus.LEAVE.value
            )
            s.note = day_leave.reason or fa(day_leave.leave_type)
        else:
            s.status = DayStatus.ABSENT.value

    return s


def summarize_period(
    db: Session, employees: list[Employee], start: date, end: date
) -> list[PeriodSummary]:
    per_day = compute_days(db, employees, start, end)
    out: list[PeriodSummary] = []
    for emp in employees:
        ps = PeriodSummary(
            employee_id=emp.id,
            full_name=emp.full_name,
            personnel_code=emp.personnel_code,
            department_name=emp.department.name if emp.department else None,
            position=emp.position,
        )
        for d in per_day.get(emp.id, []):
            ps.days.append(d)
            ps.worked_minutes += d.worked_minutes
            ps.late_minutes += d.late_minutes
            ps.early_leave_minutes += d.early_leave_minutes
            ps.overtime_minutes += d.overtime_minutes
            if d.late_minutes > 0:
                ps.late_count += 1
            if d.status == DayStatus.PRESENT.value:
                ps.present_days += 1
                ps.expected_minutes += d.expected_minutes
            elif d.status == DayStatus.INCOMPLETE.value:
                ps.incomplete_days += 1
                ps.expected_minutes += d.expected_minutes
            elif d.status == DayStatus.ABSENT.value:
                ps.absent_days += 1
                ps.expected_minutes += d.expected_minutes
            elif d.status == DayStatus.LEAVE.value:
                ps.leave_days += 1
            elif d.status == DayStatus.MISSION.value:
                ps.mission_days += 1
            elif d.status == DayStatus.HOLIDAY.value:
                ps.holiday_days += 1
            elif d.status == DayStatus.WEEKEND.value:
                ps.weekend_days += 1
        out.append(ps)
    return out


def load_employees(
    db: Session,
    *,
    department_id: int | None = None,
    employee_ids: list[int] | None = None,
    include_inactive: bool = False,
) -> list[Employee]:
    stmt = select(Employee).options(
        selectinload(Employee.department), selectinload(Employee.shift)
    )
    if not include_inactive:
        stmt = stmt.where(Employee.is_active.is_(True))
    if department_id:
        stmt = stmt.where(Employee.department_id == department_id)
    if employee_ids:
        stmt = stmt.where(Employee.id.in_(employee_ids))
    stmt = stmt.order_by(Employee.last_name, Employee.first_name)
    return list(db.execute(stmt).scalars().all())
