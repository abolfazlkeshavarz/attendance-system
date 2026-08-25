from __future__ import annotations

from datetime import date, datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from app.core.jalali import fmt_time, jalali_long, jalali_str, to_tehran

T = TypeVar("T")


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int

    @property
    def pages(self) -> int:
        return max(1, -(-self.total // self.page_size))


class PageParams(BaseModel):
    page: int = Field(1, ge=1)
    page_size: int = Field(25, ge=1, le=500)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


class Message(BaseModel):
    detail: str


def jdate(d: date | None) -> str:
    return jalali_str(d) if d else ""


def jdatetime_parts(dt: datetime | None) -> dict[str, str]:
    if dt is None:
        return {"date": "", "time": "", "long": ""}
    local = to_tehran(dt)
    return {
        "date": jalali_str(local.date()),
        "time": fmt_time(dt),
        "long": jalali_long(local.date()),
    }
