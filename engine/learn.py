"""在线负反馈学习：每局结束后按胜负微调评估权重。

输了上调防守权重（+lr）、赢了向默认锚点回落、平局不动。
持久化到 profiles/learned.json，下次建 AI 时自动加载。
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional

from .config import ROOT, TUNING_SPACE, EngineConfig
from .constants import BLACK, WHITE, opponent

# 学习结果持久化位置（相对项目根）。
LEARNED_PATH = ROOT / "profiles" / "learned.json"
ARCHIVE_DIR = ROOT / "output" / "learn"

# 在线学习允许动的旋钮（与 TUNING_SPACE 对齐）。
LEARNABLE = {
    "eval.defense_weight": (0.80, 1.80, False),
    "search.sort_defense": (0.80, 1.60, False),
}

# 各旋钮的默认锚点。
_DEFAULT_ANCHOR = {
    "eval.defense_weight": 1.15,
    "search.sort_defense": 1.15,
}


def load_learned() -> EngineConfig:
    """读取已学习到的参数；没有则返回默认配置。"""
    if not LEARNED_PATH.exists():
        return EngineConfig()
    try:
        raw = json.loads(LEARNED_PATH.read_text(encoding="utf-8"))
        cfg = EngineConfig()
        for group in ("eval", "search"):
            sub = getattr(cfg, group)
            for k, v in (raw.get(group) or {}).items():
                if hasattr(sub, k):
                    setattr(sub, k, v)
        return cfg
    except Exception:
        return EngineConfig()


def _clamp(name: str, val: float) -> float:
    lo, hi, is_int = TUNING_SPACE[name]
    v = float(max(lo, min(hi, val)))
    return round(v, 3)


@dataclass
class LearnResult:
    """一次学习（一局棋的反馈）的结论。"""

    outcome: str = "draw"          # win | lose | draw
    my_color: int = 0
    moves: int = 0
    before: Dict[str, float] = field(default_factory=dict)
    after: Dict[str, float] = field(default_factory=dict)
    changed: bool = False
    file: Optional[str] = None

    def as_dict(self) -> dict:
        return {
            "outcome": self.outcome,
            "my_color": self.my_color,
            "moves": self.moves,
            "before": self.before,
            "after": self.after,
            "changed": self.changed,
            "file": self.file,
        }


class Learner:
    """在线负反馈学习器。用法见 README「在线学习」。"""

    def __init__(self, lr: float = 0.03, cfg: Optional[EngineConfig] = None):
        self.lr = float(lr)
        self.cfg = cfg if cfg is not None else load_learned()

    # -- 配置 -----------------------------------------------------------------
    def config(self) -> EngineConfig:
        """返回当前学习到的配置（可复制后叠加难度档位）。"""
        return self.cfg.copy()

    # -- 反馈 -----------------------------------------------------------------
    def apply_outcome(self, winner: int, my_color: int, moves: int) -> LearnResult:
        """把一局棋的胜负喂回来，返回学习结果。"""
        before = {k: getattr(self._sub(k), k.split(".", 1)[1])
                  for k in LEARNABLE}

        if my_color == 0:
            outcome = "draw"
        elif winner == my_color:
            outcome = "win"
        elif winner != 0:
            outcome = "lose"
        else:
            outcome = "draw"

        for name in LEARNABLE:
            cur = before[name]
            anchor = _DEFAULT_ANCHOR[name]
            if outcome == "lose":
                # 输了上调（更重视防守）。
                nxt = cur + self.lr
            elif outcome == "win":
                # 赢了向默认锚点轻微回落。
                nxt = cur - self.lr * 0.3
                if (cur > anchor and nxt < anchor) or cur <= anchor:
                    nxt = cur
                elif cur > anchor:
                    nxt = max(anchor, nxt)
            else:
                nxt = cur
            self._set(name, _clamp(name, nxt))

        after = {k: getattr(self._sub(k), k.split(".", 1)[1]) for k in LEARNABLE}
        changed = any(after[k] != before[k] for k in LEARNABLE)

        res = LearnResult(outcome=outcome, my_color=my_color, moves=moves,
                          before=before, after=after, changed=changed)
        if changed:
            self.save()
            res.file = str(self.archive(res))
        return res

    # -- 持久化 -----------------------------------------------------------------
    def save(self) -> Path:
        LEARNED_PATH.parent.mkdir(parents=True, exist_ok=True)
        LEARNED_PATH.write_text(
            json.dumps(self.cfg.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8")
        return LEARNED_PATH

    def archive(self, result: LearnResult) -> Path:
        """把这次学习结果存档（每局一条，供事后复盘）。"""
        ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%d_%H%M%S")
        p = ARCHIVE_DIR / f"learn_{stamp}.json"
        p.write_text(json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
                     encoding="utf-8")
        return p

    # -- 内部 -----------------------------------------------------------------
    def _sub(self, name: str):
        group, key = name.split(".", 1)
        return getattr(self.cfg, group)

    def _set(self, name: str, val: float) -> None:
        group, key = name.split(".", 1)
        setattr(getattr(self.cfg, group), key, val)


def default_learner() -> Learner:
    """进程级默认学习器（供 GameSession 使用，加载 learned.json）。"""
    return Learner()
