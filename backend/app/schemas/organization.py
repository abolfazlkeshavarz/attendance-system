from __future__ import annotations

from datetime import date, time

from pydantic import BaseModel, Field, computed_field, field_validator

from app.core.jalali import jalali_str, parse_jalali
from app.schemas.common import ORMModel


class DepartmentBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None
    is_active: bool = True


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_active: bool | None = None


class DepartmentOut(ORMModel, DepartmentBase):
    id: int
    employee_count: int = 0


class ShiftBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    start_time: time
    end_time: time
    crosses_midnight: bool = False
    grace_in_minutes: int = Field(10, ge=0, le=240)
    grace_out_minutes: int = Field(10, ge=0, le=240)
    work_days: str = "0,1,2,3,4,5"
    break_minutes: int = Field(0, ge=0, le=480)
    is_active: bool = True

    @field_validator("work_days")
    @classmethod
    def _validate_days(cls, v: str) -> str:
        days = sorted({int(x) for x in v.split(",") if x.strip().isdigit()})
        if not days or any(d < 0 or d > 6 for d in days):
            raise ValueError("روزهای کاری باید عددی بین ۰ (شنبه) تا ۶ (جمعه) باشند")
        return ",".join(str(d) for d in days)


class ShiftCreate(ShiftBase):
    pass


class ShiftUpdate(BaseModel):
    name: str | None = None
    start_time: time | None = None
    end_time: time | None = None
    crosses_midnight: bool | None = None
    grace_in_minutes: int | None = None
    grace_out_minutes: int | None = None
    work_days: str | None = None
    break_minutes: int | None = None
    is_active: bool | None = None


class ShiftOut(ORMModel, ShiftBase):
    id: int
    expected_minutes: int = 0


class HolidayCreate(BaseModel):
    jalali_date: str = Field(description="نمونه: 1403/01/01")
    title: str = Field(min_length=1, max_length=255)
    is_official: bool = True

    @field_validator("jalali_date")
    @classmethod
    def _check(cls, v: str) -> str:
        parse_jalali(v)
        return v

    @property
    def day(self) -> date:
        return parse_jalali(self.jalali_date)


class HolidayOut(ORMModel):
    id: int
    day: date
    title: str
    is_official: bool

    @computed_field  # type: ignore[prop-decorator]
    @property
    def jalali_date(self) -> str:
        return jalali_str(self.day)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def jalali_long(self) -> str:
        from app.core.jalali import jalali_long as _jl

        return _jl(self.day)
