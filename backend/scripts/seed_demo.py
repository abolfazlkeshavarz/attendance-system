"""ساخت داده نمونه برای آزمایش سامانه.

اجرا:
    python -m scripts.seed_demo            # ۱۲ پرسنل و ۴۵ روز تردد
    python -m scripts.seed_demo --reset    # پاک کردن داده نمونه قبلی

این اسکریپت فقط برای محیط آزمایشی است؛ روی سرور واقعی اجرا نکنید.
"""
from __future__ import annotations

import argparse
import random
import sys
from datetime import datetime, time, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# کنسول ویندوز به‌صورت پیش‌فرض cp1252 است و متن فارسی را نمی‌پذیرد
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from sqlalchemy import delete, select  # noqa: E402

from app.core.jalali import TEHRAN, iran_weekday, to_utc, today_tehran  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.models.attendance import AttendanceRecord  # noqa: E402
from app.models.employee import Employee  # noqa: E402
from app.models.enums import (  # noqa: E402
    LeaveStatus,
    LeaveType,
    PunchKind,
    PunchMethod,
    TaskPriority,
    TaskRecurrence,
    TaskStatus,
)
from app.models.leave import LeaveRequest  # noqa: E402
from app.models.organization import Department, Holiday, Shift  # noqa: E402
from app.models.task import Task, TaskLog  # noqa: E402
from app.seed import ensure_seed  # noqa: E402

PEOPLE = [
    ("رضا", "محمدی", "اپراتور خط تولید", "تولید"),
    ("سارا", "کریمی", "کارشناس کنترل کیفیت", "کنترل کیفیت"),
    ("علی", "حسینی", "سرپرست شیفت", "تولید"),
    ("مریم", "رضایی", "کارشناس منابع انسانی", "اداری و مالی"),
    ("حسین", "اکبری", "انباردار", "انبار"),
    ("فاطمه", "نصیری", "حسابدار", "اداری و مالی"),
    ("محمد", "قاسمی", "تکنسین برق", "فنی و نگهداری"),
    ("زهرا", "موسوی", "اپراتور بسته‌بندی", "تولید"),
    ("امیر", "شریفی", "نگهبان", "حراست"),
    ("نرگس", "جعفری", "کارشناس آزمایشگاه", "کنترل کیفیت"),
    ("مهدی", "صادقی", "مکانیک", "فنی و نگهداری"),
    ("الهام", "یوسفی", "کارشناس انبار", "انبار"),
]

TASKS = [
    ("بازرسی روزانه خط بسته‌بندی", "کنترل دما، فشار و ثبت در فرم بازرسی", TaskRecurrence.DAILY, TaskPriority.HIGH, 45),
    ("نظافت و مرتب‌سازی محل کار", "پایان هر شیفت", TaskRecurrence.DAILY, TaskPriority.NORMAL, 20),
    ("تهیه گزارش موجودی انبار", "شمارش و ثبت در سامانه", TaskRecurrence.WEEKLY, TaskPriority.NORMAL, 120),
    ("سرویس دوره‌ای ماشین‌آلات", "روغن‌کاری و بررسی تسمه‌ها", TaskRecurrence.MONTHLY, TaskPriority.HIGH, 240),
    ("آموزش ایمنی پرسنل جدید", "برگزاری جلسه توجیهی", TaskRecurrence.NONE, TaskPriority.URGENT, 90),
    ("کالیبراسیون ترازوی آزمایشگاه", "با استفاده از وزنه استاندارد", TaskRecurrence.MONTHLY, TaskPriority.HIGH, 60),
    ("پیگیری تعمیر لیفتراک", "هماهنگی با شرکت خدمات", TaskRecurrence.NONE, TaskPriority.HIGH, 30),
    ("ثبت گزارش ضایعات روزانه", "تفکیک و وزن‌کشی", TaskRecurrence.DAILY, TaskPriority.NORMAL, 25),
]


def reset_demo(db) -> None:
    db.execute(delete(TaskLog))
    db.execute(delete(Task))
    db.execute(delete(LeaveRequest))
    db.execute(delete(AttendanceRecord))
    db.execute(delete(Employee))
    db.commit()
    print("داده نمونه قبلی پاک شد")


