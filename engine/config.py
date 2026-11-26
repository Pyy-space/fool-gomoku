"""引擎超参数集中定义。

为什么需要这一层：

1. 原项目的「超参数」写死在代码里（`UCB_C = 0.2`），想调只能改源码重编译。
2. 本项目的 αβ 引擎有一批真正影响棋力的旋钮（防守权重、候选宽度、VCF 深度…），
   它们的**最优值和棋盘风格强相关**，没有理论解析解 —— 只能靠实测。
3. 测试功能二（自我对弈调参）要把这些参数当搜索空间来打分，必须能
   「在运行时构造一份改动的参数 → 跑一局 → 拿胜负」。所以参数必须是数据，不是常量。

用法：
    from engine.config import EngineConfig
    cfg = EngineConfig()
    cfg.defense_weight = 1.25          # 直接改字段
    cfg = EngineConfig.from_dict({"search.width_deep": 20})
    cfg.save("profiles/tuned.json")

所有搜索/评估代码通过 `Searcher(config=...)` / `Evaluator(defense_weight=...)`
接收，不读模块级常量 —— 保证两副参数可以同时存在于一个进程里（自我对弈必需）。
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any, Dict

# 项目根目录：engine/ 的上一级。全项目统一用相对路径，便于整体搬迁。
ROOT = Path(__file__).resolve().parent.parent


@dataclass
class EvalConfig:
    """棋型评估相关参数。"""

    # 防守权重：> 1 表示"堵对手"比"自己成形状"更重要。
    # 五子棋里漏防一个四直接输，而自己多一个活三不一定赢，所以通常 > 1。
    defense_weight: float = 1.15

    # 单点势能封顶。活四单方向就 120_000，不封顶会让一步活四完全主导评估，
    # 使搜索看不见"对手也在成四"这种平衡局面。
    point_cap: int = 200_000

    # 直接判胜/判负的分值（搜索里用，与 MATE 同量级）。
    win_score: int = 1_000_000_000


@dataclass
class SearchConfig:
    """αβ 搜索相关参数。"""

    time_budget: float = 2.0
    max_depth: int = 8

    # 候选宽度（按剩余深度分级）。五子棋分支太多，必须剪。
    width_deep: int = 16
    width_mid: int = 12
    width_shallow: int = 8

    # 走法排序时防守项的权重（与评估里的 defense_weight 独立：
    # 一个决定"局面值多少钱"，一个决定"先算哪个"）。
    sort_defense: float = 1.15

    use_vcf: bool = True
    vcf_max_depth: int = 12
    vcf_node_limit: int = 200_000

    # 置换表容量（2 的幂）。
    tt_bits: int = 19

    # 杀手走法的奖励分（排序用）。必须远大于普通棋型分，但不能盖过必胜分。
    sort_killer: int = 10_000_000
    sort_mate: int = 10 ** 12


@dataclass
class EngineConfig:
    """完整可调参数集。嵌套结构展开成扁平 key 便于网格搜索。"""

    eval: EvalConfig = field(default_factory=EvalConfig)
    search: SearchConfig = field(default_factory=SearchConfig)

    # ---- 扁平读写（自我对弈调参用） -------------------------------------
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
