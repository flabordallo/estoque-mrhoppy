// Cliente da API + estado de conexão + fila offline.
// A UI nunca fala com o banco direto: tudo passa por aqui.
const QUEUE_KEY = "estoqueBar.queue.v1";
let statusListeners = [];
let current = "SALVO";

function setStatus(s) {
  current = s;
  statusListeners.forEach((fn) => fn(s));
}
export function onStatus(fn) { statusListeners.push(fn); fn(current); }
export function getStatus() { return current; }

function loadQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; } }
function saveQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401) {
    const err = new Error("unauthorized"); err.status = 401; throw err;
  }
  if (!res.ok) {
    let msg = "erro"; try { msg = (await res.json()).error || msg; } catch {}
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return res;
}

// GETs (leitura direta, sem fila)
export const api = {
  async login(username, password) {
    const res = await request("POST", "/login", { username, password });
    return (await res.json()).user;
  },
  async logout() { try { await request("POST", "/logout"); } catch {} },
  async me() { try { return (await request("GET", "/me").then((r) => r.json())).user; } catch { return null; } },
  async getState() { return request("GET", "/state").then((r) => r.json()); },
  async getPdvCatalog() { return request("GET", "/pdv/catalog").then((r) => r.json()); },
  async createPdvSale(data) { return request("POST", "/pdv/sales", data).then((r) => r.json()); },
  async pdvSalesSummary() { return request("GET", "/pdv/sales/summary").then((r) => r.json()); },
  async pdvSaleDetail(id) { return request("GET", `/pdv/sales/${id}`).then((r) => r.json()); },
  async previewPurchase(text) { return request("POST", "/purchases/preview", { text }).then((r) => r.json()); },
  async confirmPurchase(lines, entryDate, sourceText) { return request("POST", "/purchases/confirm", { lines, entryDate, sourceText }).then((r) => r.json()); },
  async consumption() { return request("GET", "/reports/consumption").then((r) => r.json()); },
  async recentPurchases() { return request("GET", "/purchases/recent").then((r) => r.json()); },
  async listSubstitutions() { return request("GET", "/purchases/substitutions").then((r) => r.json()); },
  async addSubstitution(fromText, inventoryItemId) { return request("POST", "/purchases/substitutions", { fromText, inventoryItemId }).then((r) => r.json()); },
  async removeSubstitution(id) { return request("DELETE", `/purchases/substitutions/${id}`).then((r) => r.json()); },
  async dashboard() { return request("GET", "/reports/dashboard").then((r) => r.json()); },
  async listUsers() { return request("GET", "/users").then((r) => r.json()); },
  async createUser(data) { return request("POST", "/users", data).then((r) => r.json()); },
  async backup() { return request("GET", "/backup").then((r) => r.json()); },
  async restore(dump) { return request("POST", "/restore", dump).then((r) => r.json()); },
  async resetInventory() { return request("POST", "/reset", {}).then((r) => r.json()); },

  // baixa o XLSX
  async downloadXlsx() {
    const res = await request("GET", "/export/xlsx");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "estoque-bar.xlsx"; a.click();
    URL.revokeObjectURL(url);
  },

  // ---- Aba do Dono (ADMIN) ----
  async ownerSummary() { return request("GET", "/owner/summary").then((r) => r.json()); },
  async ownerSalesReport(date) { return request("GET", `/owner/sales-report${date ? `?date=${encodeURIComponent(date)}` : ""}`).then((r) => r.json()); },
  async ownerPurchaseOrder() { return request("GET", "/owner/purchase-order").then((r) => r.json()); },
  async downloadOwnerXlsx(period = "dia") {
    const res = await request("GET", `/owner/xlsx?period=${encodeURIComponent(period)}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "relatorio-dono.xlsx"; a.click();
    URL.revokeObjectURL(url);
  },
  async downloadOrderTxt() {
    const res = await request("GET", "/owner/order-txt");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "pedido-compra.txt"; a.click();
    URL.revokeObjectURL(url);
  },

  // Mutações passam pela fila (resistem a offline).
  enqueue(op) {
    const q = loadQueue(); q.push(op); saveQueue(q);
    flush();
  },
  setCount(itemId, quantity) { this.enqueue({ method: "POST", path: "/count", body: { itemId, quantity } }); },
  async close() { return request("POST", "/close", {}).then((r) => r.json()); },
  choppTap(productId, position, level) { this.enqueue({ method: "POST", path: "/chopp/tap", body: { productId, position, level } }); },
  choppReserve(productId, barrels) { this.enqueue({ method: "POST", path: "/chopp/reserve", body: { productId, barrels } }); },

  // Ações de catálogo exigem confirmação do servidor (retornam promise).
  createItem(data) { return request("POST", "/items", data).then((r) => r.json()); },
  updateItem(id, data) { return request("PUT", `/items/${id}`, data).then((r) => r.json()); },
  updateChoppPrice(id, price) { return request("PUT", `/chopp/${id}/price`, { price }).then((r) => r.json()); },
  deleteItem(id) { return request("DELETE", `/items/${id}`).then((r) => r.json()); },
};

let flushing = false;
export async function flush() {
  if (flushing) return;
  const q = loadQueue();
  if (!q.length) { setStatus("SALVO"); return; }
  if (!navigator.onLine) { setStatus("OFFLINE"); return; }
  flushing = true;
  setStatus("SALVANDO");
  try {
    while (q.length) {
      const op = q[0];
      await request(op.method, op.path, op.body);
      q.shift(); saveQueue(q);
    }
    setStatus("SALVO");
  } catch (e) {
    if (e.status === 401) { setStatus("ERRO"); window.dispatchEvent(new Event("needs-login")); }
    else setStatus(navigator.onLine ? "ERRO" : "OFFLINE");
  } finally {
    flushing = false;
  }
}

export function pendingCount() { return loadQueue().length; }
export function clearOfflineQueue() { saveQueue([]); }

window.addEventListener("online", flush);
window.addEventListener("offline", () => setStatus("OFFLINE"));
