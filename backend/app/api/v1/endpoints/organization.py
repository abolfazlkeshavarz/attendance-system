"""واحدهای سازمانی، شیفت‌های کاری و تعطیلات رسمی."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select

from app.api.deps import AnyUser, DbSession, ManagerUser
from app.core.jalali import jalali_month_range, parse_jalali
from app.models.employee import Employee
from app.models.organization import Department, Holiday, Shift
from app.schemas.common import Message
from app.schemas.organization import (
    DepartmentCreate,
    DepartmentOut,
    DepartmentUpdate,
    HolidayCreate,
    HolidayOut,
    ShiftCreate,
    ShiftOut,
    ShiftUpdate,
)

router = APIRouter()

# ----------------------------------------------------------------- واحد سازمانی


@router.get("/departments", response_model=list[DepartmentOut], summary="فهرست واحدها")
def list_departments(db: DbSession, _: AnyUser) -> list[DepartmentOut]:
    counts = dict(
        db.execute(
            select(Employee.department_id, func.count(Employee.id))
            .where(Employee.is_active.is_(True))
            .group_by(Employee.department_id)
        ).all()
    )
    rows = db.execute(select(Department).order_by(Department.name)).scalars().all()
    return [
        DepartmentOut(
            id=d.id,
            name=d.name,
            description=d.description,
            is_active=d.is_active,
            employee_count=counts.get(d.id, 0),
        )
        for d in rows
    ]


@router.post("/departments", response_model=DepartmentOut, status_code=201, summary="افزودن واحد")
def create_department(payload: DepartmentCreate, db: DbSession, _: ManagerUser) -> DepartmentOut:
    if db.execute(select(Department).where(Department.name == payload.name)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="واحدی با این نام وجود دارد")
    dept = Department(**payload.model_dump())
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return DepartmentOut.model_validate(dept)


@router.patch("/departments/{dept_id}", response_model=DepartmentOut, summary="ویرایش واحد")
def update_department(
    dept_id: int, payload: DepartmentUpdate, db: DbSession, _: ManagerUser
) -> DepartmentOut:
    dept = db.get(Department, dept_id)
    if dept is None:
        raise HTTPException(status_code=404, detail="واحد یافت نشد")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(dept, key, value)
    db.commit()
    db.refresh(dept)
    return DepartmentOut.model_validate(dept)


@router.delete("/departments/{dept_id}", response_model=Message, summary="حذف واحد")
def delete_department(dept_id: int, db: DbSession, _: ManagerUser) -> Message:
    dept = db.get(Department, dept_id)
    if dept is None:
        raise HTTPException(status_code=404, detail="واحد یافت نشد")
    db.delete(dept)
    db.commit()
    return Message(detail="واحد حذف شد؛ پرسنل آن بدون واحد شدند")


# ------------------------------------------------------------------------ شیفت


@router.get("/shifts", response_model=list[ShiftOut], summary="فهرست شیفت‌ها")
def list_shifts(db: DbSession, _: AnyUser) -> list[Shift]:
    return list(db.execute(select(Shift).order_by(Shift.name)).scalars().all())


@router.post("/shifts", response_model=ShiftOut, status_code=201, summary="افزودن شیفت")
def create_shift(payload: ShiftCreate, db: DbSession, _: ManagerUser) -> Shift:
    if db.execute(select(Shift).where(Shift.name == payload.name)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="شیفتی با این نام وجود دارد")
    shift = Shift(**payload.model_dump())
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return shift


@router.patch("/shifts/{shift_id}", response_model=ShiftOut, summary="ویرایش شیفت")
def update_shift(shift_id: int, payload: ShiftUpdate, db: DbSession, _: ManagerUser) -> Shift:
    shift = db.get(Shift, shift_id)
    if shift is None:
        raise HTTPException(status_code=404, detail="شیفت یافت نشد")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(shift, key, value)
    db.commit()
    db.refresh(shift)
    return shift


@router.delete("/shifts/{shift_id}", response_model=Message, summary="حذف شیفت")
def delete_shift(shift_id: int, db: DbSession, _: ManagerUser) -> Message:
    shift = db.get(Shift, shift_id)
    if shift is None:
        raise HTTPException(status_code=404, detail="شیفت یافت نشد")
    db.delete(shift)
    db.commit()
    return Message(detail="شیفت حذف شد")


# ---------------------------------------------------------------- تعطیلات رسمی


@router.get("/holidays", response_model=list[HolidayOut], summary="تعطیلات رسمی")
def list_holidays(
    db: DbSession,
    _: AnyUser,
    jalali_year: Annotated[int | None, Query(ge=1300, le=1500)] = None,
    jalali_month: Annotated[int | None, Query(ge=1, le=12)] = None,
) -> list[Holiday]:
    stmt = select(Holiday)
    if jalali_year and jalali_month:
        start, end = jalali_month_range(jalali_year, jalali_month)
        stmt = stmt.where(Holiday.day >= start, Holiday.day <= end)
    elif jalali_year:
        start, _e = jalali_month_range(jalali_year, 1)
        _s, end = jalali_month_range(jalali_year, 12)
        stmt = stmt.where(Holiday.day >= start, Holiday.day <= end)
    return list(db.execute(stmt.order_by(Holiday.day)).scalars().all())


@router.post("/holidays", response_model=HolidayOut, status_code=201, summary="افزودن تعطیلی")
def create_holiday(payload: HolidayCreate, db: DbSession, _: ManagerUser) -> Holiday:
    day = parse_jalali(payload.jalali_date)
    if db.execute(select(Holiday).where(Holiday.day == day)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="این روز قبلاً به‌عنوان تعطیل ثبت شده است")
    holiday = Holiday(day=day, title=payload.title, is_official=payload.is_official)
    db.add(holiday)
    db.commit()
    db.refresh(holiday)
    return holiday


@router.delete("/holidays/{holiday_id}", response_model=Message, summary="حذف تعطیلی")
def delete_holiday(holiday_id: int, db: DbSession, _: ManagerUser) -> Message:
    holiday = db.get(Holiday, holiday_id)
    if holiday is None:
        raise HTTPException(status_code=404, detail="تعطیلی یافت نشد")
    db.delete(holiday)
    db.commit()
    return Message(detail="تعطیلی حذف شد")
