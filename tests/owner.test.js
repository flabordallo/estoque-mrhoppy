import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeDb, dropDb } from "./helper";
import owner from "../backend/src/services/owner";

let knex;
beforeEach(async () => { knex = await makeDb(); });
afterEach(async () => { await dropDb(knex); });

describe("owner.periodRange (dia de bar 06:00→06:00)", () => {
  it("dia: madrugada conta para o dia anterior", () => {
    // 03:00 BRT de 15/03 = 06:00 UTC => ainda é o dia de bar 14/03
    const now = new Date("2026-03-15T06:00:00.000Z"); // 03:00 BRT
    const r = owner.periodRange("dia", now);
    expect(r.startDate).toBe("2026-03-14");
    expect(r.endDate).toBe("2026-03-14");
    // início = 06:00 BRT = 09:00 UTC
    expect(r.startInstant.toISOString()).toBe("2026-03-14T09:00:00.000Z");
    expect(r.endInstant.toISOString()).toBe("2026-03-15T09:00:00.000Z");
  });

  it("dia: após as 06:00 conta para o próprio dia", () => {
    const now = new Date("2026-03-15T12:00:00.000Z"); // 09:00 BRT
    const r = owner.periodRange("dia", now);
    expect(r.startDate).toBe("2026-03-15");
  });

  it("semana: domingo a sábado", () => {
    const now = new Date("2026-03-18T15:00:00.000Z"); // quarta 12:00 BRT
    const r = owner.periodRange("semana", now);
    // domingo anterior = 15/03/2026
    expect(r.startDate).toBe("2026-03-15");
    expect(r.endDate).toBe("2026-03-21");
  });

  it("mês: primeiro ao último dia do mês", () => {
    const now = new Date("2026-03-18T15:00:00.000Z");
    const r = owner.periodRange("mes", now);
    expect(r.startDate).toBe("2026-03-01");
    expect(r.endDate).toBe("2026-03-31");
  });
});

describe("owner.gasto", () => {
  it("soma compras do período × preço de compra", async () => {
    const item = await knex("inventory_items").first();
    await knex("inventory_items").where({ id: item.id }).update({ purchase_price: 10 });
    await knex("stock_entries").insert({ inventory_item_id: item.id, description: "teste", quantity: 3, entry_date: "2026-03-14", source: "texto" });
    const now = new Date("2026-03-14T18:00:00.000Z"); // dia de bar 14
    const g = await owner.gasto(knex, "dia", now);
    expect(g.total).toBe(30);
    expect(g.entries).toBe(1);
  });

  it("conta entradas sem preço em semPreco", async () => {
    const item = await knex("inventory_items").first();
    await knex("inventory_items").where({ id: item.id }).update({ purchase_price: null });
    await knex("stock_entries").insert({ inventory_item_id: item.id, description: "teste", quantity: 2, entry_date: "2026-03-14", source: "texto" });
    const now = new Date("2026-03-14T18:00:00.000Z");
    const g = await owner.gasto(knex, "dia", now);
    expect(g.total).toBe(0);
    expect(g.semPreco).toBe(1);
  });
});

describe("owner.shortageByCompany + buildOrderText", () => {
  it("agrupa itens em falta por categoria e gera texto", async () => {
    const items = await knex("inventory_items").orderBy("id").limit(2);
    for (const it of items) {
      await knex("inventory_items").where({ id: it.id }).update({ minimum: 5 });
      await knex("inventory_counts").insert({ item_id: it.id, quantity: 1, snapshot_id: null, counted_at: new Date().toISOString() });
    }
    const data = await owner.shortageByCompany(knex);
    expect(data.total).toBeGreaterThanOrEqual(2);
    const text = owner.buildOrderText(data);
    expect(text).toContain("Pedido de hoje:");
    expect(text).toMatch(/faltam/);
  });
});

describe("owner.ownerWorkbook", () => {
  it("gera um buffer .xlsx não vazio", async () => {
    const buf = await owner.ownerWorkbook(knex, { period: "dia", now: new Date("2026-03-14T18:00:00.000Z") });
    expect(buf.byteLength || buf.length).toBeGreaterThan(1000);
  });
});
