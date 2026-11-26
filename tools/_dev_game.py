"""开发自检：对局会话层（GameSession）。

运行：python tools/_dev_game.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.config import EngineConfig
from engine.constants import BLACK, WHITE
from core.game import GameSession


def test_basic_flow():
    print("== 基本流程 ==")
    g = GameSession(size=15, human_color=BLACK)
    g.reset(level=2, human_color=BLACK, seed=1)
    r = g.place(7, 7, by="human")
    assert r["ok"], r
    print(f"  人落 (7,7) -> side={g.side} 记录={len(g.records)}")
    r2 = g.ai_move()
    assert r2["ok"], r2
    print(f"  AI 应手 {r2['move']} reason={r2['analysis']['reason']} "
          f"depth={r2['analysis']['depth']}")
    assert g.side == BLACK
    print(f"  回到人方：side={g.side}")


def test_illegal():
    print("\n== 非法落子 ==")
    g = GameSession(size=15, human_color=BLACK)
    g.reset(level=1, human_color=BLACK, seed=1)
    g.place(7, 7)
    g.ai_move()
    cases = [("已占点", 7, 7), ("越界", 20, 20), ("负数", -1, 3)]
    for label, x, y in cases:
        r = g.place(x, y)
        print(f"  {label}: ok={r['ok']} reason={r.get('reason')}")
        assert not r["ok"]


def test_undo():
    print("\n== 悔棋 ==")
    g = GameSession(size=15, human_color=BLACK)
    g.reset(level=1, human_color=BLACK, seed=1)
    g.place(7, 7)
    g.ai_move()
    g.place(8, 8)
    n_before = g.board.stone_count
    print(f"  悔棋前 {n_before} 子, side={g.side}")
    ok = g.undo(2)
    print(f"  悔 {ok} 步 → {g.board.stone_count} 子, side={g.side}")
    assert g.board.stone_count == n_before - 2
    _ = g.undo(99)
    print(f"  狂按悔棋 → {g.board.stone_count} 子")
    assert g.board.stone_count == 0


def test_win():
    print("\n== 胜负 ==")
    g = GameSession(size=15, human_color=BLACK)
    g.reset(level=1, human_color=WHITE, seed=1)
    # 人执白，先让 AI(黑) 走一手占位，再手工摆黑四连让人堵
    for x in range(3, 7):
        g.board.place_color(x, 7, BLACK)
    g.board.side = BLACK
    r = g.place(7, 7, color=BLACK)
    assert r["ok"], r
    print(f"  黑五连后 winner={g.winner} over={g.over}")
    assert g.winner == BLACK
    assert g.place(1, 1)["ok"] is False


def test_sync():
    print("\n== 识别同步 ==")
    g = GameSession(size=15, human_color=0)
    g.reset(size=15, human_color=0, level=1)
    grid = [0] * 225
    grid[7 * 15 + 7] = BLACK
    grid[8 * 15 + 8] = WHITE
    rep = g.sync(grid)
    print(f"  同步新增 {len(rep.applied)} 子: {rep.applied}")
    print(f"  内部棋盘 {g.board.stone_count} 子, 轮到 {'黑' if g.side == BLACK else '白'}")
    assert g.board.stone_count == 2
    assert g.side == BLACK

    # 再来一颗敌方子
    grid[9 * 15 + 9] = BLACK
    rep2 = g.sync(grid)
    print(f"  再同步新增 {len(rep2.applied)} 子 → {g.board.stone_count} 子")
    assert g.board.stone_count == 3

    # 颜色冲突
    bad = list(grid)
    bad[7 * 15 + 7] = WHITE
    rep3 = g.sync(bad)
    print(f"  冲突 {len(rep3.conflicts)} 处（>2 则不落子）")
    assert g.board.stone_count == 3


def test_state_serialization():
    print("\n== 状态序列化 ==")
    g = GameSession(size=15, human_color=BLACK)
    g.reset(level=1, human_color=BLACK, seed=1)
    g.place(7, 7)
    st = g.state()
    print(f"  keys={sorted(st.keys())}")
    print(f"  size={st['size']} side={st['side']} stones={st['stones']} "
          f"last={st['last']} over={st['over']}")
    assert len(st["grid"]) == 225
    assert len(st["rows"]) == 15
    assert st["last"] == {"x": 7, "y": 7}


def test_ai_vs_ai_config():
    print("\n== 两副参数同时存在（自我对弈前提） ==")
    cfg_a = EngineConfig.from_dict({"eval.defense_weight": 0.9,
                                    "search.time_budget": 0.15,
                                    "search.max_depth": 2})
    cfg_b = EngineConfig.from_dict({"eval.defense_weight": 1.5,
                                    "search.time_budget": 0.15,
                                    "search.max_depth": 2})
    g = GameSession(size=15, human_color=0)
    g.reset(level=3, human_color=0, ai_config=cfg_a, seed=7)
    a_move = g.ai_move()
    print(f"  A(defw=0.9) -> {a_move['move']}")
    g.reset(level=3, human_color=0, ai_config=cfg_b, seed=7)
    b_move = g.ai_move()
    print(f"  B(defw=1.5) -> {b_move['move']}")
    assert a_move["ok"] and b_move["ok"]


if __name__ == "__main__":
    test_basic_flow()
    test_illegal()
    test_undo()
    test_win()
    test_sync()
    test_state_serialization()
    test_ai_vs_ai_config()
    print("\nRESULT: PASS")
