// Store stock (the rule is in shared/stores.js): a store a player owns sells only what its owner has bought in from the
// colony; a store nobody owns sells from the colony, as it always has.
import { pool } from './db.js';
import { HttpError } from './world.js';
import { STORES, STOCK_MAX, productOf, productsOf, wholesale } from '../shared/stores.js';
import crypto from 'node:crypto';
import { wardKey } from '../shared/avatar.js';
import { FURNITURE, TINTS, MAX_STORED, storageCap } from '../shared/furniture.js';
import { treasuryAdd } from './races.js';
import { track } from './stats.js';

const fmt = n => Math.round(n).toLocaleString('en-US');

// What a store has: who owns it, and (owned) how many of each product
export async function stockOf(buildingId) {
  const b = (await pool.query('select id, type, owner_id, owner_handle from buildings where id = $1 and done and not ruin', [String(buildingId || '')])).rows[0];
  if (!b || !STORES[b.type]) throw new HttpError(404, 'That isn’t an open store.');
  if (!b.owner_id) return { id: b.id, type: b.type, owned: false, owner: null, stock: null };
  const rows = (await pool.query('select item, qty from store_stock where building_id = $1', [b.id])).rows, stock = {};
  for (const r of rows) if (r.qty > 0) stock[r.item] = r.qty;
  return { id: b.id, type: b.type, owned: true, owner: b.owner_handle, stock };
}

// Inside a sale (ch: the sale's transaction; the store's row is locked). Returns how the money goes:
//   { owned: false }               the colony sells: the buyer's money goes to the treasury, as before
//   { owned: true, till: price }   one item came off the shelf; the full shop price goes into the store's till
export async function sell(ch, store, item, price) {
  if (!store.owner_id) return { owned: false };
  const r = (await ch.q('update store_stock set qty = qty - 1 where building_id = $1 and item = $2 and qty > 0 returning qty', [store.id, item])).rows[0];
  if (!r) throw new HttpError(409, `Sold out here: @${store.owner_handle} hasn’t got any in stock. Try another ${STORES[store.type].name.toLowerCase()}, or one the colony runs.`);
  await ch.q('update buildings set till = till + $2 where id = $1', [store.id, price]);
  return { owned: true, till: price, left: r.qty };
}

// The owner buys stock from the colony at wholesale
export async function restock(world, playerId, { buildingId, item, qty }) {
  const n = Math.floor(Number(qty)); if (!(n >= 1 && n <= STOCK_MAX)) throw new HttpError(400, `Buy between 1 and ${STOCK_MAX}.`);
  return world.change(async ch => {
    const b = (await ch.q('select id, type, owner_id from buildings where id = $1 and done and not ruin for update', [String(buildingId || '')])).rows[0];
    if (!b || !STORES[b.type]) throw new HttpError(404, 'That isn’t an open store.');
    if (b.owner_id !== playerId) throw new HttpError(403, 'Only the store’s owner can buy in stock.');
    const P = productOf(b.type, String(item || '')); if (!P) throw new HttpError(400, 'This store doesn’t sell that.');
    const have = (await ch.q('select qty from store_stock where building_id = $1 and item = $2 for update', [b.id, P.k])).rows[0]?.qty || 0;
    if (have + n > STOCK_MAX) throw new HttpError(400, `A store holds up to ${STOCK_MAX} of each. You have ${have}.`);
    const unit = wholesale(P.price), cost = unit * n;
    const c = (await ch.q('select * from citizens where id = $1 for update', [playerId])).rows[0]; if (!c) throw new HttpError(404, 'Who are you?');
    ch.coins(c); if (c.coins_base < cost) throw new HttpError(400, `${n} × ${P.name} costs ${fmt(cost)} coins from the colony (${fmt(unit)} each, 25% off the shop price). You have ${fmt(c.coins_base)} on you.`);
    c.coins_base -= cost; treasuryAdd(ch, cost); track(ch, 'store:stock', cost, c.id); ch.touch(c); await ch.saveCitizen(c);
    const q = (await ch.q('insert into store_stock (building_id, item, qty) values ($1, $2, $3) on conflict (building_id, item) do update set qty = store_stock.qty + $3 returning qty', [b.id, P.k, n])).rows[0].qty;
    return { ok: true, item: P.k, qty: q, paid: cost, unit, coins: c.coins_base };
  });
}

