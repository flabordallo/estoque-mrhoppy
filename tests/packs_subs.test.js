import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeDb, dropDb } from "./helper";
import { preview, confirm, listSubstitutions, addSubstitution, removeSubstitution } from "../backend/src/services/purchases";
import { items as itemsSvc } from "../backend/src/services/catalog";
import inventory from "../backend/src/services/inventory";
import { createServer } from "../backend/local-server";
import { users } from "../backend/src/services/catalog";

let knex;
beforeEach(async () => { knex = await makeDb(); await knex.seed.run({ specific: "03_packs_subs.js" }); });
afterEach(async () => { await dropDb(knex); });

describe("Modelo A — unidades por pacote", () => {
  it("seed define unidade-base igual à unidade existente", async () => {
    const coca = await knex("inventory_items").where({ name: "Coca lata 350ml" }).first();
    const pao = await knex("inventory_items").where({ name: "Pão Branco" }).first();
    expect(coca.base_unit).toBe(coca.unit);
    expect(pao.base_unit).toBe(pao.unit);
  });
  it("seed define os tamanhos de pacote das bebidas", async () => {
    const coca = await knex("inventory_items").where({ name: "Coca lata 350ml" }).first();
    const cocaZero = await knex("inventory_items").where({ name: "Coca zero 350ml" }).first();
    const agua = await knex("inventory_items").where({ name: "Água com gás" }).first();
    expect(Number(coca.units_per_pack)).toBe(12);
    expect(Number(cocaZero.units_per_pack)).toBe(6);
    expect(Number(agua.units_per_pack)).toBe(12);
  });
  it("aparece no estado (buildState) como unitsPerPack", async () => {
    const s = await inventory.buildState(knex);
    const coca = s.items.find((i) => i.name === "Coca lata 350ml");
    expect(coca.unitsPerPack).toBe(12);
  });
  it("é editável pelo cadastro do item", async () => {
    const item = await knex("inventory_items").where({ name: "Sprite" }).first();
    await itemsSvc.update(knex, { id: item.id, data: { unitsPerPack: 24 }, userId: null });
    const after = await knex("inventory_items").where({ id: item.id }).first();
    expect(Number(after.units_per_pack)).toBe(24);
  });
});

describe("Compras em pacotes (unidade nunca invalida)", () => {
  it("pedido em pacote entra 1:1 sem erro de conversão ('03 pc Campari')", async () => {
    const p = await preview(knex, "03 pc Campari");
    const l = p.lines[0];
    expect(l.matchName).toBe("Campari");
    expect(l.conversionOk).toBe(true);
    expect(l.conversionFactor).toBe(1);
    expect(l.convertedQuantity).toBe(3);
  });
  it("unidade desconhecida do fornecedor não trava o lançamento", async () => {
    const coca = await knex("inventory_items").where({ name: "Coca lata 350ml" }).first();
    const r = await confirm(knex, { lines: [{ inventoryItemId: coca.id, description: "coca", quantity: 3, unit: "engradado" }], userId: null });
    expect(r.ok).toBe(true);
  });
  it("pacote entra 1:1 na unidade de contagem (units_per_pack fica para o PDV, Fase 3)", async () => {
    // Item contado em PACOTE, base em UNIDADE. A compra em pacotes NÃO é
    // expandida para unidades no lançamento: isso misturaria unidades na
    // contagem. A conversão pacote→unidade é do consumo do PDV (Fase 3).
    const item = await knex("inventory_items").where({ name: "Coca zero 350ml" }).first();
    await itemsSvc.update(knex, { id: item.id, data: { unit: "pacote", baseUnit: "unidade", unitsPerPack: 6 }, userId: null });
    const p = await preview(knex, "02 pct Coca zero 350ml");
    const l = p.lines[0];
    expect(l.conversionOk).toBe(true);
    expect(l.conversionFactor).toBe(1);       // 1:1 — entra em pacotes
    expect(l.convertedQuantity).toBe(2);      // 2 pacotes, não 12 unidades
    expect(l.convertedUnit).toBe("pacote");   // na unidade de contagem
  });

  it("compra em pacote não corrompe a contagem quando base_unit difere (2 pacotes → +2)", async () => {
    const item = await knex("inventory_items").where({ name: "Coca zero 350ml" }).first();
    await itemsSvc.update(knex, { id: item.id, data: { unit: "pacote", baseUnit: "unidade", unitsPerPack: 6 }, userId: null });
    await inventory.setCount(knex, { itemId: item.id, quantity: 5, userId: null }); // 5 pacotes
    await confirm(knex, { lines: [{ inventoryItemId: item.id, description: "coca zero", quantity: 2, unit: "pacote" }], userId: null });
    const s = await inventory.buildState(knex);
    const it = s.items.find((i) => i.id === String(item.id));
    expect(it.count).toBe(7); // 5 + 2 pacotes — sem mistura de unidades
  });
  it("regra explícita de conversão ainda é aplicada (cx=36)", async () => {
    const item = await knex("inventory_items").where({ name: "Perfex" }).first();
    await itemsSvc.update(knex, { id: item.id, data: { conversions: "cx=36" }, userId: null });
    const p = await preview(knex, "02 cx perfex");
    const l = p.lines[0];
    expect(l.conversionFactor).toBe(36);
    expect(l.convertedQuantity).toBe(72);
  });
});

