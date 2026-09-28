// Compras/entradas: interpreta texto, sugere o casamento e só grava após confirmação.
const crypto = require("crypto");
const { parseOrder, norm } = require("./purchase-parser");
const { record } = require("../audit");

const UNIT_ALIASES = new Map([
  ["un", "unidade"], ["und", "unidade"], ["unidade", "unidade"], ["unidades", "unidade"],
  ["cx", "caixa"], ["caixa", "caixa"], ["caixas", "caixa"],
  ["pct", "pacote"], ["pacote", "pacote"], ["pacotes", "pacote"], ["pc", "pacote"], ["pack", "pacote"], ["packs", "pacote"],
  ["fardo", "fardo"], ["fardos", "fardo"], ["galao", "galao"], ["galoes", "galao"],
  ["rolo", "rolo"], ["rolao", "rolo"], ["kg", "kg"], ["g", "g"], ["ml", "ml"], ["l", "l"],
  ["garrafa", "garrafa"], ["garrafas", "garrafa"], ["lata", "lata"], ["latas", "lata"],
]);
const VALID_UNITS = new Set([...UNIT_ALIASES.keys(), null, ""]);

function score(descNorm, nameNorm) {
  if (descNorm === nameNorm) return 1;
  if (nameNorm.includes(descNorm) || descNorm.includes(nameNorm)) return 0.85;
  const a = new Set(descNorm.split(" ").filter(Boolean));
  const b = new Set(nameNorm.split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const w of a) if (b.has(w)) inter += 1;
  return inter / new Set([...a, ...b]).size;
}

