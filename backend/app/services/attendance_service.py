"""منطق ثبت تردد.

مسئولیت‌ها:
  * تشخیص خودکار ورود/خروج بر اساس آخرین تردد ثبت‌شده.
  * جلوگیری از رکورد تکراری (هم با کلید یکتای تبلت، هم با فاصله زمانی حداقلی).
  * تعیین «روز کاری» با در نظر گرفتن شیفت شب.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.jalali import now_utc, to_tehran
from app.models.attendance import AttendanceRecord
from app.models.employee import Employee
from app.models.enums import PunchKind, PunchMethod
from app.schemas.attendance import PunchResult


class PunchError(Exception):
    """خطای قابل نمایش به کاربر هنگام ثبت تردد."""


def resolve_work_date(employee: Employee, happened_at: datetime) -> date:
    """روز کاری متناظر با یک زمان.

    برای شیفت‌های شب (که از نیمه‌شب عبور می‌کنند) ترددهای بامداد به روز قبل
    نسبت داده می‌شوند تا یک شیفت در گزارش دو تکه نشود.
    """
    local = to_tehran(happened_at)
    shift = employee.shift
    if shift is not None and shift.crosses_midnight:
        cutoff = shift.end_time
        if (local.hour, local.minute) <= (cutoff.hour, cutoff.minute):
            return local.date() - timedelta(days=1)
    return local.date()


def last_punch(db: Session, employee_id: int, before: datetime) -> AttendanceRecord | None:
    return db.execute(
        select(AttendanceRecord)
        .where(
            AttendanceRecord.employee_id == employee_id,
            AttendanceRecord.happened_at <= before,
        )
        .order_by(AttendanceRecord.happened_at.desc(), AttendanceRecord.id.desc())
        .limit(1)
    ).scalar_one_or_none()


def suggest_kind(db: Session, employee_id: int, at: datetime) -> str:
    """اگر آخرین تردد «ورود» بوده، نوبت «خروج» است و بالعکس."""
    prev = last_punch(db, employee_id, at)
    if prev is None:
        return PunchKind.IN.value
    # اگر آخرین تردد مربوط به روزهای گذشته و «ورود» باشد، تردد جدید هم ورود است
    if prev.kind == PunchKind.IN.value:
        if (at - _aware(prev.happened_at)) > timedelta(hours=18):
            return PunchKind.IN.value
        return PunchKind.OUT.value
    return PunchKind.IN.value


def _aware(dt: datetime) -> datetime:
    from datetime import timezone

    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def is_inside(db: Session, employee_id: int, at: datetime | None = None) -> bool:
    prev = last_punch(db, employee_id, at or now_utc())
    return bool(prev and prev.kind == PunchKind.IN.value)


def record_punch(
    db: Session,
    *,
    employee: Employee,
    kind: str | None = None,
    happened_at: datetime | None = None,
    method: str = PunchMethod.FACE.value,
    device_id: int | None = None,
    confidence: float | None = None,
    client_uuid: str | None = None,
    created_offline: bool = False,
    snapshot_path: str | None = None,
    note: str | None = None,
    created_by_user_id: int | None = None,
    enforce_cooldown: bool = True,
) -> PunchResult:
    """یک تردد را ثبت می‌کند و نتیجه را برمی‌گرداند (بدون commit)."""
    at = _aware(happened_at or now_utc())

    if at > now_utc() + timedelta(minutes=10):
        raise PunchError("زمان تردد نمی‌تواند در آینده باشد")

    # ۱) یکتاسازی بر اساس کلید تولیدشده روی تبلت
    if client_uuid:
        existing = db.execute(
            select(AttendanceRecord).where(AttendanceRecord.client_uuid == client_uuid)
        ).scalar_one_or_none()
        if existing is not None:
            return PunchResult(
                client_uuid=client_uuid,
                status="duplicate",
                record_id=existing.id,
                kind=existing.kind,
                message="این تردد قبلاً ثبت شده است",
            )

    resolved_kind = (kind or suggest_kind(db, employee.id, at)).lower()
    if resolved_kind not in (PunchKind.IN.value, PunchKind.OUT.value):
        raise PunchError("نوع تردد باید «ورود» یا «خروج» باشد")

    # ۲) جلوگیری از ثبت پشت‌سرهم (مثلاً چند بار تشخیص چهره در چند ثانیه)
    if enforce_cooldown:
        prev = last_punch(db, employee.id, at)
        if prev is not None and prev.kind == resolved_kind:
            gap = abs((at - _aware(prev.happened_at)).total_seconds())
            if gap < settings.MIN_SECONDS_BETWEEN_PUNCHES:
                return PunchResult(
                    client_uuid=client_uuid,
                    status="duplicate",
                    record_id=prev.id,
                    kind=prev.kind,
                    message="تردد تکراری در فاصله زمانی کوتاه نادیده گرفته شد",
                )

    record = AttendanceRecord(
        employee_id=employee.id,
        device_id=device_id,
        kind=resolved_kind,
        method=method,
        happened_at=at,
        work_date=resolve_work_date(employee, at),
        confidence=confidence,
        snapshot_path=snapshot_path,
        client_uuid=client_uuid,
        created_offline=created_offline,
        synced_at=now_utc() if created_offline else None,
        note=note,
        created_by_user_id=created_by_user_id,
    )
    db.add(record)
    db.flush()
    return PunchResult(
        client_uuid=client_uuid,
        status="created",
        record_id=record.id,
        kind=resolved_kind,
        message="ورود ثبت شد" if resolved_kind == PunchKind.IN.value else "خروج ثبت شد",
    )


def find_employee(
    db: Session, *, employee_id: int | None = None, personnel_code: str | None = None
) -> Employee | None:
    if employee_id:
        return db.get(Employee, employee_id)
    if personnel_code:
        return db.execute(
            select(Employee).where(Employee.personnel_code == personnel_code.strip())
        ).scalar_one_or_none()
    return None
