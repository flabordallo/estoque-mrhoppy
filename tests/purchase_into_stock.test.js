import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeDb, dropDb } from "./helper";
import { confirm } from "../backend/src/services/purchases";
import inventory from "../backend/src/services/inventory";
import { createSale, saleDetail } from "../backend/src/services/pdv-sales";

let knex;
beforeEach(async () => { knex = await makeDb(); await knex.seed.run({ specific: "03_packs_subs.js" }); });
afterEach(async () => { await dropDb(knex); });

describe("compra entra no estoque (v2.4.2)", () => {
  it("soma a quantidade comprada na contagem atual do item", async () => {
    const coca = await knex("inventory_items").where({ name: "Coca lata 350ml" }).first();
    await inventory.setCount(knex, { itemId: coca.id, quantity: 5, userId: null });
    await confirm(knex, { lines: [{ inventoryItemId: coca.id, description: "coca", quantity: 3, unit: "pc" }], userId: null });
    const s = await inventory.buildState(knex);
    const item = s.items.find((i) => i.id === String(coca.id));
    expect(item.count).toBe(8); // 5 + 3
  });
  it("cria contagem a partir da base quando o item ainda não foi contado no ciclo", async () => {
    const coca = await knex("inventory_items").where({ name: "Coca zero 350ml" }).first();
    await inventory.setCount(knex, { itemId: coca.id, quantity: 10, userId: null });
    await inventory.closeCount(knex, { userId: null }); // base = 10 (contagem segue aberta = 10)
    await confirm(knex, { lines: [{ inventoryItemId: coca.id, description: "coca zero", quantity: 4, unit: "pc" }], userId: null });
    const s = await inventory.buildState(knex);
    const item = s.items.find((i) => i.id === String(coca.id));
    expect(item.count).toBe(14); // 10 + 4
  });
  it("não distorce o consumo: base + entradas − contagem final continua certo", async () => {
    const coca = await knex("inventory_items").where({ name: "Coca lata 350ml" }).first();
    await inventory.setCount(knex, { itemId: coca.id, quantity: 30, userId: null });
    await inventory.closeCount(knex, { userId: null });           // base = 30
    await confirm(knex, { lines: [{ inventoryItemId: coca.id, description: "coca", quantity: 24, unit: "pc" }], userId: null }); // estoque vira 54
    await inventory.setCount(knex, { itemId: coca.id, quantity: 40, userId: null }); // recontagem física
    const { reports } = await import("../backend/src/services/catalog");
    const cons = await reports.consumption(knex, inventory.buildState);
    const c = cons.find((x) => x.name === "Coca lata 350ml");
    expect(c.consumed).toBe(14); // 30 + 24 − 40
  });
});

describe("detalhe da venda (v2.4.2)", () => {
  it("retorna itens do pedido e horário em ISO (UTC)", async () => {
    // cria um produto simples e uma venda
    const [pid] = await knex("pdv_products").insert({ category: "drink", name: "Cuba Teste", price: 20, active: true, sort_order: 1 }).returning("id");
    const productId = typeof pid === "object" ? pid.id : pid;
    const r = await createSale(knex, { reference: "T-1", plate: "27", place: "Bar", items: [{ productId, quantity: 2 }], userId: null });
    expect(r.ok).toBe(true);
    const det = await saleDetail(knex, r.sale.id);
    expect(det.ok).toBe(true);
    expect(det.items.length).toBe(1);
    expect(det.items[0].productName).toBe("Cuba Teste");
    expect(det.items[0].quantity).toBe(2);
    expect(det.items[0].lineTotal).toBe(40);
    // createdAt precisa terminar em Z (ISO/UTC) para o navegador converter certo
    expect(/Z$/.test(det.sale.createdAt)).toBe(true);
  });
});
