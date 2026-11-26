"""棋型识别：把一条线上的局面精确分类成五 / 活四 / 冲四 / 活三 / 眠三 / 活二 / 二。

核心思想
--------
对「以某点为中心、长度 9 的窗口」做**精确的威胁推演**，而不是写一堆容易漏的正则：

    五      : 已有 5 连
    活四    : 存在一个空点，落子后能形成「两个不同的成五点」（即对方挡不住）
    冲四    : 存在一个空点，落子后能形成「一个成五点」
    活三    : 存在一个空点，落子后能形成「活四」
    眠三    : 存在一个空点，落子后能形成「冲四」
    活二    : 存在一个空点，落子后能形成「活三」
    二      : 存在一个空点，落子后能形成「眠三」

预计算
------
窗口 9 格 × 2 bit 打包（0=空 1=黑 2=白 3=墙），共 4^9 = 262144 种局面。
按「己方视角」分别预计算黑/白两张表，运行期只需

    shape_id = SHAPE_TABLE[color][窗口码 | (color << 8)]

一次索引即可，**没有任何格子循环**。表和分值表缓存在 ``assets/shape_packed.bin``。
"""

from __future__ import annotations

from array import array
from pathlib import Path

from .constants import (
    FIVE,
    FOUR,
    NONE,
    OPEN_FOUR,
    OPEN_THREE,
    OPEN_TWO,
    THREE,
    TWO,
)

SPAN = 4                        # 窗口半径：中心 ±4 → 长度 9
WIN_LEN = 5                     # 连五长度
WINDOW_LEN = 2 * SPAN + 1
CENTER = SPAN
CENTER_SHIFT = 2 * CENTER       # 中心格在打包码中的位移 = 8
MASK18 = (1 << (2 * WINDOW_LEN)) - 1
PACKED_SIZE = 1 << (2 * WINDOW_LEN)     # 4^9 = 262144
TABLE_VERSION = 5

# 形状名（下标即表内存储的形状编号，数值越大越强）
SHAPE_NAMES = (NONE, TWO, OPEN_TWO, THREE, OPEN_THREE, FOUR, OPEN_FOUR, FIVE)
SHAPE_INDEX = {name: i for i, name in enumerate(SHAPE_NAMES)}
SHAPE_RANK = {name: i for i, name in enumerate(SHAPE_NAMES)}

# 单方向形状分
DIR_SHAPE_SCORE = {
    NONE: 0,
    TWO: 15,
    OPEN_TWO: 120,
    THREE: 300,
    OPEN_THREE: 3_000,
    FOUR: 9_000,
    OPEN_FOUR: 120_000,
    FIVE: 10_000_000,
}
SCORE_BY_IDX = tuple(DIR_SHAPE_SCORE[n] for n in SHAPE_NAMES)

# 2-bit 格值 → 三进制数字（己方视角）：0 空 / 1 己方 / 2 阻挡
# 格值：0=空 1=黑 2=白 3=墙
_LUT = {1: (0, 1, 2, 2), 2: (0, 2, 1, 2)}

_ASSET_BIN = Path(__file__).resolve().parent.parent / "assets" / "shape_packed.bin"

# 运行期全局表
_SHAPE_TABLE: dict[int, bytearray] = {}
_SCORE_TABLE: dict[int, array] = {}
_DIR_INDEX = {(1, 0): 0, (0, 1): 1, (1, 1): 2, (1, -1): 3}


# ---------------------------------------------------------------------------
# 精确推演（只用于离线建表）
# ---------------------------------------------------------------------------
def _has_five(cells) -> bool:
    """窗口内是否存在 5 个连续的**己方**棋子（阻挡格 2 不算）。"""
    for s in range(0, WINDOW_LEN - WIN_LEN + 1):
        if (cells[s] == 1 and cells[s + 1] == 1 and cells[s + 2] == 1
                and cells[s + 3] == 1 and cells[s + 4] == 1):
            return True
    return False


def _put(cells, idx):
    c = cells.copy()
    c[idx] = 1
    return c


def _empties(cells):
    return [i for i, v in enumerate(cells) if v == 0]


