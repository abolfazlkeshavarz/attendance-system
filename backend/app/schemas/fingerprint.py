from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel

# phases the ESP32 reports directly; the rest ("matched", "success",
# "enroll_success", "enroll_error", "idle") are set server-side from the
# punch / enroll endpoints.
ScanStatusPhaseIn = Literal["scanning", "error", "enroll_scanning"]


class FingerprintEnrollStart(BaseModel):
    """درخواست مدیر برای ثبت‌نام اثر انگشت یک پرسنل روی یک دستگاه مشخص."""

    employee_id: int
    device_id: int


class FingerprintEnrollJobOut(ORMModel):
    id: int
    employee_id: int
    device_id: int
    status: str
    error_message: str | None = None
    created_at: datetime
    completed_at: datetime | None = None
    employee_name: str | None = None
    device_name: str | None = None


class PendingEnrollOut(BaseModel):
    """پاسخ به poll دستگاه — اگر کاری در انتظار نباشد job برابر None است."""

    job: FingerprintEnrollJobOut | None = None


class FingerprintEnrollComplete(BaseModel):
    """دستگاه بعد از دو بار اسکن و `UpChar` موفق، قالب خام را برمی‌گرداند."""

    job_id: int
    slot_id: int = Field(ge=0)
    template_base64: str
    model_name: str = Field(max_length=32)


class FingerprintEnrollFail(BaseModel):
    job_id: int
    error: str = Field(max_length=500)


class FingerprintSyncRequest(BaseModel):
    """دستگاه مدل سنسور خودش را اعلام می‌کند تا فقط قالب‌های سازگار فرستاده شود."""

    model_name: str = Field(max_length=32)


class FingerprintSyncItem(BaseModel):
    employee_id: int
    full_name: str
    template_base64: str


class FingerprintSyncResponse(BaseModel):
    to_add: list[FingerprintSyncItem] = Field(default_factory=list)
    to_remove: list[int] = Field(default_factory=list, description="employee_id هایی که باید از سنسور پاک شوند")


class FingerprintSyncSlot(BaseModel):
    employee_id: int
    slot_id: int = Field(ge=0)


class FingerprintSyncConfirm(BaseModel):
    """دستگاه بعد از نوشتن/پاک‌کردن روی فلش سنسور، نتیجه را تأیید می‌کند."""

    added: list[FingerprintSyncSlot] = Field(default_factory=list)
    removed_employee_ids: list[int] = Field(default_factory=list)


class FingerprintPunchRequest(BaseModel):
    """نتیجه‌ی تطبیق محلی سنسور (fingerFastSearch).

    `happened_at`/`client_uuid`/`created_offline` عمداً مثل `PunchIn` تبلت‌اند:
    وقتی ماژول ESP32 آفلاین است، تردد را با زمان واقعی ثبت و در حافظه صف
    می‌کند؛ `client_uuid` باعث می‌شود ارسال دوباره‌ی همان تردد پس از اتصال
    مجدد (retry) رکورد تکراری نسازد.
    """

    slot_id: int = Field(ge=0)
    kind: str | None = None
    confidence: float | None = None
    happened_at: datetime | None = None
    client_uuid: str | None = None
    created_offline: bool = False


class FingerprintScanStatusIn(BaseModel):
    """پینگ ماژول ESP32 هنگام قرار گرفتن انگشت روی حسگر — فقط برای نمایش زندهٔ کیوسک."""

    phase: ScanStatusPhaseIn


class FingerprintScanStatusOut(BaseModel):
    """وضعیت لحظه‌ای دستگاه اثر انگشت برای صفحهٔ کیوسک."""

    phase: str  # idle | scanning | matched | success | error | enroll_scanning | enroll_success | enroll_error
    employee_name: str | None = None
    kind: str | None = None
    message: str | None = None
    confidence: int | None = None
    device_name: str | None = None
    at: datetime | None = None
    server_clock: str
    today_jalali: str
