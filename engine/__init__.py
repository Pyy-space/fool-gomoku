"""引擎门面：对外只暴露一个 AI 类，屏蔽内部搜索细节。"""

from __future__ import annotations

import random
from typing import Optional

from .board import Board
from .config import EngineConfig, config_for_level
from .constants import (
    BLACK,
    RULES_CASUAL,
    opponent,
)
from .eval import Evaluator
from .search import SearchResult, Searcher
from .tactics import double_threat_moves, threat_moves, winning_moves


class AI:
    """五子棋 AI。

    用法::

        ai = AI(level=3)
        move = ai.choose(board)   # 返回 (x, y) 或 None

        # 或指定精确参数（自我对弈调参用）：
        ai = AI(config=EngineConfig.from_dict({"eval.defense_weight": 1.3}))

    ``board`` 是 :class:`engine.board.Board`，调用后不会被修改
    （搜索内部全部成对 place/undo）。
    """

    # 兼容旧接口的档位表（真正的定义在 engine.config.LEVELS）
    LEVELS = {
        1: dict(time=0.15, depth=2, vcf=False),
        2: dict(time=0.4, depth=4, vcf=True),
        3: dict(time=1.0, depth=6, vcf=True),
        4: dict(time=2.5, depth=8, vcf=True),
        5: dict(time=5.0, depth=10, vcf=True),
    }

    def __init__(self, level: int = 3, rules: str = RULES_CASUAL,
                 config: Optional[EngineConfig] = None,
                 time_budget: Optional[float] = None,
                 max_depth: Optional[int] = None,
                 seed: Optional[int] = None):
        self.level = level
        self.rules = rules
        self.config = config if config is not None else config_for_level(level)
        self.searcher = Searcher(
            config=self.config,
            time_budget=time_budget,
            max_depth=max_depth,
        )
        self.rng = random.Random(seed)
        self.last_result: Optional[SearchResult] = None

    # -- 主接口 -------------------------------------------------------------
    def choose(self, board: Board, fallback_center: bool = True) -> Optional[tuple[int, int]]:
        """为当前行棋方选择落点。不修改传入的 board。"""
        if board.is_full or board.winner():
            return None

        # 开局：空盘走天元
        if not board.moves and fallback_center:
            c = board.size // 2
            return (c, c)
        # 第二手贴近对手首子随机一个小偏移，避免每局一样
        if len(board.moves) == 1 and self.level >= 2 and self.rng is not None:
            mx, my = board.moves[0]
            cand = []
            for dx in range(-2, 3):
                for dy in range(-2, 3):
                    if dx == 0 and dy == 0:
                        continue
                    x, y = mx + dx, my + dy
                    if board.inside(x, y) and board.is_empty_at(x, y):
                        cand.append((x, y))
            if cand:
                return self.rng.choice(cand)

        result = self.searcher.search(board)
        self.last_result = result
        return result.move

    # -- 带解释的调试接口 ---------------------------------------------------
    def analyse(self, board: Board) -> dict:
        res = self.searcher.search(board)
        self.last_result = res
        me = board.side
        opp = opponent(me)
        return {
            "move": {"x": res.move[0], "y": res.move[1]} if res.move else None,
            "score": res.score,
            "depth": res.depth,
            "nodes": res.nodes,
            "elapsed_ms": round(res.elapsed * 1000, 1),
            "reason": res.reason,
            "pv": [{"x": x, "y": y} for x, y in res.pv],
            "threats": {
                "my_five_points": [self._as_xy(i, board) for i in winning_moves(board, me)],
                "opp_five_points": [self._as_xy(i, board) for i in winning_moves(board, opp)],
                "my_double_threats": [self._as_xy(i, board) for i in double_threat_moves(board, me)],
                "opp_double_threats": [self._as_xy(i, board) for i in double_threat_moves(board, opp)],
            },
        }

    # -- 供 UI 用的局面简报 -------------------------------------------------
    def brief(self, board: Board) -> dict:
        me = board.side
        opp = opponent(me)
        return {
            "side": me,
            "my_immediate_win": [self._as_xy(i, board) for i in winning_moves(board, me)],
            "opp_immediate_win": [self._as_xy(i, board) for i in winning_moves(board, opp)],
            "my_double_threats": [self._as_xy(i, board) for i in double_threat_moves(board, me)],
            "opp_double_threats": [self._as_xy(i, board) for i in double_threat_moves(board, opp)],
            "my_threats": [self._as_xy(i, board) for i in threat_moves(board, me)],
            "opp_threats": [self._as_xy(i, board) for i in threat_moves(board, opp)],
        }

    @staticmethod
    def _as_xy(idx: int, board: Board) -> dict:
        return {"x": idx % board.size, "y": idx // board.size}


# 向后兼容的模块级名字
__all__ = ["AI", "Board", "EngineConfig", "Evaluator", "Searcher", "SearchResult"]
