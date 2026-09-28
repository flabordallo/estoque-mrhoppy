// Catálogo de itens, chopp, usuários e relatórios.
const { record } = require("../audit");
const { hashPassword, publicUser } = require("../auth");
const { num, str } = require("../util");
const { labelForLevel } = require("./inventory");

// ---------------- Itens (catálogo) ----------------
const items = {
  async create(knex, { data, userId }) {
    const category = str(data.category).trim();
    const name = str(data.name).trim();
    if (!category || !name) return { ok: false, status: 400, error: "Categoria e nome são obrigatórios." };
    const exists = await knex("inventory_items").where({ category, name }).first();
    if (exists) return { ok: false, status: 409, error: "Item já existe nessa categoria." };
    const max = (await knex("inventory_items").max("sort_order as m"))[0].m || 0;
    const row = {
      category,
      name,
      unit: str(data.unit).trim() || "unidade",
      base_unit: str(data.baseUnit ?? data.base_unit).trim() || str(data.unit).trim() || "unidade",
      minimum: num(data.minimum),
      price: num(data.price),
      purchase_price: num(data.purchasePrice ?? data.purchase_price),
      utility_price: num(data.utilityPrice ?? data.utility_price),
      conversions: normalizeConversions(data.conversions),
      units_per_pack: Math.max(1, Math.round(Number(data.unitsPerPack ?? data.units_per_pack) || 1)),
      sort_order: max + 1,
      active: true
    };
    const [ins] = await knex("inventory_items").insert(row).returning("id");
    const id = typeof ins === "object" ? ins.id : ins;
    await record(knex, { userId, action: "item_created", entityType: "inventory_item", entityId: id, newValue: row });
    return { ok: true, id };
  },
  async update(knex, { id, data, userId }) {
    const old = await knex("inventory_items").where({ id }).first();
    if (!old) return { ok: false, status: 404, error: "Item não encontrado." };
    const next = {
      category: str(data.category).trim() || old.category,
      name: str(data.name).trim() || old.name,
      unit: str(data.unit).trim() || old.unit,
      base_unit: data.baseUnit === undefined && data.base_unit === undefined
        ? old.base_unit
        : (str(data.baseUnit ?? data.base_unit).trim() || old.base_unit),
      minimum: data.minimum === undefined ? old.minimum : num(data.minimum),
      price: data.price === undefined ? old.price : num(data.price),
      purchase_price: (data.purchasePrice === undefined && data.purchase_price === undefined) ? old.purchase_price : num(data.purchasePrice ?? data.purchase_price),
      utility_price: (data.utilityPrice === undefined && data.utility_price === undefined) ? old.utility_price : num(data.utilityPrice ?? data.utility_price),
      conversions: data.conversions === undefined ? old.conversions : normalizeConversions(data.conversions),
      units_per_pack: data.unitsPerPack === undefined && data.units_per_pack === undefined
        ? old.units_per_pack
        : Math.max(1, Math.round(Number(data.unitsPerPack ?? data.units_per_pack) || 1)),
      updated_at: new Date().toISOString(),
    };
    await knex("inventory_items").where({ id }).update(next);
    await record(knex, { userId, action: "item_updated", entityType: "inventory_item", entityId: id,
      oldValue: {
        category: old.category,
        name: old.name,
        unit: old.unit,
        base_unit: old.base_unit,
        minimum: old.minimum,
        price: old.price,
        conversions: old.conversions
      }, newValue: next });
    return { ok: true };
  },
  async remove(knex, { id, userId }) {
    const old = await knex("inventory_items").where({ id }).first();
    if (!old) return { ok: false, status: 404, error: "Item não encontrado." };
    await knex("inventory_items").where({ id }).update({ active: false });
    await record(knex, { userId, action: "item_deleted", entityType: "inventory_item", entityId: id, oldValue: { name: old.name } });
    return { ok: true };
  },
};


function normalizeConversions(value) {
  if (!value) return null;
  try {
    let arr;
    if (typeof value === "string") {
      try { arr = JSON.parse(value); } catch {
        arr = value.split(/[;,]/).map((part) => { const [from, factor] = part.split("="); return { from, factor }; });
      }
    } else arr = value;
    if (!Array.isArray(arr)) return null;
    const clean = arr.map((x) => ({ from: String(x.from || "").trim().toLowerCase(), factor: Number(x.factor) }))
      .filter((x) => x.from && Number.isFinite(x.factor) && x.factor > 0 && x.factor <= 100000);
    return clean.length ? JSON.stringify(clean) : null;
  } catch { return null; }
}

// ---------------- Chopp ----------------
const chopp = {
  async setTap(knex, { productId, position = 1, level, userId }) {
    const pid = Number(String(productId).replace("chopp-", ""));
    const tap = await knex("chopp_taps").where({ product_id: pid, position }).first();
    const lvl = num(level);
    const data = { product_id: pid, position, level_pct: lvl, level_label: labelForLevel(lvl) };
    if (tap) await knex("chopp_taps").where({ id: tap.id }).update(data);
    else await knex("chopp_taps").insert(data);
    await record(knex, { userId, action: "chopp_tap_changed", entityType: "chopp_product", entityId: pid,
      oldValue: tap ? tap.level_pct : null, newValue: lvl });
    return { ok: true };
  },
  async setPrice(knex, { productId, price, userId }) {
    const pid = Number(String(productId).replace("chopp-", ""));
    const old = await knex("chopp_products").where({ id: pid }).first();
    if (!old) return { ok: false, status: 404, error: "Chopp não encontrado." };
    const value = num(price);
    if (value != null && value < 0) return { ok: false, status: 400, error: "Preço inválido." };
    await knex("chopp_products").where({ id: pid }).update({ price: value });
    await record(knex, { userId, action: "chopp_price_updated", entityType: "chopp_product", entityId: pid,
      oldValue: { price: old.price }, newValue: { price: value } });
    return { ok: true };
  },
  async setReserve(knex, { productId, barrels, userId }) {
    const pid = Number(String(productId).replace("chopp-", ""));
    const res = await knex("chopp_reserves").where({ product_id: pid }).first();
    const val = Math.max(0, Math.round(num(barrels) || 0));
    if (res) await knex("chopp_reserves").where({ id: res.id }).update({ barrels: val });
    else await knex("chopp_reserves").insert({ product_id: pid, barrels: val });
    await record(knex, { userId, action: "chopp_reserve_changed", entityType: "chopp_product", entityId: pid,
      oldValue: res ? res.barrels : null, newValue: val });
    return { ok: true };
  },
};

