"""引擎超参数集中定义。

提供 EvalConfig / SearchConfig / EngineConfig 三个数据对象，支持
flat()/from_dict()/copy()/update()/to_dict()/save()/load()，以及
TUNING_SPACE 搜索空间、LEVELS 难度档位、config_for_level()。
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any, Dict

# 项目根目录（engine/ 的上一级）。
ROOT = Path(__file__).resolve().parent.parent


@dataclass
class EvalConfig:
    """棋型评估相关参数。"""

    # 防守权重（>1 表示防守优先）。
    defense_weight: float = 1.15

    # 单点势能封顶。
    point_cap: int = 200_000

    # 判胜/判负分值。
    win_score: int = 1_000_000_000


@dataclass
class SearchConfig:
    """αβ 搜索相关参数。"""

    time_budget: float = 2.0
    max_depth: int = 8

    # 候选宽度（按剩余深度分级）。
    width_deep: int = 16
    width_mid: int = 12
    width_shallow: int = 8

    # 走法排序时防守项的权重。
    sort_defense: float = 1.15

    use_vcf: bool = True
    vcf_max_depth: int = 12
    vcf_node_limit: int = 200_000

    # 置换表容量（2 的幂）。
    tt_bits: int = 19

    # 杀手走法奖励分与必胜走法分（排序用）。
    sort_killer: int = 10_000_000
    sort_mate: int = 10 ** 12


@dataclass
class EngineConfig:
    """完整可调参数集。嵌套结构展开成扁平 key 便于网格搜索。"""

    eval: EvalConfig = field(default_factory=EvalConfig)
    search: SearchConfig = field(default_factory=SearchConfig)

    # ---- 扁平读写 --------------------------------------------------------
    def flat(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for f in fields(self):
            sub = getattr(self, f.name)
            for sf in fields(sub):
                out[f"{f.name}.{sf.name}"] = getattr(sub, sf.name)
        return out

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EngineConfig":
        cfg = cls()
        for key, val in data.items():
            if "." in key:
                group, name = key.split(".", 1)
                sub = getattr(cfg, group, None)
                if sub is not None and hasattr(sub, name):
                    setattr(sub, name, val)
            elif hasattr(cfg, key):
                setattr(cfg, key, val)
        return cfg

    def copy(self) -> "EngineConfig":
        return EngineConfig.from_dict(self.flat())

    def update(self, data: Dict[str, Any]) -> "EngineConfig":
        """原地更新并返回自身，方便链式调用。"""
        for key, val in data.items():
            if "." in key:
                group, name = key.split(".", 1)
                sub = getattr(self, group, None)
                if sub is not None and hasattr(sub, name):
                    setattr(sub, name, val)
            elif hasattr(self, key):
                setattr(self, key, val)
        return self

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def save(self, path) -> Path:
        p = Path(path)
        if not p.is_absolute():
            p = ROOT / p
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=2),
                     encoding="utf-8")
        return p

    @classmethod
    def load(cls, path) -> "EngineConfig":
        p = Path(path)
        if not p.is_absolute():
            p = ROOT / p
        if not p.exists():
            return cls()
        raw = json.loads(p.read_text(encoding="utf-8"))
        cfg = cls()
        for group in ("eval", "search"):
            sub = getattr(cfg, group)
            for k, v in (raw.get(group) or {}).items():
                if hasattr(sub, k):
                    setattr(sub, k, v)
        return cfg


# 自我对弈调参的默认搜索空间：只放"真能影响棋力"且"范围合理"的。
# 每一项是 (min, max, is_int)。
TUNING_SPACE: Dict[str, tuple] = {
    "eval.defense_weight": (0.80, 1.80, False),
    "search.width_deep": (8, 24, True),
    "search.width_mid": (6, 18, True),
    "search.sort_defense": (0.80, 1.60, False),
}

# 面向用户的预设档位（难度）。
LEVELS: Dict[int, Dict[str, Any]] = {
    1: {"search.time_budget": 0.15, "search.max_depth": 2, "search.use_vcf": False},
    2: {"search.time_budget": 0.40, "search.max_depth": 4},
    3: {"search.time_budget": 1.00, "search.max_depth": 6},
    4: {"search.time_budget": 2.50, "search.max_depth": 8},
    5: {"search.time_budget": 5.00, "search.max_depth": 10},
}


def config_for_level(level: int) -> EngineConfig:
    cfg = EngineConfig()
    cfg.update(LEVELS.get(int(level), LEVELS[3]))
    return cfg
