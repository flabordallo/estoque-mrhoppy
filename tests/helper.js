// Helper compartilhado: banco SQLite temporário migrado + seed de catálogo.
import knexFactory from "knex";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const root = path.join(__dirname, "..");

export async function makeDb() {
  const file = path.join(os.tmpdir(), `t-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite3`);
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: file },
    useNullAsDefault: true,
    migrations: { directory: path.join(root, "database", "migrations") },
    seeds: { directory: path.join(root, "database", "seed") },
    pool: { afterCreate: (c, cb) => { c.pragma("foreign_keys = ON"); cb(null, c); } },
  });
  await knex.migrate.latest();
  // roda só o seed do catálogo (o admin é criado explicitamente nos testes)
  await knex.seed.run({ specific: "00_catalog.js" });
  knex._file = file;
  return knex;
}

export async function dropDb(knex) {
  const file = knex._file;
  await knex.destroy();
  if (file && fs.existsSync(file)) fs.unlinkSync(file);
}
