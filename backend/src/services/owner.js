// Aba do Dono: gasto com estoque, ganho pelo PDV e pedido de compras automático.
// "Dia de bar" = 06:00 → 06:00 do dia seguinte (a madrugada conta para o dia anterior).
// Fuso fixo America/Sao_Paulo = UTC-3 (o Brasil não usa mais horário de verão).
const inventory = require("./inventory");

const H = 3600 * 1000;
const BAR_SHIFT = 9 * H; // 3h (fuso) + 6h (início do dia de bar)

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// data do "dia de bar" a que pertence um instante
function barDateStr(dUtc) {
  return new Date(dUtc.getTime() - BAR_SHIFT).toISOString().slice(0, 10);
}
// instante (UTC) das 06:00 BRT de uma data
function barStartInstant(dateStr) {
  return new Date(dateStr + "T09:00:00.000Z");
}
function toDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const s = String(v);
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const wz = /[zZ]$/.test(iso) || /[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z";
  const d = new Date(wz);
  return isNaN(d) ? null : d;
}

// Intervalo de um período. Datas (para compras, por entry_date) e instantes
// (para vendas, por created_at).
function periodRange(period, now = new Date()) {
  const today = barDateStr(now);
  let startDate, endPlus1;
  if (period === "semana") {
    const dow = new Date(today + "T00:00:00Z").getUTCDay(); // 0 = domingo
    startDate = addDays(today, -dow);
    endPlus1 = addDays(startDate, 7);
  } else if (period === "mes") {
    const [y, m] = today.split("-").map(Number);
    startDate = `${y}-${String(m).padStart(2, "0")}-01`;
    endPlus1 = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  } else { // dia
    startDate = today;
    endPlus1 = addDays(today, 1);
  }
  return {
    period: period === "semana" || period === "mes" ? period : "dia",
    startDate, endDate: addDays(endPlus1, -1),
    startInstant: barStartInstant(startDate),
    endInstant: barStartInstant(endPlus1),
  };
}

// ---- Gasto com estoque (compras do período × preço de compra do item) ----
async function gasto(knex, period, now) {
  const r = periodRange(period, now);
  const entries = await knex("stock_entries")
    .where("entry_date", ">=", r.startDate).andWhere("entry_date", "<=", r.endDate);
  const itemIds = [...new Set(entries.map((e) => e.inventory_item_id).filter((x) => x != null))];
  const items = itemIds.length ? await knex("inventory_items").whereIn("id", itemIds).select("id", "name", "category", "purchase_price") : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  let total = 0, semPreco = 0;
  const linhas = [];
  for (const e of entries) {
    const it = byId.get(e.inventory_item_id);
    const qty = Number(e.converted_quantity ?? e.quantity) || 0;
    const price = it && it.purchase_price != null ? Number(it.purchase_price) : null;
    if (price == null) { semPreco += 1; continue; }
    const valor = qty * price;
    total += valor;
    linhas.push({ name: it.name, category: it.category, quantity: qty, unitPrice: price, total: round(valor), date: e.entry_date });
  }
  linhas.sort((a, b) => b.total - a.total);
  return { period: r.period, range: { startDate: r.startDate, endDate: r.endDate }, total: round(total), entries: entries.length, semPreco, linhas };
}

// ---- Ganho esperado pelo PDV (vendas do período) ----
async function ganho(knex, period, now) {
  const r = periodRange(period, now);
  // busca amplo por data e filtra pelo instante exato do dia de bar
  const rows = await knex("pdv_sales").where({ status: "PAID" })
    .andWhere("created_at", ">=", r.startDate + " 00:00:00");
  const inside = rows.filter((s) => { const d = toDate(s.created_at); return d && d >= r.startInstant && d < r.endInstant; });
  const total = inside.reduce((s, x) => s + Number(x.total), 0);
  // por categoria de produto vendido
  const ids = inside.map((s) => s.id);
  const porCat = {};
  if (ids.length) {
    const items = await knex("pdv_sale_items").whereIn("sale_id", ids);
    for (const it of items) {
      const v = (Number(it.unit_price) + Number(it.addons_total || 0)) * it.quantity;
      porCat[it.category] = (porCat[it.category] || 0) + v;
    }
  }
  return { period: r.period, range: { startDate: r.startDate, endDate: r.endDate }, total: round(total), count: inside.length, porCategoria: Object.fromEntries(Object.entries(porCat).map(([k, v]) => [k, round(v)])) };
}

