# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base

# tzdata لازم است چون همه محاسبات بر پایه وقت تهران است
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata curl \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=Asia/Tehran

WORKDIR /app

# وابستگی‌ها جدا از کد کپی می‌شوند تا با تغییر کد، دوباره نصب نشوند
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY app ./app
COPY scripts ./scripts

# اجرا با کاربر غیر root
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/app/static/faces /app/app/static/snapshots \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers", "--forwarded-allow-ips", "*"]
