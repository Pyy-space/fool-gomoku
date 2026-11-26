# -*- coding: utf-8 -*-
"""前后端分离部署前的综合自检：healthz/capabilities/路由/web 静态文件。"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import create_app  # noqa: E402

app, socketio = create_app()
c = app.test_client()

# 1. 健康检查 + 能力探测
r = c.get("/healthz")
assert r.status_code == 200, r.status_code
d = r.get_json()
assert d["ok"] is True and d["platform"] in ("win", "linux"), d
print("[healthz]", d)

r = c.get("/api/capabilities")
assert r.status_code == 200
cap = r.get_json()
assert cap["ok"] is True
assert cap["features"]["local"] is True and cap["features"]["lab"] is True
print("[capabilities]", cap["features"])

# 2. 四个页面路由仍 200（本地 Flask 版）
for p in ["/", "/hub", "/local", "/lab"]:
    r = c.get(p)
    assert r.status_code == 200, f"{p} -> {r.status_code}"
print("[pages] 4/4 200")

# 3. 静态前端文件齐全
web = ROOT / "web"
required = ["index.html", "hub.html", "local.html", "lab.html", "config.js",
            "static/style.css", "static/app.js", "static/socket.io.min.js"]
missing = [f for f in required if not (web / f).exists()]
assert not missing, missing
print(f"[web] {len(required)} 个静态文件齐全")

# 4. config.js 语法（含 window.API_BASE）
cfg = (web / "config.js").read_text(encoding="utf-8")
assert "window.API_BASE" in cfg
print("[web/config.js] 含 window.API_BASE")

# 5. app.js 的 pageHref 在静态部署下跳 *.html
js = (web / "static" / "app.js").read_text(encoding="utf-8")
assert "STATIC_DEPLOY" in js and "pageHref" in js
assert "API_BASE + url" in js
print("[app.js] API_BASE / pageHref 已接入")

print("\nRESULT: PASS")
