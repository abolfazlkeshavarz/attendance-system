from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field, computed_field, field_validator

from app.core.jalali import jalali_str, parse_jalali, to_tehran, today_tehran
from app.models.enums import fa
from app.schemas.common import ORMModel


class TaskBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    employee_id: int | None = None
    department_id: int | None = None
    priority: str = "normal"
    recurrence: str = "none"
    estimated_minutes: int | None = Field(None, ge=0, le=10000)


class TaskCreate(TaskBase):
    due_jalali_date: str | None = None
    start_jalali_date: str | None = None
    end_jalali_date: str | None = None

    @field_validator("due_jalali_date", "start_jalali_date", "end_jalali_date")
    @classmethod
    def _dates(cls, v: str | None) -> str | None:
        if v:
            parse_jalali(v)
        return v

    def gregorian(self, field: str) -> date | None:
        raw = getattr(self, field)
        return parse_jalali(raw) if raw else None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    employee_id: int | None = None
    department_id: int | None = None
    status: str | None = None
    priority: str | None = None
    recurrence: str | None = None
    progress: int | None = Field(None, ge=0, le=100)
    estimated_minutes: int | None = None
    due_jalali_date: str | None = None
    start_jalali_date: str | None = None
    end_jalali_date: str | None = None
    is_active: bool | None = None


class TaskOut(ORMModel):
    id: int
    title: str
    description: str | None = None
    employee_id: int | None = None
    department_id: int | None = None
    status: str
    priority: str
    recurrence: str
    due_date: date | None = None
    start_date: date | None = None
    end_date: date | None = None
    estimated_minutes: int | None = None
    progress: int
    completed_at: datetime | None = None
    is_active: bool
    employee_name: str | None = None
    department_name: str | None = None
    done_today: bool = False

    @computed_field  # type: ignore[prop-decorator]
    @property
    def status_fa(self) -> str:
        return fa(self.status)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def priority_fa(self) -> str:
        return fa(self.priority)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def recurrence_fa(self) -> str:
        return fa(self.recurrence)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def due_jalali_date(self) -> str:
        return jalali_str(self.due_date)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_overdue(self) -> bool:
        return bool(
            self.due_date
            and self.status in ("todo", "in_progress")
            and self.due_date < today_tehran()
        )


class TaskLogCreate(BaseModel):
    task_id: int
    jalali_date: str | None = None
    status: str = "done"
    spent_minutes: int | None = Field(None, ge=0, le=1440)
    note: str | None = None


class TaskLogOut(ORMModel):
    id: int
    task_id: int
    log_date: date
    status: str
    spent_minutes: int | None = None
    note: str | None = None
    task_title: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def jalali_date(self) -> str:
        return jalali_str(self.log_date)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def status_fa(self) -> str:
        return fa(self.status)


class LeaveCreate(BaseModel):
    employee_id: int
    leave_type: str = "daily"
    start_jalali_date: str
    end_jalali_date: str
    start_clock: str | None = None
    end_clock: str | None = None
    reason: str | None = None


class LeaveUpdate(BaseModel):
    status: str | None = None
    review_note: str | None = None
    leave_type: str | None = None
    reason: str | None = None


class LeaveOut(ORMModel):
    id: int
    employee_id: int
    leave_type: str
    start_at: datetime
    end_at: datetime
    status: str
    reason: str | None = None
    review_note: str | None = None
    reviewed_at: datetime | None = None
    employee_name: str | None = None
    personnel_code: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def leave_type_fa(self) -> str:
        return fa(self.leave_type)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def status_fa(self) -> str:
        return fa(self.status)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def start_jalali(self) -> str:
        return jalali_str(to_tehran(self.start_at).date())

    @computed_field  # type: ignore[prop-decorator]
    @property
    def end_jalali(self) -> str:
        return jalali_str(to_tehran(self.end_at).date())
