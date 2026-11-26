"""开发自检：引擎功能 + 性能基准。

运行：python tools/_dev_engine.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import AI
from engine.board import Board
from engine.constants import BLACK, WHITE
from engine.eval import Evaluator
from engine.search import Searcher
from engine.tactics import find_vcf, immediate_move, winning_moves


def show(bd: Board, tag: str):
    print(f"\n--- {tag} ---")
    print(bd)


def test_basics():
    print("== 基础 ==")
    # 一行四子，黑该走，必须直接成五
    bd = Board(15)
    bd.place_color(5, 7, BLACK)
    bd.place_color(6, 7, BLACK)
    bd.place_color(7, 7, BLACK)
    bd.place_color(8, 7, BLACK)
    bd.side = BLACK
    wins = winning_moves(bd, BLACK)
    print("  黑四连成五点:", [(i % 15, i // 15) for i in wins])
    mv = immediate_move(bd, BLACK)
    print("  immediate_move:", None if mv is None else (mv % 15, mv // 15))

    # 白面对黑四连必须堵
    wins2 = winning_moves(bd, BLACK)
    mv2 = immediate_move(bd, WHITE)
    print("  白必堵点:", None if mv2 is None else (mv2 % 15, mv2 // 15))
    assert mv2 in wins2, "白没有去堵黑四连"


def test_win_detect():
    print("\n== 胜负判定 ==")
    bd = Board(15)
    for x in range(4, 9):
        bd.place_color(x, 7, BLACK)
    bd.side = BLACK
    print("  五连 winner:", bd.winner())
    assert bd.winner() == BLACK

    # 斜线
    bd2 = Board(15)
    for i in range(5):
        bd2.place_color(3 + i, 3 + i, WHITE)
    print("  斜五连 winner:", bd2.winner())
    assert bd2.winner() == WHITE


def test_vcf():
    print("\n== VCF ==")
    # 构造一个简单 VCF：黑有连续冲四机会
    bd = Board(15)
    # 黑: (5,7)(6,7)(7,7)；白挡两端
    for x in (5, 6, 7):
        bd.place_color(x, 7, BLACK)
    bd.place_color(4, 7, WHITE)
    bd.place_color(8, 7, WHITE)
    bd.side = BLACK
    res = find_vcf(bd, BLACK, max_depth=6)
    print("  VCF:", None if res is None else [(i % 15, i // 15) for i in res])


def test_search():
    print("\n== 搜索 ==")
    bd = Board(15)
    bd.place_color(7, 7, BLACK)
    bd.place_color(8, 8, WHITE)
    bd.side = BLACK
    for level in (1, 2, 3):
        ai = AI(level=level, seed=1)
        t0 = time.perf_counter()
        mv = ai.choose(bd)
        dt = time.perf_counter() - t0
        r = ai.last_result
        print(f"  level={level} move={mv} score={r.score if r else None} "
              f"depth={r.depth if r else None} nodes={r.nodes if r else None} "
              f"elapsed={dt:.3f}s reason={r.reason if r else None}")


def test_selfplay():
    print("\n== 自对弈 ==")
    bd = Board(15)
    ai_b = AI(level=2, seed=1)
    ai_w = AI(level=2, seed=2)
    t0 = time.perf_counter()
    moves = 0
    while not bd.is_full:
        ai = ai_b if bd.side == BLACK else ai_w
        mv = ai.choose(bd)
        if mv is None:
            break
        bd.place(mv[0], mv[1])
        moves += 1
        if bd.winner():
            break
        if moves >= 60:
            break
    dt = time.perf_counter() - t0
    print(f"  手数={moves} 胜方={bd.winner()} 耗时={dt:.2f}s ({dt/max(moves,1):.2f}s/手)")


def test_bench():
    print("\n== 性能 ==")
    bd = Board(15)
    # 摆一个中局
    bb = [(7, 7), (8, 7), (7, 8), (6, 7), (8, 8), (9, 6)]
    ww = [(8, 6), (6, 8), (9, 7), (5, 7), (7, 6), (10, 5)]
    for x, y in bb:
        bd.place_color(x, y, BLACK)
    for x, y in ww:
        bd.place_color(x, y, WHITE)
    bd.side = BLACK

    ev = Evaluator()
    t0 = time.perf_counter()
    n = 2000
    for _ in range(n):
        ev.evaluate(bd, BLACK)
    dt = time.perf_counter() - t0
    print(f"  evaluate: {n} 次 {dt:.3f}s → {n/dt:,.0f} 次/秒")

    s = Searcher(time_budget=1.0, max_depth=8)
    t0 = time.perf_counter()
    res = s.search(bd)
    dt = time.perf_counter() - t0
    print(f"  search 1s: move={res.move} score={res.score} depth={res.depth} "
          f"nodes={res.nodes} elapsed={dt:.3f}s nps={res.nodes/max(dt,1e-9):,.0f}")


if __name__ == "__main__":
    test_basics()
    test_win_detect()
    test_vcf()
    test_search()
    test_selfplay()
    test_bench()
