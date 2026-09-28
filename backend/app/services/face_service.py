"""مدیریت بردارهای چهره و تطبیق آن‌ها.

استخراج بردار (embedding) روی تبلت و در مرورگر انجام می‌شود تا سامانه در حالت
آفلاین هم کار کند. سرور سه وظیفه دارد:
  ۱. ذخیره بردارهای ثبت‌نام‌شده هر پرسنل.
  ۲. ساخت «گالری» فشرده برای دانلود روی تبلت.
  ۳. تطبیق سمت سرور (وقتی اینترنت وصل است یا برای تأیید مجدد).
"""
from __future__ import annotations

import base64
import hashlib
import json
import uuid
from datetime import datetime
from pathlib import Path

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.jalali import now_utc
from app.models.employee import Employee, FaceEmbedding
from app.schemas.employee import FaceGallery, FaceGalleryItem


def as_vector(vector: list[float] | np.ndarray) -> np.ndarray:
    """اعتبارسنجی بردار چهره — بدون تغییر مقیاس.

    مهم: این‌جا مقیاس را عوض نمی‌کنیم و فرض نمی‌کنیم بردار حتماً L2-نرمال است
    (هرچند مرورگر همیشه ArcFace را نرمال‌شده می‌فرستد) — چون تطبیق با شباهتِ
    کسینوسی انجام می‌شود که خودش ناوردا نسبت به مقیاس است؛ فقط باید بردار
    معتبر (غیرصفر و متناهی) باشد.
    """
    v = np.asarray(vector, dtype=np.float32)
    norm = float(np.linalg.norm(v))
    if norm < 1e-8 or not np.isfinite(norm):
        raise ValueError("بردار چهره نامعتبر است")
    return v


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """شباهتِ کسینوسیِ دو بردار چهره (هرچه بیشتر، شبیه‌تر؛ بازهٔ [-1, 1])."""
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom < 1e-8:
        return 0.0
    return float(np.dot(a, b) / denom)


def load_vectors(db: Session) -> tuple[list[int], np.ndarray]:
    """بردارهای فعالِ همین مدل را به‌صورت یک ماتریس برمی‌گرداند.

    فقط بردارهایی که با مدلِ فعلی ساخته شده‌اند (`dim` برابرِ
    `FACE_EMBEDDING_DIM`) در نظر گرفته می‌شوند — بردارهای مدلِ قبلی هرگز با
    این‌ها مقایسه نمی‌شوند، چون فضای بردارِ دو مدل کاملاً متفاوت است. صاحبشان
    باید دوباره ثبت‌نام شود.
    """
    rows = db.execute(
        select(FaceEmbedding.employee_id, FaceEmbedding.vector)
        .join(Employee, Employee.id == FaceEmbedding.employee_id)
        .where(
            FaceEmbedding.is_active.is_(True),
            FaceEmbedding.dim == settings.FACE_EMBEDDING_DIM,
            Employee.is_active.is_(True),
        )
    ).all()
    if not rows:
        return [], np.zeros((0, 0), dtype=np.float32)
    ids = [r[0] for r in rows]
    mat = np.vstack([as_vector(json.loads(r[1])) for r in rows])
    return ids, mat


