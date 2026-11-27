/* 实测各难度档位在真实中盘局面下的单步耗时（V8，浏览器同引擎） */
global.window = global;
require("../web/static/engine.js");
const E = window.GomokuEngine;

function randBoard(n, stones, seed) {
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const b = new E.Board(n, "casual");
  const used = new Set();
  let color = 1;
  while (used.size < stones) {
    const x = 2 + Math.floor(rnd() * (n - 4));
    const y = 2 + Math.floor(rnd() * (n - 4));
    const k = y * n + x;
    if (used.has(k)) continue;
    used.add(k);
    b.placeColor(x, y, color);
    color = color === 1 ? 2 : 1;
  }
  return b;
}

const LEVELS = [1, 2, 3];
console.log("局面：15 路，随机 12 手 / 20 手 / 30 手，各难度单步耗时（ms）\n");
console.log("手数  level  平均   最大   深度");
console.log("-".repeat(42));

for (const stones of [12, 20, 30]) {
  for (const lv of LEVELS) {
    const times = [];
    let depths = [];
    for (let k = 0; k < 5; k++) {
      const b = randBoard(15, stones, 1000 + stones * 37 + k);
      const ai = new E.AI({ level: lv });
      const t0 = Date.now();
      const r = ai.analyse(b);
      const dt = Date.now() - t0;
      times.push(dt);
      if (r && r.depth) depths.push(r.depth);
    }
    const avg = times.reduce((a, c) => a + c, 0) / times.length;
    const mx = Math.max(...times);
    console.log(
      `${String(stones).padStart(4)}  ${String(lv).padStart(5)}  ${avg.toFixed(0).padStart(5)}  ${String(mx).padStart(5)}  ${depths.length ? Math.max(...depths) : "-"}`
    );
  }
}
