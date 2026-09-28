/**
 * Regras de conversão de embalagem/unidade por item de estoque.
 * Ex.: [{"from":"cx","factor":36}] significa 1 caixa = 36 unidades.
 * JSON é armazenado como TEXT no SQLite e JSON no PostgreSQL via t.json().
 */
exports.up = async function (knex) {
  await knex.schema.alterTable("inventory_items", (t) => {
    t.json("conversions").nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable("inventory_items", (t) => {
    t.dropColumn("conversions");
  });
};
