import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knexFactory from "knex";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createSale, salesSummary } from "../backend/src/services/pdv-sales";

const root = path.join(__dirname, "..");
let knex, file, adminId;

beforeAll(async () => {
  file = path.join(os.tmpdir(), `pdv-sales-${Date.now()}.sqlite3`);
  knex = knexFactory({ client: "better-sqlite3", connection: { filename: file }, useNullAsDefault: true,
    migrations: { directory: path.join(root, "database", "migrations") },
    seeds: { directory: path.join(root, "database", "seed") },
    pool: { afterCreate: (c, cb) => { c.pragma("foreign_keys = ON"); cb(null, c); } },
  });
  await knex.migrate.latest(); await knex.seed.run();
  adminId = (await knex("users").where({ username: "admin" }).first()).id;
});
afterAll(async () => { await knex.destroy(); if (fs.existsSync(file)) fs.unlinkSync(file); });

describe("venda real do PDV", () => {
  it("registra pedido pago sem método de pagamento e calcula preço no servidor", async () => {
    const p = await knex("pdv_products").where({ category: "lanche", name: "Smash" }).first();
    const bacon = await knex("pdv_addons").where({ name: "Bacon" }).first();
    const r = await createSale(knex, { reference: "TEST-001", plate: "27", place: "Salão 3", userId: adminId,
      items: [{ productId: p.id, quantity: 2, addonIds: [bacon.id], groups: [], notes: "sem cebola" }] });
    expect(r.ok).toBe(true); expect(r.sale.total).toBe(50); expect(r.sale.status).toBe("PAID");
    const item = await knex("pdv_sale_items").where({ sale_id: r.sale.id }).first();
    expect(Number(item.unit_price)).toBe(22); expect(Number(item.addons_total)).toBe(3); expect(item.quantity).toBe(2);
  });
  it("processa chopp e opção de drink como movimentos de estoque", async () => {
    const pilsen = await knex("pdv_products").where({ category: "chopp", name: "Pilsen" }).first();
    const size = await knex("pdv_sizes").where({ product_id: pilsen.id, label: "400 ml" }).first();
    const jack = await knex("pdv_products").where({ name: "Jack Red Bull" }).first();
    const groups = await knex("pdv_option_groups").where({ product_id: jack.id }).orderBy("sort_order");
    const jackOpt = await knex("pdv_options").where({ group_id: groups[0].id, label: "Jack Apple" }).first();
    const rbOpt = await knex("pdv_options").where({ group_id: groups[1].id, label: "Red Bull Tropical" }).first();
    const r = await createSale(knex, { reference: "TEST-002", place: "Bar", userId: adminId, items: [
      { productId: pilsen.id, sizeId: size.id, quantity: 2, addonIds: [], groups: [], notes: "" },
      { productId: jack.id, quantity: 1, addonIds: [], groups: [{ groupId: groups[0].id, optionId: jackOpt.id }, { groupId: groups[1].id, optionId: rbOpt.id }], notes: "" },
    ] });
    expect(r.ok).toBe(true);
    const mv = await knex("pdv_stock_movements").where({ sale_id: r.sale.id });
    expect(mv.length).toBe(3);
    expect(Number(mv.find(x => x.chopp_product_id != null).liters)).toBeCloseTo(0.8, 6);
    expect(mv.filter(x => x.inventory_item_id != null).length).toBe(2);
  });
  it("é idempotente para retry da mesma referência", async () => {
    const p = await knex("pdv_products").where({ name: "Punk Hoppy" }).first();
    const a = await createSale(knex, { reference: "TEST-IDEMP", userId: adminId, items: [{ productId: p.id, quantity: 1, addonIds: [], groups: [], notes: "" }] });
    const b = await createSale(knex, { reference: "TEST-IDEMP", userId: adminId, items: [{ productId: p.id, quantity: 99, addonIds: [], groups: [], notes: "" }] });
    expect(a.ok).toBe(true); expect(b.ok).toBe(true); expect(b.idempotent).toBe(true); expect(b.sale.id).toBe(a.sale.id);
    expect(await knex("pdv_sales").where({ reference: "TEST-IDEMP" }).count("*").first()).toBeTruthy();
  });
  it("recusa produto inexistente", async () => {
    const r = await createSale(knex, { reference: "TEST-BAD", userId: adminId, items: [{ productId: 999999, quantity: 1 }] });
    expect(r.ok).toBe(false); expect(r.status).toBe(400);
  });
  it("inclui refri e doses com os preços cadastrados e registra movimentos de estoque", async () => {
    const coca = await knex("pdv_products").where({ category: "refri", name: "Coca" }).first();
    const jack = await knex("pdv_products").where({ category: "dose", name: "Jack Daniels Apple" }).first();
    expect(Number(coca.price)).toBe(8);
    expect(Number(jack.price)).toBe(27);
    expect(coca.stock_item_id).not.toBeNull();
    expect(jack.stock_item_id).not.toBeNull();
    const r = await createSale(knex, { reference: "TEST-REFRI-DOSE", userId: adminId, items: [
      { productId: coca.id, quantity: 2, addonIds: [], groups: [], notes: "" },
      { productId: jack.id, quantity: 1, addonIds: [], groups: [], notes: "" },
    ] });
    expect(r.ok).toBe(true);
    const mv = await knex("pdv_stock_movements").where({ sale_id: r.sale.id });
    expect(mv).toHaveLength(2);
    expect(mv.map(x => Number(x.quantity)).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("gera resumo de vendas", async () => {
    const r = await salesSummary(knex);
    expect(r.count).toBeGreaterThanOrEqual(3); expect(r.total).toBeGreaterThan(0);
  });
});
