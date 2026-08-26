"""هش رمز عبور و صدور/اعتبارسنجی توکن JWT.

از PBKDF2-HMAC-SHA256 کتابخانه استاندارد پایتون استفاده می‌شود تا وابستگی
باینری (bcrypt/argon2) نداشته باشیم و روی هر نسخه پایتون بدون مشکل کامپایل شود.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from app.core.config import settings

_ITERATIONS = 260_000
_ALGO = "pbkdf2_sha256"


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _ITERATIONS)
    return f"{_ALGO}${_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt, digest = stored.split("$")
        if algo != _ALGO:
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iterations))
        return hmac.compare_digest(dk.hex(), digest)
    except (ValueError, AttributeError):
        return False


def hash_api_key(raw_key: str) -> str:
    """کلید دستگاه‌ها — بدون salt تا بتوان با یک کوئری جست‌وجو کرد."""
    return hashlib.sha256((raw_key + settings.SECRET_KEY).encode()).hexdigest()


def generate_api_key() -> str:
    return secrets.token_urlsafe(32)


def _create_token(subject: str, expires_delta: timedelta, token_type: str, **extra: Any) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int((now + expires_delta).timestamp()),
        "type": token_type,
        **extra,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_access_token(user_id: int, role: str) -> str:
    return _create_token(
        str(user_id),
        timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        "access",
        role=role,
    )


def create_refresh_token(user_id: int) -> str:
    return _create_token(
        str(user_id), timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS), "refresh"
    )


def create_media_token(user_id: int) -> str:
    """توکن محدود برای دیدن تصاویر چهره و عکس ترددها.

    تگ `<img>` نمی‌تواند هدر Authorization بفرستد، پس این توکن در یک کوکی
    HttpOnly گذاشته می‌شود. عمداً از توکن اصلی جداست تا اگر لو رفت، فقط اجازه
    دیدن تصویر بدهد و نه کار با API.
    """
    return _create_token(
        str(user_id), timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES), "media"
    )


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError:
        return None
