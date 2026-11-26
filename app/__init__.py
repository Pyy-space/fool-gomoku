"""Web 应用：Flask + Flask-SocketIO 组装（web 版，纯引擎）。

本仓库（fool-gomoku）是前后端分离的 web 版，只保留纯 Python 引擎能提供的能力：
人机对弈、在线学习、实验室调参。识别下棋（窗口截图 + 自动落子）依赖 Windows
专属 API，已从本仓库移除，只在本地完整版（GomokuAI 目录）提供。

页面分工（三层导航）：
* ``/``         落地页（hero + 进入）
* ``/hub``      模式选择（人机对弈）
* ``/local``    本地人机对弈（含在线学习）
* ``/lab``      实验室（训练=机器对弈调参，彩蛋解锁 + token 鉴权）
"""

from __future__ import annotations

import base64
import io
import json
import os

from flask import Flask, jsonify, render_template, request
from flask_socketio import SocketIO, emit

from .state import STATE

# 实验室访问口令。挂网后陌生人即便找到 /lab 入口，没有口令也调不动调参 API。
# 可用环境变量 GOMOKU_LAB_TOKEN 覆盖（start.bat / 命令行均可）。
LAB_TOKEN = os.environ.get("GOMOKU_LAB_TOKEN", "gomoku-lab")


def _lab_ok(data: dict) -> bool:
    """校验实验室口令。前后端都做：前端彩蛋负责隐蔽，这里负责真锁。"""
    return str(data.get("token") or "") == LAB_TOKEN


