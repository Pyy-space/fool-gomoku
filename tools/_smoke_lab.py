import json, urllib.request, urllib.error

BASE = "http://127.0.0.1:5057"


def post(path, payload):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return r.status, json.loads(r.read().decode("utf-8"))


s1, b1 = post("/api/lab/unlock", {"token": "wrong"})
assert s1 == 403 and b1["ok"] is False, (s1, b1)
print("unlock wrong ->", s1, b1)

s2, b2 = post("/api/lab/unlock", {"token": "gomoku-lab"})
assert s2 == 200 and b2["ok"] is True, (s2, b2)
print("unlock right ->", s2, b2)

s3, b3 = post("/api/tuner/start", {})
assert s3 == 403 and b3["ok"] is False, (s3, b3)
print("tuner start no-token ->", s3, b3)

s4, b4 = get("/api/tuner/status")
assert s4 == 200 and "space" in b4, (s4, b4)
print("tuner status ->", s4, "keys:", sorted(b4.keys()))

print("RESULT: PASS")
