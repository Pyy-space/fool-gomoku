/* 用 CDP 驱动真实（非虚拟时间）headless Chrome，读取页面里的 #out 文本。
 * 用法：node tools/_cdp_probe.js <url> [waitMs]
 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const URL_ = process.argv[2] || "http://127.0.0.1:8899/_workerprobe.html";
const WAIT = Number(process.argv[3] || 8000);
const SEL = process.argv[4] || "out";
const PORT = 9333;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(p) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${p}`);
      if (r.ok) return await r.json();
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("CDP not reachable");
}

(async () => {
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--allow-file-access-from-files", "about:blank",
  ], { stdio: "ignore" });

  const cleanup = () => { try { chrome.kill(); } catch (e) {} };
  process.on("exit", cleanup);

  try {
    const ver = await getJSON("/json/version");
    console.log("browser:", ver.Browser);

    const t = await getJSON("/json/list");
    const page = t.find((x) => x.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const waiters = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
    };
    const send = (method, params) => new Promise((res) => {
      const i = ++id;
      waiters.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
    await new Promise((r) => { ws.onopen = r; });

    await send("Runtime.enable");
    await send("Log.enable");
    await send("Page.enable");
    await send("Network.enable");

    const logs = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === "Log.entryAdded") logs.push(`[${m.params.entry.level}] ${m.params.entry.text}`);
      if (m.method === "Runtime.consoleAPICalled") {
        logs.push("[console] " + m.params.args.map((a) => a.value !== undefined ? a.value : a.description).join(" "));
      }
      if (m.method === "Runtime.exceptionThrown") {
        logs.push("[exception] " + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text));
      }
      if (m.method === "Network.responseReceived") {
        const st = m.params.response.status;
        if (st >= 400) logs.push(`[http ${st}] ${m.params.response.url}`);
      }
      if (m.method === "Network.requestWillBeSent" && /api\/games/.test(m.params.request.url)) {
        logs.push("[post] " + m.params.request.url + " " + (m.params.request.postData || "").slice(0, 200));
      }
    });

    await send("Page.navigate", { url: URL_ });
    await sleep(WAIT);

    const r = await send("Runtime.evaluate", {
      expression: `(() => { const n = document.getElementById(${JSON.stringify(SEL)}); return n ? n.textContent : document.body.innerText.slice(0,2000); })()`,
      returnByValue: true,
    });
    console.log("---- page text ----");
    console.log((r.result && r.result.result && r.result.result.value) || "(empty)");
    if (logs.length) {
      console.log("---- browser logs ----");
      for (const l of logs) console.log(l);
    }
    ws.close();
  } catch (e) {
    console.log("ERROR:", e.message);
  } finally {
    cleanup();
    await sleep(300);
  }
})();
