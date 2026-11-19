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
import { ITEMS, SLOTS } from './avatar.js';
import { FURNITURE } from './furniture.js';

export const WHOLESALE = 0.75;     // what an owner pays the colony for stock, as a share of the shop price
export const STOCK_MAX = 50;       // how many of one product a store can hold
export const wholesale = price => Math.ceil(price * WHOLESALE);

// What can be bought where. Each product has a key (unique in its store), a name, a fixed shop price, and what it is:
//   wear  a thing to wear (slot, key): bought into your wardrobe
//   home  a piece of furniture or a home appliance (key): bought into your home's storage, to place from 🛋️ Furnish
//   phone / car / pet: as before, at their own stores
const SLOT_OF = Object.fromEntries(SLOTS.map(([k, n]) => [k, n]));
// jewellery: gold, pearls, diamonds and the like (a scarf or a tie round the neck is clothing)
export const isJewel = (slot, k) => ['wrist', 'ear', 'ring'].includes(slot) || k === 'crown' || (slot === 'neck' && !!(ITEMS.neck[k]?.[3]?.gold || ITEMS.neck[k]?.[3]?.pearl));
const wear = slots => () => { const out = []; for (const slot of slots) for (const [k, it] of Object.entries(ITEMS[slot] || {})) if (it[1] > 0) out.push({ k: 'w:' + slot + ':' + k, name: it[0], price: it[1], kind: 'wear', slot, key: k, dept: SLOT_OF[slot] || slot }); return out; };
// The furniture and appliances a home can have (the business fit-out, like counters and DJ booths, is bought in 🛋️ Furnish)
export const HOME_CATS = ['living', 'dining', 'kitchen', 'bed', 'study', 'bath', 'utility', 'ceiling', 'walls', 'windows', 'doors', 'plants', 'fun', 'luxury'];
export const ELECTRONICS = new Set(['tv', 'speakers', 'walltv', 'microwave', 'stove', 'fridge', 'dishwasher', 'washer', 'hood', 'aircon', 'radiator', 'fan', 'smokealarm', 'arcade', 'gaming', 'walloven', 'coffeebar', 'dryer', 'waterheater', 'robovac', 'thermostat', 'jukebox', 'pinball', 'pcdesk', 'mediaunit']);
const home = test => () => Object.entries(FURNITURE).filter(([k, f]) => f.cost > 0 && HOME_CATS.includes(f.cat) && test(k, f)).map(([k, f]) => ({ k: 'f:' + k, name: f.name, price: f.cost, kind: 'home', key: k, tint: !!f.tint, dept: ELECTRONICS.has(k) ? 'Electronics' : ({ living: 'Living room', dining: 'Dining', kitchen: 'Kitchen', bed: 'Bedroom', study: 'Study', bath: 'Bathroom', utility: 'Laundry and utility', ceiling: 'Lights', walls: 'Wall art', windows: 'Windows', doors: 'Doors', fun: 'Fun', plants: 'Plants', luxury: 'Luxury' })[f.cat] }));
export const isHomeGood = k => { const f = FURNITURE[k]; return !!f && f.cost > 0 && HOME_CATS.includes(f.cat); }; /* (only from a store, for a home) */
const phones = () => Object.entries(PHONE_MODELS).filter(([, M]) => M.price).map(([k, M]) => ({ k, name: M.name, price: M.price, note: M.note, tier: M.tier, colors: M.colors, kind: 'phone', dept: 'Phones' }));
// a supermarket or mall: a smaller range from several of the specialist stores (only the things up to a price)
const depts = (cap, parts) => () => parts.flatMap(([f, max]) => f().filter(P => P.price <= max * cap));

// building type → { name, noun, icon, products() → [{ k, name, price, kind, dept, … }] }
export const STORES = {
  phonestore: { name: 'Phone store', noun: 'phones', icon: '📱', products: phones },
  cardealer: { name: 'Car dealership', noun: 'vehicles', icon: '🚘',
    products: () => Object.entries(CAR_MODELS).map(([k, M]) => ({ k, name: M.name, price: M.price, kind: M.kind, colors: M.colors })) },
  petstore: { name: 'Pet store', noun: 'pets', icon: '🐾',
    products: () => Object.entries(CREATURES).map(([k, C]) => ({ k, name: C.name, price: petPrice(k), kind: 'pet' })) },
  boutique: { name: 'Fashion boutique', noun: 'pieces', icon: '👗', products: () => [...wear(['top', 'bot', 'out', 'hat', 'eye', 'bag'])(), ...wear(['neck'])().filter(P => !isJewel('neck', P.key)).map(P => ({ ...P, dept: 'Scarves and ties' }))] },
  shoeshop: { name: 'Shoe shop', noun: 'pairs of shoes', icon: '👟', products: wear(['shoe']) },
  jeweller: { name: 'Jeweller', noun: 'pieces', icon: '💎', products: () => [...wear(['wrist', 'neck', 'ear', 'ring'])().filter(P => isJewel(P.slot, P.key)), ...wear(['hat'])().filter(P => P.key === 'crown').map(P => ({ ...P, dept: 'Crowns' }))] },
  furniture: { name: 'Furniture store', noun: 'pieces', icon: '🛋️', products: home(k => !ELECTRONICS.has(k)) },
  electronics: { name: 'Electronics store', noun: 'appliances', icon: '📺', products: home(k => ELECTRONICS.has(k)) },
};
// supermarkets and malls carry several departments (a mall: dearer things too)
const SMALL = [[wear(['top', 'bot', 'hat', 'eye', 'bag']), 1500], [wear(['shoe']), 1200], [wear(['wrist', 'ear']), 2500], [home(k => ELECTRONICS.has(k)), 4500], [home(k => !ELECTRONICS.has(k)), 1500], [phones, 18000]];
const BIG = [[wear(['top', 'bot', 'out', 'hat', 'eye', 'bag']), 6000], [wear(['shoe']), 3000], [wear(['wrist', 'neck', 'ear', 'ring']), 15000], [home(k => ELECTRONICS.has(k)), 10000], [home(k => !ELECTRONICS.has(k)), 8000], [phones, 100000]];
for (const [type, name, parts, cap] of [['cornershop', 'Corner shop', SMALL, 0.5], ['supermarket', 'Supermarket', SMALL, 1], ['deptstore', 'Department store', BIG, 1], ['mall', 'Shopping mall', BIG, 1], ['megamall', 'Mega mall', BIG, 2]])
  STORES[type] = { name, noun: 'things', icon: '🛒', products: depts(cap, parts) };
export const isStore = type => !!STORES[type];
// where each kind of thing is sold (for "buy it at a …" messages)
export const WHERE = { wear: { shoe: 'a Shoe shop', wrist: 'a Jeweller', neck: 'a Jeweller', ear: 'a Jeweller', ring: 'a Jeweller', crown: 'a Jeweller' }, wearDefault: 'a Fashion boutique', electronics: 'an Electronics store', furniture: 'a Furniture store' };
export const whereToBuy = (kind, slot, key) => kind === 'home' ? (ELECTRONICS.has(key) ? WHERE.electronics : WHERE.furniture) + ' (or a Supermarket or Mall)' : (isJewel(slot, key) ? 'a Jeweller' : slot === 'shoe' ? 'a Shoe shop' : WHERE.wearDefault) + ' (or a Supermarket or Mall)';
const cache = new Map();
export function productsOf(type) { const S = STORES[type]; if (!S) return []; let l = cache.get(type); if (!l) cache.set(type, l = S.products()); return l; }
export function productOf(type, k) { return productsOf(type).find(p => p.k === k) || null; }
