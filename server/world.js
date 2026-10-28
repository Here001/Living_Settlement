import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { pool, worldTx } from './db.js';
import { BUILDING_TYPES, WATER_TYPES, VEHICLE_TYPES, DISASTER_TYPES, WEATHER_TYPES, roadClears } from '../shared/catalog.js';
import * as R from '../shared/rules.js';
const changeScope = new AsyncLocalStorage();

const uid = () => crypto.randomUUID();
const fmt = n => Math.round(n).toLocaleString('en-US');
export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// ---------- row shapes ----------
export const bRow = r => ({ id: r.id, type: r.type, x: r.x, y: r.y, cx: r.cx, cy: r.cy, name: r.name, requestedBy: r.requested_by,
  builtAt: r.built_at, builtDay: r.built_day, rot: r.rot || 0, homeUsed: r.home_used, jobUsed: r.job_used, hangUsed: r.hang_used,
  done: r.done !== false, readyAt: r.ready_at || 0, ruin: !!r.ruin, ruinedAt: r.ruined_at || 0 });
const vRow = r => ({ id: r.id, type: r.type, x: r.x, y: r.y, cx: r.cx, cy: r.cy, placedAt: r.placed_at });
const tileKeys = keys => keys.filter(k => /^-?\d{1,7},-?\d{1,7}$/.test(k));
const chunksOfRow = c => [...new Set([[c.home_cx, c.home_cy], [c.job_cx, c.job_cy], [c.hang_cx, c.hang_cy]]
  .filter(([x]) => x !== null && x !== undefined).map(([x, y]) => R.chunkKey(x, y)))];

// The compact citizen record viewers receive. Coordinates travel with it so a viewer can draw a commute
// even when the workplace is in a part of the map they haven't loaded.
const CITIZEN_SELECT = `
  select c.id, c.seq, c.handle, c.joined_at, c.founder, c.gender,
         c.home_cx, c.home_cy, c.job_cx, c.job_cy, c.hang_cx, c.hang_cy,
         h.id hid, h.type ht, h.x hx, h.y hy, j.id jid, j.type jt, j.x jx, j.y jy, g.id gid, g.type gt, g.x gx, g.y gy
  from citizens c
  left join buildings h on h.id = c.home_id left join buildings j on j.id = c.job_id left join buildings g on g.id = c.hang_id`;
export const cOut = r => ({ id: r.id, s: r.seq, h: r.handle, t: r.joined_at, f: r.founder ? 1 : 0, g: r.gender || 'm',
  home: r.hid ? [r.hid, r.ht, r.hx, r.hy] : null, job: r.jid ? [r.jid, r.jt, r.jx, r.jy] : null, hang: r.gid ? [r.gid, r.gt, r.gx, r.gy] : null });

// One world change. Holds the database connection inside the global world lock and records everything that changed,
// so the right viewers can be told afterwards.
class Change {
  constructor(db, meta) {
    this.db = db; this.meta = meta; this.today = meta ? R.gameDay(Date.now(), meta.epoch) : 0;
    this.citizens = new Map();   // id → chunks the citizen was in before this change (null = new citizen)
    this.gone = new Map();       // id → chunks, for removed citizens
    this.buildings = new Set(); this.removedBuildings = new Map(); this.roadOps = []; this.events = [];
    this.moved = new Map();      // building id → handles that moved in during this change
    this.extraOps = [];          // water, vehicle and disaster changes
  }
  q(sql, args) { return this.db.query(sql, args); }

  // Money: checkpoint the stored formula before changing what flows in or out per day.
  income(delta) {
    if (!delta) return;
    this.meta.treasuryBase = R.treasuryOn(this.meta, this.today); this.meta.treasuryDay = this.today;
    this.meta.income = (this.meta.income ?? R.GRANT) + delta;
  }
  spend(cost, free) {
    if (free || !cost) return;
    const now = R.treasuryOn(this.meta, this.today);
    if (now < cost) throw new HttpError(402, `That costs ${fmt(cost)} coins. The treasury has ${fmt(now)}.`);
    this.meta.treasuryBase = now - cost; this.meta.treasuryDay = this.today;
  }
  refund(amount) { if (!amount) return; this.meta.treasuryBase = R.treasuryOn(this.meta, this.today) + amount; this.meta.treasuryDay = this.today; }
  touch(c) { if (!this.citizens.has(c.id)) this.citizens.set(c.id, chunksOfRow(c)); }
  coins(c) { c.coins_base = R.balanceOn(c.coins_base, c.coins_day, c.net, this.today); c.coins_day = this.today; }
  async event(text, kind) {
    if (this.quiet) return;
    const e = { id: uid(), t: Date.now(), kind, text };
    await this.q('insert into events (id, t, kind, text) values ($1, $2, $3, $4)', [e.id, e.t, e.kind, e.text]);
    this.events.push(e);
  }

  async saveCitizen(c) {
    await this.q(`update citizens set home_id=$2, home_cx=$3, home_cy=$4, job_id=$5, job_cx=$6, job_cy=$7, hang_id=$8, hang_cx=$9, hang_cy=$10,
      coins_base=$11, coins_day=$12, net=$13, manual=$14 where id=$1`,
      [c.id, c.home_id, c.home_cx, c.home_cy, c.job_id, c.job_cx, c.job_cy, c.hang_id, c.hang_cx, c.hang_cy, c.coins_base, c.coins_day, c.net, !!c.manual]);
  }
  async bump(id, col, delta) {
    const r = await this.q(`update buildings set ${col} = ${col} + $2::int where id = $1 returning *`, [id, delta]);
    this.buildings.add(id); return r.rows[0];
  }

  async nearestLeisure(x, y, exceptId = null) {
    const r = await this.q(`select id, cx, cy from buildings where leisure and hang_used < hang_cap and id is distinct from $3::text
      and x between $1::int - ${R.HANGOUT_RADIUS} and $1::int + ${R.HANGOUT_RADIUS} and y between $2::int - ${R.HANGOUT_RADIUS} and $2::int + ${R.HANGOUT_RADIUS}
      order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [x, y, exceptId]);
    return r.rows[0] || null;
  }
  async nearestJob(x, y) {
    const r = await this.q(`select * from buildings where job_used < job_cap order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [x, y]);
    return r.rows[0] || null;
  }

  async setHangout(c, g) {
    if ((c.hang_id ?? null) === (g?.id ?? null)) return;
    this.touch(c);
    if (c.hang_id) await this.bump(c.hang_id, 'hang_used', -1);
    c.hang_id = g?.id ?? null; c.hang_cx = g?.cx ?? null; c.hang_cy = g?.cy ?? null;
    if (g) await this.bump(g.id, 'hang_used', 1);
  }

  // ---- the moves a citizen can make ----
  // Rent comes out of wages. A resident without a job lives rent-free until they find one,
  // so nobody's balance goes negative and the treasury never books money that wasn't paid.
  async takeJob(c, j, homeType) {
    this.touch(c); this.coins(c);
    const { salary } = R.capacities(j.type), { rent } = R.capacities(homeType);
    c.job_id = j.id; c.job_cx = j.cx; c.job_cy = j.cy; c.net = R.netOf(salary, rent);
    this.income(R.taxOf(salary) + rent); this.meta.employed = (this.meta.employed || 0) + 1;
    await this.bump(j.id, 'job_used', 1);
  }
  async leaveJob(c, jobType, homeType) {
    if (!c.job_id) return;
    this.touch(c); this.coins(c);
    const { salary } = R.capacities(jobType), { rent } = R.capacities(homeType);
    await this.bump(c.job_id, 'job_used', -1);
    c.job_id = c.job_cx = c.job_cy = null; c.net = 0;
    this.income(-(R.taxOf(salary) + rent)); this.meta.employed = Math.max(0, (this.meta.employed || 0) - 1);
  }
  async moveIn(c, home) {
    this.touch(c); this.coins(c);
    c.home_id = home.id; c.home_cx = home.cx; c.home_cy = home.cy; c.net = 0;
    this.meta.residents = (this.meta.residents || 0) + 1;
    await this.bump(home.id, 'home_used', 1);
    await this.setHangout(c, await this.nearestLeisure(home.x, home.y));
    const job = await this.nearestJob(home.x, home.y);
    if (job) await this.takeJob(c, job, home.type);
    await this.saveCitizen(c);
    if (!this.moved.has(home.id)) this.moved.set(home.id, []);
    this.moved.get(home.id).push(c.handle);
  }
  async moveOut(c, types) {
    if (!c.home_id) return;
    this.touch(c);
    if (c.job_id) await this.leaveJob(c, types.job, types.home);
    this.coins(c);
    await this.bump(c.home_id, 'home_used', -1);
    await this.setHangout(c, null);
    c.home_id = c.home_cx = c.home_cy = null; c.net = 0; c.manual = false;
    this.meta.residents = Math.max(0, (this.meta.residents || 0) - 1);
    await this.saveCitizen(c);
  }