def build(days: int = 45) -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        ensure_seed(db)

        if db.execute(select(Employee)).first():
            print("پرسنل از قبل وجود دارد — برای ساخت مجدد، با --reset اجرا کنید")
            return

        depts = {d.name: d for d in db.execute(select(Department)).scalars()}
        shifts = list(db.execute(select(Shift)).scalars())
        office = next(s for s in shifts if s.name == "شیفت اداری")
        morning = next(s for s in shifts if "صبح" in s.name)
        holidays = {h.day for h in db.execute(select(Holiday)).scalars()}

        random.seed(1403)
        employees: list[Employee] = []
        for index, (first, last, position, dept_name) in enumerate(PEOPLE, start=1):
            shift = office if dept_name in ("اداری و مالی", "کنترل کیفیت") else morning
            emp = Employee(
                personnel_code=f"{1000 + index}",
                first_name=first,
                last_name=last,
                position=position,
                department_id=depts[dept_name].id,
                shift_id=shift.id,
                mobile=f"0912{random.randint(1000000, 9999999)}",
                hire_date=today_tehran() - timedelta(days=random.randint(200, 2000)),
                pin_hash=hash_password("1234"),
                is_active=True,
            )
            db.add(emp)
            employees.append(emp)
        db.flush()
        print(f"{len(employees)} پرسنل ساخته شد (رمز پشتیبان همه: 1234)")

        # ---------------------------------------------------------- ترددها
        start = today_tehran() - timedelta(days=days)
        punches = 0
        for emp in employees:
            shift = office if emp.shift_id == office.id else morning
            work_days = shift.work_day_set
            for offset in range(days + 1):
                day = start + timedelta(days=offset)
                if day > today_tehran():
                    break
                if iran_weekday(day) not in work_days or day in holidays:
                    continue
                roll = random.random()
                if roll < 0.06:            # غیبت
                    continue
                if roll < 0.10:            # ورود بدون خروج (فراموشی)
                    only_in = True
                else:
                    only_in = False

                late = random.choices([0, 0, 0, 5, 12, 25], weights=[50, 20, 10, 8, 7, 5])[0]
                extra = random.choices([0, 0, 15, 45, 90], weights=[45, 25, 15, 10, 5])[0]

                in_time = datetime.combine(
                    day, time(shift.start_time.hour, shift.start_time.minute), tzinfo=TEHRAN
                ) + timedelta(minutes=late - random.randint(0, 8))
                db.add(
                    AttendanceRecord(
                        employee_id=emp.id,
                        kind=PunchKind.IN.value,
                        method=PunchMethod.FACE.value,
                        happened_at=to_utc(in_time),
                        work_date=day,
                        confidence=round(random.uniform(0.86, 0.99), 3),
                    )
                )
                punches += 1
                if only_in:
                    continue

                out_time = datetime.combine(
                    day, time(shift.end_time.hour, shift.end_time.minute), tzinfo=TEHRAN
                ) + timedelta(minutes=extra - random.randint(0, 10))
                db.add(
                    AttendanceRecord(
                        employee_id=emp.id,
                        kind=PunchKind.OUT.value,
                        method=PunchMethod.FACE.value,
                        happened_at=to_utc(out_time),
                        work_date=day,
                        confidence=round(random.uniform(0.86, 0.99), 3),
                    )
                )
                punches += 1
        print(f"{punches} تردد در {days} روز گذشته ثبت شد")

        # ---------------------------------------------------------- مرخصی
        for emp in random.sample(employees, 5):
            begin = today_tehran() - timedelta(days=random.randint(1, 30))
            length = random.randint(1, 3)
            leave_type = random.choice(
                [LeaveType.DAILY.value, LeaveType.SICK.value, LeaveType.MISSION.value]
            )
            db.add(
                LeaveRequest(
                    employee_id=emp.id,
                    leave_type=leave_type,
                    start_at=to_utc(datetime.combine(begin, time.min, tzinfo=TEHRAN)),
                    end_at=to_utc(
                        datetime.combine(begin + timedelta(days=length), time.min, tzinfo=TEHRAN)
                    ),
                    status=random.choice(
                        [LeaveStatus.APPROVED.value, LeaveStatus.APPROVED.value, LeaveStatus.PENDING.value]
                    ),
                    reason=random.choice(["امور شخصی", "بیماری", "مأموریت کاری", "مراجعه به پزشک"]),
                )
            )
        print("۵ درخواست مرخصی ثبت شد")

        # ----------------------------------------------------------- وظایف
        for index, (title, desc, recurrence, priority, minutes) in enumerate(TASKS):
            emp = employees[index % len(employees)]
            task = Task(
                title=title,
                description=desc,
                employee_id=emp.id,
                department_id=emp.department_id,
                recurrence=recurrence.value,
                priority=priority.value,
                estimated_minutes=minutes,
                start_date=today_tehran() - timedelta(days=30)
                if recurrence != TaskRecurrence.NONE
                else None,
                due_date=today_tehran() + timedelta(days=random.randint(-3, 10))
                if recurrence == TaskRecurrence.NONE
                else None,
                status=TaskStatus.TODO.value,
                progress=random.choice([0, 0, 25, 50, 75]),
            )
            db.add(task)
            db.flush()
            # چند سابقه انجام برای وظایف روزانه
            if recurrence == TaskRecurrence.DAILY:
                for back in range(1, 8):
                    if random.random() < 0.75:
                        db.add(
                            TaskLog(
                                task_id=task.id,
                                log_date=today_tehran() - timedelta(days=back),
                                status=TaskStatus.DONE.value,
                                spent_minutes=minutes + random.randint(-10, 15),
                            )
                        )
        print(f"{len(TASKS)} وظیفه با سوابق انجام ثبت شد")

        db.commit()
        print("\nداده نمونه آماده است. وارد پنل شوید: admin / admin1234")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ساخت داده نمونه")
    parser.add_argument("--reset", action="store_true", help="پاک کردن داده نمونه قبلی")
    parser.add_argument("--days", type=int, default=45, help="تعداد روزهای تردد")
    args = parser.parse_args()

    if args.reset:
        with SessionLocal() as session:
            reset_demo(session)
    build(args.days)
