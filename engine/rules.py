"""规则集：休闲五子棋 / 标准连珠（含黑棋禁手）。

禁手判定只约束黑方，且「成五」优先级高于禁手。
"""

from __future__ import annotations

from .constants import BLACK, EMPTY, WHITE
from .board import Board

# 禁手类型
FORBIDDEN_NONE = None
FORBIDDEN_OVERLINE = "overline"      # 长连（六子及以上）
FORBIDDEN_DOUBLE_FOUR = "double_four"
FORBIDDEN_DOUBLE_THREE = "double_three"


def _count_shapes_at(board: Board, x: int, y: int, color: int) -> tuple[int, int, int]:
    """统计 (x,y) 落子后形成的 四 / 活三 数量。

    返回 (fours, open_threes, overline)。
    这里用「五连窗口计数」判定，与 patterns.py 的判定口径保持一致。
    """
    fours = 0
    open_threes = 0
    overline = 0

    for dx, dy in ((1, 0), (0, 1), (1, 1), (1, -1)):
        line = board.full_line(x, y, dx, dy)
        # 定位 (x,y) 在线中的下标记法
        sx, sy = x, y
        while board.inside(sx - dx, sy - dy):
            sx -= dx
            sy -= dy
        pos = 0
        cx, cy = sx, sy
        while not (cx == x and cy == y):
            pos += 1
            cx += dx
            cy += dy

        n = len(line)
        # 长连
        run = 1
        k = pos - 1
        while k >= 0 and line[k] == color:
            run += 1
            k -= 1
        k = pos + 1
        while k < n and line[k] == color:
            run += 1
            k += 1
        if run >= 6:
            overline += 1
            continue

        # 五连窗口：任意 5 连窗口内全为 color 且无对手 → 一个成五点
        win_windows = 0
        for start in range(max(0, pos - 4), min(pos, n - 5) + 1):
            seg = line[start : start + 5]
            if len(seg) == 5 and all(v == color for v in seg):
                win_windows += 1
        if win_windows == 0:
            continue

        # 四：只有一个成五窗口 → 冲四；两个及以上 → 活四（按四计）。
        fours += 1
        continue

    open_threes = _count_open_threes(board, x, y, color)
    return fours, open_threes, overline


def _count_open_threes(board: Board, x: int, y: int, color: int) -> int:
    """统计 (x,y) 落子后形成的活三数量。

    活三定义：再加一子可成活四的三。用「一步成四」的可达性判定。
    """
    count = 0
    for dx, dy in ((1, 0), (0, 1), (1, 1), (1, -1)):
        line = board.full_line(x, y, dx, dy)
        sx, sy = x, y
        while board.inside(sx - dx, sy - dy):
            sx -= dx
            sy -= dy
        pos = 0
        cx, cy = sx, sy
        while not (cx == x and cy == y):
            pos += 1
            cx += dx
            cy += dy

        n = len(line)
        # 检查窗口内是否存在 3 连、两端为空、且能延伸成活四
        for start in range(max(0, pos - 4), min(pos, n - 5) + 1):
            seg = line[start : start + 5]
            if len(seg) != 5:
                continue
            if any(v == 3 - color for v in seg):
                continue
            if seg.count(color) != 3 or seg.count(EMPTY) != 2:
                continue
            # 该 5 窗口内 3 子连续成三，且两端空 → 活三候选
            idxs = [i for i, v in enumerate(seg) if v == color]
            if idxs[-1] - idxs[0] != 2:
                continue
            # 检查窗口外两侧是否至少有一侧可延伸（简单近似）
            left_free = start > 0 and line[start - 1] == EMPTY
            right_free = start + 5 < n and line[start + 5] == EMPTY
            if left_free or right_free:
                count += 1
                break
    return count


def forbidden_reason(board: Board, x: int, y: int) -> str | None:
    """判断黑方在 (x,y) 落子是否为禁手。成五优先。"""
    if board.rules != "renju":
        return None
    if board.get(x, y) != EMPTY:
        return FORBIDDEN_NONE
    color = BLACK

    # 成五优先
    board.grid[board.index(x, y)] = color
    try:
        if board.is_win_at(x, y):
            return FORBIDDEN_NONE
        fours, open_threes, overline = _count_shapes_at(board, x, y, color)
    finally:
        board.grid[board.index(x, y)] = EMPTY

    if overline:
        return FORBIDDEN_OVERLINE
    if fours >= 2:
        return FORBIDDEN_DOUBLE_FOUR
    if open_threes >= 2:
        return FORBIDDEN_DOUBLE_THREE
    return FORBIDDEN_NONE


def is_legal(board: Board, x: int, y: int) -> bool:
    """该点对当前方是否合法（空点 + 非黑禁手）。"""
    if not board.inside(x, y):
        return False
    if board.get(x, y) != EMPTY:
        return False
    if board.side == BLACK and board.rules == "renju":
        return forbidden_reason(board, x, y) is None
    return True


def legal_moves(board: Board, points: list[int] | None = None) -> list[int]:
    """过滤出合法走法（索引形式）。"""
    pts = points if points is not None else list(board.empty_points())
    if board.rules != "renju" or board.side != BLACK:
        return pts
    return [p for p in pts if forbidden_reason(board, p % board.size, p // board.size) is None]
