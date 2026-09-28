// Vendas reais do PDV. O servidor é a autoridade de preço e vínculo de estoque.
const { record } = require("../audit");

function asInt(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}
function asMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function parseJson(v) {
  if (v == null || v === "") return null;
  try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
}
const VALID_PLACES = new Set([
  "Externo Frente", "Salão 1", "Salão 3", "Salão 4",
  "Bar", "Salão 2", "Externo Fundos", "Sem mesa",
]);

function normItems(items) {
  if (!Array.isArray(items) || !items.length) return null;
  return items;
}

async function createSale(knex, { reference, plate, place, items, userId }) {
  if (!String(reference || "").trim()) return { ok: false, status: 400, error: "Referência da venda ausente." };
  if (String(reference).length > 100) return { ok: false, status: 400, error: "Referência inválida." };
  const rows = normItems(items);
  if (!rows) return { ok: false, status: 400, error: "O pedido está vazio." };
  if (plate != null && String(plate).length > 80) return { ok: false, status: 400, error: "Plaquinha inválida." };
  if (place != null && String(place).length > 100) return { ok: false, status: 400, error: "Local inválido." };
  if (place != null && String(place).trim() && !VALID_PLACES.has(String(place).trim())) return { ok: false, status: 400, error: "Local inválido." };

  return knex.transaction(async (trx) => {
    const existing = await trx("pdv_sales").where({ reference: String(reference) }).first();
    if (existing) return { ok: true, idempotent: true, sale: serializeSale(existing) };

    const productIds = [...new Set(rows.map((x) => asInt(x.productId)).filter((x) => x != null))];
    if (productIds.length !== rows.length && rows.some((x) => asInt(x.productId) == null))
      return { ok: false, status: 400, error: "Produto inválido." };

    const products = await trx("pdv_products").whereIn("id", productIds).andWhere({ active: true });
    const pmap = new Map(products.map((p) => [p.id, p]));
    if (pmap.size !== productIds.length) return { ok: false, status: 400, error: "Um produto não está disponível no cardápio." };

    const sizeIds = [...new Set(rows.map((x) => asInt(x.sizeId)).filter((x) => x != null))];
    const sizes = sizeIds.length ? await trx("pdv_sizes").whereIn("id", sizeIds) : [];
    const smap = new Map(sizes.map((s) => [s.id, s]));

    const addonIds = [...new Set(rows.flatMap((x) => Array.isArray(x.addonIds) ? x.addonIds : []).map(asInt).filter((x) => x != null))];
    const addons = addonIds.length ? await trx("pdv_addons").whereIn("id", addonIds).andWhere({ active: true }) : [];
    const amap = new Map(addons.map((a) => [a.id, a]));

    const optionIds = [...new Set(rows.flatMap((x) => Array.isArray(x.groups) ? x.groups.map((g) => g.optionId) : []).map(asInt).filter((x) => x != null))];
    const options = optionIds.length ? await trx("pdv_options").whereIn("id", optionIds) : [];
    const omap = new Map(options.map((o) => [o.id, o]));
    const groupIds = [...new Set(options.map((o) => o.group_id))];
    const groups = groupIds.length ? await trx("pdv_option_groups").whereIn("id", groupIds) : [];
    const gmap = new Map(groups.map((g) => [g.id, g]));

    let total = 0;
    const normalized = [];
    const stockMovements = [];

    for (const raw of rows) {
      const product = pmap.get(asInt(raw.productId));
      const qty = asInt(raw.quantity);
      if (!qty || qty < 1 || qty > 999) return { ok: false, status: 400, error: `Quantidade inválida para ${product.name}.` };

      let unitPrice = null;
      let size = null;
      if (product.category === "chopp") {
        const sid = asInt(raw.sizeId);
        size = sid == null ? null : smap.get(sid);
        if (!size || size.product_id !== product.id) return { ok: false, status: 400, error: `Tamanho inválido para ${product.name}.` };
        unitPrice = asMoney(size.price);
      } else {
        if (raw.sizeId != null && raw.sizeId !== "") return { ok: false, status: 400, error: `Tamanho inválido para ${product.name}.` };
        unitPrice = asMoney(product.price);
        if (unitPrice == null) return { ok: false, status: 400, error: `Preço não configurado para ${product.name}.` };
      }

      const selectedGroups = [];
      for (const g of product.category === "drink" ? (await trx("pdv_option_groups").where({ product_id: product.id })) : []) {
        const supplied = Array.isArray(raw.groups) ? raw.groups.find((x) => asInt(x.groupId) === g.id) : null;
        if (g.required && !supplied) return { ok: false, status: 400, error: `Escolha obrigatória: ${g.name}.` };
        if (supplied) {
          const o = omap.get(asInt(supplied.optionId));
          if (!o || o.group_id !== g.id) return { ok: false, status: 400, error: `Opção inválida em ${g.name}.` };
          selectedGroups.push({ groupId: g.id, groupName: g.name, optionId: o.id, label: o.label, stockItemId: o.stock_item_id });
          if (o.stock_item_id != null) stockMovements.push({ inventory_item_id: o.stock_item_id, quantity: qty, unit: "unidade", reason: "pdv_drink_option" });
        }
      }

      const selectedAddons = [];
      if (Array.isArray(raw.addonIds)) {
        for (const idRaw of raw.addonIds) {
          const id = asInt(idRaw);
          if (id == null) continue;
          const a = amap.get(id);
          if (!a) return { ok: false, status: 400, error: "Adicional inválido." };
          if (!product.has_addons) return { ok: false, status: 400, error: `Adicionais não permitidos para ${product.name}.` };
          selectedAddons.push({ id: a.id, name: a.name, price: Number(a.price) });
        }
      }
      const addonsTotal = selectedAddons.reduce((s, a) => s + Number(a.price), 0);
      const lineTotal = (unitPrice + addonsTotal) * qty;
      total += lineTotal;

      if (product.category === "chopp") {
        const liters = Number(size.label.replace(/[^0-9,.]/g, "").replace(",", ".")) / 1000 * qty;
        if (!Number.isFinite(liters) || liters <= 0) return { ok: false, status: 400, error: `Tamanho inválido para ${product.name}.` };
        stockMovements.push({ chopp_product_id: product.stock_chopp_id, liters, unit: "litro", reason: "pdv_chopp" });
      } else if ((product.category === "refri" || product.category === "dose") && product.stock_item_id != null) {
        stockMovements.push({ inventory_item_id: product.stock_item_id, quantity: qty, unit: "unidade", reason: `pdv_${product.category}` });
      }

      normalized.push({
        productId: product.id,
        productName: product.name,
        category: product.category,
        sizeId: size?.id || null,
        sizeLabel: size?.label || null,
        unitPrice,
        quantity: qty,
        addonsTotal,
        addons: selectedAddons,
        groups: selectedGroups,
        notes: product.notes_allowed ? String(raw.notes || "").trim().slice(0, 160) : "",
      });
    }

    total = asMoney(total);
    const [ins] = await trx("pdv_sales").insert({
      reference: String(reference), plate: plate == null ? null : String(plate).trim() || null,
      place: place == null ? null : String(place).trim() || null,
      user_id: userId || null, total, status: "PAID",
    }).returning("id");
    const saleId = typeof ins === "object" ? ins.id : ins;

    for (const item of normalized) {
      await trx("pdv_sale_items").insert({
        sale_id: saleId,
        product_id: item.productId,
        size_id: item.sizeId,
        product_name: item.productName,
        category: item.category,
        size_label: item.sizeLabel,
        unit_price: item.unitPrice,
        quantity: item.quantity,
        addons_total: item.addonsTotal,
        addons: JSON.stringify(item.addons),
        groups: JSON.stringify(item.groups),
        notes: item.notes || null,
      });
    }

    for (const m of stockMovements) {
      // Lanches/porções não baixam estoque nesta fase. Drink options e chopp sim.
      await trx("pdv_stock_movements").insert({ sale_id: saleId, ...m });
    }

    await record(trx, {
      userId,
      action: "pdv_sale_paid",
      entityType: "pdv_sale",
      entityId: saleId,
      newValue: { reference, total, plate: plate || null, place: place || null, itens: normalized.length, movimentos: stockMovements.length },
      metadata: { paymentMethod: null, paymentMethodRecorded: false },
    });

    return { ok: true, idempotent: false, sale: { id: saleId, reference, total, plate: plate || null, place: place || null, status: "PAID" } };
  });
}

