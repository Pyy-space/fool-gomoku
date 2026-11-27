/* 诊断线性评估：看它给出的分值分布、符号、与实际优劣是否一致。 */
const fs = require("fs"), path = require("path");
const { loadEngine, opening } = require("./_arena.js");

const E = loadEngine();
const file = path.join(__dirname, "..", "output", "fit", "weights.json");
const fitted = JSON.parse(fs.readFileSync(file, "utf8")).weights;
E.setEvalWeights(fitted);

const op = opening(4, 900);
const b = op.clone();

console.log("空局面（4 手开局，轮到黑）：");
const f0 = E.evalFeatures(b, 1);
console.log("  特征:", Array.from(f0).map((v) => Math.round(v)).join(", "));
let v0 = 0;
for (let i = 0; i < 8; i++) v0 += fitted[i] * f0[i] - fitted[8 + i] * f0[8 + i];
console.log("  线性评估值:", Math.round(v0));

console.log("\n各候选点的线性评估值（黑方视角），按值排序前 5 / 后 5：");
const r = [];
for (let y = 0; y < 15; y++) {
  for (let x = 0; x < 15; x++) {
    if (b.grid[y * 15 + x] !== 0) continue;
    const nb = b.clone();
    nb.placeColor(x, y, 1);
    const f = E.evalFeatures(nb, 1);
    let v = 0;
    for (let i = 0; i < 8; i++) v += fitted[i] * f[i] - fitted[8 + i] * f[8 + i];
    r.push([v, x, y]);
  }
}
r.sort((a, c) => c[0] - a[0]);
console.log("  最高 5 个:");
for (let i = 0; i < 5; i++) console.log(`    (${r[i][1]},${r[i][2]})  ${Math.round(r[i][0]).toLocaleString()}`);
console.log("  最低 5 个:");
for (let i = r.length - 5; i < r.length; i++) console.log(`    (${r[i][1]},${r[i][2]})  ${Math.round(r[i][0]).toLocaleString()}`);

// 关键检查：AI 用线性评估时实际选哪一步？和人类直觉比呢？
console.log("\n线性评估下 AI 的选择：");
const cfgLin = {
  linear_eval: true, node_limit: 3000, time_budget: 10, max_depth: 10,
  width_deep: 10, width_mid: 8, width_shallow: 6, use_vcf: false,
  root_jitter: 0, root_pool_tol: 0, root_pool_max: 1, q_node_limit: 0,
};
const cfgOld = Object.assign({}, cfgLin, { linear_eval: false });
for (const [name, cfg] of [["线性", cfgLin], ["势能", cfgOld]]) {
  const ai = new E.AI({ level: 3, config: cfg, seed: 7 });
  const res = ai.analyse(b.clone());
  console.log(`  ${name}: move=(${res.move.x},${res.move.y}) score=${Math.round(res.score).toLocaleString()} depth=${res.depth} reason=${res.reason}`);
}

// 检查评估值的量级是否威胁到 MATE
console.log("\n量级检查：MATE=1e8，本次拟合权重下最大可能评估值");
const names = ["NONE", "TWO", "OPEN_TWO", "THREE", "OPEN_THREE", "FOUR", "OPEN_FOUR", "FIVE"];
console.log("  权重:", names.map((n, i) => `${n}=${Math.round(fitted[i])}`).join(" "));
console.log("  被 EVAL_CAP=4e7 截断的样本数（随机 200 局面抽样中）：");
let clipped = 0, total = 0;
for (let s = 0; s < 200; s++) {
  const op2 = opening(4 + 2 * (s % 8), 1200 + s);
  const f = E.evalFeatures(op2, op2.side);
  let v = 0;
  for (let i = 0; i < 8; i++) v += fitted[i] * f[i] - fitted[8 + i] * f[8 + i];
  total++;
  if (Math.abs(v) >= 4e7) clipped++;
}
console.log(`    ${clipped}/${total}`);
