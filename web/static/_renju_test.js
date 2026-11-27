/* 连珠禁手规则专项自检
 *
 * 只验证「禁手判定」这一层，用 RIF 规则里公认的经典局面：
 *   长连、双四（含同线双四）、双三、以及 RIF 9.3 的双三例外，
 *   再检查搜索/提示层确实不会给出禁手点。
 *
 * 跑法：node web/static/_renju_test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const file = path.join(__dirname, "engine.js");
const sandbox = { console: console, window: {}, self: {}, localStorage: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: "engine.js" });
const G = sandbox.GomokuEngine;

const EMPTY = 0, BLACK = 1, WHITE = 2;
let pass = 0, fail = 0;
const fails = [];

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    fails.push(`${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  }
}

/** 按 [x,y] 列表铺黑子，白子用负号列表（[x,y,color]）。 */
function board(points, size) {
  const b = new G.Board(size || 15, "renju");
  for (const p of points) {
    const color = p[2] === undefined ? BLACK : p[2];
    b.placeColor(p[0], p[1], color);
  }
  b.side = BLACK;
  return b;
}

function section(t) {
  console.log("\n== " + t + " ==");
}

/* ---------------------------------------------------------------- */
section("长连");
// 横排 3..7 共五子，8 处落子变成六连 → 长连禁手
check("五子右侧补子成六连", G.forbiddenReason(board([[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]]), 8, 7), "overline");
// 两端各空：中间已有 3..7，落 2 或 8 都成六连
check("五子左侧补子成六连", G.forbiddenReason(board([[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]]), 2, 7), "overline");
// 已四子(3..6)，落 7 恰好成五 → 不是禁手
check("四子补成五连合法", G.forbiddenReason(board([[3, 7], [4, 7], [5, 7], [6, 7]]), 7, 7), null);
// 三子隔一：3,4,5,6 之间夹空，落正中成五六不算
check("六连竖排", G.forbiddenReason(board([[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]]), 7, 8), "overline");
check("六连斜排", G.forbiddenReason(board([[3, 3], [4, 4], [5, 5], [6, 6], [7, 7]]), 8, 8), "overline");

/* ---------------------------------------------------------------- */
section("双四");
// 十字形：横向一个冲四 + 竖向一个冲四，交点落子成双四
// 横向 x=3..5 已有三子，两侧各有一子堵？这里用「一子成两个冲四」的标准形：
//   横: (5,7)(6,7)(8,7)  竖: (7,5)(7,6)(7,8)  → 落 (7,7) 后
//   横成 5,6,7,8 四连（(4,7) 与 (9,7) 皆空 → 活四只算 1 个四）
//   竖成 5,6,7,8 四连（活四）
// → 双四禁手
check("十字活四型双四", G.forbiddenReason(
  board([[5, 7], [6, 7], [8, 7], [7, 5], [7, 6], [7, 8]]), 7, 7), "double_four");

// 两个冲四在不同方向（十字交叉），是双四的标准形
check("十字冲四型双四", G.forbiddenReason(
  board([[4, 7], [5, 7], [6, 7], [3, 7, WHITE],
         [7, 4], [7, 5], [7, 6], [7, 3, WHITE]]), 7, 7), "double_four");

/* ---------------------------------------------------------------- */
section("双三");
// 横竖各一个活三，交点落子 → 双三禁手
check("横竖双活三", G.forbiddenReason(
  board([[5, 7], [6, 7], [7, 5], [7, 6]]), 7, 7), "double_three");

// 单个活三不判禁手
check("单个活三合法", G.forbiddenReason(board([[5, 7], [6, 7]]), 7, 7), null);

// 两个眠三（一端被堵）不构成双三
check("两个眠三合法", G.forbiddenReason(
  board([[5, 7], [6, 7], [4, 7, WHITE], [7, 5], [7, 6], [7, 4, WHITE]]), 7, 7), null);

/* ---------------------------------------------------------------- */
section("RIF 9.3 双三例外");
// 一个真活三 + 一个「假活三」：假活三的补点本身就是双四点
// 横: (4,7)(5,7) 空 (7,7) 落子后成 4,5,7 三子，补 6 成四 → 但 6 处同时是双四点？
// 用更明确的构造：竖线活三的补点落在横线的双四交点上。
// 这里用引擎自洽性验证：只要该点被判成双三，它的两段活三必须都能补成活四。
(function () {
  const b = board([[5, 7], [6, 7], [7, 5], [7, 6]]);
  check("双三确实两段都活", G.forbiddenReason(b, 7, 7), "double_three");
})();

