/*
 * 五子棋前端引擎自检（node 直接运行）
 *
 *   node _engine_test.js
 *
 * 覆盖：棋型识别（15 项，对应 tools/_dev_check.py）、胜负判定、
 *       禁手规则、战术（一步赢/必防）、搜索性能、自对弈、Learner。
 * 纯 node 环境：设置 global.window 后 require 引擎。
 */
"use strict";

global.window = global;

var path = require("path");
var G = require(path.join(__dirname, "engine.js"));

var PASS = 0, FAIL = 0;
var failures = [];

function check(name, got, want) {
  var ok;
  if (typeof want === "function") ok = want(got);
  else if (Array.isArray(want)) ok = JSON.stringify(got) === JSON.stringify(want);
  else ok = got === want;
  if (ok) {
    PASS++;
  } else {
    FAIL++;
    failures.push(name + ": got=" + JSON.stringify(got) + " want=" + (typeof want === "function" ? "(predicate)" : JSON.stringify(want)));
    console.log("  FAIL " + name + ": got=" + JSON.stringify(got));
  }
  return ok;
}

function section(title) { console.log("\n== " + title + " =="); }

function put(bd, pts, color) {
  for (var i = 0; i < pts.length; i++) bd.placeColor(pts[i][0], pts[i][1], color);
}

var BLACK = G.BLACK, WHITE = G.WHITE, EMPTY = G.EMPTY;

/* ------------------------------------------------------------------ */
section("棋型识别（对照 tools/_dev_check.py 的 15 项）");
/* ------------------------------------------------------------------ */
var bd;

// 1) 三连 + 落第 4 子 → 两端都空 = 活四
bd = new G.Board(15); put(bd, [[5, 7], [6, 7], [7, 7]], BLACK);
check("三连补第4子(两端空)", G.shapeNameOf(BLACK, bd.windowCode(8, 7, 0)), "OPEN_FOUR");

// 2) 四连 + 落第 5 子 → 五
bd = new G.Board(15); put(bd, [[5, 7], [6, 7], [7, 7], [8, 7]], BLACK);
check("四连补第5子", G.shapeNameOf(BLACK, bd.windowCode(9, 7, 0)), "FIVE");

// 3) X . X 补中间 → 活三
bd = new G.Board(15); put(bd, [[5, 7], [7, 7]], BLACK);
check("两连补中间", G.shapeNameOf(BLACK, bd.windowCode(6, 7, 0)), "OPEN_THREE");

// 4) 一端被对手堵的两连补中间 → 眠三
bd = new G.Board(15); put(bd, [[5, 7], [7, 7]], BLACK); put(bd, [[4, 7]], WHITE);
check("一端被堵两连补中间", G.shapeNameOf(BLACK, bd.windowCode(6, 7, 0)), "THREE");

// 4b) 两端都被堵的两连补中间 → 死三，判 NONE
bd = new G.Board(15); put(bd, [[5, 7], [7, 7]], BLACK); put(bd, [[4, 7], [8, 7]], WHITE);
check("两端被堵两连补中间(死三)", G.shapeNameOf(BLACK, bd.windowCode(6, 7, 0)), "NONE");

// 5) 三连外侧补一子 → 活四
bd = new G.Board(15); put(bd, [[5, 7], [6, 7], [7, 7]], BLACK);
check("三连左侧补子", G.shapeNameOf(BLACK, bd.windowCode(4, 7, 0)), "OPEN_FOUR");

// 6) 空盘 → NONE
bd = new G.Board(15);
check("空盘", G.shapeNameOf(BLACK, bd.windowCode(7, 7, 0)), "NONE");

// 7) 四个方向一致性
bd = new G.Board(15); put(bd, [[7, 5], [7, 6], [7, 7]], BLACK);
check("竖排三连补子", G.shapeNameOf(BLACK, bd.windowCode(7, 8, 1)), "OPEN_FOUR");

bd = new G.Board(15); put(bd, [[5, 5], [6, 6], [7, 7]], BLACK);
check("撇三连补子", G.shapeNameOf(BLACK, bd.windowCode(8, 8, 2)), "OPEN_FOUR");

