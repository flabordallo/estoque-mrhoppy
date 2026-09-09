import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knexFactory from "knex";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const root = path.join(__dirname, "..");
let db;
let dbFile;

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `test-${Date.now()}.sqlite3`);
  db = knexFactory({
    client: "better-sqlite3",
    connection: { filename: dbFile },
    useNullAsDefault: true,
    migrations: { directory: path.join(root, "database", "migrations") },
    seeds: { directory: path.join(root, "database", "seed") },
    pool: {
      afterCreate: (conn, done) => {
        conn.pragma("foreign_keys = ON");
        done(null, conn);
      },
    },
  });
  await db.migrate.latest();
  await db.seed.run();
});

afterAll(async () => {
  await db.destroy();
  if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
});

describe("migração do catálogo", () => {
  it("cria todas as tabelas do schema", async () => {
    for (const t of [
      "users", "sessions", "inventory_items", "inventory_counts",
      "inventory_snapshots", "inventory_snapshot_items",
      "chopp_products", "chopp_taps", "chopp_reserves", "audit_log", "settings",
    ]) {
      expect(await db.schema.hasTable(t), `tabela ${t}`).toBe(true);
    }
  });

  it("migra os 143 itens do catálogo", async () => {
    const [{ n }] = await db("inventory_items").count("* as n");
    expect(Number(n)).toBe(143);
  });

  it("preserva as 13 categorias", async () => {
    const cats = await db("inventory_items").distinct("category");
    expect(cats.length).toBe(13);
  });

  it("preserva mínimos e unidades corretos", async () => {
    const coca = await db("inventory_items").where({ name: "Coca lata 350ml" }).first();
    expect(Number(coca.minimum)).toBe(15);
    const bacardi = await db("inventory_items").where({ name: "Bacardi Ouro" }).first();
    expect(Number(bacardi.minimum)).toBe(10);
    const vodka = await db("inventory_items").where({ name: "Vodka Bacco" }).first();
    expect(vodka.unit).toBe("L");
  });

  it("mantém itens sem mínimo como null", async () => {
    const mozza = await db("inventory_items").where({ name: "Queijo mozzarela" }).first();
    expect(mozza.minimum).toBeNull();
  });

  it("migra 15 chopps com torneira e reserva", async () => {
    const [{ p }] = await db("chopp_products").count("* as p");
    const [{ t }] = await db("chopp_taps").count("* as t");
    const [{ r }] = await db("chopp_reserves").count("* as r");
    expect(Number(p)).toBe(15);
    expect(Number(t)).toBe(15);
    expect(Number(r)).toBe(15);
  });

  it("preserva nível e reserva do chopp (Pilsen 50% / 10 barris)", async () => {
    const pilsen = await db("chopp_products").where({ brand: "Curitiba", name: "Pilsen" }).first();
    const tap = await db("chopp_taps").where({ product_id: pilsen.id }).first();
    const res = await db("chopp_reserves").where({ product_id: pilsen.id }).first();
    expect(Number(tap.level_pct)).toBe(50);
    expect(tap.level_label).toBe("Metade");
    expect(Number(res.barrels)).toBe(10);
  });

  it("é idempotente: rodar o seed de novo não duplica", async () => {
    await db.seed.run();
    const [{ n }] = await db("inventory_items").count("* as n");
    const [{ p }] = await db("chopp_products").count("* as p");
    expect(Number(n)).toBe(143);
    expect(Number(p)).toBe(15);
  });
});
