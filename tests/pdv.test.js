import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knexFactory from "knex";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { getCatalog, linkReport } from "../backend/src/services/pdv";

const root = path.join(__dirname, "..");
let knex, file;

beforeAll(async () => {
  file = path.join(os.tmpdir(), `pdv-${Date.now()}.sqlite3`);
  knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: file },
    useNullAsDefault: true,
    migrations: { directory: path.join(root, "database", "migrations") },
    seeds: { directory: path.join(root, "database", "seed") },
    pool: { afterCreate: (c, cb) => { c.pragma("foreign_keys = ON"); cb(null, c); } },
  });
  await knex.migrate.latest();
  await knex.seed.run(); // roda 00_catalog, 01_admin, 02_pdv
});
afterAll(async () => { await knex.destroy(); if (fs.existsSync(file)) fs.unlinkSync(file); });

describe("cadastro do PDV", () => {
  it("cria as tabelas do PDV", async () => {
    for (const t of ["pdv_products", "pdv_sizes", "pdv_option_groups", "pdv_options", "pdv_addons"]) {
      expect(await knex.schema.hasTable(t), t).toBe(true);
    }
  });

  it("insere 14 chopps, 15 lanches, 13 porções e 18 drinks", async () => {
    const c = async (cat) => Number((await knex("pdv_products").where({ category: cat }).count("* as n"))[0].n);
    expect(await c("chopp")).toBe(14);
    expect(await c("lanche")).toBe(15);
    expect(await c("porcao")).toBe(13);
    expect(await c("drink")).toBe(18);
  });

  it("chopp tem dois tamanhos com preços certos (Pilsen 11/13)", async () => {
    const pilsen = await knex("pdv_products").where({ category: "chopp", name: "Pilsen" }).first();
    const sizes = await knex("pdv_sizes").where({ product_id: pilsen.id }).orderBy("sort_order");
    expect(sizes.map((s) => [s.label, Number(s.price)])).toEqual([["300 ml", 11], ["400 ml", 13]]);
  });

  it("preços de lanche/porção/drink corretos", async () => {
    const smash = await knex("pdv_products").where({ name: "Smash Duplo" }).first();
    expect(Number(smash.price)).toBe(31);
    const jack = await knex("pdv_products").where({ name: "Jack Red Bull" }).first();
    expect(Number(jack.price)).toBe(40);
  });

  it("adicionais: Bacon/Salada/Queijo a 3 e Duplo a 13", async () => {
    const addons = await knex("pdv_addons");
    const map = Object.fromEntries(addons.map((a) => [a.name, Number(a.price)]));
    expect(map["Bacon"]).toBe(3);
    expect(map["Queijo"]).toBe(3);
    expect(map["Duplo"]).toBe(13);
  });

  it("drink com grupos de opção (Jack Red Bull tem Jack + Red Bull)", async () => {
    const jack = await knex("pdv_products").where({ name: "Jack Red Bull" }).first();
    const groups = await knex("pdv_option_groups").where({ product_id: jack.id });
    expect(groups.map((g) => g.name).sort()).toEqual(["Jack", "Red Bull"]);
  });

  it("vincula opções ao estoque por nome (Red Bull, Jack, Vodka casam)", async () => {
    const opt = async (label) => {
      const o = await knex("pdv_options").where({ label }).first();
      return o && o.stock_item_id != null;
    };
    expect(await opt("Red Bull Normal")).toBe(true);
    expect(await opt("Jack Fire")).toBe(true);
    expect(await opt("Vodka Bacco")).toBe(true);
  });

  it("catálogo montado tem as categorias e os botões vazios", async () => {
    const cat = await getCatalog(knex);
    const keys = cat.categories.map((c) => c.key);
    expect(keys).toContain("chopp");
    expect(keys).toContain("drink");
    expect(keys).toContain("refri");
    expect(keys).toContain("dose");
    expect(cat.addons.length).toBe(4);
  });

  it("relatório de vínculos aponta o que não casou (para correção)", async () => {
    const r = await linkReport(knex);
    expect(r).toHaveProperty("total");
    expect(r.semVinculo).toHaveProperty("drinkOptions");
  });

  it("seed é idempotente (rodar de novo não duplica)", async () => {
    await knex.seed.run();
    const n = Number((await knex("pdv_products").count("* as n"))[0].n);
    // Catálogo atual: 14 chopps + 15 lanches + 13 porções + 18 drinks + 18 refri/água/suco + 12 doses.
    expect(n).toBe(14 + 15 + 13 + 18 + 18 + 12);
  });
});
