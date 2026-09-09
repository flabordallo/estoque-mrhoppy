import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeDb, dropDb } from "./helper";
import { hashPassword, verifyPassword, login, getSessionUser } from "../backend/src/auth";
import { users } from "../backend/src/services/catalog";

let knex;
beforeEach(async () => {
  knex = await makeDb();
  await users.create(knex, { data: { username: "admin", name: "Admin", password: "senha-admin-1", role: "ADMIN" }, userId: null });
  await users.create(knex, { data: { username: "op", name: "Operador", password: "senha-op-1", role: "OPERATOR" }, userId: null });
});
afterEach(async () => { await dropDb(knex); });

describe("senhas", () => {
  it("faz hash e nunca guarda em texto puro", async () => {
    const h = await hashPassword("segredo");
    expect(h).not.toBe("segredo");
    expect(await verifyPassword("segredo", h)).toBe(true);
    expect(await verifyPassword("errado", h)).toBe(false);
  });
  it("o hash no banco não é a senha", async () => {
    const u = await knex("users").where({ username: "admin" }).first();
    expect(u.password_hash).not.toContain("senha-admin-1");
  });
});

describe("login", () => {
  it("aceita credenciais válidas e cria sessão", async () => {
    const r = await login(knex, { username: "admin", password: "senha-admin-1" });
    expect(r.ok).toBe(true);
    expect(r.user.role).toBe("ADMIN");
    const s = await getSessionUser(knex, r.token);
    expect(s.user.username).toBe("admin");
  });
  it("rejeita senha inválida", async () => {
    const r = await login(knex, { username: "admin", password: "errada" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
  it("bloqueia após 5 tentativas (rate limit)", async () => {
    for (let i = 0; i < 5; i++) await login(knex, { username: "admin", password: "x", ip: "1.1.1.1" });
    const r = await login(knex, { username: "admin", password: "senha-admin-1", ip: "1.1.1.1" });
    expect(r.status).toBe(429);
  });
  it("registra login e login_failed na auditoria", async () => {
    await login(knex, { username: "admin", password: "senha-admin-1" });
    await login(knex, { username: "admin", password: "errada" });
    const ok = await knex("audit_log").where({ action: "login" });
    const fail = await knex("audit_log").where({ action: "login_failed" });
    expect(ok.length).toBe(1);
    expect(fail.length).toBe(1);
  });
});
