"""درخواست‌های مرخصی و مأموریت."""
from __future__ import annotations

from datetime import datetime, time, timedelta

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import AnyUser, DbSession, ManagerUser
from app.core.jalali import TEHRAN, now_utc, parse_jalali, to_utc
from app.models.employee import Employee
from app.models.enums import LeaveStatus, LeaveType
from app.models.leave import LeaveRequest
from app.schemas.common import Message
from app.schemas.task import LeaveCreate, LeaveOut, LeaveUpdate

router = APIRouter()


def _parse_clock(value: str | None, fallback: time) -> time:
    if not value:
        return fallback
    from app.api.v1.endpoints.attendance import parse_clock

    return parse_clock(value)


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
    if payload.leave_type not in {t.value for t in LeaveType}:
        raise HTTPException(status_code=400, detail="نوع مرخصی معتبر نیست")

    start_day = parse_jalali(payload.start_jalali_date)
    end_day = parse_jalali(payload.end_jalali_date)
    if end_day < start_day:
        raise HTTPException(status_code=400, detail="تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد")

    if payload.leave_type == LeaveType.HOURLY.value:
        start_t = _parse_clock(payload.start_clock, time(8, 0))
        end_t = _parse_clock(payload.end_clock, time(16, 0))
        start_at = to_utc(datetime.combine(start_day, start_t, tzinfo=TEHRAN))
        end_at = to_utc(datetime.combine(end_day, end_t, tzinfo=TEHRAN))
        if end_at <= start_at:
            raise HTTPException(status_code=400, detail="ساعت پایان باید بعد از ساعت شروع باشد")
    else:
        start_at = to_utc(datetime.combine(start_day, time.min, tzinfo=TEHRAN))
        end_at = to_utc(datetime.combine(end_day, time.min, tzinfo=TEHRAN) + timedelta(days=1))

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
