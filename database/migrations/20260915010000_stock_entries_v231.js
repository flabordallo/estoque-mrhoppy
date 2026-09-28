exports.up = async function (knex) {
  await knex.schema.alterTable("stock_entries", (t) => {
    t.text("original_quantity").nullable();
    t.string("original_unit").nullable();
    t.decimal("conversion_factor").nullable();
    t.decimal("converted_quantity").nullable();
    t.string("converted_unit").nullable();
    t.string("import_hash", 64).nullable();
    t.text("source_text").nullable();
    t.index(["import_hash"]);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable("stock_entries", (t) => {
    t.dropIndex(["import_hash"]);
    t.dropColumn("source_text");
    t.dropColumn("import_hash");
    t.dropColumn("converted_unit");
    t.dropColumn("converted_quantity");
    t.dropColumn("conversion_factor");
    t.dropColumn("original_unit");
    t.dropColumn("original_quantity");
  });
};
