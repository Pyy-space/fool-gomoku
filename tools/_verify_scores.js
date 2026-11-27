/* 大样本复核：OT x1.8 是否真的强于基线。
   同时给出二项分布下的 z 值，避免把噪声当提升。 */
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

const NODE_LIMIT = Number(process.argv[3] || 5000);
const BASE = {
  node_limit: NODE_LIMIT, time_budget: 10.0, max_depth: 16,
  width_deep: 12, width_mid: 10, width_shallow: 8,
  use_vcf: true, vcf_max_depth: 14,
  root_jitter: 0, root_pool_tol: 0, root_pool_max: 1,
  q_node_limit: 0,
};

const E0 = loadFresh();
const OPENS = Number(process.argv[2] || 24);
const POOL = openingSet(E0, OPENS, 4, 5500);

function playCross(EA, EB, seq) {
  const ba = new (EA.Board)(15, "casual");
  const bb = new (EB.Board)(15, "casual");
  for (const m of seq) { ba.placeColor(m.x, m.y, m.color); bb.placeColor(m.x, m.y, m.color); }
  const aiA = new EA.AI({ level: 3, config: BASE, seed: 11 });
  const aiB = new EB.AI({ level: 3, config: BASE, seed: 22 });
  for (let step = 0; step < 225 - seq.length; step++) {
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
  const score = w + d * 0.5;
  const rate = total ? score / total : 0;
  // 二项检验（H0: 真实得分率 = 0.5）
  const se = Math.sqrt(0.25 / total);
  const z = se > 0 ? (rate - 0.5) / se : 0;
  return { w, l, d, total, rate, z };
}

const CANDS = [
  ["基线（自检）", []],
  ["OT x1.8", [[4, 1.8]]],
  ["FOUR x0.6", [[5, 0.6]]],
];

console.log(`开局 ${OPENS} 组 = ${OPENS * 2} 局/候选，节点预算 ${NODE_LIMIT}\n`);
const t0 = Date.now();
for (const [label, muts] of CANDS) {
  const NEW = loadFresh();
  const REF = loadFresh();
  if (muts.length) {
    const s = NEW.shapeScores();
    for (const [i, f] of muts) s[i] = Math.round(s[i] * f);
    NEW.setShapeScores(s);
  }
  const r = matchCross(NEW, REF, POOL);
  const verdict = r.z > 1.64 ? "显著更强(p<0.05)" : (r.z < -1.64 ? "显著更弱" : "在噪声内");
  console.log(`${label.padEnd(14)} ${r.w}胜 ${r.l}负 ${r.d}平  ${(r.rate * 100).toFixed(1)}%  z=${r.z.toFixed(2)}  ${verdict}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
