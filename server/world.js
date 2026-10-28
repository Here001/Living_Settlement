import crypto from 'node:crypto';
import { pool, tx } from './db.js';
import { BUILDING_TYPES, ROAD_TYPES } from '../shared/catalog.js';
import * as R from '../shared/rules.js';

const uid = () => crypto.randomUUID();
export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fmt = n => Math.round(n).toLocaleString('en-US');

// The single source of truth. Lives in memory, mirrors every change to Postgres,
// and pushes each change to every connected browser as a small "op".
export class World {
  constructor() {
    this.meta = null; this.buildings = new Map(); this.roads = new Map(); this.citizens = new Map(); this.events = [];
    this.listeners = new Set();
    this.queue = Promise.resolve();
  }

  // Every mutation goes through here so two requests can never interleave.
  run(fn) { const p = this.queue.then(fn); this.queue = p.catch(() => {}); return p; }

  async load() {
    const m = await pool.query('select data from meta where id = 1');
    this.meta = m.rows[0]?.data || null;
    this.buildings = new Map((await pool.query('select id, data from buildings')).rows.map(r => [r.id, { ...r.data, id: r.id }]));
    this.roads = new Map((await pool.query('select key, type from roads')).rows.map(r => [r.key, r.type]));
    this.citizens = new Map((await pool.query('select id, data from citizens')).rows.map(r => [r.id, { ...r.data, id: r.id }]));
    this.events = (await pool.query('select id, t, kind, text from events order by t desc limit 300')).rows.map(r => ({ ...r, t: Number(r.t) }));
  }

  snapshot() {
    return { meta: this.meta, buildings: [...this.buildings.values()], roads: Object.fromEntries(this.roads),
      citizens: [...this.citizens.values()], events: this.events, serverNow: Date.now() };
  }
  send(obj) { const msg = JSON.stringify(obj); for (const fn of this.listeners) fn(msg); }
  emit(ops) { if (ops.length) this.send({ type: 'ops', ops }); }

  get treasury() { return this.meta ? (this.meta.treasury ?? R.START_FUNDS) : 0; }
  economy() {
    const assign = R.assignments(this.buildings.values(), this.citizens.values());
    return { assign, income: R.dailyIncome(this.citizens.values(), assign, this.buildings) };
  }
  requireFounded() { if (!this.meta) throw new HttpError(409, 'Found the settlement first.'); }

  async saveMeta(db = pool) { await db.query('insert into meta (id, data) values (1, $1) on conflict (id) do update set data = $1', [this.meta]); }
  async putBuilding(b, db = pool) { await db.query('insert into buildings (id, data) values ($1, $2) on conflict (id) do update set data = $2', [b.id, b]); }
  async putCitizen(c, db = pool) { await db.query('insert into citizens (id, handle, data) values ($1, $2, $3) on conflict (id) do update set handle = $2, data = $3', [c.id, c.handle, c]); }
  async event(text, kind, db = pool) {
    const e = { id: uid(), t: Date.now(), kind, text };
    await db.query('insert into events (id, t, kind, text) values ($1, $2, $3, $4)', [e.id, e.t, e.kind, e.text]);
    this.events.unshift(e); if (this.events.length > 300) this.events.length = 300;
    return { op: 'event', data: e };
  }
  spend(cost, free) {
    if (free || !cost) return;
    if (this.treasury < cost) throw new HttpError(402, `That costs ${fmt(cost)} coins. The treasury has ${fmt(this.treasury)}.`);
    this.meta = { ...this.meta, treasury: this.treasury - cost };
  }

  // ---------- builder actions ----------
  async found({ name, handle }) {
    if (this.meta) throw new HttpError(409, 'This settlement is already founded.');
    const now = Date.now(); name = String(name || '').trim().slice(0, 40) || 'Followville'; handle = R.cleanHandle(handle) || 'founder';
    this.meta = { name, epoch: now - 7 * 60 * R.GAME_MIN_MS, createdAt: now, treasury: R.START_FUNDS, taxDay: 0, buildPostId: null };
    const mk = (type, x, y, nm = '') => ({ id: uid(), type, x, y, name: nm, requestedBy: '', builtAt: now + x * 7 + y, builtDay: 0 });
    const blds = [mk('tent', 0, 0), mk('campfire', 2, 1, 'The first fire'), mk('tree', -3, -2), mk('pine', 4, -3), mk('birch', -2, 4), mk('pine', 5, 3), mk('tree', -4, 1), mk('bush', 3, -1), mk('rocks', -1, -3)];
    const founder = { id: uid(), handle, joinedAt: now, coins: 50, settledDay: 0, founder: true, source: 'founder' };
    await tx(async db => {
      await this.saveMeta(db);
      for (const b of blds) { await this.putBuilding(b, db); this.buildings.set(b.id, b); }
      await this.putCitizen(founder, db); this.citizens.set(founder.id, founder);
      await this.event(`@${handle} founded ${name}`, 'found', db);
    });
    this.send({ type: 'snapshot', world: this.snapshot() });
    return this.meta;
  }

