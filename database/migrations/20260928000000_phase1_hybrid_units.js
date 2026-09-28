/**
 * Fase 1 — Modelo híbrido de unidades.
 *
 * Mantém `unit` como unidade operacional/comercial usada pela contagem e pela
 * interface, e adiciona `base_unit` como unidade interna de cálculo/consumo.
 *
 * Migração conservadora: itens existentes recebem base_unit = unit. Nenhuma
 * conversão histórica é recalculada automaticamente.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable("inventory_items", (t) => {
    t.string("base_unit").notNullable().defaultTo("unidade");
  });

  // Preserva o comportamento atual: até o administrador definir uma unidade
  // base diferente, a unidade-base é exatamente a unidade já utilizada pelo item.
  await knex.raw("UPDATE inventory_items SET base_unit = unit WHERE base_unit IS NULL OR TRIM(base_unit) = ''");
};

exports.down = async function (knex) {
  await knex.schema.alterTable("inventory_items", (t) => {
    t.dropColumn("base_unit");
  });
};
