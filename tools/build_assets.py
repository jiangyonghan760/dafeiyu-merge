# -*- coding: utf-8 -*-
"""把 dsh-meme 插件「大肥鱼」图库处理成游戏贴图。

去白底（从边缘洪泛） -> 1px 羽化 -> 裁到内容 -> 补成正方形 -> 输出 320px WebP
"""
import json
import os
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

SRC = r"C:\Users\Lenovo\.dsh\profiles\desktop\node_modules\dsh-meme\memes\dafeiyu-001\memes"
OUT = r"C:\Users\Lenovo\Documents\deepseek-harness\default-workspace\dafeiyu-merge\assets"

# (key, 名字, 主色, 半径, 口头禅)
LEVELS = [
    ("wenhao", "小懵鱼", "#8ed2ff", 18, "？"),
    ("toukan", "偷看鱼", "#7cc4f7", 24, "盯——"),
    ("haixiu", "害羞鱼", "#9db6ff", 31, "…别看我"),
    ("bixin", "比心鱼", "#a99bff", 39, "给你比个心"),
    ("ganfan", "干饭鱼", "#c39bf5", 48, "先干饭！"),
    ("deyi", "得意鱼", "#e79be6", 58, "嘿嘿嘿"),
    ("tangping", "躺平鱼", "#ff9dc4", 70, "摆了"),
    ("shuijiao", "睡觉鱼", "#ff9aa9", 82, "呼…呼…"),
    ("zhenjing", "震惊鱼", "#ffa878", 96, "啊？？"),
    ("ok", "点赞鱼", "#ffc65c", 107, "这条鱼值得"),
    ("piaole", "飘了鱼", "#ff7fa8", 121, "我已经飘了"),
]


def cutout(path):
    arr = np.array(Image.open(path).convert("RGB")).astype(np.int16)
    h, w, _ = arr.shape
    mn, mx = arr.min(axis=2), arr.max(axis=2)
    near_white = (mn >= 234) & ((mx - mn) <= 18)

    visited = np.zeros((h, w), dtype=bool)
    dq = deque()

    def push(y, x):
        if 0 <= y < h and 0 <= x < w and near_white[y, x] and not visited[y, x]:
            visited[y, x] = True
            dq.append((y, x))

    for x in range(w):
        push(0, x)
        push(h - 1, x)
    for y in range(h):
        push(y, 0)
        push(y, w - 1)
    while dq:
        y, x = dq.popleft()
        push(y + 1, x)
        push(y - 1, x)
        push(y, x + 1)
        push(y, x - 1)

    alpha = np.where(visited, 0, 255).astype(np.uint8)
    img = Image.fromarray(np.dstack([arr.astype(np.uint8), alpha]), "RGBA")
    a = img.getchannel("A").filter(ImageFilter.GaussianBlur(0.7))
    img.putalpha(a)
    return img


def square(img, size=320, pad_ratio=0.035):
    img = img.crop(img.getbbox())
    side = max(img.size)
    pad = int(side * pad_ratio)
    canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2 + pad, (side - img.height) // 2 + pad))
    return canvas.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    for i, (key, name, color, radius, quote) in enumerate(LEVELS, start=1):
        matches = [
            os.path.join(dp, f)
            for dp, _, fs in os.walk(SRC)
            for f in fs
            if f == key + ".jpg"
        ]
        if not matches:
            raise SystemExit("missing meme: " + key)
        img = square(cutout(matches[0]))
        dst = os.path.join(OUT, "fish-%02d.webp" % i)
        img.save(dst, "WEBP", quality=90, method=6)
        manifest.append(
            {
                "level": i,
                "key": key,
                "name": name,
                "color": color,
                "radius": radius,
                "quote": quote,
                "src": "assets/fish-%02d.webp" % i,
                "bytes": os.path.getsize(dst),
            }
        )
        print("%2d %s %s %dKB" % (i, name, img.size, os.path.getsize(dst) // 1024))

    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("total", sum(m["bytes"] for m in manifest) // 1024, "KB")


if __name__ == "__main__":
    main()
