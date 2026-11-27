"""聚焦第二轮：确认 defense_weight 峰值 + 时间预算拐点。

第一轮结论（12 局/候选）：defense_weight 单调上升，1.70 胜率 0.75 最强；
width / sort_defense 信号在噪声内。本轮：
1. defense_weight 在 1.5~1.8 细扫（ROUNDS=8 更可信）；
2. time_budget 拐点：候选(X) vs 候选(X/2)，看加一倍时间还值不值。

运行：python tools/_tune_peak2.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.config import EngineConfig
from engine.tuner import play_pair, save_result

WALL_LIMIT = 30 * 60
ROUNDS = 8


def _cfg(tb: float, dw: float, wd: int, wm: int) -> EngineConfig:
    c = EngineConfig()
    c.update({
        "search.time_budget": tb, "search.max_depth": 16,
        "search.width_deep": wd, "search.width_mid": wm,
        "eval.defense_weight": dw,
    })
    return c


def run_pair(cand, base, rounds):
    wins = total = 0.0
    t0 = time.perf_counter()
    for i in range(rounds):
        mr = play_pair(cand, base, size=15, opening_plies=4, seed=12000 + i)
        wins += mr.a_wins
        total += mr.a_wins + mr.b_wins
    dt = time.perf_counter() - t0
    return round(wins / total, 4) if total else 0.5, round(dt, 1)


def main():
    t_start = time.perf_counter()
    results = {}

    # 1) defense_weight 细扫：基线用 16/14 宽 + 0.6s（更接近"全力"强度）
    print("== defense_weight 细扫 (基线 0.6s/16w/1.15dw) ==", flush=True)
    base = _cfg(0.6, 1.15, 16, 12)
    results["defense_weight"] = []
    for name, dw in [("1.15", 1.15), ("1.40", 1.40), ("1.55", 1.55),
                     ("1.65", 1.65), ("1.75", 1.75), ("1.80", 1.80)]:
        if time.perf_counter() - t_start > WALL_LIMIT:
            break
        cand = _cfg(0.6, dw, 16, 12)
        rate, sec = run_pair(cand, base, ROUNDS)
        results["defense_weight"].append({"name": name, "rate": rate, "sec": sec})
        print(f"  {name:>5}  胜率 {rate:.3f}  ({sec}s)", flush=True)

    # 2) time_budget 拐点：候选(X) vs 候选(X/2)，固定强参数 dw=1.70
    print("\n== time_budget 拐点 (固定 dw=1.70/16w，X vs X/2) ==", flush=True)
    results["time_budget"] = []
    for name, tb in [("0.5s", 0.5), ("0.8s", 0.8), ("1.2s", 1.2),
                     ("1.8s", 1.8), ("2.5s", 2.5), ("3.0s", 3.0)]:
        if time.perf_counter() - t_start > WALL_LIMIT:
            break
        cand = _cfg(tb, 1.70, 16, 14)
        half = _cfg(tb / 2, 1.70, 16, 14)
        rate, sec = run_pair(cand, half, ROUNDS)
        results["time_budget"].append({"name": name, "rate_vs_half": rate, "sec": sec})
        print(f"  {name:>5} vs {tb/2:>4}s  胜率 {rate:.3f}  ({sec}s)", flush=True)

    elapsed = time.perf_counter() - t_start
    results["_elapsed_sec"] = round(elapsed, 1)
    out = save_result(results, "peak2")
    print(f"\n总耗时 {elapsed:.0f}s，结果已存 {out}", flush=True)


if __name__ == "__main__":
    main()
