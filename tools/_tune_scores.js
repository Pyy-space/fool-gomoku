/* 调现有势能评估里的 8 个棋型分数（SCORE_BY_IDX）。
   这是真正在用的评估函数，带单点封顶结构，所以调它比另建线性模型更可能有效。

   方法：固定开局集 + 节点预算的循环赛（可复现，同参数互下恒 50%）。
   逐个候选分数替换后跟基线对打，胜率明显高于 50% 才留。

   用法：node tools/_tune_scores.js [候选倍数...]
*/
const { loadEngine, openingSet, match } = require("./_arena.js");

const E = loadEngine();
const OPENS = Number(process.argv[2] || 8);
const TOL = Number(process.argv[3] || 6000);

const BASE = {
  node_limit: TOL, time_budget: 10.0, max_depth: 16,
  width_deep: 12, width_mid: 10, width_shallow: 8,
  use_vcf: true, vcf_max_depth: 14,
  root_jitter: 0, root_pool_tol: 0, root_pool_max: 1,
  q_node_limit: 0,
};

const DFLT = E.shapeScores();
const NAMES = ["NONE", "TWO", "OPEN_TWO", "THREE", "OPEN_THREE", "FOUR", "OPEN_FOUR", "FIVE"];
console.log("当前分数:", NAMES.map((n, i) => `${n}=${DFLT[i]}`).join(" "));
console.log(`开局集 ${OPENS} 组（共 ${OPENS * 2} 局/组），节点预算 ${TOL}\n`);

const POOL = openingSet(E, OPENS, 4, 5500);
const t0 = Date.now();

function run(label, mutate) {
  const s = DFLT.slice();
  mutate(s);
  E.setShapeScores(s);
  const r = match(E, BASE, BASE, 0, 0, 0, POOL);
  // 注意：两副参数相同 → 只能测「新分数下自战是否仍对称」，测不出强弱。
  return r;
}

/* 真正的测法：新版（用改后的分数）vs 基线（用默认分数）。
   但两边是同一个引擎、同一份 SCORE_BY_IDX，没法同时用两套分数。
   所以采用「分两个进程/两次加载」的办法：用 vm 再加载一份引擎做基线。 */
const fs = require("fs"), path = require("path"), vm = require("vm");

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

/* 用一个引擎实例跑一局：黑用 cfgBlack，白用 cfgWhite。 */
function playWith(Eb, Ew, op, cfgB, cfgW) {
  const b = op.clone2 ? op.clone2() : op.clone();
  const aiB = new Eb.AI({ level: 3, config: cfgB, seed: 11 });
  const aiW = new Ew.AI({ level: 3, config: cfgW, seed: 22 });
  for (let step = 0; step < 225; step++) {
    if (b.isFull) return 0;
    const w = b.winner();
    if (w !== 0) return w;
    const isBlack = b.side === 1;
    const mv = (isBlack ? aiB : aiW).choose(b);
    if (!mv) return 0;
    b.place(mv.x, mv.y);
  }
  return 0;
}

/* 跨引擎对局不能共享棋盘对象（每个引擎有自己的 Board 类），
   所以用「落子序列」传递：A 引擎算，把 (x,y) 应用到两边各自的棋盘。 */
function playCross(EA, EB, op, cfgA, cfgB) {
  const mk = (E) => { const b = new E.Board(15, "casual"); return b; };
  const ba = mk(EA), bb = mk(EB);
  // 开局序列从 op 的 moves 里取
  const seq = op.moves;
  for (const m of seq) { ba.placeColor(m.x, m.y, m.color); bb.placeColor(m.x, m.y, m.color); }

  const aiA = new EA.AI({ level: 3, config: cfgA, seed: 11 });
  const aiB = new EB.AI({ level: 3, config: cfgB, seed: 22 });

  for (let step = 0; step < 225 - seq.length; step++) {
    const w = ba.winner();
    if (w !== 0) return w;
    if (ba.isFull) return 0;
    const isBlack = ba.side === 1;
    const ai = isBlack ? aiA : aiB;
    const board = isBlack ? ba : bb;
    const mv = ai.choose(isBlack ? ba : bb);
    if (!mv) return 0;
    ba.place(mv.x, mv.y);
    bb.place(mv.x, mv.y);
  }
  return 0;
}

function matchCross(EA, EB, pool) {
  let w = 0, l = 0, d = 0;
  for (const op of pool) {
    let r = playCross(EA, EB, op, BASE, BASE);       // A 执黑
    if (r === 1) w++; else if (r === 2) l++; else d++;
    r = playCross(EB, EA, op, BASE, BASE);           // A 执白
    if (r === 2) w++; else if (r === 1) l++; else d++;
  }
  const total = w + l + d;
  return { w, l, d, total, rate: total ? w / total : 0 };
}

// 自检：同一份引擎互下必须 50%
const E2 = loadFresh();
{
  const a = loadFresh(), b = loadFresh();
  const r = matchCross(a, b, POOL);
  console.log(`跨引擎自检：${r.w}胜 ${r.l}负 ${r.d}平  ${(r.rate * 100).toFixed(1)}%  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

/* 候选：把某一档分数乘以 factor */
const CANDS = [
  ["基线(不动)", null],
  ["OPEN_THREE x0.6", [4, 0.6]],
  ["OPEN_THREE x1.8", [4, 1.8]],
  ["FOUR x0.6", [5, 0.6]],
  ["FOUR x1.8", [5, 1.8]],
  ["OPEN_FOUR x0.6", [6, 0.6]],
  ["OPEN_FOUR x1.8", [6, 1.8]],
  ["THREE x0.5", [3, 0.5]],
  ["THREE x2.0", [3, 2.0]],
  ["OPEN_TWO x2.0", [2, 2.0]],
];

for (const [label, mut] of CANDS) {
  const NEW = loadFresh();
  const REF = loadFresh();
  if (mut) {
    const s = NEW.shapeScores();
    s[mut[0]] = Math.round(s[mut[0]] * mut[1]);
    NEW.setShapeScores(s);
  }
  const r = matchCross(NEW, REF, POOL);
  const mark = (r.rate > 0.55) ? "  <<<" : "";
  console.log(`${label.padEnd(18)} ${r.w}胜 ${r.l}负 ${r.d}平  ${(r.rate * 100).toFixed(1)}%${mark}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