// ---------------- Usuários (ADMIN) ----------------
const users = {
  async list(knex) {
    const rows = await knex("users").orderBy("id");
    return rows.map((u) => ({ ...publicUser(u), active: !!u.active, last_login_at: u.last_login_at }));
  },
  async create(knex, { data, userId }) {
    const username = str(data.username).trim().toLowerCase();
    if (!username || !data.password) return { ok: false, status: 400, error: "Usuário e senha são obrigatórios." };
    if (await knex("users").where({ username }).first()) return { ok: false, status: 409, error: "Usuário já existe." };
    const role = ["ADMIN", "MANAGER", "OPERATOR"].includes(data.role) ? data.role : "OPERATOR";
    const row = { username, name: str(data.name).trim() || username, password_hash: await hashPassword(data.password), role, active: true };
    const [ins] = await knex("users").insert(row).returning("id");
    const id = typeof ins === "object" ? ins.id : ins;
    await record(knex, { userId, action: "user_created", entityType: "user", entityId: id, newValue: { username, role } });
    return { ok: true, id };
  },
  async update(knex, { id, data, userId }) {
    const old = await knex("users").where({ id }).first();
    if (!old) return { ok: false, status: 404, error: "Usuário não encontrado." };
    const patch = {};
    if (data.name) patch.name = str(data.name).trim();
    if (["ADMIN", "MANAGER", "OPERATOR"].includes(data.role)) patch.role = data.role;
    if (data.active !== undefined) patch.active = !!data.active;
    if (data.password) patch.password_hash = await hashPassword(data.password);
    patch.updated_at = new Date().toISOString();
    await knex("users").where({ id }).update(patch);
    await record(knex, { userId, action: "user_updated", entityType: "user", entityId: id,
      oldValue: { role: old.role, active: !!old.active }, newValue: { role: patch.role ?? old.role, active: patch.active ?? !!old.active } });
    return { ok: true };
  },
};

// ---------------- Relatórios ----------------
const reports = {
  async currentStock(knex, buildState) {
    const s = await buildState(knex);
    return s.items;
  },
  async belowMinimum(knex, buildState) {
    const s = await buildState(knex);
    return s.items.filter((i) => i.minimum != null && i.count != null && i.count < i.minimum)
      .map((i) => ({ ...i, missing: i.minimum - i.count }));
  },
  async consumption(knex, buildState) {
    const s = await buildState(knex);
    // entradas desde o último fechamento entram na conta: base + entradas − atual
    const { entriesSince } = require("./purchases");
    const desde = s.settings && s.settings.lastClosedAt ? s.settings.lastClosedAt : null;
    const entradas = await entriesSince(knex, desde ? String(desde) : null);
    return s.items
      .map((i) => {
        if (i.base == null || i.count == null) return null;
        const entrou = entradas.get(Number(i.id)) || 0;
        const disponivel = i.base + entrou;
        const consumed = disponivel - i.count;
        const inconsistent = consumed < 0;
        return { ...i, entered: entrou, available: disponivel, consumed: inconsistent ? 0 : consumed, inconsistent };
      })
      .filter(Boolean)
      .sort((a, b) => (b.inconsistent - a.inconsistent) || (b.consumed - a.consumed));
  },
  async choppCritical(knex, buildState) {
    const s = await buildState(knex);
    return s.chopp.filter((c) => c.reserve === 0 && c.taps.some((t) => t.level <= 10));
  },
  async recentChanges(knex, limit = 50) {
    const rows = await knex("audit_log").orderBy("id", "desc").limit(limit);
    return rows.map((r) => ({
      id: r.id, user_id: r.user_id, action: r.action, entity_type: r.entity_type, entity_id: r.entity_id,
      old_value: safe(r.old_value), new_value: safe(r.new_value), timestamp: r.timestamp,
    }));
  },
  async snapshots(knex) {
    return knex("inventory_snapshots").orderBy("id", "desc");
  },
  async dashboard(knex, buildState) {
    const s = await buildState(knex);
    const counted = s.items.filter((i) => i.count != null).length;
    const below = s.items.filter((i) => i.minimum != null && i.count != null && i.count < i.minimum).length;
    const consumed = s.items.filter((i) => i.base != null && i.count != null && i.count < i.base).length;
    const choppCrit = s.chopp.filter((c) => c.reserve === 0 && c.taps.some((t) => t.level <= 10)).length;
    const last = await knex("inventory_snapshots").orderBy("id", "desc").first();
    let lastUser = null;
    if (last && last.user_id) { const u = await knex("users").where({ id: last.user_id }).first(); lastUser = u ? u.name : null; }
    return {
      items: s.items.length, counted, below, choppCritical: choppCrit, consumedCount: consumed,
      lastInventory: last ? { code: last.code, at: last.closed_at, user: lastUser } : null,
    };
  },
};

function safe(v) { try { return v ? JSON.parse(v) : null; } catch { return v; } }

module.exports = { items, chopp, users, reports };
