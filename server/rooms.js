// Inside a colonist's home: the furniture they've bought, where it stands or hangs, each room's floor and walls, and
// the photos in their frames (see shared/furniture.js for the house plans and the rules).
// The home's inside belongs to the colonist, not the building: it moves with them when they move house (anything that
// doesn't fit the new place is packed into their storage). Other players can walk through it but not change anything,
// and can report a photo; the developer can take a reported photo down from the Reports tab.
//
// Photos: the phone shrinks a picture to a small JPEG before sending it; the server checks it really is one, keeps it
// in Cloudflare R2 when that's set up (or in the database otherwise), and serves it from /api/room/photos/<id>.
import crypto from 'node:crypto';
import { HttpError } from './world.js';
import { pool } from './db.js';
import * as F from '../shared/furniture.js';
import * as store from './storage.js';
import { BUILDING_TYPES } from '../shared/catalog.js';
import { treasuryAdd } from './races.js';
import { track } from './stats.js';

const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const int = v => (v === '' || v == null ? NaN : Number(v));
const photoKey = id => `photos/${id}.jpg`;
const PHOTO_ID = /^[A-Za-z0-9_-]{6,24}$/;

// A real JPEG of a sensible size? (It starts and ends with the JPEG markers, and its frame header gives its size.)
export function jpegSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 600 || buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) return null;
  if (!buf.subarray(-32).includes(Buffer.from([0xFF, 0xD9]))) return null;
  for (let i = 2; i < buf.length - 9;) { if (buf[i] !== 0xFF) { i++; continue; } const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if ((m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7) || (m >= 0xC9 && m <= 0xCB) || (m >= 0xCD && m <= 0xCF)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; } i += 2 + len; }
  return null;
}

