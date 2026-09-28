/**
 * Estrutura do cadastro do PDV (Fase 1).
 * Vendável = o que aparece pra vender no caixa (chopp, lanche, porção, drink...).
 * Cada vendável pode baixar do estoque diretamente (stock_item_id / stock_chopp_id)
 * ou, no caso dos drinks, pelas opções escolhidas (cada opção baixa um item).
 */
exports.up = async function (knex) {
  await knex.schema.createTable("pdv_products", (t) => {
    t.increments("id").primary();
    t.string("category").notNullable(); // chopp | lanche | porcao | drink | refri | dose
    t.string("name").notNullable();
    t.decimal("price").nullable();      // preço base (null p/ chopp, que usa tamanhos)
    t.boolean("has_addons").notNullable().defaultTo(false); // lanches
    t.boolean("notes_allowed").notNullable().defaultTo(false); // observação escrita
    t.integer("stock_item_id").nullable().references("id").inTable("inventory_items").onDelete("SET NULL");
    t.integer("stock_chopp_id").nullable().references("id").inTable("chopp_products").onDelete("SET NULL");
    t.boolean("active").notNullable().defaultTo(true);
    t.integer("sort_order").notNullable().defaultTo(0);
    t.index(["category"]);
  });

  await knex.schema.createTable("pdv_sizes", (t) => {
    t.increments("id").primary();
    t.integer("product_id").notNullable().references("id").inTable("pdv_products").onDelete("CASCADE");
    t.string("label").notNullable(); // "300 ml" / "400 ml"
    t.decimal("price").notNullable();
    t.integer("sort_order").notNullable().defaultTo(0);
    t.index(["product_id"]);
  });

  await knex.schema.createTable("pdv_option_groups", (t) => {
    t.increments("id").primary();
    t.integer("product_id").notNullable().references("id").inTable("pdv_products").onDelete("CASCADE");
    t.string("name").notNullable(); // "Base", "Refri", "Red Bull"...
    t.boolean("required").notNullable().defaultTo(true);
    t.integer("sort_order").notNullable().defaultTo(0);
    t.index(["product_id"]);
  });

  await knex.schema.createTable("pdv_options", (t) => {
    t.increments("id").primary();
    t.integer("group_id").notNullable().references("id").inTable("pdv_option_groups").onDelete("CASCADE");
    t.string("label").notNullable(); // "Rum", "Vodka Bacco"...
    t.integer("stock_item_id").nullable().references("id").inTable("inventory_items").onDelete("SET NULL");
    t.integer("sort_order").notNullable().defaultTo(0);
    t.index(["group_id"]);
  });

  await knex.schema.createTable("pdv_addons", (t) => {
    t.increments("id").primary();
    t.string("name").notNullable();
    t.decimal("price").notNullable();
    t.boolean("active").notNullable().defaultTo(true);
    t.integer("sort_order").notNullable().defaultTo(0);
  });
};

exports.down = async function (knex) {
  for (const table of ["pdv_options", "pdv_option_groups", "pdv_sizes", "pdv_addons", "pdv_products"]) {
    await knex.schema.dropTableIfExists(table);
  }
};
