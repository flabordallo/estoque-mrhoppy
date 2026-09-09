import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeDb, dropDb } from "./helper";
import { createServer } from "../backend/local-server";
import { users } from "../backend/src/services/catalog";

let knex, server, base;

beforeEach(async () => {
  knex = await makeDb();
  await users.create(knex, { data: { username: "admin", name: "Admin", password: "admin-123", role: "ADMIN" }, userId: null });
  await users.create(knex, { data: { username: "op", name: "Op", password: "op-123", role: "OPERATOR" }, userId: null });
  server = createServer(knex);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
afterEach(async () => { await new Promise((r) => server.close(r)); await dropDb(knex); });

async function login(username, password) {
  const res = await fetch(`${base}/api/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { res, cookie: res.headers.get("set-cookie") };
}

describe("API HTTP + RBAC", () => {
  it("bloqueia acesso sem sessão (401)", async () => {
    const res = await fetch(`${base}/api/state`);
    expect(res.status).toBe(401);
  });

  it("faz login e acessa o estado com o cookie", async () => {
    const { res, cookie } = await login("admin", "admin-123");
    expect(res.status).toBe(200);
    expect(cookie).toContain("sid=");
    const state = await fetch(`${base}/api/state`, { headers: { cookie } }).then((r) => r.json());
    expect(state.items.length).toBe(143);
  });

  it("OPERATOR NÃO consegue criar item (403)", async () => {
    const { cookie } = await login("op", "op-123");
    const res = await fetch(`${base}/api/items`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ category: "TESTE", name: "Item X", unit: "unidade" }),
    });
    expect(res.status).toBe(403);
  });

  it("OPERATOR consegue contar (permitido)", async () => {
    const { cookie } = await login("op", "op-123");
    const id = (await knex("inventory_items").first()).id;
    const res = await fetch(`${base}/api/count`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ itemId: id, quantity: 5 }),
    });
    expect(res.status).toBe(200);
  });

  it("ADMIN consegue criar item (permitido) e gera auditoria", async () => {
    const { cookie } = await login("admin", "admin-123");
    const res = await fetch(`${base}/api/items`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ category: "TESTE", name: "Item Novo", unit: "unidade", minimum: 2 }),
    });
    expect(res.status).toBe(201);
    const audit = await knex("audit_log").where({ action: "item_created" });
    expect(audit.length).toBe(1);
  });

  it("ADMIN consegue alterar preço de item e preço fica no estado", async () => {
    const { cookie } = await login("admin", "admin-123");
    const item = await knex("inventory_items").where({ name: "Coca lata 350ml" }).first();
    const res = await fetch(`${base}/api/items/${item.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ price: 7.5 }),
    });
    expect(res.status).toBe(200);
    const state = await fetch(`${base}/api/state`, { headers: { cookie } }).then((r) => r.json());
    expect(state.items.find((i) => i.id === String(item.id)).price).toBe(7.5);
  });

  it("ADMIN consegue alterar preço de chopp", async () => {
    const { cookie } = await login("admin", "admin-123");
    const product = await knex("chopp_products").first();
    const res = await fetch(`${base}/api/chopp/${product.id}/price`, {
      method: "PUT", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ price: 19.9 }),
    });
    expect(res.status).toBe(200);
    const state = await fetch(`${base}/api/state`, { headers: { cookie } }).then((r) => r.json());
    expect(state.chopp.find((i) => i.id === `chopp-${product.id}`).price).toBe(19.9);
  });

  it("OPERATOR não acessa usuários (403)", async () => {
    const { cookie } = await login("op", "op-123");
    const res = await fetch(`${base}/api/users`, { headers: { cookie } });
    expect(res.status).toBe(403);
  });
  it("ADMIN consegue preparar novo inventário", async () => {
    const { cookie } = await login("admin", "admin-123");
    const item = await knex("inventory_items").first();
    await fetch(`${base}/api/count`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ itemId: item.id, quantity: 99 }),
    });
    const res = await fetch(`${base}/api/reset`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const state = await fetch(`${base}/api/state`, { headers: { cookie } }).then((r) => r.json());
    expect(state.items.find((i) => i.id === String(item.id)).count).toBeNull();
  });

  it("OPERATOR não consegue resetar o inventário", async () => {
    const { cookie } = await login("op", "op-123");
    const res = await fetch(`${base}/api/reset`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

});
