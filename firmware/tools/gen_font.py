#!/usr/bin/env python3
"""1-bit strikes for the 480×800 panel.

WenQuanYi Micro Hei has no bold master here. Each strike is drawn a pixel
heavier, then hard-thresholded so gray fringe does not become a 4-gray dither.
Sizes are the ones the UI actually uses. Do not scale a 16px bitmap up.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

FONT_PATH = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"
OUT_H = Path(__file__).resolve().parents[1] / "components" / "ui" / "font_data.h"
OUT_C = Path(__file__).resolve().parents[1] / "components" / "ui" / "font_data.c"
THRESHOLD = 176

UI = """
 !"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~
主桌面工作台时钟设置预留尚未开放速度按下查看详情生成中调用工具空闲个会话在跑待处理一切安静没有等待批准的对话
等待已结束允许运行修改本轮近一分钟进行正在本机输出与连接状态返回上选择打开墨水屏已未安装失效移除方式蓝牙刷新局部完整每次
条在等暂无条目刚到达刚刚星期一
"""
DISPLAY = "0123456789:.-+ "


def chars(text):
    seen = []
    for ch in text:
        if ch.isspace() or ch in seen:
            continue
        seen.append(ch)
    return seen


def raster(font, ch, px):
    if ch == " ":
        return max(px // 3, 8), 0, 0, b""
    canvas = Image.new("L", (px * 3, px * 3), 0)
    draw = ImageDraw.Draw(canvas)
    origin = 2
    for dx, dy in ((0, 0), (1, 0), (0, 1)):
        draw.text((origin + dx, origin + dy), ch, font=font, fill=255)
    bw = canvas.point(lambda p: 255 if p >= THRESHOLD else 0)
    bbox = bw.getbbox()
    if not bbox:
        return max(px // 3, 4), 1, 1, b"\x00"
    crop = bw.crop(bbox)
    w, h = crop.size
    bits = bytearray()
    for y in range(h):
        for x in range(w):
            if crop.getpixel((x, y)):
                bit = y * w + x
                byte = bit // 8
                while len(bits) <= byte:
                    bits.append(0)
                bits[byte] |= 0x80 >> (bit % 8)
    advance = max(w + 2, 4)
    return advance, w, h, bytes(bits)


def strike(name, px, text):
    font = ImageFont.truetype(FONT_PATH, px)
    glyphs = []
    blob = bytearray()
    for ch in chars(text):
        adv, w, h, bits = raster(font, ch, px)
        glyphs.append((ord(ch), adv, w, h, len(blob), bits))
        blob.extend(bits)
    glyphs.sort()
    return name, px, glyphs, blob


def main():
    strikes = [
        strike("caption", 24, UI),
        strike("body", 36, UI),
        strike("title", 56, UI),
        strike("display", 96, DISPLAY),
    ]
    OUT_H.parent.mkdir(parents=True, exist_ok=True)
    header = [
        "#ifndef FONT_DATA_H",
        "#define FONT_DATA_H",
        "#include <stdint.h>",
        "typedef struct { uint32_t cp; uint8_t adv, w, h; uint32_t offset; } mote_glyph_t;",
        "#define MOTE_STRIKE_CAPTION 0",
        "#define MOTE_STRIKE_BODY 1",
        "#define MOTE_STRIKE_TITLE 2",
        "#define MOTE_STRIKE_DISPLAY 3",
    ]
    for index, (name, px, glyphs, _blob) in enumerate(strikes):
        header.append(f"#define MOTE_FONT_{name.upper()}_COUNT {len(glyphs)}")
        header.append(f"#define MOTE_FONT_{name.upper()}_PX {px}")
    header.append("extern const mote_glyph_t mote_font_caption[];")
    header.append("extern const mote_glyph_t mote_font_body[];")
    header.append("extern const mote_glyph_t mote_font_title[];")
    header.append("extern const mote_glyph_t mote_font_display[];")
    header.append("extern const uint8_t mote_font_bits_caption[];")
    header.append("extern const uint8_t mote_font_bits_body[];")
    header.append("extern const uint8_t mote_font_bits_title[];")
    header.append("extern const uint8_t mote_font_bits_display[];")
    header.append("#endif")
    OUT_H.write_text("\n".join(header) + "\n", encoding="utf-8")

    lines = ["#include \"font_data.h\"", ""]
    for name, _px, glyphs, blob in strikes:
        lines.append(f"const mote_glyph_t mote_font_{name}[] = {{")
        for cp, adv, w, h, offset, _bits in glyphs:
            lines.append(f"    {{ {cp}, {adv}, {w}, {h}, {offset} }},")
        lines.append("};")
        lines.append(f"const uint8_t mote_font_bits_{name}[] = {{")
        for i in range(0, len(blob), 16):
            chunk = ", ".join(str(b) for b in blob[i:i + 16])
            lines.append(f"    {chunk},")
        lines.append("};")
        lines.append("")
    OUT_C.write_text("\n".join(lines), encoding="utf-8")
    for name, px, glyphs, blob in strikes:
        print(f"{name} {px}px {len(glyphs)} glyphs, {len(blob)} bytes")


if __name__ == "__main__":
    main()