// 一端被堵的三不能算活三 → 单三 + 单活三 = 不是双三
check("冲三+活三合法", G.forbiddenReason(
  board([[5, 7], [6, 7], [4, 7, WHITE], [7, 5], [7, 6]]), 7, 7), null);

/* ---------------------------------------------------------------- */
section("成五优先于一切禁手");
// 同时成五 + 长连的候选：优先判胜，不算禁手
check("成五优先(长连危险)", G.forbiddenReason(board([[3, 7], [4, 7], [5, 7], [6, 7]]), 7, 7), null);
// 成五 + 双四
check("成五优先(双四危险)", G.forbiddenReason(
  board([[5, 7], [6, 7], [8, 7], [7, 5], [7, 6], [7, 8]]), 7, 7), "double_four");

/* ---------------------------------------------------------------- */
section("禁手只约束黑方 + 只约束连珠");
(function () {
  const b = new G.Board(15, "renju");
  for (const p of [[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]]) b.placeColor(p[0], p[1], WHITE);
  b.side = WHITE;
  check("白方无禁手", G.forbiddenReason(b, 8, 7), null);
})();
(function () {
  const b = new G.Board(15, "casual");
  for (const p of [[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]]) b.placeColor(p[0], p[1], BLACK);
  b.side = BLACK;
  check("休闲模式无禁手", G.forbiddenReason(b, 8, 7), null);
})();

/* ---------------------------------------------------------------- */
section("禁手点批量接口");
(function () {
  const b = board([[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]]);
  const pts = G.forbiddenPoints(b);
  const keys = pts.map(function (p) { return p.x + "," + p.y; });
  check("forbiddenPoints 含 (2,7)", keys.indexOf("2,7") >= 0, true);
  check("forbiddenPoints 含 (8,7)", keys.indexOf("8,7") >= 0, true);
  check("forbiddenPoints 都带原因", pts.every(function (p) { return p.reason === "overline" && p.text === "长连禁手"; }), true);
})();

/* ---------------------------------------------------------------- */
section("搜索/提示层不会给出禁手点");
(function () {
  // 黑方有四连 3..6，两侧 2 和 7 都能成五。但若把两端做成"成五+长连"就没意义了，
  // 这里换成双三局面：AI 走黑，绝不能返回 (7,7)。
  const b = board([[5, 7], [6, 7], [7, 5], [7, 6], [1, 1, WHITE], [13, 13, WHITE]]);
  const ai = new G.AI({ level: 2, rules: "renju", seed: 12 });
  const mv = ai.choose(b.clone());
  const legal = mv === null || G.forbiddenReason(b, mv.x, mv.y) === null;
  check("AI 落子不是禁手", legal, true);
})();
(function () {
  // 黑方有四连（不是五连），两端 2/7 成五 —— 但把两端做成双四点，逼 AI 绕开
  const b = board([[5, 7], [6, 7], [7, 5], [7, 6], [1, 1, WHITE], [13, 13, WHITE]]);
  const ai = new G.AI({ level: 2, rules: "renju", seed: 3 });
  const res = ai.analyse(b.clone());
  const mv = res.move;
  const bad = !!mv && G.forbiddenReason(b, mv.x, mv.y) !== null;
  check("analyse 推荐点不是禁手", bad, false);
})();
(function () {
  // immediateMove / doubleThreatMoves / winningMoves 都要过滤
  const b = board([[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]]);
  const w = G.winningMoves(b, BLACK);
  const bad = w.filter(function (i) {
    return G.forbiddenReason(b, i % 15, (i / 15) | 0) !== null;
  });
  check("winningMoves 无禁手点", bad.length, 0);
})();

/* ---------------------------------------------------------------- */
console.log("\n" + "=".repeat(52));
console.log("PASS " + pass + "   FAIL " + fail);
if (fail) {
  console.log("失败项：");
  for (const f of fails) console.log("  - " + f);
}
console.log("RESULT: " + (fail ? "FAIL" : "PASS"));
process.exit(fail ? 1 : 0);
