# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- ساخت
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# مدل‌های تشخیص چهره داخل public/models هستند و در همین مرحله وارد خروجی می‌شوند
RUN npm run build

# ------------------------------------------------------------- سرو کردن
FROM nginx:1.27-alpine

# فایل‌های ساخته‌شده رابط کاربری
COPY --from=builder /app/dist /usr/share/nginx/html

# پیکربندی به‌صورت قالب است تا نام دامنه از متغیر محیطی خوانده شود.
# تصویر رسمی nginx فایل‌های داخل templates را با envsubst پردازش می‌کند.
#
# این snippet را default.conf.template (استقرار روی VPS) دیگر include
# نمی‌کند — TLS و هدرهای امنیتی آنجا به nginx سطح میزبان (deploy/nginx/)
# منتقل شده‌اند. ولی nginx.local.conf.template (اجرای محلی، بدون میزبان
# جداگانه) هنوز همین فایل را لازم دارد، پس کپی‌اش هنوز اینجا می‌ماند.
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf

# فقط همین متغیرها جایگزین شوند تا متغیرهای خود nginx (مثل $host) دست‌نخورده بمانند
ENV NGINX_ENVSUBST_FILTER="^(DOMAIN|BACKEND_UPSTREAM)$"

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
