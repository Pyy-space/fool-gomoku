"""在线负反馈学习：下完一局后，把结果喂回来微调评估参数。

先澄清一件事（对应"AI 下输了能否学习这一局"）
--------------------------------------------------
本项目是 αβ 搜索 + 手工棋型评估，**没有神经网络权重**，所以不可能像
深度学习那样"把整局棋反向传播进网络"。能做的、且不引入噪声过拟合的
"负反馈"，是把评估层里那个**没有解析最优值、只能靠实测**的旋钮——
防守权重 `defense_weight` —— 按对局结果做小幅在线调整：

    输了  → 说明这局防守做得不够（漏挡成五 / 活四的代价被低估了）
             → `defense_weight` 略微上调（更重视堵对手）
    赢了  → 权重基本合理 → 保持不变（或向默认值轻微回落，避免漂移）
    平局  → 不动

用指数移动平均 + 截断到合法区间，持久化到 ``profiles/learned.json``，
下次 ``GameSession`` 构建 AI 时自动加载。每一局也存档到 ``output/learn/``
供事后复盘。

为什么只调这一个旋钮、且步子很小
----------------------------------
* 单局棋的胜负噪声很大（开局运气、对手水平、禁手规则都在里面），
  大步子会把这局棋的偶然性学成"过拟合"，反而越学越差。
* 所以这里默认学习率 0.03，输一局防守权重只 +0.03，最多到 1.80（TUNING_SPACE 上限）。
* 真正想大幅提棋力，还是实验室里的自我对弈调参（engine.tuner 的
  coordinate_search / spsa），那个用几十~几百局把噪声压下去。

本模块与 engine.tuner 的关系
----------------------------
tuner 是**离线**超参搜索（两副参数互下 N 局、谁赢留谁）；
本模块是**在线**微调（人和 AI 下一局、AI 输了就把结果喂回来）。
两者改的是同一套 ``EngineConfig``，共享 ``TUNING_SPACE`` 的合法区间。
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional

from .config import ROOT, TUNING_SPACE, EngineConfig
from .constants import BLACK, WHITE, opponent

# 学习结果持久化位置（相对项目根，整体搬迁仍有效）。
LEARNED_PATH = ROOT / "profiles" / "learned.json"
ARCHIVE_DIR = ROOT / "output" / "learn"

# 在线学习允许动的旋钮：只放"防守倾向"这类与单局胜负直接相关、且连续可微调的。
# 值与 TUNING_SPACE 对齐，保证学习结果仍在调参空间内。
LEARNABLE = {
    "eval.defense_weight": (0.80, 1.80, False),
    "search.sort_defense": (0.80, 1.60, False),
}

# 各旋钮的默认锚点（输了往上顶、赢了往回拉，不越过默认值下限）。
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
    """在线负反馈学习器。

    用法::

        learner = Learner()                      # 自动加载 profiles/learned.json
        cfg = learner.config()                   # 交给 GameSession 构建 AI
        # … 下一局棋 …
        res = learner.apply_outcome(winner, my_color, moves)   # 终局时调用
        learner.save()
    """

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
                # 输了：防守不够 → 调高（更重视堵对手）
                nxt = cur + self.lr
            elif outcome == "win":
                # 赢了：向默认锚点轻微回落，避免长期漂移
                nxt = cur - self.lr * 0.3
                if (cur > anchor and nxt < anchor) or cur <= anchor:
                    nxt = cur  # 已经等于/低于默认就不再往下调
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
