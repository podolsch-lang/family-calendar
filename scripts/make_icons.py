"""가족캘린더 아이콘을 다시 그립니다. Pillow가 필요합니다."""

from PIL import Image, ImageDraw

BG = (15, 118, 110, 255)
PAPER = (255, 253, 248, 255)
INK = (29, 26, 22, 255)
DOTS = [(3, 155, 229, 255), (230, 124, 115, 255), (246, 191, 38, 255)]


def draw(size, maskable=False):
    image = Image.new("RGBA", (size, size), BG)
    draw = ImageDraw.Draw(image)
    pad = int(size * (0.22 if maskable else 0.12))
    left, top = pad, int(size * (0.16 if maskable else 0.14))
    right, bottom = size - pad, size - int(size * (0.14 if maskable else 0.12))
    radius = int(size * 0.08)
    draw.rounded_rectangle((left, top, right, bottom), radius=radius, fill=PAPER)
    header_bottom = top + int((bottom - top) * 0.22)
    draw.rounded_rectangle((left, top, right, header_bottom + radius), radius=radius, fill=(232, 245, 241, 255))
    draw.rectangle((left, header_bottom, right, header_bottom + radius), fill=(232, 245, 241, 255))
    ring_y = top + int(size * 0.03)
    ring_w = max(4, size // 28)
    for center in (left + (right - left) * 0.32, left + (right - left) * 0.68):
        draw.rounded_rectangle(
            (center - ring_w, ring_y, center + ring_w, header_bottom - ring_w),
            radius=ring_w,
            fill=BG,
        )
    dot_r = int(size * 0.055)
    gap = int(size * 0.16)
    mid_x = size / 2
    mid_y = (header_bottom + bottom) / 2 + size * 0.02
    for index, color in enumerate(DOTS):
        cx = mid_x + (index - 1) * gap
        draw.ellipse((cx - dot_r, mid_y - dot_r, cx + dot_r, mid_y + dot_r), fill=color)
    return image


def main():
    regular = {192: "icons/icon-192.png", 512: "icons/icon-512.png"}
    maskable = {192: "icons/icon-maskable-192.png", 512: "icons/icon-maskable-512.png"}
    for size, path in regular.items():
        draw(size, False).save(path, "PNG")
    for size, path in maskable.items():
        draw(size, True).save(path, "PNG")
    draw(180, False).save("icons/apple-touch-icon.png", "PNG")


if __name__ == "__main__":
    main()
