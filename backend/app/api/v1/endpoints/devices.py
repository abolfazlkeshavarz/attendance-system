"""مدیریت دستگاه‌های (تبلت‌های) نصب‌شده در ورودی."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import AdminUser, AnyUser, DbSession
from app.core.security import generate_api_key, hash_api_key
from app.models.device import Device
from app.schemas.attendance import DeviceCreate, DeviceOut, DeviceWithKey
from app.schemas.common import Message

router = APIRouter()


@router.get("", response_model=list[DeviceOut], summary="فهرست دستگاه‌ها")
def list_devices(db: DbSession, _: AnyUser) -> list[Device]:
    return list(db.execute(select(Device).order_by(Device.name)).scalars().all())


@router.post("", response_model=DeviceWithKey, status_code=201, summary="ثبت دستگاه جدید")
def create_device(payload: DeviceCreate, db: DbSession, _: AdminUser) -> DeviceWithKey:
    """کلید دستگاه فقط همین یک‌بار نمایش داده می‌شود؛ آن را در تبلت وارد کنید."""
    raw_key = generate_api_key()
    device = Device(
        name=payload.name.strip(),
        location=payload.location,
        device_uid=uuid.uuid4().hex[:16],
        api_key_hash=hash_api_key(raw_key),
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return DeviceWithKey(**DeviceOut.model_validate(device).model_dump(), api_key=raw_key)


@router.post("/{device_id}/rotate-key", response_model=DeviceWithKey, summary="تولید کلید جدید")
def rotate_key(device_id: int, db: DbSession, _: AdminUser) -> DeviceWithKey:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="دستگاه یافت نشد")
    raw_key = generate_api_key()
    device.api_key_hash = hash_api_key(raw_key)
    db.commit()
    db.refresh(device)
    return DeviceWithKey(**DeviceOut.model_validate(device).model_dump(), api_key=raw_key)


@router.patch("/{device_id}", response_model=DeviceOut, summary="ویرایش دستگاه")
def update_device(device_id: int, payload: DeviceCreate, db: DbSession, _: AdminUser) -> Device:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="دستگاه یافت نشد")
    device.name = payload.name.strip()
    device.location = payload.location
    db.commit()
    db.refresh(device)
    return device


@router.post("/{device_id}/toggle", response_model=DeviceOut, summary="فعال/غیرفعال کردن دستگاه")
def toggle_device(device_id: int, db: DbSession, _: AdminUser) -> Device:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="دستگاه یافت نشد")
    device.is_active = not device.is_active
    db.commit()
    db.refresh(device)
    return device


@router.delete("/{device_id}", response_model=Message, summary="حذف دستگاه")
def delete_device(device_id: int, db: DbSession, _: AdminUser) -> Message:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="دستگاه یافت نشد")
    db.delete(device)
    db.commit()
    return Message(detail="دستگاه حذف شد")
