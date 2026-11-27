/* 用自我对弈数据修正线性评估权重（有界乘数版）。

   背景：直接拿逻辑回归系数当权重会炸——那些是 log-odds 空间的系数，比值不能
   线性缩放。实测直接套用时开局长度的局面评估值就到 2.4e7（接近 MATE 量级），
   145/200 个局面被 EVAL_CAP 截断，评估退化成常量，AI 全盘皆输。

   所以这里改成：只拟合「各棋型相对强弱的修正方向」，把结果压成对手写权重的
   有界乘数（0.3x ~ 3x），保住原有权重的量级与单调性。这样数据只用来微调，
   不会破坏评估的数值结构。

   用法：node tools/_fit_weights.js [局数] [节点预算]
   产出：output/fit/weights.json（同时给出乘数与最终权重）
*/
const fs = require("fs"), path = require("path");
const { loadEngine, opening } = require("./_arena.js");

const E = loadEngine();
const GAMES = Number(process.argv[2] || 150);
const NODE_LIMIT = Number(process.argv[3] || 600);
const NFEAT = 16;
const NAMES = ["NONE", "TWO", "OPEN_TWO", "THREE", "OPEN_THREE", "FOUR", "OPEN_FOUR", "FIVE"];

const MULT_MIN = 0.3, MULT_MAX = 3.0;

const BASE = {
  node_limit: NODE_LIMIT, time_budget: 10.0, max_depth: 16,
  width_deep: 10, width_mid: 8, width_shallow: 6,
  use_vcf: true, vcf_max_depth: 12,
  root_jitter: 0.20, root_pool_tol: 0.10, root_pool_max: 5,
  q_node_limit: 0,
};

