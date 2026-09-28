import { api, onStatus, flush, pendingCount, clearOfflineQueue } from "./api.js";
import { addToCart, cartCount, cartTotal, itemTotal, setItemQty } from "./pdv-cart.js";

const APP_VERSION = "2.5.2";
const STORAGE_KEY = "estoqueBarPwa.v1"; // cache offline do estado vindo do servidor

const LEVELS = [
  ["Cheio", 100], ["Quase cheio", 90], ["Mais da metade", 70], ["Metade", 50],
  ["Menos da metade", 30], ["Quase acabando", 15], ["Acabando", 10], ["Acabou", 0],
];

const state = { view: "estoque", category: (() => { try { return localStorage.getItem("estoqueBar.category.v1") || ""; } catch { return ""; } })(), query: "", modal: null, user: null, data: null, consumption: [], pdv: null, pdvCategory: null, pdvCart: loadPdvCart(), pdvPlate: "", pdvPlace: "", pdvNoTable: false, purchaseText: "", purchaseLines: null, purchaseDate: "", purchaseRecent: null, purchaseBusy: false, choppBrand: "Curitiba", subsList: null, subsBusy: false, ownerPeriod: "dia", owner: null, ownerOrder: null, ownerBusy: false };
const PDV_CART_KEY = "estoqueBar.pdv.cart.v2";
const PDV_META_KEY = "estoqueBar.pdv.meta.v2";
const PDV_REF_KEY = "estoqueBar.pdv.ref.v1";
let pdvProcessing = false;
let pdvSuccess = null;
function loadPdvCart() { try { return JSON.parse(localStorage.getItem("estoqueBar.pdv.cart.v2")) || []; } catch { return []; } }
function savePdvCart() { try { localStorage.setItem(PDV_CART_KEY, JSON.stringify(state.pdvCart)); localStorage.setItem(PDV_META_KEY, JSON.stringify({ plate: state.pdvPlate, place: state.pdvPlace, noTable: state.pdvNoTable })); } catch {} }
function loadPdvMeta() { try { const x = JSON.parse(localStorage.getItem(PDV_META_KEY)) || {}; state.pdvPlate = x.plate || ""; state.pdvPlace = x.place || ""; state.pdvNoTable = !!x.noTable; } catch {} }
// Referência estável do pedido: criada uma vez por checkout e reutilizada em qualquer
// nova tentativa. Se a venda foi gravada no backend mas a resposta se perdeu (rede),
// o retry reenvia a MESMA referência e a idempotência do servidor devolve a venda
// existente — sem duplicar. Só é limpa após sucesso confirmado ou nova venda.
function currentPdvReference() {
  try { const r = localStorage.getItem(PDV_REF_KEY); if (r) return r; } catch {}
  const ref = `PDV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try { localStorage.setItem(PDV_REF_KEY, ref); } catch {}
  return ref;
}
function clearPdvReference() { try { localStorage.removeItem(PDV_REF_KEY); } catch {} }
loadPdvMeta();

// ---------- boot / login ----------
async function boot() {
  state.user = await api.me();
  if (!state.user) return renderLogin();
  if (state.user.role === "OPERATOR") state.view = "operador";
  await reload(true);
  onStatus(updateConnBadge);
  window.addEventListener("needs-login", renderLogin);
  flush();
}

async function reload(useCacheOnFail = false) {
  try {
    state.data = await api.getState();
    if (canManage()) {
      try { state.consumption = (await api.consumption()).items || []; } catch { state.consumption = []; }
    } else state.consumption = [];
    saveCache();
  } catch (e) {
    if (e.status === 401) return renderLogin();
    if (useCacheOnFail) { state.data = loadCache() || { items: [], chopp: [], history: [], settings: {} }; state.consumption = []; }
    else throw e;
  }
  if (!state.category || !categories().includes(state.category)) { state.category = categories()[0] || ""; try { localStorage.setItem("estoqueBar.category.v1", state.category); } catch {} }
  render();
}

function renderLogin(message = "") {
  document.querySelector("#app").innerHTML = `
    <div class="login-wrap">
      <form class="login-card" data-form="login">
        <div class="login-logo"><img src="./logo-mrhoppy.png" alt="Mr. Hoppy — Beer & Burger" /></div>
        <h1 class="neon-title">Estoque do Bar</h1>
        <p>Entre para continuar</p>
        <label>Usuário<input class="field" name="username" autocomplete="username" required></label>
        <label>Senha<input class="field" name="password" type="password" autocomplete="current-password" required></label>
        ${message ? `<p class="login-error">${escapeHtml(message)}</p>` : ""}
        <button class="btn primary" type="submit">Entrar</button>
      </form>
    </div>`;
  document.querySelector("[data-form='login']").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      state.user = await api.login(f.get("username"), f.get("password"));
      await reload(true);
      onStatus(updateConnBadge);
    } catch (err) {
      renderLogin(err.status === 429 ? "Muitas tentativas. Aguarde." : "Usuário ou senha inválidos.");
    }
  });
}

// ---------- cache offline ----------
function saveCache() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); } catch {} }
function loadCache() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; } }
function saveData() { saveCache(); }

// ---------- papéis ----------
const isAdmin = () => state.user?.role === "ADMIN";
const canManage = () => state.user?.role === "ADMIN" || state.user?.role === "MANAGER";
const isOperator = () => state.user?.role === "OPERATOR";

// ---------- helpers ----------
function categories() { return [...new Set(state.data.items.map((i) => i.category))]; }
function formatNumber(v) { return v == null || Number.isNaN(v) ? "" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }); }
function parseNumber(v) { if (v === "") return null; const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; }
function labelForLevel(l) { return LEVELS.reduce((b, c) => (Math.abs(c[1] - l) < Math.abs(b[1] - l) ? c : b), LEVELS[0])[0]; }
function colorForLevel(l) { return l >= 50 ? "var(--accent)" : l >= 30 ? "var(--warn)" : "var(--bad)"; }
function shoppingList() { return state.data.items.filter((i) => i.minimum != null && i.count != null && i.count < i.minimum).map((i) => ({ ...i, missing: i.minimum - i.count })).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)); }
function consumptionList() { return state.consumption || []; }
function lowChopp() { return state.data.chopp.filter((i) => i.reserve === 0 && i.taps.some((t) => t.level <= 10)); }

// ---------- mutações (otimista + API) ----------
function setCount(id, value) {
  const item = state.data.items.find((e) => e.id === id);
  if (!item) return;
  item.count = parseNumber(value);
  item.updatedAt = new Date().toISOString();
  saveData();
  api.setCount(id, item.count);
  refreshCountUI(id, item); // atualiza sem redesenhar a lista (preserva o foco/agilidade)
}

// Atualiza só o topo (contadores) e a linha atual, sem recriar os campos de contagem.
function refreshCountUI(id, item) {
  const stats = document.querySelector(".stats");
  if (stats) stats.outerHTML = renderStats();
  const input = document.querySelector('[data-count="' + id + '"]');
  const row = input && input.closest(".row");
  if (!row) return;
  const low = item.minimum != null && item.count != null && item.count < item.minimum;
  const uncounted = item.count == null;
  row.classList.toggle("row-low", low);
  row.classList.toggle("row-uncounted", uncounted && !low);
  const sub = row.querySelector(".name span");
  if (sub) {
    const badge = sub.querySelector(".badge");
    if (low && !badge) { const b = document.createElement("b"); b.className = "badge"; b.textContent = "abaixo"; sub.appendChild(b); }
    else if (!low && badge) badge.remove();
  }
}

async function closeCount() {
  if (!navigator.onLine) return toast("Sem internet: feche a contagem quando a conexão voltar");
  try {
    await api.close();
    await reload();
    toast("Contagem fechada e registrada no servidor");
  } catch (e) {
    toast(e.status === 403 ? "Sem permissão" : (e.message || "Erro ao fechar contagem"));
  }
}

async function upsertItem(form) {
  const data = Object.fromEntries(new FormData(form));
  if (!String(data.category || "").trim() || !String(data.name || "").trim()) return toast("Informe categoria e nome");
  try {
    if (data.id) await api.updateItem(data.id, data);
    else await api.createItem(data);
    state.modal = null;
    state.category = data.category;
    await reload();
    toast(data.id ? "Item atualizado" : "Item criado");
  } catch (e) { toast(e.status === 403 ? "Sem permissão" : "Erro ao salvar"); }
}

async function deleteItem(id) {
  if (!confirm("Excluir este item do estoque?")) return;
  try { await api.deleteItem(id); await reload(); toast("Item excluído"); }
  catch (e) { toast(e.status === 403 ? "Sem permissão" : "Erro ao excluir"); }
}

// ---------- preparação de novo inventário ----------
function resetInventory() {
  if (!isAdmin()) return toast("Só ADMIN pode preparar um novo inventário");
  state.modal = { resetConfirm: true, errado: false };
  render();
}

async function confirmReset() {
  try {
    const r = await api.resetInventory();
    clearOfflineQueue();
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    state.modal = null;
    state.category = "";
    state.query = "";
    state.view = "estoque";
    await reload();
    toast(`Pronto. ${r.removedCounts || 0} contagens de teste removidas.`);
  } catch (e) {
    state.modal = null;
    render();
    toast(e.status === 403 ? "Só ADMIN pode fazer isso" : "Erro ao preparar estoque");
  }
}

// ---------- backup / export ----------
async function exportJson() {
  try {
    const dump = await api.backup();
    download(`backup-estoque-bar-${dateStamp()}.json`, JSON.stringify(dump, null, 2), "application/json");
  } catch (e) { toast(e.status === 403 ? "Só ADMIN" : "Erro no backup"); }
}
function exportCsv() {
  const lines = [["categoria", "item", "contagem", "minimo", "comprar", "unidade"]];
  shoppingList().forEach((i) => lines.push([i.category, i.name, i.count, i.minimum, i.missing, i.unit]));
  download(`compras-${dateStamp()}.csv`, lines.map((r) => r.map(csvCell).join(";")).join("\n"), "text/csv;charset=utf-8");
}
async function importJson(file) {
  const text = await file.text();
  try {
    const dump = JSON.parse(text);
    if (!confirm("Restaurar este backup? Um backup de segurança é criado antes.")) return;
    await api.restore(dump);
    await reload();
    toast("Backup restaurado");
  } catch (e) { toast(e.status === 403 ? "Só ADMIN" : "Arquivo inválido"); }
}
function csvCell(v) { return `"${(v == null ? "" : String(v)).replaceAll('"', '""')}"`; }
function dateStamp() { return new Date().toISOString().slice(0, 10); }
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

// ---------- render ----------
function render() {
  const pdvMode = ["operador", "pdv-category", "pdv-close"].includes(state.view);
  const operatorMode = isOperator();
  document.querySelector("#app").innerHTML = `
    <div class="app-shell ${pdvMode || operatorMode ? "pdv-app-shell" : ""}">
      ${operatorMode ? renderOperatorTopbar() : pdvMode ? renderPdvTopbar() : renderTopbar()}
      ${operatorMode || pdvMode ? "" : renderStats()}
      ${operatorMode || pdvMode ? "" : renderTabs()}
      ${renderView()}
    </div>
    ${state.modal ? renderModal() : ""}`;
  bindEvents();
  updateConnBadge();
}

function renderOperatorTopbar() {
  return `
    <header class="topbar pdv-topbar operator-topbar">
      <div class="brand"><span class="eyebrow">OPERADOR</span><h1>Atendimento</h1><p>${escapeHtml(state.user.name)} · venda imediata · <span id="conn" class="conn"></span> · v${APP_VERSION}</p></div>
      <div class="actions"><button class="btn ${state.view === "operador" || state.view === "pdv-category" || state.view === "pdv-close" ? "active" : ""}" data-action="operator-order">Pedido <b>${cartCount(state.pdvCart)}</b></button><button class="btn ${state.view === "operador-estoque" ? "active" : ""}" data-action="operator-stock">Estoque</button><button class="btn" data-action="logout">Sair</button></div>
    </header>`;
}

function renderPdvTopbar() {
  return `
    <header class="topbar pdv-topbar">
      <div class="brand"><span class="eyebrow">PDV</span><h1>Atendimento</h1><p>${escapeHtml(state.user.name)} · <span id="conn" class="conn"></span> · v${APP_VERSION}</p></div>
      <div class="actions"><button class="btn" data-action="pdv-go-cart">Pedido <b>${cartCount(state.pdvCart)}</b></button><button class="btn" data-action="pdv-exit">Gestão</button></div>
    </header>`;
}

function renderTopbar() {
  return `
    <header class="topbar">
      <div class="brand brand-with-logo">
        <img class="brand-logo" src="./logo-mrhoppy.png" alt="Mr. Hoppy" />
        <div>
          <h1 class="neon-title">Estoque do Bar <small class="app-version">v${APP_VERSION}</small></h1>
          <p>${escapeHtml(state.user.name)} · ${state.user.role} <span id="conn" class="conn"></span></p>
        </div>
      </div>
      <div class="actions">
        <button class="btn" data-action="xlsx">Excel</button>
        <button class="btn" data-action="csv">CSV</button>
        ${isAdmin() ? `<button class="btn" data-action="backup">Backup</button>
        <button class="btn" data-action="import">Importar</button>
        <button class="btn" data-action="users">Usuários</button>
        <button class="btn danger" data-action="reset-inventory">Zerar / novo inventário</button>` : ""}
        <button class="btn" data-action="logout">Sair</button>
      </div>
    </header>`;
}

function renderStats() {
  return `
    <section class="stats">
      <div class="stat stat-progress"><span>Contagem atual</span><strong>${state.data.items.filter((i) => i.count != null).length}<small> / ${state.data.items.length}</small></strong><div class="stat-meter"><i style="width:${state.data.items.length ? Math.round(state.data.items.filter((i) => i.count != null).length / state.data.items.length * 100) : 0}%"></i></div></div>
      <div class="stat ${shoppingList().length ? "stat-warn" : "stat-ok"}"><span>A comprar</span><strong>${shoppingList().length}</strong><small>${shoppingList().length ? "abaixo do mínimo" : "estoque dentro do mínimo"}</small></div>
      <div class="stat"><span>Consumo</span><strong>${consumptionList().filter((i) => !i.inconsistent && i.consumed > 0).length}</strong><small>${consumptionList().some((i) => i.inconsistent) ? "há inconsistências" : "itens com saída"}</small></div>
      <div class="stat ${lowChopp().length ? "stat-bad" : "stat-ok"}"><span>Chopp crítico</span><strong>${lowChopp().length}</strong><small>${lowChopp().length ? "atenção necessária" : "sem alertas"}</small></div>
    </section>`;
}

function renderTabs() {
  const tabs = [["operador", "Operador"], ["estoque", "Estoque"]];
  if (canManage()) {
    tabs.push(["precos", "Preços"], ["chopp", "Chopp"], ["relatorios", "Relatórios"], ["compras", "Compras"], ["vendas", "Vendas"]);
  }
  if (isAdmin()) tabs.push(["dono", "Dono"], ["cadastro", "Cadastro"]);
  return `<nav class="tabs">${tabs.map(([id, label]) => `<button class="tab ${state.view === id ? "active" : ""}" data-view="${id}">${label}</button>`).join("")}</nav>`;
}

function renderView() {
  if (state.view === "operador") return renderOperatorHome();
  if (state.view === "operador-estoque") return renderInventory(true);
  if (state.view === "pdv-category") return renderPdvCategory();
  if (state.view === "pdv-close") return renderPdvClose();
  if (state.view === "precos") return renderPrices();
  if (state.view === "chopp") return renderChopp();
  if (state.view === "relatorios") return renderReports();
  if (state.view === "compras" && canManage()) return renderCompras();
  if (state.view === "vendas" && canManage()) return renderSales();
  if (state.view === "dono" && isAdmin()) return renderOwner();
  if (state.view === "cadastro" && isAdmin()) return renderCatalog();
  return renderInventory();
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

async function loadPurchasePreview() {
  const text = state.purchaseText.trim();
  if (!text) return toast("Cole o pedido primeiro");
  state.purchaseBusy = true; render();
  try {
    const r = await api.previewPurchase(text);
    state.purchaseLines = r.lines.map((l) => ({
      description: l.description, quantity: l.quantity, unit: l.unit, isWeight: l.isWeight,
      chosenItemId: l.matchItemId != null ? String(l.matchItemId) : "",
      matchScore: l.matchScore, candidates: l.candidates || [], conversionOk: !!l.conversionOk, conversionFactor: l.conversionFactor, convertedQuantity: l.convertedQuantity, convertedUnit: l.convertedUnit, conversionError: l.conversionError,
    }));
    if (!state.purchaseDate) state.purchaseDate = todayISO();
  } catch (e) { toast(e.status === 403 ? "Sem permissão" : "Erro ao ler o pedido"); }
  finally { state.purchaseBusy = false; render(); }
}

async function loadPurchaseRecent() {
  try { const r = await api.recentPurchases(); state.purchaseRecent = r.items; render(); } catch {}
}

function updatePurchaseConversion(index) {
  const l = state.purchaseLines?.[index];
  if (!l) return;
  const item = state.data?.items?.find((x) => String(x.id) === String(l.chosenItemId));
  if (!item) { l.conversionOk = false; l.conversionError = "Produto não identificado."; return; }
  const aliases = { un:"unidade", und:"unidade", unidade:"unidade", unidades:"unidade", cx:"caixa", caixa:"caixa", caixas:"caixa", pct:"pacote", pacote:"pacote", pacotes:"pacote", kg:"kg", g:"g", ml:"ml", l:"l", fardo:"fardo", fardos:"fardo", galao:"galao", galoes:"galao", rolo:"rolo", rolao:"rolo", garrafa:"garrafa", garrafas:"garrafa", lata:"lata", latas:"lata" };
  const from = l.unit ? (aliases[String(l.unit).toLowerCase()] || String(l.unit).toLowerCase()) : null;
  const target = aliases[String(item.unit || "").toLowerCase()] || String(item.unit || "").toLowerCase();
  if (!from || from === target) { l.conversionOk = true; l.conversionFactor = 1; l.convertedQuantity = Number(l.quantity); l.convertedUnit = item.unit; l.conversionError = null; return; }
  let rules = item.conversions || [];
  const rule = rules.find((x) => (aliases[String(x.from || "").toLowerCase()] || String(x.from || "").toLowerCase()) === from && Number(x.factor) > 0);
  if (rule) { l.conversionOk = true; l.conversionFactor = Number(rule.factor); l.convertedQuantity = Number(l.quantity) * Number(rule.factor); l.convertedUnit = item.unit; l.conversionError = null; }
  else { l.conversionOk = false; l.conversionFactor = null; l.convertedQuantity = null; l.convertedUnit = null; l.conversionError = `Não existe conversão cadastrada de ${l.unit} para ${item.unit}.`; }
}

async function doConfirmPurchase() {
  const linhas = (state.purchaseLines || []).filter((l) => l.chosenItemId && Number(l.quantity) > 0);
  if (!linhas.length) return toast("Nenhuma linha pronta para lançar (escolha o produto).");
  const semItem = (state.purchaseLines || []).length - linhas.length;
  state.purchaseBusy = true; render();
  try {
    const r = await api.confirmPurchase(
      linhas.map((l) => ({ inventoryItemId: Number(l.chosenItemId), description: l.description, quantity: Number(l.quantity), unit: l.unit })),
      state.purchaseDate || todayISO(), state.purchaseText
    );
    state.purchaseLines = null; state.purchaseText = "";
    toast(`Entrada lançada: ${r.inserted} item(ns)${semItem ? ` · ${semItem} sem produto foram ignorados` : ""}`);
    await loadPurchaseRecent();
  } catch (e) { toast(e.status === 403 ? "Sem permissão" : e.status === 409 ? "Este pedido já parece ter sido lançado." : (e.message || "Erro ao lançar")); }
  finally { state.purchaseBusy = false; render(); }
}

function renderCompras() {
  if (state.purchaseRecent == null) loadPurchaseRecent();
  const items = (state.data?.items || []).slice().sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const optionsFor = (chosen) =>
    `<option value="">— escolher produto —</option>` +
    items.map((i) => `<option value="${i.id}" ${String(chosen) === String(i.id) ? "selected" : ""}>${escapeHtml(i.category)} · ${escapeHtml(i.name)}</option>`).join("");

  const lines = state.purchaseLines;
  const unsafeCount = lines ? lines.filter((l) => l.chosenItemId && l.conversionOk === false).length : 0;
  const conf = !lines ? "" : `
    <div class="section-title" style="margin-top:16px"><span>Conferência (${lines.length} linha${lines.length === 1 ? "" : "s"})</span></div>
    <p class="rep-note" style="font-size:12px;color:var(--muted);margin:0 0 8px">Confira o produto e a quantidade de cada linha. Linhas sem produto escolhido não entram. Nada é gravado até você confirmar.</p>
    <div class="panel">
      ${lines.map((l, i) => `
        <div class="row" style="grid-template-columns:70px 1fr 40px;gap:8px;align-items:center">
          <input class="field" type="number" min="0" step="0.01" data-purchase-qty="${i}" value="${l.quantity}" style="text-align:right">
          <div style="min-width:0">
            <select class="select" data-purchase-item="${i}">${optionsFor(l.chosenItemId)}</select>
            <div style="font-size:11px;color:var(--muted);margin-top:3px">“${escapeHtml(l.description)}”${l.unit ? ` · ${escapeHtml(l.unit)}` : ""}${l.isWeight ? ` <b class="badge">peso</b>` : ""}${l.matchScore != null ? ` <b class="badge">confiança ${Math.round(l.matchScore*100)}%</b>` : ""}${!l.chosenItemId ? ` <b class="badge">revisar produto</b>` : ""}</div>
            ${l.chosenItemId && l.conversionOk && l.conversionFactor !== 1 ? `<div style="font-size:11px;color:var(--accent);margin-top:3px">Conversão: ${formatNumber(l.quantity)} ${escapeHtml(l.unit || "")} → ${formatNumber(l.convertedQuantity)} ${escapeHtml(l.convertedUnit || "")} (×${formatNumber(l.conversionFactor)})</div>` : ""}
            ${l.chosenItemId && !l.conversionOk ? `<div style="font-size:11px;color:var(--bad);margin-top:3px">⚠ ${escapeHtml(l.conversionError || "Conversão não segura. Revise esta linha.")}</div>` : ""}
          </div>
          <button class="icon-btn" data-purchase-remove="${i}" aria-label="Remover">×</button>
        </div>`).join("")}
    </div>
    <div class="toolbar" style="margin-top:12px;grid-template-columns:auto 1fr auto">
      <label style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px">Data<input class="field" type="date" data-purchase-date value="${escapeHtml(state.purchaseDate || todayISO())}"></label>
      <span></span>
      <button class="btn primary" data-action="purchase-confirm" ${(state.purchaseBusy || unsafeCount) ? "disabled" : ""}>${state.purchaseBusy ? "Lançando…" : "Confirmar entrada"}</button>
    </div>`;

  const recent = !state.purchaseRecent ? "" : `
    <div class="section-title" style="margin-top:22px"><span>Entradas recentes</span></div>
    <ul class="report-list panel">${state.purchaseRecent.map((r) => `<li style="padding:10px 12px"><span>${escapeHtml(r.itemName)}<br><small>${r.date ? new Date(r.date + "T00:00:00").toLocaleDateString("pt-BR") : ""}${r.createdAt ? " · lançado " + new Date(r.createdAt).toLocaleString("pt-BR") : ""}${r.unit ? " · " + escapeHtml(r.unit) : ""}</small></span><b class="amount">+${formatNumber(r.quantity)}</b></li>`).join("") || `<li class="empty">Nenhuma entrada ainda.</li>`}</ul>`;

  const buy = shoppingList();
  const buyList = `<article class="card purchase-shopping-list"><div class="section-title"><span>Lista de compras</span><b>${buy.length} item(ns)</b></div><ul class="report-list">${buy.map((i) => `<li><span><strong>${escapeHtml(i.name)}</strong><br><small>${escapeHtml(i.category)} · mínimo ${formatNumber(i.minimum)} ${escapeHtml(i.unit)}</small></span><b class="amount">+${formatNumber(i.missing)} ${escapeHtml(i.unit)}</b></li>`).join("") || `<li class="empty">Nenhum item abaixo do mínimo.</li>`}</ul></article>`;
  return `<div>
    <div class="section-title"><span>COMPRAS / ENTRADAS</span><b class="app-version">v${APP_VERSION}</b></div>
    <div class="purchase-reader card">
      <div class="section-title" style="margin-top:0"><span>Leitor de pedido — texto</span></div>
      <p class="rep-note" style="font-size:12px;color:var(--muted);margin:0 0 8px">Sem fotos. Cole texto de WhatsApp, fornecedor ou lista. O leitor identifica quantidade, unidade e produto; conversões cadastradas são aplicadas automaticamente. Nada é lançado sem sua confirmação.</p>
      <textarea class="field" data-purchase-text placeholder="Ex.:
2 cx Coca-Cola
3 fardos água
0,5 kg limão" style="width:100%;min-height:140px;resize:vertical">${escapeHtml(state.purchaseText)}</textarea>
      <div class="toolbar" style="margin-top:8px;grid-template-columns:1fr auto auto">
        <span></span><button class="btn" data-action="purchase-paste">Colar da área de transferência</button><button class="btn primary" data-action="purchase-preview" ${state.purchaseBusy ? "disabled" : ""}>${state.purchaseBusy ? "Lendo…" : "Ler pedido"}</button>
      </div>
    </div>
    ${buyList}
    ${conf}
    ${recent}
    ${renderSubsSection(items, optionsFor)}
  </div>`;
}

function renderSubsSection(items, optionsFor) {
  if (state.subsList == null) loadSubs();
  const list = state.subsList || [];
  const canEdit = isAdmin();
  const rows = list.map((s) => `
    <li style="padding:9px 12px">
      <span><b>“${escapeHtml(s.fromText)}”</b> → ${escapeHtml(s.itemName || "(item removido)")}</span>
      ${canEdit ? `<button class="icon-btn" data-sub-remove="${s.id}" aria-label="Remover">×</button>` : ""}
    </li>`).join("");
  const addForm = canEdit ? `
    <div class="toolbar" style="margin-top:10px;grid-template-columns:1fr 1fr auto">
      <input class="field" data-sub-from placeholder="texto do fornecedor (ex.: coca 350)">
      <select class="select" data-sub-item>${optionsFor("")}</select>
      <button class="btn primary" data-action="sub-add" ${state.subsBusy ? "disabled" : ""}>${state.subsBusy ? "Salvando…" : "Adicionar"}</button>
    </div>` : `<p class="rep-note" style="font-size:12px;color:var(--muted);margin:8px 0 0">Só o administrador edita o dicionário.</p>`;
  return `
    <div class="section-title" style="margin-top:22px"><span>Substituições do leitor</span><b>${list.length}</b></div>
    <p class="rep-note" style="font-size:12px;color:var(--muted);margin:0 0 8px">Ensina o leitor a casar como o fornecedor escreve. Ex.: “papel higiênico rolão” → Papel higiênico rolo. O texto não diferencia maiúsculas/acentos.</p>
    <ul class="report-list panel" style="list-style:none">${rows || `<li class="empty">Nenhuma substituição cadastrada.</li>`}</ul>
    ${addForm}`;
}

async function loadSubs() {
  try { const r = await api.listSubstitutions(); state.subsList = r.items; render(); }
  catch { state.subsList = []; }
}
async function doAddSub() {
  const from = document.querySelector("[data-sub-from]")?.value?.trim();
  const itemId = document.querySelector("[data-sub-item]")?.value;
  if (!from || !itemId) return toast("Preencha o texto e o produto");
  state.subsBusy = true; render();
  try { await api.addSubstitution(from, Number(itemId)); state.subsList = null; toast("Substituição adicionada"); }
  catch (e) { toast(e.status === 403 ? "Só ADMIN" : "Erro ao adicionar"); }
  finally { state.subsBusy = false; render(); }
}
async function doRemoveSub(id) {
  try { await api.removeSubstitution(id); state.subsList = null; render(); }
  catch (e) { toast(e.status === 403 ? "Só ADMIN" : "Erro ao remover"); }
}

function renderInventory(readOnly = false) {
  const filtered = state.data.items.filter((i) => i.category === state.category && i.name.toLowerCase().includes(state.query.toLowerCase()));
  return `
    <div class="toolbar">
      <input class="search" data-action="search" value="${escapeHtml(state.query)}" placeholder="Buscar item..." />
      ${!readOnly && canManage() ? `<button class="btn primary" data-action="close-count">Fechar contagem</button>` : ""}
      ${!readOnly && isAdmin() ? `<button class="btn" data-action="new-item">Novo item</button>` : ""}
    </div>
    <div class="chips">${categories().map((c) => `<button class="chip ${c === state.category ? "active" : ""}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}</div>
    <div class="view-hint"><span>●</span> ${readOnly ? "Visualização somente leitura. O operador não pode alterar o estoque." : "Digite a quantidade real. Itens sem contagem ficam pendentes."}</div>
    <section class="panel">${filtered.map((item) => renderInventoryRow(item, readOnly)).join("") || `<div class="empty">Nenhum item encontrado.</div>`}</section>
    ${nextCategoryBar()}`;
}

function nextCategoryBar() {
  const cats = categories();
  if (cats.length < 2) return "";
  const i = cats.indexOf(state.category);
  const next = cats[(i + 1) % cats.length];
  return `<button type="button" class="next-cat-btn" data-next-cat><span>Próxima categoria</span><b>${escapeHtml(next)} →</b></button>`;
}

function renderInventoryRow(item, readOnly = false) {
  const low = item.minimum != null && item.count != null && item.count < item.minimum;
  const uncounted = item.count == null;
  return `
    <div class="row ${low ? "row-low" : uncounted ? "row-uncounted" : ""}">
      <div class="name">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${item.minimum != null ? `mín ${formatNumber(item.minimum)} ${escapeHtml(item.unit)}` : `un: ${escapeHtml(item.unit)}`}${item.unitsPerPack > 1 ? `<b class="badge pack-badge">pacote ×${item.unitsPerPack}</b>` : ""}${low ? `<b class="badge">abaixo</b>` : ""}${item.unitsPerPack > 1 && item.count != null ? `<span class="pack-total"> = ${formatNumber(item.count * item.unitsPerPack)} un</span>` : ""}</span>
      </div>
      ${readOnly ? `<div class="stock-readonly-value">${item.count == null ? "—" : formatNumber(item.count)} ${escapeHtml(item.unit)}</div>` : `<input class="field qty" type="number" inputmode="decimal" min="0" data-count="${item.id}" value="${item.count ?? ""}" placeholder="0" />`}
      ${!readOnly && isAdmin() ? `<button class="icon-btn" title="Editar item" data-edit="${item.id}">✎</button>` : `<span></span>`}
    </div>`;
}

function formatBRL(v) {
  return v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function renderPrices() {
  const q = state.query.toLowerCase();
  const items = state.data.items.filter((i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
  const chopp = state.data.chopp.filter((i) => i.name.toLowerCase().includes(q) || i.brand.toLowerCase().includes(q));
  return `
    <div class="toolbar">
      <input class="search" data-action="search" value="${escapeHtml(state.query)}" placeholder="Buscar preço..." />
      <span class="price-help">${isAdmin() ? "Clique em Editar para alterar." : "Somente ADMIN pode alterar preços."}</span>
    </div>
    <div class="section-title"><span>Produtos do estoque</span><small class="price-legend">compra · venda · utilitário</small></div>
    <section class="panel">
      ${items.map((i) => `
        <div class="row price-row">
          <div class="name"><strong>${escapeHtml(i.name)}</strong><span>${escapeHtml(i.category)} · ${escapeHtml(i.unit)}</span></div>
          <div class="price-trio">
            <span class="pchip pchip-buy" title="Preço de compra">C ${formatBRL(i.purchasePrice)}</span>
            <span class="pchip pchip-sell" title="Preço de venda">V ${formatBRL(i.price)}</span>
            <span class="pchip pchip-util" title="Preço utilitário">U ${formatBRL(i.utilityPrice)}</span>
          </div>
          ${isAdmin() ? `<button class="btn" data-price-edit="item:${i.id}">Editar</button>` : ""}
        </div>`).join("") || `<div class="empty">Nenhum produto encontrado.</div>`}
    </section>
    <div class="section-title"><span>Chopp</span></div>
    <section class="panel">
      ${chopp.map((i) => `
        <div class="row price-row">
          <div class="name"><strong>${escapeHtml(i.name)}</strong><span>${escapeHtml(i.brand)}</span></div>
          <strong class="price-value">${formatBRL(i.price)}</strong>
          ${isAdmin() ? `<button class="btn" data-price-edit="chopp:${i.id}">Editar</button>` : ""}
        </div>`).join("") || `<div class="empty">Nenhum chopp encontrado.</div>`}
    </section>`;
}

function renderChopp() {
  const brands = [...new Set(state.data.chopp.map((i) => i.brand))];
  const dis = canManage() ? "" : "disabled";
  const active = brands.includes(state.choppBrand) ? state.choppBrand : brands[0];
  const nav = `<div class="chopp-brands">${brands.map((b) => `<button type="button" class="chopp-brand ${b === active ? "active" : ""}" data-chopp-brand="${escapeHtml(b)}">${escapeHtml(b)}</button>`).join("")}</div>`;
  const list = state.data.chopp.filter((i) => i.brand === active);
  return `${nav}
    <section class="grid">
      ${list.map((item) => renderChoppCard(item, dis)).join("") || `<div class="empty">Sem chopps nesta casa.</div>`}
    </section>`;
}

function renderChoppCard(item, dis) {
  return `
    <article class="card">
      <div class="card-head">
        <div><h3>${escapeHtml(item.name)}</h3><small>${escapeHtml(item.brand)}</small></div>
        <label><small>reserva</small><input class="field qty" type="number" min="0" inputmode="numeric" data-reserve="${item.id}" value="${item.reserve}" ${dis}></label>
      </div>
      ${item.taps.map((tap, index) => `
        <div class="tap">
          <div>
            <small>${item.taps.length > 1 ? `torneira ${index + 1}` : "torneira"}</small>
            <div class="meter"><span style="width:${Math.max(tap.level, 3)}%;background:${colorForLevel(tap.level)}"></span></div>
          </div>
          <select class="select" data-tap="${item.id}:${index}" ${dis}>
            ${LEVELS.map(([label, level]) => `<option value="${level}" ${level === tap.level ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>`).join("")}
    </article>`;
}

function renderReports() {
  return `
    <section class="report-grid">
      <article class="card">
        <div class="section-title"><span>À comprar</span><button class="btn" data-action="csv">CSV</button></div>
        <ul class="report-list">${shoppingList().map((i) => `<li><span>${escapeHtml(i.name)}<br><small>${escapeHtml(i.category)}</small></span><b class="amount">comprar ${formatNumber(i.missing)} ${escapeHtml(i.unit)}</b></li>`).join("") || `<li class="empty">Nada abaixo do mínimo.</li>`}</ul>
      </article>
      <article class="card">
        <div class="section-title"><span>Quantidade consumida</span></div>
        <ul class="report-list">${consumptionList().map((i) => i.inconsistent ? `<li><span>${escapeHtml(i.name)}<br><small>${escapeHtml(i.category)}</small></span><b class="amount" style="color:var(--bad)">⚠ inconsistência</b></li>` : i.consumed > 0 ? `<li><span>${escapeHtml(i.name)}<br><small>${escapeHtml(i.category)} · entrou ${formatNumber(i.entered)} ${escapeHtml(i.unit)}</small></span><b class="amount">-${formatNumber(i.consumed)} ${escapeHtml(i.unit)}</b></li>` : "").join("") || `<li class="empty">Feche uma contagem e reconte depois.</li>`}</ul>
      </article>
      <article class="card">
        <div class="section-title"><span>Chopp crítico</span></div>
        <ul class="report-list">${lowChopp().map((i) => `<li><span>${escapeHtml(i.brand)} ${escapeHtml(i.name)}</span><b class="amount">sem reserva</b></li>`).join("") || `<li class="empty">Nenhum chopp crítico.</li>`}</ul>
      </article>
      <article class="card">
        <div class="section-title"><span>Histórico de inventários</span></div>
        <ul class="report-list">${(state.data.history || []).slice(-8).reverse().map((h) => `<li><span>${escapeHtml(h.code || "Inventário")}</span><b class="amount">${h.at ? new Date(h.at).toLocaleDateString("pt-BR") : ""}</b></li>`).join("") || `<li class="empty">Nenhum inventário fechado.</li>`}</ul>
      </article>
    </section>`;
}

function renderSales() {
  if (!state.pdvSales) {
    state.pdvSalesLoading = true;
    api.pdvSalesSummary().then((r) => { state.pdvSales = r; state.pdvSalesLoading = false; render(); }).catch(() => { state.pdvSalesLoading = false; toast("Não foi possível carregar as vendas"); });
  }
  const data = state.pdvSales;
  if (!data) return `<section class="panel"><div class="empty">Carregando vendas…</div></section>`;
  return `<section class="report-grid">
    <article class="card"><div class="section-title"><span>Vendas processadas</span></div><div class="sales-kpi"><strong>${data.count}</strong><small>pedidos pagos</small></div></article>
    <article class="card"><div class="section-title"><span>Total processado</span></div><div class="sales-kpi"><strong>${formatBRL(data.total)}</strong><small>sem distinção de forma de pagamento</small></div></article>
    <article class="card" style="grid-column:1/-1"><div class="section-title"><span>Últimas vendas</span><button class="btn" data-action="reload-sales">Atualizar</button></div><ul class="report-list">${data.sales.map((x) => `<li class="sale-row" data-sale="${x.id}" role="button" tabindex="0"><span><b>#${escapeHtml(x.reference)}</b> · ${escapeHtml(x.place || "sem local")}${x.plate ? ` · plaquinha ${escapeHtml(x.plate)}` : ""}<br><small>${fmtDateTime(x.createdAt)}</small></span><b class="amount">${formatBRL(x.total)} ›</b></li>`).join("") || `<li class="empty">Nenhuma venda processada.</li>`}</ul></article>
  </section>`;
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function openSale(id) {
  state.modal = { saleDetail: true, loading: true, sale: null, items: [] };
  render();
  try { const r = await api.pdvSaleDetail(id); state.modal = { saleDetail: true, loading: false, sale: r.sale, items: r.items }; }
  catch (e) { state.modal = null; toast(e.status === 403 ? "Sem permissão" : "Não foi possível abrir a venda"); }
  render();
}

function renderSaleDetailModal() {
  const m = state.modal;
  if (m.loading) return `<div class="modal-backdrop"><div class="modal"><div class="empty">Carregando pedido…</div></div></div>`;
  const s = m.sale || {};
  const linhas = (m.items || []).map((it) => {
    const extras = [];
    if (it.sizeLabel) extras.push(escapeHtml(it.sizeLabel));
    if (it.addons?.length) extras.push(it.addons.map((a) => escapeHtml(a.name)).join(" + "));
    if (it.groups?.length) extras.push(it.groups.map((g) => `${escapeHtml(g.groupName)}: ${escapeHtml(g.label)}`).join(" · "));
    if (it.notes) extras.push("Obs.: " + escapeHtml(it.notes));
    return `<li><span><b>${it.quantity}× ${escapeHtml(it.productName)}</b>${extras.length ? `<br><small>${extras.join(" · ")}</small>` : ""}</span><b class="amount">${formatBRL(it.lineTotal)}</b></li>`;
  }).join("") || `<li class="empty">Sem itens.</li>`;
  return `
    <div class="modal-backdrop">
      <form class="modal" data-form="sale-detail" onsubmit="return false">
        <h2>Pedido #${escapeHtml(s.reference || "")}</h2>
        <p style="color:var(--muted);font-size:13px;margin:0 0 10px">
          ${escapeHtml(s.place || "sem local")}${s.plate ? ` · plaquinha ${escapeHtml(s.plate)}` : ""} · ${fmtDateTime(s.createdAt)}${s.user ? ` · ${escapeHtml(s.user)}` : ""}
        </p>
        <ul class="report-list panel" style="list-style:none">${linhas}</ul>
        <div class="pdv-total" style="display:flex;justify-content:space-between;margin-top:12px"><span>Total pago</span><strong>${formatBRL(s.total || 0)}</strong></div>
        <p style="font-size:11px;color:var(--muted);margin:6px 0 0">Pagamento confirmado. A forma de pagamento não é registrada.</p>
        <div class="modal-actions"><button class="btn primary" type="button" data-action="close-modal">Fechar</button></div>
      </form>
    </div>`;
}

// ---------- Aba do Dono ----------
const OWNER_PERIODS = [["dia", "Diário"], ["semana", "Semanal"], ["mes", "Mensal"]];

async function loadOwner() {
  state.ownerBusy = true; render();
  try {
    const [summary, order] = await Promise.all([api.ownerSummary(), api.ownerPurchaseOrder()]);
    state.owner = summary; state.ownerOrder = order;
  } catch (e) {
    toast(e.status === 403 ? "Somente ADMIN" : "Erro ao carregar dados do dono");
  } finally { state.ownerBusy = false; render(); }
}

function renderOwner() {
  const p = state.ownerPeriod;
  const s = state.owner;
  const periodTabs = `<div class="owner-periods">${OWNER_PERIODS.map(([id, label]) =>
    `<button type="button" class="chopp-brand ${p === id ? "active" : ""}" data-owner-period="${id}">${label}</button>`).join("")}</div>`;

  if (!s) {
    return `<div class="section-title"><span>Painel do dono</span></div>
      <div class="empty">${state.ownerBusy ? "Carregando…" : `<button class="btn primary" data-action="owner-load">Carregar painel</button>`}</div>`;
  }

  const g = s.gasto[p] || { total: 0, entries: 0, semPreco: 0, range: {} };
  const ga = s.ganho[p] || { total: 0, count: 0, porCategoria: {} };
  const saldo = Number(ga.total) - Number(g.total);
  const range = g.range && g.range.startDate ? (g.range.startDate === g.range.endDate ? g.range.startDate : `${g.range.startDate} a ${g.range.endDate}`) : "";
  const order = state.ownerOrder || { companies: [], byCompany: {}, total: 0, text: "" };

  return `
    <div class="toolbar">
      <span class="price-help">Dia de bar: 06:00 às 05:59 do dia seguinte.</span>
      <button class="btn" data-action="owner-load" ${state.ownerBusy ? "disabled" : ""}>${state.ownerBusy ? "Atualizando…" : "Atualizar"}</button>
    </div>
    ${periodTabs}
    <small class="owner-range">${range ? `Período: ${range}` : ""}</small>

    <section class="grid owner-grid">
      <article class="card owner-card">
        <div class="card-head"><h3>Gasto com estoque</h3></div>
        <p class="owner-big owner-neg">${formatBRL(g.total)}</p>
        <small>${g.entries} entrada(s) no período${g.semPreco ? ` · ${g.semPreco} sem preço de compra` : ""}</small>
      </article>
      <article class="card owner-card">
        <div class="card-head"><h3>Ganho esperado (PDV)</h3></div>
        <p class="owner-big owner-pos">${formatBRL(ga.total)}</p>
        <small>${ga.count} venda(s) no período</small>
      </article>
      <article class="card owner-card">
        <div class="card-head"><h3>Saldo</h3></div>
        <p class="owner-big ${saldo >= 0 ? "owner-pos" : "owner-neg"}">${formatBRL(saldo)}</p>
        <small>ganho − gasto</small>
      </article>
    </section>

    ${Object.keys(ga.porCategoria || {}).length ? `
      <div class="section-title"><span>Ganho por categoria</span></div>
      <section class="panel">${Object.entries(ga.porCategoria).map(([cat, val]) =>
        `<div class="row price-row"><div class="name"><strong>${escapeHtml(cat)}</strong></div><strong class="price-value">${formatBRL(val)}</strong></div>`).join("")}</section>` : ""}

    <div class="section-title"><span>Relatório de vendas</span></div>
    <section class="panel owner-actions-panel">
      <p class="price-help">Exporte as vendas do dia com itens e horários para bater com maquininha e caixa.</p>
      <button class="btn" data-action="owner-xlsx">Baixar planilha (.xlsx)</button>
    </section>

    <div class="section-title"><span>Compras automáticas</span><small class="price-legend">${order.total} item(ns) em falta</small></div>
    <section class="panel owner-actions-panel">
      <p class="price-help">Mensagem pronta para copiar e enviar ao fornecedor, separada por empresa (categoria).</p>
      <textarea class="field owner-order-text" id="owner-order" rows="10" readonly>${escapeHtml(order.text || "Nenhum item em falta.")}</textarea>
      <div class="owner-btn-row">
        <button class="btn primary" data-action="owner-copy">Copiar mensagem</button>
        <button class="btn" data-action="owner-order-txt">Baixar .txt</button>
        <button class="btn" data-action="owner-xlsx">Baixar planilha completa (.xlsx)</button>
      </div>
    </section>`;
}

function renderCatalog() {
  const grouped = categories().map((c) => state.data.items.filter((i) => i.category === c));
  return `
    <div class="toolbar">
      <input class="search" data-action="search" value="${escapeHtml(state.query)}" placeholder="Buscar no cadastro..." />
      <button class="btn primary" data-action="new-item">Novo item</button>
    </div>
    ${grouped.map((items) => {
      const visible = items.filter((i) => i.name.toLowerCase().includes(state.query.toLowerCase()));
      if (!visible.length) return "";
      return `<div class="section-title"><span>${escapeHtml(items[0].category)}</span></div><section class="panel">${visible.map((i) => `
        <div class="row">
          <div class="name"><strong>${escapeHtml(i.name)}</strong><span>mín ${i.minimum == null ? "-" : formatNumber(i.minimum)} · ${escapeHtml(i.unit)}</span></div>
          <button class="btn" data-edit="${i.id}">Editar</button>
          <button class="icon-btn" data-delete="${i.id}" title="Excluir">×</button>
        </div>`).join("")}</section>`;
    }).join("")}`;
}

function pdvCategories() { return state.pdv?.categories || []; }
function pdvCategory(key) { return pdvCategories().find((c) => c.key === key); }
function openOperator() {
  state.view = "operador"; state.query = ""; pdvSuccess = null;
  if (!state.pdv) {
    render();
    api.getPdvCatalog().then((catalog) => { state.pdv = catalog; render(); }).catch(() => toast("Não foi possível carregar o cardápio"));
  } else render();
}
function renderOperatorHome() {
  const cats = pdvCategories();
  return `<div class="pdv-shell">
    <div class="pdv-header"><div><span class="eyebrow">PDV</span><h2>O que vai sair?</h2><p>Monte o pedido e receba o pagamento na hora.</p></div><button class="btn" data-action="pdv-go-cart">Pedido <b>${cartCount(state.pdvCart)}</b></button></div>
    ${!state.pdv ? `<div class="pdv-loading">Carregando cardápio…</div>` : `<div class="pdv-home-grid">${cats.map((c) => `<button type="button" class="pdv-cat ${c.products.length ? "" : "is-empty"}" data-pdv-category="${escapeHtml(c.key)}"><span class="pdv-cat-icon">${pdvIcon(c.key)}</span><strong>${escapeHtml(c.label)}</strong><small>${c.products.length ? `${c.products.length} itens` : "Em cadastro"}</small></button>`).join("")}</div>`}
    ${renderPdvCartBar()}
  </div>`;
}
function renderPdvCategory() {
  const cat = pdvCategory(state.pdvCategory);
  if (!cat) return renderOperatorHome();
  const q = state.query.trim().toLowerCase();
  const products = cat.products.filter((p) => !q || p.name.toLowerCase().includes(q));
  return `<div class="pdv-shell">
    <div class="pdv-header pdv-header-tight"><div><button class="text-btn" data-action="pdv-home">← Categorias</button><span class="eyebrow">${escapeHtml(cat.label)}</span><h2>${escapeHtml(cat.label)}</h2></div><button class="btn" data-action="pdv-go-cart">Pedido <b>${cartCount(state.pdvCart)}</b></button></div>
    <div class="pdv-toolbar"><input class="search" data-action="pdv-search" value="${escapeHtml(state.query)}" placeholder="Buscar item..." inputmode="search"></div>
    <div class="pdv-products">${products.map((p) => renderPdvProduct(p, cat.key)).join("") || `<div class="empty">Nenhum item encontrado.</div>`}</div>
    ${renderPdvCartBar()}
  </div>`;
}
function renderPdvProduct(p, category) {
  const price = category === "chopp" ? `a partir de ${formatBRL(p.sizes?.[0]?.price || 0)}` : formatBRL(p.price);
  const hint = category === "chopp" ? `${p.sizes?.map((s) => s.label).join(" · ")}` : category === "drink" && p.groups?.length ? `${p.groups.length} escolhas` : p.notesAllowed ? "observação disponível" : "Toque para adicionar";
  return `<button type="button" class="pdv-product" data-pdv-product="${p.id}"><span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(hint)}</small></span><b>${escapeHtml(price)}</b></button>`;
}
function renderPdvCartBar() {
  if (!state.pdvCart.length) return `<div class="pdv-cart-empty"><span>Pedido vazio</span><small>Escolha um item para começar.</small></div>`;
  return `<button type="button" class="pdv-cart-bar" data-action="pdv-go-cart"><span><strong>${cartCount(state.pdvCart)} ${cartCount(state.pdvCart) === 1 ? "item" : "itens"}</strong><small>Pagamento será confirmado no fechamento</small></span><b>${formatBRL(cartTotal(state.pdvCart))} →</b></button>`;
}
function renderPdvClose() {
  if (pdvSuccess) return renderPdvSuccess();
  return `<div class="pdv-shell pdv-close-shell">
    <div class="pdv-header"><div><button class="text-btn" data-action="pdv-back-category">← Continuar pedido</button><span class="eyebrow">Fechamento</span><h2>Conferir e receber</h2><p>Pagamento imediato. Não registramos a forma de pagamento.</p></div></div>
    <section class="pdv-order-card"><div class="pdv-order-lines">${renderPdvCartLines(true)}</div><div class="pdv-total"><span>Total</span><strong>${formatBRL(cartTotal(state.pdvCart))}</strong></div></section>
    <section class="pdv-close-form">
      <label>Plaquinha (opcional)<input class="field" data-pdv-plate value="${escapeHtml(state.pdvPlate)}" placeholder="Ex.: 27" inputmode="text" autocomplete="off"></label>
      <div class="pdv-map-title"><span>Localização do cliente</span><small>Toque diretamente na área</small></div>
      ${renderPdvMap()}
      <label class="pdv-no-table"><input type="checkbox" data-pdv-no-table ${state.pdvNoTable ? "checked" : ""}><span><strong>Sem mesa</strong><small>Use quando o cliente estiver sem mesa ou no balcão.</small></span></label>
    </section>
    <button type="button" class="btn primary pdv-confirm" data-action="pdv-confirm" ${state.pdvCart.length && (state.pdvPlace || state.pdvNoTable) && !pdvProcessing ? "" : "disabled"}>${pdvProcessing ? "Processando…" : "Confirmar pagamento"}</button>
    <p class="pdv-demo-note">A venda será registrada e os movimentos de estoque aplicáveis serão processados em uma única transação.</p>
  </div>`;
}
function renderPdvMap() {
  const sel = (place) => state.pdvPlace === place && !state.pdvNoTable;
  const spot = (cls, label, code, extra = "") =>
    `<button type="button" class="pdv-map-place ${cls} ${sel(code) ? "selected" : ""}" data-pdv-map-place="${escapeHtml(code)}"><strong>${label}</strong>${extra}${sel(code) ? '<b class="map-x">✕</b>' : ""}</button>`;
  const table = '<span class="map-table">▭</span>';
  return `<div class="pdv-map-frame">
    <div class="pdv-map-heading">MAPA</div>
    <div class="pdv-map" role="group" aria-label="Mapa do bar">
      ${spot("map-front", "EXTERNO<br>FRENTE", "Externo Frente")}
      ${spot("map-sala1", "SALÃO 1", "Salão 1", table)}
      <div class="map-corridor" aria-hidden="true"></div>
      ${spot("map-sala3", "SALÃO 3", "Salão 3", table)}
      ${spot("map-sala4", "SALÃO 4", "Salão 4", table)}
      ${spot("map-fundos", "EXTERNO FUNDOS", "Externo Fundos")}
      ${spot("map-bar", "BAR", "Bar", '<span class="map-icon">🍸</span>')}
      <div class="pdv-map-place map-kitchen disabled" aria-disabled="true"><strong>COZINHA</strong><span class="map-icon">🍴</span></div>
      ${spot("map-sala2", "SALÃO 2", "Salão 2", table)}
    </div>
  </div>`;
}
function renderPdvSuccess() {
  return `<div class="pdv-shell pdv-success"><div class="pdv-success-card"><span class="pdv-success-icon">✓</span><span class="eyebrow">Pagamento confirmado</span><h2>Pedido processado</h2><p>${pdvSuccess.plate ? `Plaquinha ${escapeHtml(pdvSuccess.plate)} · ` : ""}${escapeHtml(pdvSuccess.place || "Local não informado")}</p><strong>${formatBRL(pdvSuccess.total)}</strong><small>Venda #${escapeHtml(pdvSuccess.reference)}</small><button class="btn primary" data-action="pdv-new-sale">Nova venda</button></div></div>`;
}
function renderPdvCartLines(full = false) {
  return state.pdvCart.map((item, i) => `<article class="pdv-cart-line"><div class="pdv-line-main"><strong>${item.qty}× ${escapeHtml(item.name)}${item.sizeLabel ? ` · ${escapeHtml(item.sizeLabel)}` : ""}</strong><small>${renderPdvSelections(item)}</small></div><div class="pdv-line-actions"><b>${formatBRL(itemTotal(item))}</b>${full ? `<button type="button" class="icon-btn" data-pdv-edit="${i}" aria-label="Editar item">✎</button><button type="button" class="icon-btn" data-pdv-minus="${i}" aria-label="Diminuir">−</button><button type="button" class="icon-btn" data-pdv-plus="${i}" aria-label="Aumentar">+</button><button type="button" class="icon-btn" data-pdv-remove="${i}" aria-label="Remover">×</button>` : ""}</div></article>`).join("");
}
function renderPdvSelections(item) {
  const bits = [];
  if (item.addons?.length) bits.push(item.addons.map((a) => a.name).join(" + "));
  if (item.groups?.length) bits.push(item.groups.map((g) => `${g.groupName}: ${g.label}`).join(" · "));
  if (item.notes) bits.push(`Obs.: ${item.notes}`);
  return escapeHtml(bits.join(" · ")) || "";
}
function pdvIcon(key) { return ({ chopp: "🍺", lanche: "🍔", porcao: "🍟", drink: "🍹", refri: "🥤", dose: "🥃" }[key] || "•"); }
function openPdvProduct(productId) {
  const cat = pdvCategory(state.pdvCategory); const product = cat?.products.find((p) => String(p.id) === String(productId));
  if (!product) return;
  if (!product.sizes?.length && !product.groups?.length && !product.hasAddons && !product.notesAllowed) return addPdvItem(product, {});
  state.modal = { pdvProduct: product, pdvDraft: { sizeId: product.sizes?.[0]?.id || null, groups: {}, addons: [], notes: "" } };
  render();
}
function addPdvItem(product, draft) {
  const editingIndex = Number.isInteger(state.modal?.editingIndex) ? state.modal.editingIndex : null;
  let unitPrice = Number(product.price) || 0; let size = null;
  if (draft.sizeId != null) { size = (product.sizes || []).find((s) => String(s.id) === String(draft.sizeId)); if (!size) return toast("Escolha um tamanho"); unitPrice = Number(size.price) || 0; }
  const groups = Object.entries(draft.groups || {}).map(([groupId, optionId]) => { const g = (product.groups || []).find((x) => String(x.id) === String(groupId)); const o = g?.options.find((x) => String(x.id) === String(optionId)); return g && o ? { groupId: g.id, groupName: g.name, optionId: o.id, label: o.label, stockItemId: o.stockItemId } : null; }).filter(Boolean);
  for (const g of product.groups || []) if (g.required && !groups.some((x) => x.groupId === g.id)) return toast(`Escolha: ${g.name}`);
  const addons = (draft.addons || []).map((id) => state.pdv.addons.find((a) => String(a.id) === String(id))).filter(Boolean);
  const newItem = { productId: product.id, name: product.name, category: product.category, sizeId: size?.id || null, sizeLabel: size?.label || "", unitPrice, qty: 1, addons, groups, notes: String(draft.notes || "").trim() };
  if (editingIndex != null && state.pdvCart[editingIndex]) { const next = state.pdvCart.slice(); next.splice(editingIndex, 1); state.pdvCart = addToCart(next, newItem); }
  else state.pdvCart = addToCart(state.pdvCart, newItem);
  savePdvCart(); state.modal = null; render(); toast(`${product.name} adicionado`);
}
function renderPdvProductModal() {
  const p = state.modal.pdvProduct, d = state.modal.pdvDraft;
  const modalPrice = p.sizes?.length ? "Escolha o tamanho" : formatBRL(p.price);
  return `<div class="modal-backdrop"><form class="modal pdv-product-modal" data-form="pdv-product"><div class="pdv-modal-head"><div><span class="eyebrow">Adicionar ao pedido</span><h2>${escapeHtml(p.name)}</h2></div><b>${escapeHtml(modalPrice)}</b></div>
    ${p.sizes?.length ? `<fieldset><legend>Tamanho</legend><div class="pdv-choice-grid">${p.sizes.map((s) => `<label class="pdv-choice"><input type="radio" name="sizeId" value="${s.id}" ${String(d.sizeId) === String(s.id) ? "checked" : ""}><span>${escapeHtml(s.label)}<b>${formatBRL(s.price)}</b></span></label>`).join("")}</div></fieldset>` : ""}
    ${(p.groups || []).map((g) => `<fieldset><legend>${escapeHtml(g.name)}${g.required ? " *" : ""}</legend><div class="pdv-choice-grid">${g.options.map((o) => `<label class="pdv-choice"><input type="radio" name="group-${g.id}" value="${o.id}" ${String(d.groups[g.id]) === String(o.id) ? "checked" : ""}><span>${escapeHtml(o.label)}</span></label>`).join("")}</div></fieldset>`).join("")}
    ${p.hasAddons ? `<fieldset><legend>Adicionais</legend><div class="pdv-choice-grid">${state.pdv.addons.map((a) => `<label class="pdv-choice"><input type="checkbox" name="addon" value="${a.id}" ${d.addons.map(String).includes(String(a.id)) ? "checked" : ""}><span>${escapeHtml(a.name)}<b>+ ${formatBRL(a.price)}</b></span></label>`).join("")}</div></fieldset>` : ""}
    ${p.notesAllowed ? `<label class="pdv-notes">Observação<textarea name="notes" rows="3" maxlength="160" placeholder="Ex.: sem cebola, molho separado...">${escapeHtml(d.notes)}</textarea></label>` : ""}
    <div class="modal-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Adicionar ao pedido</button></div>
  </form></div>`;
}
function renderPdvCartModal() {
  return `<div class="modal-backdrop"><section class="modal pdv-cart-modal"><div class="pdv-modal-head"><div><span class="eyebrow">Pedido</span><h2>${cartCount(state.pdvCart)} ${cartCount(state.pdvCart) === 1 ? "item" : "itens"}</h2></div><b>${formatBRL(cartTotal(state.pdvCart))}</b></div><div class="pdv-cart-list">${renderPdvCartLines(true) || `<div class="empty">Pedido vazio.</div>`}</div><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">Continuar</button><button class="btn primary" type="button" data-action="pdv-checkout" ${state.pdvCart.length ? "" : "disabled"}>Receber pagamento</button></div></section></div>`;
}
async function confirmPdvSale() {
  if (pdvProcessing) return;
  if (!state.pdvCart.length) return toast("Pedido vazio");
  if (!state.pdvPlace && !state.pdvNoTable) return toast("Selecione o local no mapa ou marque Sem mesa");
  if (!navigator.onLine) return toast("Sem internet: pagamento não pode ser processado");
  pdvProcessing = true; render();
  const reference = currentPdvReference();
  const payload = {
    reference,
    plate: state.pdvPlate.trim() || null,
    place: state.pdvNoTable ? "Sem mesa" : state.pdvPlace,
    items: state.pdvCart.map((x) => ({
      productId: x.productId, sizeId: x.sizeId || null, quantity: x.qty,
      addonIds: (x.addons || []).map((a) => a.id),
      groups: (x.groups || []).map((g) => ({ groupId: g.groupId, optionId: g.optionId })),
      notes: x.notes || "",
    })),
  };
  try {
    const r = await api.createPdvSale(payload);
    pdvSuccess = { ...r.sale, reference: r.sale.reference || reference };
    clearPdvReference();
    state.pdvCart = []; state.pdvPlate = ""; state.pdvPlace = ""; state.pdvNoTable = false; savePdvCart();
    state.modal = null; state.view = "pdv-close";
  } catch (e) {
    // Mantém a referência: uma nova tentativa reusa a mesma e o backend deduplica.
    toast(e.status === 401 ? "Sessão expirada" : (e.message || "Não foi possível processar a venda"));
  } finally { pdvProcessing = false; render(); }
}
function renderModal() {
  if (state.modal.users) return renderUsersModal();
  if (state.modal.resetConfirm) return renderResetModal();
  if (state.modal.pdvProduct) return renderPdvProductModal();
  if (state.modal.pdvCart) return renderPdvCartModal();
  if (state.modal.saleDetail) return renderSaleDetailModal();
  if (state.modal.priceEdit) return renderPriceEditModal();
  const item = state.modal?.item || {};
  return `
    <div class="modal-backdrop">
      <form class="modal" data-form="item">
        <h2>${item.id ? "Editar item" : "Novo item"}</h2>
        <input type="hidden" name="id" value="${item.id || ""}">
        <div class="form-grid">
          <label>Categoria<input class="field" name="category" value="${escapeHtml(item.category || state.category || "")}" required></label>
          <label>Nome<input class="field" name="name" value="${escapeHtml(item.name || "")}" required></label>
          <label>Mínimo<input class="field" name="minimum" type="number" step="0.01" min="0" value="${item.minimum ?? ""}"></label>
          <label>Preço (R$)<input class="field" name="price" type="number" step="0.01" min="0" value="${item.price ?? ""}"></label>
          <label>Unidade de contagem/comercial<input class="field" name="unit" value="${escapeHtml(item.unit || "unidade")}"></label>
          <label>Unidade-base <small style="color:var(--muted)">(cálculo/PDV)</small><input class="field" name="baseUnit" value="${escapeHtml(item.baseUnit || item.unit || "unidade")}"></label>
          <label>Unidades por pacote <small style="color:var(--muted)">(Modelo A)</small><input class="field" name="unitsPerPack" type="number" min="1" step="1" value="${item.unitsPerPack ?? 1}"></label>
        </div>
        <p style="font-size:11px;color:var(--muted);margin:6px 0 0">A unidade de contagem mantém a operação rápida. A unidade-base é usada para cálculo e consumo futuro pelo PDV. "Unidades por pacote" permite converter automaticamente pacote → unidade-base.</p>
        <div style="margin-top:12px">
          <label>Conversões para o leitor <small style="color:var(--muted)">(ex.: cx=36; pacote=12)</small>
            <textarea class="field" name="conversions" rows="3" placeholder="cx=36; pacote=12">${escapeHtml(item.conversions ? item.conversions.map((x) => `${x.from}=${x.factor}`).join("; ") : "")}</textarea>
          </label>
          <p style="font-size:11px;color:var(--muted);margin:5px 0 0">Ex.: se o estoque é em unidade e 1 caixa contém 36 unidades, use <b>cx=36</b>. Alterar esta regra não altera entradas já registradas.</p>
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" data-action="close-modal">Cancelar</button>
          <button class="btn primary" type="submit">Salvar</button>
        </div>
      </form>
    </div>`;
}

function renderResetModal() {
  const errado = state.modal.errado;
  return `
    <div class="modal-backdrop">
      <form class="modal" data-form="reset-confirm">
        <h2>Preparar estoque para operação real</h2>
        <p style="color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 10px;">
          Isso vai remover <b>somente</b> as contagens atuais e reiniciar o painel de chopp.<br>
          Catálogo, preços, inventários históricos e auditoria serão preservados.
        </p>
        <label>Para confirmar, digite <b>ZERAR</b><input class="field" name="confirm" autocomplete="off" autocapitalize="characters" required></label>
        ${errado ? `<p style="color:var(--bad);font-size:12px;margin:6px 0 0;">Texto incorreto. Digite exatamente ZERAR.</p>` : ""}
        <div class="modal-actions">
          <button class="btn" type="button" data-action="close-modal">Cancelar</button>
          <button class="btn danger" type="submit">Zerar contagem</button>
        </div>
      </form>
    </div>`;
}

function renderUsersModal() {
  const list = state.modal.list || [];
  return `
    <div class="modal-backdrop">
      <form class="modal" data-form="user">
        <h2>Usuários</h2>
        <ul class="report-list">${list.map((u) => `<li><span>${escapeHtml(u.name)}<br><small>@${escapeHtml(u.username)} · ${u.role}${u.active ? "" : " · inativo"}</small></span></li>`).join("") || `<li class="empty">${state.modal.loaded ? "Nenhum usuário cadastrado." : "Carregando…"}</li>`}</ul>
        <h3 style="margin:12px 0 6px;font-size:14px;">Novo usuário</h3>
        <div class="form-grid">
          <label>Usuário<input class="field" name="username" required></label>
          <label>Nome<input class="field" name="name"></label>
          <label>Senha<input class="field" name="password" type="password" required></label>
          <label>Papel<select class="select" name="role"><option>OPERATOR</option><option>MANAGER</option><option>ADMIN</option></select></label>
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" data-action="close-modal">Fechar</button>
          <button class="btn primary" type="submit">Criar</button>
        </div>
      </form>
    </div>`;
}

// ---------- eventos ----------
function bindEvents() {
  document.querySelectorAll("[data-pdv-category]").forEach((b) => b.addEventListener("click", () => {
    if (!b.classList.contains("is-empty")) { state.pdvCategory = b.dataset.pdvCategory; state.view = "pdv-category"; state.query = ""; render(); } else toast("Essa categoria ainda está em cadastro");
  }));
  document.querySelectorAll("[data-pdv-product]").forEach((b) => b.addEventListener("click", () => openPdvProduct(b.dataset.pdvProduct)));
  document.querySelectorAll("[data-pdv-map-place]").forEach((b) => b.addEventListener("click", () => { state.pdvPlace = b.dataset.pdvMapPlace; state.pdvNoTable = false; savePdvCart(); render(); }));
  document.querySelector("[data-pdv-no-table]")?.addEventListener("change", (e) => { state.pdvNoTable = e.currentTarget.checked; if (state.pdvNoTable) state.pdvPlace = ""; savePdvCart(); render(); });
  document.querySelectorAll("[data-pdv-edit]").forEach((b) => b.addEventListener("click", () => {
    const i = Number(b.dataset.pdvEdit), item = state.pdvCart[i], cat = pdvCategory(item?.category); const product = cat?.products.find((p) => String(p.id) === String(item?.productId));
    if (!product) return toast("Item não encontrado no cardápio");
    state.modal = { pdvProduct: product, editingIndex: i, pdvDraft: { sizeId: item.sizeId || null, groups: Object.fromEntries((item.groups || []).map((g) => [g.groupId, g.optionId])), addons: (item.addons || []).map((a) => a.id), notes: item.notes || "" } }; render();
  }));
  document.querySelectorAll("[data-pdv-minus]").forEach((b) => b.addEventListener("click", () => { state.pdvCart = setItemQty(state.pdvCart, Number(b.dataset.pdvMinus), (state.pdvCart[Number(b.dataset.pdvMinus)]?.qty || 1) - 1); savePdvCart(); render(); }));
  document.querySelectorAll("[data-pdv-plus]").forEach((b) => b.addEventListener("click", () => { const i = Number(b.dataset.pdvPlus); state.pdvCart = setItemQty(state.pdvCart, i, (state.pdvCart[i]?.qty || 0) + 1); savePdvCart(); render(); }));
  document.querySelectorAll("[data-pdv-remove]").forEach((b) => b.addEventListener("click", () => { state.pdvCart = setItemQty(state.pdvCart, Number(b.dataset.pdvRemove), 0); savePdvCart(); render(); }));
  document.querySelectorAll("[data-action='pdv-search']").forEach((input) => input.addEventListener("input", () => { state.query = input.value; render(); const n = document.querySelector("[data-action='pdv-search']"); n?.focus(); n?.setSelectionRange(state.query.length, state.query.length); }));
  document.querySelector("[data-form='pdv-product']")?.addEventListener("submit", (e) => { e.preventDefault(); const p = state.modal.pdvProduct; const f = new FormData(e.currentTarget); const d = { sizeId: f.get("sizeId"), groups: {}, addons: f.getAll("addon"), notes: f.get("notes") || "" }; for (const g of p.groups || []) d.groups[g.id] = f.get(`group-${g.id}`); addPdvItem(p, d); });
  document.querySelector("[data-pdv-plate]")?.addEventListener("input", (e) => { state.pdvPlate = e.currentTarget.value; savePdvCart(); });
  document.querySelector("[data-pdv-place]")?.addEventListener("change", (e) => { state.pdvPlace = e.currentTarget.value; savePdvCart(); });
  document.querySelectorAll("[data-action='pdv-go-cart']").forEach((b) => b.addEventListener("click", () => { state.modal = { pdvCart: true }; render(); }));
  document.querySelectorAll("[data-action='pdv-home']").forEach((b) => b.addEventListener("click", () => { state.view = "operador"; state.query = ""; render(); }));
  document.querySelectorAll("[data-action='pdv-back-category']").forEach((b) => b.addEventListener("click", () => { state.view = state.pdvCategory ? "pdv-category" : "operador"; render(); }));
  document.querySelectorAll("[data-action='pdv-checkout']").forEach((b) => b.addEventListener("click", () => { state.modal = null; state.view = "pdv-close"; render(); }));
  document.querySelectorAll("[data-action='pdv-confirm']").forEach((b) => b.addEventListener("click", confirmPdvSale));
  // ---- Compras / Entradas ----
  const pt = document.querySelector("[data-purchase-text]");
  if (pt) pt.addEventListener("input", (e) => { state.purchaseText = e.target.value; });
  document.querySelectorAll("[data-action='purchase-preview']").forEach((b) => b.addEventListener("click", loadPurchasePreview));
  document.querySelectorAll("[data-action='sub-add']").forEach((b) => b.addEventListener("click", doAddSub));
  document.querySelectorAll("[data-sub-remove]").forEach((b) => b.addEventListener("click", () => doRemoveSub(Number(b.dataset.subRemove))));
  document.querySelectorAll("[data-action='purchase-paste']").forEach((b) => b.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      const el = document.querySelector("[data-purchase-text]");
      if (!el) return;
      state.purchaseText = text || ""; el.value = state.purchaseText;
      toast(text ? "Texto colado. Clique em Ler pedido." : "Área de transferência vazia.");
    } catch { toast("Não foi possível acessar a área de transferência. Cole manualmente."); }
  }));
  document.querySelectorAll("[data-action='purchase-confirm']").forEach((b) => b.addEventListener("click", doConfirmPurchase));
  const pd = document.querySelector("[data-purchase-date]");
  if (pd) pd.addEventListener("change", (e) => { state.purchaseDate = e.target.value; });
  document.querySelectorAll("[data-purchase-qty]").forEach((el) => el.addEventListener("change", (e) => {
    const i = Number(el.dataset.purchaseQty); if (state.purchaseLines?.[i]) { state.purchaseLines[i].quantity = Number(e.target.value); updatePurchaseConversion(i); render(); }
  }));
  document.querySelectorAll("[data-purchase-item]").forEach((el) => el.addEventListener("change", (e) => {
    const i = Number(el.dataset.purchaseItem); if (state.purchaseLines?.[i]) { state.purchaseLines[i].chosenItemId = e.target.value; updatePurchaseConversion(i); render(); }
  }));
  document.querySelectorAll("[data-purchase-remove]").forEach((el) => el.addEventListener("click", () => {
    const i = Number(el.dataset.purchaseRemove); if (state.purchaseLines) { state.purchaseLines.splice(i, 1); render(); }
  }));
  document.querySelectorAll("[data-action='pdv-new-sale']").forEach((b) => b.addEventListener("click", () => { pdvSuccess = null; state.view = "operador"; state.pdvCategory = null; state.query = ""; render(); }));
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.view === "operador") return openOperator(); state.view = b.dataset.view; state.query = ""; render(); if (b.dataset.view === "dono" && !state.owner && !state.ownerBusy) loadOwner(); }));
  document.querySelectorAll("[data-chopp-brand]").forEach((b) => b.addEventListener("click", () => { state.choppBrand = b.dataset.choppBrand; render(); }));
  document.querySelectorAll("[data-owner-period]").forEach((b) => b.addEventListener("click", () => { state.ownerPeriod = b.dataset.ownerPeriod; render(); }));
  document.querySelectorAll("[data-sale]").forEach((el) => el.addEventListener("click", () => openSale(el.dataset.sale)));
  document.querySelectorAll("[data-next-cat]").forEach((b) => b.addEventListener("click", () => {
    const cats = categories(); const i = cats.indexOf(state.category);
    state.category = cats[(i + 1) % cats.length]; state.query = ""; try { localStorage.setItem("estoqueBar.category.v1", state.category); } catch {}
    render(); window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  document.querySelectorAll("[data-category]").forEach((b) => b.addEventListener("click", () => { state.category = b.dataset.category; try { localStorage.setItem("estoqueBar.category.v1", state.category); } catch {} state.query = ""; render(); }));
  document.querySelectorAll("[data-count]").forEach((input) => {
    if (isOperator()) return;
    input.addEventListener("change", () => setCount(input.dataset.count, input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "ArrowDown") {
        e.preventDefault();
        setCount(input.dataset.count, input.value);
        const all = Array.from(document.querySelectorAll("[data-count]"));
        const next = all[all.indexOf(input) + 1];
        if (next) { next.focus(); next.select(); } else input.blur();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const all = Array.from(document.querySelectorAll("[data-count]"));
        const prev = all[all.indexOf(input) - 1];
        if (prev) { prev.focus(); prev.select(); }
      }
    });
  });
  document.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => { state.modal = { item: state.data.items.find((i) => i.id === b.dataset.edit) }; render(); }));
  document.querySelectorAll("[data-price-edit]").forEach((b) => b.addEventListener("click", () => openPriceEditor(b.dataset.priceEdit)));
  document.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", () => deleteItem(b.dataset.delete)));
  document.querySelectorAll("[data-reserve]").forEach((input) => input.addEventListener("change", () => {
    const item = state.data.chopp.find((e) => e.id === input.dataset.reserve);
    item.reserve = Math.max(0, Number(input.value || 0)); saveData(); api.choppReserve(item.id, item.reserve); render();
  }));
  document.querySelectorAll("[data-tap]").forEach((select) => select.addEventListener("change", () => {
    const [id, tapIndex] = select.dataset.tap.split(":");
    const item = state.data.chopp.find((e) => e.id === id);
    const idx = Number(tapIndex);
    item.taps[idx].level = Number(select.value); item.taps[idx].label = labelForLevel(Number(select.value));
    saveData(); api.choppTap(item.id, idx + 1, item.taps[idx].level); render();
  }));
  document.querySelectorAll("[data-action='search']").forEach((input) => input.addEventListener("input", () => {
    state.query = input.value; render();
    const n = document.querySelector("[data-action='search']"); n?.focus(); n?.setSelectionRange(state.query.length, state.query.length);
  }));
  document.querySelectorAll("[data-action]:not([data-action='search'])").forEach((el) => el.addEventListener("click", handleAction));
  document.querySelector("[data-form='item']")?.addEventListener("submit", (e) => { e.preventDefault(); upsertItem(e.currentTarget); });
  document.querySelector("[data-form='reset-confirm']")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const texto = new FormData(e.currentTarget).get("confirm");
    if (String(texto || "").trim().toUpperCase() !== "ZERAR") {
      state.modal = { resetConfirm: true, errado: true };
      return render();
    }
    confirmReset();
  });
  document.querySelector("[data-form='user']")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try { await api.createUser(data); await openUsers(); toast("Usuário criado"); }
    catch (err) { toast(err.status === 409 ? "Usuário já existe" : "Erro ao criar"); }
  });
  document.querySelector("#import-file").onchange = (e) => e.target.files[0] && importJson(e.target.files[0]);
  document.querySelector("[data-form='price']")?.addEventListener("submit", (e) => { e.preventDefault(); savePrices(e.currentTarget); });
}

