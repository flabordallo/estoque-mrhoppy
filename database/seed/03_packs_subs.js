// Modelo A: tamanhos de pacote (unidades por pacote) e dicionário de substituições
// do leitor de compras. Idempotente. Busca itens por nome; o que não existir é
// apenas ignorado (com aviso), nunca quebra.

const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// unidades por pacote (o que você conta como 1 pacote contém N unidades)
const PACKS = {
  "Coca lata 350ml": 12,
  "Coca zero 350ml": 6,
  "Coca 200ml": 12,
  "Coca zero 200ml": 12,
  "Fanta Laranja": 6,
  "Guaraná": 6,
  "Fanta uva": 6,
  "Sprite": 6,
  "Água tônica": 6,
  "Água tônica zero": 6,
  "Schweppes citrus": 6,
  "Suco uva lata": 6,
  "Suco maracujá lata": 6,
  "Suco pêssego lata": 6,
  "Água com gás": 12,
  "Água sem gás": 12,
};

// texto do fornecedor -> nome do produto no estoque (para o leitor casar direto)
const SUBS = {
  "papel higienico rolao": "Papel higiênico rolo",
  "toalha papel cozinha rolo": "Toalha Papel cozinha",
  "catchup heinz sache": "Catchup Heinz",
  "maionese heinz sache": "Maionese Heinz",
  "queijo mozzarella": "Queijo mozzarela",
  "bisnaga queijo cheddar": "Bisnaga Q. cheddar",
  "hamburguer de frango empanado": "Hambúrguer de Frango",
  "file tilapia empanado": "Filé de tilápia",
  "dadinho tapioca": "Dadinho de tapioca",
  "creme de leite": "Creme de Leite",
  "oleo de algodao": "Óleo de Algodão",
  "bolinho macaxeira": "Bolinho Macaxeira",
  "chiclete verde": "Chicletes verde",
  "chiclete vermelho": "Chicletes vermelho",
  "bacardi ouro": "Bacardi Ouro",
  "velho barreiro": "Velho Barreiro",
};

exports.seed = async function (knex) {
  const items = await knex("inventory_items").select("id", "name");
  const byName = new Map(items.map((i) => [i.name, i.id]));

  // ---- unidades por pacote ----
  for (const [name, n] of Object.entries(PACKS)) {
    const id = byName.get(name);
    if (id != null) await knex("inventory_items").where({ id }).update({ units_per_pack: n });
    else console.log(`[seed packs] item não encontrado (ignorado): ${name}`);
  }

  // ---- substituições ----
  for (const [fromText, itemName] of Object.entries(SUBS)) {
    const id = byName.get(itemName);
    if (id == null) { console.log(`[seed subs] destino não encontrado (ignorado): ${itemName}`); continue; }
    const key = norm(fromText);
    const existing = await knex("purchase_substitutions").where({ from_text: key }).first();
    if (!existing) await knex("purchase_substitutions").insert({ from_text: key, inventory_item_id: id });
    else await knex("purchase_substitutions").where({ id: existing.id }).update({ inventory_item_id: id });
  }
};
