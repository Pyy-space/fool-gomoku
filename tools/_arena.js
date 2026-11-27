/* 对局测试骨架：开局生成、单局、正反手配对、自检。

   之前的 A/B 脚本有个坑：手摆开局时用 placeColor 摆成 3 黑 1 白这种不合法局面，
   而且没管 side，导致「同一套参数自己打自己」只有 25% 胜率——说明骨架本身不对称，
   在它上面跑出来的结论都不可信。这里统一修正并加自检。 */
const fs = require("fs"), path = require("path"), vm = require("vm");

const ENGINE_PATH = path.join(__dirname, "..", "web", "static", "engine.js");

function loadEngine(code) {
  const src = code || fs.readFileSync(ENGINE_PATH, "utf8");
  const sandbox = {
    window: {}, console,
    performance: { now: () => Number(process.hrtime.bigint()) / 1e6 },
  };
  sandbox.self = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.GomokuEngine;
}

const SIZE = 15;

/* 生成合法开局：黑先，黑白交替，子数差 <=1，最后轮到黑（偶数手）。 */
function opening(plies, seed) {
  if (plies % 2 !== 0) plies += 1;          // 必须是偶数手，否则轮到白
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

  const E = loadEngine();
  const b = new E.Board(SIZE, "casual");
  const c = SIZE >> 1;
  b.placeColor(c, c, 1);                    // 黑走天元（placeColor 会把 side 切成白）

  for (let k = 1; k < plies; k++) {
    const color = (k % 2 === 0) ? 1 : 2;    // k=1 白，k=2 黑，k=3 白…
    const opts = [];
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
      const x = c + dx, y = c + dy;
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      if (b.grid[y * SIZE + x] !== 0) continue;
      opts.push([x, y]);
    }
    const p = opts[(rnd() * opts.length) | 0];
    b.placeColor(p[0], p[1], color);
  }
  // plies 偶数 → 最后落的是白 → 现在轮到黑，正确
  return b;
}

/* 一局。返回 1=黑胜 2=白胜 0=和/超手数。 */
function play(E, cfgBlack, cfgWhite, op, maxSteps) {
  maxSteps = maxSteps || 225;
  const b = op.clone();
  const aiB = new E.AI({ level: 3, config: cfgBlack, seed: 11 });
  const aiW = new E.AI({ level: 3, config: cfgWhite, seed: 22 });
  for (let step = 0; step < maxSteps; step++) {
    if (b.isFull) return 0;
    const w = b.winner();
    if (w !== 0) return w;
    const ai = b.side === 1 ? aiB : aiW;
    const mv = ai.choose(b);
    if (!mv) return 0;
    b.place(mv.x, mv.y);
  }
  return 0;
}

/* 配对赛：同开局 A 执黑一局、A 执白一局，返回 A 的得分率。
   openings 可传一组预先建好的开局（循环赛必须这样，否则各对局开局不同没法横比）。 */
function match(E, cfgA, cfgB, rounds, plies, seedBase, openings) {
  let w = 0, l = 0, d = 0;
  const pool = openings || null;
  const n = pool ? pool.length : rounds;
  for (let i = 0; i < n; i++) {
    const op = pool ? pool[i] : opening(plies, (seedBase || 500) + i);

    let r = play(E, cfgA, cfgB, op);            // A 执黑
    if (r === 1) w++; else if (r === 2) l++; else d++;

    r = play(E, cfgB, cfgA, op);                // A 执白
    if (r === 2) w++; else if (r === 1) l++; else d++;
  }
  const total = w + l + d;
  return { w, l, d, total, rate: total ? w / total : 0 };
}

/* 建一批固定开局，供循环赛共用。 */
function openingSet(E, count, plies, seedBase) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(opening(plies, (seedBase || 500) + i));
  return out;
}

/* 自检：一模一样的两副参数互下，A 的得分率必须恰好 50%（完全镜像）。
   若不等于 50%，说明骨架有偏，跑什么 A/B 都没意义。
   注意必须用 node_limit（节点预算）而不是墙钟：墙钟下同一副参数两次对阵
   会因机器抖动搜到不同深度，镜像关系就断了。 */
function selfCheck(rounds) {
  const E = loadEngine();
  const cfg = { node_limit: 8000, max_depth: 6, width_deep: 8, width_mid: 6, width_shallow: 4, use_vcf: false };
  const r = match(E, cfg, cfg, rounds || 4, 4, 900);
  const ok = Math.abs(r.rate - 0.5) < 1e-9 && r.d === 0;
  console.log(`自检（同参数互下）：${r.w}胜 ${r.l}负 ${r.d}平  得分率 ${(r.rate * 100).toFixed(1)}%  ${ok ? "OK" : "FAIL ← 骨架有偏"}`);
  return ok;
}

module.exports = { loadEngine, opening, openingSet, play, match, selfCheck, SIZE };

if (require.main === module) {
  selfCheck(Number(process.argv[2] || 4));
}
