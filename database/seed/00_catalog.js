/**
 * Migração do catálogo existente (app.js) para o banco.
 * Idempotente: rodar várias vezes não duplica nem apaga nada.
 * Preserva categoria, nome, unidade, mínimo, ordem e todo o chopp.
 */
const { RAW_ITEMS, CHOPP, LEVELS } = require("../catalog");

function labelForPct(pct) {
  const exact = LEVELS.find(([, p]) => p === pct);
  if (exact) return exact[0];
  // aproxima ao rótulo mais próximo
  return LEVELS.reduce((best, cur) =>
    Math.abs(cur[1] - pct) < Math.abs(best[1] - pct) ? cur : best
  )[0];
}

exports.seed = async function (knex) {
  // ---------- Itens de estoque ----------
  const linhas = RAW_ITEMS.trim().split("\n");
  let ordem = 0;
  for (const linha of linhas) {
    const [category, name, minimum, unit] = linha.split("|");
    ordem += 1;
    const existente = await knex("inventory_items")
      .where({ category, name })
      .first();
    const dados = {
      category,
      name,
      unit: unit || "unidade",
      minimum: minimum === "" ? null : Number(minimum),
      sort_order: ordem,
      active: true,
    };
    if (!existente) {
      await knex("inventory_items").insert(dados);
    } else {
      // mantém o registro; só garante unidade/mínimo/ordem em sincronia com o catálogo
      await knex("inventory_items").where({ id: existente.id }).update({
        unit: dados.unit,
        minimum: dados.minimum,
        sort_order: dados.sort_order,
      });
    }
  }

  // ---------- Chopp (produto + torneira + reserva) ----------
  let ordemChopp = 0;
  for (const [brand, name, pct, reserve] of CHOPP) {
    ordemChopp += 1;
    let produto = await knex("chopp_products").where({ brand, name }).first();
    if (!produto) {
      const [inserted] = await knex("chopp_products")
        .insert({ brand, name, sort_order: ordemChopp, active: true })
        .returning("id");
      const productId = typeof inserted === "object" ? inserted.id : inserted;
      produto = { id: productId };
    } else {
      await knex("chopp_products").where({ id: produto.id }).update({ sort_order: ordemChopp });
    }

    // torneira (posição 1) — o app.js tem um nível por chopp
    const tap = await knex("chopp_taps").where({ product_id: produto.id, position: 1 }).first();
    const tapData = { product_id: produto.id, position: 1, level_label: labelForPct(pct), level_pct: pct };
    if (!tap) await knex("chopp_taps").insert(tapData);
    else await knex("chopp_taps").where({ id: tap.id }).update(tapData);

    // reserva
    const res = await knex("chopp_reserves").where({ product_id: produto.id }).first();
    if (!res) await knex("chopp_reserves").insert({ product_id: produto.id, barrels: reserve });
    else await knex("chopp_reserves").where({ id: res.id }).update({ barrels: reserve });
  }
};