// Buying a thing to wear (into your wardrobe) or for your home (into its storage, to place from 🛋️ Furnish)
export async function buyGoods(world, playerId, { buildingId, item, c: tint }) {
  return world.change(async ch => {
    const b = (await ch.q('select id, type, owner_id, owner_handle from buildings where id = $1 and done and not ruin for update', [String(buildingId || '')])).rows[0];
    if (!b || !STORES[b.type]) throw new HttpError(404, 'That isn’t an open store.');
    const P = productOf(b.type, String(item || '')); if (!P || !(P.kind === 'wear' || P.kind === 'home')) throw new HttpError(400, 'This store doesn’t sell that.');
    const c = (await ch.q('select * from citizens where id = $1 for update', [playerId])).rows[0]; if (!c) throw new HttpError(404, 'Who are you?');
    const ward = [...(c.wardrobe || [])]; let room = null, stored = null;
    if (P.kind === 'wear') { if (ward.includes(wardKey(P.slot, P.key))) throw new HttpError(409, `You already have the ${P.name.toLowerCase()}: wear it from your character (✏️ on your card).`); }
    else { if (!c.home_id) throw new HttpError(409, 'You need a home first: furniture goes into your home’s storage.');
      room = c.room && typeof c.room === 'object' ? { ...c.room } : { items: [], box: [] }; room.items = room.items || []; room.box = [...(room.box || [])];
      if (room.box.length >= storageCap(c.storage_extra)) throw new HttpError(409, 'Your storage is full. Place or sell something from 🛋️ Furnish, or buy more storage space.'); }
    ch.coins(c); if (Number(c.coins_base) < P.price) throw new HttpError(400, `The ${P.name} costs ${fmt(P.price)} coins. You have ${fmt(c.coins_base)} on you${Number(c.bank) ? ' (withdraw some at a Bank first)' : ''}.`);
    const sold = await sell(ch, b, P.k, P.price);
    c.coins_base = Number(c.coins_base) - P.price; if (!sold.owned) treasuryAdd(ch, P.price); track(ch, P.kind === 'wear' ? 'look:wardrobe' : 'home:furniture', P.price, c.id);
    if (P.kind === 'wear') { ward.push(wardKey(P.slot, P.key)); await ch.q('update citizens set wardrobe = $2 where id = $1', [c.id, ward]); }
    else { const f = FURNITURE[P.key], col = f.tint && Number.isInteger(+tint) && +tint >= 0 && +tint < TINTS.length ? +tint : 0; stored = { i: crypto.randomUUID().slice(0, 8), k: P.key, c: col }; room.box.push(stored); await ch.q('update citizens set room = $2 where id = $1', [c.id, JSON.stringify(room)]); }
    ch.touch(c); await ch.saveCitizen(c);
    return { ok: true, item: P.k, kind: P.kind, name: P.name, paid: P.price, coins: Math.round(Number(c.coins_base)), wardrobe: P.kind === 'wear' ? ward : undefined, stored, store: sold.owned ? { left: sold.left } : null };
  });
}

