#!/usr/bin/env python3
"""Rasterize the UI subset into a 1-bit font the panel can draw without a scaler."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

FONT_PATH = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"
SIZE = 16
OUT_H = Path(__file__).resolve().parents[1] / "components" / "ui" / "font_data.h"
OUT_C = Path(__file__).resolve().parents[1] / "components" / "ui" / "font_data.c"

TEXT = """
 !"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~
主桌面工作台时钟设置预留尚未开放速度按下查看详情生成中调用工具空闲个会话在跑待处理一切安静没有等待批准的对话
等待已结束允许运行修改本轮近一分钟进行正在本机输出与连接状态返回上选择打开墨水屏已未安装失效移除方式蓝牙刷新局部完整每次
条在等暂无条目刚到达刚刚星期一
"""


def chars():
    seen = []
    for ch in TEXT:
        if ch.isspace() or ch in seen:
            continue
        seen.append(ch)
    return seen


def raster(font, ch):
    canvas = Image.new("L", (SIZE * 2, SIZE * 2), 0)
    draw = ImageDraw.Draw(canvas)
    draw.text((0, 0), ch, font=font, fill=255)
    bbox = canvas.getbbox()
    if not bbox:
        return 4, 1, 1, b"\x00"
    crop = canvas.crop(bbox)
    w, h = crop.size
    bits = bytearray()
    for y in range(h):
        for x in range(w):
            if crop.getpixel((x, y)) > 80:
                byte = (y * w + x) // 8
                while len(bits) <= byte:
                    bits.append(0)
                bits[byte] |= 0x80 >> ((y * w + x) % 8)
    advance = max(w + 1, 4)
    return advance, w, h, bytes(bits)


def main():
    font = ImageFont.truetype(FONT_PATH, SIZE)
    glyphs = []
    blob = bytearray()
    for ch in chars():
        adv, w, h, bits = raster(font, ch)
        glyphs.append((ord(ch), adv, w, h, len(blob), bits))
        blob.extend(bits)
    glyphs.sort()
    OUT_H.parent.mkdir(parents=True, exist_ok=True)
    OUT_H.write_text(
        "#ifndef FONT_DATA_H\n#define FONT_DATA_H\n#include <stdint.h>\n"
        "typedef struct { uint32_t cp; uint8_t adv, w, h; uint16_t offset; } mote_glyph_t;\n"
        f"#define MOTE_FONT_COUNT {len(glyphs)}\n"
        "extern const mote_glyph_t mote_font[MOTE_FONT_COUNT];\n"
        "extern const uint8_t mote_font_bits[];\n#endif\n",
        encoding="utf-8",
    )
    lines = ["#include \"font_data.h\"", "", "const mote_glyph_t mote_font[MOTE_FONT_COUNT] = {"]
    for cp, adv, w, h, offset, _bits in glyphs:
        lines.append(f"    {{ {cp}, {adv}, {w}, {h}, {offset} }},")
    lines.append("};")
    lines.append("const uint8_t mote_font_bits[] = {")
    for i in range(0, len(blob), 16):
        chunk = ", ".join(str(b) for b in blob[i:i + 16])
        lines.append(f"    {chunk},")
    lines.append("};")
    lines.append("")
    OUT_C.write_text("\n".join(lines), encoding="utf-8")
    print(f"{len(glyphs)} glyphs, {len(blob)} bytes")


if __name__ == "__main__":
    main()