bd = new G.Board(15); put(bd, [[5, 9], [6, 8], [7, 7]], BLACK);
check("捺三连补子", G.shapeNameOf(BLACK, bd.windowCode(8, 6, 3)), "OPEN_FOUR");

// 8) 对方视角
bd = new G.Board(15); put(bd, [[5, 7], [6, 7], [7, 7]], WHITE);
check("白视角三连", G.shapeNameOf(WHITE, bd.windowCode(8, 7, 0)), "OPEN_FOUR");
check("黑视角同点", G.shapeNameOf(BLACK, bd.windowCode(8, 7, 0)), "NONE");

// 9) 冲四（只有一端能成五）
bd = new G.Board(15); put(bd, [[5, 7], [6, 7], [7, 7]], BLACK); put(bd, [[4, 7]], WHITE);
check("一端被堵三连", G.shapeNameOf(BLACK, bd.windowCode(8, 7, 0)), "FOUR");

// 10) 已占点 point_shapes 返回空对象
bd = new G.Board(15); put(bd, [[5, 7], [6, 7], [7, 7]], BLACK);
check("已占点 pointShapes", JSON.stringify(G.pointShapes(bd, 6, 7, BLACK)), "{}");

/* ------------------------------------------------------------------ */
section("棋盘基础");
/* ------------------------------------------------------------------ */
bd = new G.Board(15);
check("默认尺寸", bd.size, 15);
check("默认规则", bd.rules, "casual");
check("空盘 winner", bd.winner(), 0);
check("空盘 over", bd.over, false);
check("黑先", bd.side, BLACK);
bd.place(7, 7);
check("落子颜色", bd.get(7, 7), BLACK);
check("轮到白", bd.side, WHITE);
check("stoneCount", bd.stoneCount, 1);
check("lastMove", JSON.stringify(bd.lastMove()), JSON.stringify({ x: 7, y: 7 }));
check("越界 get", bd.get(-1, 0), -1);
var h1 = bd.hash;
bd.place(8, 8);
check("哈希变化", bd.hash !== h1, true);
bd.undo();
check("悔棋后哈希复原", bd.hash, h1);
check("悔棋后轮次", bd.side, WHITE);

// clone 独立性
bd = new G.Board(15);
bd.place(7, 7);
var cl = bd.clone();
cl.place(8, 8);
check("clone 不污染原盘", bd.get(8, 8), EMPTY);
check("clone 自己落子", cl.get(8, 8), WHITE);

// candidates
bd = new G.Board(15);
check("空盘候选=天元", JSON.stringify(bd.candidates()), JSON.stringify([{ x: 7, y: 7 }]));
bd = new G.Board(15);
bd.place(7, 7);
check("单子候选数", bd.candidates().length, 24);

// toList
bd = new G.Board(15); bd.place(7, 7);
var lst = bd.toList();
check("toList 长度", lst.length, 225);
check("toList 内容", lst[7 * 15 + 7], BLACK);

/* ------------------------------------------------------------------ */
section("胜负判定");
/* ------------------------------------------------------------------ */
bd = new G.Board(15); put(bd, [[4, 7], [5, 7], [6, 7], [7, 7], [8, 7]], BLACK);
check("横向五连", bd.winner(), BLACK);

bd = new G.Board(15); put(bd, [[4, 7], [5, 7], [6, 7], [7, 7], [8, 7]], WHITE);
check("纵向五连(白)", (function () {
  var t = new G.Board(15);
  for (var k = 0; k < 5; k++) t.placeColor(7, 3 + k, WHITE);
  return t.winner();
})(), WHITE);

bd = new G.Board(15);
for (var k0 = 0; k0 < 5; k0++) bd.placeColor(3 + k0, 3 + k0, BLACK);
check("主对角五连", bd.winner(), BLACK);

bd = new G.Board(15);
for (var k1 = 0; k1 < 5; k1++) bd.placeColor(3 + k1, 9 - k1, WHITE);
check("副对角五连", bd.winner(), WHITE);