function makeRng(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* 跑一局，收集「轮到走」局面的特征 + 该方最终胜负。每 2 步取一次，减少近重复样本。 */
function collect(op) {
  const b = op.clone();
  const aiB = new E.AI({ level: 3, config: BASE, seed: 11 });
  const aiW = new E.AI({ level: 3, config: BASE, seed: 22 });
  const rows = [];

  for (let step = 0; step < 225; step++) {
    if (b.isFull || b.winner() !== 0) break;
    const side = b.side;
    if (step % 2 === 0 && step >= 6) rows.push({ f: E.evalFeatures(b, side), side: side });
    const ai = side === 1 ? aiB : aiW;
    const mv = ai.choose(b);
    if (!mv) break;
    b.place(mv.x, mv.y);
  }
  const w = b.winner();
  return rows.map((r) => ({
    f: r.f,
    y: w === 0 ? 0 : (w === r.side ? 1 : -1),
  }));
}

function main() {
  const t0 = Date.now();
  const rnd = makeRng(4242);
  const samples = [];

  for (let g = 0; g < GAMES; g++) {
    const plies = 4 + 2 * ((rnd() * 4) | 0);
    for (const r of collect(opening(plies, 900 + g))) samples.push(r);
    if ((g + 1) % 25 === 0) {
      console.log(`  ${g + 1}/${GAMES} 局，${samples.length} 样本，${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }
  const train = samples.filter((r) => r.y !== 0);
  console.log(`采样完成：${GAMES} 局，${train.length} 个有胜负样本，${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const cols = [];
  for (let i = 1; i < NFEAT; i++) cols.push(i);
  const k = cols.length;

  const mean = new Array(NFEAT).fill(0), std = new Array(NFEAT).fill(0);
  for (const i of cols) { let s = 0; for (const r of train) s += r.f[i]; mean[i] = s / train.length; }
  for (const i of cols) {
    let s = 0; for (const r of train) { const d = r.f[i] - mean[i]; s += d * d; }
    std[i] = Math.sqrt(s / train.length) || 1;
  }

  // 逻辑回归（L2），只用来判断各棋型的相对重要性方向
  const w = new Array(k).fill(0);
  const LR = 0.08, L2 = 0.004, EPOCHS = 400;
  const X = train.map((r) => cols.map((i) => (r.f[i] - mean[i]) / std[i]));
  const Y = train.map((r) => (r.y > 0 ? 1 : 0));

  for (let ep = 0; ep < EPOCHS; ep++) {
    const g = new Array(k).fill(0);
    for (let s = 0; s < X.length; s++) {
      let z = 0;
      for (let i = 0; i < k; i++) z += w[i] * X[s][i];
      const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      const err = p - Y[s];
      for (let i = 0; i < k; i++) g[i] += err * X[s][i];
    }
    for (let i = 0; i < k; i++) w[i] -= LR * (g[i] / X.length + L2 * w[i]);
    if ((ep + 1) % 200 === 0) {
      let acc = 0;
      for (let s = 0; s < X.length; s++) {
        let z = 0; for (let i = 0; i < k; i++) z += w[i] * X[s][i];
        if ((z > 0) === (Y[s] === 1)) acc++;
      }
      console.log(`  epoch ${ep + 1}  acc=${(acc / X.length * 100).toFixed(1)}%`);
    }
  }

  // 还原到原始特征尺度
  const raw = new Array(NFEAT).fill(0);
  for (let i = 0; i < k; i++) raw[cols[i]] = w[i] / std[cols[i]];

  // 关键：不算绝对权重，只算「相邻档位的相对强度」。
  // 用 |raw| 的比值构造各档之间应有的跨度，再对照手写权重的跨度，得出修正乘数。
  const dflt = E.defaultEvalWeights();

  // 每档的拟合强度（我方取正的，对方取绝对值后平均）
  const strength = new Array(8).fill(0);
  for (let i = 1; i < 8; i++) {
    const a = Math.abs(raw[i]), b2 = Math.abs(raw[8 + i]);
    strength[i] = (a + b2) / 2;
  }
  // 强制单调（棋型越强，强度不能更小）
  for (let i = 2; i < 8; i++) if (strength[i] < strength[i - 1]) strength[i] = strength[i - 1];

  /* 拟合强度的相邻比值 = 拟合认为「这一档应该比上一档强多少倍」。
     手写权重的相邻比值 = 现在实际强多少倍。两者之比就是该档的修正乘数。
     【关键】乘数直接乘在手写权重上，不做逐档反推——反推会指数放大，
     实测把 TWO 从 15 推到 2623（175 倍），评估值直接逼近 MATE。 */
  const mult = new Array(8).fill(1);
  for (let i = 1; i <= 6; i++) {
    const fitRatio = strength[i] > 0 ? strength[i + 1] / strength[i] : 1;
    const curRatio = dflt[i] > 0 ? dflt[i + 1] / dflt[i] : 1;
    let m = curRatio > 0 ? fitRatio / curRatio : 1;
    if (m < MULT_MIN) m = MULT_MIN;
    if (m > MULT_MAX) m = MULT_MAX;
    mult[i] = m;
  }
  // FIVE 固定不动（它是「已赢」的标记，不该参与调权）
  mult[7] = 1;

  const out = new Array(NFEAT).fill(0);
  for (let i = 1; i < 8; i++) out[i] = dflt[i] * mult[i];
  // 强制单调（棋型越强权重不能更小），并把 FIVE 钉回原值
  for (let i = 2; i < 7; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
  out[7] = dflt[7];
  for (let i = 1; i < 8; i++) out[8 + i] = -out[i] * 1.15;

  console.log("\n各档修正乘数（相对手写权重）：");
  for (let i = 1; i <= 7; i++) console.log(`  ${NAMES[i].padEnd(11)} ${mult[i].toFixed(2)}x`);

  console.log("\n最终权重：");
  for (let i = 0; i < 8; i++) console.log(`  我方 ${NAMES[i].padEnd(11)} ${Math.round(out[i]).toLocaleString()}`);
  for (let i = 1; i < 8; i++) console.log(`  对方 ${NAMES[i].padEnd(11)} ${Math.round(out[8 + i]).toLocaleString()}`);

  // 数值合理性检查 + 整体缩放：评估值的绝对值必须远小于 MATE(1e8)，
  // 否则搜索会把「平静局面」误判成必杀。目标上限 EVAL_TARGET。
  const EVAL_TARGET = 8e5;
  let maxAbs = 0;
  for (let s = 0; s < 300; s++) {
    const op2 = opening(4 + 2 * (s % 10), 1200 + s);
    const f = E.evalFeatures(op2, op2.side);
    let v = 0;
    for (let i = 0; i < 8; i++) v += out[i] * f[i] - out[8 + i] * f[8 + i];
    if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
  }
  if (maxAbs > 0) {
    const k2 = EVAL_TARGET / maxAbs;
    for (let i = 0; i < NFEAT; i++) out[i] *= k2;
    console.log(`\n整体缩放 ×${k2.toFixed(4)}（原上限 ${Math.round(maxAbs).toLocaleString()} → 目标 ${EVAL_TARGET.toLocaleString()}）`);
    maxAbs = EVAL_TARGET;
  }
  console.log(`数值检查：随机局面评估值上限 ${Math.round(maxAbs).toLocaleString()}（MATE=1e8）`);

  console.log("\n最终权重：");
  for (let i = 0; i < 8; i++) console.log(`  我方 ${NAMES[i].padEnd(11)} ${out[i].toFixed(1)}`);
  for (let i = 1; i < 8; i++) console.log(`  对方 ${NAMES[i].padEnd(11)} ${out[8 + i].toFixed(1)}`);
  const dir = path.join(__dirname, "..", "output", "fit");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "weights.json");
  fs.writeFileSync(file, JSON.stringify({
    games: GAMES, node_limit: NODE_LIMIT, samples: train.length,
    weights: out, multipliers: mult, max_abs_eval: maxAbs,
    fitted_at: new Date().toISOString(),
  }, null, 2), "utf8");
  console.log(`已写 ${file}`);
}

main();
