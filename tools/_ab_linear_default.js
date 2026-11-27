/* 隔离测试：线性评估框架本身有没有问题。
   用「手写默认权重」走 _evaluateLinear，如果这也输，说明是特征结构问题
   （缺单点封顶 / 4 方向全加），不是权重拟合的问题。 */
const { loadEngine, openingSet, match } = require("./_arena.js");

const E = loadEngine();
const OPENS = Number(process.argv[2] || 6);
const TOL = Number(process.argv[3] || 8000);

const BASE = {
  node_limit: TOL, time_budget: 10.0, max_depth: 16,
  width_deep: 12, width_mid: 10, width_shallow: 8,
  use_vcf: true, vcf_max_depth: 14,
  root_jitter: 0, root_pool_tol: 0, root_pool_max: 1,
  q_node_limit: 0,
};

const OLD = Object.assign({}, BASE, { linear_eval: false });
const LIN = Object.assign({}, BASE, { linear_eval: true });

const POOL = openingSet(E, OPENS, 4, 5500);

// 手动把手写权重灌进去（defaultEvalWeights 是 16 维，FIVE=1e7 量级）
const dflt = Array.from(E.defaultEvalWeights());
console.log("手写权重:", dflt.map((v) => Math.round(v)).join(", "));
E.setEvalWeights(dflt);

const chk = match(E, OLD, OLD, 0, 0, 0, POOL);
console.log(`自检（势能 vs 势能）：${chk.w}胜 ${chk.l}负 ${chk.d}平  ${(chk.rate * 100).toFixed(1)}%`);

const r = match(E, LIN, OLD, 0, 0, 0, POOL);
console.log(`\n线性(手写权重) vs 势能：${r.w}胜 ${r.l}负 ${r.d}平  线性得分率 ${(r.rate * 100).toFixed(1)}%`);
