import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeDb, dropDb } from "./helper";
import { parseOrder } from "../backend/src/services/purchase-parser";
import { preview, confirm, entriesSince } from "../backend/src/services/purchases";
import inventory from "../backend/src/services/inventory";
import { reports } from "../backend/src/services/catalog";
import { createServer } from "../backend/local-server";
import { users } from "../backend/src/services/catalog";

const WHATSAPP = `[14/09/2026, 10:27:31] Cezinha Summerhits: Bom dia Marcão

01 bisnaga queijo cheddar
500g pepperoni
01 perfex
02 cx hambúrguer de frango empanado
03kg bacon em cubos
 [14/09/2026, 10:30:11] Cezinha Summerhits: 01 Haus vermelho
02 chiclete verde
 [14/09/2026, 10:47:51] Cezinha Summerhits: Bom dia

07 Bacardi ouro
04 velho barreiro
02 Campari
 [14/09/2026, 10:48:05] Cezinha Summerhits: Bom dia

03 Red Bull normal
01 Red Bull tropical
Pra amanhã , valeuuuu`;

let knex;
beforeEach(async () => { knex = await makeDb(); });
afterEach(async () => { await dropDb(knex); });

describe("parser do pedido (texto real do WhatsApp)", () => {
  it("ignora carimbos e saudações, extrai só os itens", () => {
    const { items, ignored } = parseOrder(WHATSAPP);
    const descrs = items.map((i) => i.description);
    expect(descrs).toContain("bisnaga queijo cheddar");
    expect(descrs).toContain("Haus vermelho");          // linha colada no carimbo
    expect(descrs).toContain("Bacardi ouro");
    expect(descrs).toContain("Red Bull normal");
    // saudações fora
    expect(descrs.some((d) => /bom dia|valeu/i.test(d))).toBe(false);
    expect(ignored.some((l) => /Bom dia/.test(l))).toBe(true);
  });

  it("marca linhas de peso (500g, 03kg) para conferência", () => {
    const { items } = parseOrder(WHATSAPP);
    const pep = items.find((i) => i.description === "pepperoni");
    const bacon = items.find((i) => i.description === "bacon em cubos");
    expect(pep.isWeight).toBe(true);
    expect(bacon.isWeight).toBe(true);
  });

  it("trata embalagem no meio (02 cx …) sem confundir com quantidade", () => {
    const { items } = parseOrder(WHATSAPP);
    const hamb = items.find((i) => i.description.includes("hambúrguer"));
    expect(hamb.quantity).toBe(2);
    expect(hamb.unit).toBe("cx");
  });
});

describe("casamento com o estoque (preview)", () => {
  it("sugere o item certo para nomes conhecidos", async () => {
    const p = await preview(knex, WHATSAPP);
    const find = (d) => p.lines.find((l) => l.description === d);
    expect(find("Bacardi ouro").matchName).toBe("Bacardi Ouro");
    expect(find("Red Bull normal").matchName).toBe("Red Bull Normal");
    expect(find("bacon em cubos").matchName).toBe("Bacon em cubos");
    expect(find("Campari").matchName).toBe("Campari");
  });
  it("oferece candidatos para escolha quando não tem certeza", async () => {
    const p = await preview(knex, "10 coisa inexistente xyz");
    expect(p.lines[0].matchItemId).toBeNull();
    expect(Array.isArray(p.lines[0].candidates)).toBe(true);
  });
});

