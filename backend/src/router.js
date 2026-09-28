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
const pdv = require("./services/pdv");
const purchases = require("./services/purchases");
const pdvSales = require("./services/pdv-sales");
const owner = require("./services/owner");

const isProd = process.env.NODE_ENV === "production";

function json(status, body, extraHeaders = {}) {
  return { status, headers: { "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify(body) };
}
const sessionCookie = (token, maxAge) =>
  serializeCookie("sid", token, { httpOnly: true, sameSite: "Lax", secure: isProd, maxAge, path: "/" });

async function handleRequest(req) {
  const knex = req.knex || db();
  const method = req.method.toUpperCase();
  const rawPath = String(req.path || "/");
  const qIdx = rawPath.indexOf("?");
  const query = req.query || (qIdx >= 0 ? Object.fromEntries(new URLSearchParams(rawPath.slice(qIdx + 1))) : {});
  req.query = query;
  const path = (qIdx >= 0 ? rawPath.slice(0, qIdx) : rawPath).replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  const body = typeof req.body === "string" && req.body ? safeJson(req.body) : req.body || {};
  const cookies = parseCookies(req.headers?.cookie || req.headers?.Cookie);
  const ip = req.headers?.["x-forwarded-for"] || req.ip || null;

  // ---- rotas públicas ----
  if (method === "GET" && path === "/version") return json(200, { version: "2.5.2", app: "Estoque do Bar" });
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

    // contagem — somente MANAGER+; OPERATOR apenas visualiza o estoque.
    if (method === "POST" && path === "/count") {
      if (!need("MANAGER")) return json(403, { error: "Sem permissão." });
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

    // relatórios — MANAGER+
    if (path.startsWith("/reports/")) {
      if (!need("MANAGER")) return json(403, { error: "Sem permissão." });
      if (method === "GET" && path === "/reports/dashboard") return json(200, await reports.dashboard(knex, inventory.buildState));
      if (method === "GET" && path === "/reports/below-minimum") return json(200, { items: await reports.belowMinimum(knex, inventory.buildState) });
      if (method === "GET" && path === "/reports/consumption") return json(200, { items: await reports.consumption(knex, inventory.buildState) });
      if (method === "GET" && path === "/reports/chopp-critical") return json(200, { items: await reports.choppCritical(knex, inventory.buildState) });
      if (method === "GET" && path === "/reports/audit") return json(200, { items: await reports.recentChanges(knex, 100) });
      if (method === "GET" && path === "/reports/snapshots") return json(200, { items: await reports.snapshots(knex) });
    }

    // ---- Compras / Entradas (MANAGER+; operador só visualiza) ----
    if (method === "POST" && path === "/purchases/preview") {
      if (!need("MANAGER")) return json(403, { error: "Sem permissão." });
      return json(200, await purchases.preview(knex, body.text || ""));
    }
    if (method === "POST" && path === "/purchases/confirm") {
      if (!need("MANAGER")) return json(403, { error: "Sem permissão." });
      const r = await purchases.confirm(knex, { lines: body.lines, entryDate: body.entryDate, userId: uid, sourceText: body.sourceText });
      return r.ok ? json(200, r) : json(r.status, { error: r.error });
    }
    if (method === "GET" && path === "/purchases/recent") {
      return json(200, { items: await purchases.listRecent(knex, 50) });
    }
    // Dicionário de substituições do leitor (ver: MANAGER+; editar: ADMIN)
    if (method === "GET" && path === "/purchases/substitutions") {
      if (!need("MANAGER")) return json(403, { error: "Sem permissão." });
      return json(200, { items: await purchases.listSubstitutions(knex) });
    }
    if (method === "POST" && path === "/purchases/substitutions") {
      if (!need("ADMIN")) return json(403, { error: "Sem permissão." });
      const r = await purchases.addSubstitution(knex, { fromText: body.fromText, inventoryItemId: body.inventoryItemId, userId: uid });
      return r.ok ? json(200, r) : json(r.status, { error: r.error });
    }
    if (method === "DELETE" && path.startsWith("/purchases/substitutions/")) {
      if (!need("ADMIN")) return json(403, { error: "Sem permissão." });
      const r = await purchases.removeSubstitution(knex, { id: path.split("/").pop(), userId: uid });
      return r.ok ? json(200, r) : json(r.status, { error: r.error });
    }

    // ---- PDV (Fase 1) ----
    if (method === "GET" && path === "/pdv/catalog") return json(200, await pdv.getCatalog(knex));
    if (method === "GET" && path === "/pdv/link-report") {
      if (!need("MANAGER")) return json(403, { error: "Sem permissão." });
      return json(200, await pdv.linkReport(knex));
    }
    // venda imediata — OPERATOR+
    if (method === "POST" && path === "/pdv/sales") {
      const r = await pdvSales.createSale(knex, {
        reference: body.reference,
        plate: body.plate,
        place: body.place,
        items: body.items,
        userId: uid,
      });
      return r.ok ? json(201, r) : json(r.status || 400, { error: r.error });
    }
    // resumo de vendas — MANAGER+
    if (method === "GET" && path === "/pdv/sales/summary") {
      if (!need("MANAGER")) return json(403, { error: "Sem permissão." });
      return json(200, await pdvSales.salesSummary(knex));
    }
    if (method === "GET" && /^\/pdv\/sales\/\d+$/.test(path)) {
      if (!need("MANAGER")) return json(403, { error: "Sem permissão." });
      const r = await pdvSales.saleDetail(knex, path.split("/").pop());
      return r.ok ? json(200, r) : json(r.status, { error: r.error });
    }

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

    // ---- Aba do Dono — ADMIN ----
    if (path.startsWith("/owner/")) {
      if (!need("ADMIN")) return json(403, { error: "Sem permissão." });
      // resumo consolidado dos três períodos (gasto + ganho)
      if (method === "GET" && path === "/owner/summary") {
        return json(200, await owner.summary(knex));
      }
      // relatório diário de vendas para conferência (data = dia de bar)
      if (method === "GET" && path === "/owner/sales-report") {
        const date = (req.query && req.query.date) || owner.barDateStr(new Date());
        return json(200, await owner.salesReport(knex, date));
      }
      // compras automáticas: texto pronto + dados por empresa
      if (method === "GET" && path === "/owner/purchase-order") {
        const data = await owner.shortageByCompany(knex);
        return json(200, { ...data, text: owner.buildOrderText(data) });
      }
      // download do texto do pedido (.txt)
      if (method === "GET" && path === "/owner/order-txt") {
        const data = await owner.shortageByCompany(knex);
        const text = `# ${owner.BAR_NAME} — pedido gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}\n\n` + owner.buildOrderText(data);
        return {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": 'attachment; filename="pedido-compra.txt"' },
          body: text,
        };
      }
      // planilha consolidada (.xlsx)
      if (method === "GET" && path === "/owner/xlsx") {
        const period = (req.query && req.query.period) || "dia";
        const buffer = await owner.ownerWorkbook(knex, { period });
        return {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": 'attachment; filename="relatorio-dono.xlsx"',
          },
          isBase64Encoded: true,
          body: Buffer.from(buffer).toString("base64"),
        };
      }
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
