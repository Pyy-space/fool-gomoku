"""检查 /api/games 上报接口。"""
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app as app_mod  # noqa: E402
from core import collector  # noqa: E402

flask_app, _sock = app_mod.create_app()
c = flask_app.test_client()

moves = [
    {"x": 7, "y": 7, "color": 1},
    {"x": 8, "y": 8, "color": 2},
    {"x": 6, "y": 6, "color": 1},
    {"x": 9, "y": 9, "color": 2},
    {"x": 5, "y": 5, "color": 1},
]
before = collector.count_games()

ok_body = {"size": 15, "rules": "casual", "human_color": 1, "winner": 1,
           "moves": moves, "config": {"eval.defense_weight": 1.15}}
r = c.post("/api/games", json=ok_body)
print("正常上报:", r.status_code, r.get_json())
assert r.status_code == 200, r.get_json()
assert r.get_json()["ok"] is True
assert collector.count_games() == before + 1, "落盘数没涨"

bad_cases = [
    ("size 不合法", {**ok_body, "size": 12}),
    ("rules 不合法", {**ok_body, "rules": "xxx"}),
    ("human_color 不合法", {**ok_body, "human_color": 0}),
    ("winner 不合法", {**ok_body, "winner": 7}),
    ("moves 太少", {**ok_body, "moves": moves[:2]}),
    ("坐标越界", {**ok_body, "moves": [{"x": 99, "y": 1, "color": 1}] * 5}),
    ("color 不合法", {**ok_body, "moves": [{"x": 1, "y": 1, "color": 3}] * 5}),
]
for name, body in bad_cases:
    rr = c.post("/api/games", json=body)
    print(f"  {name}: {rr.status_code} {rr.get_json()}")
    assert rr.status_code == 400, (name, rr.status_code, rr.get_json())

# 限流：同 IP 连发超过上限
app_mod._RATE_HITS.clear()
app_mod.GAMES_RATE_MAX = 3
codes = []
for _ in range(5):
    rr = c.post("/api/games", json=ok_body)
    codes.append(rr.status_code)
print("限流序列:", codes)
assert 429 in codes, codes

print("RESULT: PASS")
