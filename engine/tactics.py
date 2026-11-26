"""战术层：必胜 / 必防 / 双威胁 / VCF（连续冲四取胜）。

这一层在搜索之前运行，直接处理掉"一步定生死"的局面，
避免把宝贵的搜索深度浪费在已经分出胜负的地方。
"""

from __future__ import annotations

from .board import Board
from .constants import EMPTY, FIVE, FOUR, NONE, OPEN_FOUR, OPEN_THREE, opponent
from .patterns import SHAPE_RANK, point_shapes, point_score, shape_name

# 形状强弱排序
_RANK = SHAPE_RANK

# 一步成五的判定阈值（见 winning_moves 注释）
_FIVE_SCORE = 10_000_000


def winning_moves(board: Board, color: int) -> list[int]:
    """color 一步成五的所有点（索引形式）。

    用 `point_score` 的四方向和做判定：FIVE=10_000_000，其余四种形状
    合计上限 4*120_000=480_000，所以 >= 10_000_000 当且仅当至少一个
    方向是五连。这比逐方向查表快一倍以上（VCF 内层高频调用）。
    """
    out = []
    grid = board.grid
    size = board.size
    for idx in board.neighbourhood(2):
        if grid[idx] != EMPTY:
            continue
        x, y = idx % size, idx // size
        if point_score(board, x, y, color) >= _FIVE_SCORE:
            out.append(idx)
    return out


def immediate_move(board: Board, color: int) -> int | None:
    """最高优先级的确定性决策。返回 None 表示交给搜索。"""
    # 1) 我能一步成五
    wins = winning_moves(board, color)
    if wins:
        return wins[0]

    # 2) 对手一步成五 → 必须堵
    blocks = winning_moves(board, opponent(color))
    if blocks:
        if len(blocks) == 1:
            return blocks[0]
        # 多个成五点堵不完，选对己方最有价值的
        size = board.size
        return max(blocks, key=lambda i: point_score(board, i % size, i // size, color))

    return None


def threat_moves(board: Board, color: int, min_shape: str = OPEN_THREE) -> list[int]:
    """能形成 >= min_shape 威胁的点。"""
    threshold = _RANK[min_shape]
    out = []
    grid = board.grid
    size = board.size
    for idx in board.neighbourhood(2):
        if grid[idx] != EMPTY:
            continue
        x, y = idx % size, idx // size
        shapes = point_shapes(board, x, y, color)
        if not shapes:
            continue
        if max(_RANK[s] for s in shapes) >= threshold:
            out.append(idx)
    return out


def double_threat_moves(board: Board, color: int) -> list[int]:
    """双威胁点：两个四，或一个四 + 一个活三（对手挡不住）。"""
    out = []
    grid = board.grid
    size = board.size
    for idx in board.neighbourhood(2):
        if grid[idx] != EMPTY:
            continue
        x, y = idx % size, idx // size
        shapes = point_shapes(board, x, y, color)
        if not shapes or shapes.get(FIVE, 0):
            continue
        fours = shapes.get(FOUR, 0) + shapes.get(OPEN_FOUR, 0)
        threes = shapes.get(OPEN_THREE, 0)
        if fours >= 2 or (fours >= 1 and threes >= 1):
            out.append(idx)
    return out


# ---------------------------------------------------------------------------
# VCF: Victory by Continuous Four —— 连续冲四逼对方应手后取胜
# ---------------------------------------------------------------------------
class VCFSolver:
    """VCF 搜索：我方连续冲四，对方被迫防守，直到成五。

    只扩「冲四」走法（对方必须应），深度有限，因此极快，
    是五子棋程序最有效的取胜手段。
    """

    __slots__ = ("root", "color", "opp", "max_depth", "node_limit",
                 "nodes", "line", "_seen")

    def __init__(self, board: Board, color: int, max_depth: int = 12,
                 node_limit: int = 200_000):
        self.root = board
        self.color = color
        self.opp = opponent(color)
        self.max_depth = max_depth
        self.node_limit = node_limit
        self.nodes = 0
        self.line: list[int] = []
        self._seen: set[int] = set()

    # -- 内部 ---------------------------------------------------------------
    def _four_moves(self, b: Board) -> list[int]:
        """我方所有能形成「冲四 / 活四 / 成五」的点。"""
        out = []
        grid = b.grid
        size = b.size
        sh = self.color << 8
        for idx in b.neighbourhood(2):
            if grid[idx] != EMPTY:
                continue
            x, y = idx % size, idx // size
            c0, c1, c2, c3 = b.windows4(x, y)
            best = max(_RANK[shape_name(self.color, c0)],
                       _RANK[shape_name(self.color, c1)],
                       _RANK[shape_name(self.color, c2)],
                       _RANK[shape_name(self.color, c3)])
            if best >= 5:               # FOUR / OPEN_FOUR / FIVE
                out.append(idx)
        return out

    # -- 主入口 -------------------------------------------------------------
    def solve(self) -> list[int] | None:
        self.nodes = 0
        self.line = []
        self._seen.clear()
        return self._search(self.root, 0)

    def _defenses(self, b: Board) -> list[int]:
        """当前局面下我方一步成五的点，即对手必须堵的点。"""
        return winning_moves(b, self.color)

    def _search(self, b: Board, depth: int) -> list[int] | None:
        if depth > self.max_depth or self.nodes > self.node_limit:
            return None
        self.nodes += 1

        # 直接成五
        wins = winning_moves(b, self.color)
        if wins:
            return [wins[0]]

        if depth >= self.max_depth:
            return None

        key = b.zobrist
        if key in self._seen:
            return None
        self._seen.add(key)

        size = b.size
        for mv in self._four_moves(b):
            mx, my = mv % size, mv // size
            b.place_color(mx, my, self.color)
            try:
                if b.is_win_at(mx, my):
                    return [mv]
                defenses = winning_moves(b, self.color)
                if len(defenses) >= 2:
                    # 活四：两个成五点，对方挡不住
                    return [mv]
                if not defenses:
                    continue
                dfn = defenses[0]
                dx, dy = dfn % size, dfn // size
                b.place_color(dx, dy, self.opp)
                try:
                    if b.is_win_at(dx, dy):
                        continue                    # 对方这一步反而赢了
                    sub = self._search(b, depth + 2)
                    if sub is not None:
                        return [mv, dfn] + sub
                finally:
                    b.undo()
            finally:
                b.undo()
        return None


def find_vcf(board: Board, color: int, max_depth: int = 12,
             node_limit: int = 200_000) -> list[int] | None:
    """便捷入口：返回我方 VCF 取胜序列。使用棋局副本，不污染原盘。"""
    return VCFSolver(board.copy(), color, max_depth=max_depth,
                     node_limit=node_limit).solve()
