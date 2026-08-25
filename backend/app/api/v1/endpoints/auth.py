"""ورود به پنل مدیریت و مدیریت کاربران."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import AdminUser, CurrentUser, DbSession
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    PasswordChange,
    RefreshRequest,
    TokenPair,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.schemas.common import Message

router = APIRouter()


@router.post("/login", response_model=TokenPair, summary="ورود مدیر")
def login(payload: LoginRequest, db: DbSession) -> TokenPair:
    user = db.execute(
        select(User).where(User.username == payload.username.strip().lower())
    ).scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="نام کاربری یا رمز عبور اشتباه است",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="حساب کاربری غیرفعال است")
    return TokenPair(
        access_token=create_access_token(user.id, user.role),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/refresh", response_model=TokenPair, summary="تمدید توکن")
def refresh(payload: RefreshRequest, db: DbSession) -> TokenPair:
    data = decode_token(payload.refresh_token)
    if data is None or data.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="توکن تمدید نامعتبر است")
    user = db.get(User, int(data.get("sub", 0)))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="کاربر معتبر نیست")
    return TokenPair(
        access_token=create_access_token(user.id, user.role),
        refresh_token=create_refresh_token(user.id),
    )


@router.get("/me", response_model=UserOut, summary="اطلاعات کاربر جاری")
def me(user: CurrentUser) -> User:
    return user


@router.post("/change-password", response_model=Message, summary="تغییر رمز عبور")
def change_password(payload: PasswordChange, user: CurrentUser, db: DbSession) -> Message:
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="رمز عبور فعلی درست نیست")
    user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return Message(detail="رمز عبور با موفقیت تغییر کرد")


@router.get("/users", response_model=list[UserOut], summary="فهرست کاربران پنل")
def list_users(db: DbSession, _: AdminUser) -> list[User]:
    return list(db.execute(select(User).order_by(User.id)).scalars().all())


@router.post("/users", response_model=UserOut, status_code=201, summary="افزودن کاربر پنل")
def create_user(payload: UserCreate, db: DbSession, _: AdminUser) -> User:
    username = payload.username.strip().lower()
    if db.execute(select(User).where(User.username == username)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="این نام کاربری قبلاً ثبت شده است")
    if payload.role not in {r.value for r in UserRole}:
        raise HTTPException(status_code=400, detail="نقش انتخاب‌شده معتبر نیست")
    user = User(
        username=username,
        full_name=payload.full_name.strip(),
        hashed_password=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserOut, summary="ویرایش کاربر پنل")
def update_user(user_id: int, payload: UserUpdate, db: DbSession, admin: AdminUser) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="کاربر یافت نشد")
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.password:
        user.hashed_password = hash_password(payload.password)
    if payload.role is not None:
        if payload.role not in {r.value for r in UserRole}:
            raise HTTPException(status_code=400, detail="نقش انتخاب‌شده معتبر نیست")
        user.role = payload.role
    if payload.is_active is not None:
        if user.id == admin.id and not payload.is_active:
            raise HTTPException(status_code=400, detail="نمی‌توانید حساب خودتان را غیرفعال کنید")
        user.is_active = payload.is_active
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", response_model=Message, summary="حذف کاربر پنل")
def delete_user(user_id: int, db: DbSession, admin: AdminUser) -> Message:
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="نمی‌توانید حساب خودتان را حذف کنید")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="کاربر یافت نشد")
    db.delete(user)
    db.commit()
    return Message(detail="کاربر حذف شد")
