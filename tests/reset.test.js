import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeDb, dropDb } from "./helper";
import inventory from "../backend/src/services/inventory";

let knex;
beforeEach(async () => { knex = await makeDb(); });
afterEach(async () => { await dropDb(knex); });

describe("reset / novo inventário", () => {
  it("remove contagens abertas e preserva catálogo, preços e histórico", async () => {
    const item = await knex("inventory_items").first();
    await knex("inventory_items").where({ id: item.id }).update({ price: 9.9 });
    await inventory.setCount(knex, { itemId: item.id, quantity: 7, userId: null });
    await inventory.closeCount(knex, { userId: null }); // cria snapshot histórico
    await inventory.setCount(knex, { itemId: item.id, quantity: 3, userId: null }); // contagem aberta

    const r = await inventory.resetCurrentInventory(knex, { userId: null });
    expect(r.ok).toBe(true);

    const abertas = (await knex("inventory_counts").whereNull("snapshot_id").count("* as n"))[0].n;
    expect(Number(abertas)).toBe(0);
    const itens = (await knex("inventory_items").count("* as n"))[0].n;
    expect(Number(itens)).toBe(143);
    const preco = (await knex("inventory_items").where({ id: item.id }).first()).price;
    expect(Number(preco)).toBe(9.9);
    const snaps = (await knex("inventory_snapshots").count("* as n"))[0].n;
    expect(Number(snaps)).toBe(1); // histórico preservado
    const audit = (await knex("audit_log").where({ action: "inventory_reset" }).count("* as n"))[0].n;
    expect(Number(audit)).toBe(1);
  });
});
