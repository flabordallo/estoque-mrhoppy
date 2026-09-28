/**
 * Entradas de compra (acréscimo ao inventário), com data.
 * Consumo do período passa a ser: contagem_inicial + entradas − contagem_final.
 */
exports.up = async function (knex) {
  await knex.schema.createTable("stock_entries", (t) => {
    t.increments("id").primary();
    t.integer("inventory_item_id").nullable().references("id").inTable("inventory_items").onDelete("SET NULL");
    t.string("description").notNullable();     // texto original do item no pedido
    t.decimal("quantity").notNullable();
    t.string("unit").nullable();               // cx, galão, fardo, kg...
    t.date("entry_date").notNullable();        // data em que a mercadoria chegou
    t.string("source").notNullable().defaultTo("texto");
    t.integer("user_id").nullable().references("id").inTable("users").onDelete("SET NULL");
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.index(["inventory_item_id"]);
    t.index(["entry_date"]);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("stock_entries");
};
