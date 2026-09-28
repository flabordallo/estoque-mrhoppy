// Cardápio vendável do PDV (Fase 1). Fonte única do cadastro.
// Preços exatamente como informados. Opções de drink apontam para o item de estoque
// que baixam (o vínculo é tentado por nome no seed; o que não casar vira relatório).

// Chopp: dois tamanhos (300 / 400 ml).
const chopps = [
  { name: "Pilsen", sizes: [["300 ml", 11], ["400 ml", 13]] },
  { name: "Weiss", sizes: [["300 ml", 14], ["400 ml", 17]] },
  { name: "Red Ale", sizes: [["300 ml", 15], ["400 ml", 19]] },
  { name: "Chope Vinho", sizes: [["300 ml", 13], ["400 ml", 16]] },
  { name: "APA", sizes: [["300 ml", 15], ["400 ml", 19]] },
  { name: "Lager", sizes: [["300 ml", 14], ["400 ml", 17]] },
  { name: "Sour", sizes: [["300 ml", 15], ["400 ml", 18]] },
  { name: "Sem glúten", sizes: [["300 ml", 14], ["400 ml", 17]] },
  { name: "Schornstein IPA", sizes: [["300 ml", 16], ["400 ml", 20]] },
  { name: "Session IPA", sizes: [["300 ml", 17], ["400 ml", 22]] },
  { name: "Juicy IPA", sizes: [["300 ml", 17], ["400 ml", 22]] },
  { name: "American Paladina", sizes: [["300 ml", 17], ["400 ml", 22]] },
  { name: "Double IPA", sizes: [["300 ml", 17], ["400 ml", 22]] },
  { name: "Stout", sizes: [["300 ml", 18], ["400 ml", 22]] },
];

const lanches = [
  { name: "Smash", price: 22 },
  { name: "Smash Duplo", price: 31 },
  { name: "Classic Salad", price: 27 },
  { name: "Hoppy Melt", price: 29 },
  { name: "Barbie Kill", price: 27 },
  { name: "Blue Moon", price: 29 },
  { name: "Bacon Paradise", price: 27 },
  { name: "Chicken Hoppy", price: 29 },
  { name: "Hype Rib Barbecue", price: 37 },
  { name: "OKLA", price: 29 },
  { name: "Catupa", price: 33 },
  { name: "Onion Burguer", price: 34 },
  { name: "Pepperoni", price: 30 },
  { name: "Super Nova", price: 37 },
  { name: "Hoppy Fish", price: 35 },
];

const porcoes = [
  { name: "French Fries", price: 14 },
  { name: "Rústic Fries", price: 17 },
  { name: "Gorgo Fries", price: 24 },
  { name: "Barbecue Crispy", price: 22 },
  { name: "Crazy Fries", price: 23 },
  { name: "Macaxeira Meetball", price: 30 },
  { name: "Crispy Cheese", price: 30 },
  { name: "Onion Rings", price: 25 },
  { name: "Mini Churros", price: 24 },
  { name: "Dadinho Tapioca", price: 22 },
  { name: "Peixe e Batata", price: 25 },
  { name: "Porção Só Frango", price: 25 },
  { name: "Porção Só Peixe", price: 27 },
];

