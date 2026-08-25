from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field, computed_field, field_validator

from app.core.jalali import jalali_str, normalize_digits, parse_jalali
from app.schemas.common import ORMModel


def _valid_national_code(code: str) -> bool:
    """اعتبارسنجی کد ملی ایرانی (رقم کنترل)."""
    code = normalize_digits(code)
    if not code.isdigit() or len(code) != 10 or len(set(code)) == 1:
        return False
    checksum = sum(int(code[i]) * (10 - i) for i in range(9)) % 11
    control = int(code[9])
    return control == checksum if checksum < 2 else control == 11 - checksum


class EmployeeBase(BaseModel):
    personnel_code: str = Field(min_length=1, max_length=32)
    first_name: str = Field(min_length=1, max_length=64)
    last_name: str = Field(min_length=1, max_length=64)
    national_code: str | None = None
    mobile: str | None = None
    position: str | None = None
    department_id: int | None = None
    shift_id: int | None = None
    notes: str | None = None
    is_active: bool = True

    @field_validator("national_code")
    @classmethod
    def _nc(cls, v: str | None) -> str | None:
        if not v:
            return None
        v = normalize_digits(v).strip()
        if not _valid_national_code(v):
            raise ValueError("کد ملی وارد شده معتبر نیست")
        return v

    @field_validator("mobile")
    @classmethod
    def _mobile(cls, v: str | None) -> str | None:
        if not v:
            return None
        v = normalize_digits(v).strip().replace(" ", "")
        if not v.startswith("09") or len(v) != 11 or not v.isdigit():
            raise ValueError("شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود")
        return v

    @field_validator("personnel_code")
    @classmethod
    def _pc(cls, v: str) -> str:
        return normalize_digits(v).strip()


class EmployeeCreate(EmployeeBase):
    hire_jalali_date: str | None = None
    pin: str | None = Field(None, min_length=4, max_length=8)

    @field_validator("hire_jalali_date")
    @classmethod
    def _hd(cls, v: str | None) -> str | None:
        if v:
            parse_jalali(v)
        return v

    @property
    def hire_date(self) -> date | None:
        return parse_jalali(self.hire_jalali_date) if self.hire_jalali_date else None


class EmployeeUpdate(BaseModel):
    personnel_code: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    national_code: str | None = None
    mobile: str | None = None
    position: str | None = None
    department_id: int | None = None
    shift_id: int | None = None
    hire_jalali_date: str | None = None
    notes: str | None = None
    pin: str | None = None
    is_active: bool | None = None


class EmployeeOut(ORMModel):
    id: int
    personnel_code: str
    first_name: str
    last_name: str
    national_code: str | None = None
    mobile: str | None = None
    position: str | None = None
    department_id: int | None = None
    shift_id: int | None = None
    hire_date: date | None = None
    photo_path: str | None = None
    notes: str | None = None
    is_active: bool
    department_name: str | None = None
    shift_name: str | None = None
    face_count: int = 0
    has_pin: bool = False

    @computed_field  # type: ignore[prop-decorator]
    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @computed_field  # type: ignore[prop-decorator]
    @property
    def hire_jalali_date(self) -> str:
        return jalali_str(self.hire_date)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def face_enrolled(self) -> bool:
        return self.face_count > 0


class FaceEnrollRequest(BaseModel):
    """بردار چهره که مرورگر تبلت/پنل استخراج کرده است."""

    vector: list[float] = Field(min_length=32, max_length=4096)
    model_name: str = "face-api-128"
    quality: float | None = None
    image_base64: str | None = None      # اختیاری: تصویر نمونه برای بایگانی


class FaceOut(ORMModel):
    id: int
    employee_id: int
    dim: int
    model_name: str
    quality: float | None = None
    image_path: str | None = None
    is_active: bool


class FaceGalleryItem(BaseModel):
    """رکوردی که تبلت برای تشخیص آفلاین دانلود می‌کند."""

    employee_id: int
    personnel_code: str
    full_name: str
    department_name: str | None = None
    photo_path: str | None = None
    vectors: list[list[float]]


class FaceGallery(BaseModel):
    model_name: str
    dim: int
    threshold: float
    version: str          # برای تشخیص تغییر و دانلود مجدد در تبلت
    generated_at: str
    items: list[FaceGalleryItem]
