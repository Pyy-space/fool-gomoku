/* 验证券型分数候选：单点命中 + 组合 + 大样本复核。
   平局按半分计入得分率（否则基线不为 50%，容易误判）。 */
const fs = require("fs"), path = require("path"), vm = require("vm");
const { openingSet } = require("./_arena.js");

function loadFresh() {
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "static", "engine.js"), "utf8");
  const sandbox = {
    window: {}, console,
    performance: { now: () => Number(process.hrtime.bigint()) / 1e6 },
  };
  sandbox.self = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.GomokuEngine;
}

const BASE = {
  node_limit: 6000, time_budget: 10.0, max_depth: 16,
  width_deep: 12, width_mid: 10, width_shallow: 8,
  use_vcf: true, vcf_max_depth: 14,
  root_jitter: 0, root_pool_tol: 0, root_pool_max: 1,
  q_node_limit: 0,
};

const E0 = loadFresh();
const OPENS = Number(process.argv[2] || 12);
const POOL = openingSet(E0, OPENS, 4, 5500);
const NAMES = ["NONE", "TWO", "OPEN_TWO", "THREE", "OPEN_THREE", "FOUR", "OPEN_FOUR", "FIVE"];

/* 跨引擎一局：A 执黑（偶数步）/ A 执白（奇数步），返回 1=黑胜 2=白胜 0=和 */
function playCross(EA, EB, opj) {
  const ba = new (EA.Board)(15, "casual");
  const bb = new (EB.Board)(15, "casual");
  for (const m of opj) { ba.placeColor(m.x, m.y, m.color); bb.placeColor(m.x, m.y, m.color); }
  const aiA = new EA.AI({ level: 3, config: BASE, seed: 11 });
  const aiB = new EB.AI({ level: 3, config: BASE, seed: 22 });
  const limit = 225 - opj.length;
  for (let step = 0; step < limit; step++) {
    const w = ba.winner();
    if (w !== 0) return w;
    if (ba.isFull) return 0;
    const isBlack = ba.side === 1;
    const mv = (isBlack ? aiA : aiB).choose(isBlack ? ba : bb);
    if (!mv) return 0;
    ba.place(mv.x, mv.y);
    bb.place(mv.x, mv.y);
  }
  return 0;
}

/* A 的得分率（平局半分） */
function matchCross(EA, EB, pool) {
  let w = 0, l = 0, d = 0;
  for (const op of pool) {
    const seq = op.moves;
    let r = playCross(EA, EB, seq);
    if (r === 1) w++; else if (r === 2) l++; else d++;
    r = playCross(EB, EA, seq);
    if (r === 2) w++; else if (r === 1) l++; else d++;
  }
  const total = w + l + d;
  return { w, l, d, total, rate: total ? (w + d * 0.5) / total : 0 };
}

const CANDS = [
  ["基线", []],
  ["OT x1.8", [[4, 1.8]]],
  ["FOUR x0.6", [[5, 0.6]]],
  ["OT x1.8 + FOUR x0.6", [[4, 1.8], [5, 0.6]]],
  ["OT x2.4 + FOUR x0.5", [[4, 2.4], [5, 0.5]]],
  ["OT x1.4 + FOUR x0.7", [[4, 1.4], [5, 0.7]]],
  ["OT x1.8 + FOUR x0.6 + OF x0.8", [[4, 1.8], [5, 0.6], [6, 0.8]]],
  ["OT x1.8 + FOUR x0.6 + OF x1.3", [[4, 1.8], [5, 0.6], [6, 1.3]]],
];

console.log(`开局集 ${OPENS} 组（${OPENS * 2} 局/候选），节点预算 ${BASE.node_limit}`);
console.log("当前分数:", NAMES.map((n, i) => `${n}=${E0.shapeScores()[i]}`).join(" "), "\n");

const t0 = Date.now();
let best = null;
for (const [label, muts] of CANDS) {
  const NEW = loadFresh();
  const REF = loadFresh();
  if (muts.length) {
    const s = NEW.shapeScores();
    for (const [i, f] of muts) s[i] = Math.round(s[i] * f);
    NEW.setShapeScores(s);
  }
  const r = matchCross(NEW, REF, POOL);
  const mark = r.rate >= 0.60 ? "  <<<" : "";
  console.log(`${label.padEnd(30)} ${r.w}胜 ${r.l}负 ${r.d}平  ${(r.rate * 100).toFixed(1)}%${mark}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (!best || r.rate > best.rate) best = { label, rate: r.rate, muts };
}
console.log(`\n最佳：${best.label}  ${(best.rate * 100).toFixed(1)}%`);
