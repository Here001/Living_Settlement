// Inside a colonist's home: the furniture they've bought and where it stands (see shared/furniture.js).
// The room belongs to the colonist, not the building: it's kept with them and moves when they move house (anything that
// doesn't fit the new home is packed into their storage). Other players can look in but not change anything.
import crypto from 'node:crypto';
import { HttpError } from './world.js';
import { pool } from './db.js';
import * as F from '../shared/furniture.js';
import { BUILDING_TYPES } from '../shared/catalog.js';
import { treasuryAdd } from './races.js';
import { track } from './stats.js';

const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const int = v => (v === '' || v == null ? NaN : Number(v));

export class Rooms {
  constructor(world) { this.world = world; }
  async homeOf(q, c) {
    if (!c.home_id) return null;
    const b = (await q('select id, type, name, x, y from buildings where id = $1', [c.home_id])).rows[0]; if (!b) return null;
    const size = F.roomSize(b.type); return size ? { id: b.id, type: b.type, name: b.name || BUILDING_TYPES[b.type]?.name || 'Home', size } : null;
  }
  out(c, home, room, mine) { return { mine, owner: c.handle, home: { name: home.name, type: home.type }, size: home.size, room, coins: mine ? Math.round(Number(c.coins_base)) : undefined }; }
  // what you see when you look in: your own home, or someone else's (view only)
  async view(meId, handle) {
    const pq = (a, v) => pool.query(a, v);
    const c = handle ? (await pq('select id, handle, home_id, room, coins_base from citizens where lower(handle) = lower($1)', [String(handle)])).rows[0] : (await pq('select id, handle, home_id, room, coins_base from citizens where id = $1', [meId])).rows[0];
    if (!c) throw new HttpError(404, 'No colonist with that name.');
    const home = await this.homeOf(pq, c); if (!home) throw new HttpError(404, c.id === meId ? 'You don’t have a home yet. Rent one first, then you can furnish it.' : `@${c.handle} doesn’t have a home right now.`);
    return this.out(c, home, F.fitRoom(c.room, home.size).room, c.id === meId);
  }
  // Every change: lock the colonist, fit their room to their home, apply fn, save. fn returns { msg, spend, refund }.
  async edit(id, fn) {
    return this.world.personal(async ch => {
      const q = (a, v) => ch.q(a, v), c = (await q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such colonist.');
      const home = await this.homeOf(q, c); if (!home) throw new HttpError(409, 'You don’t have a home yet. Rent one first, then you can furnish it.');
      const { room } = F.fitRoom(c.room, home.size), res = await fn(room, home, c) || {};
      if (res.spend || res.refund) { ch.coins(c);
        if (res.spend) { if (Number(c.coins_base) < res.spend) throw new HttpError(400, `That costs ${fmt(res.spend)} coins. You have ${fmt(c.coins_base)} on you${Number(c.bank) ? ' (withdraw some at a Bank first)' : ''}.`);
          c.coins_base = Number(c.coins_base) - res.spend; treasuryAdd(ch, res.spend); track(ch, 'home:furniture', res.spend, c.id); }
        if (res.refund) { c.coins_base = Number(c.coins_base) + res.refund; track(ch, 'home:resale', res.refund, c.id); }
        ch.touch(c); await ch.saveCitizen(c); }
      await q('update citizens set room = $2 where id = $1', [c.id, JSON.stringify(room)]);
      return { ...this.out(c, home, room, true), ok: true, ...(res.item ? { item: res.item } : {}) };
    });
  }
  find(room, i) { const at = room.items.findIndex(x => x.i === i), inBox = at < 0 ? room.box.findIndex(x => x.i === i) : -1;
    if (at < 0 && inBox < 0) throw new HttpError(404, 'That piece isn’t in your home any more.'); return { at, inBox }; }
  buy(id, b) {
    return this.edit(id, (room, home) => {
      const k = String(b.k || ''), f = F.FURNITURE[k]; if (!f) throw new HttpError(400, 'There’s no such piece of furniture.');
      const x = int(b.x), y = int(b.y), r = int(b.r ?? 0), c = Number.isInteger(+b.c) && +b.c >= 0 && +b.c < F.TINTS.length ? +b.c : 0;
      if (room.items.length >= F.MAX_ITEMS) throw new HttpError(409, `Your home holds up to ${F.MAX_ITEMS} pieces. Sell or store one first.`);
      const problem = F.placeProblem(room, home.size, k, x, y, r); if (problem) throw new HttpError(409, problem);
      const item = { i: crypto.randomUUID().slice(0, 8), k, x, y, r, c: f.tint ? c : 0 }; room.items.push(item);
      return { spend: f.cost, item };
    });
  }
  // move (or turn) a piece, or set one out from storage
  place(id, b) {
    return this.edit(id, (room, home) => {
      const i = String(b.i || ''), { at, inBox } = this.find(room, i), it = at >= 0 ? room.items[at] : room.box[inBox];
      const x = int(b.x), y = int(b.y), r = int(b.r ?? it.r ?? 0);
      if (inBox >= 0 && room.items.length >= F.MAX_ITEMS) throw new HttpError(409, `Your home holds up to ${F.MAX_ITEMS} pieces.`);
      const problem = F.placeProblem(room, home.size, it.k, x, y, r, i); if (problem) throw new HttpError(409, problem);
      if (at >= 0) Object.assign(it, { x, y, r }); else { room.box.splice(inBox, 1); room.items.push({ i, k: it.k, x, y, r, c: it.c }); }
    });
  }
  store(id, b) {
    return this.edit(id, room => {
      const { at } = this.find(room, String(b.i || '')); if (at < 0) return;
      if (room.box.length >= F.MAX_STORED) throw new HttpError(409, 'Your storage is full. Sell something first.');
      const [it] = room.items.splice(at, 1); room.box.push({ i: it.i, k: it.k, c: it.c });
    });
  }
  sell(id, b) {
    return this.edit(id, room => {
      const { at, inBox } = this.find(room, String(b.i || '')), [it] = at >= 0 ? room.items.splice(at, 1) : room.box.splice(inBox, 1);
      return { refund: F.resaleOf(it.k) };
    });
  }
  style(id, b) {
    return this.edit(id, room => {
      let spend = 0;
      if (b.floor != null) { const f = F.FLOORS[b.floor]; if (!f) throw new HttpError(400, 'There’s no such floor.'); if (room.floor !== b.floor) { room.floor = b.floor; spend += f.cost; } }
      if (b.wall != null) { const w = F.WALLS[b.wall]; if (!w) throw new HttpError(400, 'There’s no such wallpaper.'); if (room.wall !== b.wall) { room.wall = b.wall; spend += w.cost; } }
      return { spend };
    });
  }
}
