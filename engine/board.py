"""棋盘核心类：落子、悔棋、胜负判定、候选点生成、Zobrist 哈希。

一维数组存储（idx = y*size + x），不依赖任何 UI/视觉库。
每条横/竖/斜线用 2 bit/格打包成整数，落子 XOR 4 条线各一个 2-bit
字段；取 9 格窗口即一次移位+掩码。边界外填墙(3)。候选点用 bytearray
增量维护。
"""

from __future__ import annotations

import random
from typing import Iterable, Iterator

from .constants import (
    BLACK,
    CANDIDATE_RADIUS,
    DIRECTIONS,
    EMPTY,
    RULES_CASUAL,
    RULES_RENJU,
    WHITE,
    opponent,
)

WIN_LEN = 5
SPAN = 4                      # 窗口半径，中心 ±4 → 9 格
WINDOW_LEN = 2 * SPAN + 1     # 9
MASK18 = (1 << (2 * WINDOW_LEN)) - 1

# 方向顺序固定：横、竖、撇(↘)、捺(↗)
DIRS = ((1, 0), (0, 1), (1, 1), (1, -1))
_DIR_INDEX = {d: i for i, d in enumerate(DIRS)}

# ---------------------------------------------------------------------------
# 几何预计算（按棋盘尺寸缓存）
# ---------------------------------------------------------------------------
# 每个尺寸缓存：
#   lines        : 4 条线组（每组的每个元素是一条打包线）
#   base         : 初始打包线（只有墙，棋盘格全空）
#   flat         : 每点 8 元组 (l0,s0,l1,s1,l2,s2,l3,s3)
#   lens         : 每方向线长（仅调试用）
_GEOM: dict[int, dict] = {}


def _build_geom(size: int) -> dict:
    """预计算四条方向的线打包、每点的 (线号, 位移)。"""
    # 1) 收集每条线上的点序列
    line_cells: list[list[list[int]]] = [[], [], [], []]

    # 横线：y 固定，x 递增
    for y in range(size):
        line_cells[0].append([y * size + x for x in range(size)])
    # 竖线：x 固定，y 递增
    for x in range(size):
        line_cells[1].append([y * size + x for y in range(size)])
    # 撇 ↘（dx=1, dy=1）：y - x = d 为常量
    for d in range(-(size - 1), size):
        cells = []
        x0 = max(0, -d)
        x1 = min(size - 1, size - 1 - d)
        for x in range(x0, x1 + 1):
            cells.append((x + d) * size + x)
        line_cells[2].append(cells)
    # 捺 ↗（dx=1, dy=-1）：x + y = s 为常量
    for s in range(0, 2 * size - 1):
        cells = []
        x0 = max(0, s - (size - 1))
        x1 = min(size - 1, s)
        for x in range(x0, x1 + 1):
            cells.append((s - x) * size + x)
        line_cells[3].append(cells)

    # 2) 打包：低 SPAN 个 2-bit 是前置墙，接着是棋盘格，再后 SPAN 个后置墙
    lines: list[list[int]] = [[], [], [], []]
    for di in range(4):
        for cells in line_cells[di]:
            length = len(cells)
            packed = 0
            for k in range(SPAN):                       # 前置墙
                packed |= 3 << (2 * k)
            for k in range(SPAN):                       # 后置墙
                packed |= 3 << (2 * (SPAN + length + k))
            lines[di].append(packed)

    # 3) 每点 → (线号, 绝对位移) × 4。位移绝对：线上第 k 个棋格占 2*(SPAN+k) 位，
    #    取窗口时再减 2*SPAN 让中心对齐。
    lids = [[0] * (size * size) for _ in range(4)]
    shfs = [[0] * (size * size) for _ in range(4)]
    for di in range(4):
        for line_id, cells in enumerate(line_cells[di]):
            for k, pos in enumerate(cells):
                lids[di][pos] = line_id
                shfs[di][pos] = 2 * (SPAN + k)

    flat: list[tuple[int, ...]] = [None] * (size * size)   # type: ignore[list-item]
    for pos in range(size * size):
        flat[pos] = (
            lids[0][pos], shfs[0][pos],
            lids[1][pos], shfs[1][pos],
            lids[2][pos], shfs[2][pos],
            lids[3][pos], shfs[3][pos],
        )

    # 4) 每点的邻域（切比雪夫距离 <= CANDIDATE_RADIUS，含自身），用于增量维护候选点。
    r = CANDIDATE_RADIUS
    ring: list[tuple[int, ...]] = [()] * (size * size)
    for y in range(size):
        for x in range(size):
            cells = []
            for ny in range(max(0, y - r), min(size - 1, y + r) + 1):
                for nx in range(max(0, x - r), min(size - 1, x + r) + 1):
                    cells.append(ny * size + nx)
            ring[y * size + x] = tuple(cells)

    return {"lines": lines, "base": [l.copy() for l in lines],
            "flat": flat, "ring": ring}


