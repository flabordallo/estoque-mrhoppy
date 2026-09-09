import { api, onStatus, flush, pendingCount, clearOfflineQueue } from "./api.js";

const STORAGE_KEY = "estoqueBarPwa.v1"; // cache offline do estado vindo do servidor

const LEVELS = [
  ["Cheio", 100], ["Quase cheio", 90], ["Mais da metade", 70], ["Metade", 50],
  ["Menos da metade", 30], ["Quase acabando", 15], ["Acabando", 10], ["Acabou", 0],
];

const state = { view: "estoque", category: "", query: "", modal: null, user: null, data: null };

// ---------- boot / login ----------
async function boot() {
  state.user = await api.me();
  if (!state.user) return renderLogin();
  await reload(true);
  onStatus(updateConnBadge);
  window.addEventListener("needs-login", renderLogin);
  flush();
}

async function reload(useCacheOnFail = false) {
  try {
    state.data = await api.getState();
    saveCache();
  } catch (e) {
    if (e.status === 401) return renderLogin();
    if (useCacheOnFail) state.data = loadCache() || { items: [], chopp: [], history: [], settings: {} };
    else throw e;
  }
  if (!state.category) state.category = categories()[0] || "";
  render();
}

function renderLogin(message = "") {
  document.querySelector("#app").innerHTML = `
    <div class="login-wrap">
      <form class="login-card" data-form="login">
        <h1>Estoque do Bar</h1>
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

// ---------- helpers ----------
function categories() { return [...new Set(state.data.items.map((i) => i.category))]; }
function formatNumber(v) { return v == null || Number.isNaN(v) ? "" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }); }
function parseNumber(v) { if (v === "") return null; const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; }
function labelForLevel(l) { return LEVELS.reduce((b, c) => (Math.abs(c[1] - l) < Math.abs(b[1] - l) ? c : b), LEVELS[0])[0]; }
function colorForLevel(l) { return l >= 50 ? "var(--accent)" : l >= 30 ? "var(--warn)" : "var(--bad)"; }
function shoppingList() { return state.data.items.filter((i) => i.minimum != null && i.count != null && i.count < i.minimum).map((i) => ({ ...i, missing: i.minimum - i.count })).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)); }
function consumptionList() { return state.data.items.filter((i) => i.base != null && i.count != null && i.count < i.base).map((i) => ({ ...i, consumed: i.base - i.count })).sort((a, b) => b.consumed - a.consumed); }
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

function closeCount() {
  state.data.items.forEach((i) => { if (i.count != null) i.base = i.count; });
  state.data.settings.lastClosedAt = new Date().toISOString();
  saveData();
  api.close();
  toast("Contagem fechada");
  render();
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
  document.querySelector("#app").innerHTML = `
    <div class="app-shell">
      ${renderTopbar()}
      ${renderStats()}
      ${renderTabs()}
      ${renderView()}
    </div>
    ${state.modal ? renderModal() : ""}`;
  bindEvents();
  updateConnBadge();
}

function renderTopbar() {
  return `
    <header class="topbar">
      <div class="brand">
        <h1>Estoque do Bar</h1>
        <p>${escapeHtml(state.user.name)} · ${state.user.role} <span id="conn" class="conn"></span></p>
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
      <div class="stat"><span>Consumo</span><strong>${consumptionList().length}</strong><small>itens com saída</small></div>
      <div class="stat ${lowChopp().length ? "stat-bad" : "stat-ok"}"><span>Chopp crítico</span><strong>${lowChopp().length}</strong><small>${lowChopp().length ? "atenção necessária" : "sem alertas"}</small></div>
    </section>`;
}

function renderTabs() {
  const tabs = [["estoque", "Estoque"], ["precos", "Preços"], ["chopp", "Chopp"], ["relatorios", "Relatórios"]];
  if (isAdmin()) tabs.push(["cadastro", "Cadastro"]);
  return `<nav class="tabs">${tabs.map(([id, label]) => `<button class="tab ${state.view === id ? "active" : ""}" data-view="${id}">${label}</button>`).join("")}</nav>`;
}

function renderView() {
  if (state.view === "precos") return renderPrices();
  if (state.view === "chopp") return renderChopp();
  if (state.view === "relatorios") return renderReports();
  if (state.view === "cadastro" && isAdmin()) return renderCatalog();
  return renderInventory();
}

function renderInventory() {
  const filtered = state.data.items.filter((i) => i.category === state.category && i.name.toLowerCase().includes(state.query.toLowerCase()));
  return `
    <div class="toolbar">
      <input class="search" data-action="search" value="${escapeHtml(state.query)}" placeholder="Buscar item..." />
      ${canManage() ? `<button class="btn primary" data-action="close-count">Fechar contagem</button>` : ""}
      ${isAdmin() ? `<button class="btn" data-action="new-item">Novo item</button>` : ""}
    </div>
    <div class="chips">${categories().map((c) => `<button class="chip ${c === state.category ? "active" : ""}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}</div>
    <div class="view-hint"><span>●</span> Digite a quantidade real. Itens sem contagem ficam pendentes.</div>
    <section class="panel">${filtered.map(renderInventoryRow).join("") || `<div class="empty">Nenhum item encontrado.</div>`}</section>`;
}

function renderInventoryRow(item) {
  const low = item.minimum != null && item.count != null && item.count < item.minimum;
  const uncounted = item.count == null;
  return `
    <div class="row ${low ? "row-low" : uncounted ? "row-uncounted" : ""}">
      <div class="name">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${item.minimum != null ? `mín ${formatNumber(item.minimum)} ${escapeHtml(item.unit)}` : `un: ${escapeHtml(item.unit)}`}${low ? `<b class="badge">abaixo</b>` : ""}</span>
      </div>
      <input class="field qty" type="number" inputmode="decimal" min="0" data-count="${item.id}" value="${item.count ?? ""}" placeholder="0" />
      ${isAdmin() ? `<button class="icon-btn" title="Editar item" data-edit="${item.id}">✎</button>` : `<span></span>`}
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
    <div class="section-title"><span>Produtos do estoque</span></div>
    <section class="panel">
      ${items.map((i) => `
        <div class="row price-row">
          <div class="name"><strong>${escapeHtml(i.name)}</strong><span>${escapeHtml(i.category)} · ${escapeHtml(i.unit)}</span></div>
          <strong class="price-value">${formatBRL(i.price)}</strong>
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
  return brands.map((brand) => `
    <div class="section-title"><span>${escapeHtml(brand)}</span></div>
    <section class="grid">
      ${state.data.chopp.filter((i) => i.brand === brand).map((item) => renderChoppCard(item, dis)).join("")}
    </section>`).join("");
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
        <ul class="report-list">${consumptionList().map((i) => `<li><span>${escapeHtml(i.name)}<br><small>${escapeHtml(i.category)}</small></span><b class="amount">-${formatNumber(i.consumed)} ${escapeHtml(i.unit)}</b></li>`).join("") || `<li class="empty">Feche uma contagem e reconte depois.</li>`}</ul>
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

function renderModal() {
  if (state.modal.users) return renderUsersModal();
  if (state.modal.resetConfirm) return renderResetModal();
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
          <label>Unidade<input class="field" name="unit" value="${escapeHtml(item.unit || "unidade")}"></label>
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
        <ul class="report-list">${list.map((u) => `<li><span>${escapeHtml(u.name)}<br><small>@${escapeHtml(u.username)} · ${u.role}${u.active ? "" : " · inativo"}</small></span></li>`).join("") || `<li class="empty">Carregando...</li>`}</ul>
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
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { state.view = b.dataset.view; state.query = ""; render(); }));
  document.querySelectorAll("[data-category]").forEach((b) => b.addEventListener("click", () => { state.category = b.dataset.category; state.query = ""; render(); }));
  document.querySelectorAll("[data-count]").forEach((input) => {
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
}

async function openPriceEditor(key) {
  const [type, id] = key.split(":");
  const source = type === "item" ? state.data.items : state.data.chopp;
  const item = source.find((i) => i.id === id);
  if (!item) return;
  const price = prompt(`Preço de ${item.name} (R$):`, item.price == null ? "" : String(item.price));
  if (price === null) return;
  const value = parseNumber(price);
  if (value != null && value < 0) return toast("Preço inválido");
  try {
    if (type === "item") await api.updateItem(id, { price: value });
    else await api.updateChoppPrice(id, value);
    await reload();
    state.view = "precos";
    render();
    toast("Preço atualizado");
  } catch (e) { toast(e.status === 403 ? "Sem permissão" : "Erro ao salvar preço"); }
}

async function openUsers() {
  state.modal = { users: true, list: [] };
  render();
  try { state.modal.list = await api.listUsers(); render(); } catch {}
}

function handleAction(e) {
  const action = e.currentTarget.dataset.action;
  if (action === "new-item") { state.modal = { item: null }; render(); }
  if (action === "close-modal") { state.modal = null; render(); }
  if (action === "close-count" && confirm("Fixar a contagem atual como base para medir consumo?")) closeCount();
  if (action === "backup") exportJson();
  if (action === "csv") exportCsv();
  if (action === "xlsx") api.downloadXlsx().catch((err) => toast(err.status === 403 ? "Sem permissão" : "Erro ao exportar"));
  if (action === "import") document.querySelector("#import-file").click();
  if (action === "users") openUsers();
  if (action === "reset-inventory") resetInventory();
  if (action === "logout") api.logout().then(() => { state.user = null; renderLogin(); });
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
