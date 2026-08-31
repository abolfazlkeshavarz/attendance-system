"""ثبت‌نام و تطبیق اثر انگشت (ماژول UART روی ESP32).

معماری: تطبیق ۱:۱ روی خودِ سنسور انجام می‌شود (سریع و آفلاین)، ولی محل ذخیره
اصلیِ «قالب» (template) دیتابیس مرکزی است — نه فلش سنسور. این‌طور یک پرسنل
فقط یک‌بار (روی هر دستگاهی) ثبت‌نام می‌شود و سرور آن را به بقیه دستگاه‌ها هم
می‌فرستد (`FingerprintSlot.sync`)، چون شماره‌ی خانه‌ی حافظه (slot) روی هر سنسور
فیزیکی مستقل و غیرقابل‌انتقال است.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import FingerprintJobStatus


class FingerprintTemplate(Base, TimestampMixin):
    """قالب خام اثر انگشت یک پرسنل — منبع اصلی، مستقل از هر دستگاه خاص.

    فرمت `template_data` به مدل سنسور بستگی دارد (`model_name`)؛ فقط بین
    سنسورهایی با فریم‌ور یکسان قابل‌جابه‌جایی است، پس هنگام همگام‌سازی با یک
    دستگاه، تنها قالب‌های هم‌مدل با آن دستگاه فرستاده می‌شوند.
    """

    __tablename__ = "fingerprint_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), unique=True, index=True, nullable=False
    )
    template_data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    model_name: Mapped[str] = mapped_column(String(32), nullable=False)

    employee = relationship("Employee", back_populates="fingerprint_template")


class FingerprintSlot(Base, TimestampMixin):
    """نگاشت «این پرسنل روی این دستگاه در کدام خانه‌ی حافظه ذخیره شده».

    وقتی سنسور دستگاهی خالی/تعویض شود یا پرسنلی حذف شود، فقط همین ردیف حذف
    می‌شود؛ `FingerprintTemplate` مرکزی دست‌نخورده می‌ماند.
    """

    __tablename__ = "fingerprint_slots"
    __table_args__ = (
        UniqueConstraint("device_id", "slot_id", name="uq_fp_slot_device_slot"),
        UniqueConstraint("device_id", "employee_id", name="uq_fp_slot_device_employee"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[int] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), index=True, nullable=False
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), index=True, nullable=False
    )
    slot_id: Mapped[int] = mapped_column(Integer, nullable=False)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    device = relationship("Device", back_populates="fingerprint_slots")
    employee = relationship("Employee", back_populates="fingerprint_slots")


class FingerprintEnrollJob(Base, TimestampMixin):
    """درخواست ثبت‌نامِ در انتظار — دستگاه هدف آن را در heartbeat/poll بعدی برمی‌دارد."""

    __tablename__ = "fingerprint_enroll_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), index=True, nullable=False
    )
    device_id: Mapped[int] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), index=True, nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(16), default=FingerprintJobStatus.PENDING.value, nullable=False
    )
    error_message: Mapped[str | None] = mapped_column(Text)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    employee = relationship("Employee")
    device = relationship("Device")
