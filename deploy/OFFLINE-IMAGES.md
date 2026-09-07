# استقرار با ایمیج‌های از پیش ساخته‌شده (بدون build روی سرور)

وقتی build روی VPS کند است، ایمیج‌ها را روی سیستمِ توسعه بساز، در یک فایل
`.tgz` بسته‌بندی کن، به سرور منتقل کن و آنجا فقط بارگذاری + راه‌اندازی کن.

سه ایمیج داخل بسته است: `attendance-backend`، `attendance-web` و
`postgres:16-alpine` (تا سرور به Docker Hub هم نیاز نداشته باشد).

---

## راه ساده: یک فرمان از سیستم توسعه

نیازمندی: دسترسی `ssh` با کلید به سرور، و اینکه پروژه از قبل روی سرور در
`/opt/attendance` با `.env` معتبر مستقر شده باشد.

```bash
make release HOST=root@SERVER_IP           # مسیر پیش‌فرض: /opt/attendance
# یا
make release HOST=root@SERVER_IP DIR=/srv/attendance TAG=20260907-1400
```

این کار به‌ترتیب: ایمیج‌ها را می‌سازد → `release/attendance-images-<TAG>.tgz`
را با `docker-compose.yml` و `scripts/deploy-images.sh` به سرور کپی می‌کند →
روی سرور `docker load` + `docker compose up -d` می‌زند.

---

## راه دستی (اگر ssh مستقیم نداری)

### ۱) روی سیستم توسعه

```bash
make images                 # یا: make images TAG=20260907-1400
```

خروجی: `release/attendance-images-<TAG>.tgz`

### ۲) انتقال به سرور

```bash
scp release/attendance-images-<TAG>.tgz \
    scripts/deploy-images.sh \
    docker-compose.yml \
    root@SERVER_IP:/opt/attendance/
```

> `docker-compose.yml` را هم بفرست تا نسخه‌اش با ایمیج‌ها بخواند. `.env` روی
> سرور دست‌نخورده می‌ماند.

### ۳) روی سرور

```bash
cd /opt/attendance
bash deploy-images.sh attendance-images-<TAG>.tgz
# یا:  make deploy-offline BUNDLE=attendance-images-<TAG>.tgz
```

اسکریپت: ایمیج‌ها را load می‌کند، `IMAGE_TAG=<TAG>` را در `.env` می‌نویسد و
`docker compose up -d --no-build` می‌زند. دیتابیس و حجم `media` دست‌نخورده
می‌مانند.

---

## نکته‌ها

- **معماری:** ایمیج‌ها `linux/amd64` ساخته می‌شوند (پیش‌فرضِ اسکریپت). برای
  VPSِ ARM مقدار `DOCKER_DEFAULT_PLATFORM=linux/arm64` را قبل از `make images`
  ست کن.
- **مهاجرت پایگاه داده:** این پروژه جدول‌ها را هنگام بالا آمدن می‌سازد
  (`create_all`) ولی ستون‌های جدید را به جدولِ موجود اضافه نمی‌کند. اگر نسخه‌ای
  ستون تازه‌ای به مدل اضافه کرد، `ALTER TABLE` دستی لازم است (در docstringِ
  همان سرویس نوشته می‌شود).
- **عقب‌گرد:** بسته‌های `release/*.tgz` را نگه دار. برای برگشتن به نسخه‌ی قبل،
  همان `deploy-images.sh` را با فایلِ قدیمی‌تر اجرا کن.
- **SSL / nginx میزبان:** بدون تغییر است. `make ssl` فقط بارِ اول یا هنگام
  عوض‌شدن دامنه لازم است.
- **`make deploy` / `make update`** مثل قبل کار می‌کنند و خودشان build می‌زنند؛
  این مسیرِ آفلاین جایگزینِ اختیاری است، نه اجباری.