  async rehome(c, home, types) {
    this.touch(c); this.coins(c);
    if (c.job_id) {
      const { salary } = R.capacities(types.job), oldRent = R.capacities(types.home).rent, newRent = R.capacities(home.type).rent;
      this.income(newRent - oldRent); c.net = R.netOf(salary, newRent);
    }
    await this.bump(c.home_id, 'home_used', -1);
    c.home_id = home.id; c.home_cx = home.cx; c.home_cy = home.cy;
    await this.bump(home.id, 'home_used', 1);
    await this.setHangout(c, await this.nearestLeisure(home.x, home.y));
    await this.saveCitizen(c);
  }

  // Move people from the Outskirts into empty homes (queue order), then give unemployed residents nearby jobs.
  // Bounded per call, so one change can never run away with the server; the clock calls it again later.
  async fillVacancies(budget = 2000) {
    let moved = 0;
    while (moved < budget) {
      const h = (await this.q('select * from buildings where home_used < home_cap order by built_at, id limit 1 for update')).rows[0];
      if (!h) break;
      const queue = (await this.q('select * from citizens where home_id is null order by seq limit $1 for update', [h.home_cap - h.home_used])).rows;
      if (!queue.length) break;
      for (const c of queue) await this.moveIn(c, h);
      moved += queue.length;
    }
    let hired = 0;
    while (hired < budget) {
      const free = (await this.q('select 1 from buildings where job_used < job_cap limit 1')).rowCount;
      if (!free) break;
      const idle = (await this.q(`select c.*, h.x hx, h.y hy, h.type htype from citizens c join buildings h on h.id = c.home_id
        where c.home_id is not null and c.job_id is null and not c.manual order by c.seq limit 200 for update of c`)).rows;
      if (!idle.length) break;
      let any = false;
      for (const c of idle) {
        const j = await this.nearestJob(c.hx, c.hy); if (!j) break;
        const homeType = c.htype; delete c.hx; delete c.hy; delete c.htype;
        await this.takeJob(c, j, homeType); await this.saveCitizen(c); hired++; any = true;
      }
      if (!any) break;
    }
    // One news line per building rather than one per person, so a new tower doesn't flood the feed.
    for (const [bid, handles] of this.moved) {
      const b = (await this.q('select type, name from buildings where id = $1', [bid])).rows[0]; if (!b) continue;
      const nm = b.name || BUILDING_TYPES[b.type]?.name || 'a new home';
      await this.event(handles.length === 1 ? `@${handles[0]} moved out of the Outskirts into ${nm}` :
        `${fmt(handles.length)} people moved out of the Outskirts into ${nm}`, 'movein');
    }
    this.moved.clear();
    return { moved, hired };
  }
}

export class World {
  constructor(bus) { this.bus = bus; this.meta = null; this.buildings = new Map(); this.roads = new Map(); this.chunks = new Map(); }

  async load() {
    this.meta = (await pool.query('select data from meta where id = 1')).rows[0]?.data || null;
    this.buildings = new Map(); this.roads = new Map(); this.chunks = new Map();
    for (const r of (await pool.query('select * from buildings')).rows) this.putB(bRow(r));
    for (const r of (await pool.query('select x, y, type from roads')).rows) this.putR(`${r.x},${r.y}`, r.type);
    this.water = new Map(); this.vehicles = new Map();
    for (const r of (await pool.query('select x, y, kind from water')).rows) this.putW(`${r.x},${r.y}`, r.kind);
    for (const r of (await pool.query('select * from vehicles')).rows) this.putV(vRow(r));
    this.founderHandle = (await pool.query('select handle from citizens where founder order by seq limit 1')).rows[0]?.handle || null;
  }
  slot(key) { let c = this.chunks.get(key); if (!c) this.chunks.set(key, c = { buildings: new Map(), roads: {}, water: {}, vehicles: new Map() }); return c; }
  putW(k, t) { const [x, y] = k.split(',').map(Number); this.water.set(k, t); this.slot(R.chunkKeyOfTile(x, y)).water[k] = t; }
  delW(k) { const [x, y] = k.split(',').map(Number); this.water.delete(k); delete this.slot(R.chunkKeyOfTile(x, y)).water[k]; }
  putV(v) { const old = this.vehicles.get(v.id); if (old) this.slot(R.chunkKey(old.cx, old.cy)).vehicles.delete(v.id); this.vehicles.set(v.id, v); this.slot(R.chunkKey(v.cx, v.cy)).vehicles.set(v.id, v); }
  delV(id) { const old = this.vehicles.get(id); if (!old) return; this.slot(R.chunkKey(old.cx, old.cy)).vehicles.delete(id); this.vehicles.delete(id); }
  putB(b) { const old = this.buildings.get(b.id); if (old) this.slot(R.chunkKey(old.cx, old.cy)).buildings.delete(b.id); this.buildings.set(b.id, b); this.slot(R.chunkKey(b.cx, b.cy)).buildings.set(b.id, b); }
  delB(id) { const old = this.buildings.get(id); if (!old) return; this.slot(R.chunkKey(old.cx, old.cy)).buildings.delete(id); this.buildings.delete(id); }
  putR(k, t) { const [x, y] = k.split(',').map(Number); this.roads.set(k, t); this.slot(R.chunkKeyOfTile(x, y)).roads[k] = t; }
  delR(k) { const [x, y] = k.split(',').map(Number); this.roads.delete(k); delete this.slot(R.chunkKeyOfTile(x, y)).roads[k]; }
  // Every server instance applies every change to its own copy of the map (buildings and roads are small;
  // citizens stay in the database).
  apply(ops) {
    for (const o of ops) {
      if (o.op === 'meta') this.meta = o.data;
      else if (o.op === 'building') this.putB(o.data);
      else if (o.op === 'removeBuilding') { const b = this.buildings.get(o.id); if (b && o.chunks[0] === R.chunkKey(b.cx, b.cy)) this.delB(o.id); }
      else if (o.op === 'roads') { for (const k in o.set) this.putR(k, o.set[k]); for (const k of o.remove) this.delR(k); }
      else if (o.op === 'water') { for (const k in o.set) this.putW(k, o.set[k]); for (const k of o.remove) this.delW(k); }
      else if (o.op === 'vehicle') this.putV(o.data);
      else if (o.op === 'removeVehicle') this.delV(o.id);
    }
  }
  requireFounded() { if (!this.meta) throw new HttpError(409, 'Found the settlement first.'); }
  publicMeta() {
    if (!this.meta) return null;
    const m = this.meta; const pop = m.population || 0, res = m.residents || 0;
    return { ...m, outskirts: pop - res, founder: m.founder || this.founderHandle };
  }

  // Runs fn inside the world lock with a fresh copy of the meta row, then tells every server what changed.
  async change(fn, { allowUnfounded = false } = {}) {
    // Inside another change (publishing a draft), join its transaction so the whole batch succeeds or fails together.
    const outer = changeScope.getStore(); if (outer) return fn(outer);
    const result = await worldTx(async db => {
      const row = (await db.query('select data from meta where id = 1 for update')).rows[0];
      if (!row && !allowUnfounded) throw new HttpError(409, 'Found the settlement first.');
      const ch = new Change(db, row ? row.data : null);
      const r = await changeScope.run(ch, () => fn(ch));
      if (ch.meta) await db.query('insert into meta (id, data) values (1, $1) on conflict (id) do update set data = $1', [ch.meta]);
      const ops = await this.collectOps(db, ch);
      return { r, ops };
    });
    this.bus.publish(result.ops);
    return result.r;
  }

