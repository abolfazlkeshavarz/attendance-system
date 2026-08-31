"""مدیریت پرسنل و ثبت‌نام چهره."""
from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import AnyUser, DbSession, ManagerUser
from app.core.config import settings
from app.core.jalali import parse_jalali
from app.core.security import hash_password, verify_password
from app.models.employee import Employee, FaceEmbedding
from app.schemas.common import Message, Page
from app.schemas.employee import (
    EmployeeCreate,
    EmployeeOut,
    EmployeeUpdate,
    FaceEnrollRequest,
    FaceGallery,
    FaceOut,
    PinVerifyRequest,
)
from app.services import face_service, fingerprint_service

router = APIRouter()


def to_out(emp: Employee) -> EmployeeOut:
    return EmployeeOut(
        id=emp.id,
        personnel_code=emp.personnel_code,
        first_name=emp.first_name,
        last_name=emp.last_name,
        national_code=emp.national_code,
        mobile=emp.mobile,
        position=emp.position,
        department_id=emp.department_id,
        shift_id=emp.shift_id,
        hire_date=emp.hire_date,
        photo_path=emp.photo_path,
        notes=emp.notes,
        is_active=emp.is_active,
        department_name=emp.department.name if emp.department else None,
        shift_name=emp.shift.name if emp.shift else None,
        face_count=sum(1 for f in emp.faces if f.is_active),
        has_pin=bool(emp.pin_hash),
        has_fingerprint=emp.fingerprint_template is not None,
    )


def _base_query():
    return select(Employee).options(
        selectinload(Employee.department),
        selectinload(Employee.shift),
        selectinload(Employee.faces),
        selectinload(Employee.fingerprint_template),
    )


def get_or_404(db, employee_id: int) -> Employee:
    emp = db.execute(_base_query().where(Employee.id == employee_id)).scalar_one_or_none()
    if emp is None:
        raise HTTPException(status_code=404, detail="پرسنل یافت نشد")
    return emp


