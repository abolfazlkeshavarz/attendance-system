"""واسط برنامه تبلت (کیوسک ورودی کارخانه).

همه مسیرهای این فایل با هدر `X-Device-Key` احراز هویت می‌شوند، نه با توکن مدیر.
جریان کار تبلت:
  ۱. یک‌بار با کلید دستگاه ثبت می‌شود.
  ۲. گالری چهره‌ها را می‌گیرد و در حافظه مرورگر نگه می‌دارد.
  ۳. تشخیص چهره را به‌صورت محلی انجام می‌دهد (بدون نیاز به اینترنت).
  ۴. تردد را فوراً ارسال می‌کند؛ اگر اینترنت نبود در صف محلی می‌ماند و بعداً
     با مسیر `/sync` به‌صورت دسته‌ای ارسال می‌شود.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import CurrentDevice, DbSession
from app.core.config import settings
from app.core.jalali import fmt_time, jalali_long, now_utc, to_tehran
from app.core.security import verify_password
from app.models.employee import Employee
from app.models.enums import PunchMethod
from app.schemas.attendance import (
    KioskHeartbeat,
    KioskIdentifyRequest,
    KioskIdentifyResponse,
    PunchBatch,
    PunchBatchResult,
    PunchIn,
    PunchResult,
)
from app.schemas.employee import FaceGallery
from app.services import attendance_service, face_service

router = APIRouter()


@router.get("/handshake", summary="اتصال اولیه تبلت و دریافت تنظیمات")
def handshake(device: CurrentDevice, db: DbSession) -> dict:
    now = now_utc()
    local = to_tehran(now)
    return {
        "device": {
            "id": device.id,
            "name": device.name,
            "location": device.location,
            "device_uid": device.device_uid,
        },
        "server_time_utc": now.isoformat(),
        "server_time_local": local.isoformat(),
        "clock": fmt_time(now),
        "today_jalali": jalali_long(local.date()),
        "settings": {
            "face_threshold": settings.FACE_MATCH_THRESHOLD,
            "min_seconds_between_punches": settings.MIN_SECONDS_BETWEEN_PUNCHES,
            "timezone": settings.TIMEZONE,
            "require_liveness": settings.REQUIRE_LIVENESS,
            "liveness_turn_threshold": settings.LIVENESS_TURN_THRESHOLD,
            "liveness_timeout_seconds": settings.LIVENESS_TIMEOUT_SECONDS,
        },
    }


@router.post("/heartbeat", summary="گزارش وضعیت تبلت به سرور")
def heartbeat(payload: KioskHeartbeat, device: CurrentDevice, db: DbSession) -> dict:
    """تبلت تعداد ترددهای ارسال‌نشده خودش را اعلام می‌کند.

    بدون این، پنل مدیریت نمی‌فهمد یک تبلت چند روز است آفلاین مانده و چند تردد
    روی آن معطل است.
    """
    device.pending_count = payload.pending_count
    device.app_version = payload.app_version or device.app_version
    device.last_seen_at = now_utc()
    db.commit()
    return {"ok": True, "server_time": now_utc().isoformat()}


@router.get("/gallery", response_model=FaceGallery, summary="دریافت گالری چهره‌ها")
def gallery(device: CurrentDevice, db: DbSession) -> FaceGallery:
    return face_service.build_gallery(db)


@router.get("/gallery/version", summary="بررسی تغییر گالری بدون دانلود کامل")
def gallery_version(device: CurrentDevice, db: DbSession) -> dict:
    g = face_service.build_gallery(db)
    return {"version": g.version, "count": len(g.items), "generated_at": g.generated_at}


@router.post("/identify", response_model=KioskIdentifyResponse, summary="تطبیق چهره روی سرور")
def identify(payload: KioskIdentifyRequest, device: CurrentDevice, db: DbSession):
    """تطبیق سمت سرور — وقتی اینترنت وصل است می‌تواند جایگزین تطبیق محلی شود."""
    try:
        employee_id, dist = face_service.identify(db, payload.vector)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if employee_id is None:
        return KioskIdentifyResponse(
            matched=False,
            distance=None if dist == float("inf") else round(dist, 4),
            threshold=settings.FACE_MATCH_THRESHOLD,
            message="چهره شناسایی نشد. لطفاً دوباره تلاش کنید یا از کد پرسنلی استفاده کنید.",
        )

    emp = db.get(Employee, employee_id)
    if emp is None or not emp.is_active:
        return KioskIdentifyResponse(
            matched=False,
            threshold=settings.FACE_MATCH_THRESHOLD,
            message="پرسنل در سامانه فعال نیست",
        )

    suggested = attendance_service.suggest_kind(db, emp.id, now_utc())
    return KioskIdentifyResponse(
        matched=True,
        employee_id=emp.id,
        full_name=emp.full_name,
        personnel_code=emp.personnel_code,
        photo_path=emp.photo_path,
        distance=round(dist, 4),
        threshold=settings.FACE_MATCH_THRESHOLD,
        suggested_kind=suggested,
        message=f"{emp.full_name} خوش آمدید",
    )


@router.post("/punch", response_model=PunchResult, summary="ثبت یک تردد از تبلت")
def punch(payload: PunchIn, device: CurrentDevice, db: DbSession) -> PunchResult:
    emp = attendance_service.find_employee(
        db, employee_id=payload.employee_id, personnel_code=payload.personnel_code
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="پرسنل یافت نشد")
    if not emp.is_active:
        raise HTTPException(status_code=403, detail="این پرسنل در سامانه فعال نیست")

    snapshot_path = None
    if payload.snapshot_base64:
        snapshot_path = face_service.save_base64_image(
            payload.snapshot_base64, settings.SNAPSHOT_DIR, prefix=f"emp{emp.id}"
        )

    try:
        result = attendance_service.record_punch(
            db,
            employee=emp,
            kind=payload.kind,
            happened_at=payload.happened_at,
            method=payload.method or PunchMethod.FACE.value,
            device_id=device.id,
            confidence=payload.confidence,
            client_uuid=payload.client_uuid,
            created_offline=payload.created_offline,
            snapshot_path=snapshot_path,
            note=payload.note,
        )
    except attendance_service.PunchError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    device.last_sync_at = now_utc()
    db.commit()
    result.message = f"{emp.full_name} — {result.message}"
    return result


@router.post("/punch/pin", response_model=PunchResult, summary="ثبت تردد با کد پرسنلی و رمز")
def punch_with_pin(
    personnel_code: str, pin: str, device: CurrentDevice, db: DbSession, kind: str | None = None
) -> PunchResult:
    """راه پشتیبان وقتی دوربین یا تشخیص چهره در دسترس نیست."""
    emp = attendance_service.find_employee(db, personnel_code=personnel_code)
    if emp is None or not emp.is_active:
        raise HTTPException(status_code=404, detail="کد پرسنلی یافت نشد")
    if not emp.pin_hash or not verify_password(pin, emp.pin_hash):
        raise HTTPException(status_code=401, detail="رمز پشتیبان اشتباه است")

    try:
        result = attendance_service.record_punch(
            db,
            employee=emp,
            kind=kind,
            method=PunchMethod.PIN.value,
            device_id=device.id,
        )
    except attendance_service.PunchError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    db.commit()
    result.message = f"{emp.full_name} — {result.message}"
    return result


@router.post("/sync", response_model=PunchBatchResult, summary="ارسال دسته‌ای ترددهای آفلاین")
def sync(payload: PunchBatch, device: CurrentDevice, db: DbSession) -> PunchBatchResult:
    """بسته ترددهای ذخیره‌شده روی تبلت را دریافت و ثبت می‌کند.

    هر رکورد مستقل پردازش می‌شود؛ خطای یک رکورد باعث رد شدن کل بسته نمی‌شود.
    ارسال مجدد همان بسته هم بی‌خطر است چون `client_uuid` یکتاست.
    """
    results: list[PunchResult] = []
    created = duplicates = rejected = 0

    for item in payload.records:
        emp = attendance_service.find_employee(
            db, employee_id=item.employee_id, personnel_code=item.personnel_code
        )
        if emp is None or not emp.is_active:
            rejected += 1
            results.append(
                PunchResult(
                    client_uuid=item.client_uuid,
                    status="rejected",
                    message="پرسنل یافت نشد یا غیرفعال است",
                )
            )
            continue

        snapshot_path = None
        if item.snapshot_base64:
            snapshot_path = face_service.save_base64_image(
                item.snapshot_base64, settings.SNAPSHOT_DIR, prefix=f"emp{emp.id}"
            )

        try:
            res = attendance_service.record_punch(
                db,
                employee=emp,
                kind=item.kind,
                happened_at=item.happened_at,
                method=item.method or PunchMethod.FACE.value,
                device_id=device.id,
                confidence=item.confidence,
                client_uuid=item.client_uuid,
                created_offline=True,
                snapshot_path=snapshot_path,
                note=item.note,
            )
        except attendance_service.PunchError as exc:
            db.rollback()
            rejected += 1
            results.append(
                PunchResult(client_uuid=item.client_uuid, status="rejected", message=str(exc))
            )
            continue

        if res.status == "created":
            created += 1
        else:
            duplicates += 1
        results.append(res)

    device.last_sync_at = now_utc()
    device.app_version = payload.app_version or device.app_version
    # تبلت در ضربان بعدی تعداد واقعی باقی‌مانده را اعلام می‌کند
    device.pending_count = max(0, device.pending_count - created - duplicates)
    db.commit()

    return PunchBatchResult(
        created=created,
        duplicates=duplicates,
        rejected=rejected,
        results=results,
        server_time=now_utc(),
    )


@router.get("/employee/{personnel_code}/state", summary="وضعیت فعلی یک پرسنل (داخل/خارج)")
def employee_state(personnel_code: str, device: CurrentDevice, db: DbSession) -> dict:
    emp = db.execute(
        select(Employee).where(Employee.personnel_code == personnel_code.strip())
    ).scalar_one_or_none()
    if emp is None:
        raise HTTPException(status_code=404, detail="پرسنل یافت نشد")
    inside = attendance_service.is_inside(db, emp.id)
    return {
        "employee_id": emp.id,
        "full_name": emp.full_name,
        "personnel_code": emp.personnel_code,
        "is_inside": inside,
        "suggested_kind": "out" if inside else "in",
        "suggested_kind_fa": "خروج" if inside else "ورود",
    }
