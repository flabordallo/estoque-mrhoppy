// Instância única do Knex conforme o ambiente (SQLite dev / PostgreSQL prod).
const knexFactory = require("knex");
const config = require("../../knexfile");

const env = process.env.NODE_ENV === "production" ? "production" : "development";
let instance = null;

function db() {
  if (!instance) instance = knexFactory(config[env]);
  return instance;
}

// Permite injetar uma conexão nos testes.
function setDb(knexInstance) {
  instance = knexInstance;
}

module.exports = { db, setDb };
