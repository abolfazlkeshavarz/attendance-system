from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import DeviceKind


class Device(Base, TimestampMixin):
    """تبلت/دستگاه نصب‌شده در ورودی کارخانه."""

    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)          # مثلاً «درب اصلی»
    kind: Mapped[str] = mapped_column(String(16), default=DeviceKind.TABLET.value, nullable=False)
    device_uid: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    api_key_hash: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    location: Mapped[str | None] = mapped_column(String(255))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    app_version: Mapped[str | None] = mapped_column(String(32))
    pending_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Live "what is happening at this gate right now" — written by the ESP32
    # (scan-status pings) and by the fingerprint punch/enroll endpoints, read
    # by the browser kiosk so it can mirror the face-kiosk experience. Purely
    # ephemeral (see kiosk_status_service.TTL_SECONDS); all nullable so
    # Base.metadata.create_all works on a fresh DB. Existing deployments need
    # a one-time ALTER TABLE (see kiosk_status_service docstring).
    last_scan_phase: Mapped[str | None] = mapped_column(String(24))
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_scan_employee_id: Mapped[int | None] = mapped_column(Integer)
    last_scan_kind: Mapped[str | None] = mapped_column(String(4))
    last_scan_message: Mapped[str | None] = mapped_column(String(255))
    last_scan_confidence: Mapped[int | None] = mapped_column(Integer)

    punches = relationship("AttendanceRecord", back_populates="device")
    fingerprint_slots = relationship(
        "FingerprintSlot", back_populates="device", cascade="all, delete-orphan"
    )
