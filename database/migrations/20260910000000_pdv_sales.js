/**
 * Fase 2 — vendas reais do PDV.
 * Não existe comanda aberta nem método de pagamento: cada pedido é pago e
 * processado imediatamente. A "plaquinha" é apenas uma referência operacional.
 */
exports.up = async function (knex) {
  await knex.schema.createTable("pdv_sales", (t) => {
    t.increments("id").primary();
    t.string("reference").notNullable().unique();
    t.string("plate").nullable();
    t.string("place").nullable();
    t.integer("user_id").nullable().references("id").inTable("users").onDelete("SET NULL");
    t.decimal("total").notNullable();
    t.string("status").notNullable().defaultTo("PAID");
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.index(["created_at"]);
    t.index(["user_id"]);
  });

  await knex.schema.createTable("pdv_sale_items", (t) => {
    t.increments("id").primary();
    t.integer("sale_id").notNullable().references("id").inTable("pdv_sales").onDelete("CASCADE");
    t.integer("product_id").notNullable().references("id").inTable("pdv_products");
    t.integer("size_id").nullable().references("id").inTable("pdv_sizes").onDelete("SET NULL");
    t.string("product_name").notNullable();
    t.string("category").notNullable();
    t.string("size_label").nullable();
    t.decimal("unit_price").notNullable();
    t.integer("quantity").notNullable();
    t.decimal("addons_total").notNullable().defaultTo(0);
    t.json("addons").nullable();
    t.json("groups").nullable();
    t.text("notes").nullable();
    t.index(["sale_id"]);
  });

  await knex.schema.createTable("pdv_stock_movements", (t) => {
    t.increments("id").primary();
    t.integer("sale_id").notNullable().references("id").inTable("pdv_sales").onDelete("CASCADE");
    t.integer("inventory_item_id").nullable().references("id").inTable("inventory_items").onDelete("SET NULL");
    t.integer("chopp_product_id").nullable().references("id").inTable("chopp_products").onDelete("SET NULL");
    t.decimal("quantity").nullable();
    t.decimal("liters").nullable();
    t.string("unit").nullable();
    t.string("reason").notNullable();
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.index(["sale_id"]);
    t.index(["inventory_item_id"]);
    t.index(["chopp_product_id"]);
  });
};

exports.down = async function (knex) {
  for (const table of ["pdv_stock_movements", "pdv_sale_items", "pdv_sales"]) {
    await knex.schema.dropTableIfExists(table);
  }
};
