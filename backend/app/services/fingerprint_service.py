"""منطق ثبت‌نام و همگام‌سازی قالب‌های اثر انگشت بین دستگاه‌ها.

نکته مهم: تطبیق ۱:۱ (اینکه انگشتِ روی سنسور متعلق به کدام پرسنل است) کاملاً
روی خودِ ماژول ESP32 با `fingerFastSearch` انجام می‌شود؛ سرور فقط شماره‌خانه
(slot_id) گزارش‌شده را به پرسنل نگاشت می‌کند. اینجا هیچ الگوریتم تطبیقی اجرا
نمی‌شود، فقط دفترداریِ «کدام قالب روی کدام دستگاه است».
"""
from __future__ import annotations

import base64

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.jalali import now_utc
from app.models.device import Device
from app.models.employee import Employee
from app.models.enums import FingerprintJobStatus
from app.models.fingerprint import FingerprintEnrollJob, FingerprintSlot, FingerprintTemplate


class FingerprintError(Exception):
    """خطای قابل نمایش به کاربر."""


def _b64_to_bytes(data: str) -> bytes:
    try:
        return base64.b64decode(data, validate=True)
    except ValueError as exc:
        raise FingerprintError("قالب اثر انگشت نامعتبر است") from exc


# ------------------------------------------------------------------ ثبت‌نام


