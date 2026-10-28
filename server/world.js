import crypto from 'node:crypto';
import { pool, worldTx } from './db.js';
import { BUILDING_TYPES } from '../shared/catalog.js';
import * as R from '../shared/rules.js';

const uid = () => crypto.randomUUID();
const fmt = n => Math.round(n).toLocaleString('en-US');
export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// ---------- row shapes ----------
export const bRow = r => ({ id: r.id, type: r.type, x: r.x, y: r.y, cx: r.cx, cy: r.cy, name: r.name, requestedBy: r.requested_by,
  builtAt: r.built_at, builtDay: r.built_day, homeUsed: r.home_used, jobUsed: r.job_used, hangUsed: r.hang_used });
const chunksOfRow = c => [...new Set([[c.home_cx, c.home_cy], [c.job_cx, c.job_cy], [c.hang_cx, c.hang_cy]]
  .filter(([x]) => x !== null && x !== undefined).map(([x, y]) => R.chunkKey(x, y)))];

// The compact citizen record viewers receive. Coordinates travel with it so a viewer can draw a commute
// even when the workplace is in a part of the map they haven't loaded.
const CITIZEN_SELECT = `
  select c.id, c.seq, c.handle, c.joined_at, c.founder,
         c.home_cx, c.home_cy, c.job_cx, c.job_cy, c.hang_cx, c.hang_cy,
         h.id hid, h.type ht, h.x hx, h.y hy, j.id jid, j.type jt, j.x jx, j.y jy, g.id gid, g.type gt, g.x gx, g.y gy
  from citizens c
  left join buildings h on h.id = c.home_id left join buildings j on j.id = c.job_id left join buildings g on g.id = c.hang_id`;
