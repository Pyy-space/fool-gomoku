"""应用级状态容器：把对局、调参、在线学习的运行时对象收在一处。

多线程（Flask 线程 + 后台线程），可变状态都加 RLock；长任务在后台线程跑，
通过 push() 推给 SocketIO，不阻塞 HTTP 请求。
"""

from __future__ import annotations

import threading
import time
import traceback
from typing import Callable, Dict, List, Optional

from adapters import LocalAdapter
from core.collector import count_games, read_games
from core.profile import Profile, default_profile, get_profile, list_profiles
from engine.config import TUNING_SPACE, EngineConfig
from engine.learn import default_learner
from engine.tuner import benchmark, coordinate_search, save_result, spsa


class AppState:
    def __init__(self):
        self.lock = threading.RLock()
        self.local = LocalAdapter()
        self.learner = default_learner()   # 在线负反馈学习器（加载 profiles/learned.json）
        self.learn_enabled = True
        self.profile = default_profile()
        self.profile_file = "generic"
        self.tuner_thread: Optional[threading.Thread] = None
        self.tuner_stop = threading.Event()
        self.tuner_log: List[dict] = []
        self.tuner_result: Optional[dict] = None
        self.tuner_running = False
        self._sink: Optional[Callable[[str, dict], None]] = None

    # -- 事件推送 -----------------------------------------------------------
    def bind_sink(self, sink: Callable[[str, dict], None]) -> None:
        self._sink = sink

    def push(self, event: str, payload: dict) -> None:
        if self._sink:
            try:
                self._sink(event, payload)
            except Exception:
                pass

    # -- profile ------------------------------------------------------------
    def profiles(self) -> List[dict]:
        out = list_profiles()
        if not any(p["file"] == "generic.json" for p in out):
            out.append({"file": "generic.json", "name": "generic",
                        "description": "内置默认", "size": 15})
        return out

    def set_profile(self, name: str) -> Profile:
        with self.lock:
            p = get_profile(name)
            self.profile = p
            self.profile_file = name
            return p

    # -- 本地对局 -----------------------------------------------------------
    def new_game(self, human_color: int = 1, level: int = 3, size: int = 15,
                 rules: str = "casual", seed: Optional[int] = None) -> dict:
        with self.lock:
            # 重建会话时带上学习器，让学到的权重在下局生效
            from core.game import GameSession
            self.local.session = GameSession(
                size=size, rules=rules, human_color=human_color, level=level,
                learner=self.learner if self.learn_enabled else None,
                learn_enabled=self.learn_enabled)
            return self.local.new_game(human_color=human_color, level=level,
                                       size=size, rules=rules, seed=seed)

    def set_learn(self, enabled: bool) -> dict:
        with self.lock:
            self.learn_enabled = bool(enabled)
            if self.local.session is not None:
                self.local.session.learn_enabled = self.learn_enabled
                self.local.session.learner = self.learner if self.learn_enabled else None
            return {"ok": True, "enabled": self.learn_enabled}

    def learn_status(self) -> dict:
        with self.lock:
            params = {
                "eval.defense_weight": self.learner.cfg.eval.defense_weight,
                "search.sort_defense": self.learner.cfg.search.sort_defense,
            }
            return {"enabled": self.learn_enabled, "params": params}

    def human_move(self, x: int, y: int) -> dict:
        with self.lock:
            return self.local.human_move(x, y)

    def ai_reply_async(self) -> dict:
        if self.local.session.over:
            return {"ok": False, "reason": "对局已结束"}

        def done(r):
            self.push("ai_done", r)

        self.local.ai_reply_async(lambda r: done(r))
        return {"ok": True, "status": "thinking"}

    def ai_reply_sync(self) -> dict:
        with self.lock:
            return self.local.ai_reply()

    def undo(self, steps: int = 2) -> dict:
        with self.lock:
            return self.local.undo(steps)

    def hint(self) -> dict:
        with self.lock:
            return self.local.hint()

    # -- 自我对弈调参 -------------------------------------------------------
    def tuner_start(self, method: str = "coordinate", rounds: int = 2,
                    iterations: int = 10, size: int = 15,
                    time_budget: float = 0.15, max_depth: int = 2) -> dict:
        with self.lock:
            if self.tuner_running:
                return {"ok": False, "reason": "调参已在运行"}
            self.tuner_running = True
            self.tuner_stop.clear()
            self.tuner_log = []
            self.tuner_result = None

        base = EngineConfig()
        base.update({"search.time_budget": time_budget,
                     "search.max_depth": max_depth})

        def progress(ev: dict) -> None:
            ev = dict(ev)
            ev["t"] = time.strftime("%H:%M:%S")
            self.tuner_log.append(ev)
            if len(self.tuner_log) > 400:
                del self.tuner_log[:100]
            self.push("tuner_progress", ev)

        def work():
            try:
                if method == "spsa":
                    res = spsa(base=base, iterations=iterations,
                               rounds_per_eval=rounds, size=size,
                               on_progress=progress,
                               stop_flag=self.tuner_stop.is_set)
                else:
                    res = coordinate_search(base=base, rounds_per_trial=rounds,
                                            max_passes=max(1, iterations // 4 or 1),
                                            size=size, on_progress=progress,
                                            stop_flag=self.tuner_stop.is_set)
                try:
                    res["file"] = str(save_result(res, tag=f"tune_{method}"))
                except Exception:
                    res["file"] = None
                self.tuner_result = res
                self.push("tuner_done", {"ok": True,
                                          "best": res.get("best"),
                                          "file": res.get("file"),
                                          "config": res.get("config")})
            except Exception as e:
                tb = traceback.format_exc(limit=3)
                self.push("tuner_done", {"ok": False,
                                          "reason": f"{type(e).__name__}: {e}",
                                          "traceback": tb})
            finally:
                self.tuner_running = False

        self.tuner_thread = threading.Thread(target=work, name="tuner", daemon=True)
        self.tuner_thread.start()
        return {"ok": True, "method": method}

    def tuner_stop_run(self) -> dict:
        self.tuner_stop.set()
        return {"ok": True}

    def tuner_status(self) -> dict:
        return {
            "running": self.tuner_running,
            "space": {k: {"min": v[0], "max": v[1], "int": v[2]}
                      for k, v in TUNING_SPACE.items()},
            "log": self.tuner_log[-40:],
            "result": self.tuner_result,
        }

    def tuner_benchmark(self, config: Optional[dict] = None,
                        rounds: int = 2) -> dict:
        cfg = EngineConfig.from_dict(config) if config else EngineConfig()
        return benchmark(cfg, rounds=rounds)

    # -- 对局数据采集 -------------------------------------------------------
    def games_count(self) -> int:
        return count_games()

    def games_export(self) -> str:
        return read_games()


STATE = AppState()