  async collectOps(db, ch) {
    const ops = [];
    if (ch.buildings.size) {
      const rows = (await db.query('select * from buildings where id = any($1)', [[...ch.buildings]])).rows;
      for (const r of rows) { const b = bRow(r); ops.push({ op: 'building', data: b, chunks: [R.chunkKey(b.cx, b.cy)] }); }
    }
    for (const [id, chunk] of ch.removedBuildings) ops.push({ op: 'removeBuilding', id, chunks: [chunk] });
    ops.push(...ch.roadOps, ...ch.extraOps);
    if (ch.citizens.size > 400) {
      const rows = (await db.query('select home_cx, home_cy, job_cx, job_cy, hang_cx, hang_cy from citizens where id = any($1)', [[...ch.citizens.keys()]])).rows;
      const chunks = new Set([...ch.citizens.values()].flat()); for (const r of rows) chunksOfRow(r).forEach(k => chunks.add(k));
      ops.push({ op: 'reload', chunks: [...chunks] });
    } else if (ch.citizens.size) {
      const rows = (await db.query(`${CITIZEN_SELECT} where c.id = any($1)`, [[...ch.citizens.keys()]])).rows;
      for (const r of rows) ops.push({ op: 'citizen', data: cOut(r), chunks: [...new Set([...(ch.citizens.get(r.id) || []), ...chunksOfRow(r)])] });
    }
    for (const [id, chunks] of ch.gone) ops.push({ op: 'citizenGone', id, chunks });
    for (const e of ch.events) ops.push({ op: 'event', data: e });
    if (ch.meta) ops.push({ op: 'meta', data: { ...ch.meta, outskirts: (ch.meta.population || 0) - (ch.meta.residents || 0) } });
    return ops;
  }

