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
    """五子棋 AI。choose(board) 返回 (x, y) 或 None，不修改传入的 board。

    可用 AI(level=3) 或 AI(config=EngineConfig.from_dict({...})) 指定精确参数。
    """

    # 难度档位表（真正定义在 engine.config.LEVELS）。
    LEVELS = {
        1: dict(time=0.06, depth=2, vcf=False),
        2: dict(time=0.80, depth=14, vcf=True),
        3: dict(time=2.0, depth=20, vcf=True),
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

        # 空盘走天元。
        if not board.moves and fallback_center:
            c = board.size // 2
            return (c, c)
        # 第二手在对手首子 ±2 内随机。
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
