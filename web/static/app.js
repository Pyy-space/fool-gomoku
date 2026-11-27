/* 惜江悅的小助手 —— 前端（纯静态，棋力全在浏览器里算）

 * 页面分发靠 <body> 前的 window.PAGE：landing / local。
 * 引擎在 engine.js（window.GomokuEngine），台词在 persona.js（window.Persona）。
 * 搜索跑在 worker.js（Web Worker）里，主线程不卡。
 * 每局结束把棋谱 POST 到后端 /api/games，给实验室攒数据。
 */

/* ============================== 小工具 ============================== */

const $ = (sel) => document.querySelector(sel);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

function fmt(v, digits) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  return digits === undefined ? String(n) : n.toFixed(digits);
}

const COLOR_NAME = { 0: "空", 1: "黑", 2: "白" };
const E = window.GomokuEngine;
const API_BASE = (window.API_BASE || "").replace(/\/+$/, "");

/* app.js 所在目录。Worker 用它拼路径，页面放在子目录里也不会 404。 */
const SCRIPT_BASE = (function () {
  const s = document.currentScript;
  if (s && s.src) return s.src.replace(/[^/]*$/, "");
  return "static/";
})();

/* ============================== 搜索线程 ============================== */

/** 把搜索丢进 Web Worker，返回 Promise。主线程不再被 5 秒的搜索冻住。 */
const SearchWorker = (function () {
  let worker = null;
  let seq = 0;
  const pending = new Map();

  function ensure() {
    if (worker) return worker;
    worker = new Worker(SCRIPT_BASE + "worker.js");
    worker.onmessage = (ev) => {
      const p = pending.get(ev.data && ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      p(ev.data);
    };
    worker.onerror = (err) => {
      // 出错了就把所有等待中的请求都失败掉，避免界面一直转圈
      for (const [id, p] of pending) p({ id, ok: false, reason: "线程出错：" + (err.message || "") });
      pending.clear();
    };
    return worker;
  }

  function run(job) {
    const w = ensure();
    const id = ++seq;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      w.postMessage(Object.assign({ id }, job));
    });
  }

  return { run };
})();

/* ============================== 棋盘渲染 ============================== */

