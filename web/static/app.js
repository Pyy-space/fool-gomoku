/* 五子棋 AI 助手 —— 前端公共逻辑 + 四个页面
 *
 * 设计原则：
 *   1) 一切以服务端状态为准。前端不自己维护棋盘，每次落子/悔棋都拿回完整 state 重绘。
 *   2) 所有页面共用 app.js，靠 <body> 前的 window.PAGE 区分：
 *      landing / hub / local / lab。
 *   3) SocketIO 只用来推送长任务进度（AI 应手、自动对战状态、调参进度），
 *      没有网络也能用，只是这些进度要靠轮询/同步接口。
 *   4) 实验室（lab = 机器对弈调参）是隐藏入口：页脚版本号连点 5 次进入，
 *      进去还要口令解锁。前端彩蛋只是隐蔽，真锁在后端（token 鉴权）。
 */

/* ============================== 小工具 ============================== */

// 前后端分离：静态前端（GitHub Pages）与 API 后端（Render）不同源。
// 部署时把 web/config.js 里的 window.API_BASE 改成后端地址；本地 Flask 版
// 不引入 config.js，API_BASE 为空 = 同源，走相对路径，行为完全不变。
const API_BASE = window.API_BASE || "";

// 是否运行在「前后端分离」的静态前端（GitHub Pages）。此时页面是 *.html 相对路径，
// 而本地 Flask 版用 /hub /lab 这种绝对路由。
const STATIC_DEPLOY = !!window.API_BASE;

// 站内页面跳转：静态站用相对 *.html（GitHub Pages 可能挂在 /repo/ 子路径下），
// Flask 版用绝对路由。统一走这个函数，避免写死 "/lab" 在 Pages 下 404。
function pageHref(page) {
  return STATIC_DEPLOY ? `${page}.html` : `/${page}`;
}

const $ = (sel) => document.querySelector(sel);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

async function api(url, body) {
  const opt = { method: body === undefined ? "GET" : "POST",
                headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(API_BASE + url, opt);
  const data = await r.json().catch(() => ({}));
  // 后端对 403（实验室口令错误）也返回结构化 JSON {ok:false,reason}，
  // 这里不抛异常，把 body 交给调用方按 ok 字段处理。
  if (!r.ok && data && data.ok === false) return data;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return data;
}

function fmt(v, digits) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  return digits === undefined ? String(n) : n.toFixed(digits);
}

const COLOR_NAME = { 0: "空", 1: "黑", 2: "白" };

/* ============================== 棋盘渲染 ============================== */

class BoardView {
  /** 用 canvas 画棋盘 + 棋子。
   *
   * 坐标约定与服务端一致：x 向右，y 向下，原点在左上角。
   * 画布尺寸随容器变化（ResizeObserver + devicePixelRatio 自适应）。
   */
  constructor(host) {
    this.host = host;
    this.size = 15;
    this.grid = [];
    this.last = null;
    this.side = 1;
    this.interactive = true;
    this.hover = null;
    this._clickCb = null;

    // 如果 host 本身就是 <canvas>（落地页背景），直接复用；否则新建一个 canvas 塞进去。
    if (host && host.tagName === "CANVAS") {
      this.canvas = host;
    } else {
      this.canvas = document.createElement("canvas");
      host.appendChild(this.canvas);
    }
    this.ctx = this.canvas.getContext("2d");

    this._resize();
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(host);
    } else {
      window.addEventListener("resize", () => this._resize());
    }

