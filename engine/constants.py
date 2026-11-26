"""棋理引擎的公共常量。

坐标约定：
    棋盘为 size×size 的一维数组，索引 idx = y * size + x
    x 向右为正，y 向下为正（与屏幕像素坐标一致，便于视觉层直接使用）
"""

from __future__ import annotations

EMPTY = 0
BLACK = 1
WHITE = 2

# 四方向：横、竖、主对角(↘)、副对角(↙)
DIRECTIONS = ((1, 0), (0, 1), (1, 1), (1, -1))

# 棋型名称
NONE = "NONE"
FIVE = "FIVE"
OPEN_FOUR = "OPEN_FOUR"      # 活四：两端皆空，必胜
FOUR = "FOUR"                # 冲四：一端被堵，仅一个成五点
OPEN_THREE = "OPEN_THREE"    # 活三：可成活四
THREE = "THREE"              # 眠三
OPEN_TWO = "OPEN_TWO"
TWO = "TWO"

# 棋型分值。数量级拉开，保证「成五」永远压过一切组合。
SHAPE_SCORE = {
    FIVE: 10_000_000,
    OPEN_FOUR: 500_000,
    FOUR: 60_000,
    OPEN_THREE: 30_000,
    THREE: 2_500,
    OPEN_TWO: 1_200,
    TWO: 120,
    NONE: 0,
}

# 轮次与颜色
def opponent(color: int) -> int:
    """返回对方颜色。"""
    return BLACK if color == WHITE else WHITE


def color_name(color: int) -> str:
    return {BLACK: "黑", WHITE: "白", EMPTY: "空"}[color]


# 规则模式
RULES_CASUAL = "casual"   # 连五即胜，黑白均无禁手（多数休闲程序采用）
RULES_RENJU = "renju"     # 标准连珠：黑棋禁长连、双四、双三


# 搜索相关默认值
DEFAULT_TIME_BUDGET = 2.0     # 单步思考时间上限（秒）
DEFAULT_MAX_DEPTH = 8         # 迭代加深最大深度
CANDIDATE_RADIUS = 2          # 候选点距已有棋子的切比雪夫半径