// Drinks: preço fixo; opções não mudam o preço, só o ingrediente que baixa.
// Rótulos escolhidos para casar por nome com o estoque quando possível.
const drinks = [
  { name: "Cuba", price: 20, groups: [
    { name: "Base", options: ["Rum", "Vodka Bacco"] },
    { name: "Refri", options: ["Coca lata 350ml", "Coca zero 350ml"] },
  ] },
  { name: "Caipirinha Lemon", price: 23, groups: [{ name: "Base", options: ["Cachaça", "Vodka Bacco"] }] },
  { name: "Caipirinha Red", price: 25, groups: [{ name: "Base", options: ["Cachaça", "Vodka Bacco"] }] },
  { name: "Mojito", price: 23, groups: [{ name: "Base", options: ["Experience", "Normal"] }] },
  { name: "Gin Tônica", price: 22, groups: [] },
  { name: "Gin Califa", price: 22, groups: [] },
  { name: "Gin Purple Rain", price: 27, groups: [] },
  { name: "Hoppy Gin", price: 29, groups: [] },
  { name: "Vodka Red Bull", price: 29, groups: [
    { name: "Red Bull", options: ["Red Bull Normal", "Red Bull Zero", "Red Bull Tropical", "Red Bull Melancia"] },
  ] },
  { name: "Jack Red Bull", price: 40, groups: [
    { name: "Jack", options: ["Jack Normal", "Jack Fire", "Jack Honey", "Jack Apple"] },
    { name: "Red Bull", options: ["Red Bull Normal", "Red Bull Zero", "Red Bull Tropical", "Red Bull Melancia"] },
  ] },
  { name: "Maracujack", price: 35, groups: [] },
  { name: "Jack n Coke", price: 35, groups: [] },
  { name: "Honey Lemonade", price: 35, groups: [] },
  { name: "Apple Tônica", price: 35, groups: [] },
  { name: "Melancita", price: 36, groups: [] },
  { name: "Tropical Gin", price: 36, groups: [] },
  { name: "Soda Italiana", price: 15, groups: [] },
  { name: "Punk Hoppy", price: 16, groups: [] },
];

// Adicionais de lanche (valem para qualquer lanche).
// Refri / água / suco / energéticos — preços informados para o PDV.
const refri = [
  { name: "Água sem gás", price: 7, stock: "Água sem gás" },
  { name: "Água com gás", price: 7, stock: "Água com gás" },
  { name: "Coca", price: 8, stock: "Coca lata 350ml" },
  { name: "Coca Zero", price: 8, stock: "Coca zero 350ml" },
  { name: "Guaraná", price: 8, stock: "Guaraná" },
  { name: "Fanta Uva", price: 8, stock: "Fanta uva" },
  { name: "Fanta Laranja", price: 8, stock: "Fanta Laranja" },
  { name: "Citrus", price: 8, stock: "Schweppes citrus" },
  { name: "Sprite", price: 8, stock: "Sprite" },
  { name: "Água Tônica", price: 8, stock: "Água tônica" },
  { name: "Água Tônica Zero", price: 8, stock: "Água tônica zero" },
  { name: "Red Bull Normal", price: 19, stock: "Red Bull Normal" },
  { name: "Red Bull Zero", price: 19, stock: "Red Bull Zero" },
  { name: "Red Bull Tropical", price: 19, stock: "Red Bull Tropical" },
  { name: "Red Bull Melancia", price: 19, stock: "Red Bull Melancia" },
  { name: "Suco Del Valle Maracujá", price: 9, stock: "Suco maracujá lata" },
  { name: "Suco Del Valle Uva", price: 9, stock: "Suco uva lata" },
  { name: "Suco Del Valle Pêssego", price: 9, stock: "Suco pêssego lata" },
];

// Doses únicas. Jack Daniels possui quatro variantes pelo mesmo preço.
const doses = [
  { name: "Cachaça", price: 8, stock: "Velho Barreiro" },
  { name: "Vodka", price: 15, stock: "Vodka Bacco" },
  { name: "Rum", price: 15, stock: "Rum" },
  { name: "Jack Daniels Normal", price: 27, stock: "Jack Normal" },
  { name: "Jack Daniels Fire", price: 27, stock: "Jack Fire" },
  { name: "Jack Daniels Honey", price: 27, stock: "Jack Honey" },
  { name: "Jack Daniels Apple", price: 27, stock: "Jack Apple" },
  { name: "Campari", price: 15, stock: "Campari" },
  { name: "Gin", price: 20, stock: "Gin Hambre" },
  { name: "Jägermeister", price: 25, stock: "Jägermeister" },
  { name: "Licor 43", price: 24, stock: "Licor 43" },
  { name: "Tequila", price: 25, stock: "Tequila" },
];

const addons = [
  { name: "Bacon", price: 3 },
  { name: "Salada completa", price: 3 },
  { name: "Queijo", price: 3 },
  { name: "Duplo", price: 13 },
];

// Botões da home ainda sem lista (criamos vazios agora).
const emptyCategories = [
  { key: "refri", label: "Refri / Água / Suco" },
  { key: "dose", label: "Doses" },
];

module.exports = { chopps, lanches, porcoes, drinks, refri, doses, addons, emptyCategories };
