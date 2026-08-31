"""تنظیمات سراسری — فعلاً فقط روش‌های مجاز تأیید هویت."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.api.deps import AdminUser, AnyUser, DbSession
from app.schemas.settings import AuthMethodsOut, AuthMethodsUpdate
from app.services import settings_service

router = APIRouter()


@router.get("/auth-methods", response_model=AuthMethodsOut, summary="روش‌های مجاز تأیید هویت تردد")
def get_auth_methods(db: DbSession, _: AnyUser) -> AuthMethodsOut:
    return AuthMethodsOut.model_validate(settings_service.get_auth_methods(db))


@router.patch("/auth-methods", response_model=AuthMethodsOut, summary="تغییر روش‌های مجاز تأیید هویت")
def update_auth_methods(payload: AuthMethodsUpdate, db: DbSession, _: AdminUser) -> AuthMethodsOut:
    try:
        row = settings_service.update_auth_methods(db, **payload.model_dump(exclude_unset=True))
    except settings_service.SettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AuthMethodsOut.model_validate(row)
