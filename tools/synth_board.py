"""生成合成棋盘截图，用来验证识别管线（不依赖任何游戏）。

画法刻意做得比真实棋盘更"脏"，覆盖通用性难点：
  * 木纹渐变底色 + 噪点
  * 黑子带高光、白子带描边
  * 星位小点、最后一手红点标记
  * 可选：整图缩放（模拟不同分辨率）、轻微旋转、不同色系
"""

from __future__ import annotations

import random

import cv2
import numpy as np


THEMES = {
    "wood": {"bg": (58, 132, 186), "line": (30, 60, 90),
             "black": (28, 28, 32), "white": (232, 236, 240)},
    "ink": {"bg": (222, 218, 210), "line": (70, 66, 60),
            "black": (22, 22, 24), "white": (245, 245, 248)},
    "dark": {"bg": (48, 44, 40), "line": (90, 86, 80),
             "black": (12, 12, 14), "white": (228, 230, 234)},
    "jade": {"bg": (128, 150, 138), "line": (54, 74, 64),
             "black": (26, 30, 28), "white": (238, 242, 238)},
}


def render(size=15, spacing=36, margin=52, theme="wood", stones=None,
           star_points=True, last_marker=True, noise=6, blur=0.0, angle=0.0):
    """stones: {(x, y): 1|2}，x 向右 y 向下（与 Board 索引一致）。"""
    th = THEMES[theme]
    span = (size - 1) * spacing
    w = h = span + margin * 2
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:] = th["bg"]

    # 木纹：加低频条纹 + 噪点
    yy = np.arange(h, dtype=np.float32)[:, None]
    wood = (np.sin(yy / 9.0) * 6.0 + np.sin(yy / 31.0) * 9.0)
    img = np.clip(img.astype(np.float32) + wood[:, :, None], 0, 255).astype(np.uint8)
    if noise:
        rng = np.random.default_rng(7)
        img = np.clip(img.astype(np.int16) + rng.integers(-noise, noise + 1,
                                                          (h, w, 3), dtype=np.int16),
                      0, 255).astype(np.uint8)

    # 网格线
    for i in range(size):
        p = margin + i * spacing
        cv2.line(img, (margin, p), (margin + span, p), th["line"], 2, cv2.LINE_AA)
        cv2.line(img, (p, margin), (p, margin + span), th["line"], 2, cv2.LINE_AA)

    # 星位
    if star_points and size >= 15:
        for a in (3, 7, 11):
            for b in (3, 7, 11):
                cv2.circle(img, (margin + a * spacing, margin + b * spacing),
                           3, th["line"], -1, cv2.LINE_AA)

    # 棋子
    r = int(round(spacing * 0.44))
    stones = stones or {}
    last = None
    for (x, y), col in stones.items():
        cx, cy = margin + x * spacing, margin + y * spacing
        last = (cx, cy)
        if col == 1:
            cv2.circle(img, (cx + 1, cy + 1), r, (30, 30, 30), -1, cv2.LINE_AA)
            cv2.circle(img, (cx, cy), r, th["black"], -1, cv2.LINE_AA)
            cv2.circle(img, (cx - r // 3, cy - r // 3), max(2, r // 3),
                       (110, 108, 104), -1, cv2.LINE_AA)
        else:
            cv2.circle(img, (cx + 1, cy + 1), r, (60, 60, 60), -1, cv2.LINE_AA)
            cv2.circle(img, (cx, cy), r, th["white"], -1, cv2.LINE_AA)
            cv2.circle(img, (cx, cy), r, th["line"], 1, cv2.LINE_AA)

    if last_marker and last:
        cv2.circle(img, last, max(2, r // 4), (40, 40, 220), -1, cv2.LINE_AA)

    if blur > 0:
        k = int(round(blur * 2)) * 2 + 1
        img = cv2.GaussianBlur(img, (k, k), blur)

    if angle:
        M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        img = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR,
                             borderMode=cv2.BORDER_REPLICATE)
    return img


def random_position(size=15, count=24, seed=1, margin=3):
    """随机摆 count 颗棋子（黑白交替）。

    旧实现在 ``count > 81`` 时会死循环（只从内圈 9x9 取点且用 while 重抽），
    这里改成先枚举全部候选点再 ``shuffle`` 取前 count 个，复杂度 O(n^2 log n)。
    ``margin=3`` 与旧版 ``randrange(3, size-3)`` 等价，保持既有测试用例不变。
    """
    rng = random.Random(seed)
    lo = max(0, margin)
    hi = size - lo
    cells = [(x, y) for y in range(lo, hi) for x in range(lo, hi)]
    rng.shuffle(cells)
    count = min(count, len(cells))
    return {cells[k]: 1 + (k % 2) for k in range(count)}


if __name__ == "__main__":
    import sys
    from pathlib import Path

    out_dir = Path(__file__).resolve().parent.parent / "assets" / "samples"
    out_dir.mkdir(parents=True, exist_ok=True)
    for theme in THEMES:
        pos = random_position(15, 24, seed=3)
        img = render(theme=theme, stones=pos)
        cv2.imwrite(str(out_dir / f"board_{theme}.png"), img)
    print(f"saved {len(THEMES)} samples to {out_dir}")