// Checkout: everything in your cart at this store, paid for at once. All of it or none of it: the total is checked
// against the coins on you, every piece against the stock (and your wardrobe and storage) before anything is sold.
export async function checkoutGoods(world, playerId, { buildingId, items }) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Your cart is empty.'); if (items.length > 30) throw new HttpError(400, 'Thirty things at a time, at most.');
  return world.change(async ch => {
    const b = (await ch.q('select id, type, owner_id, owner_handle from buildings where id = $1 and done and not ruin for update', [String(buildingId || '')])).rows[0];
    if (!b || !STORES[b.type]) throw new HttpError(404, 'That isn’t an open store.');
    const c = (await ch.q('select * from citizens where id = $1 for update', [playerId])).rows[0]; if (!c) throw new HttpError(404, 'Who are you?');
    const ward = [...(c.wardrobe || [])], lines = [];
    for (const it of items) { const P = productOf(b.type, String((it && it.item) || '')); if (!P || !(P.kind === 'wear' || P.kind === 'home')) throw new HttpError(400, 'This store doesn’t sell something in your cart.'); lines.push({ P, tint: it.c }); }
    const wears = lines.filter(l => l.P.kind === 'wear').map(l => wardKey(l.P.slot, l.P.key)), homes = lines.filter(l => l.P.kind === 'home');
    for (const w of wears) if (ward.includes(w)) throw new HttpError(409, 'Something in your cart is already in your wardrobe. Take it out of the cart.');
    if (new Set(wears).size !== wears.length) throw new HttpError(409, 'The same piece is in your cart twice.');
    let room = null; if (homes.length) { if (!c.home_id) throw new HttpError(409, 'You need a home first: furniture goes into your home’s storage.');
      room = c.room && typeof c.room === 'object' ? { ...c.room } : { items: [], box: [] }; room.items = room.items || []; room.box = [...(room.box || [])];
      if (room.box.length + homes.length > storageCap(c.storage_extra)) throw new HttpError(409, `Your storage has room for ${Math.max(0, storageCap(c.storage_extra) - room.box.length)} more. Place some things from 🛋️ Furnish, or buy more storage space.`); }
    const total = lines.reduce((a, l) => a + l.P.price, 0); ch.coins(c);
    if (Number(c.coins_base) < total) throw new HttpError(400, `Your cart comes to ${fmt(total)} coins. You have ${fmt(c.coins_base)} on you${Number(c.bank) ? ' (withdraw some at a Bank first)' : ''}.`);
    let owned = false; for (const l of lines) { const sold = await sell(ch, b, l.P.k, l.P.price); owned = owned || sold.owned; if (!sold.owned) treasuryAdd(ch, l.P.price); track(ch, l.P.kind === 'wear' ? 'look:wardrobe' : 'home:furniture', l.P.price, c.id);
      if (l.P.kind === 'wear') ward.push(wardKey(l.P.slot, l.P.key)); else { const f = FURNITURE[l.P.key], col = f.tint && Number.isInteger(+l.tint) && +l.tint >= 0 && +l.tint < TINTS.length ? +l.tint : 0; room.box.push({ i: crypto.randomUUID().slice(0, 8), k: l.P.key, c: col }); } }
    c.coins_base = Number(c.coins_base) - total; if (wears.length) await ch.q('update citizens set wardrobe = $2 where id = $1', [c.id, ward]); if (room) await ch.q('update citizens set room = $2 where id = $1', [c.id, JSON.stringify(room)]);
    ch.touch(c); await ch.saveCitizen(c);
    return { ok: true, paid: total, count: lines.length, wear: wears.length, home: homes.length, coins: Math.round(Number(c.coins_base)), wardrobe: wears.length ? ward : undefined };
  });
}

// A store goes back to the colony (sold to it, or knocked down): the colony takes its unsold stock back at what the owner
// paid for it, and the money goes to them. (Sold to another player, the stock goes with the store.)
export async function returnStock(ch, b, ownerId) {
  const rows = (await ch.q('delete from store_stock where building_id = $1 returning item, qty', [b.id])).rows; if (!ownerId || !STORES[b.type]) return 0;
  let back = 0; for (const r of rows) { const P = productOf(b.type, r.item); if (P && r.qty > 0) back += wholesale(P.price) * r.qty; } if (!back) return 0;
  const c = (await ch.q('select * from citizens where id = $1 for update', [ownerId])).rows[0]; if (!c) return 0;
  ch.coins(c); c.coins_base += back; treasuryAdd(ch, -back); track(ch, 'store:return', back, c.id); ch.touch(c); await ch.saveCitizen(c); return back; }

export { productsOf };
