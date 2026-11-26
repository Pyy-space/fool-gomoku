"""在线负反馈学习模块的单测。"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.constants import BLACK, WHITE
import engine.learn as learn_mod
from engine.learn import Learner


class TestLearner(unittest.TestCase):
    def setUp(self):
        # 隔离持久化路径，避免测试互相污染、也不写真实的 profiles/learned.json
        self._tmp = tempfile.TemporaryDirectory()
        self._old_learned = learn_mod.LEARNED_PATH
        self._old_archive = learn_mod.ARCHIVE_DIR
        learn_mod.LEARNED_PATH = Path(self._tmp.name) / "learned.json"
        learn_mod.ARCHIVE_DIR = Path(self._tmp.name) / "archive"

    def tearDown(self):
        learn_mod.LEARNED_PATH = self._old_learned
        learn_mod.ARCHIVE_DIR = self._old_archive
        self._tmp.cleanup()

    def test_lose_raises_defense_weight(self):
        lr = Learner(lr=0.03)
        before = lr.cfg.eval.defense_weight
        res = lr.apply_outcome(winner=WHITE, my_color=BLACK, moves=40)
        self.assertEqual(res.outcome, "lose")
        self.assertGreater(lr.cfg.eval.defense_weight, before)
        self.assertTrue(res.changed)

    def test_win_does_not_raise(self):
        lr = Learner(lr=0.03)
        before = lr.cfg.eval.defense_weight
        res = lr.apply_outcome(winner=BLACK, my_color=BLACK, moves=40)
        self.assertEqual(res.outcome, "win")
        # 默认值 1.15 且 cur<=anchor → 赢时不往下调（保持不漂移）
        self.assertEqual(lr.cfg.eval.defense_weight, before)
        self.assertFalse(res.changed)

    def test_draw_no_change(self):
        lr = Learner(lr=0.03)
        before = lr.cfg.eval.defense_weight
        res = lr.apply_outcome(winner=0, my_color=BLACK, moves=40)
        self.assertEqual(res.outcome, "draw")
        self.assertEqual(lr.cfg.eval.defense_weight, before)
        self.assertFalse(res.changed)

    def test_clamped_to_space(self):
        lr = Learner(lr=10.0)  # 大步子也要被截断
        lr.cfg.eval.defense_weight = 1.79
        lr.apply_outcome(winner=WHITE, my_color=BLACK, moves=10)
        self.assertLessEqual(lr.cfg.eval.defense_weight, 1.80)

    def test_config_is_copy(self):
        lr = Learner()
        cfg = lr.config()
        cfg.eval.defense_weight = 9.9
        self.assertNotEqual(lr.cfg.eval.defense_weight, 9.9)

    def test_persisted_and_reloaded(self):
        lr = Learner(lr=0.03)
        lr.apply_outcome(winner=WHITE, my_color=BLACK, moves=40)
        self.assertTrue(learn_mod.LEARNED_PATH.exists())
        cfg2 = learn_mod.load_learned()
        self.assertEqual(cfg2.eval.defense_weight, lr.cfg.eval.defense_weight)


if __name__ == "__main__":
    unittest.main(verbosity=2)
