/**
 * Aba do Dono — três preços por item de estoque:
 *  - price          → preço de VENDA (coluna já existente; passa a ser rotulada "venda")
 *  - purchase_price → preço de COMPRA (para "gasto com estoque")
 *  - utility_price  → preço UTILITÁRIO (valor esperado quando o item é vendido
 *                     dentro de um conjunto, ex.: queijo/pão dentro de um lanche)
 * Preços vivem no item (aba Preços): admin edita, manager visualiza.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable("inventory_items", (t) => {
    t.decimal("purchase_price", 12, 2).nullable();
    t.decimal("utility_price", 12, 2).nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable("inventory_items", (t) => {
    t.dropColumn("purchase_price");
    t.dropColumn("utility_price");
  });
};
