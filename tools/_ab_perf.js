/* A/B：优化前的引擎（commit 87ce303）vs 优化后（当前工作区）。
   同开局正反手，看棋力是否真的因为提速而提升。

   注意：AI.choose() 返回 {x, y}，AI.analyse() 返回 {move:{x,y}}，
   落子要用 board.place(x, y)（按 board.side 走）。 */
const fs = require("fs"), path = require("path"), vm = require("vm");
const { execSync } = require("child_process");

const NEW = fs.readFileSync(path.join(__dirname, "..", "web", "static", "engine.js"), "utf8");
let OLD;
try {
  OLD = execSync("git show 87ce303:web/static/engine.js", {
    cwd: path.join(__dirname, ".."), encoding: "utf8", maxBuffer: 64 * 1024 * 1024
  });
} catch (e) { console.error("拿不到旧版本:", e.message); process.exit(1); }

function load(code) {
  const sandbox = { window: {}, console, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 } };
  sandbox.self = sandbox.window;
  vm.createContext(sandbox); vm.runInContext(code, sandbox);
  return sandbox.window.GomokuEngine;
}
const EN = load(NEW), EO = load(OLD);

const SIZE = 15, SCALE = 0.35, PLIES = 4;
const LV = { time_budget: 1.0, max_depth: 20, width_deep: 16, width_mid: 12, width_shallow: 8, use_vcf: true };

function mkOpening(plies, seed) {
  let s = seed * 2654435761 >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const b = new EN.Board(SIZE, "casual");
  const c = SIZE >> 1;
  b.placeColor(c, c, 1);
  const used = new Set([c + ":" + c]);
  for (let k = 1; k < plies; k++) {
    const opts = [];
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      const x = c + dx, y = c + dy;
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      if (b.grid[y * SIZE + x] !== 0 || used.has(x + ":" + y)) continue;
      opts.push([x, y]);
    }
    const p = opts[(rnd() * opts.length) | 0];
    b.placeColor(p[0], p[1], k % 2 === 0 ? 2 : 1);
    used.add(p[0] + ":" + p[1]);
  }
  return b;
}

function play(Eb, Ew, opening) {
  const b = opening.clone();
  const cfg = Object.assign({}, LV, { time_budget: LV.time_budget * SCALE });
  const aiB = new Eb.AI({ level: 3, config: cfg, seed: 11 });
  const aiW = new Ew.AI({ level: 3, config: cfg, seed: 22 });
  for (let step = 0; step < 225; step++) {
    if (b.isFull) return 0;
    if (b.winner() !== 0) return b.winner();
    const ai = b.side === 1 ? aiB : aiW;
    const mv = ai.choose(b);
    if (!mv) return 0;
    b.place(mv.x, mv.y);
  }
  return 0;
}

const N = Number(process.argv[2] || 8);
let newWin = 0, oldWin = 0, draw = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const op = mkOpening(PLIES, 100 + i);
  let r = play(EN, EO, op);              // 新引擎执黑
  if (r === 1) newWin++; else if (r === 2) oldWin++; else draw++;
  r = play(EO, EN, op);                  // 新引擎执白
  if (r === 2) newWin++; else if (r === 1) oldWin++; else draw++;
  console.log(`开局#${i}: 新 ${newWin}  旧 ${oldWin}  平 ${draw}`);
}
const total = newWin + oldWin + draw;
console.log("=".repeat(52));
console.log(`新引擎 ${newWin} : 旧引擎 ${oldWin}  平 ${draw}  新胜率 ${total ? (newWin / total * 100).toFixed(1) : 0}%`);
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