export class Rooms {
  constructor(world) { this.world = world; }
  async homeOf(q, c) {
    if (!c.home_id) return null;
    const b = (await q('select id, type, name, x, y, w, d from buildings where id = $1', [c.home_id])).rows[0]; if (!b) return null;
    const size = F.roomSize(b.type); return size ? { id: b.id, type: b.type, name: b.name || BUILDING_TYPES[b.type]?.name || 'Home', size, x: b.x, y: b.y, w: b.w, d: b.d } : null;
  }
  // where each photo in the house can be fetched: straight from R2 when it's there (u), or through this server (s)
  async photoUrls(room) {
    const ids = [...F.photosIn(room)]; if (!ids.length) return {};
    const rows = (await pool.query('select id, r2key from room_photos where id = any($1)', [ids])).rows, out = {};
    for (const r of rows) out[r.id] = { s: `/api/room/photos/${r.id}`, ...(r.r2key && store.r2On() ? { u: store.publicUrl(r.r2key) } : {}) };
    return out;
  }
  async out(c, home, room, mine) {
    return { mine, owner: c.handle, home: { id: home.id, name: home.name, type: home.type, x: home.x, y: home.y, w: home.w, d: home.d }, size: home.size, room, photos: await this.photoUrls(room), coins: mine ? Math.round(Number(c.coins_base)) : undefined };
  }
  // what you see when you go in: your own home, or someone else's (look only)
  async view(meId, handle) {
    const pq = (a, v) => pool.query(a, v);
    const c = handle ? (await pq('select id, handle, home_id, room, coins_base from citizens where lower(handle) = lower($1)', [String(handle)])).rows[0] : (await pq('select id, handle, home_id, room, coins_base from citizens where id = $1', [meId])).rows[0];
    if (!c) throw new HttpError(404, 'No colonist with that name.');
    const home = await this.homeOf(pq, c); if (!home) throw new HttpError(404, c.id === meId ? 'You don’t have a home yet. Rent one first, then you can furnish it.' : `@${c.handle} doesn’t have a home right now.`);
    return this.out(c, home, F.fitRoom(c.room, home.size).room, c.id === meId);
  }
  // Every change: lock the colonist, fit their home to the house they live in, apply fn, save. fn returns { spend, refund, gone }.
  async edit(id, fn) {
    let gone = [];
    const res = await this.world.personal(async ch => {
      const q = (a, v) => ch.q(a, v), c = (await q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such colonist.');
      const home = await this.homeOf(q, c); if (!home) throw new HttpError(409, 'You don’t have a home yet. Rent one first, then you can furnish it.');
      const { room } = F.fitRoom(c.room, home.size), r = await fn(room, home, c, q) || {};
      if (r.spend || r.refund) { ch.coins(c);
        if (r.spend) { if (Number(c.coins_base) < r.spend) throw new HttpError(400, `That costs ${fmt(r.spend)} coins. You have ${fmt(c.coins_base)} on you${Number(c.bank) ? ' (withdraw some at a Bank first)' : ''}.`);
          c.coins_base = Number(c.coins_base) - r.spend; treasuryAdd(ch, r.spend); track(ch, 'home:furniture', r.spend, c.id); }
        if (r.refund) { c.coins_base = Number(c.coins_base) + r.refund; track(ch, 'home:resale', r.refund, c.id); }
        ch.touch(c); await ch.saveCitizen(c); }
      if (r.gone?.length) { gone = (await q('delete from room_photos where id = any($1) and citizen_id = $2 returning r2key', [r.gone, c.id])).rows; }
      await q('update citizens set room = $2 where id = $1', [c.id, JSON.stringify(room)]);
      return { c, home, room, item: r.item };
    });
    for (const g of gone) if (g.r2key && store.r2On()) store.del(g.r2key).catch(() => {}); // the photos nobody uses any more
    return { ...(await this.out(res.c, res.home, res.room, true)), ok: true, ...(res.item ? { item: res.item } : {}) };
  }
  find(room, i) { const at = room.items.findIndex(x => x.i === i), inBox = at < 0 ? room.box.findIndex(x => x.i === i) : -1;
    if (at < 0 && inBox < 0) throw new HttpError(404, 'That piece isn’t in your home any more.'); return { at, inBox, it: at >= 0 ? room.items[at] : room.box[inBox] }; }
  buy(id, b) {
    return this.edit(id, (room, home) => {
      const k = String(b.k || ''), f = F.FURNITURE[k]; if (!f) throw new HttpError(400, 'There’s no such piece.');
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
      const i = String(b.i || ''), { at, inBox, it } = this.find(room, i);
      const x = int(b.x), y = int(b.y), r = int(b.r ?? it.r ?? 0);
      if (inBox >= 0 && room.items.length >= F.MAX_ITEMS) throw new HttpError(409, `Your home holds up to ${F.MAX_ITEMS} pieces.`);
      const problem = F.placeProblem(room, home.size, it.k, x, y, r, i); if (problem) throw new HttpError(409, problem);
      if (at >= 0) Object.assign(it, { x, y, r }); else { room.box.splice(inBox, 1); room.items.push({ i, k: it.k, x, y, r, c: it.c, ...(it.ph ? { ph: it.ph } : {}) }); }
    });
  }
  store(id, b) {
    return this.edit(id, room => {
      const { at } = this.find(room, String(b.i || '')); if (at < 0) return;
      if (room.box.length >= F.MAX_STORED) throw new HttpError(409, 'Your storage is full. Sell something first.');
      const [it] = room.items.splice(at, 1); room.box.push({ i: it.i, k: it.k, c: it.c, ...(it.ph ? { ph: it.ph } : {}) });
    });
  }
  sell(id, b) {
    return this.edit(id, room => {
      const { at, inBox } = this.find(room, String(b.i || '')), [it] = at >= 0 ? room.items.splice(at, 1) : room.box.splice(inBox, 1);
      return { refund: F.resaleOf(it.k), gone: it.ph ? [it.ph] : [] };
    });
  }
  // a room's floor and walls (each room has its own)
  style(id, b) {
    return this.edit(id, (room, home) => {
      const i = int(b.room), L = F.layoutOf(home.size); if (!Number.isInteger(i) || !L.rooms[i]) throw new HttpError(400, 'Which room?');
      const now = F.styleOf(room, home.size, i), next = { ...(room.styles[i] || {}) }; let spend = 0;
      if (b.floor != null) { const f = F.FLOORS[b.floor]; if (!f) throw new HttpError(400, 'There’s no such floor.'); if (now.f !== b.floor) { next.f = b.floor; spend += f.cost; } }
      if (b.wall != null) { const w = F.WALLS[b.wall]; if (!w) throw new HttpError(400, 'There’s no such wallpaper.'); if (now.w !== b.wall) { next.w = b.wall; spend += w.cost; } }
      room.styles[i] = next; return { spend };
    });
  }
  // A new photo for a frame. The picture arrives as a small JPEG (the phone shrinks it first).
  async photo(id, i, buf) {
    const size = jpegSize(buf); if (!size) throw new HttpError(400, 'That photo couldn’t be read. Try another one.');
    if (buf.length > F.PHOTO_BYTES || size.w > 2048 || size.h > 2048 || size.w < 32 || size.h < 32) throw new HttpError(400, 'That photo is too big.');
    if (Number((await pool.query('select count(*) n from room_photos where citizen_id = $1', [id])).rows[0].n) >= F.MAX_PHOTOS) throw new HttpError(409, `You can have up to ${F.MAX_PHOTOS} photos. Take one down (sell its frame) first.`);
    const pid = crypto.randomBytes(9).toString('base64url'); let r2key = null;
    if (store.r2On()) { try { await store.put(photoKey(pid), buf, 'image/jpeg'); r2key = photoKey(pid); } catch (e) { console.error('photo to R2:', e.message); } }
    try {
      return await this.edit(id, async (room, home, c, q) => {
        const { it } = this.find(room, String(i || '')); if (!F.FURNITURE[it.k]?.photo) throw new HttpError(400, 'Only photo frames take a photo.');
        await q('insert into room_photos (id, citizen_id, r2key, data, bytes, t) values ($1, $2, $3, $4, $5, $6)', [pid, c.id, r2key, r2key ? null : buf, buf.length, Date.now()]);
        const old = it.ph; it.ph = pid; return { gone: old ? [old] : [] };
      });
    } catch (e) { if (r2key) store.del(r2key).catch(() => {}); throw e; }
  }
  // serving a photo (for the frames, and the developer's Reports tab)
  async photoFile(pid) {
    if (!PHOTO_ID.test(String(pid))) return null;
    const r = (await pool.query('select data, r2key from room_photos where id = $1', [pid])).rows[0]; if (!r) return null;
    if (r.data) return r.data;
    if (r.r2key && store.r2On()) { const res = await fetch(store.publicUrl(r.r2key), { signal: AbortSignal.timeout(10000) }).catch(() => null); if (res?.ok) return Buffer.from(await res.arrayBuffer()); }
    return null;
  }
  // The developer takes a photo down (after a report): it leaves its frame, which shows a blank picture again.
  async removePhoto(pid) {
    const p = (await pool.query('delete from room_photos where id = $1 returning citizen_id, r2key', [String(pid)])).rows[0]; if (!p) return false;
    if (p.r2key && store.r2On()) store.del(p.r2key).catch(() => {});
    await this.world.personal(async ch => { const c = (await ch.q('select id, room from citizens where id = $1 for update', [p.citizen_id])).rows[0]; if (!c?.room) return;
      const room = c.room; for (const it of [...(room.items || []), ...(room.box || [])]) if (it.ph === pid) delete it.ph; await ch.q('update citizens set room = $2 where id = $1', [c.id, JSON.stringify(room)]); });
    return true;
  }
}
