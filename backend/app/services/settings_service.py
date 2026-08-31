"""تنظیمات سراسری سامانه (تک‌ردیفی)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.settings import SystemSettings


class SettingsError(Exception):
    """خطای قابل نمایش به کاربر."""


def get_auth_methods(db: Session) -> SystemSettings:
    row = db.get(SystemSettings, 1)
    if row is None:
        row = SystemSettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def update_auth_methods(
    db: Session,
    *,
    face_enabled: bool | None = None,
    fingerprint_enabled: bool | None = None,
    pin_enabled: bool | None = None,
) -> SystemSettings:
    row = get_auth_methods(db)
    face = row.face_enabled if face_enabled is None else face_enabled
    fingerprint = row.fingerprint_enabled if fingerprint_enabled is None else fingerprint_enabled
    pin = row.pin_enabled if pin_enabled is None else pin_enabled
    if not (face or fingerprint or pin):
        raise SettingsError("حداقل یک روش تأیید هویت باید فعال باشد")

    row.face_enabled = face
    row.fingerprint_enabled = fingerprint
    row.pin_enabled = pin
    db.commit()
    db.refresh(row)
    return row
