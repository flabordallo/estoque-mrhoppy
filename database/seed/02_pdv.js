// Seed do cardápio do PDV (idempotente). Vincula ao estoque por nome; o que não
// casar fica com vínculo nulo (aparece no relatório de vínculos para correção).
const { chopps, lanches, porcoes, drinks, refri, doses, addons, emptyCategories } = require("../pdv-catalog");

const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim();

exports.seed = async function (knex) {
  // Índices do estoque para casar por nome
  const invItems = await knex("inventory_items").select("id", "name");
  const choppProducts = await knex("chopp_products").select("id", "name");

  // casa por igualdade normalizada e, se falhar, por "contém"
  const matchInv = (label) => {
    const n = norm(label);
    let hit = invItems.find((i) => norm(i.name) === n);
    if (!hit) hit = invItems.find((i) => norm(i.name).includes(n) || n.includes(norm(i.name)));
    return hit ? hit.id : null;
  };
  const matchChopp = (name) => {
    const n = norm(name);
    let hit = choppProducts.find((c) => norm(c.name) === n);
    if (!hit) hit = choppProducts.find((c) => norm(c.name).includes(n) || n.includes(norm(c.name)));
    return hit ? hit.id : null;
  };

  const existing = async (category, name) =>
    knex("pdv_products").where({ category, name }).first();

  let ordem = 0;
  const insertProduct = async (row) => {
    ordem += 1;
    const found = await existing(row.category, row.name);
    if (found) return found.id;
    const [ins] = await knex("pdv_products").insert({ ...row, sort_order: ordem }).returning("id");
    return typeof ins === "object" ? ins.id : ins;
  };

  // ---- Chopps (com tamanhos 300/400) ----
  for (const c of chopps) {
    const id = await insertProduct({
      category: "chopp", name: c.name, price: null,
      stock_chopp_id: matchChopp(c.name), notes_allowed: false, has_addons: false,
    });
    const jaTem = await knex("pdv_sizes").where({ product_id: id }).first();
    if (!jaTem) {
      let so = 0;
      for (const [label, price] of c.sizes) {
        so += 1;
        await knex("pdv_sizes").insert({ product_id: id, label, price, sort_order: so });
      }
    }
  }

  // ---- Lanches (com adicionais e observação) ----
  for (const l of lanches) {
    await insertProduct({
      category: "lanche", name: l.name, price: l.price,
      has_addons: true, notes_allowed: true, stock_item_id: matchInv(l.name),
    });
  }

  // ---- Porções ----
  for (const p of porcoes) {
    await insertProduct({
      category: "porcao", name: p.name, price: p.price,
      notes_allowed: true, stock_item_id: matchInv(p.name),
    });
  }

  // ---- Refri / água / suco / energéticos ----
  for (const r of refri) {
    await insertProduct({
      category: "refri", name: r.name, price: r.price,
      notes_allowed: false, has_addons: false, stock_item_id: matchInv(r.stock),
    });
  }

  // ---- Doses únicas ----
  for (const d of doses) {
    await insertProduct({
      category: "dose", name: d.name, price: d.price,
      notes_allowed: false, has_addons: false, stock_item_id: matchInv(d.stock),
    });
  }

  // ---- Drinks (com grupos de opção ligados ao estoque) ----
  for (const d of drinks) {
    const id = await insertProduct({
      category: "drink", name: d.name, price: d.price,
      notes_allowed: true, stock_item_id: null,
    });
    const jaTem = await knex("pdv_option_groups").where({ product_id: id }).first();
    if (!jaTem && d.groups) {
      let gso = 0;
      for (const g of d.groups) {
        gso += 1;
        const [gi] = await knex("pdv_option_groups").insert({ product_id: id, name: g.name, required: true, sort_order: gso }).returning("id");
        const groupId = typeof gi === "object" ? gi.id : gi;
        let oso = 0;
        for (const label of g.options) {
          oso += 1;
          await knex("pdv_options").insert({ group_id: groupId, label, stock_item_id: matchInv(label), sort_order: oso });
        }
      }
    }
  }

  // ---- Adicionais globais ----
  let aso = 0;
  for (const a of addons) {
    aso += 1;
    const found = await knex("pdv_addons").where({ name: a.name }).first();
    if (!found) await knex("pdv_addons").insert({ name: a.name, price: a.price, sort_order: aso });
  }

  // ---- Categorias vazias (botões da home, sem itens ainda) ----
  // Registradas em settings para a home saber que existem.
  const existingSetting = await knex("settings").where({ key: "pdv_empty_categories" }).first();
  const val = JSON.stringify(emptyCategories);
  if (!existingSetting) await knex("settings").insert({ key: "pdv_empty_categories", value: val });
  else await knex("settings").where({ key: "pdv_empty_categories" }).update({ value: val });
};
