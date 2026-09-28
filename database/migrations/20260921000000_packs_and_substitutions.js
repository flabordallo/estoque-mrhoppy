/**
 * Modelo A (pacote): cada item guarda quantas unidades individuais há num pacote.
 * A contagem continua sendo em PACOTES ("conta como 1"); units_per_pack existe para
 * o PDV futuro conseguir baixar 1 unidade de um estoque contado em pacotes.
 *
 * Também: dicionário de substituições do leitor de compras (texto do fornecedor
 * -> produto do estoque), para o casamento ficar mais certeiro.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable("inventory_items", (t) => {
    t.integer("units_per_pack").notNullable().defaultTo(1);
  });

  await knex.schema.createTable("purchase_substitutions", (t) => {
    t.increments("id").primary();
    t.string("from_text").notNullable().unique(); // texto normalizado do fornecedor
    t.integer("inventory_item_id").notNullable().references("id").inTable("inventory_items").onDelete("CASCADE");
    t.integer("user_id").nullable().references("id").inTable("users").onDelete("SET NULL");
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.index(["from_text"]);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("purchase_substitutions");
  await knex.schema.alterTable("inventory_items", (t) => {
    t.dropColumn("units_per_pack");
  });
};
