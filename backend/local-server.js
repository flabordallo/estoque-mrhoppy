const { createServer } = require("./dev-server");

if (require.main === module) {
  const port = Number(process.env.PORT || 8788);
  createServer().listen(port, () => console.log(`Estoque do Bar local: http://localhost:${port}`));
}

module.exports = { createServer };
