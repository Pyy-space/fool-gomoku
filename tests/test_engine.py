"""引擎单元测试：棋盘、棋型、战术、搜索、规则。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine import AI
from engine.board import Board
from engine.constants import (BLACK, EMPTY, FIVE, FOUR, OPEN_FOUR, OPEN_THREE,
                              THREE, WHITE)
from engine.patterns import point_shapes, shape_name
from engine.rules import forbidden_reason, is_legal
from engine.tactics import find_vcf, immediate_move, winning_moves


class TestBoard(unittest.TestCase):
    def test_empty(self):
        b = Board(15)
        self.assertEqual(b.stone_count, 0)
        self.assertEqual(b.side, BLACK)
        self.assertEqual(b.winner(), 0)

    def test_place_and_undo(self):
        b = Board(15)
        b.place(7, 7)
        self.assertEqual(b.get(7, 7), BLACK)
        self.assertEqual(b.side, WHITE)
        b.undo()
        self.assertEqual(b.get(7, 7), EMPTY)
        self.assertEqual(b.side, BLACK)

    def test_candidates_small(self):
        b = Board(15)
        b.place(7, 7)
        cand = b.candidates()
        # 距 (7,7) 切比雪夫距离 <=2 的空点：(5x5 - 1) = 24
        self.assertEqual(len(cand), 24)

    def test_hash_changes(self):
        b = Board(15)
        h0 = b.zobrist
        b.place(7, 7)
        self.assertNotEqual(b.zobrist, h0)
        b.undo()
        self.assertEqual(b.zobrist, h0)

    def test_copy_independent(self):
        b = Board(15)
        b.place(7, 7)
        c = b.copy()
        c.place(8, 8)
        self.assertEqual(b.get(8, 8), EMPTY)
        self.assertEqual(c.get(8, 8), WHITE)


class TestPatterns(unittest.TestCase):
    def test_three_to_open_four(self):
        b = Board(15)
        b.place_color(5, 7, BLACK)
        b.place_color(6, 7, BLACK)
        b.place_color(7, 7, BLACK)
        # (8,7) 落子后是四连（两端空）→ 应为 OPEN_FOUR
        name = shape_name(BLACK, b.window_code(8, 7, 0))
        self.assertEqual(name, OPEN_FOUR)

    def test_four_to_five(self):
        b = Board(15)
        for x in (4, 5, 6, 7):
            b.place_color(x, 7, BLACK)
        name = shape_name(BLACK, b.window_code(8, 7, 0))
        self.assertEqual(name, FIVE)

    def test_dead_three_is_none(self):
        b = Board(15)
        b.place_color(5, 7, BLACK)
        b.place_color(6, 7, BLACK)
        b.place_color(4, 7, WHITE)
        # 一端被堵的两连补中间 (7,7)：能形成冲四，应为 THREE
        name = shape_name(BLACK, b.window_code(7, 7, 0))
        self.assertEqual(name, THREE)

    def test_both_blocked_is_none(self):
        b = Board(15)
        b.place_color(5, 7, BLACK)
        b.place_color(6, 7, BLACK)
        b.place_color(4, 7, WHITE)
        b.place_color(3, 7, WHITE)
        b.place_color(8, 7, WHITE)
        name = shape_name(BLACK, b.window_code(7, 7, 0))
        self.assertEqual(name, "NONE")

    def test_occupied_point_has_no_shape(self):
        b = Board(15)
        b.place_color(7, 7, BLACK)
        self.assertEqual(point_shapes(b, 7, 7, BLACK), {})


class TestWin(unittest.TestCase):
    def test_horizontal_five(self):
        b = Board(15)
        for x in range(4, 9):
            b.place_color(x, 7, BLACK)
        self.assertEqual(b.winner(), BLACK)

    def test_diagonal_five(self):
        b = Board(15)
        for k in range(5):
            b.place_color(3 + k, 3 + k, WHITE)
        self.assertEqual(b.winner(), WHITE)

    def test_four_not_win(self):
        b = Board(15)
        for x in range(4, 8):
            b.place_color(x, 7, BLACK)
        self.assertEqual(b.winner(), 0)


class TestTactics(unittest.TestCase):
    def test_winning_moves(self):
        b = Board(15)
        for x in range(3, 7):
            b.place_color(x, 7, BLACK)
        idxs = winning_moves(b, BLACK)
        pts = {(i % 15, i // 15) for i in idxs}
        self.assertIn((2, 7), pts)
        self.assertIn((7, 7), pts)

    def test_immediate_win_preferred(self):
        b = Board(15)
        for x in range(3, 7):
            b.place_color(x, 7, BLACK)
        b.side = BLACK
        idx = immediate_move(b, BLACK)
        self.assertIn((idx % 15, idx // 15), [(2, 7), (7, 7)])

    def test_immediate_block(self):
        b = Board(15)
        for x in range(3, 7):
            b.place_color(x, 7, BLACK)
        idx = immediate_move(b, WHITE)
        self.assertEqual((idx % 15, idx // 15), (2, 7))


class TestRules(unittest.TestCase):
    def test_overline_forbidden(self):
        b = Board(15, rules="renju")
        for x in range(3, 8):
            b.place_color(x, 7, BLACK)
        # 黑再下一子成 6 连 → 长连禁手
        self.assertEqual(forbidden_reason(b, 8, 7), "overline")

    def test_casual_allows_overline(self):
        b = Board(15, rules="casual")
        for x in range(3, 8):
            b.place_color(x, 7, BLACK)
        self.assertIsNone(forbidden_reason(b, 8, 7))

    def test_legal_in_empty(self):
        b = Board(15)
        self.assertTrue(is_legal(b, 7, 7))


class TestSearch(unittest.TestCase):
    def test_opening_center(self):
        b = Board(15)
        ai = AI(level=1)
        mv = ai.choose(b)
        self.assertEqual(mv, (7, 7))

    def test_finds_immediate_win(self):
        b = Board(15)
        for x in range(3, 7):
            b.place_color(x, 7, BLACK)
        b.side = BLACK
        ai = AI(level=1)
        mv = ai.choose(b)
        self.assertIn(mv, [(2, 7), (7, 7)])

    def test_blocks_four(self):
        b = Board(15)
        for x in range(3, 7):
            b.place_color(x, 7, BLACK)
        b.side = WHITE
        ai = AI(level=1)
        mv = ai.choose(b)
        self.assertIn(mv, [(2, 7), (7, 7)])
if __name__ == "__main__":
    unittest.main(verbosity=2)