def create_app(static_folder: str = "static", template_folder: str = "templates"):
    app = Flask(__name__, static_folder=static_folder,
                template_folder=template_folder)
    app.config["SECRET_KEY"] = "gomoku-ai-local"
    app.config["JSON_AS_ASCII"] = False

    socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

    # 前后端分离时，GitHub Pages 的前端会跨域调这里的 API，加 CORS 头。
    # Flask-SocketIO 已配置 cors_allowed_origins="*"（覆盖 WebSocket/长轮询），
    # 这里补普通 HTTP 接口的 CORS 头，并处理预检 OPTIONS 请求。
    @app.after_request
    def _cors(resp):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return resp

    @app.before_request
    def _cors_preflight():
        if request.method == "OPTIONS":
            return app.response_class(status=204)

    # SocketIO → AppState 的事件出口
    def sink(event: str, payload: dict) -> None:
        socketio.emit(event, payload)

    STATE.bind_sink(sink)

    # ------------------------------------------------------------------
    # 页面
    # ------------------------------------------------------------------
    @app.get("/")
    def page_landing():
        return render_template("landing.html")

    @app.get("/hub")
    def page_hub():
        return render_template("hub.html")

    @app.get("/local")
    def page_local():
        return render_template("local.html", profiles=STATE.profiles(),
                               active="local")

    @app.get("/lab")
    def page_lab():
        # 页面本身可打开（彩蛋负责隐蔽），但调参 API 需要 token。
        # 未解锁时前端显示口令锁，不会直接暴露参数空间。
        return render_template("lab.html", profiles=STATE.profiles(),
                               active="lab")

    # ------------------------------------------------------------------
    # 健康检查 / 平台能力（Render 探活 + 前端探测后端能力用）
    # ------------------------------------------------------------------
    @app.get("/healthz")
    def healthz():
        import sys
        return jsonify({"ok": True, "platform": "win" if sys.platform.startswith("win") else "linux",
                        "vision_available": False})

    @app.get("/api/capabilities")
    def api_capabilities():
        import sys
        return jsonify({
            "ok": True,
            "platform": "win" if sys.platform.startswith("win") else "linux",
            "features": {
                "local": True,          # 人机对弈：纯引擎，任何平台
                "lab": True,            # 实验室调参：纯引擎，任何平台
                "learn": True,          # 在线学习：纯引擎，任何平台
                "auto": False,          # 识别下棋：本仓库已移除，仅本地完整版
                "vision": False,        # 识别调试：本仓库已移除，仅本地完整版
            },
        })

    # ------------------------------------------------------------------
    # 通用 API
    # ------------------------------------------------------------------
    @app.get("/api/profiles")
    def api_profiles():
        return jsonify(STATE.profiles())

    @app.post("/api/profile")
    def api_set_profile():
        data = request.get_json(silent=True) or {}
        p = STATE.set_profile(str(data.get("name") or "generic"))
        return jsonify({"ok": True, "profile": p.to_dict()})

    # ------------------------------------------------------------------
    # 本地人机对弈（测试功能一）
    # ------------------------------------------------------------------
    @app.post("/api/local/new")
    def api_local_new():
        d = request.get_json(silent=True) or {}
        st = STATE.new_game(
            human_color=int(d.get("human_color") or 1),
            level=int(d.get("level") or 3),
            size=int(d.get("size") or 15),
            rules=str(d.get("rules") or "casual"),
            seed=d.get("seed"),
        )
        return jsonify({"ok": True, "state": st})

    @app.post("/api/local/move")
    def api_local_move():
        d = request.get_json(silent=True) or {}
        r = STATE.human_move(int(d.get("x", -1)), int(d.get("y", -1)))
        return jsonify(r)

    @app.post("/api/local/ai")
    def api_local_ai():
        """AI 应手。

        ``async=1`` 时立刻返回并在后台算完推 ``ai_done``；
        默认同步返回（前端简单，但会卡 1~2 秒）。
        """
        d = request.get_json(silent=True) or {}
        if d.get("async"):
            return jsonify(STATE.ai_reply_async())
        return jsonify(STATE.ai_reply_sync())

    @app.post("/api/local/undo")
    def api_local_undo():
        d = request.get_json(silent=True) or {}
        return jsonify(STATE.undo(int(d.get("steps") or 2)))

    @app.post("/api/local/hint")
    def api_local_hint():
        return jsonify({"ok": True, "analysis": STATE.hint()})

    @app.get("/api/local/state")
    def api_local_state():
        return jsonify({"ok": True, "state": STATE.local.state()})

    @app.post("/api/local/learn")
    def api_local_learn():
        """开启/关闭在线负反馈学习；不带 body 时只读状态。"""
        d = request.get_json(silent=True) or {}
        if "enabled" in d:
            r = STATE.set_learn(bool(d.get("enabled")))
        else:
            r = STATE.learn_status()
        return jsonify(r)

    # ------------------------------------------------------------------
    # 实验室（训练=自我对弈调参，测试功能二）
    # ------------------------------------------------------------------
    @app.post("/api/lab/unlock")
    def api_lab_unlock():
        """校验口令。前端连点版本号 5 次 → 弹出锁 → 输入 token → 这里验证。"""
        data = request.get_json(silent=True) or {}
        if _lab_ok(data):
            return jsonify({"ok": True})
        return jsonify({"ok": False, "reason": "口令错误"}), 403

    @app.post("/api/tuner/start")
    def api_tuner_start():
        d = request.get_json(silent=True) or {}
        if not _lab_ok(d):
            return jsonify({"ok": False, "reason": "需要实验室口令"}), 403
        r = STATE.tuner_start(
            method=str(d.get("method") or "coordinate"),
            rounds=int(d.get("rounds") or 2),
            iterations=int(d.get("iterations") or 10),
            size=int(d.get("size") or 15),
            time_budget=float(d.get("time_budget") or 0.15),
            max_depth=int(d.get("max_depth") or 2),
        )
        return jsonify(r)

    @app.post("/api/tuner/stop")
    def api_tuner_stop():
        d = request.get_json(silent=True) or {}
        if not _lab_ok(d):
            return jsonify({"ok": False, "reason": "需要实验室口令"}), 403
        return jsonify(STATE.tuner_stop_run())

    @app.get("/api/tuner/status")
    def api_tuner_status():
        return jsonify({"ok": True, **STATE.tuner_status()})

    @app.post("/api/tuner/benchmark")
    def api_tuner_benchmark():
        d = request.get_json(silent=True) or {}
        if not _lab_ok(d):
            return jsonify({"ok": False, "reason": "需要实验室口令"}), 403
        return jsonify({"ok": True,
                        "result": STATE.tuner_benchmark(d.get("config"),
                                                        int(d.get("rounds") or 2))})

    @app.get("/api/lab/games")
    def api_lab_games():
        """已收集的网友对局棋谱：数量 + 整份 JSONL 文本（导出下载用）。"""
        d = request.args or {}
        if not _lab_ok(d):
            return jsonify({"ok": False, "reason": "需要实验室口令"}), 403
        return jsonify({"ok": True, "count": STATE.games_count(),
                        "text": STATE.games_export()})

    # ------------------------------------------------------------------
    # SocketIO
    # ------------------------------------------------------------------
    @socketio.on("connect")
    def on_connect():
        emit("hello", {"ok": True, "profile": STATE.profile.to_dict()})

    @socketio.on("ping")
    def on_ping(_data=None):
        emit("pong", {"t": 0})

    return app, socketio


__all__ = ["create_app"]
