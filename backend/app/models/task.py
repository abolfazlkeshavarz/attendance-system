from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import TaskPriority, TaskRecurrence, TaskStatus


class Task(Base, TimestampMixin):
    """وظیفه یا شرح وظایف پرسنل.

    دو کاربرد دارد:
      * وظیفه یک‌باره (recurrence = none) با تاریخ سررسید.
      * شرح وظیفه تکرارشونده (روزانه/هفتگی/ماهانه) که برای هر دوره یک
        رکورد `TaskLog` ثبت می‌شود.
    """

    __tablename__ = "tasks"
    __table_args__ = (Index("ix_task_emp_status", "employee_id", "status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), index=True
    )
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    assigned_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(16), default=TaskStatus.TODO.value, nullable=False)
    priority: Mapped[str] = mapped_column(String(16), default=TaskPriority.NORMAL.value, nullable=False)
    recurrence: Mapped[str] = mapped_column(String(16), default=TaskRecurrence.NONE.value, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, index=True)
    start_date: Mapped[date | None] = mapped_column(Date)      # شروع وظیفه تکرارشونده
    end_date: Mapped[date | None] = mapped_column(Date)        # پایان وظیفه تکرارشونده
    estimated_minutes: Mapped[int | None] = mapped_column(Integer)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)   # ۰ تا ۱۰۰
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    employee = relationship("Employee", back_populates="tasks")
    logs = relationship("TaskLog", back_populates="task", cascade="all, delete-orphan")


class TaskLog(Base, TimestampMixin):
    """اجرای یک وظیفه در یک روز مشخص (برای وظایف تکرارشونده و گزارش روزانه)."""

    __tablename__ = "task_logs"
    __table_args__ = (UniqueConstraint("task_id", "log_date", name="uq_tasklog_task_day"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    log_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default=TaskStatus.DONE.value, nullable=False)
    spent_minutes: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text)
    recorded_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    task = relationship("Task", back_populates="logs")
