// Stores that sell to players, and what each one sells. One rule for all of them, now and for any store added later:
//
//   - A store nobody owns (the colony's own, or one up for sale) sells from the colony: everything is always in stock
//     and the money goes to the treasury.
//   - A store a player owns sells only what its owner has stocked. The owner buys stock from the colony at
//     WHOLESALE (75%) of the shop price; each sale uses up one and puts the full shop price into the store's till,
//     which the owner collects like any other till. The difference (25%) is the owner's profit.
//
// To add a new kind of store (fashion, jewellery…): add an entry here with its building type and its products (a key,
// a name and a fixed shop price for each). The server's sale for that store calls sell() in server/stores.js, and the
// rest (stock, restocking, the till, the display inside) follows.
import { PHONE_MODELS, CAR_MODELS } from './catalog.js';
import { CREATURES, petPrice } from './creatures.js';

export const WHOLESALE = 0.75;     // what an owner pays the colony for stock, as a share of the shop price
export const STOCK_MAX = 50;       // how many of one product a store can hold
export const wholesale = price => Math.ceil(price * WHOLESALE);

// building type → { name, noun, products() → [{ k, name, price, note? }] }
export const STORES = {
  phonestore: { name: 'Phone store', noun: 'phones', icon: '📱',
    products: () => Object.entries(PHONE_MODELS).filter(([, M]) => M.price).map(([k, M]) => ({ k, name: M.name, price: M.price, note: M.note, tier: M.tier, colors: M.colors })) },
  cardealer: { name: 'Car dealership', noun: 'vehicles', icon: '🚘',
    products: () => Object.entries(CAR_MODELS).map(([k, M]) => ({ k, name: M.name, price: M.price, kind: M.kind, colors: M.colors })) },
  petstore: { name: 'Pet store', noun: 'pets', icon: '🐾',
    products: () => Object.entries(CREATURES).map(([k, C]) => ({ k, name: C.name, price: petPrice(k) })) },
};
export const isStore = type => !!STORES[type];
const cache = new Map();
export function productsOf(type) { const S = STORES[type]; if (!S) return []; let l = cache.get(type); if (!l) cache.set(type, l = S.products()); return l; }
export function productOf(type, k) { return productsOf(type).find(p => p.k === k) || null; }