bd = new G.Board(15); put(bd, [[4, 7], [5, 7], [6, 7], [7, 7]], BLACK);
check("四连不算胜", bd.winner(), 0);
check("四连 over=false", bd.over, false);

bd = new G.Board(15); put(bd, [[4, 7], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7]], BLACK);
check("休闲规则六连算胜", bd.winner(), BLACK);

bd = new G.Board(15, "renju"); put(bd, [[4, 7], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7]], BLACK);
check("连珠黑六连不算胜", bd.winner(), 0);

bd = new G.Board(15, "renju");
for (var k2 = 0; k2 < 5; k2++) bd.placeColor(4 + k2, 7, BLACK);
check("连珠黑恰好五连算胜", bd.winner(), BLACK);

bd = new G.Board(15, "renju");
for (var k3 = 0; k3 < 6; k3++) bd.placeColor(4 + k3, 7, WHITE);
check("连珠白六连算胜", bd.winner(), WHITE);

/* ------------------------------------------------------------------ */
section("禁手与合法性");
/* ------------------------------------------------------------------ */
bd = new G.Board(15, "renju"); put(bd, [[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]], BLACK);
check("长连禁手", G.forbiddenReason(bd, 8, 7), "overline");

bd = new G.Board(15); put(bd, [[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]], BLACK);
check("休闲模式无禁手", G.forbiddenReason(bd, 8, 7), null);

// 成五优先于禁手：长连的一端落子若同时成五，则不判禁手
bd = new G.Board(15, "renju"); put(bd, [[3, 7], [4, 7], [5, 7], [6, 7]], BLACK);
check("成五优先(补第五子)", G.forbiddenReason(bd, 7, 7), null);

// 双三禁手：横向与竖向各成一个活三（构造与 Python 引擎逐点比对过）
bd = new G.Board(15, "renju");
put(bd, [[5, 7], [6, 7], [7, 5], [7, 6]], BLACK);
check("双三禁手", G.forbiddenReason(bd, 7, 7), "double_three");

// 单个活三不判禁手
bd = new G.Board(15, "renju");
put(bd, [[5, 7], [6, 7]], BLACK);
check("单个活三不禁手", G.forbiddenReason(bd, 7, 7), null);

bd = new G.Board(15, "renju");
check("空盘合法", G.isLegal(bd, 7, 7), true);
check("已占点不合法", (function () { var t = new G.Board(15); t.place(7, 7); return G.isLegal(t, 7, 7); })(), false);
check("越界不合法", G.isLegal(bd, -1, 0), false);

/* ------------------------------------------------------------------ */
section("战术：一步赢 / 必防");
/* ------------------------------------------------------------------ */
// 黑有活四（3..6），落 (2,7) 或 (7,7) 成五
bd = new G.Board(15); put(bd, [[3, 7], [4, 7], [5, 7], [6, 7]], BLACK);
bd.side = BLACK;
var wins = G.winningMoves(bd, BLACK).map(function (i) { return [i % 15, (i / 15) | 0]; });
check("一步成五点含(2,7)", wins.some(function (p) { return p[0] === 2 && p[1] === 7; }), true);
check("一步成五点含(7,7)", wins.some(function (p) { return p[0] === 7 && p[1] === 7; }), true);

var ai1 = new G.AI({ level: 1 });
var mv1 = ai1.choose(bd);
check("黑方直接取胜", mv1 && ((mv1.x === 2 && mv1.y === 7) || (mv1.x === 7 && mv1.y === 7)), true);

// 白方面对黑活四，必须堵
var bd2 = new G.Board(15); put(bd2, [[3, 7], [4, 7], [5, 7], [6, 7]], BLACK);
bd2.side = WHITE;
var mv2 = new G.AI({ level: 1 }).choose(bd2);
check("白方堵成活五点", mv2 && ((mv2.x === 2 && mv2.y === 7) || (mv2.x === 7 && mv2.y === 7)), true);

