import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeDb, dropDb } from "./helper";
import inventory from "../backend/src/services/inventory";
import { reports } from "../backend/src/services/catalog";
import { buildWorkbook, exportAll, importAll } from "../backend/src/services/export";
import ExcelJS from "exceljs";

let knex;
beforeEach(async () => { knex = await makeDb(); });
afterEach(async () => { await dropDb(knex); });

async function itemId(name) {
  const r = await knex("inventory_items").where({ name }).first();
  return r.id;
}

describe("inventário e consumo", () => {
  it("registra contagem e reflete no estado", async () => {
    const id = await itemId("Coca lata 350ml");
    await inventory.setCount(knex, { itemId: id, quantity: 8, userId: null });
    const state = await inventory.buildState(knex);
    const item = state.items.find((i) => i.id === String(id));
    expect(item.count).toBe(8);
  });

  it("mostra item abaixo do mínimo na lista de compras", async () => {
    const id = await itemId("Coca lata 350ml"); // mínimo 15
    await inventory.setCount(knex, { itemId: id, quantity: 8, userId: null });
    const below = await reports.belowMinimum(knex, inventory.buildState);
    const coca = below.find((i) => i.name === "Coca lata 350ml");
    expect(coca.missing).toBe(7);
  });

  it("fecha inventário (snapshot) e calcula consumo", async () => {
    const id = await itemId("Coca lata 350ml");
    await inventory.setCount(knex, { itemId: id, quantity: 20, userId: null });
    await inventory.closeCount(knex, { userId: null });          // base = 20
    await inventory.setCount(knex, { itemId: id, quantity: 12, userId: null }); // atual = 12
    const cons = await reports.consumption(knex, inventory.buildState);
    const coca = cons.find((i) => i.name === "Coca lata 350ml");
    expect(coca.consumed).toBe(8);
    const snaps = await knex("inventory_snapshots");
    expect(snaps.length).toBe(1);
    expect(snaps[0].code).toBe("Inventário 001");
  });

  it("não sobrescreve inventários anteriores", async () => {
    await inventory.closeCount(knex, { userId: null });
    await inventory.closeCount(knex, { userId: null });
    const snaps = await knex("inventory_snapshots");
    expect(snaps.length).toBe(2);
    expect(snaps.map((s) => s.code)).toContain("Inventário 002");
  });
});

describe("preços", () => {
  it("mantém preço de item no estado", async () => {
    const id = await itemId("Coca lata 350ml");
    await knex("inventory_items").where({ id }).update({ price: 7.5 });
    const state = await inventory.buildState(knex);
    expect(state.items.find((i) => i.id === String(id)).price).toBe(7.5);
  });

  it("mantém preço de chopp no estado", async () => {
    const product = await knex("chopp_products").first();
    await knex("chopp_products").where({ id: product.id }).update({ price: 19.9 });
    const state = await inventory.buildState(knex);
    expect(state.chopp.find((i) => i.id === `chopp-${product.id}`).price).toBe(19.9);
  });
});

describe("exportação XLSX", () => {
  it("gera um arquivo válido com as abas esperadas", async () => {
    const id = await itemId("Coca lata 350ml");
    await inventory.setCount(knex, { itemId: id, quantity: 8, userId: null });
    const buffer = await buildWorkbook(knex, inventory.buildState, reports);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const names = wb.worksheets.map((w) => w.name);
    for (const n of ["ESTOQUE_ATUAL", "COMPRAS", "CONSUMO", "CHOPP", "HISTORICO", "AUDITORIA"]) {
      expect(names).toContain(n);
    }
    expect(wb.getWorksheet("ESTOQUE_ATUAL").rowCount).toBeGreaterThan(100);
  });
});

describe("backup e restauração", () => {
  it("exporta e restaura mantendo os itens", async () => {
    const dump = await exportAll(knex, null);
    expect(dump.tables.inventory_items.length).toBe(144);
    // apaga um item e restaura
    await knex("inventory_items").where({ name: "Coca lata 350ml" }).del();
    const r = await importAll(knex, dump, null);
    expect(r.ok).toBe(true);
    const total = (await knex("inventory_items").count("* as n"))[0].n;
    expect(Number(total)).toBe(144);
  });
});

describe("reset do inventário", () => {
  it("remove contagens abertas, preserva histórico/catálogo e reinicia chopp", async () => {
    const id = await itemId("Coca lata 350ml");
    const product = await knex("chopp_products").first();
    await inventory.setCount(knex, { itemId: id, quantity: 12, userId: null });
    await inventory.closeCount(knex, { userId: null });
    await inventory.setCount(knex, { itemId: id, quantity: 7, userId: null });
    await knex("chopp_taps").where({ product_id: product.id }).update({ level_pct: 10, level_label: "Acabando" });
    await knex("chopp_reserves").where({ product_id: product.id }).update({ barrels: 3 });

    const beforeItem = await knex("inventory_items").where({ id }).first();
    const result = await inventory.resetCurrentInventory(knex, { userId: null });
    expect(result.ok).toBe(true);
    expect(result.removedCounts).toBe(1);

    expect(await knex("inventory_counts").whereNull("snapshot_id")).toHaveLength(0);
    expect(await knex("inventory_snapshots")).toHaveLength(1);
    const afterItem = await knex("inventory_items").where({ id }).first();
    expect(afterItem.name).toBe(beforeItem.name);
    expect(Number(afterItem.price)).toBe(Number(beforeItem.price));

    const tap = await knex("chopp_taps").where({ product_id: product.id }).first();
    const reserve = await knex("chopp_reserves").where({ product_id: product.id }).first();
    expect(Number(tap.level_pct)).toBe(100);
    expect(tap.level_label).toBe("Cheio");
    expect(reserve.barrels).toBe(0);

    const audit = await knex("audit_log").where({ action: "inventory_reset" });
    expect(audit).toHaveLength(1);
  });
});


describe("Fase 1 — modelo híbrido de unidades", () => {
  it("buildState expõe unidade comercial e unidade-base separadamente", async () => {
    const item = await knex("inventory_items").where({ name: "Coca zero 350ml" }).first();
    await knex("inventory_items").where({ id: item.id }).update({ unit: "pacote", base_unit: "unidade", units_per_pack: 6 });
    const state = await inventory.buildState(knex);
    const out = state.items.find((x) => x.id === String(item.id));
    expect(out.unit).toBe("pacote");
    expect(out.baseUnit).toBe("unidade");
    expect(out.unitsPerPack).toBe(6);
  });
});
