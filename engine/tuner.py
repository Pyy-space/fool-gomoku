"""自我对弈调参：让两副引擎参数互相对弈，按胜负调整超参数。

本引擎是 αβ 搜索 + 手工棋型评估，没有神经网络权重；调的是
防守权重、搜索宽度等无解析最优值的旋钮。

两种策略：坐标搜索（一次动一个参数试 ±delta）、SPSA（同时扰动
全部参数估梯度）。降噪：同开局正反手配对、固定开局库、交替先后手。
默认坐标搜索。
"""

from __future__ import annotations

import json
import random
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from .board import Board
from .config import ROOT, TUNING_SPACE, EngineConfig
from .constants import BLACK, WHITE

OUTPUT_DIR = ROOT / "output" / "tuning"


# ---------------------------------------------------------------------------
# 对局
# ---------------------------------------------------------------------------
@dataclass
class GameOutcome:
    winner: int          # 0 = 和棋 / 未分胜负
    moves: int
    elapsed: float
    black: str = "A"
    white: str = "B"

    def as_dict(self) -> dict:
        return {"winner": self.winner, "moves": self.moves,
                "elapsed": round(self.elapsed, 3),
                "black": self.black, "white": self.white}


@dataclass
class MatchResult:
    """一轮配对赛（同开局、正反各一局）。"""

    opening: List[Tuple[int, int]] = field(default_factory=list)
    games: List[GameOutcome] = field(default_factory=list)
    a_wins: float = 0.0     # A 的得分（赢 1 / 平 0.5）
    b_wins: float = 0.0

    def as_dict(self) -> dict:
        return {"a_wins": self.a_wins, "b_wins": self.b_wins,
                "games": [g.as_dict() for g in self.games]}


def _make_ai(color: str, cfg: EngineConfig, seed: Optional[int]):
    from . import AI
    # level 保留默认，真正的参数全部来自 cfg（level 只影响开局随机偏移）
    return AI(level=2, config=cfg, seed=seed)


def _opening(size: int, plies: int, rng: random.Random) -> List[Tuple[int, int]]:
    """生成一个固定开局（用于配对赛）。"""
    if plies <= 0:
        return []
    bd = Board(size)
    moves: List[Tuple[int, int]] = []
    lo = size // 2 - 4
    hi = size // 2 + 4
    while len(moves) < plies and not bd.is_full:
        for _ in range(200):
            x = rng.randint(max(0, lo), min(size - 1, hi))
            y = rng.randint(max(0, lo), min(size - 1, hi))
            if bd.is_empty_at(x, y):
                bd.place(x, y)
                moves.append((x, y))
                break
        else:
            break
    return moves


