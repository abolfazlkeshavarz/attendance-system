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

    مهم: بردارهای خروجی مدل عمداً نرمال‌سازی نمی‌شوند. آستانه استاندارد و
    آزموده‌شدهٔ این مدل (۰٫۶) روی همان بردار خام تعریف شده است. اگر اینجا
    نرمال‌سازی کنیم ولی مرورگر نکند (یا برعکس)، فاصله‌ها بی‌معنا می‌شوند و
    تشخیص چهره بی‌سروصدا خراب می‌شود.
    """
    v = np.asarray(vector, dtype=np.float32)
    norm = float(np.linalg.norm(v))
    if norm < 1e-8 or not np.isfinite(norm):
        raise ValueError("بردار چهره نامعتبر است")
    return v


def distance(a: np.ndarray, b: np.ndarray) -> float:
    """فاصله اقلیدسی بین دو بردار چهره (هرچه کمتر، شبیه‌تر)."""
    return float(np.linalg.norm(a - b))


def load_vectors(db: Session) -> tuple[list[int], np.ndarray]:
    """همه بردارهای فعال را به‌صورت یک ماتریس برمی‌گرداند."""
    rows = db.execute(
        select(FaceEmbedding.employee_id, FaceEmbedding.vector)
        .join(Employee, Employee.id == FaceEmbedding.employee_id)
        .where(FaceEmbedding.is_active.is_(True), Employee.is_active.is_(True))
    ).all()
    if not rows:
        return [], np.zeros((0, 0), dtype=np.float32)
    ids = [r[0] for r in rows]
    mat = np.vstack([as_vector(json.loads(r[1])) for r in rows])
    return ids, mat


def identify(db: Session, vector: list[float]) -> tuple[int | None, float]:
    """نزدیک‌ترین پرسنل به بردار داده‌شده را پیدا می‌کند.

    خروجی: (شناسه پرسنل یا None، فاصله). اگر فاصله از آستانه بیشتر باشد None.
    """
    ids, mat = load_vectors(db)
    if not ids:
        return None, float("inf")
    probe = as_vector(vector)
    if mat.shape[1] != probe.shape[0]:
        return None, float("inf")
    dists = np.linalg.norm(mat - probe, axis=1)
    best = int(np.argmin(dists))
    best_dist = float(dists[best])
    if best_dist > settings.FACE_MATCH_THRESHOLD:
        return None, best_dist
    return ids[best], best_dist


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
        vectors = [
            as_vector(json.loads(f.vector)).round(6).tolist()
            for f in emp.faces
            if f.is_active
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
        model_name="face-api-128",
        dim=settings.FACE_EMBEDDING_DIM,
        threshold=settings.FACE_MATCH_THRESHOLD,
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
