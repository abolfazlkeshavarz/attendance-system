"""ابزارهای تاریخ شمسی و منطقه زمانی تهران.

قرارداد پروژه:
  * همه زمان‌ها در پایگاه داده به‌صورت UTC ذخیره می‌شوند.
  * همه خروجی‌ها و گزارش‌ها به وقت تهران و تقویم هجری شمسی نمایش داده می‌شوند.
  * «روز کاری» بر اساس تاریخ محلی تهران تعیین می‌شود.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import jdatetime

from app.core.config import settings

TEHRAN = ZoneInfo(settings.TIMEZONE)

# شنبه = 0 ... جمعه = 6  (ترتیب هفته ایرانی)
WEEKDAY_NAMES_FA = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"]
MONTH_NAMES_FA = [
    "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
    "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def to_tehran(dt: datetime) -> datetime:
    """تبدیل هر datetime (naive=UTC یا aware) به وقت تهران."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(TEHRAN)


def to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TEHRAN)
    return dt.astimezone(timezone.utc)


def tehran_date(dt: datetime) -> date:
    """تاریخ میلادیِ روزِ محلی تهران برای یک زمان."""
    return to_tehran(dt).date()


def today_tehran() -> date:
    return to_tehran(now_utc()).date()


# ---------------------------------------------------------------- شمسی <-> میلادی

def to_jalali(d: date) -> jdatetime.date:
    return jdatetime.date.fromgregorian(date=d)


def from_jalali(jy: int, jm: int, jd: int) -> date:
    return jdatetime.date(jy, jm, jd).togregorian()


def jalali_str(d: date | None, sep: str = "/") -> str:
    """۱۴۰۳/۰۵/۱۲ (با ارقام لاتین برای پردازش‌پذیری؛ فرانت ارقام فارسی نشان می‌دهد)."""
    if d is None:
        return ""
    j = to_jalali(d)
    return f"{j.year:04d}{sep}{j.month:02d}{sep}{j.day:02d}"


def parse_jalali(value: str) -> date:
    """رشته «۱۴۰۳/۰۵/۱۲» یا «1403-05-12» را به تاریخ میلادی تبدیل می‌کند."""
    value = normalize_digits(value).replace("-", "/").strip()
    parts = [p for p in value.split("/") if p]
    if len(parts) != 3:
        raise ValueError("قالب تاریخ شمسی نامعتبر است (نمونه صحیح: 1403/05/12)")
    jy, jm, jd = (int(p) for p in parts)
    return from_jalali(jy, jm, jd)


def jalali_long(d: date) -> str:
    """«شنبه ۱۲ مرداد ۱۴۰۳»"""
    j = to_jalali(d)
    return f"{WEEKDAY_NAMES_FA[iran_weekday(d)]} {j.day} {MONTH_NAMES_FA[j.month - 1]} {j.year}"


def iran_weekday(d: date) -> int:
    """شنبه=0 تا جمعه=6 (پایتون: دوشنبه=0 ... یکشنبه=6)."""
    return (d.weekday() + 2) % 7


def is_friday(d: date) -> bool:
    return iran_weekday(d) == 6


# ---------------------------------------------------------------- بازه‌ها

def jalali_month_range(jy: int, jm: int) -> tuple[date, date]:
    """اولین و آخرین روزِ میلادیِ یک ماه شمسی."""
    start = jdatetime.date(jy, jm, 1).togregorian()
    if jm == 12:
        nxt = jdatetime.date(jy + 1, 1, 1)
    else:
        nxt = jdatetime.date(jy, jm + 1, 1)
    return start, nxt.togregorian() - timedelta(days=1)


def week_range(d: date) -> tuple[date, date]:
    """هفته ایرانی: شنبه تا جمعه‌ای که تاریخ داده‌شده در آن است."""
    start = d - timedelta(days=iran_weekday(d))
    return start, start + timedelta(days=6)


def day_bounds_utc(d: date) -> tuple[datetime, datetime]:
    """ابتدا و انتهای یک روز تهران، به‌صورت UTC (برای فیلتر کوئری)."""
    start_local = datetime.combine(d, time.min, tzinfo=TEHRAN)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def range_bounds_utc(start: date, end: date) -> tuple[datetime, datetime]:
    s, _ = day_bounds_utc(start)
    _, e = day_bounds_utc(end)
    return s, e


def daterange(start: date, end: date):
    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=1)


# ---------------------------------------------------------------- ارقام

_FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
_AR_DIGITS = "٠١٢٣٤٥٦٧٨٩"
_TRANS_TO_EN = {ord(c): str(i) for i, c in enumerate(_FA_DIGITS)}
_TRANS_TO_EN.update({ord(c): str(i) for i, c in enumerate(_AR_DIGITS)})
_TRANS_TO_FA = {ord(str(i)): c for i, c in enumerate(_FA_DIGITS)}


def normalize_digits(text: str) -> str:
    """ارقام فارسی/عربی را به لاتین تبدیل می‌کند (برای ورودی کاربر)."""
    return (text or "").translate(_TRANS_TO_EN)


def to_persian_digits(text: str) -> str:
    return (text or "").translate(_TRANS_TO_FA)


def fmt_time(dt: datetime | None) -> str:
    """«۰۷:۳۲» به وقت تهران."""
    if dt is None:
        return ""
    return to_tehran(dt).strftime("%H:%M")


def fmt_duration(minutes: int | float | None) -> str:
    """«۸:۳۰» — ساعت و دقیقه."""
    if not minutes:
        return "0:00"
    minutes = int(round(minutes))
    sign = "-" if minutes < 0 else ""
    minutes = abs(minutes)
    return f"{sign}{minutes // 60}:{minutes % 60:02d}"
