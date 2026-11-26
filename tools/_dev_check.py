"""开发自检：构建/加载棋型表，并验证经典局面的分类是否正确。

运行：python tools/_dev_check.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import patterns
from engine.board import Board
from engine.constants import BLACK, WHITE
from engine.patterns import SHAPE_NAMES, build_tables, shape_name


def check(name: str, got, want):
    ok = got == want
    print(f"  {'OK ' if ok else 'FAIL'} {name}: got={got} want={want}")
    return ok


def put(bd: Board, pts, color=BLACK):
    for x, y in pts:
        bd.place_color(x, y, color)


def main() -> int:
    # 强制重建，避免磁盘缓存与代码不一致
    if patterns._ASSET_BIN.exists():
        patterns._ASSET_BIN.unlink()

    t0 = time.perf_counter()
    b, w = build_tables()
    dt = time.perf_counter() - t0
    n = patterns.PACKED_SIZE
    print(f"build_tables: {dt:.2f}s, entries={n}")

    dist = [0] * len(SHAPE_NAMES)
    valid = 0
    for code in range(n):
        if ((code >> patterns.CENTER_SHIFT) & 3) != BLACK:
            continue
        valid += 1
        dist[b[code]] += 1
    print(f"  有效局面(中心=黑): {valid}")
    for i, name in enumerate(SHAPE_NAMES):
        print(f"  {name:>11}: {dist[i]}")
    print(f"  合计={sum(dist)} " + ("OK" if sum(dist) == valid else "FAIL"))

    ok = True
    # 1) 三连 + 落第 4 子 → 两端都空 = 活四
    bd = Board(15); put(bd, [(5, 7), (6, 7), (7, 7)])
    ok &= check("三连补第4子(两端空)", shape_name(BLACK, bd.window_code(8, 7, 0)), "OPEN_FOUR")

    # 2) 四连 + 落第 5 子 → 五
    bd = Board(15); put(bd, [(5, 7), (6, 7), (7, 7), (8, 7)])
    ok &= check("四连补第5子", shape_name(BLACK, bd.window_code(9, 7, 0)), "FIVE")

    # 3) X . X 补中间 → 活三
    bd = Board(15); put(bd, [(5, 7), (7, 7)])
    ok &= check("两连补中间", shape_name(BLACK, bd.window_code(6, 7, 0)), "OPEN_THREE")

    # 4) 一端被对手堵的两连补中间 → 眠三（右侧仍可延伸）
    bd = Board(15); put(bd, [(5, 7), (7, 7)]); put(bd, [(4, 7)], WHITE)
    ok &= check("一端被堵两连补中间", shape_name(BLACK, bd.window_code(6, 7, 0)), "THREE")

    # 4b) 两端都被堵的两连补中间 → 死三，永远成不了五，应判 NONE
    bd = Board(15); put(bd, [(5, 7), (7, 7)]); put(bd, [(4, 7), (8, 7)], WHITE)
    ok &= check("两端被堵两连补中间(死三)", shape_name(BLACK, bd.window_code(6, 7, 0)), "NONE")

    # 5) 三连外侧补一子 → 活四
    bd = Board(15); put(bd, [(5, 7), (6, 7), (7, 7)])
    ok &= check("三连左侧补子", shape_name(BLACK, bd.window_code(4, 7, 0)), "OPEN_FOUR")

    # 6) 空盘
    bd = Board(15)
    ok &= check("空盘", shape_name(BLACK, bd.window_code(7, 7, 0)), "NONE")

    # 7) 四个方向一致性
    bd = Board(15); put(bd, [(7, 5), (7, 6), (7, 7)])
    ok &= check("竖排三连补子", shape_name(BLACK, bd.window_code(7, 8, 1)), "OPEN_FOUR")

    bd = Board(15); put(bd, [(5, 5), (6, 6), (7, 7)])
    ok &= check("撇三连补子", shape_name(BLACK, bd.window_code(8, 8, 2)), "OPEN_FOUR")

    bd = Board(15); put(bd, [(5, 9), (6, 8), (7, 7)])
    ok &= check("捺三连补子", shape_name(BLACK, bd.window_code(8, 6, 3)), "OPEN_FOUR")

    # 8) 对方视角：白棋看自己应是活四，黑棋看同一处应是阻挡
    bd = Board(15); put(bd, [(5, 7), (6, 7), (7, 7)], WHITE)
    ok &= check("白视角三连", shape_name(WHITE, bd.window_code(8, 7, 0)), "OPEN_FOUR")
    ok &= check("黑视角同点", shape_name(BLACK, bd.window_code(8, 7, 0)), "NONE")

    # 9) 冲四（只有一端能成五）
    bd = Board(15); put(bd, [(5, 7), (6, 7), (7, 7)]); put(bd, [(4, 7)], WHITE)
    ok &= check("一端被堵三连", shape_name(BLACK, bd.window_code(8, 7, 0)), "FOUR")

    # 10) 只有空点才查询：point_shapes 对已占点返回 {}
    bd = Board(15); put(bd, [(5, 7), (6, 7), (7, 7)])
    from engine.patterns import point_shapes
    ok &= check("已占点 point_shapes", point_shapes(bd, 6, 7, BLACK), {})

    print("\nRESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
