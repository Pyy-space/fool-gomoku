"""对局层与 Web API 测试：GameSession / LocalAdapter / Flask 路由 / 配置层。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from adapters.local import LocalAdapter
from core.game import GameSession
from engine.config import EngineConfig, TUNING_SPACE, config_for_level
from engine.constants import BLACK, EMPTY, WHITE


class TestGameSession(unittest.TestCase):
    def test_new_game(self):
        g = GameSession(size=15, human_color=BLACK)
        st = g.state()
        self.assertEqual(st["size"], 15)
        self.assertEqual(st["side"], BLACK)
        self.assertEqual(st["stones"], 0)

    def test_place_and_state(self):
        g = GameSession()
        r = g.place(7, 7)
        self.assertTrue(r["ok"])
        self.assertEqual(g.board.get(7, 7), BLACK)
        self.assertEqual(g.side, WHITE)

    def test_illegal_place(self):
        g = GameSession()
        g.place(7, 7)
        self.assertFalse(g.place(7, 7)["ok"])       # 已占
        self.assertFalse(g.place(15, 0)["ok"])      # 越界
        self.assertFalse(g.place(-1, 0)["ok"])      # 负数

    def test_undo(self):
        g = GameSession()
        g.place(7, 7)
        g.place(8, 8)
        self.assertEqual(g.board.stone_count, 2)
        g.undo(2)
        self.assertEqual(g.board.stone_count, 0)
        self.assertEqual(g.side, BLACK)

    def test_undo_more_than_exists(self):
        g = GameSession()
        g.place(7, 7)
        g.undo(10)
        self.assertEqual(g.board.stone_count, 0)

    def test_winner(self):
        g = GameSession()
        for x in range(4, 8):
            g.place(x, 7)          # 黑
            g.place(x, 8)          # 白
        g.place(8, 7)              # 黑第五子
        self.assertEqual(g.winner, BLACK)
        self.assertTrue(g.over)

    def test_sync_apply(self):
        g = GameSession()
        grid = [0] * 225
        grid[7 * 15 + 7] = BLACK
        grid[7 * 15 + 8] = WHITE
        rep = g.sync(grid)
        self.assertEqual(len(rep.applied), 2)
        self.assertEqual(g.board.stone_count, 2)

    def test_sync_removed_kept_when_disabled(self):
        """识别漏检时不应抹掉内部棋子。"""
        g = GameSession()
        g.place(7, 7)
        g.place(8, 8)
        rep = g.sync([0] * 225, auto_removed=False)
        self.assertEqual(g.board.stone_count, 2, "漏检把真棋子抹掉了")

    def test_sync_conflict_guard(self):
        """同点异色太多说明朝向/颜色搞反了，应拒绝同步。"""
        g = GameSession()
        for i in range(3):
            g.place(i, 0)
            g.place(i + 5, 5)
        grid = [0] * 225
        for i in range(3):
            grid[i] = WHITE       # 与内部 BLACK 冲突
        rep = g.sync(grid)
        self.assertGreater(len(rep.conflicts), 2)


class TestLocalAdapter(unittest.TestCase):
    def test_human_then_ai(self):
        ad = LocalAdapter()
        ad.new_game(human_color=BLACK, level=1)
        r = ad.human_move(7, 7)
        self.assertTrue(r["ok"])
        r2 = ad.ai_reply()
        self.assertTrue(r2["ok"])
        self.assertEqual(ad.session.board.stone_count, 2)

    def test_ai_moves_first_when_human_white(self):
        ad = LocalAdapter()
        ad.new_game(human_color=WHITE, level=1)
        self.assertEqual(ad.session.board.stone_count, 1)
        self.assertEqual(ad.session.side, WHITE)

    def test_hint_no_move(self):
        ad = LocalAdapter()
        ad.new_game(human_color=BLACK, level=1)
        ad.human_move(7, 7)
        before = ad.session.board.stone_count
        h = ad.hint()
        self.assertIn("move", h)
        self.assertEqual(ad.session.board.stone_count, before, "hint 不应该落子")

    def test_undo_steps(self):
        ad = LocalAdapter()
        ad.new_game(human_color=BLACK, level=1)
        ad.human_move(7, 7)
        ad.ai_reply()
        ad.undo(steps=2)
        self.assertEqual(ad.session.board.stone_count, 0)


class TestConfig(unittest.TestCase):
    def test_defaults(self):
        cfg = EngineConfig()
        self.assertGreater(cfg.eval.defense_weight, 0)
        self.assertGreater(cfg.search.time_budget, 0)

    def test_flat_roundtrip(self):
        cfg = EngineConfig()
        flat = cfg.flat()
        self.assertIn("eval.defense_weight", flat)
        self.assertEqual(len(flat), 15)

    def test_from_dict_isolated(self):
        a = EngineConfig()
        b = EngineConfig.from_dict({"eval.defense_weight": 1.5})
        self.assertEqual(b.eval.defense_weight, 1.5)
        self.assertEqual(a.eval.defense_weight, 1.15, "改 b 影响了 a")

    def test_update_returns_self(self):
        cfg = EngineConfig()
        out = cfg.update({"search.max_depth": 4})
        self.assertIs(out, cfg)
        self.assertEqual(cfg.search.max_depth, 4)

    def test_levels(self):
        for level in (1, 2, 3, 4, 5):
            cfg = config_for_level(level)
            self.assertGreater(cfg.search.time_budget, 0)
        self.assertLess(config_for_level(1).search.max_depth,
                        config_for_level(5).search.max_depth)

    def test_tuning_space_valid(self):
        for name, (lo, hi, is_int) in TUNING_SPACE.items():
            self.assertLess(lo, hi, name)
            group, field = name.split(".")
            sub = getattr(EngineConfig(), group)
            self.assertTrue(hasattr(sub, field), f"{name} 不是有效参数")


class TestWeb(unittest.TestCase):
    """用 Flask test_client 检查路由能通（不需要真起服务）。"""

    @classmethod
    def setUpClass(cls):
        from app import create_app
        cls.app, cls.socketio = create_app()
        cls.client = cls.app.test_client()

    def test_pages(self):
        # 后端页面统一重定向到静态前端（GitHub Pages），本地也指向线上静态站。
        for path in ("/", "/local", "/lab"):
            with self.subTest(path=path):
                r = self.client.get(path)
                self.assertEqual(r.status_code, 302)

    def test_hub_redirects_to_local(self):
        r = self.client.get("/hub")
        self.assertEqual(r.status_code, 302)
        self.assertIn("local.html", r.headers["Location"])

    def test_lab_unlock_requires_token(self):
        """实验室调参 API 必须带正确口令。"""
        r = self.client.post("/api/lab/unlock", json={"token": "wrong"})
        self.assertEqual(r.status_code, 403)
        r = self.client.post("/api/tuner/start", json={})
        self.assertEqual(r.status_code, 403)
        r = self.client.post("/api/lab/unlock", json={"token": "gomoku-lab"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json()["ok"])

    def test_api_profiles(self):
        r = self.client.get("/api/profiles")
        self.assertEqual(r.status_code, 200)
        data = r.get_json()
        # 该接口直接返回数组（前端按列表渲染），不是 {ok, profiles}
        self.assertIsInstance(data, list)
        self.assertTrue(data)
        self.assertIn("file", data[0])
        self.assertIn("name", data[0])

    def test_api_local_flow(self):
        r = self.client.post("/api/local/new",
                             json={"human_color": 1, "level": 1, "size": 15})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["state"]["stones"], 0)

        r = self.client.post("/api/local/move", json={"x": 7, "y": 7})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["state"]["stones"], 1)

        r = self.client.post("/api/local/ai", json={"async": 0})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["state"]["stones"], 2)
        self.assertIsNotNone(body["move"])

    def test_api_local_undo(self):
        self.client.post("/api/local/new", json={"human_color": 1, "level": 1})
        self.client.post("/api/local/move", json={"x": 7, "y": 7})
        r = self.client.post("/api/local/undo", json={"steps": 2})
        self.assertEqual(r.status_code, 200)

    def test_api_local_learn(self):
        # 只读状态
        r = self.client.post("/api/local/learn", json={})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertIn("enabled", body)
        self.assertIn("params", body)
        self.assertIn("eval.defense_weight", body["params"])
        # 开关
        r = self.client.post("/api/local/learn", json={"enabled": False})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.get_json()["enabled"])
        r = self.client.post("/api/local/learn", json={"enabled": True})
        self.assertTrue(r.get_json()["enabled"])

    def test_api_tuner_status(self):
        r = self.client.get("/api/tuner/status")
        self.assertEqual(r.status_code, 200)
        self.assertIn("space", r.get_json())


if __name__ == "__main__":
    unittest.main(verbosity=2)
