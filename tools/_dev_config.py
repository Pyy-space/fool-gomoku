"""开发自检：EngineConfig 与超参数接线。

运行：python tools/_dev_config.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import AI
from engine.board import Board
from engine.config import TUNING_SPACE, EngineConfig, config_for_level
from engine.constants import BLACK
from engine.search import Searcher


def mid_board() -> Board:
    bd = Board(15)
    bb = [(7, 7), (8, 7), (7, 8), (6, 7), (8, 8), (9, 6)]
    ww = [(8, 6), (6, 8), (9, 7), (5, 7), (7, 6), (10, 5)]
    for x, y in bb:
        bd.place_color(x, y, BLACK)
    for x, y in ww:
        bd.place_color(x, y, 2)
    bd.side = BLACK
    return bd


def test_flat_roundtrip():
    print("== 扁平读写 ==")
    cfg = EngineConfig()
    flat = cfg.flat()
    print(f"  项数={len(flat)}  defense_weight={flat['eval.defense_weight']} "
          f"width_deep={flat['search.width_deep']}")
    cfg2 = EngineConfig.from_dict({"eval.defense_weight": 1.4,
                                   "search.width_deep": 20,
                                   "search.use_vcf": False})
    assert cfg2.eval.defense_weight == 1.4
    assert cfg2.search.width_deep == 20
    assert cfg2.search.use_vcf is False
    assert cfg.flat()["eval.defense_weight"] == 1.15, "原对象被污染"
    print("  from_dict OK，原对象未被污染")

    cfg3 = cfg.copy()
    cfg3.update({"search.max_depth": 4})
    assert cfg.search.max_depth == 8 and cfg3.search.max_depth == 4
    print("  copy/update 独立性 OK")

    p = cfg.save("output/_cfg_test.json")
    cfg4 = EngineConfig.load(p)
    assert cfg4.flat() == cfg.flat()
    print(f"  save/load OK -> {p.relative_to(p.parent.parent)}")
    p.unlink()


def test_levels():
    print("\n== 难度档位 ==")
    for lv in (1, 3, 5):
        cfg = config_for_level(lv)
        print(f"  level={lv} time={cfg.search.time_budget}s depth={cfg.search.max_depth} "
              f"vcf={cfg.search.use_vcf}")


def test_params_affect_search():
    print("\n== 参数是否真的生效 ==")
    bd = mid_board()
    for label, over in [
        ("base", {}),
        ("defw=0.8", {"eval.defense_weight": 0.8}),
        ("defw=1.7", {"eval.defense_weight": 1.7}),
        ("width=8", {"search.width_deep": 8, "search.width_mid": 8}),
    ]:
        cfg = EngineConfig.from_dict(over)
        s = Searcher(config=cfg, time_budget=0.6, max_depth=6)
        t0 = time.perf_counter()
        res = s.search(bd)
        dt = time.perf_counter() - t0
        print(f"  {label:10s} move={res.move} score={res.score:9.1f} "
              f"depth={res.depth} nodes={res.nodes:5d} {dt:.3f}s")


def test_tuning_space():
    print("\n== 调参空间 ==")
    for k, (lo, hi, is_int) in TUNING_SPACE.items():
        print(f"  {k:26s} [{lo}, {hi}] {'int' if is_int else 'float'}")


def test_ai_with_config():
    print("\n== AI 直接吃 config ==")
    bd = mid_board()
    cfg = EngineConfig.from_dict({"eval.defense_weight": 1.3,
                                  "search.time_budget": 0.3,
                                  "search.max_depth": 4})
    ai = AI(config=cfg, seed=1)
    mv = ai.choose(bd)
    print(f"  move={mv} reason={ai.last_result.reason} depth={ai.last_result.depth}")


if __name__ == "__main__":
    test_flat_roundtrip()
    test_levels()
    test_params_affect_search()
    test_tuning_space()
    test_ai_with_config()
    print("\nRESULT: PASS")