// ---- Relatório diário de vendas (para bater com maquininha e caixa) ----
async function salesReport(knex, dateStr) {
  const start = barStartInstant(dateStr), end = barStartInstant(addDays(dateStr, 1));
  const rows = await knex("pdv_sales").where({ status: "PAID" }).andWhere("created_at", ">=", dateStr + " 00:00:00").orderBy("id");
  const inside = rows.filter((s) => { const d = toDate(s.created_at); return d && d >= start && d < end; });
  const ids = inside.map((s) => s.id);
  const itemsBySale = new Map();
  if (ids.length) {
    const items = await knex("pdv_sale_items").whereIn("sale_id", ids).orderBy("id");
    for (const it of items) { const a = itemsBySale.get(it.sale_id) || []; a.push(it); itemsBySale.set(it.sale_id, a); }
  }
  const sales = inside.map((s) => ({
    reference: s.reference, plate: s.plate, place: s.place,
    time: toDate(s.created_at), total: Number(s.total),
    items: (itemsBySale.get(s.id) || []).map((it) => ({
      name: it.product_name, sizeLabel: it.size_label, quantity: it.quantity,
      unitPrice: Number(it.unit_price), addonsTotal: Number(it.addons_total || 0),
    })),
  }));
  const total = sales.reduce((s, x) => s + x.total, 0);
  return { date: dateStr, count: sales.length, total: round(total), sales };
}

// ---- Compras automáticas: itens em falta agrupados por empresa (categoria) ----
async function shortageByCompany(knex) {
  const s = await inventory.buildState(knex);
  const faltando = s.items
    .filter((i) => i.minimum != null && (i.count == null || i.count < i.minimum))
    .map((i) => ({ category: i.category, name: i.name, unit: i.unit, minimum: i.minimum, count: i.count == null ? 0 : i.count, missing: round(i.minimum - (i.count == null ? 0 : i.count)) }));
  const byCompany = {};
  for (const it of faltando) (byCompany[it.category] = byCompany[it.category] || []).push(it);
  const companies = Object.keys(byCompany).sort();
  return { companies, byCompany, total: faltando.length };
}

// Texto pronto para copiar e colar no WhatsApp.
function buildOrderText({ companies, byCompany }, greeting = "Bom dia!") {
  const parts = [greeting, "", "Pedido de hoje:", ""];
  for (const c of companies) {
    parts.push(`*${c}*`);
    for (const it of byCompany[c]) parts.push(`- ${it.name} (faltam ${fmt(it.missing)} ${it.unit})`);
    parts.push("");
  }
  return parts.join("\n").trim() + "\n";
}

function round(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function fmt(n) { const v = Number(n); return Number.isInteger(v) ? String(v) : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }); }

// ---- Resumo consolidado (gasto + ganho dos três períodos) ----
async function summary(knex, now = new Date()) {
  const periods = ["dia", "semana", "mes"];
  const out = { gasto: {}, ganho: {} };
  for (const p of periods) {
    out.gasto[p] = await gasto(knex, p, now);
    out.ganho[p] = await ganho(knex, p, now);
  }
  return out;
}

