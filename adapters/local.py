"""本地人机对弈适配器（测试功能一）。把人的点击与 AI 的应手串起来，棋盘状态在 core.game.GameSession。"""

from __future__ import annotations

import threading
from typing import Callable, Optional

from core.game import GameSession
from engine.config import EngineConfig, config_for_level
from engine.constants import BLACK, WHITE


class LocalAdapter:
    """本地对局控制器。

    用法::

        ad = LocalAdapter()
        ad.new_game(human_color=BLACK, level=3)
        ad.human_move(7, 7)
        ad.ai_reply()            # 或 ad.ai_reply_async(callback)
    """

    def __init__(self, session: Optional[GameSession] = None):
        self.session = session or GameSession()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

    # -- 开局 ---------------------------------------------------------------
    def new_game(self, human_color: int = BLACK, level: int = 3,
                 size: int = 15, rules: str = "casual",
                 ai_config: Optional[EngineConfig] = None,
                 seed: Optional[int] = None) -> dict:
        self.session.reset(size=size, rules=rules, human_color=human_color,
                           level=level, ai_config=ai_config, seed=seed)
        # 人执白时 AI 先手
        if human_color == WHITE and not self.session.over:
            self.session.ai_move()
        return self.session.state()

    # -- 人类落子 -----------------------------------------------------------
    def human_move(self, x: int, y: int) -> dict:
        with self._lock:
            res = self.session.place(x, y, by="human")
            if not res.get("ok"):
                return res
            return {"ok": True, "state": self.session.state(),
                    "move": {"x": x, "y": y}}

    def ai_turn_needed(self) -> bool:
        return (not self.session.over
                and self.session.human_color != 0
                and self.session.board.side != self.session.human_color)

    def ai_reply(self) -> dict:
        with self._lock:
            r = self.session.ai_move()
            r["state"] = self.session.state()
            return r

    def ai_reply_async(self, on_done: Callable[[dict], None]) -> None:
        """后台线程跑 AI，避免阻塞 Flask 请求。"""
        if self._thread is not None and self._thread.is_alive():
            on_done({"ok": False, "reason": "AI 正在思考"})
            return

        def _work():
            try:
                r = self.ai_reply()
            except Exception as e:
                r = {"ok": False, "reason": f"{type(e).__name__}: {e}"}
            on_done(r)

        self._thread = threading.Thread(target=_work, name="ai-reply", daemon=True)
        self._thread.start()

    # -- 其他 ---------------------------------------------------------------
    def undo(self, steps: int = 2) -> dict:
        with self._lock:
            n = self.session.undo(steps)
            return {"ok": True, "undone": n, "state": self.session.state()}

    def resign(self) -> dict:
        self.session.notes.append("玩家认输")
        return {"ok": True, "state": self.session.state()}

    def state(self) -> dict:
        return self.session.state()

    def analyse(self) -> dict:
        return self.session.ai.analyse(self.session.board)

    def hint(self) -> dict:
        """给人类提示一步（用 AI 算，不落子）。"""
        res = self.session.ai.analyse(self.session.board)
        return res
