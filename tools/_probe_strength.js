// 真实中盘位置上量各档实际到达的深度、节点数、耗时、reason
const fs = require("fs"), path = require("path"), vm = require("vm");
const code = fs.readFileSync(path.join(__dirname, "..", "web", "static", "engine.js"), "utf8");
const sandbox = { window: {}, console, Math, Date, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 } };
sandbox.self = sandbox.window;
vm.createContext(sandbox); vm.runInContext(code, sandbox);
const E = sandbox.window.GomokuEngine;

function mkMid(seed, plies) {
  let s = seed * 2654435761 >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const b = new E.Board(15, "casual");
  const c = 7;
  b.placeColor(c, c, 1);
  for (let k = 1; k < plies; k++) {
    const opts = [];
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
      const x = c + dx, y = c + dy;
      if (x < 0 || y < 0 || x >= 15 || y >= 15) continue;
      if (b.grid[y * 15 + x] !== 0) continue;
      opts.push([x, y]);
    }
    const p = opts[(rnd() * opts.length) | 0];
    b.placeColor(p[0], p[1], k % 2 === 0 ? 2 : 1);
  }
  return b;
}

for (const plies of [6, 14, 24]) {
  for (const lv of [1, 2, 3]) {
    const b = mkMid(5, plies);
    const ai = new E.AI({ level: lv, rules: "casual", seed: 3 });
    const t0 = Date.now();
    const r = ai.analyse(b);
    const ms = Date.now() - t0;
    const nc = b.candidates().length;
    console.log(
      "plies=" + plies, "L" + lv, "reason=" + r.reason, "depth=" + r.depth,
      "nodes=" + r.nodes, "ms=" + ms, "nps=" + Math.round(r.nodes / (ms / 1000)),
      "cands=" + nc
    );
  }
}