async function openPriceEditor(key) {
  const [type, id] = key.split(":");
  if (type === "chopp") {
    const item = state.data.chopp.find((i) => i.id === id);
    if (!item) return;
    const price = prompt(`Preço de ${item.name} (R$):`, item.price == null ? "" : String(item.price));
    if (price === null) return;
    const value = parseNumber(price);
    if (value != null && value < 0) return toast("Preço inválido");
    try {
      await api.updateChoppPrice(id, value);
      await reload(); state.view = "precos"; render(); toast("Preço atualizado");
    } catch (e) { toast(e.status === 403 ? "Sem permissão" : "Erro ao salvar preço"); }
    return;
  }
  const item = state.data.items.find((i) => i.id === id);
  if (!item) return;
  state.modal = { priceEdit: true, item };
  render();
}

function renderPriceEditModal() {
  const i = state.modal.item;
  const v = (n) => (n == null ? "" : String(n));
  return `
    <div class="modal-backdrop">
      <form class="modal" data-form="price" role="dialog" aria-modal="true">
        <h2>Preços · ${escapeHtml(i.name)}</h2>
        <div class="form-grid">
          <label>Preço de compra (R$)<input class="field" name="purchasePrice" type="number" step="0.01" min="0" inputmode="decimal" value="${v(i.purchasePrice)}"></label>
          <label>Preço de venda (R$)<input class="field" name="price" type="number" step="0.01" min="0" inputmode="decimal" value="${v(i.price)}"></label>
          <label>Preço utilitário (R$)<input class="field" name="utilityPrice" type="number" step="0.01" min="0" inputmode="decimal" value="${v(i.utilityPrice)}"></label>
        </div>
        <p style="font-size:11px;color:var(--muted);margin:8px 0 0">Utilitário = valor esperado quando o item é vendido dentro de um conjunto (ex.: pão/queijo dentro de um lanche, não vendido separado).</p>
        <div class="modal-actions">
          <button type="button" class="btn" data-action="close-modal">Cancelar</button>
          <button type="submit" class="btn primary">Salvar</button>
        </div>
      </form>
    </div>`;
}

