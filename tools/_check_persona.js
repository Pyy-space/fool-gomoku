/* 验证 persona.js 六个角色 + 各类台词都能正常随机取到。 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "web", "static", "persona.js"), "utf8");
const sb = { window: {}, console, Math };
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(src, sb);
const P = sb.window.Persona;

const cats = ["win", "lose", "draw", "think", "taunt", "hint", "undo"];
let fail = 0;

// 1) 六个角色齐全
const expect = ["江无浪", "陈叔", "寒姨", "盈盈", "赵大", "赵二"];
const names = P.CHARS.map(c => c.name);
for (const n of expect) {
  if (!names.includes(n)) { console.log("缺角色:", n); fail++; }
}
console.log("角色数:", P.CHARS.length, "→", P.CHARS.map(c => c.name).join("/"));

// 2) 每个角色每类台词非空且可随机
for (const c of P.CHARS) {
  for (const cat of cats) {
    const arr = c.lines[cat];
    if (!Array.isArray(arr) || arr.length === 0) { console.log("空台词", c.name, cat); fail++; }
  }
}

// 3) speak() 返回对象带 avatar/hue/name/text
for (let i = 0; i < 200; i++) {
  const s = P.speak(cats[i % cats.length]);
  if (!s || !s.name || !s.avatar || !s.text || !s.hue) {
    console.log("speak 返回异常:", JSON.stringify(s)); fail++; break;
  }
}

// 4) 旧接口 line/think/taunt/hint/undo 也返回对象
for (const fn of ["line", "think", "taunt", "hint", "undo"]) {
  const r = fn === "line" ? P.line("lose") : P[fn]();
  if (!r || typeof r !== "object" || !r.text) { console.log("旧接口异常:", fn); fail++; }
}

console.log(fail === 0 ? "RESULT: PASS" : `RESULT: FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