  async build({ type, x, y, name = '', requestedBy = '', free = false }) {
    this.requireFounded();
    const t = BUILDING_TYPES[type]; if (!t) throw new HttpError(400, 'Unknown building type.');
    x = Math.trunc(x); y = Math.trunc(y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 5000 || Math.abs(y) > 5000) throw new HttpError(400, 'Bad position.');
    if (!R.canPlace(type, x, y, R.occupancy(this.buildings.values()), this.roads)) throw new HttpError(409, 'That spot is taken. Pick an empty patch of grass.');
    const before = this.meta; this.spend(t.cost || 0, free);
    const now = Date.now();
    const b = { id: uid(), type, x, y, name: String(name).trim().slice(0, 40), requestedBy: R.cleanHandle(requestedBy), builtAt: now, builtDay: R.gameDay(now, this.meta.epoch) };
    let ev;
    try {
      await tx(async db => { await this.putBuilding(b, db); await this.saveMeta(db);
        const nm = b.name || t.name; ev = await this.event(b.requestedBy ? `${nm} was built, requested by @${b.requestedBy}` : `${nm} was built`, 'build', db); });
    } catch (e) { this.meta = before; throw e; }
    this.buildings.set(b.id, b);
    this.emit([{ op: 'building', data: b }, { op: 'meta', data: this.meta }, ev]);
    return b;
  }

  async demolish(id, { refund = false } = {}) {
    const b = this.buildings.get(id); if (!b) throw new HttpError(404, 'No such building.');
    const t = R.typeOf(b); if (refund && t.cost) this.meta = { ...this.meta, treasury: this.treasury + t.cost };
    let ev;
    await tx(async db => { await db.query('delete from buildings where id = $1', [id]); await this.saveMeta(db);
      ev = await this.event(`${b.name || t.name} was demolished`, 'demolish', db); });
    this.buildings.delete(id);
    this.emit([{ op: 'removeBuilding', id }, { op: 'meta', data: this.meta }, ev]);
  }

  async restore(b) {
    if (!b || !BUILDING_TYPES[b.type] || this.buildings.has(b.id)) throw new HttpError(400, 'Nothing to restore.');
    if (!R.canPlace(b.type, b.x, b.y, R.occupancy(this.buildings.values()), this.roads)) throw new HttpError(409, 'Something else is there now.');
    const clean = { id: String(b.id), type: b.type, x: Math.trunc(b.x), y: Math.trunc(b.y), name: String(b.name || '').slice(0, 40), requestedBy: R.cleanHandle(b.requestedBy), builtAt: Number(b.builtAt) || Date.now(), builtDay: Number(b.builtDay) || 0 };
    await this.putBuilding(clean); this.buildings.set(clean.id, clean);
    this.emit([{ op: 'building', data: clean }, await this.event(`${clean.name || R.typeOf(clean).name} was rebuilt`, 'build')]);
  }

  async move(id, x, y) {
    const b = this.buildings.get(id); if (!b) throw new HttpError(404, 'No such building.');
    x = Math.trunc(x); y = Math.trunc(y);
    if (!R.canPlace(b.type, x, y, R.occupancy(this.buildings.values()), this.roads, id)) throw new HttpError(409, 'That spot is taken.');
    const nb = { ...b, x, y }; await this.putBuilding(nb); this.buildings.set(id, nb);
    this.emit([{ op: 'building', data: nb }]);
  }

  async paintRoads({ set = {}, remove = [], free = false }) {
    this.requireFounded();
    const occ = R.occupancy(this.buildings.values());
    const toSet = {}, toRemove = []; let cost = 0;
    for (const [k, type] of Object.entries(set)) {
      if (!/^-?\d+,-?\d+$/.test(k) || !R.isRoadType(type)) continue;
      const bid = occ.get(k); if (bid && R.blocks(this.buildings.get(bid))) continue;
      if (this.roads.get(k) === type) continue;
      toSet[k] = type; cost += R.roadCost(type);
    }
    for (const k of remove) if (this.roads.has(k)) toRemove.push(k);
    if (!Object.keys(toSet).length && !toRemove.length) return { changed: 0, cost: 0 };
    const before = this.meta; this.spend(cost, free);
    try {
      await tx(async db => {
        for (const [k, type] of Object.entries(toSet)) await db.query('insert into roads (key, type) values ($1, $2) on conflict (key) do update set type = $2', [k, type]);
        if (toRemove.length) await db.query('delete from roads where key = any($1)', [toRemove]);
        await this.saveMeta(db);
      });
    } catch (e) { this.meta = before; throw e; }
    for (const [k, type] of Object.entries(toSet)) this.roads.set(k, type);
    for (const k of toRemove) this.roads.delete(k);
    this.emit([{ op: 'roads', set: toSet, remove: toRemove }, { op: 'meta', data: this.meta }]);
    return { changed: Object.keys(toSet).length + toRemove.length, cost: free ? 0 : cost };
  }

