"""ثبت‌نام و تردد با اثر انگشت.

دو گروه مسیر:
  * `admin_router` (زیر `/fingerprint`) — با توکن مدیر/سرپرست، برای شروع/لغو
    ثبت‌نام از پنل.
  * `device_router` (زیر `/kiosk/fingerprint`) — با کلید دستگاه، برای ماژول
    ESP32: گرفتن کارِ در انتظار، تأیید ثبت‌نام، همگام‌سازی قالب‌ها بین
    دستگاه‌ها، و ثبت تردد.
"""
from __future__ import annotations

import base64

from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import selectinload

from app.api.deps import AnyUser, CurrentDevice, DbSession, ManagerUser
from app.core.jalali import now_utc
from app.models.enums import PunchMethod
from app.models.fingerprint import FingerprintEnrollJob
from app.schemas.attendance import PunchResult
from app.schemas.common import Message
from app.schemas.fingerprint import (
    FingerprintEnrollComplete,
    FingerprintEnrollFail,
    FingerprintEnrollJobOut,
    FingerprintEnrollStart,
    FingerprintPunchRequest,
    FingerprintSyncConfirm,
    FingerprintSyncItem,
    FingerprintSyncRequest,
    FingerprintSyncResponse,
    PendingEnrollOut,
)
from app.services import attendance_service, fingerprint_service, settings_service

admin_router = APIRouter()
device_router = APIRouter()


def _job_out(job: FingerprintEnrollJob) -> FingerprintEnrollJobOut:
    out = FingerprintEnrollJobOut.model_validate(job)
    out.employee_name = job.employee.full_name if job.employee else None
    out.device_name = job.device.name if job.device else None
    return out


# --------------------------------------------------------------- پنل مدیریت


@admin_router.post("/enroll", response_model=FingerprintEnrollJobOut, status_code=201, summary="شروع ثبت‌نام روی یک دستگاه")
def start_enroll(payload: FingerprintEnrollStart, db: DbSession, _: ManagerUser) -> FingerprintEnrollJobOut:
    try:
        job = fingerprint_service.start_enroll_job(db, payload.employee_id, payload.device_id)
    except fingerprint_service.FingerprintError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _job_out(job)


@admin_router.get("/enroll/{job_id}", response_model=FingerprintEnrollJobOut, summary="وضعیت یک ثبت‌نام (برای poll از پنل)")
def get_enroll(job_id: int, db: DbSession, _: AnyUser) -> FingerprintEnrollJobOut:
    job = db.get(
        FingerprintEnrollJob,
        job_id,
        options=[selectinload(FingerprintEnrollJob.employee), selectinload(FingerprintEnrollJob.device)],
    )
    if job is None:
        raise HTTPException(status_code=404, detail="درخواست ثبت‌نام یافت نشد")
    return _job_out(job)


@admin_router.delete("/enroll/{job_id}", response_model=Message, summary="لغو یک ثبت‌نام در انتظار")
def cancel_enroll(job_id: int, db: DbSession, _: ManagerUser) -> Message:
    try:
        fingerprint_service.cancel_enroll_job(db, job_id)
    except fingerprint_service.FingerprintError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Message(detail="درخواست ثبت‌نام لغو شد")


# ------------------------------------------------------------ ماژول ESP32


@device_router.get("/pending-enroll", response_model=PendingEnrollOut, summary="بررسی درخواست ثبت‌نام در انتظار")
def pending_enroll(device: CurrentDevice, db: DbSession) -> PendingEnrollOut:
    job = fingerprint_service.get_pending_job_for_device(db, device.id)
    return PendingEnrollOut(job=_job_out(job) if job else None)


@device_router.post("/enroll/complete", response_model=FingerprintEnrollJobOut, summary="تأیید موفقیت ثبت‌نام")
def enroll_complete(
    payload: FingerprintEnrollComplete, device: CurrentDevice, db: DbSession
) -> FingerprintEnrollJobOut:
    try:
        job = fingerprint_service.complete_enroll_job(
            db,
            job_id=payload.job_id,
            slot_id=payload.slot_id,
            template_base64=payload.template_base64,
            device_id=device.id,
            model_name=payload.model_name,
        )
    except fingerprint_service.FingerprintError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _job_out(job)


@device_router.post("/enroll/fail", response_model=FingerprintEnrollJobOut, summary="گزارش شکست ثبت‌نام")
def enroll_fail(payload: FingerprintEnrollFail, device: CurrentDevice, db: DbSession) -> FingerprintEnrollJobOut:
    try:
        job = fingerprint_service.fail_enroll_job(
            db, job_id=payload.job_id, device_id=device.id, error=payload.error
        )
    except fingerprint_service.FingerprintError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _job_out(job)


@device_router.post("/sync", response_model=FingerprintSyncResponse, summary="قالب‌های ناهماهنگ با این دستگاه")
def sync(payload: FingerprintSyncRequest, device: CurrentDevice, db: DbSession) -> FingerprintSyncResponse:
    to_add, to_remove = fingerprint_service.compute_sync(db, device.id, payload.model_name)
    return FingerprintSyncResponse(
        to_add=[
            FingerprintSyncItem(
                employee_id=emp.id,
                full_name=emp.full_name,
                template_base64=base64.b64encode(data).decode(),
            )
            for emp, data in to_add
        ],
        to_remove=to_remove,
    )


@device_router.post("/sync/confirm", response_model=Message, summary="تأیید نوشتن/پاک‌کردن روی فلش سنسور")
def sync_confirm(payload: FingerprintSyncConfirm, device: CurrentDevice, db: DbSession) -> Message:
    fingerprint_service.confirm_sync(
        db,
        device.id,
        added=[(item.employee_id, item.slot_id) for item in payload.added],
        removed_employee_ids=payload.removed_employee_ids,
    )
    return Message(detail="همگام‌سازی ثبت شد")


@device_router.post("/punch", response_model=PunchResult, summary="ثبت تردد با اثر انگشت")
def punch(payload: FingerprintPunchRequest, device: CurrentDevice, db: DbSession) -> PunchResult:
    if not settings_service.get_auth_methods(db).fingerprint_enabled:
        raise HTTPException(status_code=403, detail="ثبت تردد با اثر انگشت غیرفعال است")

    emp = fingerprint_service.resolve_employee(db, device.id, payload.slot_id)
    if emp is None:
        raise HTTPException(status_code=404, detail="این اثر انگشت روی هیچ پرسنلی ثبت نشده است")
    if not emp.is_active:
        raise HTTPException(status_code=403, detail="این پرسنل در سامانه فعال نیست")

    try:
        result = attendance_service.record_punch(
            db,
            employee=emp,
            kind=payload.kind,
            happened_at=payload.happened_at,
            method=PunchMethod.FINGERPRINT.value,
            device_id=device.id,
            confidence=payload.confidence,
            client_uuid=payload.client_uuid,
            created_offline=payload.created_offline,
        )
    except attendance_service.PunchError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    device.last_sync_at = now_utc()
    db.commit()
    result.message = f"{emp.full_name} — {result.message}"
    return result