describe("Substituições do leitor", () => {
  it("casa nomes do fornecedor pelo dicionário (rolão, sachê, pc)", async () => {
    const p = await preview(knex, "01 fardo papel higiênico rolão\n05 cx catchup heinz sachê\n02 pc queijo mozzarella");
    const names = p.lines.map((l) => l.matchName);
    expect(names).toContain("Papel higiênico rolo");
    expect(names).toContain("Catchup Heinz");
    expect(names).toContain("Queijo mozzarela");
    expect(p.lines.every((l) => l.matchedBy === "dicionario")).toBe(true);
  });
  it("adiciona e remove substituição", async () => {
    const item = await knex("inventory_items").where({ name: "Sprite" }).first();
    const add = await addSubstitution(knex, { fromText: "refri verde", inventoryItemId: item.id, userId: null });
    expect(add.ok).toBe(true);
    const p = await preview(knex, "04 refri verde");
    expect(p.lines[0].matchName).toBe("Sprite");
    const list = await listSubstitutions(knex);
    const row = list.find((x) => x.fromText === "refri verde");
    const rem = await removeSubstitution(knex, { id: row.id, userId: null });
    expect(rem.ok).toBe(true);
  });
});

describe("Permissões das substituições", () => {
  let server, base;
  beforeEach(async () => {
    await users.create(knex, { data: { username: "mng", name: "M", password: "p-123", role: "MANAGER" }, userId: null });
    await users.create(knex, { data: { username: "adm", name: "A", password: "p-123", role: "ADMIN" }, userId: null });
    server = createServer(knex);
    await new Promise((r) => server.listen(0, r));
    base = `http://localhost:${server.address().port}`;
  });
  afterEach(async () => { await new Promise((r) => server.close(r)); });
  const login = async (u) => (await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: "p-123" }) })).headers.get("set-cookie");

  it("manager vê o dicionário mas NÃO edita; admin edita", async () => {
    const item = await knex("inventory_items").first();
    const cM = await login("mng");
    expect((await fetch(`${base}/api/purchases/substitutions`, { headers: { cookie: cM } })).status).toBe(200);
    const addM = await fetch(`${base}/api/purchases/substitutions`, { method: "POST", headers: { "Content-Type": "application/json", cookie: cM }, body: JSON.stringify({ fromText: "x", inventoryItemId: item.id }) });
    expect(addM.status).toBe(403);
    const cA = await login("adm");
    const addA = await fetch(`${base}/api/purchases/substitutions`, { method: "POST", headers: { "Content-Type": "application/json", cookie: cA }, body: JSON.stringify({ fromText: "x", inventoryItemId: item.id }) });
    expect(addA.status).toBe(200);
  });
});