def classify(cells) -> str:
    """对「中心已是己方棋子」的 9 格窗口做精确分类。

    ``cells``：长度 9，取值 0=空 / 1=己方 / 2=阻挡。cells[4] 必须为 1。
    """
    if cells[CENTER] != 1:
        return NONE

    placed = cells
    if _has_five(placed):
        return FIVE

    # 冲四 / 活四：再补一子能成五的点数
    wins = 0
    for q in _empties(placed):
        if _has_five(_put(placed, q)):
            wins += 1
            if wins >= 2:
                return OPEN_FOUR
    if wins == 1:
        return FOUR

    # 眠三 / 活三：补一子后能形成冲四 / 活四
    four_maker = False
    for q in _empties(placed):
        after = _put(placed, q)
        w = 0
        for r in _empties(after):
            if _has_five(_put(after, r)):
                w += 1
                if w >= 2:
                    return OPEN_THREE
        if w == 1:
            four_maker = True
    if four_maker:
        return THREE

    # 二 / 活二：补两子后能形成冲四 / 活四
    three_maker = False
    for q in _empties(placed):
        after = _put(placed, q)
        for r in _empties(after):
            after2 = _put(after, r)
            w = 0
            for s in _empties(after2):
                if _has_five(_put(after2, s)):
                    w += 1
                    if w >= 2:
                        return OPEN_TWO
            if w == 1:
                three_maker = True
    if three_maker:
        return TWO
    return NONE


# ---------------------------------------------------------------------------
# 建表 / 载表
# ---------------------------------------------------------------------------
def _ternary_table() -> list[int]:
    """3^9 三进制码 → 形状编号（中心不是己方一律 0）。"""
    size = 3 ** WINDOW_LEN
    small = [0] * size
    for code in range(size):
        cells = [0] * WINDOW_LEN
        c = code
        for i in range(WINDOW_LEN - 1, -1, -1):
            cells[i] = c % 3
            c //= 3
        if cells[CENTER] != 1:
            continue
        small[code] = SHAPE_INDEX[classify(cells)]
    return small


def build_tables() -> tuple[bytearray, bytearray]:
    """构建黑/白两张 4^9 打包形状表。

    打包码里 **第 i 格在 bit 2i**（第 0 格 = 窗口最左格），
    而 ``classify`` 用的三进制码是「第 0 格为最高位」，即

        t3 = Σ cells[i] * 3**(WINDOW_LEN-1-i)

    直接一次 DP 做不了（不同码的位数不同），所以拆成两张小表：
    低 4 格（256 项）+ 高 5 格（1024 项）再相加。
    """
    small = _ternary_table()
    n_low = 4                       # 低位字段个数
    low_shift = 2 * n_low
    low_size = 1 << low_shift
    high_size = PACKED_SIZE >> low_shift

    out = []
    for color in (1, 2):
        lut = _LUT[color]
        # A[code] = Σ_{i=0..3} d_i * 3^(8-i)
        A = [0] * low_size
        for code in range(low_size):
            v = 0
            for i in range(n_low):
                v += lut[(code >> (2 * i)) & 3] * (3 ** (WINDOW_LEN - 1 - i))
            A[code] = v
        # B[code] = Σ_{j=0..4} d_(j+4) * 3^(8-(j+4)) = Σ d * 3^(4-j)
        n_high = WINDOW_LEN - n_low
        B = [0] * high_size
        for code in range(high_size):
            v = 0
            for j in range(n_high):
                v += lut[(code >> (2 * j)) & 3] * (3 ** (n_high - 1 - j))
            B[code] = v

        tbl = bytearray(PACKED_SIZE)
        for code in range(PACKED_SIZE):
            if ((code >> CENTER_SHIFT) & 3) != color:
                continue
            tbl[code] = small[A[code & (low_size - 1)] + B[code >> low_shift]]
        out.append(tbl)
    return out[0], out[1]


def _write_tables(black_tbl: bytearray, white_tbl: bytearray) -> None:
    _ASSET_BIN.parent.mkdir(parents=True, exist_ok=True)
    with open(_ASSET_BIN, "wb") as f:
        f.write(b"GMPT")
        f.write(TABLE_VERSION.to_bytes(4, "little"))
        f.write(bytes(black_tbl))
        f.write(bytes(white_tbl))
        array("I", (SCORE_BY_IDX[v] for v in black_tbl)).tofile(f)
        array("I", (SCORE_BY_IDX[v] for v in white_tbl)).tofile(f)