// 只堵得住一边的冲四（3..6 且 2 被白堵）——白必须走 (7,7)
var bd3 = new G.Board(15);
put(bd3, [[7, 7], [8, 7], [9, 7], [10, 7]], BLACK);   // 已成四：(6,7)/(11,7) 是成五点
put(bd3, [[11, 7]], WHITE);                            // 堵住右边 → 只剩 (6,7)
bd3.side = WHITE;
var mv3 = new G.AI({ level: 1 }).choose(bd3);
check("白方堵唯一成五点", mv3 && mv3.x === 6 && mv3.y === 7, true);

/* ------------------------------------------------------------------ */
section("双威胁 / VCF 接口");
/* ------------------------------------------------------------------ */
bd = new G.Board(15);
put(bd, [[7, 5], [7, 6], [7, 7]], BLACK);   // 竖向活三
put(bd, [[5, 7], [6, 7]], BLACK);           // 横向二
var dbl = G.doubleThreatMoves(bd, BLACK);
check("双威胁函数返回数组", Array.isArray(dbl), true);

bd = new G.Board(15);
put(bd, [[7, 7], [8, 7], [9, 7]], BLACK);
put(bd, [[6, 7]], WHITE);
check("VCF 函数可调用", G.findVcf(bd, BLACK) === null || Array.isArray(G.findVcf(bd, BLACK)), true);

/* ------------------------------------------------------------------ */
section("搜索性能（level 3，1.0s 预算）");
/* ------------------------------------------------------------------ */
var perfBoard = new G.Board(15);
var seq10 = [[7, 7, 1], [6, 7, 2], [8, 7, 1], [7, 8, 2], [6, 6, 1],
             [8, 6, 2], [7, 6, 1], [5, 7, 2], [6, 8, 1], [8, 8, 2]];
for (var si = 0; si < seq10.length; si++) {
  perfBoard.placeColor(seq10[si][0], seq10[si][1], seq10[si][2]);
}
var t0 = Date.now();
var perf = new G.AI({ level: 3 }).analyse(perfBoard);
var wall = Date.now() - t0;

console.log("  10 手局面 → move=" + JSON.stringify(perf.move) + " depth=" + perf.depth +
  " nodes=" + perf.nodes + " elapsed=" + perf.elapsed_ms + "ms (wall " + wall + "ms) reason=" + perf.reason);
console.log("  nps ≈ " + Math.round(perf.nodes / Math.max(perf.elapsed_ms, 1) * 1000));

check("搜索深度 >= 4", perf.depth >= 4, true);
check("搜索节点 >= 5000", perf.nodes >= 5000, true);
check("搜索给出合法点", perf.move !== null && perfBoard.get(perf.move.x, perf.move.y) === EMPTY, true);
check("搜索不修改传入棋盘", (function () {
  var before = perfBoard.toList().join(",");
  new G.AI({ level: 1 }).choose(perfBoard);
  return perfBoard.toList().join(",") === before;
})(), true);

// 空盘 / 单子
var emptyBoard = new G.Board(15);
check("空盘 analyse", JSON.stringify(new G.AI({ level: 3 }).analyse(emptyBoard).move), JSON.stringify({ x: 7, y: 7 }));
check("空盘 choose", JSON.stringify(new G.AI({ level: 3 }).choose(emptyBoard)), JSON.stringify({ x: 7, y: 7 }));

// 终局返回 null
var fullBoard = new G.Board(15);
for (var fx = 0; fx < 5; fx++) fullBoard.placeColor(fx, 0, BLACK);
fullBoard.side = WHITE;
check("终局 choose 返回 null", new G.AI({ level: 1 }).choose(fullBoard), null);

