// Serviço de inventário: monta o estado no formato do frontend,
// registra contagens, fecha inventários (snapshots) e calcula consumo.
const { record } = require("../audit");
const { num } = require("../util");

const LEVELS = [
  ["Cheio", 100], ["Quase cheio", 90], ["Mais da metade", 70], ["Metade", 50],
  ["Menos da metade", 30], ["Quase acabando", 15], ["Acabando", 10], ["Acabou", 0],
];
const labelForLevel = (lvl) =>
  LEVELS.reduce((b, c) => (Math.abs(c[1] - lvl) < Math.abs(b[1] - lvl) ? c : b), LEVELS[0])[0];

// contagem "atual" = última contagem aberta (snapshot_id nulo) por item
async function currentCounts(knex) {
  const rows = await knex("inventory_counts").whereNull("snapshot_id").orderBy("id", "asc");
  const map = new Map();
  for (const r of rows) map.set(r.item_id, r);
  return map;
}

// base = quantidades do último snapshot (inventário fechado)
async function baseCounts(knex) {
  const last = await knex("inventory_snapshots").orderBy("id", "desc").first();
  const map = new Map();
  if (!last) return { map, lastClosedAt: null, code: null };
  const items = await knex("inventory_snapshot_items").where({ snapshot_id: last.id });
  for (const r of items) map.set(r.item_id, r.quantity);
  return { map, lastClosedAt: last.closed_at, code: last.code };
}

// Estado completo no formato que o frontend já entende.
async function buildState(knex) {
  const items = await knex("inventory_items").where({ active: true }).orderBy("sort_order", "asc");
  const current = await currentCounts(knex);
  const base = await baseCounts(knex);

  const stateItems = items.map((i) => {
    const c = current.get(i.id);
    return {
      id: String(i.id),
      category: i.category,
      name: i.name,
      minimum: i.minimum != null ? Number(i.minimum) : null,
      price: i.price != null ? Number(i.price) : null,
      unit: i.unit,
      count: c ? Number(c.quantity) : null,
      base: base.map.has(i.id) ? Number(base.map.get(i.id)) : null,
      updatedAt: c ? c.counted_at : null,
    };
  });

  const products = await knex("chopp_products").where({ active: true }).orderBy("sort_order", "asc");
  const taps = await knex("chopp_taps");
  const reserves = await knex("chopp_reserves");
  const tapsBy = new Map();
  for (const t of taps) { const a = tapsBy.get(t.product_id) || []; a.push(t); tapsBy.set(t.product_id, a); }
  const resBy = new Map(reserves.map((r) => [r.product_id, r.barrels]));

  const stateChopp = products.map((p) => ({
    id: `chopp-${p.id}`,
    brand: p.brand,
    name: p.name,
    price: p.price != null ? Number(p.price) : null,
    taps: (tapsBy.get(p.id) || []).sort((a, b) => a.position - b.position)
      .map((t) => ({ label: t.level_label, level: Number(t.level_pct) })),
    reserve: resBy.get(p.id) ?? 0,
  }));

  const snaps = await knex("inventory_snapshots").orderBy("id", "asc");
  return {
    version: 1,
    items: stateItems,
    chopp: stateChopp,
    history: snaps.map((s) => ({ at: s.closed_at, code: s.code })),
    settings: { lastClosedAt: base.lastClosedAt },
  };
}

// Registra/atualiza a contagem atual de um item (mantém uma aberta por item).
async function setCount(knex, { itemId, quantity, userId }) {
  const id = Number(itemId);
  const item = await knex("inventory_items").where({ id }).first();
  if (!item) return { ok: false, status: 404, error: "Item não encontrado." };
  const qty = num(quantity);
  const old = await knex("inventory_counts").where({ item_id: id }).whereNull("snapshot_id").first();
  await knex("inventory_counts").where({ item_id: id }).whereNull("snapshot_id").del();
  if (qty != null) {
    await knex("inventory_counts").insert({
      item_id: id, quantity: qty, user_id: userId || null, snapshot_id: null,
      counted_at: new Date().toISOString(),
    });
  }
  await record(knex, {
    userId, action: "count_set", entityType: "inventory_item", entityId: id,
    oldValue: old ? old.quantity : null, newValue: qty,
  });
  return { ok: true };
}

// Prepara o sistema para um novo ciclo real de inventário.
// Remove somente contagens abertas; preserva catálogo, preços, snapshots e auditoria.
async function resetCurrentInventory(knex, { userId }) {
  return knex.transaction(async (trx) => {
    const openCounts = await trx("inventory_counts").whereNull("snapshot_id");
    const openCount = openCounts.length;
    await trx("inventory_counts").whereNull("snapshot_id").del();

    const taps = await trx("chopp_taps");
    const reserves = await trx("chopp_reserves");
    await trx("chopp_taps").update({ level_pct: 100, level_label: "Cheio" });
    await trx("chopp_reserves").update({ barrels: 0 });

    await record(trx, {
      userId,
      action: "inventory_reset",
      entityType: "inventory",
      entityId: "current",
      oldValue: {
        openCounts: openCount,
        choppTaps: taps.length,
        choppReserves: reserves.length,
      },
      newValue: {
        openCounts: 0,
        choppTapsLevel: 100,
        choppReserveBarrels: 0,
      },
      metadata: { reason: "preparar_novo_inventario" },
    });

    return { ok: true, removedCounts: openCount };
  });
}

// Fecha o inventário: cria snapshot com as contagens atuais (base = atual).
async function closeCount(knex, { userId }) {
  const current = await knex("inventory_counts").whereNull("snapshot_id");
  const n = (await knex("inventory_snapshots").count("* as c"))[0].c;
  const code = `Inventário ${String(Number(n) + 1).padStart(3, "0")}`;
  const [inserted] = await knex("inventory_snapshots").insert({ code, user_id: userId || null }).returning("id");
  const snapshotId = typeof inserted === "object" ? inserted.id : inserted;
  if (current.length) {
    await knex("inventory_snapshot_items").insert(
      current.map((c) => ({ snapshot_id: snapshotId, item_id: c.item_id, quantity: c.quantity }))
    );
  }
  await record(knex, { userId, action: "inventory_closed", entityType: "snapshot", entityId: snapshotId, newValue: { code, itens: current.length } });
  return { ok: true, code, snapshotId };
}

module.exports = { buildState, setCount, closeCount, resetCurrentInventory, currentCounts, baseCounts, labelForLevel, LEVELS };
