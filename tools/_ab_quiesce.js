/* A/B：静态搜索（_quiesce）开 vs 关。同引擎同代码，只切 q_node_limit。 */
const fs = require("fs"), path = require("path"), vm = require("vm");
const code = fs.readFileSync(path.join(__dirname, "..", "web", "static", "engine.js"), "utf8");
function reload() {
  const sandbox = { window: {}, console, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 } };
  sandbox.self = sandbox.window;
  vm.createContext(sandbox); vm.runInContext(code, sandbox);
  return sandbox.window.GomokuEngine;
}
const E = reload();

const GAMES = 12, SCALE = 0.4, SIZE = 15;
const A = { q_node_limit: 4000 };   // 有静态搜索
const B = { q_node_limit: 0 };      // 无静态搜索
const LV = { time_budget: 1.0, max_depth: 10, width_deep: 12, width_mid: 10, width_shallow: 8, use_vcf: true };

function mkOpening(plies, seed) {
  let s = seed * 2654435761 >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const b = new E.Board(SIZE, "casual");
  const c = SIZE >> 1;
  b.placeColor(c, c, 1);
  const used = new Set([c + "," + c]);
  for (let k = 1; k < plies; k++) {
    const opts = [];
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      const x = c + dx, y = c + dy;
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      const g = b.grid[y * SIZE + x];
      if (g !== 0 || used.has(x + "," + y)) continue;
      opts.push([x, y]);
    }
    if (!opts.length) break;
    const p = opts[(rnd() * opts.length) | 0];
    b.placeColor(p[0], p[1], k % 2 === 0 ? 2 : 1);
    used.add(p[0] + "," + p[1]);
  }
  return b;
}

function play(cfgB, cfgW, opening) {
  const b = opening.clone();
  const aiB = new E.AI({ level: 3, config: Object.assign({}, LV, cfgB, { time_budget: LV.time_budget * SCALE }) });
  const aiW = new E.AI({ level: 3, config: Object.assign({}, LV, cfgW, { time_budget: LV.time_budget * SCALE }) });
  for (let step = 0; step < 225; step++) {
    if (b.isFull) return 0;
    const ai = b.side === 1 ? aiB : aiW;
    const r = ai.analyse(b);
    if (!r.move) return 0;
    b.place(r.move.x, r.move.y);
    if (b.winner() !== 0) return b.winner();
  }
  return 0;
}

let aWin = 0, bWin = 0, draw = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const op = mkOpening(4, g + 1);
  // 正反手各一局，消除先手优势
  const r1 = play(A, B, op);                        // A 执黑
  const r2 = play(B, A, op);                        // A 执白
  const a = (r1 === 1 ? 1 : 0) + (r2 === 2 ? 1 : 0);
  const bb = (r1 === 2 ? 1 : 0) + (r2 === 1 ? 1 : 0);
  aWin += a; bWin += bb; if (r1 === 0 && r2 === 0) draw++;
  console.log("opening#" + (g + 1) + " A(静态搜索)=" + a + " B(无)=" + bb);
}
const total = aWin + bWin;
console.log("\nA(静态搜索开) " + aWin + " : " + bWin + " B(关)  和棋 " + draw);
console.log("A 得分率 " + (total ? (aWin / total * 100).toFixed(1) : "-") + "%   用时 " + ((Date.now() - t0) / 1000).toFixed(0) + "s");
