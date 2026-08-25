from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean, Date, DateTime, Float, ForeignKey, Index, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class AttendanceRecord(Base, TimestampMixin):
    """یک تردد (ورود یا خروج).

    `client_uuid` کلید یکتاسازی برای همگام‌سازی آفلاین است: تبلت هنگام ثبت آفلاین
    یک UUID می‌سازد و اگر بسته چند بار ارسال شود، رکورد تکراری ایجاد نمی‌شود.
    """

    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("client_uuid", name="uq_attendance_client_uuid"),
        Index("ix_attendance_emp_day", "employee_id", "work_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), index=True, nullable=False
    )
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(8), nullable=False)          # in | out
    method: Mapped[str] = mapped_column(String(16), default="face", nullable=False)
    # زمان واقعی رخداد (UTC) — روی تبلت ثبت می‌شود، نه زمان رسیدن به سرور
    happened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    # تاریخ روز کاری به وقت تهران (برای گروه‌بندی سریع گزارش)
    work_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float)              # اطمینان تشخیص چهره
    snapshot_path: Mapped[str | None] = mapped_column(String(255))
    client_uuid: Mapped[str | None] = mapped_column(String(64), index=True)
    created_offline: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(Text)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    employee = relationship("Employee", back_populates="punches")
    device = relationship("Device", back_populates="punches")
