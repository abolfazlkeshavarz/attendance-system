"""درخواست‌های مرخصی و مأموریت."""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import AnyUser, DbSession, ManagerUser
from app.core.jalali import TEHRAN, jalali_str, now_utc, parse_jalali, to_tehran, to_utc
from app.core.rate_limit import ensure_not_locked, note_failure
from app.models.employee import Employee
from app.models.enums import LeaveStatus, LeaveType, fa
from app.models.leave import LeaveRequest
from app.schemas.common import Message
from app.schemas.task import (
    LeaveCreate,
    LeaveOut,
    LeaveUpdate,
    PublicEmployeeInfo,
    PublicLeaveRequest,
    PublicLeaveResult,
)

router = APIRouter()


def _parse_clock(value: str | None, fallback: time) -> time:
    if not value:
        return fallback
    from app.api.v1.endpoints.attendance import parse_clock

    return parse_clock(value)


def resolve_leave_window(
    leave_type: str,
    start_jalali_date: str,
    end_jalali_date: str,
    start_clock: str | None,
    end_clock: str | None,
) -> tuple[datetime, datetime]:
    """بازهٔ شمسی (+ ساعت برای مرخصی ساعتی) را به دو datetime با منطقهٔ UTC تبدیل
    می‌کند. خطاهای اعتبارسنجی را به‌صورت HTTPException(400) بالا می‌برد."""
    if leave_type not in {t.value for t in LeaveType}:
        raise HTTPException(status_code=400, detail="نوع مرخصی معتبر نیست")

    start_day = parse_jalali(start_jalali_date)
    end_day = parse_jalali(end_jalali_date)
    if end_day < start_day:
        raise HTTPException(status_code=400, detail="تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد")

    if leave_type == LeaveType.HOURLY.value:
        start_t = _parse_clock(start_clock, time(8, 0))
        end_t = _parse_clock(end_clock, time(16, 0))
        start_at = to_utc(datetime.combine(start_day, start_t, tzinfo=TEHRAN))
        end_at = to_utc(datetime.combine(end_day, end_t, tzinfo=TEHRAN))
        if end_at <= start_at:
            raise HTTPException(status_code=400, detail="ساعت پایان باید بعد از ساعت شروع باشد")
    else:
        start_at = to_utc(datetime.combine(start_day, time.min, tzinfo=TEHRAN))
        end_at = to_utc(datetime.combine(end_day, time.min, tzinfo=TEHRAN) + timedelta(days=1))
    return start_at, end_at


def to_out(lv: LeaveRequest) -> LeaveOut:
    out = LeaveOut.model_validate(lv)
    if lv.employee is not None:
        out.employee_name = lv.employee.full_name
        out.personnel_code = lv.employee.personnel_code
    return out


@router.get("", response_model=list[LeaveOut], summary="فهرست مرخصی‌ها")
def list_leaves(
    db: DbSession,
    _: AnyUser,
    employee_id: int | None = None,
    status: str | None = None,
    leave_type: str | None = None,
    from_jalali: str | None = None,
    to_jalali: str | None = None,
) -> list[LeaveOut]:
    stmt = select(LeaveRequest).options(selectinload(LeaveRequest.employee))
    if employee_id:
        stmt = stmt.where(LeaveRequest.employee_id == employee_id)
    if status:
        stmt = stmt.where(LeaveRequest.status == status)
    if leave_type:
        stmt = stmt.where(LeaveRequest.leave_type == leave_type)
    if from_jalali:
        start = to_utc(datetime.combine(parse_jalali(from_jalali), time.min, tzinfo=TEHRAN))
        stmt = stmt.where(LeaveRequest.end_at >= start)
    if to_jalali:
        end = to_utc(
            datetime.combine(parse_jalali(to_jalali), time.min, tzinfo=TEHRAN) + timedelta(days=1)
        )
        stmt = stmt.where(LeaveRequest.start_at < end)

    rows = db.execute(stmt.order_by(LeaveRequest.start_at.desc())).scalars().all()
    return [to_out(lv) for lv in rows]


@router.post("", response_model=LeaveOut, status_code=201, summary="ثبت مرخصی")
def create_leave(payload: LeaveCreate, db: DbSession, _: ManagerUser) -> LeaveOut:
    emp = db.get(Employee, payload.employee_id)
    if emp is None:
        raise HTTPException(status_code=404, detail="پرسنل یافت نشد")

    start_at, end_at = resolve_leave_window(
        payload.leave_type,
        payload.start_jalali_date,
        payload.end_jalali_date,
        payload.start_clock,
        payload.end_clock,
    )

    leave = LeaveRequest(
        employee_id=emp.id,
        leave_type=payload.leave_type,
        start_at=start_at,
        end_at=end_at,
        reason=payload.reason,
    )
    db.add(leave)
    db.commit()
    db.refresh(leave)
    return to_out(leave)


# --------------------------------------------------------------------- عمومی
#
# صفحهٔ عمومی «درخواست مرخصی» که پرسنل با اسکن QR باز می‌کند: بدون ورود، فقط با
# کد پرسنلی. هر درخواست در وضعیت «در انتظار تأیید» ساخته می‌شود و تا تأیید مدیر
# در گزارش‌ها اثری ندارد. مسیرها با کد پرسنلی نرخ‌محدود می‌شوند تا جلوی ثبت
# انبوه گرفته شود.