// ---- Planilha do dono (.xlsx): Resumo, Estoque, Compras, Vendas, Pedido ----
const BAR_NAME = "Mr. Hoppy";
const brNum = (n) => (n == null ? "" : Number(n));
const brDateTime = (d) => (d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");

async function ownerWorkbook(knex, { period = "dia", now = new Date() } = {}) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = BAR_NAME;
  wb.created = now;

  const r = periodRange(period, now);
  const g = await gasto(knex, period, now);
  const ga = await ganho(knex, period, now);
  const state = await inventory.buildState(knex);
  const shortage = await shortageByCompany(knex);
  const sales = await salesReport(knex, r.startDate);

  const periodLabel = { dia: "Diário", semana: "Semanal", mes: "Mensal" }[r.period] || r.period;
  const rangeLabel = r.startDate === r.endDate ? r.startDate : `${r.startDate} a ${r.endDate}`;

  // ---- Resumo ----
  const resumo = wb.addWorksheet("Resumo");
  resumo.columns = [{ width: 28 }, { width: 22 }, { width: 22 }];
  resumo.addRow([BAR_NAME]);
  resumo.getRow(1).font = { bold: true, size: 16 };
  resumo.addRow([`Relatório do dono — ${periodLabel}`]);
  resumo.addRow([`Período: ${rangeLabel}`]);
  resumo.addRow([`Gerado em: ${brDateTime(now)}`]);
  resumo.addRow([]);
  const hr = resumo.addRow(["Indicador", "Valor (R$)", "Detalhe"]);
  hr.font = { bold: true };
  resumo.addRow(["Gasto com estoque (compras)", brNum(g.total), `${g.entries} entradas`]);
  resumo.addRow(["Ganho esperado pelo PDV", brNum(ga.total), `${ga.count} vendas`]);
  const saldo = round(ga.total - g.total);
  resumo.addRow(["Saldo (ganho − gasto)", brNum(saldo), ""]);
  resumo.addRow([]);
  resumo.addRow(["Ganho por categoria"]).font = { bold: true };
  for (const [cat, val] of Object.entries(ga.porCategoria || {})) resumo.addRow([cat, brNum(val)]);
  if (g.semPreco) resumo.addRow([]), resumo.addRow([`Atenção: ${g.semPreco} entrada(s) sem preço de compra cadastrado.`]);

  // ---- Estoque atual ----
  const est = wb.addWorksheet("Estoque atual");
  est.columns = [
    { header: "Categoria", key: "category", width: 22 },
    { header: "Item", key: "name", width: 32 },
    { header: "Unidade", key: "unit", width: 12 },
    { header: "Contagem", key: "count", width: 12 },
    { header: "Mínimo", key: "minimum", width: 10 },
    { header: "Preço compra", key: "purchasePrice", width: 14 },
    { header: "Preço venda", key: "price", width: 14 },
    { header: "Preço utilitário", key: "utilityPrice", width: 15 },
  ];
  state.items.forEach((i) => est.addRow({
    category: i.category, name: i.name, unit: i.unit,
    count: brNum(i.count), minimum: brNum(i.minimum),
    purchasePrice: brNum(i.purchasePrice), price: brNum(i.price), utilityPrice: brNum(i.utilityPrice),
  }));

  // ---- Compras do período ----
  const comp = wb.addWorksheet("Compras do período");
  comp.columns = [
    { header: "Data", key: "date", width: 14 },
    { header: "Categoria", key: "category", width: 22 },
    { header: "Item", key: "name", width: 32 },
    { header: "Quantidade", key: "quantity", width: 12 },
    { header: "Preço compra", key: "unitPrice", width: 14 },
    { header: "Total (R$)", key: "total", width: 14 },
  ];
  g.linhas.forEach((l) => comp.addRow(l));
  comp.addRow({});
  comp.addRow({ name: "TOTAL", total: brNum(g.total) }).font = { bold: true };

  // ---- Vendas do período (dia de bar do início do período) ----
  const vend = wb.addWorksheet("Vendas do período");
  vend.columns = [
    { header: "Hora", key: "time", width: 20 },
    { header: "Referência", key: "reference", width: 16 },
    { header: "Local", key: "place", width: 16 },
    { header: "Plaquinha", key: "plate", width: 14 },
    { header: "Item", key: "item", width: 30 },
    { header: "Qtd", key: "qty", width: 8 },
    { header: "Unitário", key: "unit", width: 12 },
    { header: "Total item", key: "lineTotal", width: 12 },
  ];
  for (const s of sales.sales) {
    if (!s.items.length) {
      vend.addRow({ time: brDateTime(s.time), reference: s.reference, place: s.place, plate: s.plate });
      continue;
    }
    s.items.forEach((it, idx) => vend.addRow({
      time: idx === 0 ? brDateTime(s.time) : "",
      reference: idx === 0 ? s.reference : "",
      place: idx === 0 ? s.place : "",
      plate: idx === 0 ? s.plate : "",
      item: it.name, qty: it.quantity, unit: brNum(it.unitPrice),
      lineTotal: brNum(round((it.unitPrice + (it.addonsTotal || 0)) * it.quantity)),
    }));
  }
  vend.addRow({});
  vend.addRow({ item: "TOTAL", lineTotal: brNum(sales.total) }).font = { bold: true };

  // ---- Pedido de compra (itens em falta por empresa) ----
  const ped = wb.addWorksheet("Pedido de compra");
  ped.columns = [
    { header: "Empresa (categoria)", key: "category", width: 24 },
    { header: "Item", key: "name", width: 32 },
    { header: "Em estoque", key: "count", width: 12 },
    { header: "Mínimo", key: "minimum", width: 10 },
    { header: "Comprar", key: "missing", width: 12 },
    { header: "Unidade", key: "unit", width: 12 },
  ];
  for (const c of shortage.companies) {
    for (const it of shortage.byCompany[c]) ped.addRow(it);
  }
  if (!shortage.total) ped.addRow({ name: "Nenhum item em falta." });

  // estilo de cabeçalho para as abas com header
  [est, comp, vend, ped].forEach((ws) => {
    ws.getRow(1).font = { bold: true, color: { argb: "FFECEEF3" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF22252C" } };
  });

  return wb.xlsx.writeBuffer();
}

module.exports = { periodRange, barDateStr, gasto, ganho, salesReport, shortageByCompany, buildOrderText, summary, ownerWorkbook, BAR_NAME };
