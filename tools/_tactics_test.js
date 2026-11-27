/* 战术正确性回归：防守/进攻基本功。这些是"下不过人"最常见的死法。 */
const fs = require("fs"), path = require("path"), vm = require("vm");
const code = fs.readFileSync(path.join(__dirname, "..", "web", "static", "engine.js"), "utf8");
const sandbox = { window: {}, console, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 } };
sandbox.self = sandbox.window;
vm.createContext(sandbox); vm.runInContext(code, sandbox);
const E = sandbox.window.GomokuEngine;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  " + JSON.stringify(extra) : "")); }
}
// 注意：place() 按 board.side 走子，搭建局面必须用 placeColor 显式指定颜色。
function build(blacks, whites, rules) {
  const b = new E.Board(15, rules || "casual");
  blacks.forEach(p => b.placeColor(p[0], p[1], 1));
  whites.forEach(p => b.placeColor(p[0], p[1], 2));
  b.side = blacks.length === whites.length ? 1 : (blacks.length > whites.length ? 2 : 1);
  return b;
}
function mv(ai, b) { const r = ai.analyse(b); return r.move ? r.move.x + "," + r.move.y : "null"; }
const FILL = [[1,1],[13,1],[1,13]];

console.log("== 防守：对手四连，必须堵 ==");
{
  const b = build([[1,1],[13,1],[1,13]], [[3,7],[4,7],[5,7],[6,7]]);
  const m = mv(new E.AI({level:3}), b);
  ok("轮到黑，堵白四连 → " + m, ["2,7","7,7"].includes(m), m);
}
{
  const b = build([[3,7],[4,7],[5,7],[6,7]], [[1,1],[13,1],[1,13],[13,13]]);
  const m = mv(new E.AI({level:3}), b);
  ok("轮到白，堵黑四连 → " + m, ["2,7","7,7"].includes(m), m);
}

console.log("== 进攻：自己活三必须成四 ==");
{
  const b = build([[5,7],[6,7],[7,7]], FILL);
  const m = mv(new E.AI({level:3}), b);
  ok("活三成活四 → " + m, ["4,7","8,7"].includes(m), m);
}

console.log("== 进攻：自己冲四必须成五 ==");
{
  const b = build([[4,7],[5,7],[6,7],[7,7]], [[1,1],[13,1],[1,13],[13,13]]);
  const m = mv(new E.AI({level:3}), b);
  ok("一步成五 → " + m, ["3,7","8,7"].includes(m), m);
}

console.log("== 防守：对手活三必须挡 ==");
{
  const b = build(FILL, [[5,7],[6,7],[7,7]]);
  const m = mv(new E.AI({level:3}), b);
  ok("挡活三 → " + m, ["4,7","8,7","3,7","9,7"].includes(m), m);
}

console.log("== 防守：对手冲四唯一端点必须堵死 ==");
{
  const b = build([[2,7],[1,1],[13,1]], [[3,7],[4,7],[5,7],[6,7]]);
  const m = mv(new E.AI({level:3}), b);
  ok("堵唯一端点 → " + m, m === "7,7", m);
}

console.log("== 不能走禁手（连珠） ==");
{
  const b = build([[6,5],[6,6],[7,7],[8,7]], [[0,0],[14,14],[0,14],[14,0]], "renju");
  b.side = 1;
  const ai = new E.AI({ level: 3, rules: "renju" });
  const r = ai.analyse(b);
  const why = E.forbiddenReason(b, r.move.x, r.move.y);
  ok("AI 落点不是禁手 " + r.move.x + "," + r.move.y, why === null, why);
}

console.log("\n========================================");
console.log("PASS " + pass + "  FAIL " + fail);
console.log("RESULT: " + (fail === 0 ? "PASS" : "FAIL"));
process.exit(fail === 0 ? 0 : 1);
