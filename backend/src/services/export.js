// Exportação para Excel (.xlsx) e backup/restauração completa em JSON.
const ExcelJS = require("exceljs");
const { record } = require("../audit");

const brDate = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "");

async function buildWorkbook(knex, buildState, reports) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Estoque do Bar";
  const s = await buildState(knex);

  const estoque = wb.addWorksheet("ESTOQUE_ATUAL");
  estoque.columns = [
    { header: "Categoria", key: "category", width: 20 },
    { header: "Item", key: "name", width: 32 },
    { header: "Unidade", key: "unit", width: 12 },
    { header: "Mínimo", key: "minimum", width: 10 },
    { header: "Preço (R$)", key: "price", width: 12 },
    { header: "Contagem", key: "count", width: 12 },
  ];
  s.items.forEach((i) => estoque.addRow(i));

  const compras = wb.addWorksheet("COMPRAS");
  compras.columns = [
    { header: "Categoria", key: "category", width: 20 },
    { header: "Item", key: "name", width: 32 },
    { header: "Contagem", key: "count", width: 12 },
    { header: "Mínimo", key: "minimum", width: 10 },
    { header: "Comprar", key: "missing", width: 12 },
    { header: "Unidade", key: "unit", width: 12 },
  ];
  (await reports.belowMinimum(knex, buildState)).forEach((i) => compras.addRow(i));

  const consumo = wb.addWorksheet("CONSUMO");
  consumo.columns = [
    { header: "Categoria", key: "category", width: 20 },
    { header: "Item", key: "name", width: 32 },
    { header: "Consumido", key: "consumed", width: 12 },
    { header: "Unidade", key: "unit", width: 12 },
  ];
  (await reports.consumption(knex, buildState)).forEach((i) => consumo.addRow(i));

  const chopp = wb.addWorksheet("CHOPP");
  chopp.columns = [
    { header: "Marca", key: "brand", width: 16 },
    { header: "Nome", key: "name", width: 24 },
    { header: "Preço (R$)", key: "price", width: 12 },
    { header: "Nível %", key: "level", width: 10 },
    { header: "Reserva", key: "reserve", width: 10 },
  ];
  s.chopp.forEach((c) => chopp.addRow({ brand: c.brand, name: c.name, price: c.price, level: c.taps[0] ? c.taps[0].level : "", reserve: c.reserve }));

  const hist = wb.addWorksheet("HISTORICO");
  hist.columns = [{ header: "Inventário", key: "code", width: 20 }, { header: "Fechado em", key: "at", width: 24 }];
  (await reports.snapshots(knex)).forEach((h) => hist.addRow({ code: h.code, at: brDate(h.closed_at) }));

  const audit = wb.addWorksheet("AUDITORIA");
  audit.columns = [
    { header: "Quando", key: "timestamp", width: 24 },
    { header: "Usuário", key: "user_id", width: 10 },
    { header: "Ação", key: "action", width: 22 },
    { header: "Entidade", key: "entity_type", width: 18 },
    { header: "ID", key: "entity_id", width: 10 },
  ];
  (await reports.recentChanges(knex, 1000)).forEach((r) => audit.addRow({ ...r, timestamp: brDate(r.timestamp) }));

  [estoque, compras, consumo, chopp, hist, audit].forEach((ws) => {
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF22252C" } };
    ws.getRow(1).font = { bold: true, color: { argb: "FFECEEF3" } };
  });

  return wb.xlsx.writeBuffer();
}

// Backup completo (todas as tabelas de dados).
async function exportAll(knex, userId) {
  const tables = ["inventory_items", "inventory_counts", "inventory_snapshots", "inventory_snapshot_items",
    "chopp_products", "chopp_taps", "chopp_reserves", "settings"];
  const dump = { exportedAt: new Date().toISOString(), tables: {} };
  for (const t of tables) dump.tables[t] = await knex(t).select();
  await record(knex, { userId, action: "backup_exported", metadata: { tables: tables.length } });
  return dump;
}

// Restauração controlada: cria backup antes, nunca apaga usuários/auditoria.
async function importAll(knex, dump, userId) {
  if (!dump || !dump.tables || !dump.tables.inventory_items) {
    return { ok: false, status: 400, error: "Backup inválido." };
  }
  const before = await exportAll(knex, userId); // backup de segurança
  await knex.transaction(async (trx) => {
    const tables = ["inventory_snapshot_items", "inventory_counts", "inventory_snapshots",
      "chopp_taps", "chopp_reserves", "chopp_products", "inventory_items", "settings"];
    for (const t of tables) await trx(t).del();
    for (const t of [...tables].reverse()) {
      const rows = dump.tables[t];
      if (Array.isArray(rows) && rows.length) await trx(t).insert(rows);
    }
  });
  await record(knex, { userId, action: "backup_restored", metadata: { itens: (dump.tables.inventory_items || []).length }, oldValue: { safetyBackup: true } });
  return { ok: true, safetyBackup: before };
}

module.exports = { buildWorkbook, exportAll, importAll };
