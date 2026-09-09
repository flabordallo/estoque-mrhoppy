// Roteador da API: recebe requisição normalizada e devolve { status, headers, body }.
// Usado tanto pela Netlify Function quanto pelo servidor local de dev/testes.
// TODA permissão é verificada aqui (backend), nunca só no frontend.
const { db } = require("./db");
const { parseCookies, serializeCookie } = require("./util");
const { login, logout, getSessionUser, SESSION_HOURS } = require("./auth");
const { atLeast } = require("./rbac");
const inventory = require("./services/inventory");
const { items, chopp, users, reports } = require("./services/catalog");
const { buildWorkbook, exportAll, importAll } = require("./services/export");

const isProd = process.env.NODE_ENV === "production";

function json(status, body, extraHeaders = {}) {
  return { status, headers: { "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify(body) };
}
const sessionCookie = (token, maxAge) =>
  serializeCookie("sid", token, { httpOnly: true, sameSite: "Lax", secure: isProd, maxAge, path: "/" });

async function handleRequest(req) {
  const knex = req.knex || db();
  const method = req.method.toUpperCase();
  const path = req.path.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  const body = typeof req.body === "string" && req.body ? safeJson(req.body) : req.body || {};
  const cookies = parseCookies(req.headers?.cookie || req.headers?.Cookie);
  const ip = req.headers?.["x-forwarded-for"] || req.ip || null;

  // ---- rotas públicas ----
  if (method === "POST" && path === "/login") {
    const r = await login(knex, { username: body.username, password: body.password, ip, userAgent: req.headers?.["user-agent"] });
    if (!r.ok) return json(r.status, { error: r.error });
    return json(200, { user: r.user }, { "Set-Cookie": sessionCookie(r.token, SESSION_HOURS * 3600) });
  }

  // ---- autenticação obrigatória a partir daqui ----
  const auth = await getSessionUser(knex, cookies.sid);
  if (!auth) return json(401, { error: "Não autenticado." });
  const { user } = auth;
  const uid = user.id;

  const need = (role) => atLeast(user.role, role);

  try {
    if (method === "POST" && path === "/logout") {
      await logout(knex, cookies.sid, uid);
      return json(200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
    }
    if (method === "GET" && path === "/me") return json(200, { user });
    if (method === "GET" && path === "/state") return json(200, await inventory.buildState(knex));

    // contagem — OPERATOR+
    if (method === "POST" && path === "/count") {
      const r = await inventory.setCount(knex, { itemId: body.itemId, quantity: body.quantity, userId: uid });
      return r.ok ? json(200, { ok: true }) : json(r.status, { error: r.error });
    }
    // reset do ciclo atual — ADMIN
    if (method === "POST" && path === "/reset") {
      if (!need("ADMIN")) return json(403, { error: "Sem permissão." });
      const r = await inventory.resetCurrentInventory(knex, { userId: uid });
      return json(200, r);
    }

    if (method === "POST" && path === "/close") {
      if (!need("MANAGER")) return json(403, { error: "Sem permissão." });
      const r = await inventory.closeCount(knex, { userId: uid });
      return json(200, r);
    }

    // chopp — MANAGER+
    if (method === "POST" && path === "/chopp/tap") {
      if (!need("MANAGER")) return json(403, { error: "Sem permissão." });
      return json(200, await chopp.setTap(knex, { productId: body.productId, position: body.position || 1, level: body.level, userId: uid }));
    }
    if (method === "POST" && path === "/chopp/reserve") {
      if (!need("MANAGER")) return json(403, { error: "Sem permissão." });
      return json(200, await chopp.setReserve(knex, { productId: body.productId, barrels: body.barrels, userId: uid }));
    }

    // preços do chopp — ADMIN
    if (method === "PUT" && path.startsWith("/chopp/") && path.endsWith("/price")) {
      if (!need("ADMIN")) return json(403, { error: "Sem permissão." });
      const parts = path.split("/");
      const productId = Number(parts[2]);
      const r = await chopp.setPrice(knex, { productId, price: body.price, userId: uid });
      return r.ok ? json(200, r) : json(r.status, { error: r.error });
    }

    // catálogo — ADMIN
    if (method === "POST" && path === "/items") {
      if (!need("ADMIN")) return json(403, { error: "Sem permissão." });
      const r = await items.create(knex, { data: body, userId: uid });
      return r.ok ? json(201, r) : json(r.status, { error: r.error });
    }
    if (method === "PUT" && path.startsWith("/items/")) {
      if (!need("ADMIN")) return json(403, { error: "Sem permissão." });
      const r = await items.update(knex, { id: Number(path.split("/")[2]), data: body, userId: uid });
      return r.ok ? json(200, r) : json(r.status, { error: r.error });
    }
    if (method === "DELETE" && path.startsWith("/items/")) {
      if (!need("ADMIN")) return json(403, { error: "Sem permissão." });
      const r = await items.remove(knex, { id: Number(path.split("/")[2]), userId: uid });
      return r.ok ? json(200, r) : json(r.status, { error: r.error });
    }

    // usuários — ADMIN
    if (path === "/users") {
      if (!need("ADMIN")) return json(403, { error: "Sem permissão." });
      if (method === "GET") return json(200, { users: await users.list(knex) });
      if (method === "POST") { const r = await users.create(knex, { data: body, userId: uid }); return r.ok ? json(201, r) : json(r.status, { error: r.error }); }
    }
    if (method === "PUT" && path.startsWith("/users/")) {
      if (!need("ADMIN")) return json(403, { error: "Sem permissão." });
      const r = await users.update(knex, { id: Number(path.split("/")[2]), data: body, userId: uid });
      return r.ok ? json(200, r) : json(r.status, { error: r.error });
    }

    // relatórios — qualquer autenticado
    if (method === "GET" && path === "/reports/dashboard") return json(200, await reports.dashboard(knex, inventory.buildState));
    if (method === "GET" && path === "/reports/below-minimum") return json(200, { items: await reports.belowMinimum(knex, inventory.buildState) });
    if (method === "GET" && path === "/reports/consumption") return json(200, { items: await reports.consumption(knex, inventory.buildState) });
    if (method === "GET" && path === "/reports/chopp-critical") return json(200, { items: await reports.choppCritical(knex, inventory.buildState) });
    if (method === "GET" && path === "/reports/audit") return json(200, { items: await reports.recentChanges(knex, 100) });
    if (method === "GET" && path === "/reports/snapshots") return json(200, { items: await reports.snapshots(knex) });

    // exportação XLSX — MANAGER+
    if (method === "GET" && path === "/export/xlsx") {
      if (!need("MANAGER")) return json(403, { error: "Sem permissão." });
      const buffer = await buildWorkbook(knex, inventory.buildState, reports);
      return {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="estoque-bar.xlsx"',
        },
        isBase64Encoded: true,
        body: Buffer.from(buffer).toString("base64"),
      };
    }

    // backup / restauração — ADMIN
    if (method === "GET" && path === "/backup") {
      if (!need("ADMIN")) return json(403, { error: "Sem permissão." });
      return json(200, await exportAll(knex, uid));
    }
    if (method === "POST" && path === "/restore") {
      if (!need("ADMIN")) return json(403, { error: "Sem permissão." });
      const r = await importAll(knex, body, uid);
      return r.ok ? json(200, { ok: true }) : json(r.status, { error: r.error });
    }

    return json(404, { error: "Rota não encontrada." });
  } catch (e) {
    return json(500, { error: "Erro interno.", detail: String(e && e.message || e) });
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

module.exports = { handleRequest };
