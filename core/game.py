"""对局会话层：本地人机对弈、窗口自动对战的共用状态机。

为什么单独一层：
- 测试功能一（人 vs AI）和自动对战（识别窗口 → 同步 → 落子）用到的是**同一套**
  「棋盘 + 轮次 + AI 出手 + 悔棋」逻辑，只有"棋子从哪来"不同（鼠标点 / 视觉识别）。
- Web 端要能随时把局面序列化成 JSON 推到前端，所以状态读写都收在这里。

约定
----
* 坐标 (x, y)：x 向右、y 向下，与屏幕/截图坐标同序。
* `human_color` 为 0 表示"双方都由 AI 或外部驱动"（自动对战模式用）。
* 所有改盘动作都会写入 `moves`，`undo` 依据它回滚，保证可悔棋。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from engine import AI
from engine.board import Board
from engine.config import EngineConfig, config_for_level
from engine.constants import BLACK, EMPTY, RULES_CASUAL, WHITE, opponent
from engine.learn import Learner, default_learner


@dataclass
class MoveRecord:
    x: int
    y: int
    color: int
    by: str = "human"      # human | ai | sync（从画面识别同步进来的）

    def as_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "color": self.color, "by": self.by}


@dataclass
class SyncReport:
    """把识别结果同步进内部棋盘的结论。"""

    applied: List[tuple] = field(default_factory=list)   # 新增的 (x, y, color)
    removed: List[tuple] = field(default_factory=list)   # 凭空消失的 (x, y, color)
    conflicts: List[tuple] = field(default_factory=list)  # (x, y, 内部色, 识别色)
    changed: bool = False

    def as_dict(self) -> dict:
        return {
            "applied": [{"x": x, "y": y, "color": c} for x, y, c in self.applied],
            "removed": [{"x": x, "y": y, "color": c} for x, y, c in self.removed],
            "conflicts": [{"x": x, "y": y, "mine": m, "theirs": t}
                          for x, y, m, t in self.conflicts],
            "changed": self.changed,
        }


class GameSession:
    """一局棋的完整状态。"""

    def __init__(self, size: int = 15, rules: str = RULES_CASUAL,
                 human_color: int = BLACK, level: int = 3,
                 ai_config: Optional[EngineConfig] = None,
                 learner: Optional[Learner] = None,
                 learn_enabled: bool = True):
        self.size = size
        self.rules = rules
        self.board = Board(size, rules=rules)
        self.ai: Optional[AI] = None
        self.human_color: int = human_color       # 0 = 无人执子（自动模式）
        self.level: int = level
        self.ai_config: EngineConfig = ai_config or config_for_level(level)
        self.learner: Optional[Learner] = learner  # 在线负反馈学习器（None = 不学）
        self.learn_enabled: bool = bool(learn_enabled)
        self._learned_this_game: bool = False      # 一局只反馈一次
        self.last_learn: Optional[dict] = None     # 最近一次学习结果（给 UI）
        self.records: List[MoveRecord] = []
        self.snapshots: List[dict] = []        # 悔棋用：每步前的 grid 快照
        self.ai_thinking = False
        self.notes: List[str] = []
        self._recorded: bool = False           # 一局数据只落盘一次
        self._build_ai()

    # -- 配置 ---------------------------------------------------------------
    def _learned_config(self) -> EngineConfig:
        """把学习到的参数叠加到当前档位配置上。"""
        cfg = self.ai_config.copy()
        if self.learner is not None and self.learn_enabled:
            learned = self.learner.config()
            from engine.learn import LEARNABLE
            for name in LEARNABLE:
                group, key = name.split(".", 1)
                setattr(getattr(cfg, group), key, getattr(getattr(learned, group), key))
        return cfg

    def _build_ai(self, seed: Optional[int] = None) -> None:
        self.ai = AI(level=self.level, rules=self.rules,
                     config=self._learned_config(), seed=seed)

    def reset(self, size: Optional[int] = None, rules: Optional[str] = None,
              human_color: Optional[int] = None, level: Optional[int] = None,
              ai_config: Optional[EngineConfig] = None,
              seed: Optional[int] = None) -> None:
        if size is not None:
            self.size = int(size)
        if rules is not None:
            self.rules = rules
        if human_color is not None:
            self.human_color = int(human_color)
        if level is not None:
            self.level = int(level)
            self.ai_config = config_for_level(self.level)
        if ai_config is not None:
            self.ai_config = ai_config
        self.board = Board(self.size, rules=self.rules)
        self.records = []
        self.snapshots = []
        self.notes = []
        self._learned_this_game = False
        self.last_learn = None
        self._recorded = False
        self._build_ai(seed)

    # -- 基本查询 -----------------------------------------------------------
    @property
    def side(self) -> int:
        return self.board.side

    @property
    def winner(self) -> int:
        return self.board.winner()

    @property
    def over(self) -> bool:
        return self.board.winner() != 0 or self.board.is_full

    @property
    def last_move(self):
        return self.board.last_move()

    def is_ai_turn(self) -> bool:
        if self.over or self.human_color == 0:
            return False
        return self.board.side != self.human_color

    def legal(self, x: int, y: int) -> bool:
        if self.over or not self.board.inside(x, y):
            return False
        if not self.board.is_empty_at(x, y):
            return False
        if self.rules == "renju" and self.board.side == BLACK:
            from engine.rules import is_legal
            return is_legal(self.board, x, y)
        return True

    # -- 落子 ---------------------------------------------------------------
    def _snapshot(self) -> None:
        self.snapshots.append({"grid": self.board.to_list(),
                               "side": self.board.side,
                               "records": len(self.records)})

    def place(self, x: int, y: int, by: str = "human",
              color: Optional[int] = None) -> dict:
        """落一子。color 为空时用当前轮次方。返回 {ok, reason?}。"""
        if self.over:
            return {"ok": False, "reason": "对局已结束"}
        if not self.board.inside(x, y):
            return {"ok": False, "reason": "坐标越界"}
        if not self.board.is_empty_at(x, y):
            return {"ok": False, "reason": "该点已有棋子"}
        turn = self.board.side
        if color is not None and color != turn:
            return {"ok": False, "reason": "还没到该方行棋"}
        if self.rules == "renju" and turn == BLACK:
            from engine.rules import is_legal
            if not is_legal(self.board, x, y):
                from engine.rules import forbidden_reason
                return {"ok": False,
                        "reason": f"黑方禁手：{forbidden_reason(self.board, x, y)}"}
        self._snapshot()
        self.board.place(x, y)
        self.records.append(MoveRecord(x, y, turn, by))
        self._maybe_learn()
        self._maybe_record()
        return {"ok": True, "color": turn}

    def ai_move(self) -> dict:
        """让 AI 为当前方走一步，返回 {ok, move, analysis}。"""
        if self.over:
            return {"ok": False, "reason": "对局已结束"}
        if self.ai is None:
            return {"ok": False, "reason": "AI 未初始化"}
        self.ai_thinking = True
        try:
            turn = self.board.side
            analysis = self.ai.analyse(self.board)
            mv = analysis.get("move")
            if not mv:
                return {"ok": False, "reason": "AI 没有可用落点", "analysis": analysis}
            x, y = mv["x"], mv["y"]
            if not self.legal(x, y):
                return {"ok": False, "reason": "AI 给出非法点", "analysis": analysis}
            self._snapshot()
            self.board.place(x, y)
            self.records.append(MoveRecord(x, y, turn, "ai"))
            self._maybe_learn()
            self._maybe_record()
            return {"ok": True, "move": mv, "analysis": analysis}
        finally:
            self.ai_thinking = False

    def undo(self, count: int = 1) -> int:
        """回滚 count 步。返回实际回滚的步数。"""
        n = 0
        while n < count and self.snapshots:
            snap = self.snapshots.pop()
            self.board._load(snap["grid"])
            self.board.side = snap["side"]
            del self.records[snap["records"]:]
            n += 1
        return n

    # -- 在线负反馈学习 -----------------------------------------------------
    def _maybe_learn(self) -> None:
        """一局结束（且尚未反馈过）时，把胜负喂给学习器。"""
        if not (self.learner is not None and self.learn_enabled):
            return
        if self._learned_this_game:
            return
        w = self.board.winner()
        if w == 0 and not self.board.is_full:
            return  # 尚未终局
        if self.human_color == 0:
            return  # 自动对战/无人类执子时不学（没有明确的"我方"）
        my_color = opponent(self.human_color)
        res = self.learner.apply_outcome(w, my_color, len(self.records))
        self._learned_this_game = True
        self.last_learn = res.as_dict()
        # 学习到的新权重立刻用到下一局（重建 AI 时 _learned_config 会读 learner）
        if res.changed:
            self.notes.append(
                f"已学习：{res.outcome}，防守权重 "
                f"{res.before.get('eval.defense_weight')} → {res.after.get('eval.defense_weight')}")

    def learn_status(self) -> dict:
        """给前端看的学习状态。"""
        return {
            "enabled": self.learn_enabled and self.learner is not None,
            "learned_this_game": self._learned_this_game,
            "last": self.last_learn,
            "params": None if self.learner is None else {
                k: getattr(getattr(self.learner.cfg, k.split(".", 1)[0]),
                           k.split(".", 1)[1])
                for k in ("eval.defense_weight", "search.sort_defense")
            },
        }

    # -- 对局数据采集（网页版收集网友棋谱用） -------------------------------
    def _maybe_record(self) -> None:
        """一局结束后，把整局棋谱落盘到 output/games.jsonl，供回流优化。"""
        if self._recorded:
            return
        w = self.board.winner()
        if w == 0 and not self.board.is_full:
            return  # 尚未终局
        self._recorded = True
        try:
            from core.collector import record_game
            record_game(
                size=self.size,
                rules=self.rules,
                human_color=self.human_color,
                winner=w,
                moves=[r.as_dict() for r in self.records],
                config=self.ai_config.flat(),
            )
        except Exception:
            # 采集失败绝不影响对局本身
            pass

    # -- 从识别结果同步（自动对战核心） -------------------------------------
    def sync(self, grid_values: List[int], auto_removed: bool = True) -> SyncReport:
        """把识别到的整盘棋同步进内部棋盘。

        规则：
        * 内部空、识别有子 → 新增（`by="sync"`）。
        * 内部有子、识别为空 → 默认视为识别漏检，**不回滚**（漏检比误判常见）；
          只有 `auto_removed=True` 且整盘识别置信度足够时才会移除。
        * 同点颜色冲突 → 记入 conflicts，不自动改。
        """
        rep = SyncReport()
        size = self.size
        if len(grid_values) != size * size:
            rep.conflicts.append((-1, -1, -1, -1))
            return rep

        # 先校验颜色体系是否一致（识别到黑白反了会整盘冲突，直接报出来）
        for idx, val in enumerate(grid_values):
            x, y = idx % size, idx // size
            mine = self.board.grid[idx]
            if val == mine:
                continue
            if mine == EMPTY and val in (BLACK, WHITE):
                rep.applied.append((x, y, int(val)))
            elif mine in (BLACK, WHITE) and val == EMPTY:
                rep.removed.append((x, y, int(mine)))
            elif mine in (BLACK, WHITE) and val in (BLACK, WHITE):
                rep.conflicts.append((x, y, int(mine), int(val)))

        # 冲突太多说明颜色/朝向搞错了，宁可不动
        if len(rep.conflicts) > 2:
            return rep

        if rep.applied or (auto_removed and rep.removed):
            self.snapshots.append({"grid": self.board.to_list(),
                                   "side": self.board.side,
                                   "records": len(self.records)})
            # 不允许回滚时，把内部已有但识别为空的位置补回去，避免"识别漏检
            # 把真棋子抹掉"。这是自动对战最常见的故障模式。
            if not auto_removed:
                vals = list(grid_values)
                for x, y, c in rep.removed:
                    vals[y * size + x] = c
            else:
                vals = list(grid_values)
            self.board._load(vals)
            for x, y, c in rep.applied:
                self.records.append(MoveRecord(x, y, c, "sync"))
            if auto_removed:
                for x, y, c in rep.removed:
                    self.records.append(MoveRecord(x, y, EMPTY, "sync"))
            rep.changed = True
        return rep

    # -- 序列化给 Web 前端 --------------------------------------------------
    def state(self) -> dict:
        last = self.last_move
        return {
            "size": self.size,
            "rules": self.rules,
            "grid": self.board.to_list(),
            "rows": self.board.to_rows(),
            "side": self.board.side,
            "moves": [r.as_dict() for r in self.records],
            "last": {"x": last[0], "y": last[1]} if last else None,
            "winner": self.board.winner(),
            "over": self.over,
            "human_color": self.human_color,
            "level": self.level,
            "ai_thinking": self.ai_thinking,
            "stones": self.board.stone_count,
            "notes": self.notes[-8:],
            "learn": self.learn_status(),
        }
