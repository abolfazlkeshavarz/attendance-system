"""محدودسازی ساده تلاش‌های ورود/رمز پشتیبان در برابر حدس زدن.

عمداً در حافظه (بدون Redis) پیاده شده چون این سامانه تک‌سرور است. با چند
worker همزمان uvicorn به‌صورت سراسری هماهنگ نیست (هر worker شمارنده خودش را
دارد)، ولی همچنان جلوی اسکریپت‌های ساده brute-force را می‌گیرد. اگر سرور
ری‌استارت شود شمارنده‌ها پاک می‌شوند — قابل قبول برای این کاربرد.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from threading import Lock

from fastapi import HTTPException, status

_MAX_ATTEMPTS = 5
_WINDOW_SECONDS = 300       # ۵ دقیقه برای شمارش تلاش‌های ناموفق
_LOCKOUT_SECONDS = 900      # ۱۵ دقیقه قفل شدن بعد از عبور از سقف


@dataclass
class _Entry:
    failures: int = 0
    window_start: float = field(default_factory=time.monotonic)
    locked_until: float = 0.0


_entries: dict[str, _Entry] = {}
_lock = Lock()


def _now() -> float:
    return time.monotonic()


def ensure_not_locked(key: str) -> None:
    with _lock:
        entry = _entries.get(key)
        if entry and entry.locked_until > _now():
            retry_after = int(entry.locked_until - _now())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="تلاش‌های ناموفق زیاد بود. کمی بعد دوباره تلاش کنید.",
                headers={"Retry-After": str(retry_after)},
            )


def note_failure(key: str) -> None:
    with _lock:
        entry = _entries.setdefault(key, _Entry())
        now = _now()
        if now - entry.window_start > _WINDOW_SECONDS:
            entry.failures = 0
            entry.window_start = now
        entry.failures += 1
        if entry.failures >= _MAX_ATTEMPTS:
            entry.locked_until = now + _LOCKOUT_SECONDS


def note_success(key: str) -> None:
    with _lock:
        _entries.pop(key, None)
