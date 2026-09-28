// Regras puras do carrinho do PDV — Fase 2.
export function itemTotal(item) {
  const base = Number(item.unitPrice) || 0;
  const addons = (item.addons || []).reduce((sum, a) => sum + (Number(a.price) || 0), 0);
  return (base + addons) * Math.max(1, Number(item.qty) || 1);
}

export function cartTotal(cart) {
  return (cart || []).reduce((sum, item) => sum + itemTotal(item), 0);
}

export function cartCount(cart) {
  return (cart || []).reduce((sum, item) => sum + Math.max(0, Number(item.qty) || 0), 0);
}

export function sameConfiguration(a, b) {
  if (a.productId !== b.productId || a.sizeId !== b.sizeId || a.notes !== b.notes) return false;
  const addonsA = (a.addons || []).map((x) => x.id).sort((x, y) => x - y);
  const addonsB = (b.addons || []).map((x) => x.id).sort((x, y) => x - y);
  if (addonsA.join(",") !== addonsB.join(",")) return false;
  const groupsA = (a.groups || []).map((x) => `${x.groupId}:${x.optionId}`).sort();
  const groupsB = (b.groups || []).map((x) => `${x.groupId}:${x.optionId}`).sort();
  return groupsA.join("|") === groupsB.join("|");
}

export function addToCart(cart, item) {
  const next = (cart || []).map((x) => ({ ...x }));
  const existing = next.find((x) => sameConfiguration(x, item));
  if (existing) existing.qty = Math.max(1, Number(existing.qty) || 1) + Math.max(1, Number(item.qty) || 1);
  else next.push({ ...item, qty: Math.max(1, Number(item.qty) || 1) });
  return next;
}

export function setItemQty(cart, index, qty) {
  const next = (cart || []).map((x) => ({ ...x }));
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  if (!next[index]) return next;
  if (n === 0) next.splice(index, 1);
  else next[index].qty = n;
  return next;
}
