// Colony events (see shared/events.js): the leader starts one every 2–4 real hours when none is running, announces it in
// the Colony Log and tells every screen; it ends by itself. The developer can start or end one any time.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import { COLONY_EVENTS } from '../shared/events.js';

const MIN = 60000, GAP_MIN = 120 * MIN, GAP_MAX = 240 * MIN;
const out = r => r && { id: r.id, kind: r.kind, ...COLONY_EVENTS[r.kind], start: Number(r.started_at), end: Number(r.ends_at), data: r.data || {} };

export class ColonyEvents {
  constructor(world, bus) { this.world = world; this.bus = bus; this.cache = { t: 0, v: null }; this.busy = false; this.bootAt = Date.now(); }
  async current(fresh = false) {
    if (!fresh && Date.now() - this.cache.t < 3000) return this.cache.v;
    const r = (await pool.query('select * from colony_events where not ended and ends_at > $1 order by started_at desc limit 1', [Date.now()])).rows[0];
    this.cache = { t: Date.now(), v: r ? out(r) : null }; return this.cache.v;
  }
  // The wait after an event, fixed per event (seeded by when it ended) so checking every minute doesn't shorten it.
  gapFor(endedAt) { const x = Math.abs(Math.sin(endedAt / 1000)) % 1; return GAP_MIN + x * (GAP_MAX - GAP_MIN); }
  async kindNow() { return (await this.current())?.kind || null; }
  async possible(kind) {
    const E = COLONY_EVENTS[kind]; if (!E) return false;
    if (E.needs === 'water') return (await pool.query('select 1 from water limit 1')).rowCount > 0;
    if (E.needs === 'landing') return (await pool.query("select 1 from buildings where type = 'landing' and done and not ruin limit 1")).rowCount > 0;
    return true;
  }
  async start(kind, mins) {
    const E = COLONY_EVENTS[kind]; if (!E) throw new HttpError(400, 'Unknown event.');
    if (!(await this.possible(kind))) throw new HttpError(409, E.needs === 'water' ? 'That needs water in the colony.' : 'That needs a landing station.');
    await this.end('replaced');
    const now = Date.now(), len = Math.max(1, Math.min(180, Number(mins) || E.mins)) * MIN, data = E.claims ? { left: E.claims, claimed: [] } : {};
    const r = await this.world.change(async ch => {
      if (kind === 'storm') { data.prevWeather = ch.meta.weather || null; ch.meta.weather = 'storm'; }
      const row = (await ch.q('insert into colony_events (kind, started_at, ends_at, data) values ($1, $2, $3, $4) returning *', [kind, now, now + len, JSON.stringify(data)])).rows[0];
      await ch.event(`${E.icon} ${E.name}! ${E.text} (${Math.round(len / MIN)} minutes)`, 'cevent');
      ch.extraOps.push({ op: 'cevent', data: out(row) });
      return row;
    });
    this.cache.t = 0; return out(r);
  }
  async end(why = 'over') {
    const rows = (await pool.query('update colony_events set ended = true where not ended returning *')).rows; if (!rows.length) return null;
    await this.world.change(async ch => {
      for (const r of rows) {
        if (r.kind === 'storm' && ch.meta.weather === 'storm') ch.meta.weather = r.data?.prevWeather || null;
        if (why === 'over') await ch.event(`${COLONY_EVENTS[r.kind]?.icon || ''} The ${COLONY_EVENTS[r.kind]?.name.toLowerCase() || 'event'} is over.`, 'cevent');
      }
      ch.extraOps.push({ op: 'cevent', data: null });
    });
    this.cache.t = 0; return rows.length;
  }
  // Leader, once a minute: end what's over, and start something new when it's been quiet long enough.
  async tick() {
    if (this.busy || !this.world.meta) return; this.busy = true;
    try {
      const due = (await pool.query('select 1 from colony_events where not ended and ends_at <= $1', [Date.now()])).rowCount;
      if (due) { await this.end('over'); return; }
      if (await this.current(true)) return;
      // Quiet for 2–4 hours since the last one (the very first comes 20 minutes after the server starts).
      const last = (await pool.query('select max(ends_at) t from colony_events')).rows[0].t;
      const since = Date.now() - (last ? Number(last) : this.bootAt), gap = last ? this.gapFor(Number(last)) : 20 * MIN;
      if (since < gap) return;
      const kinds = []; for (const k of Object.keys(COLONY_EVENTS)) if (await this.possible(k)) kinds.push(k);
      if (kinds.length) await this.start(kinds[crypto.randomInt(kinds.length)]);
    } finally { this.busy = false; }
  }
  // Supply drop: the first few colonists to claim get 100–300 coins from the treasury.
  async claimSupply(id, earn) {
    const ev = await this.current(true); if (!ev || ev.kind !== 'supply') throw new HttpError(409, 'There are no supplies to claim right now.');
    return this.world.change(async ch => {
      const r = (await ch.q('select * from colony_events where id = $1 for update', [ev.id])).rows[0], d = r.data || {};
      if ((d.claimed || []).includes(id)) throw new HttpError(409, "You've already claimed your share.");
      if (!(d.left > 0)) throw new HttpError(409, 'Too late! All the supplies have been claimed.');
      const { c } = await earn.lock(ch, id), want = 100 + crypto.randomInt(201);
      d.left--; d.claimed = [...(d.claimed || []), id]; await ch.q('update colony_events set data = $2 where id = $1', [r.id, JSON.stringify(d)]);
      const p = await earn.pay(ch, c, want, 'supplies', true);
      ch.extraOps.push({ op: 'cevent', data: { ...out({ ...r, data: d }) } });
      this.cache.t = 0; return { ok: true, ...p, coins: c.coins_base, left: d.left };
    });
  }
}
