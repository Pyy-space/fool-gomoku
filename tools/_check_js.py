"""对 app.js 做括号平衡检查（跳过字符串与注释）。不调用外部程序。"""
import sys
from pathlib import Path

p = Path("app/static/app.js")
s = p.read_text(encoding="utf-8")
print("bytes", len(s.encode("utf-8")), "chars", len(s), flush=True)

i = 0
n = len(s)
stack = []
line = 1
pairs = {")": "(", "]": "[", "}": "{"}
problems = []
state = "code"

while i < n:
    ch = s[i]
    nxt = s[i + 1] if i + 1 < n else ""
    if ch == "\n":
        line += 1
        if state == "lc":
            state = "code"
        i += 1
        continue
    if state == "code":
        if ch == "/" and nxt == "/":
            state = "lc"; i += 2; continue
        if ch == "/" and nxt == "*":
            state = "bc"; i += 2; continue
        if ch == "'":
            state = "sq"; i += 1; continue
        if ch == '"':
            state = "dq"; i += 1; continue
        if ch == "`":
            state = "tpl"; i += 1; continue
        if ch in "([{":
            stack.append((ch, line))
        elif ch in ")]}":
            if not stack:
                problems.append("line %d: 多余的 %s" % (line, ch))
            else:
                op, ol = stack.pop()
                if op != pairs[ch]:
                    problems.append("line %d: %s 与 line %d 的 %s 不匹配" % (line, ch, ol, op))
        i += 1
        continue
    if state == "sq":
        if ch == "\\":
            i += 2; continue
        if ch == "'":
            state = "code"
        i += 1
        continue
    if state == "dq":
        if ch == "\\":
            i += 2; continue
        if ch == '"':
            state = "code"
        i += 1
        continue
    if state == "tpl":
        if ch == "\\":
            i += 2; continue
        if ch == "`":
            state = "code"
        i += 1
        continue
    if state == "bc":
        if ch == "*" and nxt == "/":
            state = "code"; i += 2; continue
        i += 1
        continue
    # 行注释状态：一直吞到换行（换行处已把 state 复位）
    i += 1

for op, ol in stack:
    problems.append("未闭合的 %s（line %d）" % (op, ol))

print("结束状态:", state)
if problems:
    print("发现问题:")
    for q in problems:
        print("  " + q)
else:
    print("括号/引号平衡检查: OK")
