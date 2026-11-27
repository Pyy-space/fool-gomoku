/* A/B：线性评估（拟合权重）vs 原来的势能评估。
   固定开局集 + 节点预算，可复现。 */
const fs = require("fs"), path = require("path");
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

const file = path.join(__dirname, "..", "output", "fit", "weights.json");
if (!fs.existsSync(file)) {
  console.error("先跑 tools/_fit_weights.js 生成 weights.json");
  process.exit(1);
}
const fitted = JSON.parse(fs.readFileSync(file, "utf8")).weights;
console.log("拟合权重：", fitted.map((v) => Math.round(v)).join(", "));

const OLD = Object.assign({}, BASE, { linear_eval: false });
const NEW = Object.assign({}, BASE, { linear_eval: true });

const POOL = openingSet(E, OPENS, 4, 5500);
const t0 = Date.now();

// 基线自检：同参数互下必须 50%
const chk = match(E, OLD, OLD, 0, 0, 0, POOL);
console.log(`自检（旧 vs 旧）：${chk.w}胜 ${chk.l}负 ${chk.d}平  ${(chk.rate * 100).toFixed(1)}%`);

E.setEvalWeights(fitted);
const r = match(E, NEW, OLD, 0, 0, 0, POOL);
console.log(`\n线性评估 vs 势能评估：`);
console.log(`  新 ${r.w}胜 ${r.l}负 ${r.d}平   新得分率 ${(r.rate * 100).toFixed(1)}%`);
console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
