const fs = require("fs"), path = require("path"), vm = require("vm");
const code = fs.readFileSync(path.join(__dirname, "..", "web", "static", "engine.js"), "utf8");
const sandbox = { window: {}, console, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 } };
sandbox.self = sandbox.window;
vm.createContext(sandbox); vm.runInContext(code, sandbox);
const E = sandbox.window.GomokuEngine;

function mk(seq) {
  const b = new E.Board(15, "casual");
  for (const [x, y] of seq) b.place(x, y);
  return b;
}
// 一个真实的开局：黑天元、白对角、黑小飞、白拦
const cases = [
  { name: "4手开局", seq: [[7,7],[8,8],[6,7],[8,6]] },
  { name: "8手中盘", seq: [[7,7],[8,8],[6,7],[8,6],[7,8],[6,6],[8,7],[9,7]] },
];
for (const c of cases) {
  const b = mk(c.seq);
  for (const level of [2, 3]) {
    const ai = new E.AI({ level });
    const t0 = process.hrtime.bigint();
    const r = ai.analyse(b);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(c.name + " L" + level + " depth=" + r.depth + " nodes=" + r.nodes +
      " " + ms.toFixed(0) + "ms nps=" + (r.nodes / Math.max(ms, 0.001) * 1000 | 0) +
      " move=" + r.move.x + "," + r.move.y + " reason=" + r.reason);
  }
}
