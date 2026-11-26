"""搜索引擎：迭代加深 αβ + 置换表 + 走法排序 + 杀手走法。

走法排序顺序：必胜 > 必防 > 双威胁 > 进攻分 + 防守分。不做静态搜索
（五子棋地平线由 VCF 层处理）。只有完整跑完的迭代才替换根节点结果，
超时中断不会用不完整分数覆盖有效结果。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

from .board import Board
from .config import EngineConfig
from .constants import DEFAULT_MAX_DEPTH, DEFAULT_TIME_BUDGET, FIVE, opponent
from .eval import Evaluator
from .patterns import point_pair_score
from .tactics import double_threat_moves, find_vcf, immediate_move

INF = 10 ** 9
MATE = 10 ** 8

# 置换表条目类型
TT_EXACT = 0
TT_LOWER = 1
TT_UPPER = 2

# 一步成五的判定阈值：DIR_SHAPE_SCORE[FIVE] = 10_000_000，
# 其余四方向最大合计 4*120_000 = 480_000，故 atk >= _FIVE_SCORE 即含五连。
_FIVE_SCORE = 10_000_000


@dataclass
class SearchResult:
    move: Optional[tuple[int, int]]
    score: float
    depth: int
    nodes: int
    elapsed: float
    pv: list = field(default_factory=list)
    reason: str = "search"


class Searcher:
    """αβ 搜索器。所有可调参数从 EngineConfig 读取，构造后不变。"""

    def __init__(self, evaluator: Optional[Evaluator] = None,
                 config: Optional[EngineConfig] = None,
                 time_budget: Optional[float] = None,
                 max_depth: Optional[int] = None,
                 use_vcf: Optional[bool] = None,
                 tt_size: Optional[int] = None):
        self.config = config or EngineConfig()
        sc = self.config.search
        # 显式传参优先于 config。
        self.time_budget = sc.time_budget if time_budget is None else time_budget
        self.max_depth = sc.max_depth if max_depth is None else max_depth
        self.use_vcf = sc.use_vcf if use_vcf is None else use_vcf
        self.evaluator = evaluator or Evaluator(
            defense_weight=self.config.eval.defense_weight,
            point_cap=self.config.eval.point_cap)
        self.tt: dict = {}
        self.tt_limit = (1 << sc.tt_bits) if tt_size is None else tt_size
        self.nodes = 0
        self.aborted = False
        self._deadline = 0.0
        self.killers: dict = {}

    # -- 公共入口 -----------------------------------------------------------
    def search(self, board: Board) -> SearchResult:
        t0 = time.perf_counter()
        self.nodes = 0
        self.aborted = False
        self._deadline = t0 + self.time_budget
        self.killers.clear()
        if len(self.tt) > self.tt_limit:
            self.tt.clear()

        me = board.side

        # 1) 终局 / 空盘
        if board.is_full or board.winner():
            return SearchResult(None, 0.0, 0, 0, 0.0, reason="terminal")
        if not board.moves:
            c = board.size // 2
            return SearchResult((c, c), 0.0, 0, 0, time.perf_counter() - t0, reason="opening")

        # 2) 战术速查：一步赢 / 一步防
        quick = immediate_move(board, me)
        if quick is not None:
            size = board.size
            return SearchResult((quick % size, quick // size), MATE, 1, 0,
                                time.perf_counter() - t0, reason="immediate")

        # 3) 双威胁速查（能造出对手挡不住的双四/四三，直接赢）
        dbl = double_threat_moves(board, me)
        if dbl:
            size = board.size
            best = max(dbl, key=lambda i: point_pair_score(
                board, i % size, i // size, me)[0])
            return SearchResult((best % size, best // size), MATE - 1, 1, 0,
                                time.perf_counter() - t0, reason="double-threat")

        # 4) VCF：我方连续冲四取胜
        if self.use_vcf:
            sc = self.config.search
            vcf = find_vcf(board, me, max_depth=sc.vcf_max_depth,
                           node_limit=sc.vcf_node_limit)
            if vcf:
                size = board.size
                return SearchResult((vcf[0] % size, vcf[0] // size), MATE, len(vcf), 0,
                                    time.perf_counter() - t0, reason="vcf",
                                    pv=[(i % size, i // size) for i in vcf])

        # 5) 迭代加深 αβ。只有完整完成的迭代才更新结果。
        best_move: Optional[tuple[int, int]] = None
        best_score = 0.0
        best_pv: list = []
        reached = 0
        for depth in range(2, self.max_depth + 1, 2):
            score, mv, line, complete = self._root_search(board, depth)
            if complete and mv is not None:
                best_move, best_score, best_pv = mv, score, line
                reached = depth
            if not complete or self.aborted:
                break
            if abs(best_score) > MATE / 2:
                break                      # 已确认必胜/必败
            if time.perf_counter() > self._deadline:
                break

        if best_move is None:
            best_move, best_score = self._fallback(board, me)
        return SearchResult(best_move, best_score, reached, self.nodes,
                            time.perf_counter() - t0, pv=best_pv, reason="alphabeta")

    # -- 兜底：搜索完全不可用时用一步启发 -----------------------------------
    def _fallback(self, board: Board, color: int):
        size = board.size
        sd = self.config.search.sort_defense
        best, best_v = None, -1
        for idx in board.neighbourhood(2):
            x, y = idx % size, idx // size
            atk, dfd = point_pair_score(board, x, y, color)
            v = atk + int(dfd * sd)
            if v > best_v:
                best_v, best = v, (x, y)
        if best is None:
            cands = board.candidates()
            best = cands[0] if cands else None
        return best, 0.0

    # -- 根搜索 -------------------------------------------------------------
    def _root_search(self, board: Board, depth: int):
        """返回 (score, move, pv, complete)。complete=False 表示超时中断。"""
        me = board.side
        moves = self._ordered_moves(board, me, depth, None, 0)
        if not moves:
            return 0.0, None, [], True

        alpha = -INF
        best_mv = moves[0]
        best_score = -INF

        for mv in moves:
            if self.aborted or time.perf_counter() > self._deadline:
                return best_score, best_mv, [best_mv], False
            x, y = mv
            board.place_color(x, y, me)
            try:
                if board.is_win_at(x, y):
                    score = MATE
                else:
                    score = -self._negamax(board, depth - 1, -INF, -alpha, 1)
            finally:
                board.undo()
            if self.aborted:
                return best_score, best_mv, [best_mv], False
            if score > best_score:
                best_score, best_mv = score, mv
            if score > alpha:
                alpha = score
        return best_score, best_mv, [best_mv], True

    # -- 主体 ---------------------------------------------------------------
    def _negamax(self, board: Board, depth: int, alpha: float, beta: float,
                 ply: int) -> float:
        self.nodes += 1
        if not (self.nodes & 127) and time.perf_counter() > self._deadline:
            self.aborted = True
            return 0.0

        # 终局：上一手已成五连（对手下的 → 我方输）。
        if board.moves:
            lx, ly = board.moves[-1]
            if board.is_win_at(lx, ly):
                return -MATE + ply

        if depth <= 0:
            return self.evaluator.evaluate(board, board.side)

        key = board.zobrist
        hit = self.tt.get(key)
        tt_move = None
        if hit is not None:
            h_depth, h_flag, h_score, h_move = hit
            tt_move = h_move
            if h_depth >= depth:
                if h_flag == TT_EXACT:
                    return h_score
                if h_flag == TT_LOWER:
                    if h_score > alpha:
                        alpha = h_score
                elif h_flag == TT_UPPER:
                    if h_score < beta:
                        beta = h_score
                if alpha >= beta:
                    return h_score

        side = board.side
        moves = self._ordered_moves(board, side, depth, tt_move, ply)
        if not moves:
            return 0.0

        best = -INF
        best_mv = None
        alpha0 = alpha
        for mv in moves:
            if self.aborted:
                return 0.0
            x, y = mv
            board.place_color(x, y, side)
            try:
                if board.is_win_at(x, y):
                    score = MATE - (ply + 1)
                else:
                    score = -self._negamax(board, depth - 1, -beta, -alpha, ply + 1)
            finally:
                board.undo()
            if score > best:
                best, best_mv = score, mv
            if score > alpha:
                alpha = score
            if alpha >= beta:
                self._remember_killer(ply, mv)
                break

        if self.aborted:
            return 0.0
        if best <= alpha0:
            flag = TT_UPPER
        elif best >= beta:
            flag = TT_LOWER
        else:
            flag = TT_EXACT
        if best > -INF:
            self.tt[key] = (depth, flag, best, best_mv)
        return best

    # -- 杀手走法 -----------------------------------------------------------
    def _remember_killer(self, ply: int, mv) -> None:
        lst = self.killers.get(ply)
        if lst is None:
            self.killers[ply] = [mv]
        elif mv not in lst:
            lst.insert(0, mv)
            if len(lst) > 2:
                lst.pop()

    # -- 强制走法收敛 + 走法排序 --------------------------------------------
    def _ordered_moves(self, board: Board, color: int, depth: int,
                       tt_move=None, ply: int = 0) -> list:
        """一次扫描完成成五点检测（强制收敛）与启发式排序。

        atk >= _FIVE_SCORE 当且仅当至少一个方向是五连。
        """
        size = board.size
        opp = opponent(color)
        killers = self.killers.get(ply, ())
        sc = self.config.search
        sd = sc.sort_defense
        sort_mate = sc.sort_mate
        sort_killer = sc.sort_killer

        five_me = []
        five_op = []
        scored = []
        for idx in board.neighbourhood(2):
            x, y = idx % size, idx // size
            atk, dfd = point_pair_score(board, x, y, color)
            if atk >= _FIVE_SCORE:
                five_me.append((atk, x, y))
                continue
            if dfd >= _FIVE_SCORE:
                five_op.append((dfd, x, y))
                continue
            v = atk + int(dfd * sd)
            if tt_move is not None and (x, y) == tt_move:
                v += sort_mate
            elif (x, y) in killers:
                v += sort_killer
            scored.append((v, x, y))

        # 我能成五→只走这一点；对手能成五→堵（堵不完全列出）。
        if five_me:
            five_me.sort(reverse=True)
            return [(x, y) for _, x, y in five_me[:1]]
        if five_op:
            five_op.sort(reverse=True)
            return [(x, y) for _, x, y in five_op]

        scored.sort(reverse=True)
        if depth >= 4:
            width = sc.width_deep
        elif depth >= 2:
            width = sc.width_mid
        else:
            width = sc.width_shallow
        return [(x, y) for _, x, y in scored[:width]]
