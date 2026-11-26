"""真实 HTTP 端到端冒烟：起服务后跑一遍页面 + 关键 API 链路。

用法：python tools/_smoke_http.py [port]
"""
import json
import sys
import urllib.error
import urllib.request

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5057
BASE = "http://127.0.0.1:%d" % PORT

fails = []


def req(path, body=None, method=None):
    url = BASE + path
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    m = method or ("POST" if body is not None else "GET")
    r = urllib.request.Request(url, data=data, headers=headers, method=m)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read()
            ctype = resp.headers.get("Content-Type", "")
            if "json" in ctype:
                return resp.status, json.loads(raw.decode("utf-8"))
            return resp.status, raw
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300]


def check(name, cond, extra=""):
    if cond:
        print("  PASS", name, extra)
    else:
        print("  FAIL", name, extra)
        fails.append(name)


print("== 页面 ==")
for path in ("/", "/hub", "/local", "/lab"):
    st, body = req(path)
    check(f"GET {path}", st == 200 and b"app.js" in body, f"status={st}")

print("== 静态资源 ==")
for f in ("style.css", "app.js", "socket.io.min.js"):
    st, body = req("/static/" + f)
    check(f"GET /static/{f}", st == 200 and len(body) > 500, f"{len(body) if isinstance(body, bytes) else len(str(body))} bytes")

print("== Profile ==")
st, body = req("/api/profiles")
check("GET /api/profiles", st == 200 and isinstance(body, list) and len(body) >= 1,
      f"n={len(body) if isinstance(body, list) else '?'}")

print("== 人机对局 ==")
st, body = req("/api/local/new", {"human_color": 1, "level": 1, "size": 15})
check("POST /api/local/new", st == 200 and body.get("ok"), str(body.get("reason", "")))
check("  开局 0 子", body["state"]["stones"] == 0, f"stones={body['state']['stones']}")

st, body = req("/api/local/move", {"x": 7, "y": 7})
check("POST /api/local/move (7,7)", st == 200 and body.get("ok"),
      f"stones={body.get('state', {}).get('stones')}")

st, body = req("/api/local/ai", {})
check("POST /api/local/ai", st == 200 and body.get("ok"),
      f"move={body.get('move')} reason={body.get('analysis', {}).get('reason')}")
check("  AI 已落子（2 子）", body["state"]["stones"] == 2,
      f"stones={body['state']['stones']}")

st, body = req("/api/local/undo", {"steps": 2})
check("POST /api/local/undo", st == 200 and body.get("ok"),
      f"stones={body.get('state', {}).get('stones')}")

st, body = req("/api/local/hint", {})
check("POST /api/local/hint", st == 200 and body.get("analysis", {}).get("move") is not None,
      f"move={body.get('analysis', {}).get('move')}")

st, body = req("/api/local/state")
check("GET /api/local/state", st == 200 and body.get("ok"),
      f"stones={body.get('state', {}).get('stones')}")

print("== 调参 ==")
st, body = req("/api/tuner/status")
check("GET /api/tuner/status", st == 200 and "space" in body, f"running={body.get('running')}")

print("=" * 60)
if fails:
    print("RESULT: FAIL (%d 项)" % len(fails))
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("RESULT: PASS")
