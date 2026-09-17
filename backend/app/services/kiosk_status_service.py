"""وضعیت لحظه‌ای دستگاه اثر انگشت برای صفحهٔ کیوسک.

تطبیق اثر انگشت روی خودِ ماژول ESP32 انجام می‌شود، پس مرورگرِ کیوسک به‌تنهایی
نمی‌داند چه زمانی کسی انگشتش را روی حسگر گذاشته. این ماژول یک «آخرین رویداد» را
روی ردیف `Device` نگه می‌دارد:

  * ماژول ESP32 با `POST /kiosk/fingerprint/scan-status` مرحلهٔ گذرا
    (`scanning` / `error` / `enroll_scanning`) را اعلام می‌کند.
  * خودِ endpoint های `punch` و `enroll` نتیجهٔ نهایی را می‌نویسند.
  * کیوسک هر ~۱ ثانیه `GET /kiosk/fingerprint/status` را صدا می‌زند.

چرا روی `Device` و نه در حافظه: بک‌اند با `uvicorn --workers 2` اجرا می‌شود؛ یک
دیکشنری در حافظهٔ یک worker برای worker دیگر دیده نمی‌شود. ستون‌ها همه nullable
هستند — هم برای اینکه `Base.metadata.create_all` روی دیتابیس تازه کار کند، و
هم چون `app.main._add_missing_columns` این ستون‌ها را روی دیتابیس‌های موجود هم
در همان اولین بالا آمدن خودکار اضافه می‌کند (دیگر نیازی به ALTER TABLE دستی
نیست).

توجه: `record()` عمداً هیچ خطایی را بالا نمی‌برد — این فقط یک آینهٔ نمایشی برای
کیوسک است؛ نباید بتواند خودِ ثبتِ تردد/ثبت‌نام را که فراخوانی‌اش می‌کند خراب کند.
به همین دلیل مسیرهایی که به این تابع commit می‌سپارند (مثل punch در
fingerprint.py) باید کار اصلی‌شان را قبل از این تابع، جدا، commit کرده باشند.
"""
from __future__ import annotations

import logging
from datetime import timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.jalali import fmt_time, jalali_long, now_utc, to_tehran
from app.models.device import Device
from app.models.employee import Employee
from app.models.enums import DeviceKind

logger = logging.getLogger("attendance")

# پس از این مدت، آخرین رویداد «کهنه» است و کیوسک باید به حالت idle برگردد.
TTL_SECONDS = 12


def record(
    db: Session,
    device: Device,
    *,
    phase: str,
    employee: Employee | None = None,
    kind: str | None = None,
    message: str | None = None,
    confidence: float | int | None = None,
) -> None:
    try:
        device.last_scan_phase = phase
        device.last_scan_at = now_utc()
        device.last_scan_employee_id = employee.id if employee is not None else None
        device.last_scan_kind = kind
        device.last_scan_message = (message or None) and message[:255]
        device.last_scan_confidence = None if confidence is None else int(round(confidence))
        db.commit()
    except Exception:
        # کیوسک فقط چند ثانیه بعد به idle برمی‌گردد و دوباره تلاش می‌کند — قابل
        # قبول است. آنچه قابل قبول نیست این است که خرابی همین آینه، ثبتِ خودِ
        # تردد یا ثبت‌نام را (که caller در همان session/تراکنش انجام داده) پاک
        # کند؛ rollback هم فقط همین commit ناموفق را برمی‌گرداند چون caller باید
        # کار خودش را قبلاً commit کرده باشد.
        db.rollback()
        logger.exception("kiosk_status_service.record failed for device %s", device.id)


def _kiosk_time() -> dict:
    now = now_utc()
    return {"server_clock": fmt_time(now), "today_jalali": jalali_long(to_tehran(now).date())}


def latest_fingerprint(db: Session) -> dict:
    """جدیدترین رویداد در بین دستگاه‌های اثر انگشت فعال.

    کیوسک یک صفحه است ولی ممکن است چند درب اثر انگشت وجود داشته باشد؛ آخرین
    رویداد در بین همه را نشان می‌دهیم.
    """
    idle = {
        "phase": "idle",
        "employee_name": None,
        "kind": None,
        "message": None,
        "confidence": None,
        "device_name": None,
        "at": None,
        **_kiosk_time(),
    }

    device = db.execute(
        select(Device)
        .where(
            Device.is_active.is_(True),
            Device.kind == DeviceKind.FINGERPRINT.value,
            Device.last_scan_at.is_not(None),
        )
        .order_by(Device.last_scan_at.desc())
        .limit(1)
    ).scalar_one_or_none()

    if device is None or device.last_scan_at is None:
        return idle
    # SQLite hands back naive datetimes even for DateTime(timezone=True); make
    # it aware UTC so the JSON carries an offset and the browser doesn't parse
    # it as local time.
    last_at = device.last_scan_at
    if last_at.tzinfo is None:
        last_at = last_at.replace(tzinfo=timezone.utc)
    if now_utc() - last_at > timedelta(seconds=TTL_SECONDS):
        return idle

    employee_name = None
    if device.last_scan_employee_id is not None:
        emp = db.get(Employee, device.last_scan_employee_id)
        employee_name = emp.full_name if emp is not None else None

    return {
        "phase": device.last_scan_phase or "idle",
        "employee_name": employee_name,
        "kind": device.last_scan_kind,
        "message": device.last_scan_message,
        "confidence": device.last_scan_confidence,
        "device_name": device.name,
        "at": last_at,
        **_kiosk_time(),
    }