def start_enroll_job(db: Session, employee_id: int, device_id: int) -> FingerprintEnrollJob:
    employee = db.get(Employee, employee_id)
    if employee is None or not employee.is_active:
        raise FingerprintError("پرسنل یافت نشد یا غیرفعال است")
    device = db.get(Device, device_id)
    if device is None or not device.is_active:
        raise FingerprintError("دستگاه یافت نشد یا غیرفعال است")

    existing = db.execute(
        select(FingerprintEnrollJob).where(
            FingerprintEnrollJob.device_id == device_id,
            FingerprintEnrollJob.status == FingerprintJobStatus.PENDING.value,
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise FingerprintError("این دستگاه در حال انجام یک ثبت‌نام دیگر است")

    job = FingerprintEnrollJob(employee_id=employee_id, device_id=device_id)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def cancel_enroll_job(db: Session, job_id: int) -> FingerprintEnrollJob:
    job = db.get(FingerprintEnrollJob, job_id)
    if job is None:
        raise FingerprintError("درخواست ثبت‌نام یافت نشد")
    if job.status != FingerprintJobStatus.PENDING.value:
        raise FingerprintError("این درخواست دیگر در انتظار نیست")
    job.status = FingerprintJobStatus.CANCELLED.value
    job.completed_at = now_utc()
    db.commit()
    db.refresh(job)
    return job


def get_pending_job_for_device(db: Session, device_id: int) -> FingerprintEnrollJob | None:
    return db.execute(
        select(FingerprintEnrollJob)
        .options(selectinload(FingerprintEnrollJob.employee))
        .where(
            FingerprintEnrollJob.device_id == device_id,
            FingerprintEnrollJob.status == FingerprintJobStatus.PENDING.value,
        )
        .order_by(FingerprintEnrollJob.id)
        .limit(1)
    ).scalar_one_or_none()


def complete_enroll_job(
    db: Session, *, job_id: int, slot_id: int, template_base64: str, device_id: int, model_name: str
) -> FingerprintEnrollJob:
    job = db.get(FingerprintEnrollJob, job_id)
    if job is None or job.device_id != device_id:
        raise FingerprintError("درخواست ثبت‌نام یافت نشد")
    if job.status != FingerprintJobStatus.PENDING.value:
        raise FingerprintError("این درخواست دیگر در انتظار نیست")

    template_bytes = _b64_to_bytes(template_base64)

    existing_template = db.execute(
        select(FingerprintTemplate).where(FingerprintTemplate.employee_id == job.employee_id)
    ).scalar_one_or_none()
    if existing_template is not None:
        existing_template.template_data = template_bytes
        existing_template.model_name = model_name
    else:
        db.add(
            FingerprintTemplate(
                employee_id=job.employee_id, template_data=template_bytes, model_name=model_name
            )
        )

    _upsert_slot(db, device_id=device_id, employee_id=job.employee_id, slot_id=slot_id)

    job.status = FingerprintJobStatus.DONE.value
    job.completed_at = now_utc()
    db.commit()
    db.refresh(job)
    return job


def fail_enroll_job(db: Session, *, job_id: int, device_id: int, error: str) -> FingerprintEnrollJob:
    job = db.get(FingerprintEnrollJob, job_id)
    if job is None or job.device_id != device_id:
        raise FingerprintError("درخواست ثبت‌نام یافت نشد")
    job.status = FingerprintJobStatus.FAILED.value
    job.error_message = error
    job.completed_at = now_utc()
    db.commit()
    db.refresh(job)
    return job


def delete_employee_fingerprint(db: Session, employee_id: int) -> None:
    """فقط قالب مرکزی را حذف می‌کند — نگاشت‌های هر دستگاه (`FingerprintSlot`) عمداً
    دست‌نخورده می‌مانند تا `compute_sync` به هر دستگاه بگوید که باید قالب را از
    فلش سنسورش پاک کند؛ فقط بعد از تأیید آن دستگاه در `confirm_sync` پاک می‌شوند.
    اگر همین‌جا حذفشان می‌کردیم، دستگاه هرگز نمی‌فهمید و قالب زیستی روی سنسور
    برای همیشه باقی می‌ماند.
    """
    template = db.execute(
        select(FingerprintTemplate).where(FingerprintTemplate.employee_id == employee_id)
    ).scalar_one_or_none()
    if template is not None:
        db.delete(template)
    db.commit()


# -------------------------------------------------------------------- سینک


def _upsert_slot(db: Session, *, device_id: int, employee_id: int, slot_id: int) -> None:
    row = db.execute(
        select(FingerprintSlot).where(
            FingerprintSlot.device_id == device_id, FingerprintSlot.employee_id == employee_id
        )
    ).scalar_one_or_none()
    if row is None:
        row = FingerprintSlot(device_id=device_id, employee_id=employee_id, slot_id=slot_id)
        db.add(row)
    else:
        row.slot_id = slot_id
    row.synced_at = now_utc()


def compute_sync(db: Session, device_id: int, model_name: str) -> tuple[list[tuple[Employee, bytes]], list[int]]:
    """برمی‌گرداند: (قالب‌هایی که این دستگاه ندارد, employee_id هایی که باید پاک شود)."""
    have_slots = db.execute(
        select(FingerprintSlot.employee_id).where(FingerprintSlot.device_id == device_id)
    ).scalars().all()
    have_ids = set(have_slots)

    templates = (
        db.execute(
            select(FingerprintTemplate)
            .options(selectinload(FingerprintTemplate.employee))
            .where(FingerprintTemplate.model_name == model_name)
        )
        .scalars()
        .all()
    )
    active_ids = {t.employee_id for t in templates if t.employee and t.employee.is_active}

    to_add = [
        (t.employee, t.template_data)
        for t in templates
        if t.employee_id not in have_ids and t.employee and t.employee.is_active
    ]
    # پرسنلی که دیگر قالب فعال (هم‌مدل) ندارد ولی روی این دستگاه اسلات دارد باید پاک شود
    to_remove = [emp_id for emp_id in have_ids if emp_id not in active_ids]
    return to_add, to_remove


def confirm_sync(
    db: Session, device_id: int, added: list[tuple[int, int]], removed_employee_ids: list[int]
) -> None:
    for employee_id, slot_id in added:
        _upsert_slot(db, device_id=device_id, employee_id=employee_id, slot_id=slot_id)
    if removed_employee_ids:
        for row in db.execute(
            select(FingerprintSlot).where(
                FingerprintSlot.device_id == device_id,
                FingerprintSlot.employee_id.in_(removed_employee_ids),
            )
        ).scalars():
            db.delete(row)
    db.commit()


# -------------------------------------------------------------------- تردد


def resolve_employee(db: Session, device_id: int, slot_id: int) -> Employee | None:
    slot = db.execute(
        select(FingerprintSlot).where(
            FingerprintSlot.device_id == device_id, FingerprintSlot.slot_id == slot_id
        )
    ).scalar_one_or_none()
    if slot is None:
        return None
    return db.get(Employee, slot.employee_id)
