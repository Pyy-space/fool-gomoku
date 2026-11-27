/* 验证 node_limit 生效：节点数应恰好到上限，且耗时不应被 time_budget 截断。 */
const { loadEngine, opening } = require("./_arena.js");
const E = loadEngine();

const op = opening(4, 777);   // 返回一个已摆好开局的 Board（黑子数==白子数）
const bd = op.clone();

for (const lim of [2000, 10000, 50000]) {
  const cfg = {
    node_limit: lim, time_budget: 0.05, max_depth: 20,
    width_deep: 14, width_mid: 12, width_shallow: 8,
    use_vcf: false, root_jitter: 0, root_pool_tol: 0, root_pool_max: 1,
  };
  const t0 = Date.now();
  const ai = new E.AI({ level: 2, config: cfg, seed: 1 });
  const res = ai.analyse(bd.clone());
  const ms = Date.now() - t0;
  const ok = res.nodes >= lim && res.nodes < lim + 400;
  console.log(`limit=${lim}  nodes=${res.nodes}  depth=${res.depth}  ms=${ms}  ${ok ? "OK" : "MISMATCH"}`);
}