  async spawn(handle, source = 'manual') {
    this.requireFounded();
    handle = R.cleanHandle(handle); if (!handle) throw new HttpError(400, 'Type a username first.');
    for (const c of this.citizens.values()) if (c.handle.toLowerCase() === handle.toLowerCase()) throw new HttpError(409, `@${handle} already lives here.`);
    const now = Date.now();
    const c = { id: uid(), handle, joinedAt: now, coins: 20, settledDay: R.gameDay(now, this.meta.epoch), founder: false, source };
    let ev;
    await tx(async db => { await this.putCitizen(c, db); ev = await this.event(`@${handle} moved into ${this.meta.name}`, 'spawn', db); });
    this.citizens.set(c.id, c);
    this.emit([{ op: 'citizen', data: c }, ev]);
    return c;
  }

  async removeCitizen(id) {
    const c = this.citizens.get(id); if (!c) throw new HttpError(404, 'No such citizen.');
    if (c.founder) throw new HttpError(400, 'The founder stays.');
    await pool.query('delete from citizens where id = $1', [id]); this.citizens.delete(id);
    this.emit([{ op: 'removeCitizen', id }, await this.event(`@${c.handle} left ${this.meta.name}`, 'leave')]);
  }

  async setBuildPost(mediaId) {
    this.requireFounded();
    this.meta = { ...this.meta, buildPostId: mediaId ? String(mediaId) : null }; await this.saveMeta();
    this.emit([{ op: 'meta', data: this.meta }]);
  }

  // ---------- the clock: runs whether or not anyone is watching ----------
  // Pays every citizen and fills the treasury for each game day that has finished since the last run.
  // Safe to call as often as you like (every tick, on boot, from a cron ping): it only acts on whole new days.
  async settle() {
    if (!this.meta) return { days: 0 };
    const today = R.gameDay(Date.now(), this.meta.epoch);
    const { assign, income } = this.economy();
    const ops = []; const changedCitizens = [];
    for (const c of this.citizens.values()) {
      const from = c.settledDay ?? today; if (today <= from) continue;
      const { salary, rent } = R.pay(c, assign, this.buildings);
      changedCitizens.push({ ...c, coins: Math.max(0, (c.coins || 0) + (today - from) * (salary - rent)), settledDay: today });
    }
    const fromDay = this.meta.taxDay ?? today; const days = Math.max(0, today - fromDay);
    if (!changedCitizens.length && !days) return { days: 0 };
    const newMeta = days ? { ...this.meta, treasury: this.treasury + days * income, taxDay: today } : this.meta;
    await tx(async db => {
      for (const c of changedCitizens) await this.putCitizen(c, db);
      if (days) { this.meta = newMeta; await this.saveMeta(db);
        ops.push(await this.event(days === 1 ? `Day ${today + 1} begins. The treasury collected ${fmt(income)} coins in taxes and rent.` : `${days} days passed. The treasury collected ${fmt(days * income)} coins.`, 'day', db)); }
    });
    for (const c of changedCitizens) { this.citizens.set(c.id, c); ops.push({ op: 'citizen', data: c }); }
    if (days) ops.push({ op: 'meta', data: this.meta });
    this.emit(ops);
    return { days, income };
  }

  // ---------- incoming social comments ----------
  async recordComment({ id, username, text, mediaId, source }) {
    const r = await pool.query('insert into comments (id, t, username, text, media_id, source) values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing',
      [String(id), Date.now(), username, String(text || '').slice(0, 500), mediaId ? String(mediaId) : null, source]);
    return r.rowCount === 1; // false when the platform re-sends a comment we already have
  }
  async buildRequests(limit = 200) {
    const media = this.meta?.buildPostId; if (!media) return [];
    return (await pool.query('select id, t, username, text from comments where media_id = $1 order by t desc limit $2', [media, limit])).rows.map(r => ({ ...r, t: Number(r.t) }));
  }
}