@router.get("", response_model=Page[EmployeeOut], summary="فهرست پرسنل")
def list_employees(
    db: DbSession,
    _: AnyUser,
    search: Annotated[str | None, Query(description="نام، نام خانوادگی یا کد پرسنلی")] = None,
    department_id: int | None = None,
    shift_id: int | None = None,
    is_active: bool | None = True,
    face_enrolled: bool | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 25,
) -> Page[EmployeeOut]:
    stmt = _base_query()
    count_stmt = select(func.count()).select_from(Employee)

    filters = []
    if search:
        like = f"%{search.strip()}%"
        filters.append(
            or_(
                Employee.first_name.ilike(like),
                Employee.last_name.ilike(like),
                Employee.personnel_code.ilike(like),
                Employee.national_code.ilike(like),
                Employee.position.ilike(like),
            )
        )
    if department_id is not None:
        filters.append(Employee.department_id == department_id)
    if shift_id is not None:
        filters.append(Employee.shift_id == shift_id)
    if is_active is not None:
        filters.append(Employee.is_active.is_(is_active))
    if face_enrolled is not None:
        sub = (
            select(FaceEmbedding.employee_id)
            .where(FaceEmbedding.is_active.is_(True))
            .distinct()
        )
        filters.append(
            Employee.id.in_(sub) if face_enrolled else Employee.id.not_in(sub)
        )

    if filters:
        stmt = stmt.where(*filters)
        count_stmt = count_stmt.where(*filters)

    total = db.execute(count_stmt).scalar_one()
    rows = (
        db.execute(
            stmt.order_by(Employee.last_name, Employee.first_name)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )
    return Page[EmployeeOut](
        items=[to_out(e) for e in rows], total=total, page=page, page_size=page_size
    )


@router.get("/{employee_id}", response_model=EmployeeOut, summary="جزئیات یک پرسنل")
def get_employee(employee_id: int, db: DbSession, _: AnyUser) -> EmployeeOut:
    return to_out(get_or_404(db, employee_id))


@router.post("", response_model=EmployeeOut, status_code=201, summary="افزودن پرسنل")
def create_employee(payload: EmployeeCreate, db: DbSession, _: ManagerUser) -> EmployeeOut:
    exists = db.execute(
        select(Employee).where(Employee.personnel_code == payload.personnel_code)
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="این کد پرسنلی قبلاً ثبت شده است")
    if payload.national_code:
        dup = db.execute(
            select(Employee).where(Employee.national_code == payload.national_code)
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=409, detail="این کد ملی قبلاً ثبت شده است")

    emp = Employee(
        personnel_code=payload.personnel_code,
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        national_code=payload.national_code,
        mobile=payload.mobile,
        position=payload.position,
        department_id=payload.department_id,
        shift_id=payload.shift_id,
        hire_date=payload.hire_date,
        notes=payload.notes,
        is_active=payload.is_active,
        pin_hash=hash_password(payload.pin) if payload.pin else None,
    )
    db.add(emp)
    db.commit()
    return to_out(get_or_404(db, emp.id))


@router.patch("/{employee_id}", response_model=EmployeeOut, summary="ویرایش پرسنل")
def update_employee(
    employee_id: int, payload: EmployeeUpdate, db: DbSession, _: ManagerUser
) -> EmployeeOut:
    emp = get_or_404(db, employee_id)
    data = payload.model_dump(exclude_unset=True)

    if "personnel_code" in data and data["personnel_code"]:
        dup = db.execute(
            select(Employee).where(
                Employee.personnel_code == data["personnel_code"], Employee.id != employee_id
            )
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=409, detail="این کد پرسنلی برای پرسنل دیگری ثبت شده است")
    if data.get("national_code"):
        dup = db.execute(
            select(Employee).where(
                Employee.national_code == data["national_code"], Employee.id != employee_id
            )
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=409, detail="این کد ملی برای پرسنل دیگری ثبت شده است")

    if "hire_jalali_date" in data:
        raw = data.pop("hire_jalali_date")
        emp.hire_date = parse_jalali(raw) if raw else None
    if "pin" in data:
        pin = data.pop("pin")
        emp.pin_hash = hash_password(pin) if pin else None

    for key, value in data.items():
        setattr(emp, key, value)
    db.commit()
    return to_out(get_or_404(db, employee_id))


@router.delete("/{employee_id}", response_model=Message, summary="حذف پرسنل")
def delete_employee(employee_id: int, db: DbSession, _: ManagerUser) -> Message:
    emp = get_or_404(db, employee_id)
    db.delete(emp)
    db.commit()
    return Message(detail="پرسنل و همه سوابق مرتبط حذف شد")


# ------------------------------------------------------------------ ثبت‌نام چهره


@router.get("/{employee_id}/faces", response_model=list[FaceOut], summary="نمونه‌های چهره پرسنل")
def list_faces(employee_id: int, db: DbSession, _: AnyUser) -> list[FaceEmbedding]:
    get_or_404(db, employee_id)
    return list(
        db.execute(
            select(FaceEmbedding)
            .where(FaceEmbedding.employee_id == employee_id)
            .order_by(FaceEmbedding.id)
        )
        .scalars()
        .all()
    )


@router.post(
    "/{employee_id}/faces",
    response_model=FaceOut,
    status_code=status.HTTP_201_CREATED,
    summary="افزودن نمونه چهره",
)
def enroll_face(
    employee_id: int, payload: FaceEnrollRequest, db: DbSession, _: ManagerUser
) -> FaceEmbedding:
    emp = get_or_404(db, employee_id)
    try:
        vector = face_service.as_vector(payload.vector)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    image_path = None
    if payload.image_base64:
        image_path = face_service.save_base64_image(
            payload.image_base64, settings.FACE_DIR, prefix=f"emp{emp.id}"
        )

    face = FaceEmbedding(
        employee_id=emp.id,
        vector=json.dumps(vector.round(6).tolist()),
        dim=int(vector.shape[0]),
        model_name=payload.model_name,
        quality=payload.quality,
        image_path=image_path,
    )
    db.add(face)
    if image_path and not emp.photo_path:
        emp.photo_path = image_path
    db.commit()
    db.refresh(face)
    return face


@router.delete("/{employee_id}/faces/{face_id}", response_model=Message, summary="حذف نمونه چهره")
def delete_face(employee_id: int, face_id: int, db: DbSession, _: ManagerUser) -> Message:
    face = db.get(FaceEmbedding, face_id)
    if face is None or face.employee_id != employee_id:
        raise HTTPException(status_code=404, detail="نمونه چهره یافت نشد")
    db.delete(face)
    db.commit()
    return Message(detail="نمونه چهره حذف شد")


@router.delete("/{employee_id}/fingerprint", response_model=Message, summary="حذف ثبت‌نام اثر انگشت")
def delete_fingerprint(employee_id: int, db: DbSession, _: ManagerUser) -> Message:
    get_or_404(db, employee_id)
    fingerprint_service.delete_employee_fingerprint(db, employee_id)
    return Message(detail="ثبت‌نام اثر انگشت حذف شد؛ در همگام‌سازی بعدی از همه دستگاه‌ها پاک می‌شود")


@router.post("/{employee_id}/verify-pin", response_model=Message, summary="بررسی رمز پشتیبان")
def verify_pin(
    employee_id: int, payload: PinVerifyRequest, db: DbSession, _: AnyUser
) -> Message:
    emp = get_or_404(db, employee_id)
    if not emp.pin_hash or not verify_password(payload.pin, emp.pin_hash):
        raise HTTPException(status_code=401, detail="رمز پشتیبان اشتباه است")
    return Message(detail="رمز تأیید شد")


@router.get(
    "/faces/gallery",
    response_model=FaceGallery,
    summary="گالری چهره‌ها برای تشخیص آفلاین روی تبلت",
)
def face_gallery(db: DbSession, _: AnyUser) -> FaceGallery:
    return face_service.build_gallery(db)