    this.canvas.addEventListener("mousemove", (e) => this._onMove(e));
    this.canvas.addEventListener("mouseleave", () => { this.hover = null; this._draw(); });
    this.canvas.addEventListener("click", (e) => this._onClick(e));
  }

  /* ---------- 尺寸 ---------- */
  _resize() {
    const w = Math.max(200, Math.floor(this.host.clientWidth || 560));
    const h = Math.max(200, Math.floor(this.host.clientHeight || w));
    const box = Math.min(w, h);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(box * dpr);
    this.canvas.height = Math.floor(box * dpr);
    this.canvas.style.width = box + "px";
    this.canvas.style.height = box + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.box = box;
    this.pad = Math.max(14, box * 0.058);
    this.step = (box - this.pad * 2) / Math.max(1, this.size - 1);
    this._draw();
  }

  /* ---------- 数据 ---------- */
  setSize(n) {
    if (!n || n === this.size) return;
    this.size = n;
    this.grid = new Array(n * n).fill(0);
    this._resize();
  }

  setState(state) {
    if (!state) return;
    if (state.size && state.size !== this.size) {
      this.size = state.size;
      this._resize();
    }
    this.grid = state.grid || [];
    this.last = state.last || null;
    this.side = state.side || 1;
    this._draw();
  }

  setInteractive(on) {
    this.interactive = !!on;
    this.canvas.style.cursor = on ? "pointer" : "default";
  }

  onClick(cb) { this._clickCb = cb; }

  /* ---------- 坐标换算 ---------- */
  _px(x) { return this.pad + x * this.step; }

  _nearest(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const x = Math.round((px - this.pad) / this.step);
    const y = Math.round((py - this.pad) / this.step);
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return null;
    // 太靠外就当作没点中
    const dx = px - this._px(x), dy = py - this._px(y);
    if (Math.hypot(dx, dy) > this.step * 0.62) return null;
    return { x, y };
  }

  _onMove(ev) {
    if (!this.interactive) return;
    const p = this._nearest(ev);
    const changed = (!!p !== !!this.hover) ||
      (p && this.hover && (p.x !== this.hover.x || p.y !== this.hover.y));
    if (changed) {
      this.hover = p;
      this._draw();
    }
  }

  _onClick(ev) {
    if (!this.interactive) return;
    const p = this._nearest(ev);
    if (!p) return;
    const i = p.y * this.size + p.x;
    if (this.grid[i]) return;
    if (this._clickCb) this._clickCb(p.x, p.y);
  }

  /* ---------- 绘制 ---------- */
  _starPoints() {
    const n = this.size;
    if (n === 19) {
      const p = [];
      for (const y of [3, 9, 15]) for (const x of [3, 9, 15]) p.push([x, y]);
      return p;
    }
    if (n === 15) {
      return [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]];
    }
    if (n === 13) {
      return [[3, 3], [9, 3], [3, 9], [9, 9], [6, 6]];
    }
    return [];
  }

  _draw() {
    const ctx = this.ctx;
    const box = this.box;
    const n = this.size;
    if (!box) return;

    // 木纹底：径向渐变模拟光源，再加一层细斜纹
    const g = ctx.createRadialGradient(box * 0.32, box * 0.26, box * 0.08,
                                       box * 0.5, box * 0.5, box * 0.86);
    g.addColorStop(0, "#e6c08a");
    g.addColorStop(0.55, "#d8ab6f");
    g.addColorStop(1, "#b98f55");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, box, box);

    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = "#7a5423";
    ctx.lineWidth = 1;
    for (let i = -box; i < box * 2; i += 9) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + box, box);
      ctx.stroke();
    }
    ctx.restore();

    // 网格线
    ctx.strokeStyle = "rgba(60,40,20,.72)";
    ctx.lineWidth = Math.max(1, box / 620);
    for (let i = 0; i < n; i++) {
      const p = this._px(i);
      ctx.beginPath();
      ctx.moveTo(this.pad, p);
      ctx.lineTo(box - this.pad, p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, this.pad);
      ctx.lineTo(p, box - this.pad);
      ctx.stroke();
    }

    // 星位
    ctx.fillStyle = "rgba(45,30,14,.82)";
    const r = Math.max(2, this.step * 0.075);
    for (const [x, y] of this._starPoints()) {
      ctx.beginPath();
      ctx.arc(this._px(x), this._px(y), r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 棋子
    const rad = this.step * 0.44;
    for (let i = 0; i < this.grid.length; i++) {
      const c = this.grid[i];
      if (!c) continue;
      this._stone(i % n, Math.floor(i / n), c, rad);
    }

    // 最后一手标记
    if (this.last) {
      const cx = this._px(this.last.x), cy = this._px(this.last.y);
      ctx.strokeStyle = "#e5484d";
      ctx.lineWidth = Math.max(1.6, this.step * 0.055);
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 悬停预览
    if (this.interactive && this.hover) {
      const i = this.hover.y * n + this.hover.x;
      if (!this.grid[i]) {
        ctx.save();
        ctx.globalAlpha = 0.38;
        this._stone(this.hover.x, this.hover.y, this.side, rad);
        ctx.restore();
      }
    }
  }

  _stone(x, y, color, rad) {
    const ctx = this.ctx;
    const cx = this._px(x), cy = this._px(y);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.42)";
    ctx.shadowBlur = rad * 0.55;
    ctx.shadowOffsetY = rad * 0.22;

    const g = ctx.createRadialGradient(
      cx - rad * 0.34, cy - rad * 0.36, rad * 0.12,
      cx, cy, rad * 1.06
    );
    if (color === 1) {
      g.addColorStop(0, "#6a6f78");
      g.addColorStop(0.42, "#26292e");
      g.addColorStop(1, "#08090b");
    } else {
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.55, "#f3f4f6");
      g.addColorStop(1, "#c9ccd2");
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 白子描边，避免在浅木色上糊掉
    if (color === 2) {
      ctx.strokeStyle = "rgba(120,110,95,.5)";
      ctx.lineWidth = Math.max(0.8, rad * 0.05);
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/* ============================== SocketIO ============================== */

let socket = null;

function setConn(text, on) {
  const t = $("#connText"), d = $("#dot");
  if (t) t.textContent = text;
  if (d) d.classList.toggle("on", !!on);
}

function initSocket(onEvent) {
  if (typeof io === "undefined") {
    setConn("离线模式（未加载 Socket.IO）", false);
    return;
  }
  try {
    socket = io(API_BASE || undefined, { transports: ["websocket", "polling"], reconnectionDelayMax: 4000 });
  } catch (e) {
    setConn("离线模式（连接失败）", false);
    return;
  }

  socket.on("connect", () => setConn("已连接", true));
  socket.on("disconnect", () => setConn("已断开", false));
  socket.on("connect_error", () => setConn("连接失败", false));
  socket.on("hello", () => setConn("已连接", true));

  const events = ["ai_done", "tuner_progress", "tuner_done"];
  for (const name of events) {
    socket.on(name, (payload) => {
      try {
        onEvent(name, payload);
      } catch (e) {
        console.error(name, e);
      }
    });
  }
}

/* ============================== 页面：人机对弈 ============================== */

function pageLocal() {
  const view = new BoardView($("#board"));
  let state = null;
  let busy = false;

  function setThinking(on) {
    $("#thinking").classList.toggle("hidden", !on);
    busy = !!on;
    view.setInteractive(!on);
  }

  function showAnalysis(a) {
    const box = $("#analysis");
    box.innerHTML = "";
    if (!a) { box.textContent = "等待落子…"; return; }

    const rows = [
      ["落点", a.move ? `(${a.move.x}, ${a.move.y})` : "—"],
      ["得分", fmt(a.score, 0)],
      ["深度", fmt(a.depth)],
      ["节点", fmt(a.nodes)],
      ["耗时", a.elapsed_ms === undefined ? "—" : `${fmt(a.elapsed_ms, 1)} ms`],
      ["来源", a.reason || "—"],
    ];
    const t = a.threats || {};
    rows.push(["我方成五点", (t.my_five_points || []).length]);
    rows.push(["对方成五点", (t.opp_five_points || []).length]);
    rows.push(["我方双威胁", (t.my_double_threats || []).length]);
    rows.push(["对方双威胁", (t.opp_double_threats || []).length]);

    for (const [k, v] of rows) {
      const line = el("div", "");
      line.appendChild(el("span", "k", k + "："));
      line.appendChild(el("span", "v", v));
      box.appendChild(line);
    }
    if (a.pv && a.pv.length) {
      const pv = a.pv.map((p) => `(${p.x},${p.y})`).join(" → ");
      const line = el("div", "");
      line.appendChild(el("span", "k", "主变："));
      line.appendChild(el("span", "v", pv));
      box.appendChild(line);
    }
  }

  function render(st) {
    if (!st) return;
    state = st;
    view.setSize(st.size);
    view.setState(st);

    $("#turnBadge").textContent = st.over ? "已结束" : `轮到 ${COLOR_NAME[st.side]}方`;
    $("#stoneCount").textContent = `${st.stones} 子`;

    const list = $("#moves");
    list.innerHTML = "";
    for (let i = 0; i < st.moves.length; i++) {
      const m = st.moves[i];
      const li = el("li", m.by === "ai" || m.by === "sync" ? "ai" : "",
                    `${i + 1}. ${COLOR_NAME[m.color]} (${m.x},${m.y})`);
      list.appendChild(li);
    }
    list.scrollTop = list.scrollHeight;

    const res = $("#result");
    if (st.over) {
      res.classList.remove("hidden", "win", "lose", "draw");
      if (st.winner === 0) {
        res.classList.add("draw");
        res.textContent = "平局（棋盘已满）";
      } else if (st.winner === st.human_color) {
        res.classList.add("win");
        res.textContent = "你赢了！";
      } else {
        res.classList.add("lose");
        res.textContent = "你输了。";
      }
    } else {
      res.classList.add("hidden");
    }

    // 该 AI 走时自动应手
    if (!st.over && st.side !== st.human_color && !busy) {
      setTimeout(() => aiTurn(), 60);
    }

    renderLearn(st);
  }

  async function newGame() {
    setThinking(false);
    const r = await api("/api/local/new", {
      human_color: Number($("#humanColor").value),
      level: Number($("#level").value),
      size: Number($("#boardSize").value),
      rules: $("#rules").value,
    });
    showAnalysis(null);
    render(r.state);
  }

  async function humanMove(x, y) {
    if (busy) return;
    const r = await api("/api/local/move", { x, y });
    if (!r.ok) return;
    render(r.state);
    showAnalysis(null);
  }

  async function aiTurn() {
    if (busy) return;
    setThinking(true);
    try {
      const r = await api("/api/local/ai", {});
      if (r.state) render(r.state);
      if (r.analysis) showAnalysis(r.analysis);
    } catch (e) {
      console.error(e);
    } finally {
      setThinking(false);
    }
  }

  async function undo() {
    if (busy) return;
    const r = await api("/api/local/undo", { steps: 2 });
    if (r.state) render(r.state);
    showAnalysis(null);
  }

  async function hint() {
    if (busy) return;
    const r = await api("/api/local/hint", {});
    if (r.analysis) showAnalysis(r.analysis);
  }

  function renderLearn(st) {
    const box = $("#learnStatus");
    const learn = st && st.learn;
    if (!box) return;
    box.innerHTML = "";
    if (!learn) { box.textContent = "学习状态：—"; return; }
    const rows = [
      ["学习", learn.enabled ? "开启" : "关闭"],
    ];
    if (learn.params) {
      rows.push(["防守权重", fmt(learn.params["eval.defense_weight"], 3)]);
      rows.push(["排序防守", fmt(learn.params["search.sort_defense"], 3)]);
    }
    if (learn.last) {
      const last = learn.last;
      rows.push(["最近一局", ({ win: "胜", lose: "负", draw: "和" })[last.outcome] || "—"]);
      if (last.changed) {
        rows.push(["调整", `${fmt(last.before["eval.defense_weight"], 3)} → ${fmt(last.after["eval.defense_weight"], 3)}`]);
      }
    }
    for (const [k, v] of rows) {
      const line = el("div", "");
      line.appendChild(el("span", "k", k + "："));
      line.appendChild(el("span", "v", v));
      box.appendChild(line);
    }
  }

  async function toggleLearn() {
    const on = $("#learnToggle").checked;
    const r = await api("/api/local/learn", { enabled: on });
    if (r && r.enabled !== undefined) {
      $("#learnToggle").checked = r.enabled;
    }
  }

  async function resign() {
    if (!state || state.over) return;
    if (!confirm("确定要认输吗？")) return;
    const res = $("#result");
    res.classList.remove("hidden", "win", "draw");
    res.classList.add("lose");
    res.textContent = "你认输了。";
    view.setInteractive(false);
  }

  view.onClick(humanMove);
  $("#btnNew").addEventListener("click", newGame);
  $("#btnUndo").addEventListener("click", undo);
  $("#btnHint").addEventListener("click", hint);
  $("#btnResign").addEventListener("click", resign);
  $("#learnToggle").addEventListener("change", toggleLearn);

  // 读取学习开关初始状态
  api("/api/local/learn").then((r) => {
    if (r && r.enabled !== undefined) {
      $("#learnToggle").checked = r.enabled;
    }
  }).catch(() => {});

  initSocket((name, payload) => {
    if (name === "ai_done") {
      setThinking(false);
      if (payload && payload.state) render(payload.state);
      if (payload && payload.analysis) showAnalysis(payload.analysis);
    }
  });

  // 首次进入：若服务端已有对局就接上，否则开新局
  api("/api/local/state").then((r) => {
    if (r && r.state && r.state.size) {
      view.setSize(r.state.size);
      render(r.state);
    } else {
      newGame();
    }
  }).catch(() => newGame());
}

/* ============================== 页面：落地页 ============================== */

function pageLanding() {
  // 背景迷你棋盘：画一个空的木纹棋盘当 hero 背景
  const host = $("#miniBoard");
  if (host) {
    const view = new BoardView(host);
    view.setSize(15);
    view.setInteractive(false);
  }
  initSocket(() => {});
}

/* ============================== 页面：模式选择 ============================== */

function pageHub() {
  initSocket(() => {});
}

/* ============================== 实验室彩蛋 ============================== */

const LAB_TOKEN_KEY = "gomoku_lab_token";

function installEasterEgg() {
  // 版本号连点 5 次 → 跳实验室。彩蛋只负责隐蔽，真锁在后端 token。
  const ver = $("#ver");
  if (!ver) return;
  let clicks = 0;
  let first = 0;
  ver.style.cursor = "pointer";
  ver.addEventListener("click", () => {
    const now = Date.now();
    if (now - first > 1600) { clicks = 0; first = now; }
    clicks += 1;
    if (clicks >= 5) {
      clicks = 0;
      location.href = pageHref("lab");
      return;
    }
    ver.classList.add("hot");
    setTimeout(() => ver.classList.remove("hot"), 300);
  });
}

/* ============================== 页面：实验室 ============================== */

function pageLab() {
  let unlocked = false;

  function lock(on) {
    unlocked = !on;
    $("#labLock").classList.toggle("hidden", !on);
    $("#labMain").classList.toggle("hidden", on);
  }

  function addLog(text, kind) {
    const box = $("#log");
    const line = el("div", "l" + (kind ? " " + kind : ""), text);
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
    while (box.childElementCount > 400) box.removeChild(box.firstChild);
  }

  function token() {
    return localStorage.getItem(LAB_TOKEN_KEY) || "";
  }

  async function tryUnlock() {
    const t = $("#labToken").value.trim();
    const msg = $("#lockMsg");
    msg.textContent = "验证中…";
    let r;
    try {
      r = await api("/api/lab/unlock", { token: t });
    } catch (e) {
      msg.textContent = "连接失败，请确认服务在运行";
      return;
    }
    if (r.ok) {
      localStorage.setItem(LAB_TOKEN_KEY, t);
      lock(false);
      loadStatus();
    } else {
      msg.textContent = r.reason || "口令错误";
    }
  }

  async function loadStatus() {
    const r = await api("/api/tuner/status");
    $("#state").textContent = r.running ? "running" : "idle";
    $("#state").className = "badge" + (r.running ? " live" : "");

    const space = $("#space");
    space.innerHTML = "";
    for (const [name, v] of Object.entries(r.space || {})) {
      const line = el("div", "");
      line.appendChild(el("span", "k", name + "："));
      line.appendChild(el("span", "v", `${v.min} ~ ${v.max}${v.int ? "（整数）" : ""}`));
      space.appendChild(line);
    }

    if (r.result && r.result.best) {
      $("#best").textContent = JSON.stringify(r.result.best, null, 2);
    }

    refreshGames();
  }

  async function refreshGames() {
    try {
      const r = await api("/api/lab/games", { token: token() });
      if (r.ok) {
        $("#gamesCount").textContent = `已收集 ${r.count} 局`;
      }
    } catch (e) {
      // 无数据或未解锁时静默
    }
  }

  async function exportGames() {
    const msg = $("#gamesMsg");
    msg.textContent = "读取中…";
    let r;
    try {
      r = await api("/api/lab/games", { token: token() });
    } catch (e) {
      msg.textContent = "连接失败";
      return;
    }
    if (!r.ok) {
      msg.textContent = r.reason || "需要实验室口令";
      return;
    }
    if (!r.text) {
      msg.textContent = "还没有可导出的对局";
      return;
    }
    const blob = new Blob([r.text], { type: "application/x-ndjson;charset=utf-8" });
    const a = el("a", "");
    a.href = URL.createObjectURL(blob);
    a.download = `games-${new Date().toISOString().slice(0, 10)}.jsonl`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    msg.textContent = `已导出 ${r.count} 局`;
  }

  async function start() {
    const method = $("#method").value;
    $("#log").innerHTML = "";
    $("#best").textContent = "—";
    $("#result").textContent = "运行中…";
    addLog(`开始 ${method} 调参…`, "ok");
    const r = await api("/api/tuner/start", {
      method,
      rounds: Number($("#rounds").value),
      iterations: Number($("#iterations").value),
      time_budget: Number($("#timeBudget").value),
      max_depth: Number($("#maxDepth").value),
      token: token(),
    });
    if (!r.ok) {
      addLog(`启动失败：${r.reason || ""}`, "err");
      $("#state").textContent = "idle";
      return;
    }
    $("#state").textContent = "running";
    $("#state").className = "badge live";
    $("#msg").textContent = "运行中";
  }

  async function stop() {
    await api("/api/tuner/stop", { token: token() });
    addLog("已请求停止…", "warn");
  }

  async function bench() {
    addLog("跑基准对局…");
    const r = await api("/api/tuner/benchmark", { rounds: 2, token: token() });
    if (r.ok && r.result) {
      const rate = r.result.rate_vs_default;
      addLog(`基准对局完成：对默认参数胜率 ${fmt(rate, 3)}`, "ok");
      $("#result").innerHTML = "";
      const line = el("div", "");
      line.appendChild(el("span", "k", "对默认参数胜率："));
      line.appendChild(el("span", "v", fmt(rate, 3)));
      $("#result").appendChild(line);
    }
  }

  $("#btnUnlock").addEventListener("click", tryUnlock);
  $("#labToken").addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryUnlock();
  });
  $("#btnStart").addEventListener("click", start);
  $("#btnStop").addEventListener("click", stop);
  $("#btnBench").addEventListener("click", bench);
  $("#btnExportGames").addEventListener("click", exportGames);

  initSocket((name, payload) => {
    if (name === "tuner_progress" && payload) {
      const bits = [payload.phase || ""];
      if (payload.round !== undefined) bits.push(`第 ${payload.round}/${payload.rounds} 局`);
      if (payload.rate !== undefined) bits.push(`胜率 ${fmt(payload.rate, 3)}`);
      if (payload.a_wins !== undefined) {
        bits.push(`${payload.a_wins}:${payload.b_wins}`);
      }
      addLog(bits.filter(Boolean).join(" · "));
      $("#elapsed").textContent = payload.t || "";
    }
    if (name === "tuner_done" && payload) {
      $("#state").textContent = payload.ok ? "完成" : "出错";
      $("#state").className = "badge" + (payload.ok ? "" : " err");
      $("#msg").textContent = payload.ok ? "已完成" : (payload.reason || "失败");
      if (payload.ok) {
        addLog("调参完成", "ok");
        if (payload.best) $("#best").textContent = JSON.stringify(payload.best, null, 2);
        $("#result").innerHTML = "";
        if (payload.file) {
          const line = el("div", "");
          line.appendChild(el("span", "k", "结果文件："));
          line.appendChild(el("span", "v", payload.file));
          $("#result").appendChild(line);
        }
        if (payload.config) {
          const line = el("div", "");
          line.appendChild(el("span", "k", "完整参数："));
          line.appendChild(el("span", "v", "见 result 文件"));
          $("#result").appendChild(line);
        }
      } else {
        addLog(`出错：${payload.reason || ""}`, "err");
      }
    }
  });

  // 已解锁过（localStorage 有 token）就直接进，否则显示锁
  if (token()) {
    lock(false);
    loadStatus();
  } else {
    lock(true);
  }
}

/* ============================== 启动分发 ============================== */

document.addEventListener("DOMContentLoaded", () => {
  // 所有页面都装彩蛋（版本号连点进实验室）
  installEasterEgg();

  const page = window.PAGE;
  try {
    if (page === "landing") pageLanding();
    else if (page === "hub") pageHub();
    else if (page === "local") pageLocal();
    else if (page === "lab") pageLab();
    else setConn("未知页面", false);
  } catch (e) {
    console.error("页面初始化失败", e);
    setConn("初始化失败", false);
  }
});