async function savePrices(form) {
  const id = state.modal.item.id;
  const fd = new FormData(form);
  const num = (k) => { const s = String(fd.get(k) ?? "").trim(); return s === "" ? null : parseNumber(s); };
  const data = { purchasePrice: num("purchasePrice"), price: num("price"), utilityPrice: num("utilityPrice") };
  for (const k of ["purchasePrice", "price", "utilityPrice"]) if (data[k] != null && data[k] < 0) return toast("Preço inválido");
  try {
    await api.updateItem(id, data);
    state.modal = null;
    await reload(); state.view = "precos"; render(); toast("Preços atualizados");
  } catch (e) { toast(e.status === 403 ? "Sem permissão" : "Erro ao salvar preços"); }
}

async function openUsers() {
  state.modal = { users: true, list: [], loaded: false };
  render();
  try { const r = await api.listUsers(); state.modal.list = Array.isArray(r) ? r : (r.users || []); }
  catch (e) { state.modal.list = []; toast("Não foi possível carregar usuários"); }
  state.modal.loaded = true; render();
}

function handleAction(e) {
  const action = e.currentTarget.dataset.action;
  if (action === "operador") openOperator();
  if (action === "operator-order") { state.view = "operador"; state.pdvCategory = null; state.query = ""; pdvSuccess = null; openOperator(); }
  if (action === "operator-stock") { state.view = "operador-estoque"; state.query = ""; render(); }
  if (action === "pdv-exit") { if (isOperator()) { state.view = "operador"; render(); } else { state.view = "estoque"; render(); } }
  if (action === "new-item") { state.modal = { item: null }; render(); }
  if (action === "close-modal") { state.modal = null; render(); }
  if (action === "close-count" && confirm("Fixar a contagem atual como base para medir consumo?")) closeCount();
  if (action === "backup") exportJson();
  if (action === "csv") exportCsv();
  if (action === "xlsx") api.downloadXlsx().catch((err) => toast(err.status === 403 ? "Sem permissão" : "Erro ao exportar"));
  if (action === "import") document.querySelector("#import-file").click();
  if (action === "users") openUsers();
  if (action === "reset-inventory") resetInventory();
  if (action === "reload-sales") { state.pdvSales = null; render(); }
  if (action === "owner-load") loadOwner();
  if (action === "owner-xlsx") api.downloadOwnerXlsx(state.ownerPeriod).catch((err) => toast(err.status === 403 ? "Somente ADMIN" : "Erro ao exportar"));
  if (action === "owner-order-txt") api.downloadOrderTxt().catch((err) => toast(err.status === 403 ? "Somente ADMIN" : "Erro ao exportar"));
  if (action === "owner-copy") copyOrderText();
  if (action === "logout") api.logout().then(() => { state.user = null; renderLogin(); });
}

async function copyOrderText() {
  const text = (state.ownerOrder && state.ownerOrder.text) || "";
  if (!text.trim()) return toast("Nenhum item em falta");
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
    else { const t = document.querySelector("#owner-order"); t.removeAttribute("readonly"); t.select(); document.execCommand("copy"); t.setAttribute("readonly", ""); }
    toast("Mensagem copiada");
  } catch { const t = document.querySelector("#owner-order"); if (t) { t.focus(); t.select(); } toast("Selecione e copie manualmente"); }
}

// ---------- estado de conexão ----------
function updateConnBadge(status) {
  const el = document.querySelector("#conn");
  if (!el) return;
  const s = status || (pendingCount() ? "SALVANDO" : "SALVO");
  const map = { SALVO: ["Salvo", "ok"], SALVANDO: ["Salvando…", "warn"], OFFLINE: ["Offline", "warn"], ERRO: ["Erro ao salvar", "bad"] };
  const [text, cls] = map[s] || map.SALVO;
  el.textContent = text;
  el.className = `conn conn-${cls}`;
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div"); el.className = "toast"; el.textContent = message;
  document.body.appendChild(el); setTimeout(() => el.remove(), 2200);
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));

boot();