def identify(db: Session, vector: list[float]) -> tuple[int | None, float]:
    """شبیه‌ترین پرسنل به بردار داده‌شده را پیدا می‌کند.

    خروجی: (شناسه پرسنل یا None، شباهتِ کسینوسی). اگر شباهت از آستانه کمتر
    باشد، یا دو پرسنلِ متفاوت به‌اندازهٔ کافی شبیه به هم باشند که نتوان مطمئن
    بود (مثلاً دو خواهر/برادرِ شبیه به هم — یکی فقط ثبت‌نام کرده و دیگری هم
    تأیید می‌گرفت)، None برمی‌گردد.
    """
    ids, mat = load_vectors(db)
    if not ids:
        return None, -1.0
    probe = as_vector(vector)
    if mat.shape[1] != probe.shape[0]:
        return None, -1.0
    norms = np.linalg.norm(mat, axis=1) * np.linalg.norm(probe)
    norms[norms < 1e-8] = 1e-8
    sims = (mat @ probe) / norms

    # هر پرسنل چند بردار دارد. اگر فقط «شبیه‌ترینِ یکیِ» بردارهایش ملاک باشد،
    # کافی است چهرهٔ روبه‌رو فقط به یک نمونه (حتی کم‌کیفیت) شبیه باشد تا تطبیق
    # بخورد — همین باعث تأیید نادرستِ افرادِ ثبت‌نام‌نشده می‌شود. به‌جایش
    # میانگینِ بیشترین شباهت به چند نمونه (حداکثر ۳) ملاک است — سازگار با
    # همین منطق در faceEngine.ts سمت تبلت.
    per_employee_sims: dict[int, list[float]] = {}
    for emp_id, s in zip(ids, sims):
        per_employee_sims.setdefault(emp_id, []).append(float(s))
    per_employee: dict[int, float] = {}
    for emp_id, emp_sims in per_employee_sims.items():
        emp_sims.sort(reverse=True)
        k = min(3, len(emp_sims))
        per_employee[emp_id] = sum(emp_sims[:k]) / k
    ranked = sorted(per_employee.items(), key=lambda kv: kv[1], reverse=True)

    best_id, best_sim = ranked[0]
    if best_sim < settings.FACE_MATCH_THRESHOLD:
        return None, best_sim
    if len(ranked) > 1 and best_sim - ranked[1][1] < settings.FACE_AMBIGUITY_MARGIN:
        return None, best_sim
    return best_id, best_sim


def build_gallery(db: Session) -> FaceGallery:
    """بسته‌ای که تبلت برای تشخیص آفلاین دانلود می‌کند."""
    employees = (
        db.execute(
            select(Employee)
            .options(selectinload(Employee.faces), selectinload(Employee.department))
            .where(Employee.is_active.is_(True))
            .order_by(Employee.last_name, Employee.first_name)
        )
        .scalars()
        .all()
    )
    items: list[FaceGalleryItem] = []
    hasher = hashlib.sha256()
    for emp in employees:
        # فقط نمونه‌های همین مدل — نمونه‌های مدلِ قبلی (dim متفاوت) نادیده
        # گرفته می‌شوند تا هرگز با بردارهای جدید مقایسه نشوند.
        vectors = [
            as_vector(json.loads(f.vector)).round(6).tolist()
            for f in emp.faces
            if f.is_active and f.dim == settings.FACE_EMBEDDING_DIM
        ]
        if not vectors:
            continue
        hasher.update(f"{emp.id}:{len(vectors)}:{emp.updated_at}".encode())
        items.append(
            FaceGalleryItem(
                employee_id=emp.id,
                personnel_code=emp.personnel_code,
                full_name=emp.full_name,
                department_name=emp.department.name if emp.department else None,
                photo_path=emp.photo_path,
                vectors=vectors,
            )
        )
    return FaceGallery(
        model_name=settings.FACE_MODEL_NAME,
        dim=settings.FACE_EMBEDDING_DIM,
        threshold=settings.FACE_MATCH_THRESHOLD,
        ambiguity_margin=settings.FACE_AMBIGUITY_MARGIN,
        version=hasher.hexdigest()[:16] or "empty",
        generated_at=now_utc().isoformat(),
        items=items,
    )


def save_base64_image(data_url: str, directory: Path, prefix: str = "img") -> str | None:
    """ذخیره تصویر base64 (خروجی canvas مرورگر) و برگرداندن مسیر نسبی."""
    if not data_url:
        return None
    try:
        raw = data_url.split(",", 1)[1] if "," in data_url else data_url
        blob = base64.b64decode(raw, validate=True)
    except (ValueError, IndexError):
        return None
    if len(blob) > 4 * 1024 * 1024:      # سقف ۴ مگابایت
        return None
    directory.mkdir(parents=True, exist_ok=True)
    name = f"{prefix}_{datetime.now().strftime('%Y%m%d')}_{uuid.uuid4().hex[:10]}.jpg"
    (directory / name).write_bytes(blob)
    return f"{directory.name}/{name}"
