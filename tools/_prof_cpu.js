// 用 V8 CPU profiler 找出真正的热点函数（自耗时占比）
const fs = require("fs"), path = require("path"), vm = require("vm");
const code = fs.readFileSync(path.join(__dirname, "..", "web", "static", "engine.js"), "utf8");
const sandbox = { window: {}, console, Math, Date, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 } };
sandbox.self = sandbox.window;
vm.createContext(sandbox); vm.runInContext(code, sandbox);
const E = sandbox.window.GomokuEngine;

function mkMid(seed, plies) {
  let s = seed * 2654435761 >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const b = new E.Board(15, "casual");
  const c = 7;
  b.placeColor(c, c, 1);
  for (let k = 1; k < plies; k++) {
    const opts = [];
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
      const x = c + dx, y = c + dy;
      if (x < 0 || y < 0 || x >= 15 || y >= 15) continue;
      if (b.grid[y * 15 + x] !== 0) continue;
      opts.push([x, y]);
    }
    const p = opts[(rnd() * opts.length) | 0];
    b.placeColor(p[0], p[1], k % 2 === 0 ? 2 : 1);
  }
  return b;
}

const boards = [mkMid(5, 10), mkMid(6, 18), mkMid(7, 26)];
const ai3 = new E.AI({ level: 3, rules: "casual", seed: 3 });

const prof = [];
const id = "prof";
require("inspector").Session ? null : null;

// 直接用 V8 的 profiler
const inspector = require("inspector");
const session = new inspector.Session();
session.connect();
const post = (m, p) => new Promise((res, rej) => session.post(m, p || {}, (e, r) => e ? rej(e) : res(r)));

(async () => {
  await post("Profiler.enable");
  await post("Profiler.setSamplingInterval", { interval: 100 });
  await post("Profiler.start");
  for (const b of boards) ai3.analyse(b);
  const { profile } = await post("Profiler.stop");
  session.disconnect();

  const nodes = new Map();
  for (const n of profile.nodes) nodes.set(n.id, n);
  const self = new Map();
  // timeDeltas[i] 是 samples[i] 与 samples[i-1] 的间隔
  for (let i = 0; i < profile.samples.length; i++) {
    const n = nodes.get(profile.samples[i]);
    if (!n) continue;
    const f = n.callFrame;
    const key = (f.functionName || "(anonymous)") + " @" + (f.lineNumber + 1);
    self.set(key, (self.get(key) || 0) + (profile.timeDeltas[i] || 0));
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22);
  console.log("总样本时间 " + (total / 1000).toFixed(0) + "ms");
  for (const [k, v] of rows) {
    console.log((v / 1000).toFixed(0).padStart(6) + "ms " + (v / total * 100).toFixed(1).padStart(5) + "%  " + k);
  }
})();
