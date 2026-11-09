#!/usr/bin/env python3
"""Генерация иконок приложения «ВидеоПеревод» для iOS/PWA.

Дизайн: изумрудный градиент, белый треугольник Play,
полоса субтитров с «РУ» и вторая полупрозрачная строка.
Рендер в 4x с последующим LANCZOS-уменьшением для чётких краёв.
"""

from PIL import Image, ImageDraw, ImageFilter, ImageFont
import os

OUT = "/home/z/my-project/public"
os.makedirs(f"{OUT}/icons", exist_ok=True)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# цвета
C_TOP = (16, 185, 129)     # emerald-500
C_MID = (5, 150, 105)      # emerald-600
C_BOT = (6, 78, 59)        # emerald-900
WHITE = (255, 255, 255)
TEXT_DARK = (6, 78, 59)


def vertical_gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        if t < 0.5:
            k = t / 0.5
            c = tuple(int(C_TOP[i] + (C_MID[i] - C_TOP[i]) * k) for i in range(3))
        else:
            k = (t - 0.5) / 0.5
            c = tuple(int(C_MID[i] + (C_BOT[i] - C_MID[i]) * k) for i in range(3))
        for x in range(size):
            px[x, y] = c
    return img


def draw_art(base: Image.Image, scale: float) -> None:
    """Рисует треугольник + субтитры. scale — коэффициент к размеру холста."""
    s = base.size[0]
    d = ImageDraw.Draw(base, "RGBA")

    # мягкое свечение позади треугольника
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    r = int(s * 0.16 * scale)
    cx, cy = s // 2, int(s * 0.42)
    gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=int(s * 0.05)))
    base.alpha_composite(glow)

    d = ImageDraw.Draw(base, "RGBA")

    # треугольник Play
    tw = int(s * 0.30 * scale)   # полуширина
    th = int(s * 0.33 * scale)   # полувысота
    cx, cy = s // 2, int(s * 0.40)
    d.polygon(
        [(cx - tw + int(0.05 * s * scale), cy - th),
         (cx - tw + int(0.05 * s * scale), cy + th),
         (cx + tw, cy)],
        fill=WHITE,
    )

    # полоса субтитров с «РУ»
    bar_w = int(s * 0.56 * scale)
    bar_h = int(s * 0.155 * scale)
    bx = (s - bar_w) // 2
    by = int(s * 0.655)
    d.rounded_rectangle(
        [bx, by, bx + bar_w, by + bar_h],
        radius=int(bar_h * 0.30),
        fill=WHITE,
    )
    fsize = int(bar_h * 0.82)
    font = ImageFont.truetype(FONT_BOLD, fsize)
    bbox = d.textbbox((0, 0), "РУ", font=font)
    tw2, th2 = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(
        (bx + (bar_w - tw2) / 2 - bbox[0], by + (bar_h - th2) / 2 - bbox[1]),
        "РУ",
        font=font,
        fill=TEXT_DARK,
    )

    # вторая, полупрозрачная строка субтитров
    bar2_w = int(bar_w * 0.62)
    bar2_h = int(s * 0.055 * scale)
    bx2 = (s - bar2_w) // 2
    by2 = int(s * 0.865)
    d.rounded_rectangle(
        [bx2, by2, bx2 + bar2_w, by2 + bar2_h],
        radius=int(bar2_h * 0.5),
        fill=(255, 255, 255, 150),
    )


def render(size: int, content_scale: float, path: str, rounded: bool = False) -> None:
    """size — итоговый размер; рисуем в 4x и уменьшаем."""
    S = size * 4
    img = vertical_gradient(S).convert("RGBA")
    draw_art(img, content_scale)

    if rounded:
        # скругление углов (для превью-иконок; iOS сам маскирует apple-touch)
        mask = Image.new("L", (S, S), 0)
        md = ImageDraw.Draw(mask)
        md.rounded_rectangle([0, 0, S, S], radius=int(S * 0.22), fill=255)
        img.putalpha(mask)

    img = img.convert("RGB") if not rounded else img
    img = img.resize((size, size), Image.LANCZOS)
    img.save(path, quality=95)
    print(f"saved {path} ({size}x{size})")


# обычные PWA-иконки: контент крупнее (safe zone ~ обычные)
render(192, 1.0, f"{OUT}/icons/icon-192.png")
render(512, 1.0, f"{OUT}/icons/icon-512.png")

# maskable: контент в зоне 80%, фон на весь холст
render(512, 0.80, f"{OUT}/icons/icon-maskable-512.png")

# apple-touch-icon: без прозрачности и без скругления (iOS сам скругляет)
render(180, 0.92, f"{OUT}/apple-touch-icon.png")

# favicon 32px — упрощённый (только треугольник, чтобы не замылиться)
S = 32 * 8
img = vertical_gradient(S).convert("RGBA")
d = ImageDraw.Draw(img, "RGBA")
tw = int(S * 0.26)
th = int(S * 0.30)
cx, cy = S // 2, int(S * 0.40)
d.polygon([(cx - tw, cy - th), (cx - tw, cy + th), (cx + tw, cy)], fill=WHITE)
bar_w = int(S * 0.64)
bar_h = int(S * 0.14)
bx, by = (S - bar_w) // 2, int(S * 0.66)
d.rounded_rectangle([bx, by, bx + bar_w, by + bar_h], radius=int(bar_h * 0.5), fill=WHITE)
bar2_w = int(bar_w * 0.55)
bx2 = (S - bar2_w) // 2
by2 = int(S * 0.86)
d.rounded_rectangle([bx2, by2, bx2 + bar2_w, by2 + int(S * 0.09)], radius=int(S * 0.045), fill=(255, 255, 255, 160))
img.convert("RGB").resize((32, 32), Image.LANCZOS).save(f"{OUT}/favicon.png")
print(f"saved {OUT}/favicon.png (32x32)")
print("done")