def _geom(size: int) -> dict:
    g = _GEOM.get(size)
    if g is None:
        g = _build_geom(size)
        _GEOM[size] = g
    return g


# ---------------------------------------------------------------------------
# Zobrist 表（按棋盘尺寸缓存，避免重复生成）
# ---------------------------------------------------------------------------
_ZOBRIST: dict[int, list[list[int]]] = {}
_ZOBRIST_SIDE: dict[int, int] = {}


def _zobrist(size: int) -> tuple[list[list[int]], int]:
    if size not in _ZOBRIST:
        rng = random.Random(0x5EED + size)
        table = [[rng.getrandbits(64) for _ in range(3)] for _ in range(size * size)]
        _ZOBRIST[size] = table
        _ZOBRIST_SIDE[size] = rng.getrandbits(64)
    return _ZOBRIST[size], _ZOBRIST_SIDE[size]


class Board:
    """五子棋棋盘。size 默认 15；rules 为 casual（无禁手）或 renju（黑禁长连/双四/双三）。"""

    __slots__ = ("size", "grid", "moves", "side", "rules",
                 "_zb", "_zb_side", "_hash", "_lines", "_flat", "_flat_ring",
                 "_near")

    def __init__(
        self,
        size: int = 15,
        rules: str = RULES_CASUAL,
        side: int = BLACK,
        from_grid: Iterable[int] | None = None,
    ) -> None:
        self.size = int(size)
        self.rules = rules
        g = _geom(self.size)
        self._flat = g["flat"]
        self._flat_ring = g["ring"]
        self.grid: list[int] = [EMPTY] * (self.size * self.size)
        self.moves: list[tuple[int, int]] = []
        self.side = side
        self._zb, self._zb_side = _zobrist(self.size)
        self._hash = 0
        self._lines: list[list[int]] = [l.copy() for l in g["base"]]
        self._near = bytearray(self.size * self.size)

        if from_grid is not None:
            self._load(from_grid)

    # -- 构造 ---------------------------------------------------------------
    def _load(self, values: Iterable[int]) -> None:
        """从扁平数组重建棋局（用于识别结果同步）。"""
        values = list(values)
        if len(values) != self.size * self.size:
            raise ValueError(f"grid 长度 {len(values)} != {self.size ** 2}")
        g = _geom(self.size)
        self.grid = values
        self._lines = [l.copy() for l in g["base"]]
        self._near = bytearray(self.size * self.size)
        self._hash = 0
        self.moves = []
        black_n = white_n = 0
        for idx, v in enumerate(values):
            if v == EMPTY:
                continue
            x, y = idx % self.size, idx // self.size
            self.moves.append((x, y))
            self._hash ^= self._zb[idx][v]
            self._set_line(idx, v)
            for j in g["ring"][idx]:
                self._near[j] += 1
            if v == BLACK:
                black_n += 1
            elif v == WHITE:
                white_n += 1
        # 由子数推断轮到谁：黑先手，黑子数 == 白子数 → 轮黑
        self.side = BLACK if black_n == white_n else WHITE

    @classmethod
    def from_grid(cls, values: Iterable[int], rules: str = RULES_CASUAL) -> "Board":
        values = list(values)
        size = int(round(len(values) ** 0.5))
        return cls(size=size, rules=rules, from_grid=values)

    # -- 行打包维护 ---------------------------------------------------------
    def _set_line(self, idx: int, color: int) -> None:
        f = self._flat[idx]
        L = self._lines
        v = color
        L[0][f[0]] ^= v << f[1]
        L[1][f[2]] ^= v << f[3]
        L[2][f[4]] ^= v << f[5]
        L[3][f[6]] ^= v << f[7]

    def windows4(self, x: int, y: int) -> tuple[int, int, int, int]:
        """返回 (x,y) 为中心、四方向 9 格窗口的 2-bit 打包码。

        码中每 2 bit 一格：0=空 1=黑 2=白 3=墙；
        第 i 格（i=0 为 k=-4）在 ``2*i`` 位移处，中心恒在 bit 8-9。
        """
        f = self._flat[y * self.size + x]
        L = self._lines
        M = MASK18
        o = 2 * SPAN
        return ((L[0][f[0]] >> (f[1] - o)) & M,
                (L[1][f[2]] >> (f[3] - o)) & M,
                (L[2][f[4]] >> (f[5] - o)) & M,
                (L[3][f[6]] >> (f[7] - o)) & M)

    def window_code(self, x: int, y: int, dir_index: int) -> int:
        f = self._flat[y * self.size + x]
        k = dir_index * 2
        return (self._lines[dir_index][f[k]] >> (f[k + 1] - 2 * SPAN)) & MASK18

    # -- 基本访问 -----------------------------------------------------------
    def index(self, x: int, y: int) -> int:
        return y * self.size + x

    def inside(self, x: int, y: int) -> bool:
        return 0 <= x < self.size and 0 <= y < self.size

    def get(self, x: int, y: int) -> int:
        return self.grid[y * self.size + x]

    def is_empty_at(self, x: int, y: int) -> bool:
        return self.grid[y * self.size + x] == EMPTY

    @property
    def stone_count(self) -> int:
        return len(self.moves)

    @property
    def is_full(self) -> bool:
        return len(self.moves) == self.size * self.size

    def empty_points(self) -> Iterator[int]:
        g = self.grid
        for idx, v in enumerate(g):
            if v == EMPTY:
                yield idx

    # -- 哈希 ---------------------------------------------------------------
    @property
    def zobrist(self) -> int:
        """包含轮次信息的完整哈希。"""
        return self._hash ^ (self._zb_side if self.side == BLACK else 0)

    # -- 落子 / 悔棋 --------------------------------------------------------
    def place(self, x: int, y: int) -> bool:
        """当前方在 (x, y) 落子。成功返回 True。"""
        return self.place_color(x, y, self.side)

    def place_color(self, x: int, y: int, color: int) -> bool:
        """指定颜色落子（不校验轮次，调用方保证合法）。"""
        if not (0 <= x < self.size and 0 <= y < self.size):
            return False
        idx = y * self.size + x
        if self.grid[idx] != EMPTY:
            return False
        self.grid[idx] = color
        self._hash ^= self._zb[idx][color]
        self.moves.append((x, y))
        self.side = opponent(color)
        self._set_line(idx, color)
        near = self._near
        for j in self._flat_ring[idx]:
            near[j] += 1
        return True

    def undo(self) -> tuple[int, int] | None:
        if not self.moves:
            return None
        x, y = self.moves.pop()
        idx = y * self.size + x
        color = self.grid[idx]
        self._hash ^= self._zb[idx][color]
        self._set_line(idx, color)      # XOR 自身即撤销
        self.grid[idx] = EMPTY
        self.side = color
        near = self._near
        for j in self._flat_ring[idx]:
            near[j] -= 1
        return (x, y)

    def copy(self) -> "Board":
        b = Board.__new__(Board)
        b.size = self.size
        b.rules = self.rules
        b.grid = self.grid.copy()
        b.moves = self.moves.copy()
        b.side = self.side
        b._zb = self._zb
        b._zb_side = self._zb_side
        b._hash = self._hash
        b._flat = self._flat
        b._flat_ring = self._flat_ring
        b._lines = [l.copy() for l in self._lines]
        b._near = self._near[:]
        return b

    # -- 线与窗口 -----------------------------------------------------------
    def line(self, x: int, y: int, dx: int, dy: int, span: int) -> list[int]:
        """取以 (x,y) 为中心、沿 (dx,dy) 长度 2*span+1 的取值序列。越界为 -1。"""
        out: list[int] = []
        for k in range(-span, span + 1):
            nx, ny = x + dx * k, y + dy * k
            if 0 <= nx < self.size and 0 <= ny < self.size:
                out.append(self.grid[ny * self.size + nx])
            else:
                out.append(-1)
        return out

    def full_line(self, x: int, y: int, dx: int, dy: int) -> list[int]:
        """取穿过 (x,y) 的整条线（用于禁手判定）。"""
        sx, sy = x, y
        while self.inside(sx - dx, sy - dy):
            sx -= dx
            sy -= dy
        out: list[int] = []
        cx, cy = sx, sy
        while self.inside(cx, cy):
            out.append(self.grid[cy * self.size + cx])
            cx += dx
            cy += dy
        return out

    # -- 胜负 ---------------------------------------------------------------
    def count_run(self, x: int, y: int, dx: int, dy: int, color: int | None = None) -> int:
        """返回 (x,y) 所在、沿 (dx,dy) 的连续同色长度。"""
        if color is None:
            color = self.get(x, y)
        if color == EMPTY:
            return 0
        n = 1
        for sign in (1, -1):
            nx, ny = x + dx * sign, y + dy * sign
            while self.inside(nx, ny) and self.get(nx, ny) == color:
                n += 1
                nx += dx * sign
                ny += dy * sign
        return n

    def is_win_at(self, x: int, y: int) -> bool:
        """(x,y) 的落子是否形成胜利（按当前规则）。"""
        color = self.get(x, y)
        if color == EMPTY:
            return False
        for dx, dy in DIRECTIONS:
            run = self.count_run(x, y, dx, dy, color)
            if self.rules == RULES_RENJU and color == BLACK:
                # 连珠规则：黑棋必须恰好五连；六连及以上是长连禁手，不算胜
                if run == 5:
                    return True
            else:
                if run >= 5:
                    return True
        return False

    def winner(self) -> int:
        """返回胜方颜色，无人获胜返回 0。只看最后一手，O(1)。"""
        if not self.moves:
            return 0
        x, y = self.moves[-1]
        return self.get(x, y) if self.is_win_at(x, y) else 0

    def last_move(self) -> tuple[int, int] | None:
        return self.moves[-1] if self.moves else None

    # -- 候选点 -------------------------------------------------------------
    def neighbourhood(self, radius: int = CANDIDATE_RADIUS) -> list[int]:
        """距任意已有棋子切比雪夫距离 <= radius 的空点。空盘返回天元。"""
        size = self.size
        if not self.moves:
            c = size // 2
            return [c * size + c]
        if radius == CANDIDATE_RADIUS:
            # 增量维护好的邻域计数：O(棋盘) 的简单扫描，无嵌套循环
            near = self._near
            grid = self.grid
            return [i for i in range(size * size) if near[i] and not grid[i]]
        marks = bytearray(size * size)
        r = radius
        for mx, my in self.moves:
            y0 = my - r if my >= r else 0
            y1 = my + r + 1 if my + r < size else size
            x0 = mx - r if mx >= r else 0
            x1 = mx + r + 1 if mx + r < size else size
            for ny in range(y0, y1):
                base = ny * size
                for nx in range(x0, x1):
                    marks[base + nx] = 1
        grid = self.grid
        return [i for i, m in enumerate(marks) if m and grid[i] == EMPTY]

    def candidates(self, radius: int = CANDIDATE_RADIUS) -> list[tuple[int, int]]:
        return [(i % self.size, i // self.size) for i in self.neighbourhood(radius)]

    # -- 序列化 -------------------------------------------------------------
    def to_list(self) -> list[int]:
        return self.grid.copy()

    def to_rows(self) -> list[list[int]]:
        s = self.size
        return [self.grid[r * s : (r + 1) * s] for r in range(s)]

    def move_list(self) -> list[dict]:
        out = []
        for i, (x, y) in enumerate(self.moves):
            out.append({"x": x, "y": y, "color": BLACK if i % 2 == 0 else WHITE})
        return out

    def __repr__(self) -> str:  # pragma: no cover - 调试用
        sym = {EMPTY: ".", BLACK: "X", WHITE: "O"}
        rows = ["".join(sym[v] for v in self.grid[r * self.size : (r + 1) * self.size])
                for r in range(self.size)]
        return "\n".join(rows)
