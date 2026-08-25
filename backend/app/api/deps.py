"""وابستگی‌های مشترک مسیرها: احراز هویت کاربر پنل و دستگاه تبلت."""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.jalali import now_utc
from app.core.security import decode_token, hash_api_key
from app.db.session import get_db
from app.models.device import Device
from app.models.enums import UserRole
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def _unauthorized(detail: str = "احراز هویت انجام نشد") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    db: DbSession,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
) -> User:
    if creds is None or not creds.credentials:
        raise _unauthorized("توکن ارسال نشده است")
    payload = decode_token(creds.credentials)
    if payload is None or payload.get("type") != "access":
        raise _unauthorized("توکن نامعتبر یا منقضی شده است")
    user = db.get(User, int(payload.get("sub", 0)))
    if user is None or not user.is_active:
        raise _unauthorized("کاربر یافت نشد یا غیرفعال است")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: UserRole):
    """وابستگی‌ای می‌سازد که فقط نقش‌های مشخص‌شده را عبور می‌دهد.

    عمداً از «تابعِ تابع‌ساز» استفاده شده و نه کلاسِ قابل‌فراخوانی: به‌خاطر
    `from __future__ import annotations` همه annotationها رشته‌اند و FastAPI برای
    حل آن‌ها به `__globals__` نیاز دارد که فقط روی تابع وجود دارد، نه روی نمونه کلاس.
    """
    allowed = {r.value for r in roles}

    def dependency(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="برای این عملیات دسترسی لازم را ندارید",
            )
        return user

    return dependency


require_admin = require_roles(UserRole.ADMIN)
require_manager = require_roles(UserRole.ADMIN, UserRole.MANAGER)
require_any = require_roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER)

AdminUser = Annotated[User, Depends(require_admin)]
ManagerUser = Annotated[User, Depends(require_manager)]
AnyUser = Annotated[User, Depends(require_any)]


def get_current_device(
    db: DbSession,
    x_device_key: Annotated[str | None, Header(alias="X-Device-Key")] = None,
) -> Device:
    """احراز هویت تبلت با کلید اختصاصی دستگاه."""
    if not x_device_key:
        raise _unauthorized("کلید دستگاه ارسال نشده است")
    device = db.execute(
        select(Device).where(Device.api_key_hash == hash_api_key(x_device_key))
    ).scalar_one_or_none()
    if device is None or not device.is_active:
        raise _unauthorized("دستگاه ثبت نشده یا غیرفعال است")
    device.last_seen_at = now_utc()
    db.commit()
    return device


CurrentDevice = Annotated[Device, Depends(get_current_device)]


def get_optional_device(
    db: DbSession,
    x_device_key: Annotated[str | None, Header(alias="X-Device-Key")] = None,
) -> Device | None:
    if not x_device_key:
        return None
    return db.execute(
        select(Device).where(Device.api_key_hash == hash_api_key(x_device_key))
    ).scalar_one_or_none()


OptionalDevice = Annotated[Device | None, Depends(get_optional_device)]
