"""前端冒烟测试：确认四个页面引用的元素 ID、静态资源、JS 内的选择器都对得上。

这不是单元测试，是「前后端契约」检查 —— app.js 里 $("...") 用到的每个 id，
必须在对应模板里真实存在；反之模板里的 id 若 app.js 完全没引用，也报出来。
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TPL = ROOT / "app" / "templates"
JS = ROOT / "app" / "static" / "app.js"

PAGES = {"local": "local.html", "landing": "landing.html",
         "hub": "hub.html", "lab": "lab.html",
         "base": "base.html"}

js = JS.read_text(encoding="utf-8")

# 找出每个 pageXxx 函数体，限制在 $("...") 的搜索范围
def func_body(name: str) -> str:
    m = re.search(r"function\s+%s\s*\([^)]*\)\s*\{" % re.escape(name), js)
    if not m:
        return ""
    i = m.end() - 1
    depth = 0
    while i < len(js):
        if js[i] == "{":
            depth += 1
        elif js[i] == "}":
            depth -= 1
            if depth == 0:
                return js[m.end():i]
        elif js[i] in "\"'`":
            q = js[i]
            i += 1
            while i < len(js) and js[i] != q:
                if js[i] == "\\":
                    i += 1
                i += 1
        i += 1
    return js[m.end():]


SHARED = func_body("setConn") + func_body("BoardView")
SECTION = {
    "base": SHARED,
    "local": SHARED + func_body("pageLocal"),
    "landing": SHARED + func_body("pageLanding"),
    "hub": SHARED + func_body("pageHub"),
    "lab": SHARED + func_body("pageLab"),
}

fails = 0
print("=" * 72)
# base.html 的 id（顶栏连接状态）会被所有页面继承，必须并进来
BASE_IDS = set(re.findall(r'id="([^"]+)"',
                          (TPL / "base.html").read_text(encoding="utf-8")))

for key, fname in PAGES.items():
    html = (TPL / fname).read_text(encoding="utf-8")
    html_ids = set(re.findall(r'id="([^"]+)"', html))
    if key != "base":
        html_ids |= BASE_IDS
    body = SECTION.get(key, SHARED)
    used = set(re.findall(r'\$\("#([A-Za-z0-9_\-]+)"\)', body))
    missing = sorted(used - html_ids)
    unused = sorted(html_ids - used - BASE_IDS)
    print(f"-- {fname}: 模板 id {len(html_ids)} 个，JS 引用 {len(used)} 个")
    if missing:
        fails += 1
        print("   [错误] JS 引用了模板里不存在的 id:", missing)
    if unused:
        print("   [提示] 模板有但 JS 没用到:", unused)
    if not missing:
        print("   所有 JS 选择器都能对到模板 id: OK")

# 静态资源存在性
print("-" * 72)
for f in ("style.css", "app.js", "socket.io.min.js"):
    p = ROOT / "app" / "static" / f
    ok = p.exists() and p.stat().st_size > 100
    print(f"-- static/{f}: {'OK' if ok else '缺失'} ({p.stat().st_size if p.exists() else 0} bytes)")
    if not ok:
        fails += 1

# base.html 的引用路径
base = (TPL / "base.html").read_text(encoding="utf-8")
for f in ("style.css", "app.js", "socket.io.min.js"):
    if f not in base:
        print(f"-- [错误] base.html 没有引用 {f}")
        fails += 1

# 每个页面都有 window.PAGE
for key, fname in PAGES.items():
    if key == "base":
        continue
    html = (TPL / fname).read_text(encoding="utf-8")
    m = re.search(r'window\.PAGE\s*=\s*"(\w+)"', html)
    if not m or m.group(1) != key:
        print(f"-- [错误] {fname} 的 window.PAGE 应为 {key}")
        fails += 1

print("-" * 72)
print("RESULT:", "PASS" if fails == 0 else f"FAIL ({fails} 项)")
sys.exit(0 if fails == 0 else 1)
