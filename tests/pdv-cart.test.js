import { describe, it, expect } from "vitest";
import { addToCart, cartCount, cartTotal, itemTotal, setItemQty, sameConfiguration } from "../frontend/pdv-cart.js";

describe("carrinho do PDV", () => {
  const pilsen = { productId: 1, name: "Pilsen", category: "chopp", sizeId: 2, sizeLabel: "400 ml", unitPrice: 13, qty: 1, addons: [], groups: [], notes: "" };

  it("soma quantidade e total", () => {
    let cart = addToCart([], pilsen);
    cart = addToCart(cart, pilsen);
    expect(cartCount(cart)).toBe(2);
    expect(cartTotal(cart)).toBe(26);
  });

  it("não mistura configurações diferentes", () => {
    const withBacon = { productId: 2, name: "Smash", unitPrice: 22, qty: 1, addons: [{ id: 1, name: "Bacon", price: 3 }], groups: [], notes: "" };
    const withoutBacon = { ...withBacon, addons: [] };
    expect(sameConfiguration(withBacon, withoutBacon)).toBe(false);
    const cart = addToCart(addToCart([], withBacon), withoutBacon);
    expect(cart).toHaveLength(2);
    expect(cartTotal(cart)).toBe(47);
  });

  it("adicional altera o preço sem alterar o preço-base", () => {
    const item = { ...pilsen, productId: 2, name: "Smash", unitPrice: 22, addons: [{ id: 1, name: "Bacon", price: 3 }] };
    expect(itemTotal(item)).toBe(25);
  });

  it("quantidade zero remove a linha", () => {
    const cart = setItemQty([pilsen], 0, 0);
    expect(cart).toEqual([]);
  });
});