def play_game(cfg_black: EngineConfig, cfg_white: EngineConfig,
              size: int = 15, opening: Optional[List[Tuple[int, int]]] = None,
              max_moves: int = 225, seed: Optional[int] = None) -> GameOutcome:
    """两副参数下一整局。返回胜负与耗时。"""
    t0 = time.perf_counter()
    rng = random.Random(seed) if seed is not None else random.Random()
    bd = Board(size)
    for x, y in (opening or []):
        if bd.is_empty_at(x, y):
            bd.place(x, y)

    ai_b = _make_ai("A", cfg_black, seed=None)
    ai_w = _make_ai("B", cfg_white, seed=None)
    moves = len(bd.moves)

    while not bd.is_full and moves < max_moves:
        ai = ai_b if bd.side == BLACK else ai_w
        try:
            mv = ai.choose(bd)
        except Exception:
            mv = None
        if mv is None:
            break
        if not bd.is_empty_at(*mv):
            # 搜索给出非法点时退化到随机空点，保证对局能继续
            empt = list(bd.empty_points())
            if not empt:
                break
            idx = rng.choice(empt)
            mv = (idx % size, idx // size)
        bd.place(mv[0], mv[1])
        moves += 1
        if bd.winner():
            break

    return GameOutcome(winner=bd.winner(), moves=moves,
                       elapsed=time.perf_counter() - t0)


def play_pair(cfg_a: EngineConfig, cfg_b: EngineConfig, size: int = 15,
              opening_plies: int = 4, max_moves: int = 225,
              seed: Optional[int] = None) -> MatchResult:
    """一轮配对赛：同开局，A 执黑一局、B 执黑一局。"""
    rng = random.Random(seed)
    opening = _opening(size, opening_plies, rng)

    mr = MatchResult(opening=opening)
    g1 = play_game(cfg_a, cfg_b, size=size, opening=opening,
                   max_moves=max_moves, seed=seed)
    g1.black, g1.white = "A", "B"
    mr.games.append(g1)
    if g1.winner == BLACK:
        mr.a_wins += 1
    elif g1.winner == WHITE:
        mr.b_wins += 1
    else:
        mr.a_wins += 0.5
        mr.b_wins += 0.5

    g2 = play_game(cfg_b, cfg_a, size=size, opening=opening,
                   max_moves=max_moves, seed=seed)
    g2.black, g2.white = "B", "A"
    mr.games.append(g2)
    if g2.winner == BLACK:      # 黑是 B
        mr.b_wins += 1
    elif g2.winner == WHITE:    # 白是 A
        mr.a_wins += 1
    else:
        mr.a_wins += 0.5
        mr.b_wins += 0.5
    return mr


# ---------------------------------------------------------------------------
# 搜索策略
# ---------------------------------------------------------------------------
def _clamp(name: str, val):
    lo, hi, is_int = TUNING_SPACE[name]
    if is_int:
        return int(max(lo, min(hi, int(round(val)))))
    return float(max(lo, min(hi, val)))


def _sample(rng: random.Random) -> Dict[str, float]:
    out = {}
    for name, (lo, hi, is_int) in TUNING_SPACE.items():
        v = rng.uniform(lo, hi)
        out[name] = int(round(v)) if is_int else round(v, 3)
    return out


def _cfg_from(base: EngineConfig, params: Dict[str, float]) -> EngineConfig:
    cfg = base.copy()
    cfg.update(params)
    return cfg


def _score(cfg_a: EngineConfig, cfg_b: EngineConfig, rounds: int,
           size: int, opening_plies: int,
           on_progress: Optional[Callable] = None,
           stop_flag: Optional[Callable[[], bool]] = None,
           label: str = "") -> Tuple[float, List[dict]]:
    """跑 rounds 轮配对赛，返回 (A 胜率, 每轮明细)。"""
    wins = 0.0
    total = 0.0
    detail: List[dict] = []
    for i in range(rounds):
        if stop_flag is not None and stop_flag():
            break
        mr = play_pair(cfg_a, cfg_b, size=size,
                       opening_plies=opening_plies, seed=1000 + i)
        wins += mr.a_wins
        total += mr.a_wins + mr.b_wins
        detail.append({"round": i, "a": mr.a_wins, "b": mr.b_wins,
                       "moves": [g.moves for g in mr.games],
                       "elapsed": round(sum(g.elapsed for g in mr.games), 2)})
        if on_progress:
            on_progress({
                "phase": label, "round": i + 1, "rounds": rounds,
                "a_wins": wins, "b_wins": total - wins,
                "rate": round(wins / max(total, 1e-9), 4),
            })
    return (wins / total if total else 0.5), detail


def coordinate_search(base: Optional[EngineConfig] = None,
                      rounds_per_trial: int = 3,
                      deltas: Optional[Dict[str, float]] = None,
                      max_passes: int = 1,
                      size: int = 15,
                      opening_plies: int = 4,
                      on_progress: Optional[Callable] = None,
                      stop_flag: Optional[Callable[[], bool]] = None,
                      ) -> dict:
    """坐标搜索：逐个参数试 ±delta，保留更优值。

    返回 {"best": {...}, "history": [...], "baseline_rate": float}
    """
    base = (base or EngineConfig()).copy()
    # 用很快的对局配置：调参必须在可控时间内跑完
    base.update({"search.time_budget": 0.15, "search.max_depth": 2})
    deltas = deltas or {
        "eval.defense_weight": 0.15,
        "search.width_deep": 4,
        "search.width_mid": 3,
        "search.sort_defense": 0.12,
    }

    best = base.flat()
    best = {k: best[k] for k in TUNING_SPACE}
    history: List[dict] = []

    # 基线：默认参数 vs 默认参数（校准用）。
    if on_progress:
        on_progress({"phase": "start", "params": best})

    for p in range(max_passes):
        improved = False
        for name in TUNING_SPACE:
            if stop_flag is not None and stop_flag():
                break
            lo, hi, is_int = TUNING_SPACE[name]
            cur = best[name]
            for sign in (+1, -1):
                if stop_flag is not None and stop_flag():
                    break
                trial = dict(best)
                raw = cur + sign * deltas.get(name, (hi - lo) * 0.1)
                cand = _clamp(name, raw)
                if cand == cur:
                    continue
                # A = 候选参数，B = 当前最好
                rate, detail = _score(
                    _cfg_from(base, {k: v for k, v in trial.items() if k != name} | {name: cand}),
                    _cfg_from(base, best),
                    rounds_per_trial, size, opening_plies,
                    on_progress=on_progress,
                    stop_flag=stop_flag,
                    label=f"{name} {cur}->{cand}")
                entry = {"pass": p, "param": name, "from": cur, "to": cand,
                         "rate": round(rate, 4), "detail": detail}
                history.append(entry)
                if rate > 0.5:
                    best[name] = cand
                    cur = cand
                    improved = True
        if not improved:
            break

    return {"best": best, "history": history,
            "config": _cfg_from(base, best).to_dict()}


def spsa(base: Optional[EngineConfig] = None,
         iterations: int = 20,
         rounds_per_eval: int = 2,
         a: float = 0.25,
         c: float = 0.12,
         size: int = 15,
         opening_plies: int = 4,
         on_progress: Optional[Callable] = None,
         stop_flag: Optional[Callable[[], bool]] = None,
         ) -> dict:
    """SPSA：同时扰动所有参数，用两局结果估梯度。整数参数按连续处理再 round。"""
    base = (base or EngineConfig()).copy()
    base.update({"search.time_budget": 0.15, "search.max_depth": 2})
    rng = random.Random(2025)

    names = list(TUNING_SPACE)
    theta = {n: TUNING_SPACE[n][0] + (TUNING_SPACE[n][1] - TUNING_SPACE[n][0]) * 0.5
             for n in names}
    history: List[dict] = []

    for k in range(iterations):
        if stop_flag is not None and stop_flag():
            break
        ak = a / (k + 1) ** 0.101
        ck = c / (k + 1) ** 0.101
        delta = {n: rng.choice((-1.0, 1.0)) for n in names}
        plus = {n: _clamp(n, theta[n] + ck * delta[n] *
                          (TUNING_SPACE[n][1] - TUNING_SPACE[n][0]) * 0.5)
                for n in names}
        minus = {n: _clamp(n, theta[n] - ck * delta[n] *
                           (TUNING_SPACE[n][1] - TUNING_SPACE[n][0]) * 0.5)
                 for n in names}

        rate_p, _ = _score(_cfg_from(base, plus), _cfg_from(base, minus),
                           rounds_per_eval, size, opening_plies,
                           on_progress=on_progress, stop_flag=stop_flag,
                           label=f"spsa#{k} plus")
        g_hat = rate_p - 0.5          # 正 → plus 更好

        step = {}
        for n in names:
            span = TUNING_SPACE[n][1] - TUNING_SPACE[n][0]
            step[n] = ak * g_hat * delta[n] / max(ck, 1e-9) * span * 0.02
            theta[n] = _clamp(n, theta[n] + step[n])

        entry = {"iter": k, "rate_plus": round(rate_p, 4),
                 "theta": {n: round(theta[n], 3) for n in names}}
        history.append(entry)
        if on_progress:
            on_progress({"phase": f"spsa#{k}", "theta": entry["theta"],
                         "rate_plus": entry["rate_plus"]})

    return {"best": theta, "history": history,
            "config": _cfg_from(base, theta).to_dict()}


# ---------------------------------------------------------------------------
# 结果落盘
# ---------------------------------------------------------------------------
def save_result(result: dict, tag: str = "run") -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    p = OUTPUT_DIR / f"{tag}_{stamp}.json"
    p.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


def benchmark(cfg: Optional[EngineConfig] = None, size: int = 15,
              opening_plies: int = 4, rounds: int = 2) -> dict:
    """固定参数 vs 默认参数，看当前配置的客观强弱（用于验证调参结果）。"""
    base = (cfg or EngineConfig()).copy()
    base.update({"search.time_budget": 0.15, "search.max_depth": 2})
    default = EngineConfig()
    default.update({"search.time_budget": 0.15, "search.max_depth": 2})
    rate, detail = _score(base, default, rounds, size, opening_plies,
                          label="benchmark")
    return {"rate_vs_default": round(rate, 4), "detail": detail}