function matchItem(desc, items) {
  const d = norm(desc);
  const ranked = items.map((it) => ({ it, s: score(d, norm(it.name)) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const top = ranked[0];
  const second = ranked[1];
  // Conservador: mínimo de 0,60 e margem de 0,10 sobre o segundo candidato.
  const confident = !!top && top.s >= 0.60 && (!second || top.s - second.s >= 0.10);
  return {
    match: confident ? { id: top.it.id, name: top.it.name, score: Number(top.s.toFixed(2)) } : null,
    candidates: ranked.slice(0, 5).map((x) => ({ id: x.it.id, name: x.it.name, category: x.it.category, score: Number(x.s.toFixed(2)) })),
  };
}

function parseConversions(value) {
  if (!value) return [];
  try {
    const arr = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => ({ from: UNIT_ALIASES.get(norm(x.from)) || norm(x.from), factor: Number(x.factor) }))
      .filter((x) => x.from && Number.isFinite(x.factor) && x.factor > 0);
  } catch { return []; }
}

// Fase 1: o item mantém uma unidade operacional/comercial (`unit`) e uma unidade-base
// (`base_unit`). Compras são convertidas para a unidade-base quando há regra explícita
// ou quando `pacote` pode usar `units_per_pack`. Sem regra, mantém-se 1:1 por compatibilidade.
function resolveConversion(line, item) {
  // A COMPRA ENTRA NA UNIDADE DE CONTAGEM DO ITEM (item.unit) — a mesma unidade
  // em que o operador conta e em que o estoque é somado. A conversão para a
  // unidade-base (units_per_pack) NÃO acontece aqui: ela é responsabilidade do
  // consumo do PDV (Fase 3). Converter no lançamento misturaria unidades na
  // contagem (ex.: contar 5 pacotes e somar 36 unidades da compra).
  const rawUnit = line.unit ? norm(line.unit) : null;
  const countUnit = item.unit; // destino do lançamento = unidade de contagem
  if (!rawUnit) return { ok: true, factor: 1, convertedUnit: countUnit, reason: "sem_unidade" };
  const from = UNIT_ALIASES.get(rawUnit) || rawUnit;
  const target = UNIT_ALIASES.get(norm(item.unit)) || norm(item.unit);

  // Regra explícita cadastrada (ex.: cx=36) converte para a unidade de contagem.
  const rule = parseConversions(item.conversions).find((x) => x.from === from);
  if (rule) return { ok: true, factor: rule.factor, convertedUnit: countUnit, reason: "conversao_cadastrada" };

  if (from === target) {
    return { ok: true, factor: 1, convertedUnit: countUnit, reason: "mesma_unidade" };
  }

  // Sem regra: entra 1:1 (Modelo A). Unidades desconhecidas nunca travam o
  // lançamento; o ajuste real vem de regra explícita ou, para pacote→unidade,
  // do PDV na Fase 3.
  return { ok: true, factor: 1, convertedUnit: countUnit, reason: "unidade_1x1" };
}

// remove palavras que o fornecedor acrescenta e atrapalham o casamento
const NOISE_WORDS = new Set(["empanado", "empanada", "sache", "saches"]);
function stripNoise(descNorm) {
  return descNorm.split(" ").filter((w) => !NOISE_WORDS.has(w)).join(" ").trim();
}

// procura no dicionário de substituições (texto do fornecedor -> item)
function findSubstitution(descNorm, subsMap) {
  if (subsMap.has(descNorm)) return subsMap.get(descNorm);
  const stripped = stripNoise(descNorm);
  if (stripped && subsMap.has(stripped)) return subsMap.get(stripped);
  return null;
}

async function preview(knex, text) {
  const { items, ignored } = parseOrder(text);
  const stock = await knex("inventory_items").where({ active: true }).select("id", "name", "category", "unit", "base_unit", "units_per_pack", "conversions");
  const byId = new Map(stock.map((x) => [x.id, x]));
  // dicionário de substituições: texto do fornecedor (normalizado) -> item
  const subsRows = await knex("purchase_substitutions").select("from_text", "inventory_item_id");
  const subsMap = new Map(subsRows.map((r) => [r.from_text, r.inventory_item_id]));

  const lines = items.map((it) => {
    const descNorm = norm(it.description);
    const subId = findSubstitution(descNorm, subsMap);
    let selected, matchScore, candidates, matchedBy;
    if (subId != null && byId.has(subId)) {
      selected = byId.get(subId); matchScore = 1; candidates = []; matchedBy = "dicionario";
    } else {
      const m = matchItem(it.description, stock);
      selected = m.match ? byId.get(m.match.id) : null;
      matchScore = m.match ? m.match.score : null; candidates = m.candidates; matchedBy = m.match ? "similaridade" : null;
    }
    const conversion = selected ? resolveConversion(it, selected) : { ok: false, error: "Produto não identificado com confiança suficiente." };
    return {
      description: it.description, quantity: it.quantity, unit: it.unit, isWeight: it.isWeight, raw: it.raw,
      matchItemId: selected ? selected.id : null, matchName: selected ? selected.name : null, matchScore, matchedBy,
      candidates, conversionOk: conversion.ok, conversionFactor: conversion.ok ? conversion.factor : null,
      convertedQuantity: conversion.ok ? it.quantity * conversion.factor : null, convertedUnit: conversion.ok ? conversion.convertedUnit : null,
      conversionError: conversion.ok ? null : conversion.error,
    };
  });
  return { lines, ignored };
}

async function confirm(knex, { lines, entryDate, userId, sourceText }) {
  if (!Array.isArray(lines) || !lines.length) return { ok: false, status: 400, error: "Nenhuma linha para lançar." };
  const date = entryDate && /^\d{4}-\d{2}-\d{2}$/.test(entryDate) ? entryDate : new Date().toISOString().slice(0, 10);
  const importHash = sourceText ? crypto.createHash("sha256").update(`${date}\n${String(sourceText).trim()}`).digest("hex") : null;
  if (importHash && await knex("stock_entries").where({ import_hash: importHash }).first()) {
    return { ok: false, status: 409, error: "Este pedido parece já ter sido lançado anteriormente nessa data." };
  }

  const ids = [...new Set(lines.map((l) => Number(l.inventoryItemId)).filter((x) => Number.isInteger(x)))];
  const existing = ids.length ? await knex("inventory_items").whereIn("id", ids).select("id", "name", "unit", "base_unit", "units_per_pack", "conversions", "active") : [];
  const byId = new Map(existing.map((x) => [x.id, x]));
  const prepared = [];
  for (const l of lines) {
    const itemId = Number(l.inventoryItemId);
    const item = byId.get(itemId);
    if (!item || !item.active) return { ok: false, status: 400, error: `Item de estoque inválido ou inativo em "${l.description || ""}".` };
    const qty = Number(l.quantity);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100000) return { ok: false, status: 400, error: `Quantidade inválida em "${l.description || ""}".` };
    // "unidade" nunca invalida um lançamento (Modelo A): unidades desconhecidas
    // são tratadas como 1:1. O ajuste real vem de regra explícita no item.
    const conv = resolveConversion(l, item);
    if (!conv.ok) return { ok: false, status: 422, error: conv.error };
    const converted = qty * conv.factor;
    prepared.push({
      inventory_item_id: itemId, description: String(l.description || "").slice(0, 160),
      quantity: converted, unit: conv.convertedUnit || item.unit, entry_date: date, source: "texto", user_id: userId || null,
      original_quantity: qty, original_unit: l.unit ? String(l.unit).slice(0, 20) : null,
      conversion_factor: conv.factor, converted_quantity: converted, converted_unit: conv.convertedUnit || item.unit,
      import_hash: importHash, source_text: sourceText ? String(sourceText).slice(0, 20000) : null,
    });
  }

  // quanto cada item recebeu (já convertido), para somar na contagem atual
  const addByItem = new Map();
  for (const r of prepared) addByItem.set(r.inventory_item_id, (addByItem.get(r.inventory_item_id) || 0) + Number(r.converted_quantity ?? r.quantity));

  await knex.transaction(async (trx) => {
    for (const row of prepared) await trx("stock_entries").insert(row);

    // A compra ENTRA no estoque: soma na contagem atual (aberta) de cada item.
    // Se o item ainda não tem contagem aberta neste ciclo, parte da base (último
    // inventário) para refletir "o que já havia + o que chegou".
    const lastSnap = await trx("inventory_snapshots").orderBy("id", "desc").first();
    const baseMap = new Map();
    if (lastSnap) {
      const brows = await trx("inventory_snapshot_items").where({ snapshot_id: lastSnap.id });
      for (const b of brows) baseMap.set(b.item_id, Number(b.quantity));
    }
    for (const [itemId, add] of addByItem) {
      const open = await trx("inventory_counts").where({ item_id: itemId }).whereNull("snapshot_id").first();
      if (open) {
        await trx("inventory_counts").where({ id: open.id }).update({ quantity: Number(open.quantity) + add, counted_at: new Date().toISOString() });
      } else {
        await trx("inventory_counts").insert({ item_id: itemId, quantity: (baseMap.get(itemId) || 0) + add, user_id: userId || null, snapshot_id: null, counted_at: new Date().toISOString() });
      }
    }

    await record(trx, { userId, action: "stock_entry_added", entityType: "stock_entries", entityId: null,
      newValue: { data: date, linhas: prepared.length, total_qtd: prepared.reduce((s, r) => s + r.quantity, 0), origem: "texto", importHash, somado_ao_estoque: true },
    });
  });
  return { ok: true, inserted: prepared.length, date, recordedAt: new Date().toISOString() };
}

// Normaliza um timestamp para "YYYY-MM-DD HH:MM:SS" em UTC, independente da
// origem: string do SQLite ("2026-09-14 03:00:00"), Date do PostgreSQL
// (node-postgres devolve Date) ou ISO. Sem essa normalização, String(Date)
// vira "Tue Sep 15 2026 ..." e slice(0,10) quebra a fronteira do snapshot em
// produção (PostgreSQL). Assume UTC para não deslocar o dia por fuso.
function normalizeStamp(v) {
  if (v == null) return null;
  const d = v instanceof Date
    ? v
    : (() => {
        const s = String(v);
        const iso = s.includes("T") ? s : s.replace(" ", "T");
        const withZone = /[zZ]$/.test(iso) || /[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z";
        const parsed = new Date(withZone);
        return isNaN(parsed) ? null : parsed;
      })();
  if (!d) return String(v).slice(0, 19);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function entriesSince(knex, sinceDate) {
  let q = knex("stock_entries");
  if (sinceDate) {
    const stamp = normalizeStamp(sinceDate);
    const d = stamp.slice(0, 10);
    // No mesmo dia do fechamento, usa o horário real do lançamento para não
    // puxar uma entrada registrada antes do fechamento. Dias posteriores entram normalmente.
    q = q.where(function () {
      this.where("entry_date", ">", d).orWhere(function () {
        this.where("entry_date", "=", d).andWhere("created_at", ">=", stamp);
      });
    });
  }
  const rows = await q.select("inventory_item_id", "quantity");
  const map = new Map();
  for (const r of rows) if (r.inventory_item_id != null) map.set(r.inventory_item_id, (map.get(r.inventory_item_id) || 0) + Number(r.quantity));
  return map;
}

async function listRecent(knex, limit = 50) {
  const rows = await knex("stock_entries").leftJoin("inventory_items", "stock_entries.inventory_item_id", "inventory_items.id")
    .orderBy("stock_entries.id", "desc").limit(limit)
    .select("stock_entries.*", "inventory_items.name as item_name");
  return rows.map((r) => ({ id: r.id, itemName: r.item_name || r.description, description: r.description,
    quantity: Number(r.quantity), unit: r.unit, date: r.entry_date, createdAt: r.created_at, source: r.source,
    originalQuantity: r.original_quantity == null ? null : Number(r.original_quantity), originalUnit: r.original_unit,
    conversionFactor: r.conversion_factor == null ? null : Number(r.conversion_factor),
  }));
}

// ---- Dicionário de substituições (gestão) ----
async function listSubstitutions(knex) {
  const rows = await knex("purchase_substitutions")
    .leftJoin("inventory_items", "purchase_substitutions.inventory_item_id", "inventory_items.id")
    .orderBy("purchase_substitutions.from_text", "asc")
    .select("purchase_substitutions.id", "purchase_substitutions.from_text", "inventory_items.name as item_name", "inventory_items.id as item_id");
  return rows.map((r) => ({ id: r.id, fromText: r.from_text, itemId: r.item_id, itemName: r.item_name }));
}

async function addSubstitution(knex, { fromText, inventoryItemId, userId }) {
  const key = norm(fromText);
  if (!key) return { ok: false, status: 400, error: "Texto do fornecedor vazio." };
  const item = await knex("inventory_items").where({ id: Number(inventoryItemId) }).first();
  if (!item) return { ok: false, status: 400, error: "Produto de estoque inválido." };
  const existing = await knex("purchase_substitutions").where({ from_text: key }).first();
  if (existing) await knex("purchase_substitutions").where({ id: existing.id }).update({ inventory_item_id: item.id, user_id: userId || null });
  else await knex("purchase_substitutions").insert({ from_text: key, inventory_item_id: item.id, user_id: userId || null });
  await record(knex, { userId, action: "substitution_set", entityType: "purchase_substitution", entityId: null, newValue: { from: key, item: item.name } });
  return { ok: true };
}

async function removeSubstitution(knex, { id, userId }) {
  const row = await knex("purchase_substitutions").where({ id: Number(id) }).first();
  if (!row) return { ok: false, status: 404, error: "Substituição não encontrada." };
  await knex("purchase_substitutions").where({ id: row.id }).del();
  await record(knex, { userId, action: "substitution_removed", entityType: "purchase_substitution", entityId: String(row.id), oldValue: { from: row.from_text } });
  return { ok: true };
}

module.exports = {
  preview, confirm, entriesSince, listRecent, matchItem, resolveConversion, VALID_UNITS, normalizeStamp,
  listSubstitutions, addSubstitution, removeSubstitution,
};
