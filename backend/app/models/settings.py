from __future__ import annotations

from sqlalchemy import Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class SystemSettings(Base, TimestampMixin):
    """تنظیمات سراسری سامانه — تک‌ردیفی، همیشه با id=1.

    فعلاً فقط روش‌های مجاز تأیید هویت هنگام ثبت تردد را نگه می‌دارد: مدیر
    می‌تواند هر ترکیبی از چهره/اثر انگشت/کد پرسنلی را فعال کند، به شرط اینکه
    حداقل یکی روشن بماند (وگرنه هیچ‌کس نمی‌تواند تردد ثبت کند).
    """

    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    face_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    fingerprint_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    pin_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
