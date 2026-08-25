"""پیکربندی مرکزی برنامه — از متغیرهای محیطی خوانده می‌شود."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    APP_NAME: str = "سامانه حضور و غیاب"
    API_V1_PREFIX: str = "/api/v1"
    DEBUG: bool = True

    # پایگاه داده: برای تولید مقدار postgresql+psycopg://... بگذارید
    DATABASE_URL: str = f"sqlite:///{(BASE_DIR / 'attendance.db').as_posix()}"

    # امنیت
    SECRET_KEY: str = "CHANGE-ME-IN-PRODUCTION-please-use-a-long-random-string"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    ALGORITHM: str = "HS256"

    # مدیر اولیه
    FIRST_ADMIN_USERNAME: str = "admin"
    FIRST_ADMIN_PASSWORD: str = "admin1234"
    FIRST_ADMIN_NAME: str = "مدیر سامانه"

    # منطقه زمانی کارخانه
    TIMEZONE: str = "Asia/Tehran"

    # فایل‌های ایستا
    STATIC_DIR: Path = BASE_DIR / "app" / "static"
    FACE_DIR: Path = BASE_DIR / "app" / "static" / "faces"
    SNAPSHOT_DIR: Path = BASE_DIR / "app" / "static" / "snapshots"

    # تشخیص چهره (روی تبلت اجرا می‌شود؛ این‌ها آستانه‌های همگام‌سازی‌شده‌اند)
    # آستانه استاندارد مدل روی بردار خام ۱۲۸بُعدی؛ کمتر = سخت‌گیرتر
    FACE_MATCH_THRESHOLD: float = 0.60
    FACE_EMBEDDING_DIM: int = 128
    MIN_SECONDS_BETWEEN_PUNCHES: int = 60       # جلوگیری از ثبت تکراری

    # CORS — دامنه‌های مجاز پنل و تبلت
    CORS_ORIGINS: str = "*"

    @property
    def cors_origins_list(self) -> list[str]:
        if self.CORS_ORIGINS.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.FACE_DIR.mkdir(parents=True, exist_ok=True)
    s.SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    return s


settings = get_settings()