describe("gravação de entrada (confirm)", () => {
  it("grava só linhas válidas, com data", async () => {
    const item = await knex("inventory_items").where({ name: "Bacardi Ouro" }).first();
    const r = await confirm(knex, { lines: [{ inventoryItemId: item.id, description: "Bacardi ouro", quantity: 7, unit: null }], entryDate: "2026-09-14", userId: null });
    expect(r.ok).toBe(true);
    expect(r.inserted).toBe(1);
    const row = await knex("stock_entries").first();
    expect(Number(row.quantity)).toBe(7);
    expect(String(row.entry_date).slice(0, 10)).toBe("2026-09-14");
  });
  it("rejeita item de estoque inexistente e quantidade inválida", async () => {
    const bad = await confirm(knex, { lines: [{ inventoryItemId: 999999, quantity: 5 }], userId: null });
    expect(bad.ok).toBe(false);
    const item = await knex("inventory_items").first();
    const badQty = await confirm(knex, { lines: [{ inventoryItemId: item.id, quantity: 0 }], userId: null });
    expect(badQty.ok).toBe(false);
  });
  it("registra na auditoria", async () => {
    const item = await knex("inventory_items").first();
    await confirm(knex, { lines: [{ inventoryItemId: item.id, quantity: 3 }], userId: null });
    const audit = await knex("audit_log").where({ action: "stock_entry_added" });
    expect(audit.length).toBe(1);
  });
});

describe("consumo com entradas (base + entradas − atual)", () => {
  it("soma as entradas do período no consumo", async () => {
    const coca = await knex("inventory_items").where({ name: "Coca lata 350ml" }).first();
    await inventory.setCount(knex, { itemId: coca.id, quantity: 30, userId: null });
    await inventory.closeCount(knex, { userId: null }); // base = 30
    // chega mercadoria: +24
    await confirm(knex, { lines: [{ inventoryItemId: coca.id, quantity: 24 }], entryDate: new Date().toISOString().slice(0, 10), userId: null });
    // recontagem final: 40
    await inventory.setCount(knex, { itemId: coca.id, quantity: 40, userId: null });
    const cons = await reports.consumption(knex, inventory.buildState);
    const c = cons.find((x) => x.name === "Coca lata 350ml");
    // consumo = 30 + 24 − 40 = 14
    expect(c.consumed).toBe(14);
    expect(c.entered).toBe(24);
  });
});

describe("permissões (operador vê, manager lança, operador não lança)", () => {
  let server, base;
  beforeEach(async () => {
    await users.create(knex, { data: { username: "op", name: "Op", password: "p-123", role: "OPERATOR" }, userId: null });
    await users.create(knex, { data: { username: "mng", name: "Mng", password: "p-123", role: "MANAGER" }, userId: null });
    server = createServer(knex);
    await new Promise((r) => server.listen(0, r));
    base = `http://localhost:${server.address().port}`;
  });
  afterEach(async () => { await new Promise((r) => server.close(r)); });
  const login = async (u) => (await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: "p-123" }) })).headers.get("set-cookie");

  it("operador NÃO pode lançar entrada (403), mas pode visualizar recentes", async () => {
    const cookie = await login("op");
    const conf = await fetch(`${base}/api/purchases/confirm`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ lines: [] }) });
    expect(conf.status).toBe(403);
    const recent = await fetch(`${base}/api/purchases/recent`, { headers: { cookie } });
    expect(recent.status).toBe(200);
  });
  it("manager PODE pré-visualizar e lançar", async () => {
    const cookie = await login("mng");
    const prev = await fetch(`${base}/api/purchases/preview`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ text: "07 Bacardi ouro" }) });
    expect(prev.status).toBe(200);
    const item = await knex("inventory_items").where({ name: "Bacardi Ouro" }).first();
    const conf = await fetch(`${base}/api/purchases/confirm`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ lines: [{ inventoryItemId: item.id, quantity: 7 }] }) });
    expect(conf.status).toBe(200);
  });
});


