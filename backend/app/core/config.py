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

    # تشخیص چهره (روی تبلت اجرا می‌شود؛ این‌ها با سرور هم‌قدم نگه داشته می‌شوند)
    #
    # مدل: MobileFaceNet آموزش‌دیده با ArcFace (`w600k_mbf.onnx` از بستهٔ
    # رسمیِ buffalo_sc در InsightFace) — جزئیات کامل در
    # frontend/public/models/mobilefacenet/MODEL_INFO.md. وزن‌های این مدل فقط
    # برای مصارف غیرتجاری مجازند؛ این سامانه یک ابزار داخلیِ غیرتجاریِ کارخانه
    # است. بردار خروجی ۵۱۲بُعدی و L2-نرمال‌شده است؛ تطبیق با شباهتِ کسینوسی
    # انجام می‌شود (بیشتر = شبیه‌تر) — نه فاصلهٔ اقلیدسیِ مدلِ قبلی.
    #
    # آستانهٔ شباهتِ کسینوسیِ کمینه برای «همان فرد». بیشتر = سخت‌گیرتر (احتمال
    # «شناسایی نشد» بیشتر)، کمتر = آسان‌گیرتر (احتمال اشتباه گرفتن دو نفر
    # بیشتر). این عدد باید با دادهٔ واقعیِ ثبت‌نام/تردد کالیبره شود؛ ۰٫۴۲ فقط
    # نقطهٔ شروعِ معقول برای ArcFace است.
    FACE_MATCH_THRESHOLD: float = 0.42
    # اگر دو پرسنلِ متفاوت (مثلاً دو خواهر/برادر) هر دو به همین اندازه به
    # چهرهٔ روبه‌روی دوربین شبیه باشند، به‌جای حدس زدن، تشخیص رد می‌شود (کاربر
    # به کد پرسنلی/PIN هدایت می‌شود). یعنی: شباهتِ نفرِ اول منهای نفرِ دوم باید
    # حداقل همین‌قدر باشد وگرنه مبهم است. بیشتر = سخت‌گیرتر دربرابر افراد
    # شبیه به هم، ولی احتمال بیشترِ رد شدنِ تصادفیِ تطبیقِ درست.
    FACE_AMBIGUITY_MARGIN: float = 0.05
    FACE_EMBEDDING_DIM: int = 512
    # فقط بردارهایی که با همین مدل ساخته شده‌اند برای گالری/تطبیق در نظر
    # گرفته می‌شوند — بردارهای مدلِ قبلی (face-api-128) هرگز با این‌ها مقایسه
    # نمی‌شوند چون فضای بردارشان کاملاً متفاوت است؛ صاحبشان باید دوباره
    # ثبت‌نام شود.
    FACE_MODEL_NAME: str = "mobilefacenet-arcface-512"
    MIN_SECONDS_BETWEEN_PUNCHES: int = 60       # جلوگیری از ثبت تکراری

    # تشخیص زنده بودن (ضد جعل با عکس). روی تبلت اجرا می‌شود.
    REQUIRE_LIVENESS: bool = True
    # حداقل انحراف چرخش سر از حالت روبه‌رو تا «چرخش» شمرده شود.
    # کمتر = آسان‌گیرتر. اگر پرسنل شکایت کردند که تأیید نمی‌شود، کمی کمترش کنید.
    LIVENESS_TURN_THRESHOLD: float = 0.06
    LIVENESS_TIMEOUT_SECONDS: int = 12

    # کوکی دسترسی به تصاویر (چهره‌ها و عکس ترددها)
    MEDIA_COOKIE_NAME: str = "att_media"
    # در تولید (پشت HTTPS) روی true بگذارید تا کوکی فقط روی اتصال امن ارسال شود
    SECURE_COOKIES: bool = False

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
