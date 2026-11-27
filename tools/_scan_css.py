from pathlib import Path

p = Path("style.css")
raw = p.read_bytes()
print("bytes", len(raw))
try:
    txt = raw.decode("utf-8")
    print("utf8 OK")
except UnicodeDecodeError as e:
    print("utf8 FAIL", e)
    txt = raw.decode("utf-8", "replace")

lines = txt.splitlines()
bad = []
for i, ln in enumerate(lines, 1):
    for ch in ln:
        if ch == "\ufffd" or 0xE000 <= ord(ch) <= 0xF8FF:
            bad.append((i, ln.strip()[:90]))
            break
print("乱码/替换符行数:", len(bad))
for i, s in bad[:30]:
    print(" ", i, s)

print("--- 奇数引号行 ---")
for i, ln in enumerate(lines, 1):
    if ln.count('"') % 2 == 1:
        print(" ", i, ":", ln.strip()[:110])

print("--- 非 ASCII 行样本（前 60）---")
cnt = 0
for i, ln in enumerate(lines, 1):
    if any(ord(c) > 127 for c in ln):
        cnt += 1
        if cnt <= 60:
            print(" ", i, ":", ln.strip()[:90])
print("非 ASCII 行总数:", cnt, "/", len(lines))
