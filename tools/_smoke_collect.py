# -*- coding: utf-8 -*-
"""临时验证：对局数据采集 + 导出 API 闭环。"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from core.collector import GAMES_PATH, count_games, record_game

# 1. 清空旧数据
if GAMES_PATH.exists():
    GAMES_PATH.unlink()

# 2. 直接采集一局
record_game(size=15, rules="casual", human_color=1, winner=2,
            moves=[{"x": 7, "y": 7, "color": 1, "by": "human"},
                   {"x": 8, "y": 8, "color": 2, "by": "ai"}],
            config={"eval.defense_weight": 1.15, "search.width_deep": 16})
assert count_games() == 1, count_games()
print("collector OK, count =", count_games())

# 3. 通过 AppState 导出
from app.state import STATE
assert STATE.games_count() == 1
text = STATE.games_export()
assert "winner" in text and '"moves"' in text
print("state export OK, text bytes =", len(text))

# 4. 通过 Flask test_client 验证 API（需 token）
from app import create_app
app, socketio = create_app()
client = app.test_client()

# 无 token → 403
r = client.get("/api/lab/games")
assert r.status_code == 403, r.status_code
print("no-token 403 OK")

# 错误 token → 403
r = client.get("/api/lab/games?token=wrong")
assert r.status_code == 403, r.status_code
print("wrong-token 403 OK")

# 正确 token → 200
r = client.get("/api/lab/games?token=gomoku-lab")
assert r.status_code == 200, r.status_code
data = r.get_json()
assert data["ok"] and data["count"] == 1
print("export API OK, count =", data["count"])

# 5. 走一遍 GameSession 真实终局，验证 _maybe_record 触发
from core.game import GameSession
GAMES_PATH.unlink()
sess = GameSession(size=15, rules="casual", human_color=1, level=1)
# 直接用 Board.place_color 强制黑方横排五连（绕过轮次交替），再手动触发采集
for x in range(3, 8):
    sess.board.place_color(x, 7, 1)
assert sess.board.winner() == 1, sess.board.winner()
sess._maybe_record()
assert count_games() == 1, count_games()
print("GameSession 终局自动采集 OK, count =", count_games())

print("RESULT: PASS")