describe("v2.3.1 — conversões, histórico e duplicidade", () => {
  it("converte caixa quando a regra está cadastrada", async () => {
    const item = await knex("inventory_items").where({ name: "Bacardi Ouro" }).first();
    await knex("inventory_items").where({ id: item.id }).update({ unit: "unidade", conversions: JSON.stringify([{ from: "cx", factor: 12 }]) });
    const r = await confirm(knex, { lines: [{ inventoryItemId: item.id, description: "2 cx Bacardi ouro", quantity: 2, unit: "cx" }], entryDate: "2026-09-14", userId: null });
    expect(r.ok).toBe(true);
    const row = await knex("stock_entries").first();
    expect(Number(row.quantity)).toBe(24);
    expect(Number(row.original_quantity)).toBe(2);
    expect(Number(row.conversion_factor)).toBe(12);
  });
  it("Modelo A: unidade sem regra entra 1:1 (não bloqueia)", async () => {
    const item = await knex("inventory_items").where({ name: "Bacardi Ouro" }).first();
    await knex("inventory_items").where({ id: item.id }).update({ unit: "unidade", conversions: null });
    const r = await confirm(knex, { lines: [{ inventoryItemId: item.id, description: "2 cx Bacardi ouro", quantity: 2, unit: "cx" }], entryDate: "2026-09-14", userId: null });
    expect(r.ok).toBe(true);
    const row = await knex("stock_entries").orderBy("id", "desc").first();
    expect(Number(row.quantity)).toBe(2);
    expect(Number(row.conversion_factor)).toBe(1);
  });
  it("bloqueia repetição do mesmo texto na mesma data", async () => {
    const item = await knex("inventory_items").first();
    const args = { lines: [{ inventoryItemId: item.id, description: "3 unidades", quantity: 3, unit: "un" }], entryDate: "2026-09-14", sourceText: "3 unidades\n" + item.name, userId: null };
    expect((await confirm(knex, args)).ok).toBe(true);
    const second = await confirm(knex, args);
    expect(second).toMatchObject({ ok: false, status: 409 });
  });
  it("não inclui entrada registrada antes do fechamento no mesmo dia", async () => {
    const item = await knex("inventory_items").first();
    await knex("stock_entries").insert({ inventory_item_id: item.id, description: "antes", quantity: 10, unit: item.unit, entry_date: "2026-09-14", created_at: "2026-09-14 02:00:00" });
    await knex("stock_entries").insert({ inventory_item_id: item.id, description: "depois", quantity: 20, unit: item.unit, entry_date: "2026-09-14", created_at: "2026-09-14 04:00:00" });
    const map = await entriesSince(knex, "2026-09-14 03:00:00");
    expect(map.get(item.id)).toBe(20);
  });

  // Regressão: em produção (PostgreSQL) o driver devolve closed_at como objeto Date,
  // não string. String(Date).slice(0,10) viraria "Tue Sep 14" e quebraria a fronteira.
  // entriesSince deve tratar Date exatamente como a string equivalente em UTC.
  it("trata a fronteira igual quando o timestamp vem como Date (caminho PostgreSQL)", async () => {
    const item = await knex("inventory_items").first();
    await knex("stock_entries").insert({ inventory_item_id: item.id, description: "antes", quantity: 10, unit: item.unit, entry_date: "2026-09-14", created_at: "2026-09-14 02:00:00" });
    await knex("stock_entries").insert({ inventory_item_id: item.id, description: "depois", quantity: 20, unit: item.unit, entry_date: "2026-09-14", created_at: "2026-09-14 04:00:00" });
    const boundaryAsDate = new Date("2026-09-14T03:00:00Z"); // como o PostgreSQL entregaria
    const map = await entriesSince(knex, boundaryAsDate);
    expect(map.get(item.id)).toBe(20); // apenas a entrada posterior ao fechamento
  });

  it("normalizeStamp devolve o mesmo valor UTC para string do SQLite e Date do PostgreSQL", async () => {
    const { normalizeStamp } = await import("../backend/src/services/purchases");
    expect(normalizeStamp("2026-09-14 03:00:00")).toBe("2026-09-14 03:00:00");
    expect(normalizeStamp(new Date("2026-09-14T03:00:00Z"))).toBe("2026-09-14 03:00:00");
    expect(normalizeStamp("2026-09-14T03:00:00.000Z")).toBe("2026-09-14 03:00:00");
  });
});
