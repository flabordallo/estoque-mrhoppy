// Configuração de banco portável: SQLite em dev, PostgreSQL em produção.
// A mesma camada de queries (Knex) roda nos dois — sem SQL específico de banco.
const path = require("path");

const migrations = { directory: path.join(__dirname, "database", "migrations") };
const seeds = { directory: path.join(__dirname, "database", "seed") };

// Liga as foreign keys no SQLite (desligadas por padrão).
const sqliteFK = {
  afterCreate: (conn, done) => {
    conn.pragma("foreign_keys = ON");
    done(null, conn);
  },
};

module.exports = {
  development: {
    client: "better-sqlite3",
    connection: { filename: path.join(__dirname, "database", "dev.sqlite3") },
    useNullAsDefault: true,
    migrations,
    seeds,
    pool: sqliteFK,
  },

  // Produção: Netlify Database (PostgreSQL/Neon). Nada de SQLite aqui.
  production: {
    client: "pg",
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    },
    migrations,
    seeds,
    pool: { min: 2, max: 10 },
  },
};
