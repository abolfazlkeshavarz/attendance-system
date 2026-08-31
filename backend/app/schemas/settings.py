from __future__ import annotations

from pydantic import BaseModel

from app.schemas.common import ORMModel


class AuthMethodsOut(ORMModel):
    face_enabled: bool
    fingerprint_enabled: bool
    pin_enabled: bool


class AuthMethodsUpdate(BaseModel):
    face_enabled: bool | None = None
    fingerprint_enabled: bool | None = None
    pin_enabled: bool | None = None