class BoardView {
  /** canvas 棋盘。坐标 x 向右、y 向下，与引擎一致。 */
  constructor(host) {
    this.host = host;
    this.size = 15;
    this.grid = [];
    this.last = null;
    this.side = 1;
    this.interactive = true;
    this.hover = null;
    this.hint = null;
    this.forbids = [];
    this._clickCb = null;

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

  setHint(p) {
    const same = (!!p === !!this.hint) ||
      (p && this.hint && p.x === this.hint.x && p.y === this.hint.y);
    if (same) return;
    this.hint = p;
    this._draw();
  }

  clearHint() { this.setHint(null); }

  /** 禁手点列表 [{x,y,reason,text}]，在棋盘上画叉。 */
  setForbidden(list) {
    const a = list || [];
    if (a.length === this.forbids.length) {
      let same = true;
      for (let i = 0; i < a.length; i++) {
        const p = a[i], q = this.forbids[i];
        if (!q || p.x !== q.x || p.y !== q.y) { same = false; break; }
      }
      if (same) return;
    }
    this.forbids = a;
    this._draw();
  }

  clearForbidden() { this.setForbidden([]); }

  onClick(cb) { this._clickCb = cb; }

  _px(x) { return this.pad + x * this.step; }

  _nearest(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const x = Math.round((px - this.pad) / this.step);
    const y = Math.round((py - this.pad) / this.step);
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return null;
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

  _starPoints() {
    const n = this.size;
    if (n === 19) {
      const p = [];
      for (const y of [3, 9, 15]) for (const x of [3, 9, 15]) p.push([x, y]);
      return p;
    }
    if (n === 15) return [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]];
    if (n === 13) return [[3, 3], [9, 3], [3, 9], [9, 9], [6, 6]];
    return [];
  }

  _draw() {
    const ctx = this.ctx;
    const box = this.box;
    const n = this.size;
    if (!box) return;

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

    ctx.fillStyle = "rgba(45,30,14,.82)";
    const r = Math.max(2, this.step * 0.075);
    for (const [x, y] of this._starPoints()) {
      ctx.beginPath();
      ctx.arc(this._px(x), this._px(y), r, 0, Math.PI * 2);
      ctx.fill();
    }

    const rad = this.step * 0.44;
    for (let i = 0; i < this.grid.length; i++) {
      const c = this.grid[i];
      if (!c) continue;
      this._stone(i % n, Math.floor(i / n), c, rad);
    }

    // 禁手点：红叉 + 半透明红圈，一眼能看出"这些地方不能下"。
    if (this.forbids && this.forbids.length) {
      for (const f of this.forbids) {
        const i = f.y * n + f.x;
        if (this.grid[i]) continue;
        this._forbidMark(f.x, f.y, rad);
      }
    }

    if (this.last) {
      const cx = this._px(this.last.x), cy = this._px(this.last.y);
      ctx.strokeStyle = "#e5484d";
      ctx.lineWidth = Math.max(1.6, this.step * 0.055);
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (this.interactive && this.hover) {
      const i = this.hover.y * n + this.hover.x;
      if (!this.grid[i]) {
        ctx.save();
        ctx.globalAlpha = 0.38;
        this._stone(this.hover.x, this.hover.y, this.side, rad);
        ctx.restore();
      }
    }

    if (this.hint) {
      const i = this.hint.y * n + this.hint.x;
      if (!this.grid[i]) this._hintGhost(this.hint.x, this.hint.y, this.side, rad);
    }
  }

  // 禁手标记：红色圆环 + 中间红叉。比小圆点醒目，又不至于盖住格子。
  _forbidMark(x, y, rad) {
    const ctx = this.ctx;
    const cx = this._px(x), cy = this._px(y);
    const r = rad * 0.82;

    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#c8323c";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "#c8323c";
    ctx.lineWidth = Math.max(1.4, rad * 0.12);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    const d = r * 0.52;
    ctx.beginPath();
    ctx.moveTo(cx - d, cy - d);
    ctx.lineTo(cx + d, cy + d);
    ctx.moveTo(cx + d, cy - d);
    ctx.lineTo(cx - d, cy + d);
    ctx.stroke();
    ctx.restore();
  }

  // 提示虚影：金色半透明棋子 + 呼吸光环，和鼠标 hover 的灰影区分开。
  _hintGhost(x, y, color, rad) {
    const ctx = this.ctx;
    const cx = this._px(x), cy = this._px(y);

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#f4c47f";
    ctx.lineWidth = Math.max(1.6, rad * 0.14);
    ctx.beginPath();
    ctx.arc(cx, cy, rad * 1.12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.55;
    this._stone(x, y, color, rad * 0.94);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#f4c47f";
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(2, rad * 0.16), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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

    if (color === 2) {
      ctx.strokeStyle = "rgba(120,110,95,.5)";
      ctx.lineWidth = Math.max(0.8, rad * 0.05);
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/* ============================== 人机对弈 ============================== */

function pageLocal() {
  const view = new BoardView($("#board"));
  // 自检脚本用 ?debug=1 打开页面即可拿到视图实例。正常访问不暴露任何东西。
  if (window.__DEBUG_GOMOKU || /[?&]debug=1/.test(location.search)) {
    window.__view = view;
    window.__board = () => board;
    window.__draw = () => draw();
  }
  const P = window.Persona;

  let board = null;         // GomokuEngine.Board
  let learner = null;
  let humanColor = 1;
  let level = 2;
  let rules = "casual";
  let busy = false;
  let over = false;
  let reported = false;

  const els = {
    turn: $("#turnBadge"),
    stones: $("#stoneCount"),
    thinking: $("#thinking"),
    result: $("#result"),
    persona: $("#persona"),
    moves: $("#moves"),
    analysis: $("#analysis"),
    learn: $("#learnStatus"),
  };

  function setThinking(on, text) {
    busy = !!on;
    els.thinking.classList.toggle("hidden", !on);
    if (on && text) els.thinking.childNodes[0].nodeValue = text;
    view.setInteractive(!on && !over);
  }

  /* ---------- 台词 ---------- */
  function say(sp, kind) {
    if (!els.persona) return;
    // sp 可能是对象（{name,title,avatar,hue,text}）或纯字符串，兼容两者
    const o = (sp && typeof sp === "object") ? sp : { text: String(sp) };
    els.persona.innerHTML = "";
    if (o.avatar) {
      const av = el("span", "p-avatar");
      av.textContent = o.avatar;
      av.style.background =
        "linear-gradient(135deg," + (o.hue || "#e2a458") + ", #3a3f4a)";
      els.persona.appendChild(av);
    }
    const body = el("span", "p-body");
    if (o.name) {
      const who = el("span", "p-who", o.name);
      if (o.title) who.appendChild(el("span", "p-title", " · " + o.title));
      body.appendChild(who);
    }
    body.appendChild(el("span", "p-text", o.text));
    els.persona.appendChild(body);

    els.persona.className = "persona" + (kind ? " " + kind : "");
    els.persona.classList.remove("hidden");
    els.persona.style.animation = "none";
    void els.persona.offsetWidth;
    els.persona.style.animation = "";
  }

  /* ---------- 渲染 ---------- */
  function refreshForbidden() {
    // 只有「连珠 + 轮到黑方」时才需要标禁手，其余情况标出来只会干扰视线。
    const BLACK = E.BLACK === undefined ? 1 : E.BLACK;
    if (!board || over || rules !== "renju" || board.side !== BLACK) {
      view.clearForbidden();
      return;
    }
    if (E.forbiddenPoints) {
      view.setForbidden(E.forbiddenPoints(board));
    } else {
      view.clearForbidden();
    }
  }

  function draw() {
    if (!board) return;
    view.setSize(board.size);
    view.setState({
      size: board.size,
      grid: board.toList(),
      last: board.lastMove(),
      side: board.side,
    });

    els.turn.textContent = over ? "已结束"
      : board.side === humanColor ? `轮到你（${COLOR_NAME[humanColor]}）`
      : `${P.NAME}落子中`;
    els.turn.className = "badge" + (!over && board.side !== humanColor ? " think" : "");
    els.stones.textContent = `${board.stoneCount} 子`;

    const list = els.moves;
    list.innerHTML = "";
    board.moves.forEach((m, i) => {
      const isMe = m.color === humanColor;
      list.appendChild(el("li", isMe ? "" : "ai",
        `${i + 1}. ${COLOR_NAME[m.color]} (${m.x},${m.y})`));
    });
    list.scrollTop = list.scrollHeight;

    refreshForbidden();
    drawLearn();
  }

  function drawLearn() {
    if (!els.learn) return;
    els.learn.innerHTML = "";
    if (!learner) { els.learn.textContent = "学习：关闭"; return; }
    const s = learner.snapshot();
    for (const [k, v] of [["防守权重", fmt(s["eval.defense_weight"], 3)],
                          ["排序防守", fmt(s["search.sort_defense"], 3)]]) {
      const line = el("div", "");
      line.appendChild(el("span", "k", k + "："));
      line.appendChild(el("span", "v", v));
      els.learn.appendChild(line);
    }
  }

  function showAnalysis(a) {
    const box = els.analysis;
    box.innerHTML = "";
    if (!a) { box.textContent = "等待落子…"; return; }
    const rows = [
      ["落点", a.move ? `(${a.move.x}, ${a.move.y})` : "—"],
      ["得分", fmt(a.score, 0)],
      ["深度", fmt(a.depth)],
      ["节点", fmt(a.nodes)],
      ["耗时", `${fmt(a.elapsed_ms, 1)} ms`],
      ["来源", a.reason || "—"],
    ];
    const t = a.threats || {};
    rows.push(["我方成五点", (t.my_five_points || []).length]);
    rows.push(["对方成五点", (t.opp_five_points || []).length]);
    rows.push(["对方双威胁", (t.opp_double_threats || []).length]);
    for (const [k, v] of rows) {
      const line = el("div", "");
      line.appendChild(el("span", "k", k + "："));
      line.appendChild(el("span", "v", v));
      box.appendChild(line);
    }
  }

  /* ---------- 与搜索线程通信 ---------- */
  function askEngine(mode) {
    return SearchWorker.run({
      mode: mode,
      size: board.size,
      rules: rules,
      level: level,
      config: learner ? {
        defense_weight: learner.params.defense_weight,
        sort_defense: learner.params.sort_defense,
      } : null,
      moves: board.moves,
    });
  }

  /* ---------- 对局流程 ---------- */
  function newGame() {
    over = false;
    reported = false;
    humanColor = Number($("#humanColor").value);
    const size = Number($("#boardSize").value);
    rules = $("#rules").value;
    level = Number($("#level").value);

    learner = $("#learnToggle").checked
      ? (E.Learner.load ? E.Learner.load() : new E.Learner()) : null;

    board = new E.Board(size, rules);

    els.result.classList.add("hidden");
    els.persona.classList.add("hidden");
    view.clearHint();
    showAnalysis(null);
    setThinking(false);
    draw();

    if (board.side !== humanColor) scheduleAi();  // 人执白，AI 先下
  }

  function humanMove(x, y) {
    if (busy || over || !board) return;
    if (board.side !== humanColor) return;
    if (!E.isLegal(board, x, y)) {
      // 禁手要说清楚是哪一种，玩家才知道自己错在哪。
      const why = E.forbiddenReason ? E.forbiddenReason(board, x, y) : null;
      if (why && E.FORBIDDEN_TEXT) {
        say("这儿是" + (E.FORBIDDEN_TEXT[why] || "禁手") + "，下不得。", "warn");
      } else {
        say("这儿不能下。", "warn");
      }
      return;
    }
    board.place(x, y);
    view.clearHint();
    draw();
    if (checkEnd()) return;
    scheduleAi();
  }

  function scheduleAi() {
    if (over) return;
    setThinking(true, P.think().text);
    // 给浏览器一帧时间把「正在想」画出来，再开始算
    setTimeout(aiMove, 40);
  }

  function aiMove() {
    if (over || !board) { setThinking(false); return; }
    const started = Date.now();
    askEngine("move").then((r) => {
      if (!board || over) { setThinking(false); return; }
      if (!r || !r.ok || !r.move) {
        setThinking(false);
        say("算不出来了，你赢了。", "warn");
        return;
      }
      board.place(r.move.x, r.move.y);
      view.clearHint();
      const wait = Math.max(0, 240 - (Date.now() - started));
      setTimeout(() => {
        setThinking(false);
        draw();
        showAnalysis(r);
        if (!checkEnd() && Math.random() < 0.35) say(P.taunt(), "taunt");
      }, wait);
    });
  }

  function checkEnd() {
    const w = board.winner();
    if (!w && !board.isFull) return false;
    over = true;
    setThinking(false);
    view.setInteractive(false);

    let outcome;
    if (w === 0) outcome = "draw";
    else if (w === humanColor) outcome = "win";
    else outcome = "lose";

    els.result.classList.remove("hidden", "win", "lose", "draw");
    els.result.classList.add(outcome);
    els.result.textContent = outcome === "win" ? "你赢了"
      : outcome === "lose" ? "你输了" : "平局";

    say(P.line(outcome), outcome);
    if (learner) {
      const aiColor = humanColor === 1 ? 2 : 1;
      const r = learner.applyOutcome(w, aiColor, board.moves);
      if (r.changed) drawLearn();
    }
    reportGame(w);
    return true;
  }

  /* ---------- 棋谱上报 ---------- */
  function reportGame(winner) {
    if (reported || !API_BASE) return;
    reported = true;
    const body = {
      size: board.size,
      rules: rules,
      human_color: humanColor,
      winner: winner,
      moves: board.moves,
      config: learner ? learner.snapshot() : {},
    };
    fetch(API_BASE + "/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json()).then((d) => {
      if (d && d.ok) {
        const f = document.querySelector(".foot");
        if (f) f.textContent = `这局已记录（第 ${d.count} 局）· 纯前端 · 引擎跑在你的浏览器里`;
      }
    }).catch(() => { /* 断网就算了，不打扰玩家 */ });
  }

  /* ---------- 侧栏按钮 ---------- */
  function saveRecord() {
    if (!board || board.moves.length === 0) {
      say("这局还没落子，没东西可存。", "warn");
      return;
    }
    const body = {
      size: board.size,
      rules: rules,
      human_color: humanColor,
      winner: board.winner(),
      moves: board.moves,
      config: learner ? learner.snapshot() : {},
    };
    const text = JSON.stringify(body, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gomoku_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    say(P.hint(), "hint");
  }

  function undo() {
    if (busy) return;
    const n = board.moves.length;
    for (let i = 0; i < 2 && board.moves.length; i++) board.undo();
    over = false;
    reported = false;
    els.result.classList.add("hidden");
    view.clearHint();
    setThinking(false);
    draw();
    showAnalysis(null);
    if (board.moves.length < n) say(P.undo(), "warn");
    if (board.side !== humanColor) scheduleAi();
  }

  function hint() {
    if (busy || over || !board) return;
    setThinking(true, "让我看看…");
    askEngine("hint").then((r) => {
      setThinking(false);
      if (!r || !r.ok) return;
      showAnalysis(r);
      if (r.move) {
        view.setHint({ x: r.move.x, y: r.move.y });
        say(P.hint(), "hint");
      }
    });
  }

  function resign() {
    if (!board || over) return;
    if (!confirm("认输？")) return;
    over = true;
    setThinking(false);
    view.setInteractive(false);
    els.result.classList.remove("hidden", "win", "draw");
    els.result.classList.add("lose");
    els.result.textContent = "你认输了";
    say(P.line("lose"), "lose");
    const aiColor = humanColor === 1 ? 2 : 1;
    if (learner) {
      learner.applyOutcome(aiColor, aiColor, board.moves);
      drawLearn();
    }
    reportGame(aiColor);   // 认输也算一局，胜负记在 AI 头上
  }

  /* ---------- 绑定 ---------- */
  view.onClick(humanMove);
  $("#btnNew").addEventListener("click", newGame);
  $("#btnUndo").addEventListener("click", undo);
  $("#btnHint").addEventListener("click", hint);
  $("#btnResign").addEventListener("click", resign);
  $("#btnSave").addEventListener("click", saveRecord);
  $("#learnToggle").addEventListener("change", (e) => {
    if (!e.target.checked) { learner = null; drawLearn(); }
  });

  newGame();
}

/* ============================== 落地页 ============================== */

function pageLanding() {
  const host = $("#miniBoard");
  if (host) {
    const view = new BoardView(host);
    view.setSize(15);
    view.setInteractive(false);
  }
}

/* ============================== 启动 ============================== */

document.addEventListener("DOMContentLoaded", () => {
  const page = window.PAGE;
  try {
    if (page === "landing") pageLanding();
    else if (page === "local") pageLocal();
  } catch (e) {
    console.error("页面初始化失败", e);
  }
});
