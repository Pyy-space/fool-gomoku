"""在线负反馈学习：直接驱动 GameSession 验证「人赢 → AI 学习」。"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import engine.learn as learn_mod
from core.game import GameSession
from engine.constants import BLACK, WHITE

# 隔离持久化路径
tmp = tempfile.TemporaryDirectory()
learn_mod.LEARNED_PATH = Path(tmp.name) / "learned.json"
learn_mod.ARCHIVE_DIR = Path(tmp.name) / "archive"

from engine.learn import Learner

learner = Learner(lr=0.03)
print("初始 defense_weight =", learner.cfg.eval.defense_weight)

# 人执黑，AI 执白。人横向连五 (0,0)-(4,0)，白随便下在第二行。
g = GameSession(size=15, human_color=BLACK, level=1, learner=learner)
for x in range(5):
    g.place(x, 0)          # 黑
    if x < 4:
        g.place(x, 1)      # 白
print("winner =", g.winner, "(期望 1=黑/人赢)")
print("over =", g.over)

st = g.state()
print("learn =", st["learn"])

# 全局学习器应已更新
print("最终 defense_weight =", learner.cfg.eval.defense_weight,
      "(期望 > 初始，说明人赢触发了 AI 学习)")

tmp.cleanup()
