/**
 * Adiciona o preço aos produtos do estoque e aos chopps.
 */
exports.up = async function(knex) {
  await knex.schema.alterTable("inventory_items", (table) => {
    table.decimal("price", 10, 2).nullable();
  });

  await knex.schema.alterTable("chopp_products", (table) => {
    table.decimal("price", 10, 2).nullable();
  });
};

/**
 * Desfaz a alteração.
 */
exports.down = async function(knex) {
  await knex.schema.alterTable("chopp_products", (table) => {
    table.dropColumn("price");
  });

  await knex.schema.alterTable("inventory_items", (table) => {
    table.dropColumn("price");
  });
};