export const cOut = r => ({ id: r.id, s: r.seq, h: r.handle, t: r.joined_at, f: r.founder ? 1 : 0,
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
    const e = { id: uid(), t: Date.now(), kind, text };
    await this.q('insert into events (id, t, kind, text) values ($1, $2, $3, $4)', [e.id, e.t, e.kind, e.text]);
    this.events.push(e);
  }

  async saveCitizen(c) {
    await this.q(`update citizens set home_id=$2, home_cx=$3, home_cy=$4, job_id=$5, job_cx=$6, job_cy=$7, hang_id=$8, hang_cx=$9, hang_cy=$10,
      coins_base=$11, coins_day=$12, net=$13 where id=$1`,
      [c.id, c.home_id, c.home_cx, c.home_cy, c.job_id, c.job_cx, c.job_cy, c.hang_id, c.hang_cx, c.hang_cy, c.coins_base, c.coins_day, c.net]);
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
    c.home_id = c.home_cx = c.home_cy = null; c.net = 0;
    this.meta.residents = Math.max(0, (this.meta.residents || 0) - 1);
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
        where c.home_id is not null and c.job_id is null order by c.seq limit 200 for update of c`)).rows;
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
  }
  slot(key) { let c = this.chunks.get(key); if (!c) this.chunks.set(key, c = { buildings: new Map(), roads: {} }); return c; }
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
    }
  }
  requireFounded() { if (!this.meta) throw new HttpError(409, 'Found the settlement first.'); }
  publicMeta() {
    if (!this.meta) return null;
    const m = this.meta; const pop = m.population || 0, res = m.residents || 0;
    return { ...m, outskirts: pop - res };
  }

  // Runs fn inside the world lock with a fresh copy of the meta row, then tells every server what changed.
  async change(fn, { allowUnfounded = false } = {}) {
    const result = await worldTx(async db => {
      const row = (await db.query('select data from meta where id = 1 for update')).rows[0];
      if (!row && !allowUnfounded) throw new HttpError(409, 'Found the settlement first.');
      const ch = new Change(db, row ? row.data : null);
      const r = await fn(ch);
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
    ops.push(...ch.roadOps);
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
    return { buildings: c ? [...c.buildings.values()] : [], roads: c ? { ...c.roads } : {} };
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
  async found({ name, handle }) {
    return this.change(async ch => {
      if (ch.meta) throw new HttpError(409, 'This settlement is already founded.');
      const now = Date.now(); name = String(name || '').trim().slice(0, 40) || 'Followville'; handle = R.cleanHandle(handle) || 'founder';
      ch.meta = { name, epoch: now - 7 * 60 * R.GAME_MIN_MS, createdAt: now, treasuryBase: R.START_FUNDS, treasuryDay: 0, income: R.GRANT,
        population: 0, residents: 0, employed: 0, newsDay: 0, buildPostId: null };
      ch.today = 0;
      const starter = [['tent', 0, 0, ''], ['campfire', 2, 1, 'The first fire'], ['tree', -3, -2], ['pine', 4, -3], ['birch', -2, 4], ['pine', 5, 3], ['tree', -4, 1], ['bush', 3, -1], ['rocks', -1, -3]];
      let i = 0; for (const [type, x, y, nm] of starter) await this.insertBuilding(ch, { type, x, y, name: nm || '', builtAt: now + i++ });
      await this.insertCitizens(ch, [handle], 'founder', true);
      await ch.event(`@${handle} founded ${name}`, 'found');
      await ch.fillVacancies();
      return { name, handle };
    }, { allowUnfounded: true });
  }

  async insertBuilding(ch, { id = uid(), type, x, y, name = '', requestedBy = '', builtAt = Date.now(), builtDay }) {
    const t = BUILDING_TYPES[type]; const [w, d] = t.size; const [cx, cy] = R.chunkOf(x, y); const cap = R.capacities(type);
    const r = await ch.q(`insert into buildings (id, type, x, y, w, d, cx, cy, name, requested_by, built_at, built_day, home_cap, job_cap, leisure, hang_cap)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
      [id, type, x, y, w, d, cx, cy, name, requestedBy, builtAt, builtDay ?? ch.today, cap.homeCap, cap.jobCap, cap.leisure, cap.hangCap]);
    ch.buildings.add(id);
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
    return r.rows[0];
  }

  // Adds people to the end of the housing queue in one statement, then lets the queue fill any empty homes.
  async insertCitizens(ch, handles, source, founder = false) {
    const seen = new Set(); const fresh = [];
    for (const h of handles) { const c = R.cleanHandle(h); if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); fresh.push(c); } }
    if (!fresh.length) return [];
    const taken = new Set((await ch.q('select lower(handle) h from citizens where lower(handle) = any($1)', [[...seen]])).rows.map(r => r.h));
    const add = fresh.filter(h => !taken.has(h.toLowerCase()));
    if (!add.length) return [];
    const now = Date.now(); const ids = add.map(() => uid());
    const rows = (await ch.q(`insert into citizens (id, handle, joined_at, founder, source, coins_base, coins_day)
      select id, handle, $3, $4, $5, $6, $7 from unnest($1::text[], $2::text[]) with ordinality as t(id, handle, ord) order by ord
      returning *`, [ids, add, now, founder, source, founder ? 50 : 20, ch.today])).rows;
    for (const c of rows) ch.citizens.set(c.id, []);
    ch.meta.population = (ch.meta.population || 0) + rows.length;
    return rows;
  }

  async build({ type, x, y, name = '', requestedBy = '', free = false }) {
    const t = BUILDING_TYPES[type]; if (!t) throw new HttpError(400, 'Unknown building type.');
    x = Math.trunc(Number(x)); y = Math.trunc(Number(y));
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100000 || Math.abs(y) > 100000) throw new HttpError(400, 'Bad position.');
    return this.change(async ch => {
      await this.assertFree(ch, type, x, y);
      ch.spend(t.cost || 0, free);
      const b = bRow(await this.insertBuilding(ch, { type, x, y, name: String(name).trim().slice(0, 40), requestedBy: R.cleanHandle(requestedBy) }));
      const nm = b.name || t.name;
      await ch.event(b.requestedBy ? `${nm} was built, requested by @${b.requestedBy}` : `${nm} was built`, 'build');
      await ch.fillVacancies();
      return { building: b };
    });
  }

  // Placement is checked against the database inside the lock, so two servers can't build on the same spot.
  async assertFree(ch, type, x, y, ignoreId = null) {
    const [w, d] = BUILDING_TYPES[type].size;
    const hit = await ch.q(`select 1 from buildings where id is distinct from $5::text and x < $1::int + $3::int and x + w > $1::int and y < $2::int + $4::int and y + d > $2::int limit 1`, [x, y, w, d, ignoreId]);
    const road = await ch.q('select 1 from roads where x >= $1::int and x < $1::int + $3::int and y >= $2::int and y < $2::int + $4::int limit 1', [x, y, w, d]);
    if (hit.rowCount || road.rowCount) throw new HttpError(409, 'That spot is taken. Pick an empty patch of grass.');
  }

  async demolish(id, { refund = false } = {}) {
    return this.change(async ch => {
      const b = (await ch.q('select * from buildings where id = $1 for update', [id])).rows[0];
      if (!b) throw new HttpError(404, 'No such building.');
      const t = BUILDING_TYPES[b.type] || {};
      const typeOfId = async bid => bid ? (await ch.q('select type from buildings where id = $1', [bid])).rows[0]?.type : null;
      // Workers lose this job; residents go back to the Outskirts (keeping their place at the front of the queue).
      for (const c of (await ch.q('select c.*, h.type htype from citizens c left join buildings h on h.id = c.home_id where c.job_id = $1 for update of c', [id])).rows) {
        const homeType = c.htype; delete c.htype; await ch.leaveJob(c, b.type, homeType); await ch.saveCitizen(c); }
      for (const c of (await ch.q('select * from citizens where home_id = $1 for update', [id])).rows) await ch.moveOut(c, { home: b.type, job: await typeOfId(c.job_id) });
      if (b.leisure) {
        const rows = (await ch.q('select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where c.hang_id = $1 for update of c', [id])).rows;
        for (const c of rows) {
          const { hx, hy } = c; delete c.hx; delete c.hy;
          c.hang_id = null; ch.touch({ ...c, hang_cx: b.cx, hang_cy: b.cy });
          await ch.setHangout(c, hx === null ? null : await ch.nearestLeisure(hx, hy, id)); await ch.saveCitizen(c);
        }
      }
      await ch.q('delete from buildings where id = $1', [id]);
      ch.buildings.delete(id); ch.removedBuildings.set(id, R.chunkKey(b.cx, b.cy));
      if (refund) ch.refund(t.cost || 0);
      await ch.event(`${b.name || t.name || 'A building'} was demolished`, 'demolish');
      await ch.fillVacancies();
      return { ok: true };
    });
  }

  async restore(b) {
    if (!b || !BUILDING_TYPES[b.type]) throw new HttpError(400, 'Nothing to restore.');
    return this.change(async ch => {
      if ((await ch.q('select 1 from buildings where id = $1', [String(b.id)])).rowCount) throw new HttpError(400, 'Nothing to restore.');
      const x = Math.trunc(b.x), y = Math.trunc(b.y);
      await this.assertFree(ch, b.type, x, y);
      const row = await this.insertBuilding(ch, { id: String(b.id), type: b.type, x, y, name: String(b.name || '').slice(0, 40), requestedBy: R.cleanHandle(b.requestedBy),
        builtAt: Number(b.builtAt) || Date.now(), builtDay: Number(b.builtDay) || 0 });
      await ch.event(`${row.name || BUILDING_TYPES[b.type].name} was rebuilt`, 'build');
      await ch.fillVacancies();
      return { ok: true };
    });
  }

  async move(id, x, y) {
    x = Math.trunc(Number(x)); y = Math.trunc(Number(y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new HttpError(400, 'Bad position.');
    return this.change(async ch => {
      const b = (await ch.q('select * from buildings where id = $1 for update', [id])).rows[0];
      if (!b) throw new HttpError(404, 'No such building.');
      await this.assertFree(ch, b.type, x, y, id);
      const [cx, cy] = R.chunkOf(x, y);
      if (cx !== b.cx || cy !== b.cy) ch.removedBuildings.set(id, R.chunkKey(b.cx, b.cy));
      await ch.q('update buildings set x = $2, y = $3, cx = $4, cy = $5 where id = $1', [id, x, y, cx, cy]);
      ch.buildings.add(id);
      for (const [col, cxc, cyc] of [['home_id', 'home_cx', 'home_cy'], ['job_id', 'job_cx', 'job_cy'], ['hang_id', 'hang_cx', 'hang_cy']]) {
        const rows = (await ch.q(`select * from citizens where ${col} = $1`, [id])).rows;
        for (const c of rows) ch.touch(c);
        if (rows.length) await ch.q(`update citizens set ${cxc} = $2, ${cyc} = $3 where ${col} = $1`, [id, cx, cy]);
      }
      return { ok: true };
    });
  }

  async paintRoads({ set = {}, remove = [], free = false }) {
    return this.change(async ch => {
      const keys = Object.keys(set).filter(k => /^-?\d+,-?\d+$/.test(k) && R.isRoadType(set[k])).slice(0, 5000);
      const toSet = {}; let cost = 0;
      if (keys.length) {
        const xs = keys.map(k => +k.split(',')[0]), ys = keys.map(k => +k.split(',')[1]);
        // Tiles under solid buildings are skipped; tiles that already have the same road cost nothing.
        const solid = new Set((await ch.q(`select t.x || ',' || t.y k, b.type from unnest($1::int[], $2::int[]) t(x, y)
          join buildings b on t.x >= b.x and t.x < b.x + b.w and t.y >= b.y and t.y < b.y + b.d`, [xs, ys])).rows
          .filter(r => !BUILDING_TYPES[r.type]?.outdoor).map(r => r.k));
        const existing = new Map((await ch.q('select x || \',\' || y k, type from roads where (x, y) in (select * from unnest($1::int[], $2::int[]))', [xs, ys])).rows.map(r => [r.k, r.type]));
        for (const k of keys) { if (solid.has(k) || existing.get(k) === set[k]) continue; toSet[k] = set[k]; cost += R.roadCost(set[k]); }
      }
      const rm = remove.filter(k => /^-?\d+,-?\d+$/.test(k)).slice(0, 5000);
      let removed = [];
      if (rm.length) removed = (await ch.q('delete from roads where (x, y) in (select * from unnest($1::int[], $2::int[])) returning x, y',
        [rm.map(k => +k.split(',')[0]), rm.map(k => +k.split(',')[1])])).rows.map(r => `${r.x},${r.y}`);
      const n = Object.keys(toSet).length;
      if (!n && !removed.length) return { changed: 0, cost: 0 };
      ch.spend(cost, free);
      if (n) {
        const ks = Object.keys(toSet); const xs = ks.map(k => +k.split(',')[0]), ys = ks.map(k => +k.split(',')[1]);
        await ch.q(`insert into roads (x, y, type, cx, cy) select x, y, t, floor(x::float / ${R.CHUNK})::int, floor(y::float / ${R.CHUNK})::int
          from unnest($1::int[], $2::int[], $3::text[]) u(x, y, t) on conflict (x, y) do update set type = excluded.type`, [xs, ys, ks.map(k => toSet[k])]);
      }
      // One road op per chunk so viewers only hear about roads they can see.
      const by = new Map(); const slot = k => { const [x, y] = k.split(',').map(Number); const ck = R.chunkKeyOfTile(x, y); if (!by.has(ck)) by.set(ck, { set: {}, remove: [] }); return by.get(ck); };
      for (const k in toSet) slot(k).set[k] = toSet[k];
      for (const k of removed) slot(k).remove.push(k);
      for (const [ck, o] of by) ch.roadOps.push({ op: 'roads', set: o.set, remove: o.remove, chunks: [ck] });
      return { changed: n + removed.length, cost: free ? 0 : cost };
    });
  }

  async spawn(handle, source = 'manual') {
    const h = R.cleanHandle(handle); if (!h) throw new HttpError(400, 'Type a username first.');
    return this.change(async ch => {
      const rows = await this.insertCitizens(ch, [h], source);
      if (!rows.length) throw new HttpError(409, `@${h} already lives here.`);
      await ch.fillVacancies();
      const housed = (await ch.q('select home_id from citizens where id = $1', [rows[0].id])).rows[0].home_id;
      if (!housed) await ch.event(`@${h} arrived and is waiting in the Outskirts`, 'spawn');
      return { citizen: { id: rows[0].id, handle: h, housed: !!housed } };
    });
  }

  // Many arrivals in one change: used by the comment queue during viral moments.
  async spawnMany(handles, source) {
    return this.change(async ch => {
      const rows = await this.insertCitizens(ch, handles, source);
      if (!rows.length) return { added: 0 };
      const { moved } = await ch.fillVacancies();
      const waiting = rows.length - Math.min(rows.length, moved);
      if (waiting === 1 && rows.length === 1) await ch.event(`@${rows[0].handle} arrived and is waiting in the Outskirts`, 'spawn');
      else if (waiting > 0) await ch.event(`${fmt(rows.length)} new followers arrived. ${fmt(ch.meta.population - ch.meta.residents)} are waiting in the Outskirts`, 'spawn');
      return { added: rows.length };
    });
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

  async setBuildPost(mediaId) {
    return this.change(async ch => { ch.meta.buildPostId = mediaId ? String(mediaId) : null; return { ok: true }; });
  }

  // ---------- the clock ----------
  // Paydays need no work (balances are formulas). The clock only writes the daily headline and
  // finishes any queue work a busy moment left over.
  async tick() {
    if (!this.meta) return { days: 0 };
    const today = R.gameDay(Date.now(), this.meta.epoch);
    const pending = this.meta.population > this.meta.residents && (await pool.query('select 1 from buildings where home_used < home_cap limit 1')).rowCount;
    if (today <= (this.meta.newsDay ?? 0) && !pending) return { days: 0 };
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
        select id from comments where status = 'pending' order by t limit $1 for update skip locked) returning id, username, source`, [batch])).rows;
    } finally { client.release(); }
    if (!rows.length) return 0;
    try {
      if (this.meta) await this.spawnMany(rows.map(r => r.username), rows[0].source || 'instagram');
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
