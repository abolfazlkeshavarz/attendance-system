"""داده‌های اولیه: مدیر سامانه، واحدها، شیفت‌ها و تعطیلات رسمی.

این تابع در هر بار بالا آمدن سرور اجرا می‌شود ولی فقط چیزهایی را می‌سازد که
هنوز وجود ندارند، پس اجرای مکرر آن بی‌خطر است.
"""
from __future__ import annotations

import logging
from datetime import time


from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.jalali import from_jalali, today_tehran, to_jalali
from app.core.security import hash_password
from app.models.enums import UserRole
from app.models.organization import Department, Holiday, Shift
from app.models.user import User

logger = logging.getLogger("attendance.seed")

DEPARTMENTS = [
    ("تولید", "خط تولید و بسته‌بندی"),
    ("انبار", "انبار مواد اولیه و محصول"),
    ("کنترل کیفیت", "آزمایشگاه و بازرسی"),
    ("فنی و نگهداری", "تعمیرات و نگهداری ماشین‌آلات"),
    ("اداری و مالی", "امور اداری، مالی و منابع انسانی"),
    ("حراست", "نگهبانی و حفاظت فیزیکی"),
]

SHIFTS = [
    # (نام، شروع، پایان، عبور از نیمه‌شب، روزهای کاری، استراحت)
    ("شیفت اداری", time(8, 0), time(16, 0), False, "0,1,2,3,4", 30),
    ("شیفت تولید — صبح", time(6, 0), time(14, 0), False, "0,1,2,3,4,5", 30),
    ("شیفت تولید — عصر", time(14, 0), time(22, 0), False, "0,1,2,3,4,5", 30),
    ("شیفت تولید — شب", time(22, 0), time(6, 0), True, "0,1,2,3,4,5", 30),
]

# تعطیلات رسمی با تاریخ ثابت شمسی (تعطیلات مذهبی قمری سالانه تغییر می‌کنند
# و باید از پنل «تعطیلات رسمی» دستی اضافه شوند).
FIXED_HOLIDAYS = [
    (1, 1, "عید نوروز"),
    (1, 2, "عید نوروز"),
    (1, 3, "عید نوروز"),
    (1, 4, "عید نوروز"),
    (1, 12, "روز جمهوری اسلامی"),
    (1, 13, "روز طبیعت"),
    (3, 14, "رحلت حضرت امام خمینی"),
    (3, 15, "قیام ۱۵ خرداد"),
    (11, 22, "پیروزی انقلاب اسلامی"),
    (12, 29, "روز ملی شدن صنعت نفت"),
]


def ensure_seed(db: Session) -> None:
    _ensure_admin(db)
    _ensure_departments(db)
    _ensure_shifts(db)
    _ensure_holidays(db)
    db.commit()


def _ensure_admin(db: Session) -> None:
    if db.execute(select(func.count()).select_from(User)).scalar_one():
        return
    admin = User(
        username=settings.FIRST_ADMIN_USERNAME.lower(),
        full_name=settings.FIRST_ADMIN_NAME,
        hashed_password=hash_password(settings.FIRST_ADMIN_PASSWORD),
        role=UserRole.ADMIN.value,
    )
    db.add(admin)
    logger.info(
        "کاربر مدیر ساخته شد — نام کاربری: %s | رمز اولیه: %s (حتماً تغییر دهید)",
        settings.FIRST_ADMIN_USERNAME,
        settings.FIRST_ADMIN_PASSWORD,
    )


def _ensure_departments(db: Session) -> None:
    if db.execute(select(func.count()).select_from(Department)).scalar_one():
        return
    for name, description in DEPARTMENTS:
        db.add(Department(name=name, description=description))
    logger.info("%d واحد سازمانی پیش‌فرض ساخته شد", len(DEPARTMENTS))


def _ensure_shifts(db: Session) -> None:
    if db.execute(select(func.count()).select_from(Shift)).scalar_one():
        return
    for name, start, end, crosses, days, brk in SHIFTS:
        db.add(
            Shift(
                name=name,
                start_time=start,
                end_time=end,
                crosses_midnight=crosses,
                work_days=days,
                break_minutes=brk,
            )
        )
    logger.info("%d شیفت کاری پیش‌فرض ساخته شد", len(SHIFTS))


def _ensure_holidays(db: Session) -> None:
    """تعطیلات ثابت شمسی را برای سال جاری و دو سال آینده ثبت می‌کند."""
    current_year = to_jalali(today_tehran()).year
    existing = {h.day for h in db.execute(select(Holiday)).scalars()}
    added = 0
    for year in (current_year - 1, current_year, current_year + 1):
        for month, day, title in FIXED_HOLIDAYS:
            try:
                gregorian = from_jalali(year, month, day)
            except ValueError:  # روزی که در آن سال وجود ندارد (مثلاً ۳۰ اسفند)
                continue
            if gregorian in existing:
                continue
            db.add(Holiday(day=gregorian, title=title, is_official=True))
            existing.add(gregorian)
            added += 1
    if added:
        logger.info("%d روز تعطیل رسمی ثبت شد", added)
