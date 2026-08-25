from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import LeaveStatus, LeaveType


class LeaveRequest(Base, TimestampMixin):
    """مرخصی / مأموریت. بازه با زمان دقیق ذخیره می‌شود تا مرخصی ساعتی هم پوشش داده شود."""

    __tablename__ = "leave_requests"
    __table_args__ = (Index("ix_leave_emp_range", "employee_id", "start_at", "end_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), index=True, nullable=False
    )
    leave_type: Mapped[str] = mapped_column(String(16), default=LeaveType.DAILY.value, nullable=False)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default=LeaveStatus.PENDING.value, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    review_note: Mapped[str | None] = mapped_column(Text)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    employee = relationship("Employee", back_populates="leaves")
