from __future__ import annotations

from datetime import date

from sqlalchemy import Boolean, Date, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Employee(Base, TimestampMixin):
    """پرسنل کارخانه."""

    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(primary_key=True)
    personnel_code: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    first_name: Mapped[str] = mapped_column(String(64), nullable=False)
    last_name: Mapped[str] = mapped_column(String(64), nullable=False)
    national_code: Mapped[str | None] = mapped_column(String(10), unique=True, index=True)
    mobile: Mapped[str | None] = mapped_column(String(20))
    position: Mapped[str | None] = mapped_column(String(128))          # سمت
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("shifts.id", ondelete="SET NULL"))
    hire_date: Mapped[date | None] = mapped_column(Date)
    # رمز پشتیبان برای زمانی که دوربین کار نمی‌کند (هش‌شده)
    pin_hash: Mapped[str | None] = mapped_column(String(255))
    photo_path: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    department = relationship("Department", back_populates="employees")
    shift = relationship("Shift", back_populates="employees")
    faces = relationship("FaceEmbedding", back_populates="employee", cascade="all, delete-orphan")
    punches = relationship("AttendanceRecord", back_populates="employee", cascade="all, delete-orphan")
    leaves = relationship("LeaveRequest", back_populates="employee", cascade="all, delete-orphan")
    tasks = relationship("Task", back_populates="employee", cascade="all, delete-orphan")
    fingerprint_template = relationship(
        "FingerprintTemplate", back_populates="employee", uselist=False, cascade="all, delete-orphan"
    )
    fingerprint_slots = relationship(
        "FingerprintSlot", back_populates="employee", cascade="all, delete-orphan"
    )

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def face_enrolled(self) -> bool:
        return any(f.is_active for f in self.faces)


class FaceEmbedding(Base, TimestampMixin):
    """بردار ویژگی چهره.

    استخراج بردار روی تبلت (مرورگر) انجام می‌شود؛ سرور فقط ذخیره و توزیع می‌کند
    تا تشخیص در حالت آفلاین هم کار کند. تصویر خام اختیاری است.
    """

    __tablename__ = "face_embeddings"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # بردار به‌صورت JSON آرایه اعداد اعشاری
    vector: Mapped[str] = mapped_column(Text, nullable=False)
    dim: Mapped[int] = mapped_column(Integer, nullable=False)
    model_name: Mapped[str] = mapped_column(String(64), default="face-api-128", nullable=False)
    quality: Mapped[float | None] = mapped_column(Float)      # امتیاز کیفیت نمونه
    image_path: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    employee = relationship("Employee", back_populates="faces")
