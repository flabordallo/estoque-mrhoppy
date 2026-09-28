// Servidor local completo: frontend real + /api na mesma origem.
// Não é servidor de produção; serve para testar o aplicativo antes do deploy.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { handleRequest } = require("./src/router");
const { db } = require("./src/db");

const root = path.join(__dirname, "..", "frontend");
const mime = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml",
};
function safeFile(urlPath) {
  const rel = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  const file = path.resolve(root, rel || "index.html");
  return file.startsWith(root + path.sep) ? file : null;
}
function createServer(knexOverride) {
async function apiRequest(req, res) {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", async () => {
    const url = new URL(req.url, "http://localhost");
    try {
      const out = await handleRequest({ method: req.method, path: url.pathname + url.search, headers: req.headers, body: raw, knex: knexOverride || db() });
      res.writeHead(out.status, out.headers);
      res.end(out.isBase64Encoded ? Buffer.from(out.body, "base64") : out.body);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Erro interno.", detail: String(e?.message || e) }));
    }
  });
}
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) return apiRequest(req, res);
  const file = safeFile(req.url);
  if (!file) { res.writeHead(400); return res.end("Bad request"); }
  fs.stat(file, (err, st) => {
    if (!err && st.isFile()) return fs.readFile(file, (e, data) => {
      if (e) { res.writeHead(500); return res.end("Error"); }
      res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    });
    const index = path.join(root, "index.html");
    fs.readFile(index, (e, data) => { if (e) { res.writeHead(404); return res.end("Not found"); } res.writeHead(200, { "Content-Type": mime[".html"], "Cache-Control": "no-store" }); res.end(data); });
  });
});
return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8788);
  createServer().listen(port, () => console.log(`Estoque do Bar local: http://localhost:${port}`));
}

module.exports = { createServer };
