"""نقطه ورود سرور — سامانه حضور و غیاب."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.jalali import fmt_time, jalali_long, now_utc, to_tehran
from app.db.base import Base
from app.db.session import SessionLocal, engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("attendance")


@asynccontextmanager
async def lifespan(app: FastAPI):
    import app.models  # noqa: F401  ثبت همه جدول‌ها

    Base.metadata.create_all(bind=engine)
    from app.seed import ensure_seed

    with SessionLocal() as db:
        ensure_seed(db)
    logger.info("سامانه حضور و غیاب آماده است")
    yield


app = FastAPI(
    title=settings.APP_NAME,
    description="API سامانه حضور و غیاب پرسنل با تشخیص چهره، مدیریت وظایف و گزارش‌گیری",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

app.mount("/static", StaticFiles(directory=str(settings.STATIC_DIR)), name="static")
app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """خطاهای اعتبارسنجی را به پیام فارسی قابل نمایش تبدیل می‌کند."""
    problems = []
    for err in exc.errors():
        field = ".".join(str(p) for p in err.get("loc", []) if p not in ("body", "query"))
        problems.append({"field": field, "message": err.get("msg", "")})
    first = problems[0]["message"] if problems else "اطلاعات ارسالی معتبر نیست"
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": first, "errors": problems},
    )


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/", tags=["سامانه"], summary="وضعیت سرور")
def root() -> dict:
    now = now_utc()
    return {
        "app": settings.APP_NAME,
        "status": "ok",
        "server_time_utc": now.isoformat(),
        "tehran_time": to_tehran(now).isoformat(),
        "clock": fmt_time(now),
        "today": jalali_long(to_tehran(now).date()),
        "docs": "/docs",
    }


@app.get("/health", tags=["سامانه"], summary="بررسی سلامت برای مانیتورینگ")
def health() -> dict:
    from sqlalchemy import text

    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        db_ok = True
    except Exception as exc:  # pragma: no cover
        logger.error("خطای پایگاه داده: %s", exc)
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "database": db_ok}
