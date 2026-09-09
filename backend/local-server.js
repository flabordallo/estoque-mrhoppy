// Servidor HTTP simples para desenvolvimento e testes de integração.
const http = require("node:http");
const { handleRequest } = require("./src/router");

function createServer(knex) {
  return http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const url = new URL(req.url, "http://localhost");
      const out = await handleRequest({
        method: req.method,
        path: url.pathname,
        headers: req.headers,
        body: raw,
        knex, // nos testes injetamos a conexão
      });
      res.writeHead(out.status, out.headers);
      res.end(out.isBase64Encoded ? Buffer.from(out.body, "base64") : out.body);
    });
  });
}

if (require.main === module) {
  const port = process.env.PORT || 8788;
  createServer().listen(port, () => console.log(`API local em http://localhost:${port}/api`));
}

module.exports = { createServer };
