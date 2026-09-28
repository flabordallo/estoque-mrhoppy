// Serviço do PDV (Fase 1): monta o catálogo vendável e o relatório de vínculos.
async function getCatalog(knex) {
  const products = await knex("pdv_products").where({ active: true }).orderBy("sort_order");
  const sizes = await knex("pdv_sizes").orderBy("sort_order");
  const groups = await knex("pdv_option_groups").orderBy("sort_order");
  const options = await knex("pdv_options").orderBy("sort_order");
  const addons = await knex("pdv_addons").where({ active: true }).orderBy("sort_order");

  const sizesBy = groupByFk(sizes, "product_id");
  const optionsBy = groupByFk(options, "group_id");
  const groupsBy = groupByFk(groups, "product_id");

  const build = (p) => ({
    id: p.id,
    category: p.category,
    name: p.name,
    price: p.price != null ? Number(p.price) : null,
    hasAddons: !!p.has_addons,
    notesAllowed: !!p.notes_allowed,
    stockItemId: p.stock_item_id,
    stockChoppId: p.stock_chopp_id,
    sizes: (sizesBy[p.id] || []).map((s) => ({ id: s.id, label: s.label, price: Number(s.price) })),
    groups: (groupsBy[p.id] || []).map((g) => ({
      id: g.id, name: g.name, required: !!g.required,
      options: (optionsBy[g.id] || []).map((o) => ({ id: o.id, label: o.label, stockItemId: o.stock_item_id })),
    })),
  });

  const byCat = {};
  for (const p of products) (byCat[p.category] = byCat[p.category] || []).push(build(p));

  const emptySetting = await knex("settings").where({ key: "pdv_empty_categories" }).first();
  const empty = emptySetting ? safeParse(emptySetting.value) : [];

  return {
    categories: [
      { key: "chopp", label: "Chopps", products: byCat.chopp || [] },
      { key: "lanche", label: "Lanches", products: byCat.lanche || [] },
      { key: "porcao", label: "Porções", products: byCat.porcao || [] },
      { key: "drink", label: "Drinks", products: byCat.drink || [] },
      { key: "refri", label: "Refri / Água / Suco", products: byCat.refri || [] },
      { key: "dose", label: "Doses", products: byCat.dose || [] },
      ...(empty || []).filter((e) => !["chopp", "lanche", "porcao", "drink", "refri", "dose"].includes(e.key)).map((e) => ({ key: e.key, label: e.label, products: [] })),
    ],
    addons: addons.map((a) => ({ id: a.id, name: a.name, price: Number(a.price) })),
  };
}

// Lista o que NÃO conseguiu vincular ao estoque, para correção manual.
async function linkReport(knex) {
  const products = await knex("pdv_products").where({ active: true });
  const options = await knex("pdv_options");
  const semVinculo = { chopp: [], lanche: [], porcao: [], drinkOptions: [] };

  for (const p of products) {
    if (p.category === "chopp" && p.stock_chopp_id == null) semVinculo.chopp.push(p.name);
    if ((p.category === "lanche" || p.category === "porcao") && p.stock_item_id == null)
      semVinculo[p.category].push(p.name);
  }
  const groups = await knex("pdv_option_groups");
  const gmap = new Map(groups.map((g) => [g.id, g.product_id]));
  const pmap = new Map(products.map((p) => [p.id, p.name]));
  for (const o of options) {
    if (o.stock_item_id == null) {
      const drink = pmap.get(gmap.get(o.group_id)) || "?";
      semVinculo.drinkOptions.push(`${drink} → ${o.label}`);
    }
  }
  const total =
    semVinculo.chopp.length + semVinculo.lanche.length + semVinculo.porcao.length + semVinculo.drinkOptions.length;
  return { total, semVinculo };
}

function groupByFk(rows, fk) {
  const out = {};
  for (const r of rows) (out[r[fk]] = out[r[fk]] || []).push(r);
  return out;
}
function safeParse(v) { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return v; } }

module.exports = { getCatalog, linkReport };