def _load_tables() -> None:
    """载入打包表；缺失/版本不符则现场构建并写盘。"""
    if _SHAPE_TABLE:
        return
    if _ASSET_BIN.exists():
        try:
            with open(_ASSET_BIN, "rb") as f:
                data = f.read()
            if data[:4] == b"GMPT" and int.from_bytes(data[4:8], "little") == TABLE_VERSION:
                n = PACKED_SIZE
                off = 8
                b = bytearray(data[off:off + n]); off += n
                w = bytearray(data[off:off + n]); off += n
                sb = array("I"); sb.frombytes(data[off:off + n * 4]); off += n * 4
                sw = array("I"); sw.frombytes(data[off:off + n * 4])
                if len(b) == n and len(w) == n and len(sb) == n and len(sw) == n:
                    _SHAPE_TABLE[1] = b
                    _SHAPE_TABLE[2] = w
                    _SCORE_TABLE[1] = sb
                    _SCORE_TABLE[2] = sw
                    return
        except Exception:
            pass
    b, w = build_tables()
    _SHAPE_TABLE[1] = b
    _SHAPE_TABLE[2] = w
    _SCORE_TABLE[1] = array("I", (SCORE_BY_IDX[v] for v in b))
    _SCORE_TABLE[2] = array("I", (SCORE_BY_IDX[v] for v in w))
    try:
        _write_tables(b, w)
    except Exception:
        pass


def shape_table(color: int) -> bytearray:
    if not _SHAPE_TABLE:
        _load_tables()
    return _SHAPE_TABLE[color]


def score_table(color: int) -> array:
    if not _SCORE_TABLE:
        _load_tables()
    return _SCORE_TABLE[color]


# ---------------------------------------------------------------------------
# 运行期接口
# ---------------------------------------------------------------------------
def shape_name(color: int, code: int) -> str:
    """窗口码在 color 视角下的形状名（视 center 为 color 落子）。"""
    return SHAPE_NAMES[shape_table(color)[code | (color << CENTER_SHIFT)]]


def direction_shape(board, x: int, y: int, dx: int, dy: int, color: int) -> str:
    """单方向上，若 color 落在 (x,y) 会形成什么形状。"""
    return shape_name(color, board.window_code(x, y, _DIR_INDEX[(dx, dy)]))


def point_shapes(board, x: int, y: int, color: int) -> dict:
    """统计 color 在 (x,y) 落子会在四个方向上形成的形状数量。"""
    if board.grid[y * board.size + x] != 0:
        return {}
    tbl = shape_table(color)
    sh = color << CENTER_SHIFT
    names = SHAPE_NAMES
    out: dict[str, int] = {}
    c0, c1, c2, c3 = board.windows4(x, y)
    for code in (c0, c1, c2, c3):
        n = names[tbl[code | sh]]
        if n != NONE:
            out[n] = out.get(n, 0) + 1
    return out


def point_score(board, x: int, y: int, color: int) -> int:
    """color 在 (x,y) 落子的进攻分值：四方向形状分之和。"""
    if board.grid[y * board.size + x] != 0:
        return 0
    st = score_table(color)
    sh = color << CENTER_SHIFT
    c0, c1, c2, c3 = board.windows4(x, y)
    return st[c0 | sh] + st[c1 | sh] + st[c2 | sh] + st[c3 | sh]


def point_pair_score(board, x: int, y: int, color: int) -> tuple[int, int]:
    """同时算 (color 落此点分, 对手落此点分)，用于走法排序。"""
    if board.grid[y * board.size + x] != 0:
        return 0, 0
    c0, c1, c2, c3 = board.windows4(x, y)
    s_me = score_table(color)
    m = color << CENTER_SHIFT
    atk = s_me[c0 | m] + s_me[c1 | m] + s_me[c2 | m] + s_me[c3 | m]
    other = 3 - color
    s_op = score_table(other)
    o = other << CENTER_SHIFT
    dfd = s_op[c0 | o] + s_op[c1 | o] + s_op[c2 | o] + s_op[c3 | o]
    return atk, dfd


def best_direction_shape(board, x: int, y: int, color: int) -> str:
    """(x,y) 落子后四方向中最强的形状。"""
    shapes = point_shapes(board, x, y, color)
    if not shapes:
        return NONE
    return max(shapes, key=lambda s: SHAPE_RANK[s])


def has_five(shapes: dict) -> bool:
    return shapes.get(FIVE, 0) > 0


def has_open_four(shapes: dict) -> bool:
    return shapes.get(OPEN_FOUR, 0) > 0


def has_four(shapes: dict) -> bool:
    return shapes.get(FOUR, 0) + shapes.get(OPEN_FOUR, 0) > 0


def is_double_four(shapes: dict) -> bool:
    return shapes.get(FOUR, 0) + shapes.get(OPEN_FOUR, 0) >= 2


def is_double_three(shapes: dict) -> bool:
    return shapes.get(OPEN_THREE, 0) >= 2