async function salesSummary(knex, { from, to } = {}) {
  let q = knex("pdv_sales").where({ status: "PAID" });
  if (from) q = q.andWhere("created_at", ">=", from);
  if (to) q = q.andWhere("created_at", "<", to);
  const rows = await q.orderBy("id", "desc");
  const total = rows.reduce((s, r) => s + Number(r.total), 0);
  return { count: rows.length, total: asMoney(total), sales: rows.map(serializeSale) };
}
// Converte o carimbo do banco para ISO em UTC (SQLite grava "YYYY-MM-DD HH:MM:SS"
// sem fuso; sem o "Z" o navegador interpretaria como hora local e mostraria errado).
function toIso(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const withZone = /[zZ]$/.test(iso) || /[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z";
  const d = new Date(withZone);
  return isNaN(d) ? s : d.toISOString();
}
function serializeSale(r) { return { id: r.id, reference: r.reference, plate: r.plate, place: r.place, total: Number(r.total), status: r.status, createdAt: toIso(r.created_at) }; }

// Detalhe de uma venda: itens (com adicionais/opções/observação) + cabeçalho.
async function saleDetail(knex, id) {
  const sale = await knex("pdv_sales").where({ id: Number(id) }).first();
  if (!sale) return { ok: false, status: 404, error: "Venda não encontrada." };
  let userName = null;
  if (sale.user_id) { const u = await knex("users").where({ id: sale.user_id }).first(); userName = u ? u.name : null; }
  const items = await knex("pdv_sale_items").where({ sale_id: sale.id }).orderBy("id");
  return {
    ok: true,
    sale: { ...serializeSale(sale), user: userName },
    items: items.map((it) => ({
      productName: it.product_name, category: it.category, sizeLabel: it.size_label,
      unitPrice: Number(it.unit_price), quantity: it.quantity, addonsTotal: Number(it.addons_total || 0),
      addons: parseJson(it.addons) || [], groups: parseJson(it.groups) || [], notes: it.notes || "",
      lineTotal: asMoney((Number(it.unit_price) + Number(it.addons_total || 0)) * it.quantity),
    })),
  };
}

module.exports = { createSale, salesSummary, saleDetail };
