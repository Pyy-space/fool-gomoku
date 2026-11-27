/* 连珠禁手 UI 冒烟：CDP 驱动真实 headless Chrome
 * 验证 ①禁手点被画到棋盘上 ②点禁手点给出具体原因
 */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const PORT = 9355;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-renju-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = "http://127.0.0.1:8897/web/local.html?debug=1";

async function getJSON(p) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (r.ok) return await r.json(); }
    catch (e) { }
    await sleep(250);
  }
  throw new Error("cdp down");
}

(async () => {
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--window-size=900,1000", URL_], { stdio: "ignore" });
  process.on("exit", () => { try { chrome.kill(); } catch (e) { } });

  await getJSON("/json/version");
  let page = null;
  for (let i = 0; i < 40 && !page; i++) {
    const t = await getJSON("/json/list");
    page = t.find(x => x.type === "page");
    if (!page) await sleep(250);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const waiters = new Map(); const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") {
      logs.push("EXC " + ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text));
    }
  };
  const send = (method, params) => new Promise(res => {
    const i = ++id; waiters.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  await new Promise(r => { ws.onopen = r; });
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__DEBUG_GOMOKU=true;" });
  await send("Page.reload");
  await sleep(2500);

  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { err: ((r.result.exceptionDetails.exception || {}).description) };
    return r.result && r.result.result ? r.result.result.value : null;
  };

  /* 1. 切连珠 + 开新局 */
  const setup = await ev(`(async()=>{
    const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
    const sel=document.querySelector("#rules");
    sel.value="renju"; sel.dispatchEvent(new Event("change"));
    document.querySelector("#btnNew").click();
    await sleep(500);
    return {rules:sel.value, forbids: window.__view? window.__view.forbids.length : "no-view"};
  })()`);
  console.log("setup:", JSON.stringify(setup));

  /* 2. 人工铺一个「黑四连 3..6 → 2 和 7 都是长连点」的局面：
        先点天元，AI 应手后再连点造四连不方便，改用页面内直接构造 */
  const built = await ev(`(async()=>{
    const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
    const E = window.GomokuEngine;
    const b = window.__board();
    // 直接改写内部棋盘：铺一排黑子 + 两个白子避免 AI 立即结束
    b.grid.fill(0); b.moves.length = 0; b.side = 1; b._n = 0;
    const put=(x,y,c)=>{ b.placeColor(x,y,c); };
    // 双三局面：竖 6,5 6,6 + 横 7,7 8,7，落 6,7 同时形成两个活三 => 双三禁手
    [[6,5],[6,6],[7,7],[8,7]].forEach(p=>put(p[0],p[1],1));
    // 长连局面：2,2 3,2 4,2 + 6,2 7,2 8,2，落 5,2 成七连 => 长连禁手
    [[2,2],[3,2],[4,2],[6,2],[7,2],[8,2]].forEach(p=>put(p[0],p[1],1));
    [[0,0],[14,14],[0,14],[14,0]].forEach(p=>put(p[0],p[1],2));
    b.side = 1;
    window.__draw();
    await sleep(300);
    return {stones:b.stoneCount, side:b.side, forbids:window.__view.forbids.map(f=>f.x+","+f.y+":"+f.reason)};
  })()`);
  console.log("built:", JSON.stringify(built));

  /* 3. 点一个禁手点，看提示文案 */
  const clickForbid = await ev(`(async()=>{
    const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
    const c=document.querySelector("#board canvas");
    const rect=c.getBoundingClientRect();
    const box=Math.min(rect.width,rect.height);
    const pad=Math.max(14,box*0.058), step=(box-pad*2)/14;
    const f=window.__view.forbids[0];
    if(!f) return "no-forbid";
    c.dispatchEvent(new MouseEvent("click",{bubbles:true,
      clientX:rect.left+pad+f.x*step, clientY:rect.top+pad+f.y*step}));
    await sleep(400);
    return {clicked:f.x+","+f.y, persona:document.querySelector("#persona").textContent};
  })()`);
  console.log("clickForbid:", JSON.stringify(clickForbid));

  /* 4. 截图 */
  const shot = await send("Page.captureScreenshot", { format: "png" });
  if (shot.result && shot.result.data) {
    fs.mkdirSync("output/shots", { recursive: true });
    fs.writeFileSync("output/shots/renju_forbidden.png", Buffer.from(shot.result.data, "base64"));
    console.log("screenshot: output/shots/renju_forbidden.png");
  }

  console.log("errors:", JSON.stringify(logs));
  ws.close(); process.exit(0);
})().catch(e => { console.error("FAIL", e.message); process.exit(1); });



