const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const URL_ = process.argv[2] || "http://127.0.0.1:8897/web/local.html";
const PORT = 9340;
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-h7-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(p){for(let i=0;i<60;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`);if(r.ok)return await r.json();}catch(e){}await sleep(250);}throw new Error("cdp down");}
(async()=>{
  const chrome=spawn(CHROME,["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check",`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,"--window-size=1400,900",URL_],{stdio:"ignore"});
  process.on("exit",()=>{try{chrome.kill()}catch(e){}});
  await getJSON("/json/version");
  let page=null;
  for(let i=0;i<40&&!page;i++){const t=await getJSON("/json/list");page=t.find(x=>x.type==="page");if(!page)await sleep(250);}
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  let id=0; const waiters=new Map(); const logs=[];
  ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);
    if(m.id&&waiters.has(m.id)){waiters.get(m.id)(m);waiters.delete(m.id);}
    if(m.method==="Runtime.exceptionThrown"){logs.push("EXC "+(m.params.exceptionDetails.exception||{}).description);}
  };
  const send=(method,params)=>new Promise(res=>{const i=++id;waiters.set(i,res);ws.send(JSON.stringify({id:i,method,params:params||{}}));});
  await new Promise(r=>{ws.onopen=r;});
  await send("Runtime.enable");
  const ev=async(expr)=>{const r=await send("Runtime.evaluate",{expression:expr,returnByValue:true,awaitPromise:true}); if(r.result&&r.result.exceptionDetails)return{err:(r.result.exceptionDetails.exception||{}).description}; return r.result&&r.result.result?r.result.result.value:null;};
  await sleep(2000);
  const out=await ev(`(async()=>{
    const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
    const canvas=document.querySelector("#board canvas");
    const ctx=canvas.getContext("2d");
    const W=canvas.width,H=canvas.height;
    const rect=canvas.getBoundingClientRect();
    const box=Math.min(rect.width,rect.height);
    const pad=Math.max(14,box*0.058), step=(box-pad*2)/14;
    canvas.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:rect.left+pad+7*step,clientY:rect.top+pad+7*step}));
    await sleep(4000);
    const moves=[...document.querySelectorAll("#moves li")].map(li=>li.textContent);
    const b=ctx.getImageData(0,0,W,H).data.slice();
    document.getElementById("btnHint").click();
    await sleep(4000);
    const a=ctx.getImageData(0,0,W,H).data;
    let diff=0, first=null;
    for(let i=0;i<a.length;i+=4){
      const d=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);
      if(d>8){ diff++; if(!first) first=[(i/4)%W, Math.floor(i/4/W)]; }
    }
    const txt=document.getElementById("analysis").textContent||"";
    return {diff, first, moves, hint:(txt.match(/\\((\\d+),\\s*(\\d+)\\)/)||[]).slice(1),
            persona:document.getElementById("persona").textContent, W, H};
  })()`);
  console.log(JSON.stringify(out,null,1));
  console.log("errors:", JSON.stringify(logs));
  ws.close(); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
