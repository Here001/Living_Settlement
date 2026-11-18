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
  constructor(world) { this.world = world; this.here = new Map(); }
  // ---- who's looking around a place right now (players whose screen shows it), for the "here now" count ----
  // Each open view says it's still there every 25 seconds; anyone not heard from for 70 seconds has left.
  // how many people are in a place right now (seen in the last 70 s), not counting `who` (by id, as 'p:<id>')
  inside(place, meId) { const m = this.here.get(place); if (!m) return 0; const now = Date.now(), me = meId ? 'p:' + meId : null; let n = 0; for (const [w, e] of m) if (w !== me && now - e.at < 70000) n++; return n; }
  seen(place, who, name) {
    const now = Date.now(); place = String(place || '').slice(0, 80); if (!/^(b|h):[A-Za-z0-9_.-]+$/.test(place)) throw new HttpError(400, 'Which place?');
    let m = this.here.get(place); if (!m) this.here.set(place, m = new Map()); m.set(who, { name, at: now });
    if (this.here.size > 5000) for (const [k, v] of this.here) { for (const [w, e] of v) if (now - e.at > 70000) v.delete(w); if (!v.size) this.here.delete(k); }
    const others = [...m].filter(([w, e]) => w !== who && now - e.at < 70000).map(([, e]) => e.name).filter(Boolean);
    return { viewers: [...m].filter(([, e]) => now - e.at < 70000).length - 1, names: others.slice(0, 12) };
  }
  // A business's inside: its plan, size and design (or the standard fit-out until its owner designs it).
  // The inside a building has of its own: a business's design (or its standard fit-out), or an empty home's (bare until its owner furnishes it).
  bizRoom(b) { const home = !!BUILDING_TYPES[b.type]?.home, size = home ? F.roomSize(b.type) : F.bizSize(b.type), plan = home ? F.homePlan(b.type) : F.bizKind(b.type);
    return { size, plan, room: F.fitRoom(b.interior || (home ? {} : { items: F.standardFit(b.type, size) }), size, plan).room }; }
  sizeOf(type) { return BUILDING_TYPES[type]?.home ? F.roomSize(type) : F.bizSize(type); }
  enterable(type) { return F.canEnter(type) || !!BUILDING_TYPES[type]?.home; }
  async viewBuilding(meId, bid, dev = false) {
    const b = (await pool.query('select id, type, name, x, y, w, d, rot, owner_id, owner_handle, done, ruin, interior from buildings where id = $1', [String(bid)])).rows[0];
    if (!b) throw new HttpError(404, 'That building is gone.'); if (dev ? !this.sizeOf(b.type) : !this.enterable(b.type)) throw new HttpError(403, 'You can’t go inside there.');
    if (!dev && (!b.done || b.ruin)) throw new HttpError(409, b.ruin ? 'It’s a ruin now.' : 'It isn’t finished yet.');
    // a home: your own if you live here; the people who live here to choose from; or, with nobody living here, the home itself
    if (BUILDING_TYPES[b.type]?.home) {
      if (meId && (await pool.query('select 1 from citizens where id = $1 and home_id = $2', [meId, b.id])).rowCount) return this.view(meId);
      const live = (await pool.query('select handle, room, case when home_unit_bid = $1 then home_unit end unit from citizens where home_id = $1 order by home_unit nulls last, lower(handle) limit 60', [b.id])).rows;
      if (live.length) return { choose: live.map(r => ({ handle: r.handle, locked: !!r.room?.locked, unit: r.unit || 0 })), home: { id: b.id, name: b.name || BUILDING_TYPES[b.type]?.name || 'Home', type: b.type, x: b.x, y: b.y, rot: b.rot || 0 }, owner: b.owner_handle || null, mine: !!meId && b.owner_id === meId };
    }
    // a night club lets in so many people at once (its owner, and their husband or wife, always get in)
    const cap = BUILDING_TYPES[b.type]?.guests || 0, inside = cap ? this.inside('b:' + b.id, meId) : 0;
    if (cap && inside >= cap && !dev && !(meId && (b.owner_id === meId || (b.owner_id && (await this.world.love?.spouseOf(meId)) === b.owner_id)))) throw new HttpError(409, `🪩 ${b.name || BUILDING_TYPES[b.type].name} is full (${cap} guests). Try again in a little while.`);
    const { size, room } = this.bizRoom(b), mine = !!meId && !!b.owner_id && (b.owner_id === meId || (await this.world.love?.spouseOf(meId)) === b.owner_id), c = mine ? (await pool.query('select coins_base from citizens where id = $1', [meId])).rows[0] : null;
    return { ...(cap ? { guests: cap, inside: inside + 1 } : {}), ...(dev ? { dev: true } : {}), mine: mine || dev, place: BUILDING_TYPES[b.type]?.home ? 'building' : 'business', owner: b.owner_handle || null, designed: !!b.interior, home: { id: b.id, name: b.name || BUILDING_TYPES[b.type]?.name || 'Building', type: b.type, x: b.x, y: b.y, w: b.w, d: b.d, rot: b.rot || 0 }, size, room, photos: await this.photoUrls(room), coins: c ? Math.round(Number(c.coins_base)) : undefined };
  }
  async homeOf(q, c) {
    if (!c.home_id) return null;
    const b = (await q('select id, type, name, x, y, w, d, rot from buildings where id = $1', [c.home_id])).rows[0]; if (!b) return null;
    const size = F.roomSize(b.type); if (!size) return null;
    // their own apartment in the building: given the first time they go in (the lowest number no neighbour has) and
    // kept while they live there. Someone who furnished their place before apartments had numbers keeps its layout.
    let unit = c.home_unit_bid === b.id && Number.isInteger(c.home_unit) ? c.home_unit : null;
    if (unit == null) {
      if (c.home_unit_bid == null && c.room?.items?.length) unit = 1; /* furnished before: apartment 1 is the layout they had */
      else { const taken = new Set((await q(`select home_unit from citizens where home_id = $1 and home_unit_bid = $1 and id <> $2 and home_unit is not null
          union select k.unit from kept_homes k join buildings o on o.id = k.building_id and o.owner_id = k.citizen_id where k.building_id = $1 and k.citizen_id <> $2`, [b.id, c.id])).rows.map(r => r.home_unit)); /* the owner's own apartment stays theirs while they're away */ unit = 1; while (taken.has(unit)) unit++; }
      await q('update citizens set home_unit = $2, home_unit_bid = $3 where id = $1', [c.id, unit, b.id]); c.home_unit = unit; c.home_unit_bid = b.id; }
    return { id: b.id, type: b.type, name: b.name || BUILDING_TYPES[b.type]?.name || 'Home', size, plan: F.homePlan(b.type, unit), unit, x: b.x, y: b.y, w: b.w, d: b.d, rot: b.rot || 0 };
  }
  // where each photo in the house can be fetched: straight from R2 when it's there (u), or through this server (s)
  async photoUrls(room) {
    const ids = [...F.photosIn(room)]; if (!ids.length) return {};
    const rows = (await pool.query('select id, r2key from room_photos where id = any($1)', [ids])).rows, out = {};
    for (const r of rows) out[r.id] = { s: `/api/room/photos/${r.id}`, ...(r.r2key && store.r2On() ? { u: store.publicUrl(r.r2key) } : {}) };
    return out;
  }
  async out(c, home, room, mine) {
    return { mine, place: 'home', owner: c.handle, home: { id: home.id, name: home.name, type: home.type, x: home.x, y: home.y, w: home.w, d: home.d, rot: home.rot || 0, unit: home.unit || 0 }, size: home.size, room, photos: await this.photoUrls(room), coins: mine ? Math.round(Number(c.coins_base)) : undefined };
  }
  // what you see when you go in: your own home, or someone else's (look only)
  async view(meId, handle, dev = false) {
    const pq = (a, v) => pool.query(a, v);
    const c = handle ? (await pq('select id, handle, home_id, room, coins_base, home_unit, home_unit_bid from citizens where lower(handle) = lower($1)', [String(handle)])).rows[0] : (await pq('select id, handle, home_id, room, coins_base, home_unit, home_unit_bid from citizens where id = $1', [meId])).rows[0];
    if (!c) throw new HttpError(404, 'No colonist with that name.');
    const home = await this.homeOf(pq, c); if (!home) throw new HttpError(404, c.id === meId ? 'You don’t have a home yet. Rent one first, then you can furnish it.' : `@${c.handle} doesn’t have a home right now.`);
    const partner = !!meId && c.id !== meId && (await this.world.love?.spouseOf(meId)) === c.id; /* married: your spouse's home is yours to furnish too */
    const room = F.fitRoom(c.room, home.size, home.plan).room; if (room.locked && c.id !== meId && !partner && !dev && !(await this.world.visits?.allowed(c.id, meId))) throw new HttpError(403, `@${c.handle} keeps their home locked. Ask to visit from their card.`); /* unless they've let you in */
    const o = await this.out(c, home, room, c.id === meId || partner || dev);
    if (dev && c.id !== meId) { o.dev = true; delete o.coins; } /* the developer furnishing someone's home */
    else if (partner) { o.partner = true; o.coins = Math.round(Number((await pq('select coins_base from citizens where id = $1', [meId])).rows[0]?.coins_base || 0)); }
    return o;
  }
  // Every change: lock the colonist, fit their home to the house they live in, apply fn, save. fn returns { spend, refund, gone }.
  // `bid`: a business the colonist owns, instead of their home.
  async edit(id, fn, bid = null) {
    let gone = [];
    const res = await this.world.personal(async ch => {
      const dev = bid && typeof bid === 'object' && bid.dev; /* the developer: any building, anyone's home, nothing to pay */
      const q = (a, v) => ch.q(a, v), c = dev ? { id: 'developer', handle: 'developer' } : (await q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such colonist.');
      let home, room, b = null, t = c; /* t: whose home it is (you, or your husband or wife); c pays */
      if (dev === 'h') { t = (await q('select * from citizens where lower(handle) = lower($1) for update', [String(bid.handle || '')])).rows[0]; home = t && await this.homeOf(q, t); if (!home) throw new HttpError(404, 'They don’t have a home right now.'); room = F.fitRoom(t.room, home.size, home.plan).room; }
      else if (dev === 'b') { b = (await q('select * from buildings where id = $1 for update', [String(bid.id || '')])).rows[0]; if (!b) throw new HttpError(404, 'That building is gone.'); if (!this.sizeOf(b.type)) throw new HttpError(409, 'This building has no inside.');
        const z = this.bizRoom(b); room = z.room; home = { plan: z.plan, id: b.id, name: b.name || BUILDING_TYPES[b.type]?.name || 'Building', type: b.type, x: b.x, y: b.y, w: b.w, d: b.d, size: z.size }; }
      else if (bid === '@partner') { const sid = await this.world.love?.spouseOf(c.id, q); if (!sid) throw new HttpError(403, 'Only married couples can furnish each other’s homes.');
        t = (await q('select * from citizens where id = $1 for update', [sid])).rows[0]; home = t && await this.homeOf(q, t); if (!home) throw new HttpError(409, 'Your husband or wife doesn’t have a home right now.'); room = F.fitRoom(t.room, home.size, home.plan).room; bid = null; }
      else if (bid) { b = (await q('select * from buildings where id = $1 for update', [String(bid)])).rows[0]; if (!b) throw new HttpError(404, 'That building is gone.');
        if (b.owner_id !== c.id && !(b.owner_id && (await this.world.love?.spouseOf(c.id, q)) === b.owner_id)) throw new HttpError(403, 'Only its owner (or their husband or wife) can design the inside.'); if (!this.enterable(b.type) || !b.done) throw new HttpError(409, 'This building has no inside to design.');
        const z = this.bizRoom(b); room = z.room; home = { plan: z.plan, id: b.id, name: b.name || BUILDING_TYPES[b.type]?.name || 'Building', type: b.type, x: b.x, y: b.y, w: b.w, d: b.d, size: z.size }; }
      else { home = await this.homeOf(q, c); if (!home) throw new HttpError(409, 'You don’t have a home yet. Rent one first, then you can furnish it.'); room = F.fitRoom(c.room, home.size, home.plan).room; }
      const r = await fn(room, home, c, q, b) || {};
      if (!dev && (r.spend || r.refund)) { ch.coins(c);
        if (r.spend) { if (Number(c.coins_base) < r.spend) throw new HttpError(400, `That costs ${fmt(r.spend)} coins. You have ${fmt(c.coins_base)} on you${Number(c.bank) ? ' (withdraw some at a Bank first)' : ''}.`);
          c.coins_base = Number(c.coins_base) - r.spend; treasuryAdd(ch, r.spend); track(ch, 'home:furniture', r.spend, c.id); }
        if (r.refund) { c.coins_base = Number(c.coins_base) + r.refund; track(ch, 'home:resale', r.refund, c.id); }
        ch.touch(c); await ch.saveCitizen(c); }
      if (r.gone?.length) { gone = (await q('delete from room_photos where id = any($1) returning r2key', [r.gone])).rows; }
      if (b) await q('update buildings set interior = $2 where id = $1', [b.id, JSON.stringify(room)]); else await q('update citizens set room = $2 where id = $1', [t.id, JSON.stringify(room)]);
      return { c, t, home, room, item: r.item, b };
    });
    for (const g of gone) if (g.r2key && store.r2On()) store.del(g.r2key).catch(() => {}); // the photos nobody uses any more
    const dev = bid && typeof bid === 'object' && bid.dev;
    const o = res.b ? { mine: true, place: BUILDING_TYPES[res.b.type]?.home ? 'building' : 'business', owner: dev ? res.b.owner_handle || null : res.c.handle, designed: true, home: res.home, size: res.home.size, room: res.room, photos: await this.photoUrls(res.room), coins: Math.round(Number(res.c.coins_base)) } : await this.out(res.t, res.home, res.room, true);
    if (dev) { o.dev = true; delete o.coins; } else if (!res.b && res.t.id !== res.c.id) { o.partner = true; o.coins = Math.round(Number(res.c.coins_base)); } /* your spouse's home: their home, your coins */
    return { ...o, ok: true, ...(res.item ? { item: res.item } : {}) };
  }
  find(room, i) { const at = room.items.findIndex(x => x.i === i), inBox = at < 0 ? room.box.findIndex(x => x.i === i) : -1;
    if (at < 0 && inBox < 0) throw new HttpError(404, 'That piece isn’t in your home any more.'); return { at, inBox, it: at >= 0 ? room.items[at] : room.box[inBox] }; }
  buy(id, b, bid = null) {
    return this.edit(id, (room, home) => {
      const k = String(b.k || ''), f = F.FURNITURE[k]; if (!f) throw new HttpError(400, 'There’s no such piece.');
      const x = int(b.x), y = int(b.y), r = int(b.r ?? 0), c = Number.isInteger(+b.c) && +b.c >= 0 && +b.c < F.TINTS.length ? +b.c : 0;
      if (room.items.length >= F.MAX_ITEMS) throw new HttpError(409, `Your home holds up to ${F.MAX_ITEMS} pieces. Sell or store one first.`);
      const problem = F.placeProblem(room, home.size, k, x, y, r); if (problem) throw new HttpError(409, problem);
      const item = { i: crypto.randomUUID().slice(0, 8), k, x, y, r, c: f.tint ? c : 0, ...(b.o && F.canTurnOnWall(k) ? { o: 1 } : {}) }; room.items.push(item);
      return { spend: f.cost, item };
    }, bid);
  }
  // move (or turn) a piece, or set one out from storage
  place(id, b, bid = null) {
    return this.edit(id, (room, home) => {
      const i = String(b.i || ''), { at, inBox, it } = this.find(room, i);
      const x = int(b.x), y = int(b.y), r = int(b.r ?? it.r ?? 0);
      if (inBox >= 0 && room.items.length >= F.MAX_ITEMS) throw new HttpError(409, `Your home holds up to ${F.MAX_ITEMS} pieces.`);
      const problem = F.placeProblem(room, home.size, it.k, x, y, r, i); if (problem) throw new HttpError(409, problem);
      if (b.o != null && F.canTurnOnWall(it.k)) { if (b.o) it.o = 1; else delete it.o; } /* turned on the wall (landscape or portrait) */
      if (at >= 0) Object.assign(it, { x, y, r }); else { room.box.splice(inBox, 1); room.items.push({ i, k: it.k, x, y, r, c: it.c, ...(it.ph ? { ph: it.ph } : {}), ...(it.std ? { std: true } : {}), ...(it.o ? { o: 1 } : {}) }); }
    }, bid);
  }
  store(id, b, bid = null) {
    return this.edit(id, room => {
      const { at } = this.find(room, String(b.i || '')); if (at < 0) return;
      if (room.box.length >= F.MAX_STORED) throw new HttpError(409, 'Your storage is full. Sell something first.');
      const [it] = room.items.splice(at, 1); room.box.push({ i: it.i, k: it.k, c: it.c, ...(it.ph ? { ph: it.ph } : {}), ...(it.std ? { std: true } : {}) });
    }, bid);
  }
  sell(id, b, bid = null) {
    return this.edit(id, room => {
      const { at, inBox } = this.find(room, String(b.i || '')), [it] = at >= 0 ? room.items.splice(at, 1) : room.box.splice(inBox, 1);
      return { refund: F.resaleOf(it.k, it.std), gone: it.ph ? [it.ph] : [] };
    }, bid);
  }
  // a room's floor and walls (each room has its own)
  style(id, b, bid = null) {
    return this.edit(id, (room, home) => {
      const i = int(b.room), L = F.layoutOf(home.size, room.plan); if (!Number.isInteger(i) || !L.rooms[i]) throw new HttpError(400, 'Which room?');
      const now = F.styleOf(room, home.size, i), next = { ...(room.styles[i] || {}) }; let spend = 0;
      if (b.floor != null) { const f = F.FLOORS[b.floor]; if (!f) throw new HttpError(400, 'There’s no such floor.'); if (now.f !== b.floor) { next.f = b.floor; spend += f.cost; } }
      if (b.wall != null) { const w = F.WALLS[b.wall]; if (!w) throw new HttpError(400, 'There’s no such wallpaper.'); if (now.w !== b.wall) { next.w = b.wall; spend += w.cost; } }
      room.styles[i] = next; return { spend };
    }, bid);
  }
  // a home can be locked, so others can't walk in
  lock(id, b) { return this.edit(id, room => { if (b.locked) room.locked = true; else delete room.locked; }); }
  // A new photo for a frame. The picture arrives as a small JPEG (the phone shrinks it first).
  async photo(id, i, buf, bid = null) {
    const size = jpegSize(buf); if (!size) throw new HttpError(400, 'That photo couldn’t be read. Try another one.');
    if (buf.length > F.PHOTO_BYTES || size.w > 2048 || size.h > 2048 || size.w < 32 || size.h < 32) throw new HttpError(400, 'That photo is too big.');
    if (id !== 'developer' && Number((await pool.query('select count(*) n from room_photos where citizen_id = $1', [id])).rows[0].n) >= F.MAX_PHOTOS) throw new HttpError(409, `You can have up to ${F.MAX_PHOTOS} photos. Take one down (sell its frame) first.`);
    const pid = crypto.randomBytes(9).toString('base64url'); let r2key = null;
    if (store.r2On()) { try { await store.put(photoKey(pid), buf, 'image/jpeg'); r2key = photoKey(pid); } catch (e) { console.error('photo to R2:', e.message); } }
    try {
      return await this.edit(id, async (room, home, c, q, b) => {
        const { it } = this.find(room, String(i || '')); if (!F.FURNITURE[it.k]?.photo) throw new HttpError(400, 'Only photo frames take a photo.');
        await q('insert into room_photos (id, citizen_id, r2key, data, bytes, t, building_id) values ($1, $2, $3, $4, $5, $6, $7)', [pid, c.id, r2key, r2key ? null : buf, buf.length, Date.now(), b ? b.id : null]);
        const old = it.ph; it.ph = pid; return { gone: old ? [old] : [] };
      }, bid);
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
    const p = (await pool.query('delete from room_photos where id = $1 returning citizen_id, r2key, building_id', [String(pid)])).rows[0]; if (!p) return false;
    if (p.r2key && store.r2On()) store.del(p.r2key).catch(() => {});
    const strip = room => { for (const it of [...(room?.items || []), ...(room?.box || [])]) if (it.ph === pid) delete it.ph; return room; };
    if (p.building_id) { await this.world.personal(async ch => { const b = (await ch.q('select id, interior from buildings where id = $1 for update', [p.building_id])).rows[0]; if (b?.interior) await ch.q('update buildings set interior = $2 where id = $1', [b.id, JSON.stringify(strip(b.interior))]); }); return true; }
    await this.world.personal(async ch => { const c = (await ch.q('select id, room from citizens where id = $1 for update', [p.citizen_id])).rows[0]; if (!c?.room) return;
      const room = c.room; for (const it of [...(room.items || []), ...(room.box || [])]) if (it.ph === pid) delete it.ph; await ch.q('update citizens set room = $2 where id = $1', [c.id, JSON.stringify(room)]); });
    return true;
  }
}
