from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Device(Base, TimestampMixin):
    """تبلت/دستگاه نصب‌شده در ورودی کارخانه."""

    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)          # مثلاً «درب اصلی»
    device_uid: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    api_key_hash: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    location: Mapped[str | None] = mapped_column(String(255))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    app_version: Mapped[str | None] = mapped_column(String(32))
    pending_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    punches = relationship("AttendanceRecord", back_populates="device")