_PUBLIC_MAX_PENDING = 5  # سقف درخواست‌های در انتظارِ هم‌زمانِ یک نفر


@router.get(
    "/public/employee/{personnel_code}",
    response_model=PublicEmployeeInfo,
    summary="یافتن نام پرسنل با کد (فرم عمومی مرخصی)",
)
def public_lookup_employee(personnel_code: str, db: DbSession) -> PublicEmployeeInfo:
    ensure_not_locked(f"leavepub:{personnel_code.strip()}")
    emp = db.execute(
        select(Employee).where(Employee.personnel_code == personnel_code.strip())
    ).scalar_one_or_none()
    if emp is None or not emp.is_active:
        note_failure(f"leavepub:{personnel_code.strip()}")
        raise HTTPException(status_code=404, detail="کد پرسنلی یافت نشد")
    return PublicEmployeeInfo(personnel_code=emp.personnel_code, full_name=emp.full_name)


@router.post(
    "/public",
    response_model=PublicLeaveResult,
    status_code=201,
    summary="ثبت درخواست مرخصی توسط پرسنل (فرم عمومی)",
)
def create_public_leave(payload: PublicLeaveRequest, db: DbSession) -> PublicLeaveResult:
    key = f"leavepub:{payload.personnel_code}"
    ensure_not_locked(key)

    emp = db.execute(
        select(Employee).where(Employee.personnel_code == payload.personnel_code)
    ).scalar_one_or_none()
    if emp is None or not emp.is_active:
        note_failure(key)
        raise HTTPException(status_code=404, detail="کد پرسنلی یافت نشد")

    start_at, end_at = resolve_leave_window(
        payload.leave_type,
        payload.start_jalali_date,
        payload.end_jalali_date,
        payload.start_clock,
        payload.end_clock,
    )

    pending = list(
        db.execute(
            select(LeaveRequest).where(
                LeaveRequest.employee_id == emp.id,
                LeaveRequest.status == LeaveStatus.PENDING.value,
            )
        ).scalars()
    )

    def _utc(dt: datetime) -> datetime:
        # SQLite hands back naive datetimes even for DateTime(timezone=True).
        return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)

    if any(_utc(lv.start_at) < end_at and _utc(lv.end_at) > start_at for lv in pending):
        raise HTTPException(
            status_code=409,
            detail="برای این بازه از قبل یک درخواست در انتظار تأیید ثبت شده است.",
        )
    if len(pending) >= _PUBLIC_MAX_PENDING:
        raise HTTPException(
            status_code=429,
            detail="تعداد درخواست‌های در انتظار تأیید شما زیاد است. تا بررسی آن‌ها صبر کنید.",
        )

    leave = LeaveRequest(
        employee_id=emp.id,
        leave_type=payload.leave_type,
        start_at=start_at,
        end_at=end_at,
        reason=payload.reason,
    )
    db.add(leave)
    db.commit()
    # ثبت موفق هم شمرده می‌شود تا یک نفر نتواند پشت‌سرهم ده‌ها درخواست بفرستد
    note_failure(key)

    return PublicLeaveResult(
        employee_name=emp.full_name,
        leave_type_fa=fa(payload.leave_type),
        start_jalali=jalali_str(to_tehran(start_at).date()),
        end_jalali=jalali_str(to_tehran(end_at - timedelta(seconds=1)).date()),
    )


@router.patch("/{leave_id}", response_model=LeaveOut, summary="بررسی یا ویرایش مرخصی")
def update_leave(
    leave_id: int, payload: LeaveUpdate, db: DbSession, user: ManagerUser
) -> LeaveOut:
    leave = db.execute(
        select(LeaveRequest)
        .options(selectinload(LeaveRequest.employee))
        .where(LeaveRequest.id == leave_id)
    ).scalar_one_or_none()
    if leave is None:
        raise HTTPException(status_code=404, detail="درخواست مرخصی یافت نشد")

    data = payload.model_dump(exclude_unset=True)
    if "status" in data:
        if data["status"] not in {s.value for s in LeaveStatus}:
            raise HTTPException(status_code=400, detail="وضعیت معتبر نیست")
        leave.reviewed_by_user_id = user.id
        leave.reviewed_at = now_utc()
    if "leave_type" in data and data["leave_type"] not in {t.value for t in LeaveType}:
        raise HTTPException(status_code=400, detail="نوع مرخصی معتبر نیست")

    for key, value in data.items():
        setattr(leave, key, value)
    db.commit()
    db.refresh(leave)
    return to_out(leave)


@router.delete("/{leave_id}", response_model=Message, summary="حذف مرخصی")
def delete_leave(leave_id: int, db: DbSession, _: ManagerUser) -> Message:
    leave = db.get(LeaveRequest, leave_id)
    if leave is None:
        raise HTTPException(status_code=404, detail="درخواست مرخصی یافت نشد")
    db.delete(leave)
    db.commit()
    return Message(detail="درخواست مرخصی حذف شد")
