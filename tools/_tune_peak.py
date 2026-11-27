"""本地自对弈参数扫描：找「参数 vs 强度」曲线的峰值。

方法：候选参数 vs 基线跑多轮配对赛（同开局正反各一局）。胜率 >0.5
说明比基线强。全局墙钟上限约一小时。ROUNDS 设大到能压过噪声。

运行：python tools/_tune_peak.py  （cwd = fool-gomoku）
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.config import EngineConfig
from engine.tuner import play_pair, save_result

WALL_LIMIT = 55 * 60          # 约 55 分钟
TUNE_BUDGET = 0.25            # 调参用每步预算（游戏快、能多跑几轮）
ROUNDS = 6                    # 每候选 6 轮 = 12 局，压噪声

BASELINE = EngineConfig()
BASELINE.update({"search.time_budget": TUNE_BUDGET, "search.max_depth": 8,
                 "search.width_deep": 16, "search.width_mid": 12})


def _cfg(**kw) -> EngineConfig:
    c = EngineConfig()
    c.update({"search.time_budget": TUNE_BUDGET, "search.max_depth": 8,
              "search.width_deep": 16, "search.width_mid": 12})
    c.update(kw)
    return c


# 三组扫描：宽度（影响最大）、防守权重（细调）、排序防守（细调）。
# 时间预算单独一组，看「落子速度 vs 强度」拐点。
SWEEPS = {
    "width": [
        ("08/06", {"search.width_deep": 8, "search.width_mid": 6}),
        ("10/08", {"search.width_deep": 10, "search.width_mid": 8}),
        ("12/10", {"search.width_deep": 12, "search.width_mid": 10}),
        ("14/12", {"search.width_deep": 14, "search.width_mid": 12}),
        ("16/14", {"search.width_deep": 16, "search.width_mid": 14}),
        ("20/16", {"search.width_deep": 20, "search.width_mid": 16}),
    ],
    "defense_weight": [
        ("0.90", {"eval.defense_weight": 0.90}),
        ("1.10", {"eval.defense_weight": 1.10}),
        ("1.30", {"eval.defense_weight": 1.30}),
        ("1.50", {"eval.defense_weight": 1.50}),
        ("1.70", {"eval.defense_weight": 1.70}),
    ],
    "sort_defense": [
        ("0.90", {"search.sort_defense": 0.90}),
        ("1.15", {"search.sort_defense": 1.15}),
        ("1.40", {"search.sort_defense": 1.40}),
        ("1.60", {"search.sort_defense": 1.60}),
    ],
}


def run_pair(cand: EngineConfig, base: EngineConfig, rounds: int) -> dict:
    wins = 0.0
    total = 0.0
    t0 = time.perf_counter()
    for i in range(rounds):
        mr = play_pair(cand, base, size=15, opening_plies=4, seed=9000 + i)
        wins += mr.a_wins
        total += mr.a_wins + mr.b_wins
    dt = time.perf_counter() - t0
    return {"rate": round(wins / total, 4) if total else 0.5,
            "a": round(wins, 1), "total": round(total, 1), "sec": round(dt, 1)}


def main() -> None:
    t_start = time.perf_counter()
    results = {}

    for group, items in SWEEPS.items():
        print(f"\n== {group} (vs 基线 {TUNE_BUDGET}s/{BASELINE.search.width_deep}w) ==",
              flush=True)
        results[group] = []
        for name, kw in items:
            if time.perf_counter() - t_start > WALL_LIMIT:
                print("  [墙钟到，提前结束]", flush=True)
                break
            r = run_pair(_cfg(**kw), BASELINE, ROUNDS)
            results[group].append({"name": name, **r})
            print(f"  {name:>8}  胜率 {r['rate']:.3f}  ({r['sec']:.0f}s)", flush=True)

    elapsed = time.perf_counter() - t_start
    results["_elapsed_sec"] = round(elapsed, 1)
    out = save_result(results, "peak")
    print(f"\n总耗时 {elapsed:.0f}s，结果已存 {out}", flush=True)


if __name__ == "__main__":
    main()
