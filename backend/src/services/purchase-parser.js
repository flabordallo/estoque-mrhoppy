// Leitor de pedido de compra em texto (colado do WhatsApp, nota, lista...).
// Não grava nada: só interpreta. A confirmação/casamento é feita depois.

// remove acentos e baixa caixa, para comparar nomes
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

// unidades/embalagens que aparecem no meio e NÃO são a quantidade do pedido
const UNIT_WORDS = ["cx", "caixa", "caixas", "galao", "galoes", "fardo", "fardos", "pacote", "pacotes", "pct", "pc", "pack", "packs", "un", "und", "unidade", "unidades", "rolo", "rolao", "garrafa", "garrafas", "lata", "latas"];

// linhas que são "lixo" (carimbo do whatsapp, saudações, despedidas)
function isNoise(line) {
  const n = norm(line);
  if (!n) return true;
  if (/^\[.*\].*:/.test(line)) {
    // linha de carimbo pode ter conteúdo depois dos dois-pontos; tratamos isso antes de chamar
  }
  const saud = ["bom dia", "boa tarde", "boa noite", "valeu", "obrigado", "obrigada", "pra amanha", "para amanha", "por favor", "pf", "segue", "segue o pedido", "pedido"];
  if (saud.some((x) => n === x || n.startsWith(x + " ") || n === x + "!")) return true;
  if (/^valeu+$/.test(n)) return true;
  // linha sem nenhum dígito e curta demais = provavelmente saudação/nome
  return false;
}

// separa o carimbo "[data, hora] Nome: conteúdo" e devolve só o conteúdo
function stripStamp(line) {
  const m = line.match(/^\s*\[[^\]]*\]\s*[^:]*:\s*(.*)$/);
  return m ? m[1] : line;
}

// tenta extrair { quantity, unit, description } de uma linha de item
function parseLine(rawLine) {
  let line = stripStamp(rawLine).trim();
  if (!line) return null;
  if (isNoise(line)) return null;

  // quantidade no começo: "01", "12", "2", "03kg", "500g", "02 cx"
  // captura número inicial e um possível sufixo de peso colado (kg/g/ml/l)
  const m = line.match(/^(\d{1,6}(?:[\.,]\d{1,3})?)\s*(kg|g|ml|l)?\b[\.\)]?\s*(.*)$/i);
  if (!m) {
    // sem número no começo — não é uma linha de pedido reconhecível
    return null;
  }
  let quantity = Number(String(m[1]).replace(",", "."));
  const weightSuffix = m[2] ? m[2].toLowerCase() : null;
  let rest = m[3].trim();

  // se o número era peso (500g, 03kg), marca para conferência (peso ≠ unidades)
  const isWeight = !!weightSuffix;

  // remove uma eventual palavra de embalagem logo no início do resto ("cx", "galões", "pacotes 800g")
  let unit = weightSuffix || null;
  const parts = rest.split(" ");
  if (parts.length && UNIT_WORDS.includes(norm(parts[0]))) {
    unit = norm(parts[0]);
    parts.shift();
    // "12 pacotes 800g dadinho" -> remove também um possível peso solto após a embalagem
    if (parts.length && /^\d+(kg|g|ml|l)$/i.test(parts[0])) parts.shift();
  }
  const description = parts.join(" ").trim();
  if (!description) return null;

  return { raw: rawLine.trim(), quantity, unit, description, isWeight };
}

// interpreta o texto inteiro -> lista de itens candidatos
function parseOrder(text) {
  const lines = String(text || "").split(/\r?\n/);
  const items = [];
  const ignored = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const parsed = parseLine(line);
    if (parsed) items.push(parsed);
    else if (norm(stripStamp(line))) ignored.push(line.trim());
  }
  return { items, ignored };
}

module.exports = { parseOrder, parseLine, norm };
