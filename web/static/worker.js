/* 搜索线程：把 αβ 搜索放到 Web Worker 里跑，主线程不卡。
 *
 * 主线程发 {id, level, rules, config, size, moves:[{x,y,color}], mode}，
 * 这里重建棋盘、跑 analyse，把结果原样发回去。
 * mode = "hint" 时同样只算不落子（提示用）。
 */

importScripts("engine.js");

const E = self.GomokuEngine;

/** 按落子序列重建棋盘。color 显式给出，不依赖轮次推断。 */
function rebuild(size, rules, moves) {
  const b = new E.Board(size, rules);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    b.placeColor(m.x, m.y, m.color);
  }
  return b;
}

self.onmessage = function (ev) {
  const job = ev.data || {};
  const id = job.id;
  let payload;
  try {
    const board = rebuild(job.size || 15, job.rules || "casual", job.moves || []);
    const ai = new E.AI({
      level: job.level || 3,
      rules: job.rules || "casual",
      config: job.config || null,
    });
    const t0 = Date.now();
    const a = ai.analyse(board);
    payload = {
      id: id,
      ok: true,
      move: a.move,
      score: a.score,
      depth: a.depth,
      nodes: a.nodes,
      elapsed_ms: a.elapsed_ms,
      reason: a.reason,
      pv: a.pv,
      threats: a.threats,
      wall_ms: Date.now() - t0,
    };
  } catch (err) {
    payload = { id: id, ok: false, reason: String((err && err.message) || err) };
  }
  self.postMessage(payload);
};