  // ---------- reads ----------
  chunk(cx, cy) {
    const c = this.chunks.get(R.chunkKey(cx, cy));
    return { buildings: c ? [...c.buildings.values()] : [], roads: c ? { ...c.roads } : {}, water: c ? { ...c.water } : {}, vehicles: c ? [...c.vehicles.values()] : [] };
  }
  async citizensIn(keys, limit = 6000) {
    const vals = keys.map(k => k.split('_').map(Number));
    const flat = vals.flat(); const ph = vals.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::int)`).join(', ');
    const sql = `${CITIZEN_SELECT} where c.id in (
        select id from citizens where (home_cx, home_cy) in (values ${ph})
        union select id from citizens where (job_cx, job_cy) in (values ${ph})
        union select id from citizens where (hang_cx, hang_cy) in (values ${ph}))
      order by c.seq limit ${Number(limit)}`;
    return (await pool.query(sql, flat)).rows.map(cOut);
  }
  async search(q, limit = 20) {
    q = R.cleanHandle(q).toLowerCase(); if (!q) return [];
    const rows = (await pool.query(`${CITIZEN_SELECT} where lower(c.handle) like $1 order by lower(c.handle) limit $2`, [q.replace(/[_%]/g, m => '\\' + m) + '%', limit])).rows;
    return rows.map(cOut);
  }
  async citizenDetail(handle) {
    const r = (await pool.query(`${CITIZEN_SELECT.replace('select c.id,', 'select c.coins_base, c.coins_day, c.net, c.id,')} where lower(c.handle) = lower($1)`, [R.cleanHandle(handle)])).rows[0];
    if (!r) return null;
    const out = cOut(r); const today = this.meta ? R.gameDay(Date.now(), this.meta.epoch) : 0;
    out.coins = R.balanceOn(r.coins_base, r.coins_day, r.net, today); out.net = r.net;
    if (!r.hid) out.queue = Number((await pool.query('select count(*) n from citizens where home_id is null and seq < $1', [r.seq])).rows[0].n) + 1;
    return out;
  }

  // ---------- builder actions ----------
  async found({ name, handle, gender }) {
    return this.change(async ch => {
      if (ch.meta) throw new HttpError(409, 'This settlement is already founded.');
      const now = Date.now(); name = String(name || '').trim().slice(0, 40) || 'Followville'; handle = R.cleanHandle(handle) || 'founder';
      ch.meta = { name, epoch: now - 7 * 60 * R.GAME_MIN_MS, createdAt: now, treasuryBase: R.START_FUNDS, treasuryDay: 0, income: R.GRANT,
        population: 0, residents: 0, employed: 0, newsDay: 0, buildPostId: null, founder: handle, minMs: R.GAME_MIN_MS, weather: null };
      ch.today = 0;
      const starter = [['tent', 0, 0, ''], ['campfire', 2, 1, 'The first fire'], ['tree', -3, -2], ['pine', 4, -3], ['birch', -2, 4], ['pine', 5, 3], ['tree', -4, 1], ['bush', 3, -1], ['rocks', -1, -3]];
      let i = 0; for (const [type, x, y, nm] of starter) await this.insertBuilding(ch, { type, x, y, name: nm || '', builtAt: now + i++ });
      await this.insertCitizens(ch, [handle], 'founder', true, gender);
      await ch.event(`@${handle} founded ${name}`, 'found');
      await ch.fillVacancies();
      return { name, handle };
    }, { allowUnfounded: true });
  }

  // A building under construction exists on the map but has no homes, jobs or visitors until it's finished.
  async insertBuilding(ch, { id = uid(), type, x, y, name = '', requestedBy = '', builtAt = Date.now(), builtDay, instant = true, rot = 0 }) {
    const t = BUILDING_TYPES[type]; rot = R.cleanRot(rot); const [w, d] = R.footprint(t.size, rot); const [cx, cy] = R.chunkOf(x, y); const cap = R.capacities(type);
    const minutes = instant ? 0 : R.buildMinutes(type); const done = minutes === 0;
    const r = await ch.q(`insert into buildings (id, type, x, y, w, d, cx, cy, name, requested_by, built_at, built_day, home_cap, job_cap, leisure, hang_cap, done, ready_at, rot)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning *`,
      [id, type, x, y, w, d, cx, cy, name, requestedBy, builtAt, builtDay ?? ch.today, done ? cap.homeCap : 0, done ? cap.jobCap : 0, cap.leisure, done ? cap.hangCap : 0,
        done, done ? builtAt : builtAt + minutes * R.GAME_MIN_MS, rot]);
    ch.buildings.add(id);
    if (done) await this.attractVisitors(ch, r.rows[0]);
    return r.rows[0];
  }

  async attractVisitors(ch, b) {
    const { id, x, y, cx, cy } = b; const cap = R.capacities(b.type);
    if (cap.leisure) {
      // The closest nearby residents whose hangout is farther away (or missing) start coming here, up to its capacity.
      const rows = (await ch.q(`select c.* from citizens c join buildings h on h.id = c.home_id
        where h.x between $1::int - ${R.HANGOUT_RADIUS} and $1::int + ${R.HANGOUT_RADIUS} and h.y between $2::int - ${R.HANGOUT_RADIUS} and $2::int + ${R.HANGOUT_RADIUS}
          and (c.hang_id is null or (select (g.x - h.x) * (g.x - h.x) + (g.y - h.y) * (g.y - h.y) from buildings g where g.id = c.hang_id)
               > ($1::int - h.x) * ($1::int - h.x) + ($2::int - h.y) * ($2::int - h.y))
        order by ($1::int - h.x) * ($1::int - h.x) + ($2::int - h.y) * ($2::int - h.y), c.seq limit $3 for update of c`, [x, y, cap.hangCap])).rows;
      const g = { id, cx, cy };
      for (const c of rows) { await ch.setHangout(c, g); await ch.saveCitizen(c); }
    }
  }

  async finishIn(ch, b) {
    const cap = R.capacities(b.type);
    const r = (await ch.q('update buildings set done = true, ready_at = $2, home_cap = $3, job_cap = $4, hang_cap = $5 where id = $1 and not done returning *',
      [b.id, Date.now(), cap.homeCap, cap.jobCap, cap.hangCap])).rows[0];
    if (!r) return false;
    ch.buildings.add(b.id);
    await this.attractVisitors(ch, r);
    await ch.event(`${r.name || BUILDING_TYPES[r.type]?.name || 'A building'} is finished${r.requested_by ? `. Thanks for the idea, @${r.requested_by}` : ''}`, 'build');
    return true;
  }
  // The developer's fast-forward: finish one building, or every building under construction.
  async finish(id) {
    return this.change(async ch => {
      const b = (await ch.q('select * from buildings where id = $1 for update', [id])).rows[0];
      if (!b) throw new HttpError(404, 'No such building.');
      if (b.done) return { finished: 0 };
      await this.finishIn(ch, b); await ch.fillVacancies(); return { finished: 1 };
    });
  }
  async finishAll({ dueOnly = false } = {}) {
    return this.change(async ch => {
      const rows = (await ch.q(`select * from buildings where not done ${dueOnly ? 'and ready_at <= $1' : 'and $1::bigint is not null'} order by ready_at limit 500 for update`, [Date.now()])).rows;
      for (const b of rows) await this.finishIn(ch, b);
      if (rows.length) await ch.fillVacancies();
      return { finished: rows.length };
    });
  }

  // Adds people to the end of the housing queue in one statement, then lets the queue fill any empty homes.
  // `genders` (optional) maps a lower-case handle to 'm' or 'f'; anyone not in it gets a coin-flip.
  async insertCitizens(ch, handles, source, founder = false, genders = null) {
    const seen = new Set(); const fresh = [];
    for (const h of handles) { const c = R.cleanHandle(h); if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); fresh.push(c); } }
    if (!fresh.length) return [];
    const taken = new Set((await ch.q('select lower(handle) h from citizens where lower(handle) = any($1)', [[...seen]])).rows.map(r => r.h));
    const add = fresh.filter(h => !taken.has(h.toLowerCase()));
    if (!add.length) return [];
    const now = Date.now(); const ids = add.map(() => uid());
    const gs = add.map(h => { const g = genders?.get?.(h.toLowerCase()) ?? (typeof genders === 'string' ? genders : null); return g === 'm' || g === 'f' ? g : R.randomGender(); });
    const rows = (await ch.q(`insert into citizens (id, handle, joined_at, founder, source, coins_base, coins_day, gender)
      select id, handle, $3, $4, $5, $6, $7, gender from unnest($1::text[], $2::text[], $8::text[]) with ordinality as t(id, handle, gender, ord) order by ord
      returning *`, [ids, add, now, founder, source, founder ? 50 : 20, ch.today, gs])).rows;
    for (const c of rows) ch.citizens.set(c.id, []);
    ch.meta.population = (ch.meta.population || 0) + rows.length;
    return rows;
  }

  // The developer builds for free. `instant: false` gives the building a construction period instead.
  async build({ type, x, y, name = '', requestedBy = '', instant = true, rot = 0 }) {
    const t = BUILDING_TYPES[type]; if (!t) throw new HttpError(400, 'Unknown building type.');
    x = Math.trunc(Number(x)); y = Math.trunc(Number(y));
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100000 || Math.abs(y) > 100000) throw new HttpError(400, 'Bad position.');
    return this.change(async ch => {
      await this.assertFree(ch, type, x, y, null, rot);
      const b = bRow(await this.insertBuilding(ch, { type, x, y, name: String(name).trim().slice(0, 40), requestedBy: R.cleanHandle(requestedBy), instant: instant !== false, rot }));
      const nm = b.name || t.name, by = b.requestedBy ? `, requested by @${b.requestedBy}` : '';
      if (b.done) await ch.event(`${nm} was built${by}`, 'build');
      else { const h = Math.round(R.buildMinutes(type) / 60); await ch.event(`Construction started on ${nm}${by}. Ready in ${h} game hour${h === 1 ? '' : 's'}`, 'build'); }
      await ch.fillVacancies();
      return { building: b };
    });
  }

  // Placement is checked against the database inside the lock, so two servers can't build on the same spot.
  async assertFree(ch, type, x, y, ignoreId = null, rot = 0) {
    const [w, d] = R.footprint(BUILDING_TYPES[type].size, R.cleanRot(rot));
    const hit = await ch.q(`select 1 from buildings where id is distinct from $5::text and x < $1::int + $3::int and x + w > $1::int and y < $2::int + $4::int and y + d > $2::int limit 1`, [x, y, w, d, ignoreId]);
    const road = await ch.q('select 1 from roads where x >= $1::int and x < $1::int + $3::int and y >= $2::int and y < $2::int + $4::int limit 1', [x, y, w, d]);
    if (hit.rowCount || road.rowCount) throw new HttpError(409, 'That spot is taken. Pick an empty patch of grass.');
    const wet = await ch.q('select 1 from water where x >= $1::int and x < $1::int + $3::int and y >= $2::int and y < $2::int + $4::int limit 1', [x, y, w, d]);
    if (wet.rowCount) throw new HttpError(409, "That's water. Build on dry land, or drain it with Terrain → Dry land.");
  }

  async demolish(id, { refund = false } = {}) {
    return this.change(async ch => {
      const b = (await ch.q('select * from buildings where id = $1 for update', [id])).rows[0];
      if (!b) throw new HttpError(404, 'No such building.');
      const t = BUILDING_TYPES[b.type] || {};
      await this.demolishIn(ch, b);
      if (refund) ch.refund(t.cost || 0);
      await ch.event(`${b.name || t.name || 'A building'} was demolished`, 'demolish');
      await ch.fillVacancies();
      return { ok: true };
    });
  }

  async demolishIn(ch, b) {
    await this.evict(ch, b);
    await ch.q('delete from buildings where id = $1', [b.id]);
    ch.buildings.delete(b.id); ch.removedBuildings.set(b.id, R.chunkKey(b.cx, b.cy));
  }

  // Everyone who lives, works or hangs out in a building leaves it.
  async evict(ch, b) {
    const id = b.id;
    {
      const typeOfId = async bid => bid ? (await ch.q('select type from buildings where id = $1', [bid])).rows[0]?.type : null;
      // Workers lose this job; residents go back to the Outskirts (keeping their place at the front of the queue).
      for (const c of (await ch.q('select c.*, h.type htype from citizens c left join buildings h on h.id = c.home_id where c.job_id = $1 for update of c', [id])).rows) {
        const homeType = c.htype; delete c.htype; await ch.leaveJob(c, b.type, homeType); c.manual = false; await ch.saveCitizen(c); }
      for (const c of (await ch.q('select * from citizens where home_id = $1 for update', [id])).rows) await ch.moveOut(c, { home: b.type, job: await typeOfId(c.job_id) });
      if (b.leisure) {
        const rows = (await ch.q('select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where c.hang_id = $1 for update of c', [id])).rows;
        for (const c of rows) {
          const { hx, hy } = c; delete c.hx; delete c.hy;
          c.hang_id = null; ch.touch({ ...c, hang_cx: b.cx, hang_cy: b.cy });
          await ch.setHangout(c, hx === null ? null : await ch.nearestLeisure(hx, hy, id)); await ch.saveCitizen(c);
        }
      }
    }
  }

  // Clear a rectangle of the map: every building touching it and every road tile inside it.
  async bulldozeArea({ x0, y0, x1, y1 }) {
    [x0, y0, x1, y1] = [x0, y0, x1, y1].map(v => Math.trunc(Number(v)));
    if (![x0, y0, x1, y1].every(Number.isFinite)) throw new HttpError(400, 'Bad area.');
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    if (bx - ax > 400 || by - ay > 400) throw new HttpError(400, 'That area is too big. Clear at most 400 × 400 tiles at a time.');
    return this.change(async ch => {
      const blds = (await ch.q('select * from buildings where x <= $3 and x + w > $1 and y <= $4 and y + d > $2 limit 2000 for update', [ax, ay, bx, by])).rows;
      for (const b of blds) await this.demolishIn(ch, b);
      const removed = (await ch.q('delete from roads where x between $1 and $3 and y between $2 and $4 returning x, y', [ax, ay, bx, by])).rows.map(r => `${r.x},${r.y}`);
      this.roadOps(ch, {}, removed);
      for (const v of (await ch.q('delete from vehicles where x between $1 and $3 and y between $2 and $4 returning id, cx, cy', [ax, ay, bx, by])).rows)
        ch.extraOps.push({ op: 'removeVehicle', id: v.id, chunks: [R.chunkKey(v.cx, v.cy)] });
      if (blds.length || removed.length) await ch.event(`An area was cleared: ${fmt(blds.length)} building${blds.length === 1 ? '' : 's'} and ${fmt(removed.length)} road tile${removed.length === 1 ? '' : 's'} removed`, 'demolish');
      await ch.fillVacancies();
      return { buildings: blds.length, roads: removed.length };
    });
  }

  roadOps(ch, set, removed) {
    const by = new Map(); const slot = k => { const [x, y] = k.split(',').map(Number); const ck = R.chunkKeyOfTile(x, y); if (!by.has(ck)) by.set(ck, { set: {}, remove: [] }); return by.get(ck); };
    for (const k in set) slot(k).set[k] = set[k];
    for (const k of removed) slot(k).remove.push(k);
    for (const [ck, o] of by) ch.roadOps.push({ op: 'roads', set: o.set, remove: o.remove, chunks: [ck] });
  }

  async restore(b) {
    if (!b || !BUILDING_TYPES[b.type]) throw new HttpError(400, 'Nothing to restore.');
    return this.change(async ch => {
      if ((await ch.q('select 1 from buildings where id = $1', [String(b.id)])).rowCount) throw new HttpError(400, 'Nothing to restore.');
      const x = Math.trunc(b.x), y = Math.trunc(b.y);
      await this.assertFree(ch, b.type, x, y, null, b.rot);
      const row = await this.insertBuilding(ch, { id: String(b.id), type: b.type, x, y, name: String(b.name || '').slice(0, 40), requestedBy: R.cleanHandle(b.requestedBy),
        builtAt: Number(b.builtAt) || Date.now(), builtDay: Number(b.builtDay) || 0, rot: b.rot });
      if (!roadClears(b.type)) await ch.event(`${row.name || BUILDING_TYPES[b.type].name} was rebuilt`, 'build'); // trees and benches coming back aren't news
      await ch.fillVacancies();
      return { ok: true };
    });
  }

  // Moves a building, and can turn it at the same time (rot undefined = keep how it faces).
  async move(id, x, y, rot) {
    x = Math.trunc(Number(x)); y = Math.trunc(Number(y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new HttpError(400, 'Bad position.');
    return this.change(async ch => {
      const b = (await ch.q('select * from buildings where id = $1 for update', [id])).rows[0];
      if (!b) throw new HttpError(404, 'No such building.');
      const r2 = rot === undefined || rot === null ? b.rot : R.cleanRot(rot), [w, d] = R.footprint(BUILDING_TYPES[b.type].size, r2);
      await this.assertFree(ch, b.type, x, y, id, r2);
      const [cx, cy] = R.chunkOf(x, y);
      if (cx !== b.cx || cy !== b.cy) ch.removedBuildings.set(id, R.chunkKey(b.cx, b.cy));
      await ch.q('update buildings set x = $2, y = $3, cx = $4, cy = $5, rot = $6, w = $7, d = $8 where id = $1', [id, x, y, cx, cy, r2, w, d]);
      ch.buildings.add(id);
      for (const [col, cxc, cyc] of [['home_id', 'home_cx', 'home_cy'], ['job_id', 'job_cx', 'job_cy'], ['hang_id', 'hang_cx', 'hang_cy']]) {
        const rows = (await ch.q(`select * from citizens where ${col} = $1`, [id])).rows;
        for (const c of rows) ch.touch(c);
        if (rows.length) await ch.q(`update citizens set ${cxc} = $2, ${cyc} = $3 where ${col} = $1`, [id, cx, cy]);
      }
      return { ok: true };
    });
  }

  async paintRoads({ set = {}, remove = [] }) {
    return this.change(async ch => {
      const keys = Object.keys(set).filter(k => /^-?\d+,-?\d+$/.test(k) && R.isRoadType(set[k])).slice(0, 5000);
      const toSet = {}, cleared = []; let cost = 0;
      if (keys.length) {
        const xs = keys.map(k => +k.split(',')[0]), ys = keys.map(k => +k.split(',')[1]);
        // Small things in the way (trees, rocks, benches, lamps) are cleared; tiles under anything bigger are skipped.
        const under = (await ch.q(`select t.x || ',' || t.y k, b.* from unnest($1::int[], $2::int[]) t(x, y)
          join buildings b on t.x >= b.x and t.x < b.x + b.w and t.y >= b.y and t.y < b.y + b.d`, [xs, ys])).rows;
        const solid = new Set(under.filter(r => !roadClears(r.type)).map(r => r.k));
        const existing = new Map((await ch.q('select x || \',\' || y k, type from roads where (x, y) in (select * from unnest($1::int[], $2::int[]))', [xs, ys])).rows.map(r => [r.k, r.type]));
        for (const k of keys) { if (solid.has(k) || existing.get(k) === set[k]) continue; toSet[k] = set[k]; cost += R.roadCost(set[k]); }
        for (const r of under) if (toSet[r.k] && roadClears(r.type) && !cleared.some(c => c.id === r.id)) { const b = { ...r }; delete b.k; cleared.push(bRow(b)); await this.demolishIn(ch, b); }
      }
      const rm = remove.filter(k => /^-?\d+,-?\d+$/.test(k)).slice(0, 5000);
      let removed = [];
      if (rm.length) removed = (await ch.q('delete from roads where (x, y) in (select * from unnest($1::int[], $2::int[])) returning x, y',
        [rm.map(k => +k.split(',')[0]), rm.map(k => +k.split(',')[1])])).rows.map(r => `${r.x},${r.y}`);
      const n = Object.keys(toSet).length;
      if (!n && !removed.length) return { changed: 0, cost: 0 };
      if (n) {
        const ks = Object.keys(toSet); const xs = ks.map(k => +k.split(',')[0]), ys = ks.map(k => +k.split(',')[1]);
        await ch.q(`insert into roads (x, y, type, cx, cy) select x, y, t, floor(x::float / ${R.CHUNK})::int, floor(y::float / ${R.CHUNK})::int
          from unnest($1::int[], $2::int[], $3::text[]) u(x, y, t) on conflict (x, y) do update set type = excluded.type`, [xs, ys, ks.map(k => toSet[k])]);
      }
      // One road op per chunk so viewers only hear about roads they can see.
      this.roadOps(ch, toSet, removed);
      if (cleared.length) await ch.fillVacancies();
      return { changed: n + removed.length, cost: 0, cleared };
    });
  }

  async spawn(handle, source = 'manual', gender = null) {
    const h = R.cleanHandle(handle); if (!h) throw new HttpError(400, 'Type a username first.');
    return this.change(async ch => {
      const rows = await this.insertCitizens(ch, [h], source, false, gender);
      if (!rows.length) throw new HttpError(409, `@${h} already lives here.`);
      await ch.fillVacancies();
      const housed = (await ch.q('select home_id from citizens where id = $1', [rows[0].id])).rows[0].home_id;
      if (!housed) await ch.event(`@${h} arrived and is waiting in the Outskirts`, 'spawn');
      return { citizen: { id: rows[0].id, handle: h, housed: !!housed } };
    });
  }

  // Many arrivals in one change: used by the comment queue during viral moments.
  async spawnMany(handles, source, genders = null) {
    return this.change(async ch => {
      const rows = await this.insertCitizens(ch, handles, source, false, genders);
      if (!rows.length) return { added: 0 };
      const { moved } = await ch.fillVacancies();
      const waiting = rows.length - Math.min(rows.length, moved);
      if (waiting === 1 && rows.length === 1) await ch.event(`@${rows[0].handle} arrived and is waiting in the Outskirts`, 'spawn');
      else if (waiting > 0) await ch.event(`${fmt(rows.length)} new followers arrived. ${fmt(ch.meta.population - ch.meta.residents)} are waiting in the Outskirts`, 'spawn');
      return { added: rows.length };
    });
  }

  async spawnBulk(handles, gender = null) {
    const list = (Array.isArray(handles) ? handles : String(handles || '').split(/[\s,;]+/)).map(R.cleanHandle).filter(Boolean).slice(0, 5000);
    if (!list.length) throw new HttpError(400, 'Add at least one username.');
    return this.change(async ch => {
      const rows = await this.insertCitizens(ch, list, 'manual', false, gender === 'm' || gender === 'f' ? gender : null);
      if (rows.length) {
        const { moved } = await ch.fillVacancies();
        await ch.event(rows.length === 1 ? `@${rows[0].handle} joined ${ch.meta.name}` : `${fmt(rows.length)} new citizens joined ${ch.meta.name}`, 'spawn');
        return { added: rows.length, skipped: list.length - rows.length, housed: moved };
      }
      return { added: 0, skipped: list.length, housed: 0 };
    });
  }

  // The developer's career and housing controls.
  async setJob(id, jobId) {
    return this.change(async ch => {
      const c = (await ch.q('select c.*, h.type htype, j.type jtype from citizens c left join buildings h on h.id = c.home_id left join buildings j on j.id = c.job_id where c.id = $1 for update of c', [id])).rows[0];
      if (!c) throw new HttpError(404, 'No such citizen.');
      const homeType = c.htype, jobType = c.jtype; delete c.htype; delete c.jtype;
      if (!c.home_id) throw new HttpError(400, `@${c.handle} is waiting in the Outskirts. Give them a home first.`);
      let j = null;
      if (jobId) {
        j = (await ch.q('select * from buildings where id = $1 for update', [jobId])).rows[0];
        if (!j || !j.job_cap && !BUILDING_TYPES[j.type]?.work) throw new HttpError(400, 'That building has no jobs.');
        if (!j.done) throw new HttpError(409, 'That building is still under construction.');
        if (c.job_id === j.id) return { ok: true };
        if (j.job_used >= j.job_cap) {
          // Full: the newest worker who was placed automatically makes room. Hand-placed workers are never bumped.
          const out = (await ch.q(`select c.*, h.type htype from citizens c left join buildings h on h.id = c.home_id
            where c.job_id = $1 and not c.manual order by c.seq desc limit 1 for update of c`, [j.id])).rows[0];
          if (!out) throw new HttpError(409, `Everyone at ${j.name || BUILDING_TYPES[j.type].name} was placed by hand. Move one of them first.`);
          const ht = out.htype; delete out.htype; await ch.leaveJob(out, j.type, ht); await ch.saveCitizen(out);
          j = (await ch.q('select * from buildings where id = $1', [j.id])).rows[0];
        }
      }
      if (c.job_id) await ch.leaveJob(c, jobType, homeType);
      if (j) await ch.takeJob(c, j, homeType);
      c.manual = true; await ch.saveCitizen(c);
      await ch.event(j ? `@${c.handle} is now working as ${BUILDING_TYPES[j.type].work.title.toLowerCase()} at ${j.name || BUILDING_TYPES[j.type].name}` : `@${c.handle} left their job`, 'career');
      await ch.fillVacancies();
      return { ok: true };
    });
  }
  async setGender(id, gender) {
    if (gender !== 'm' && gender !== 'f') throw new HttpError(400, "Gender must be 'm' or 'f'.");
    return this.change(async ch => {
      const c = (await ch.q('update citizens set gender = $2 where id = $1 returning *', [id, gender])).rows[0];
      if (!c) throw new HttpError(404, 'No such citizen.');
      ch.touch(c); return { ok: true };
    });
  }
  async setHome(id, homeId) {
    return this.change(async ch => {
      const c = (await ch.q('select c.*, h.type htype, j.type jtype from citizens c left join buildings h on h.id = c.home_id left join buildings j on j.id = c.job_id where c.id = $1 for update of c', [id])).rows[0];
      if (!c) throw new HttpError(404, 'No such citizen.');
      const types = { home: c.htype, job: c.jtype }; delete c.htype; delete c.jtype;
      const h = (await ch.q('select * from buildings where id = $1 for update', [homeId])).rows[0];
      if (!h || !BUILDING_TYPES[h.type]?.home) throw new HttpError(400, 'That building has no homes.');
      if (!h.done) throw new HttpError(409, 'That building is still under construction.');
      if (c.home_id === h.id) return { ok: true };
      if (h.home_used >= h.home_cap) {
        // Full: the newest resident (never the founder) goes back to the front of the housing queue to make room.
        const out = (await ch.q(`select c.*, j.type jtype from citizens c left join buildings j on j.id = c.job_id
          where c.home_id = $1 and not c.founder order by c.seq desc limit 1 for update of c`, [h.id])).rows[0];
        if (!out) throw new HttpError(409, `${h.name || BUILDING_TYPES[h.type].name} is full.`);
        const jt = out.jtype; delete out.jtype; await ch.moveOut(out, { home: h.type, job: jt });
        await ch.event(`@${out.handle} made room in ${h.name || BUILDING_TYPES[h.type].name}`, 'movein');
      }
      if (c.home_id) await ch.rehome(c, h, types); else await ch.moveIn(c, h);
      await ch.event(`@${c.handle} moved into ${h.name || BUILDING_TYPES[h.type].name}`, 'movein');
      ch.moved.clear(); await ch.fillVacancies();
      return { ok: true };
    });
  }
  // Workplaces or homes near a spot, for the developer's pickers.
  async places(kind, x, y) {
    const col = kind === 'home' ? 'home' : 'job';
    const rows = (await pool.query(`select * from buildings where done and ${col}_cap > 0
      order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 60`, [Math.trunc(Number(x) || 0), Math.trunc(Number(y) || 0)])).rows;
    return rows.map(r => ({ id: r.id, type: r.type, name: r.name || BUILDING_TYPES[r.type]?.name, x: r.x, y: r.y,
      used: r[`${col}_used`], cap: r[`${col}_cap`], title: col === 'job' ? BUILDING_TYPES[r.type]?.work?.title : null }));
  }

  async removeCitizen(id) {
    return this.change(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0];
      if (!c) throw new HttpError(404, 'No such citizen.');
      if (c.founder) throw new HttpError(400, 'The founder stays.');
      const chunks = chunksOfRow(c);
      const types = { home: c.home_id && (await ch.q('select type from buildings where id = $1', [c.home_id])).rows[0]?.type,
        job: c.job_id && (await ch.q('select type from buildings where id = $1', [c.job_id])).rows[0]?.type };
      await ch.moveOut(c, types);
      await ch.q('delete from citizens where id = $1', [id]);
      ch.citizens.delete(id); ch.gone.set(id, chunks);
      ch.meta.population = Math.max(0, (ch.meta.population || 0) - 1);
      await ch.event(`@${c.handle} left ${ch.meta.name}`, 'leave');
      await ch.fillVacancies();
      return { ok: true };
    });
  }

  // ---------- the clock speed changed (30 real minutes = 1 game day) ----------
  // Keeps the current game time and construction progress where they were, so nothing jumps.
  async reanchor() {
    if (!this.meta || (this.meta.minMs ?? R.LEGACY_GAME_MIN_MS) === R.GAME_MIN_MS) return false;
    return this.change(async ch => {
      const old = ch.meta.minMs ?? R.LEGACY_GAME_MIN_MS; if (old === R.GAME_MIN_MS) return false;
      const now = Date.now(), gm = (now - ch.meta.epoch) / old;
      ch.meta.epoch = Math.round(now - gm * R.GAME_MIN_MS); ch.meta.minMs = R.GAME_MIN_MS;
      const k = R.GAME_MIN_MS / old;
      const rows = (await ch.q(`update buildings set built_at = $1::bigint - round(($1::bigint - built_at) * $2::float8)::bigint,
        ready_at = $1::bigint + round(greatest(ready_at - $1::bigint, 0) * $2::float8)::bigint where not done returning id`, [now, k])).rows;
      for (const r of rows) ch.buildings.add(r.id);
      await ch.event('Time now runs faster: a full day passes every 30 real minutes', 'day');
      return true;
    });
  }

  // ---------- water ----------
  // Water can't go under buildings. Water under a road turns that road into a bridge.
  async paintWater({ set = {}, remove = [] }) {
    return this.change(async ch => {
      const keys = tileKeys(Object.keys(set)).filter(k => WATER_TYPES[set[k]]).slice(0, 20000);
      const toSet = {};
      if (keys.length) {
        const xs = keys.map(k => +k.split(',')[0]), ys = keys.map(k => +k.split(',')[1]);
        const covered = new Set((await ch.q(`select t.x || ',' || t.y k from unnest($1::int[], $2::int[]) t(x, y)
          join buildings b on t.x >= b.x and t.x < b.x + b.w and t.y >= b.y and t.y < b.y + b.d`, [xs, ys])).rows.map(r => r.k));
        for (const k of keys) if (!covered.has(k)) toSet[k] = set[k];
        const ks = Object.keys(toSet);
        if (ks.length) await ch.q(`insert into water (x, y, kind, cx, cy) select x, y, k, floor(x::float / ${R.CHUNK})::int, floor(y::float / ${R.CHUNK})::int
          from unnest($1::int[], $2::int[], $3::text[]) u(x, y, k) on conflict (x, y) do update set kind = excluded.kind`,
          [ks.map(k => +k.split(',')[0]), ks.map(k => +k.split(',')[1]), ks.map(k => toSet[k])]);
      }
      const rm = tileKeys(remove).slice(0, 20000);
      const removed = rm.length ? (await ch.q('delete from water where (x, y) in (select * from unnest($1::int[], $2::int[])) returning x, y',
        [rm.map(k => +k.split(',')[0]), rm.map(k => +k.split(',')[1])])).rows.map(r => `${r.x},${r.y}`) : [];
      const by = new Map(); const slot = k => { const [x, y] = k.split(',').map(Number); const ck = R.chunkKeyOfTile(x, y); if (!by.has(ck)) by.set(ck, { set: {}, remove: [] }); return by.get(ck); };
      for (const k in toSet) slot(k).set[k] = toSet[k];
      for (const k of removed) slot(k).remove.push(k);
      for (const [ck, o] of by) ch.extraOps.push({ op: 'water', set: o.set, remove: o.remove, chunks: [ck] });
      return { changed: Object.keys(toSet).length + removed.length, skipped: keys.length - Object.keys(toSet).length };
    });
  }

  // ---------- vehicles the developer places (they drive around on their own) ----------
  async placeVehicle({ type, x, y }) {
    if (!VEHICLE_TYPES[type]) throw new HttpError(400, 'Unknown vehicle.');
    x = Math.trunc(Number(x)); y = Math.trunc(Number(y));
    return this.change(async ch => {
      if (!(await ch.q('select 1 from roads where x = $1 and y = $2', [x, y])).rowCount) throw new HttpError(409, 'Vehicles need a road. Tap a road tile.');
      if (Number((await ch.q('select count(*) n from vehicles')).rows[0].n) >= 2000) throw new HttpError(409, 'That is the vehicle limit (2,000). Remove some first.');
      const [cx, cy] = R.chunkOf(x, y);
      const v = vRow((await ch.q('insert into vehicles (id, type, x, y, cx, cy, placed_at) values ($1,$2,$3,$4,$5,$6,$7) returning *', [uid(), type, x, y, cx, cy, Date.now()])).rows[0]);
      ch.extraOps.push({ op: 'vehicle', data: v, chunks: [R.chunkKey(cx, cy)] });
      return { vehicle: v };
    });
  }
  async removeVehicle(id) {
    return this.change(async ch => {
      const v = (await ch.q('delete from vehicles where id = $1 returning id, cx, cy', [id])).rows[0];
      if (!v) throw new HttpError(404, 'No such vehicle.');
      ch.extraOps.push({ op: 'removeVehicle', id, chunks: [R.chunkKey(v.cx, v.cy)] });
      return { ok: true };
    });
  }

  // ---------- disasters ----------
  // Hit buildings become ruins: their people leave (residents to the Outskirts), and they stay as rubble
  // until repaired or cleared. Small things like trees and benches are simply destroyed.
  async disaster({ kind, x, y, dir }) {
    const D = DISASTER_TYPES[kind]; if (!D) throw new HttpError(400, 'Unknown disaster.');
    x = Math.trunc(Number(x)); y = Math.trunc(Number(y)); if (!Number.isFinite(x) || !Number.isFinite(y)) throw new HttpError(400, 'Bad position.');
    dir = Number.isFinite(Number(dir)) ? Number(dir) : Math.random() * Math.PI * 2;
    return this.change(async ch => {
      const reach = kind === 'tornado' ? D.length + D.radius : D.radius;
      const near = (await ch.q('select * from buildings where not ruin and x <= $1::int + $3::int and x + w >= $1::int - $3::int and y <= $2::int + $3::int and y + d >= $2::int - $3::int for update',
        [x, y, reach])).rows;
      const hit = [];
      const dist = b => Math.hypot(b.x + b.w / 2 - x - 0.5, b.y + b.d / 2 - y - 0.5);
      for (const b of near) {
        const t = BUILDING_TYPES[b.type] || {}; let p = 0;
        if (kind === 'fire') p = dist(b) <= 1.5 ? 1 : dist(b) <= D.radius + 1.5 ? 0.55 : 0;
        else if (kind === 'meteor') p = dist(b) <= D.radius + 0.8 ? 1 : 0;
        else if (kind === 'flood') p = dist(b) <= D.radius ? (t.outdoor ? 0.3 : 0.45) : 0;
        else if (kind === 'earthquake') p = dist(b) <= D.radius ? Math.min(0.85, 0.2 + (t.height || 20) / 160) * (1 - dist(b) / (D.radius * 1.6)) : 0;
        else if (kind === 'tornado') {
          const cx = b.x + b.w / 2 - x - 0.5, cy = b.y + b.d / 2 - y - 0.5, along = cx * Math.cos(dir) + cy * Math.sin(dir), across = Math.abs(-cx * Math.sin(dir) + cy * Math.cos(dir));
          p = along >= -1 && along <= D.length && across <= D.radius + Math.max(b.w, b.d) / 2 ? 0.9 : 0;
        }
        if (p && Math.random() < p) hit.push(b);
      }
      let ruined = 0, destroyed = 0;
      for (const b of hit) {
        const t = BUILDING_TYPES[b.type] || {};
        if (t.cat === 'nature' || t.cat === 'decor' || (t.cost || 0) < 100) { await this.demolishIn(ch, b); destroyed++; continue; }
        await this.evict(ch, b);
        await ch.q('update buildings set ruin = true, ruined_at = $2, done = true, home_cap = 0, job_cap = 0, hang_cap = 0 where id = $1', [b.id, Date.now()]);
        ch.buildings.add(b.id); ruined++;
      }
      const rec = { id: uid(), kind, x, y, r: D.radius, dir, t: Date.now(), hit: ruined };
      await ch.q('insert into disasters (id, kind, x, y, r, dir, t, hit) values ($1,$2,$3,$4,$5,$6,$7,$8)', [rec.id, kind, x, y, rec.r, dir, rec.t, ruined]);
      ch.extraOps.push({ op: 'disaster', data: rec });
      const what = { fire: 'A fire broke out', tornado: 'A tornado tore through town', earthquake: 'An earthquake shook the city', flood: 'A flood swept the streets', meteor: 'A meteor crashed into town' }[kind];
      await ch.event(ruined ? `${what}. ${fmt(ruined)} building${ruined === 1 ? ' is' : 's are'} in ruins. Emergency crews are on the way` : `${what}, but every building is still standing`, 'disaster');
      await ch.fillVacancies();
      return { ruined, destroyed, disaster: rec };
    });
  }
  async repair(id) {
    return this.change(async ch => {
      const b = (await ch.q('select * from buildings where id = $1 and ruin for update', [id])).rows[0];
      if (!b) throw new HttpError(404, 'That building is not in ruins.');
      const cap = R.capacities(b.type);
      const r = (await ch.q('update buildings set ruin = false, ruined_at = 0, home_cap = $2, job_cap = $3, hang_cap = $4 where id = $1 returning *', [id, cap.homeCap, cap.jobCap, cap.hangCap])).rows[0];
      ch.buildings.add(id); await this.attractVisitors(ch, r);
      await ch.event(`${r.name || BUILDING_TYPES[r.type]?.name || 'A building'} was rebuilt after the disaster`, 'build');
      await ch.fillVacancies();
      return { ok: true };
    });
  }
  async clearRuins() {
    return this.change(async ch => {
      const rows = (await ch.q('select * from buildings where ruin limit 5000 for update')).rows;
      for (const b of rows) await this.demolishIn(ch, b);
      if (rows.length) await ch.event(`Crews cleared ${fmt(rows.length)} ruin${rows.length === 1 ? '' : 's'}`, 'demolish');
      return { cleared: rows.length };
    });
  }
  async recentDisasters(ms = 15 * 60000) {
    return (await pool.query('select id, kind, x, y, r, dir, t, hit from disasters where t > $1 order by t desc limit 20', [Date.now() - ms])).rows;
  }

  // ---------- weather ----------
  async setWeather(kind) {
    if (kind && !WEATHER_TYPES[kind]) throw new HttpError(400, 'Unknown weather.');
    return this.change(async ch => { ch.meta.weather = kind || null; return { weather: ch.meta.weather }; });
  }

  async setBuildPost(mediaId) {
    return this.change(async ch => { ch.meta.buildPostId = mediaId ? String(mediaId) : null; return { ok: true }; });
  }

  // ---------- the clock ----------
  // Paydays need no work (balances are formulas). The clock only writes the daily headline and
  // finishes any queue work a busy moment left over.
  async tick() {
    if (!this.meta) return { days: 0 };
    const today = R.gameDay(Date.now(), this.meta.epoch);
    const due = (await pool.query('select 1 from buildings where not done and ready_at <= $1 limit 1', [Date.now()])).rowCount;
    if (due) await this.finishAll({ dueOnly: true });
    const pending = this.meta.population > this.meta.residents && (await pool.query('select 1 from buildings where home_used < home_cap limit 1')).rowCount;
    if (today <= (this.meta.newsDay ?? 0) && !pending) return { days: 0, finished: due };
    return this.change(async ch => {
      const days = today - (ch.meta.newsDay ?? 0);
      if (days > 0) {
        ch.meta.newsDay = today;
        await ch.event(days === 1 ? `Day ${today + 1} begins. The treasury now earns ${fmt(ch.meta.income)} coins a day.`
          : `${days} days passed. The treasury earned ${fmt(days * ch.meta.income)} coins.`, 'day');
      }
      await ch.fillVacancies();
      return { days };
    });
  }

  // ---------- the developer's draft ----------
  // A draft is a list of building work saved but not yet live. Publishing replays it in one transaction:
  // anything that no longer fits is skipped and reported, everything else appears at once with a single headline.
  async getDraft() { return (await pool.query('select data, updated_at from draft where id = 1')).rows[0] || null; }
  async saveDraft(data) {
    const json = JSON.stringify(data || {}); if (json.length > 400000) throw new HttpError(413, 'That draft is too big. Publish part of it first.');
    await pool.query('insert into draft (id, data, updated_at) values (1, $1, $2) on conflict (id) do update set data = $1, updated_at = $2', [json, Date.now()]);
    return { ok: true };
  }
  async discardDraft() { await pool.query('delete from draft where id = 1'); return { ok: true }; }
  async publishDraft() {
    const row = await this.getDraft(); const d = row?.data; if (!d) throw new HttpError(400, 'There is no draft to publish.');
    const n = { built: 0, moved: 0, demolished: 0, roads: 0, water: 0, vehicles: 0 }, skipped = [];
    const attempt = async (what, fn) => { try { await fn(); return true; } catch (e) { if (e instanceof HttpError) { skipped.push(`${what}: ${e.message}`); return false; } throw e; } };
    const split = m => { const set = {}, remove = []; for (const [k, v] of Object.entries(m || {})) { if (v) set[k] = v; else remove.push(k); } return { set, remove }; };
    const roads = split(d.roads), water = split(d.water);
    const name = id => (d.labels || {})[id] || 'a building'; // the client keeps a readable name for each building it touches
    await this.change(async ch => {
      ch.quiet = true;
      for (const id of d.demolish || []) if (await attempt(`demolish ${name(id)}`, () => this.demolish(id))) n.demolished++;
      for (const id of d.removeVehicles || []) if (await attempt('remove a vehicle', () => this.removeVehicle(id))) n.vehicles++;
      for (const [id, p] of Object.entries(d.moves || {})) if (await attempt(`move ${name(id)}`, () => this.move(id, p.x, p.y, p.rot))) n.moved++;
      if (water.remove.length) n.water += (await this.paintWater({ set: {}, remove: water.remove })).changed || 0;
      if (roads.remove.length) n.roads += (await this.paintRoads({ set: {}, remove: roads.remove })).changed || 0;
      for (const b of d.builds || []) if (await attempt(`build ${BUILDING_TYPES[b.type]?.name || b.type}`, () => this.build(b))) n.built++;
      if (Object.keys(water.set).length) n.water += (await this.paintWater({ set: water.set, remove: [] })).changed || 0;
      if (Object.keys(roads.set).length) n.roads += (await this.paintRoads({ set: roads.set, remove: [] })).changed || 0;
      for (const v of d.vehicles || []) if (await attempt(`add a ${VEHICLE_TYPES[v.type]?.name?.toLowerCase() || 'vehicle'}`, () => this.placeVehicle(v))) n.vehicles++;
      ch.quiet = false;
      const parts = [[n.built, 'new building'], [n.moved, 'building moved', 'buildings moved'], [n.demolished, 'building demolished', 'buildings demolished'], [n.roads, 'road tile'], [n.water, 'tile of water', 'tiles of water'], [n.vehicles, 'vehicle change']]
        .filter(([c]) => c).map(([c, one, many]) => `${fmt(c)} ${c === 1 ? one : (many || one + 's')}`);
      if (parts.length) await ch.event(`${ch.meta.name} update: ${parts.join(', ')}`, 'build');
      await ch.q('delete from draft where id = 1');
    });
    return { ...n, skipped };
  }

  // ---------- incoming comments ----------
  async recordComment({ id, username, text, mediaId, source, wantsSpawn }) {
    const r = await pool.query(`insert into comments (id, t, username, text, media_id, source, status) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
      [String(id), Date.now(), username, String(text || '').slice(0, 500), mediaId ? String(mediaId) : null, source, wantsSpawn ? 'pending' : 'stored']);
    return r.rowCount === 1; // false when the platform re-sends a comment we already have
  }
  // Takes up to `batch` waiting spawn comments and turns them into citizens in one change.
  async drainComments(batch = 1000) {
    const client = await pool.connect(); let rows;
    try {
      rows = (await client.query(`update comments set status = 'processing' where id in (
        select id from comments where status = 'pending' order by t limit $1 for update skip locked) returning id, username, source, text`, [batch])).rows;
    } finally { client.release(); }
    if (!rows.length) return 0;
    try {
      const genders = new Map(); for (const r of rows) { const g = R.genderFrom(r.text); if (g) genders.set(String(r.username).toLowerCase(), g); }
      if (this.meta) await this.spawnMany(rows.map(r => r.username), rows[0].source || 'instagram', genders);
      await pool.query(`update comments set status = 'done' where id = any($1)`, [rows.map(r => r.id)]);
    } catch (e) { await pool.query(`update comments set status = 'pending' where id = any($1)`, [rows.map(r => r.id)]); throw e; }
    return rows.length;
  }
  async buildRequests(limit = 200) {
    const media = this.meta?.buildPostId; if (!media) return [];
    return (await pool.query('select id, t, username, text from comments where media_id = $1 order by t desc limit $2', [media, limit])).rows;
  }
  async recentEvents(limit = 60) { return (await pool.query('select id, t, kind, text from events order by t desc limit $1', [limit])).rows; }
}
