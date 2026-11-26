"""开发自检：自我对弈调参器。

运行：python tools/_dev_tuner.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.config import TUNING_SPACE, EngineConfig
from engine.tuner import (_opening, benchmark, coordinate_search, play_game,
                          play_pair, save_result, spsa)

FAST = {"search.time_budget": 0.06, "search.max_depth": 2}


def test_opening():
    print("== 开局生成 ==")
    op = _opening(15, 4, __import__("random").Random(7))
    print(f"  4 手开局: {op}")
    assert len(op) == 4
    op2 = _opening(15, 4, __import__("random").Random(7))
    assert op == op2, "同种子应生成同开局"
    print("  同种子可复现 OK")


def test_play_game():
    print("\n== 单局 ==")
    cfg = EngineConfig(); cfg.update(FAST)
    t0 = time.perf_counter()
    g = play_game(cfg, cfg, seed=3)
    dt = time.perf_counter() - t0
    print(f"  胜方={g.winner} 手数={g.moves} 耗时={dt:.2f}s")
    assert g.moves > 5


def test_play_pair():
    print("\n== 配对赛（同开局正反手） ==")
    cfg_a = EngineConfig.from_dict({"eval.defense_weight": 0.9}); cfg_a.update(FAST)
    cfg_b = EngineConfig.from_dict({"eval.defense_weight": 1.5}); cfg_b.update(FAST)
    t0 = time.perf_counter()
    mr = play_pair(cfg_a, cfg_b, seed=11)
    dt = time.perf_counter() - t0
    print(f"  开局={mr.opening}")
    for g in mr.games:
        print(f"    {g.black}(黑) vs {g.white}(白) -> 胜方={g.winner} {g.moves} 手")
    print(f"  A 得分 {mr.a_wins} : B {mr.b_wins}  耗时 {dt:.2f}s")
    assert mr.a_wins + mr.b_wins == 2.0


def test_coordinate_search_short():
    print("\n== 坐标搜索（极小规模） ==")
    cfg = EngineConfig(); cfg.update(FAST)
    t0 = time.perf_counter()
    seen = []

    def prog(ev):
        if "rate" in ev:
            seen.append(ev)
            print(f"    {ev['phase'][:34]:34s} round {ev['round']}/{ev['rounds']} "
                  f"rate={ev['rate']}")
    res = coordinate_search(base=cfg, rounds_per_trial=1, max_passes=1,
                            on_progress=prog)
    dt = time.perf_counter() - t0
    print(f"  最优参数: { {k: round(v, 3) for k, v in res['best'].items()} }")
    print(f"  试验 {len(res['history'])} 次, 耗时 {dt:.1f}s")
    assert res["history"]


def test_save():
    print("\n== 结果落盘 ==")
    cfg = EngineConfig(); cfg.update(FAST)
    res = {"best": {"eval.defense_weight": 1.2}, "history": []}
    p = save_result(res, tag="selftest")
    print(f"  写入 {p}")
    assert p.exists()
    p.unlink()


def test_benchmark():
    print("\n== 基准对比 ==")
    cfg = EngineConfig.from_dict({"eval.defense_weight": 1.15}); cfg.update(FAST)
    r = benchmark(cfg, rounds=1)
    print(f"  对默认参数胜率: {r['rate_vs_default']}")


if __name__ == "__main__":
    test_opening()
    test_play_game()
    test_play_pair()
    test_coordinate_search_short()
    test_save()
    test_benchmark()
    print("\nRESULT: PASS")
