"""ساخت آیکون‌های PWA برای نصب برنامه روی صفحه اصلی تبلت.

اجرا:
    python -m scripts.make_pwa_icons

خروجی در frontend/public/ ذخیره می‌شود. مانیفست به icon-192.png و icon-512.png
اشاره می‌کند؛ بدون این فایل‌ها، آیکون برنامه روی تبلت خالی نمایش داده می‌شود.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = ROOT / "frontend" / "public"

BRAND = (31, 67, 224)        # آبی اصلی سامانه
BRAND_DARK = (26, 53, 184)
WHITE = (255, 255, 255)

SCALE = 4                    # چند برابر بزرگ می‌کشیم و بعد کوچک می‌کنیم (ضدپله)


def draw_icon(size: int) -> Image.Image:
    s = size * SCALE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # پس‌زمینه مربع گردگوشه با کمی گرادیان عمودی
    radius = int(s * 0.22)
    draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=BRAND)
    for i in range(s // 2):
        ratio = i / (s / 2)
        color = (
            int(BRAND[0] + (BRAND_DARK[0] - BRAND[0]) * ratio),
            int(BRAND[1] + (BRAND_DARK[1] - BRAND[1]) * ratio),
            int(BRAND[2] + (BRAND_DARK[2] - BRAND[2]) * ratio),
        )
        draw.line([(0, s // 2 + i), (s, s // 2 + i)], fill=color)
    # گردگوشه‌ها را دوباره اعمال کن (خط‌ها گوشه را پر کرده‌اند)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=255)
    img.putalpha(mask)

    # نقش اثر انگشت: چند کمان هم‌مرکز که از پایین باز است
    cx, cy = s / 2, s / 2
    stroke = max(2, int(s * 0.035))
    draw2 = ImageDraw.Draw(img)
    rings = [0.34, 0.26, 0.18, 0.10]
    for index, factor in enumerate(rings):
        r = s * factor
        box = [cx - r, cy - r * 1.08, cx + r, cy + r * 1.08]
        # کمان‌های بیرونی بازتر و کمان‌های داخلی بسته‌تر
        start, end = (200, 340) if index % 2 == 0 else (185, 355)
        draw2.arc(box, start=start, end=end, fill=WHITE, width=stroke)
        draw2.arc(box, start=start + 180, end=end + 180, fill=WHITE, width=stroke)

    # خط مرکزی کوتاه
    draw2.line(
        [(cx, cy - s * 0.045), (cx, cy + s * 0.045)],
        fill=WHITE,
        width=stroke,
    )

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        icon = draw_icon(size)
        path = OUT_DIR / f"icon-{size}.png"
        icon.save(path, "PNG", optimize=True)
        print(f"ساخته شد: {path.relative_to(ROOT)}  ({path.stat().st_size // 1024} کیلوبایت)")

    # آیکون ماسک‌پذیر اندروید نیاز به حاشیه امن دارد
    maskable = Image.new("RGBA", (512, 512), BRAND)
    inner = draw_icon(512).resize((410, 410), Image.LANCZOS)
    maskable.paste(inner, (51, 51), inner)
    maskable.save(OUT_DIR / "icon-maskable-512.png", "PNG", optimize=True)
    print(f"ساخته شد: {(OUT_DIR / 'icon-maskable-512.png').relative_to(ROOT)}")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
