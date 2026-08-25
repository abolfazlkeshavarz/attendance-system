from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field, computed_field

from app.core.jalali import fmt_time, jalali_str
from app.models.enums import fa
from app.schemas.common import ORMModel


class PunchIn(BaseModel):
    """ثبت تردد از سمت تبلت (آنلاین یا در بسته همگام‌سازی)."""

    employee_id: int | None = None
    personnel_code: str | None = None
    kind: str | None = Field(None, description="in یا out؛ خالی = تشخیص خودکار")
    method: str = "face"
    happened_at: datetime | None = None
    confidence: float | None = None
    client_uuid: str | None = None
    created_offline: bool = False
    snapshot_base64: str | None = None
    note: str | None = None


class PunchBatch(BaseModel):
    """بسته ترددهای ذخیره‌شده روی تبلت در زمان قطعی اینترنت."""

    device_uid: str | None = None
    app_version: str | None = None
    records: list[PunchIn] = Field(default_factory=list, max_length=1000)


class PunchResult(BaseModel):
    client_uuid: str | None = None
    status: str
    record_id: int | None = None
    kind: str | None = None
    message: str = ""


class PunchBatchResult(BaseModel):
    created: int
    duplicates: int
    rejected: int
    results: list[PunchResult]
    server_time: datetime


class AttendanceOut(ORMModel):
    id: int
    employee_id: int
    device_id: int | None = None
    kind: str
    method: str
    happened_at: datetime
    work_date: date
    confidence: float | None = None
    snapshot_path: str | None = None
    created_offline: bool
    note: str | None = None
    employee_name: str | None = None
    personnel_code: str | None = None
    device_name: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def kind_fa(self) -> str:
        return fa(self.kind)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def method_fa(self) -> str:
        return fa(self.method)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def jalali_date(self) -> str:
        return jalali_str(self.work_date)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def clock(self) -> str:
        return fmt_time(self.happened_at)


class ManualPunch(BaseModel):
    employee_id: int
    kind: str
    jalali_date: str
    clock: str = Field(description="ساعت به قالب HH:MM")
    note: str | None = None


class AttendanceUpdate(BaseModel):
    kind: str | None = None
    jalali_date: str | None = None
    clock: str | None = None
    note: str | None = None


class KioskIdentifyRequest(BaseModel):
    """در حالت آنلاین، تبلت می‌تواند تطبیق را به سرور بسپارد."""

    vector: list[float] = Field(min_length=32, max_length=4096)
    device_uid: str | None = None


class KioskIdentifyResponse(BaseModel):
    matched: bool
    employee_id: int | None = None
    full_name: str | None = None
    personnel_code: str | None = None
    photo_path: str | None = None
    distance: float | None = None
    threshold: float
    suggested_kind: str | None = None
    message: str


class TodayStatus(BaseModel):
    employee_id: int
    full_name: str
    personnel_code: str
    photo_path: str | None = None
    department_name: str | None = None
    first_in: str = ""
    last_out: str = ""
    is_inside: bool = False
    worked_minutes: int = 0
    late_minutes: int = 0
    status: str = "absent"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def status_fa(self) -> str:
        return fa(self.status)


class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    location: str | None = None


class DeviceOut(ORMModel):
    id: int
    name: str
    device_uid: str
    location: str | None = None
    last_seen_at: datetime | None = None
    last_sync_at: datetime | None = None
    app_version: str | None = None
    pending_count: int
    is_active: bool


class DeviceWithKey(DeviceOut):
    api_key: str
