from __future__ import annotations

import enum


class StrEnum(str, enum.Enum):
    def __str__(self) -> str:  # pragma: no cover
        return self.value


class UserRole(StrEnum):
    ADMIN = "admin"          # دسترسی کامل
    MANAGER = "manager"      # مدیریت پرسنل و وظایف، بدون تنظیمات سامانه
    VIEWER = "viewer"        # فقط مشاهده گزارش‌ها


class PunchKind(StrEnum):
    IN = "in"                # ورود
    OUT = "out"              # خروج


class PunchMethod(StrEnum):
    FACE = "face"            # تشخیص چهره
    PIN = "pin"              # کد پرسنلی + رمز
    MANUAL = "manual"        # ثبت دستی توسط مدیر
    ADMIN_FIX = "admin_fix"  # اصلاح توسط مدیر


class DayStatus(StrEnum):
    PRESENT = "present"      # حاضر
    ABSENT = "absent"        # غایب
    LEAVE = "leave"          # مرخصی
    MISSION = "mission"      # مأموریت
    HOLIDAY = "holiday"      # تعطیل رسمی
    WEEKEND = "weekend"      # تعطیل هفتگی
    INCOMPLETE = "incomplete"  # ورود بدون خروج


class LeaveType(StrEnum):
    DAILY = "daily"          # مرخصی روزانه
    HOURLY = "hourly"        # مرخصی ساعتی
    SICK = "sick"            # استعلاجی
    MISSION = "mission"      # مأموریت
    UNPAID = "unpaid"        # بدون حقوق


class LeaveStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class TaskStatus(StrEnum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    CANCELLED = "cancelled"


class TaskPriority(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class TaskRecurrence(StrEnum):
    NONE = "none"
    DAILY = "daily"          # وظیفه روزانه (شرح وظایف)
    WEEKLY = "weekly"
    MONTHLY = "monthly"


FA_LABELS: dict[str, str] = {
    "admin": "مدیر ارشد", "manager": "سرپرست", "viewer": "ناظر",
    "in": "ورود", "out": "خروج",
    "face": "تشخیص چهره", "pin": "کد پرسنلی", "manual": "ثبت دستی", "admin_fix": "اصلاح مدیر",
    "present": "حاضر", "absent": "غایب", "leave": "مرخصی", "mission": "مأموریت",
    "holiday": "تعطیل رسمی", "weekend": "تعطیل هفتگی", "incomplete": "ناقص",
    "daily": "روزانه", "hourly": "ساعتی", "sick": "استعلاجی", "unpaid": "بدون حقوق",
    "pending": "در انتظار تأیید", "approved": "تأیید شده", "rejected": "رد شده",
    "todo": "انجام نشده", "in_progress": "در حال انجام", "done": "انجام شد",
    "cancelled": "لغو شده",
    "low": "کم", "normal": "عادی", "high": "زیاد", "urgent": "فوری",
    "none": "بدون تکرار", "weekly": "هفتگی", "monthly": "ماهانه",
}


def fa(value: str | None) -> str:
    if value is None:
        return ""
    return FA_LABELS.get(str(value), str(value))
