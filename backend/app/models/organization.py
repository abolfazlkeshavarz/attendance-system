from __future__ import annotations

from datetime import date, time

from sqlalchemy import Boolean, Date, Integer, String, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Department(Base, TimestampMixin):
    """واحد سازمانی (مثلاً: تولید، انبار، اداری)."""

    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    employees = relationship("Employee", back_populates="department")


class Shift(Base, TimestampMixin):
    """شیفت کاری. روزهای کاری با شماره روز ایرانی ذخیره می‌شود: شنبه=0 ... جمعه=6."""

    __tablename__ = "shifts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    crosses_midnight: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # تأخیر مجاز و تعجیل مجاز (دقیقه)
    grace_in_minutes: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    grace_out_minutes: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    # "0,1,2,3,4" یعنی شنبه تا چهارشنبه
    work_days: Mapped[str] = mapped_column(String(32), default="0,1,2,3,4,5", nullable=False)
    # مدت استراحت بدون احتساب (دقیقه)
    break_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    employees = relationship("Employee", back_populates="shift")

    @property
    def work_day_set(self) -> set[int]:
        return {int(x) for x in self.work_days.split(",") if x.strip().isdigit()}

    @property
    def expected_minutes(self) -> int:
        s = self.start_time.hour * 60 + self.start_time.minute
        e = self.end_time.hour * 60 + self.end_time.minute
        total = (e - s) if not self.crosses_midnight else (e + 24 * 60 - s)
        return max(0, total - self.break_minutes)


class Holiday(Base, TimestampMixin):
    """تعطیلات رسمی — تاریخ میلادی ذخیره می‌شود، شمسی نمایش داده می‌شود."""

    __tablename__ = "holidays"

    id: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(Date, unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    is_official: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
