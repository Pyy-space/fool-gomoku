const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = process.cwd();
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/web/index.html";
  const f = path.join(ROOT, p);
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404); res.end("404 " + p); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    res.end(buf);
  });
});
const port = Number(process.argv[2] || 8897);
srv.listen(port, "127.0.0.1", () => console.log("http://127.0.0.1:" + port + "/"));
