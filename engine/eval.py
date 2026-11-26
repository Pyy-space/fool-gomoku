"""局面评估函数。

评估约定：返回**当前行棋方**视角的分值，正数表示优势。

做法：对候选空点统计「若我落此点、若对手落此点」的棋型分，
用双方势能差作为局面分。这正好复用棋型表，且天然反映下一步威胁。

攻防权重略偏防守（1.15），因为漏挡一次成五/活四的代价远高于自己少抢一分。
"""

from __future__ import annotations

from typing import Callable, Optional

from .board import Board
from .constants import EMPTY, FIVE, FOUR, OPEN_FOUR, OPEN_THREE, TWO, opponent
from .patterns import SHAPE_NAMES, score_table

ATTACK_WEIGHT = 1.0
DEFENSE_WEIGHT = 1.15

# 单点势能封顶：避免一个活四(120k)压过整盘其他所有势能
_POINT_CAP = 200_000
_CAP_IDX = 4          # SHAPE_NAMES 中 FOUR 及其以上视为"必须封顶"


class Evaluator:
    """启发式评估器（可选接入 NNUE）。"""

    def __init__(self, defense_weight: float = DEFENSE_WEIGHT,
                 point_cap: int = _POINT_CAP,
                 nnue: Optional[Callable[[Board, int], float]] = None):
        self.defense_weight = defense_weight
        self.point_cap = int(point_cap)
        self.nnue = nnue

    # -- 势能 ---------------------------------------------------------------
    def threat_potential(self, board: Board, color: int, points=None) -> int:
        """color 一方在候选空点上的总威胁势能。"""
        grid = board.grid
        st = score_table(color)
        sh = color << 8
        cap = self.point_cap
        total = 0
        size = board.size
        for idx in (points if points is not None else board.neighbourhood(2)):
            if grid[idx]:
                continue
            x, y = idx % size, idx // size
            c0, c1, c2, c3 = board.windows4(x, y)
            v = st[c0 | sh] + st[c1 | sh] + st[c2 | sh] + st[c3 | sh]
            total += v if v < cap else cap
        return total

    def evaluate_heuristic(self, board: Board, side: int, points=None) -> float:
        if points is None:
            points = board.neighbourhood(2)
        me = self.threat_potential(board, side, points)
        opp = self.threat_potential(board, opponent(side), points)
        return float(me) - self.defense_weight * float(opp)

    # -- 公共入口 -----------------------------------------------------------
    def evaluate(self, board: Board, side: int, points=None) -> float:
        if self.nnue is not None:
            return float(self.nnue(board, side))
        return self.evaluate_heuristic(board, side, points)

    # -- 终局 ---------------------------------------------------------------
    @staticmethod
    def terminal_score(board: Board, side: int):
        """若局面已终局返回 side 视角分值，否则 None。"""
        w = board.winner()
        if w == 0:
            return 0.0 if board.is_full else None
        return 1e9 if w == side else -1e9
