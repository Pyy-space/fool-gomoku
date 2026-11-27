/* 在 Node 里模拟 worker.js 的逻辑：重建棋盘 + analyse */
global.window = global;
require("../web/static/engine.js");
const E = window.GomokuEngine;

function rebuild(size, rules, moves) {
  const b = new E.Board(size, rules);
  for (const m of moves) b.placeColor(m.x, m.y, m.color);
  return b;
}

const moves = [{ x: 7, y: 7, color: 1 }, { x: 8, y: 8, color: 2 }];
const board = rebuild(15, "casual", moves);
console.log("重建: 子数", board.stoneCount, "side", board.side, "last", JSON.stringify(board.lastMove()));

const ai = new E.AI({ level: 3, rules: "casual", config: null });
const t0 = Date.now();
const a = ai.analyse(board);
console.log("analyse:", JSON.stringify({
  move: a.move, score: a.score, depth: a.depth, nodes: a.nodes,
  elapsed_ms: a.elapsed_ms, reason: a.reason,
}), "wall", Date.now() - t0, "ms");

// 把 worker 的 onmessage 里那段原样跑一遍（不启动线程）
const job = { size: 15, rules: "casual", level: 3, config: null, moves };
const b2 = rebuild(job.size, job.rules, job.moves);
const ai2 = new E.AI({ level: job.level, rules: job.rules, config: job.config });
const r = ai2.analyse(b2);
console.log("worker 模拟输出 ok:", !!(r && r.move), "move:", JSON.stringify(r.move));

// 检验配置覆盖是否生效（worker 传的 config 只有两个键）
const cfg = { defense_weight: 1.5, sort_defense: 1.4 };
const b3 = rebuild(15, "casual", moves);
const ai3 = new E.AI({ level: 3, rules: "casual", config: cfg });
const r3 = ai3.analyse(b3);
console.log("带 config 生效:", JSON.stringify(r3.move), "score", r3.score, "| 默认:", JSON.stringify(a.move), a.score);