/* ------------------------------------------------------------------ */
section("自对弈 40 手");
/* ------------------------------------------------------------------ */
(function () {
  // 单局可能不到 40 手就分出胜负，故连续多局累计满 40 手。
  var ai = new G.AI({ level: 1 });
  var played = 0, games = 0, err = null;
  try {
    while (played < 40) {
      var sb = new G.Board(15);
      games++;
      for (var i = 0; i < 40 - played; i++) {
        if (sb.winner() !== 0 || sb.isFull) break;
        var mv = ai.choose(sb);
        if (!mv) break;
        if (!sb.place(mv.x, mv.y)) { err = "非法落子 " + JSON.stringify(mv); break; }
        played++;
      }
      if (err) break;
      if (games > 10) break;
    }
  } catch (e) {
    err = e && e.message ? e.message : String(e);
  }
  check("自对弈无异常", err, null);
  check("自对弈累计 40 手", played, 40);
  console.log("  自对弈 " + games + " 局累计 " + played + " 手");
})();

/* ------------------------------------------------------------------ */
section("Learner");
/* ------------------------------------------------------------------ */
var learner = new G.Learner();
check("默认防守权重", learner.snapshot()["eval.defense_weight"], 1.15);
check("默认排序权重", learner.snapshot()["search.sort_defense"], 1.15);

var r1 = learner.applyOutcome(0, 1, 30);      // 平局
check("平局不变", learner.snapshot()["eval.defense_weight"], 1.15);
check("平局 outcome", r1.outcome, "draw");
check("平局 changed", r1.changed, false);

var r2 = learner.applyOutcome(2, 1, 30);      // 黑方（我）输
check("输了 +0.03", learner.snapshot()["eval.defense_weight"], 1.18);
check("输了 outcome", r2.outcome, "lose");
check("输了 changed", r2.changed, true);

var r3 = learner.applyOutcome(1, 1, 30);      // 赢，向锚点回落
check("赢了回落但不低于 1.15", learner.snapshot()["eval.defense_weight"], 1.171);
check("赢了 outcome", r3.outcome, "win");

var learner2 = new G.Learner(0.03, { defense_weight: 1.15, sort_defense: 1.15 });
learner2.applyOutcome(1, 1, 20);              // 已在锚点，赢了不动
check("锚点赢不变", learner2.snapshot()["eval.defense_weight"], 1.15);

var rt = learner2.reset();
check("reset 回锚点", rt["eval.defense_weight"], 1.15);

/* ------------------------------------------------------------------ */
section("常量与导出");
/* ------------------------------------------------------------------ */
check("EMPTY/BLACK/WHITE", G.EMPTY === 0 && G.BLACK === 1 && G.WHITE === 2, true);
check("SHAPE_ORDER 由弱到强",
  JSON.stringify(G.SHAPE_ORDER),
  JSON.stringify(["NONE", "TWO", "OPEN_TWO", "THREE", "OPEN_THREE", "FOUR", "OPEN_FOUR", "FIVE"]));
check("SHAPE_SCORE.FIVE", G.SHAPE_SCORE.FIVE, 10000000);
check("SHAPE_SCORE.OPEN_FOUR", G.SHAPE_SCORE.OPEN_FOUR, 120000);
check("SHAPE_SCORE.FOUR", G.SHAPE_SCORE.FOUR, 9000);
check("SHAPE_SCORE.OPEN_THREE", G.SHAPE_SCORE.OPEN_THREE, 5400);
check("SHAPE_SCORE.THREE", G.SHAPE_SCORE.THREE, 300);
check("SHAPE_SCORE.OPEN_TWO", G.SHAPE_SCORE.OPEN_TWO, 120);
check("SHAPE_SCORE.TWO", G.SHAPE_SCORE.TWO, 15);
check("SHAPE_SCORE.NONE", G.SHAPE_SCORE.NONE, 0);

// 不同棋盘的尺寸
var small = new G.Board(9);
small.place(4, 4);
check("9x9 棋盘", small.size === 9 && small.candidates().length === 24, true);

/* ------------------------------------------------------------------ */
console.log("\n" + "=".repeat(52));
console.log("PASS " + PASS + "   FAIL " + FAIL);
if (FAIL) {
  console.log("失败项：");
  for (var fi = 0; fi < failures.length; fi++) console.log("  - " + failures[fi]);
}
console.log(FAIL === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(FAIL === 0 ? 0 : 1);
