// 实验：把打包线路径换成直接读格，看 nps 是否提升
const fs = require("fs"), path = require("path"), vm = require("vm");
const raw = fs.readFileSync(path.join(__dirname, "..", "web", "static", "engine.js"), "utf8");

const variants = {
  "原版(打包)": raw,
  "强制直读": raw.replace("var direct = (2 * (size + 8)) > 52;", "var direct = true;"),
};

function mk(seed, plies) {
  let s = seed * 2654435761 >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  return { rnd, plies };
}

function board(E, seed, plies) {
  const { rnd } = mk(seed, plies);
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

for (const [name, code] of Object.entries(variants)) {
  const sandbox = { window: {}, console, Math, Date, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 } };
  sandbox.self = sandbox.window;
  vm.createContext(sandbox); vm.runInContext(code, sandbox);
  const E = sandbox.window.GomokuEngine;
  let totMs = 0, totNodes = 0, depth = 0;
  for (const plies of [8, 16, 24]) {
    const b = board(E, 5, plies);
    const ai = new E.AI({ level: 3, rules: "casual", seed: 3 });
    const t0 = Date.now();
    const r = ai.analyse(b);
    totMs += Date.now() - t0; totNodes += r.nodes; depth = r.depth;
  }
  console.log(name, "总 " + totMs + "ms", "nodes " + totNodes, "nps " + Math.round(totNodes / (totMs / 1000)), "depth " + depth);
}
