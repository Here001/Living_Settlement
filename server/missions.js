// Missions out in the 3D town (shared/missions.js has the ladder and the numbers). The server plans each one from the
// real town (buildings with a road beside them, near where you are) and checks every stop against where your car
// really is: each player's position comes in from the 3D view a few times a second (index.js keeps the latest in LIVE),
// so a stop only counts if you're truly there, and no sooner than a car could have got there.
// A colonist's missions live in citizens.missions: { xp, day, paid (today), active, last (quit time), seen (rank) }.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { BUILDING_TYPES, ROAD_TYPES } from '../shared/catalog.js';
import * as M from '../shared/missions.js';

export const LIVE = new Map(); // player id → { x, y, mode, t }: where they are in the 3D town right now
const day = () => Math.floor(Date.now() / 86400000), FRESH = 15000;
const DRIVE = Object.keys(ROAD_TYPES).filter(k => !ROAD_TYPES[k].nocars); /* the roads a car can drive on */
const Q = (db, sql, args) => (db.q ? db.q(sql, args) : db.query(sql, args)); /* (a change's own connection, or the pool) */
const nameOf = b => b.name || BUILDING_TYPES[b.type]?.name || 'a building';

export class Missions {
  constructor(world) { this.world = world; }
  stateOf(c) { const m = { xp: 0, ...(c.missions || {}) }; if (m.day !== day()) { m.day = day(); m.paid = 0; } return m; }
  async save(db, c, m) { c.missions = m; await Q(db, 'update citizens set missions = $2 where id = $1', [c.id, JSON.stringify(m)]); }
  // players who already pulled off crimes and heists before missions came in keep doing them: they start at Operator
  async seed(db, c, m) { if (m.seeded) return false; m.seeded = 1;
    const n = Number((await Q(db, 'select count(*) n from crime_runs where citizen_id = $1 and not practice', [c.id])).rows[0].n); if (n > 0) m.xp = Math.max(m.xp, M.RANKS[3].xp);
    m.seen = M.rankOf(m.xp); return true; }
  pos(id) { const p = LIVE.get(id); return p && Date.now() - p.t < FRESH ? p : null; }
  // what the Missions app shows
  view(m) { const pr = M.rankProgress(m.xp), now = Date.now();
    return { xp: m.xp, rank: pr.rank, nextXp: pr.next, frac: pr.frac, ranks: M.RANKS, paidLeft: Math.max(0, M.MISSION.perDay - (m.paid || 0)),
      list: M.MISSION_IDS.map(k => ({ kind: k, ...M.MISSIONS[k], open: M.openAt(k, m.xp) })), active: m.active && now <= m.active.deadline ? this.pub(m.active) : null }; }
  pub(a) { return { id: a.id, kind: a.kind, step: a.step, steps: a.steps.map(s => ({ k: s.k, name: s.name, x: s.x, y: s.y, w: s.w, h: s.h, bid: s.bid, kx: s.kx, ky: s.ky })), start: a.start, deadline: a.deadline, fare: a.fare, xp: a.xp, line: a.line }; }
  async info(id) { const c = (await pool.query('select id, missions from citizens where id = $1', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
    const m = this.stateOf(c); if (await this.seed(pool, c, m)) await this.save(pool, c, m); return this.view(m); }

  // ---------- planning ----------
  // buildings a car can pull up beside (a road within a couple of tiles), between min and max tiles from p
  async spots(db, p, min, max, { work = false, not = [] } = {}) {
    const rows = (await Q(db, `select b.id, b.type, b.name, b.x, b.y, b.level, b.rot,
        array(select array[r.x, r.y] from roads r where r.type = any($5) and r.x between b.x - 2 and b.x + 7 and r.y between b.y - 2 and b.y + 7) near
      from buildings b where b.done and not b.ruin and abs(b.x - $1::int) + abs(b.y - $2::int) between $3 and $4
      order by random() limit 40`, [Math.round(p.x), Math.round(p.y), min, max, DRIVE])).rows;
    const out = [];
    for (const b of rows) { if (!R.canGoTo(b.type) || not.includes(b.id) || (work && BUILDING_TYPES[b.type].home)) continue;
      const [w, h] = R.footprint(R.levelSize(b.type, b.level || 1), b.rot), f = { x: b.x, y: b.y, w, h }; let kerb = null, kd = 9;
      for (const [x, y] of b.near || []) { const d = M.offEdge({ x: x + 0.5, y: y + 0.5 }, f); if (d > 0 && d < kd) { kd = d; kerb = { kx: x, ky: y }; } }
      if (kerb && kd <= 2) out.push({ bid: b.id, name: nameOf(b), x: b.x, y: b.y, w, h, type: b.type, ...kerb }); } /* (a road right beside it, to pull up on) */
    return out; }
  async plan(db, p, kind) {
    const one = async (from, a, b, o) => { for (const [lo, hi] of [[a, b], [Math.max(2, a - 4), b + 20], [2, b + 60]]) { const s = (await this.spots(db, from, lo, hi, o))[0]; if (s) return s; } return null; };
    const steps = [];
    if (kind === 'taxi') { const pick = await one(p, 3, 22); if (!pick) return null; const drop = await one(pick, 16, 60, { not: [pick.bid] }); if (!drop) return null; steps.push({ k: 'pickup', ...pick }, { k: 'drop', ...drop }); }
    else { const pick = await one(p, 3, 22, { work: true }) || await one(p, 3, 22); if (!pick) return null; const d1 = await one(pick, 12, 45, { not: [pick.bid] }); if (!d1) return null;
      steps.push({ k: 'pickup', ...pick }, { k: 'drop', ...d1 });
      if (crypto.randomInt(2)) { const d2 = await one(d1, 8, 30, { not: [pick.bid, d1.bid] }); if (d2) steps.push({ k: 'drop', ...d2 }); } }
    let tiles = 0, at = p; for (const s of steps) { tiles += M.dist(at, s); at = s; }
    const paid = steps.slice(1).reduce((t, s, i) => t + M.dist(steps[i], s), 0); /* (the fare counts the trip itself, not the drive to the first stop) */
    return { steps, tiles, fare: M.missionPay(kind, paid), xp: M.missionXp(kind, paid), secs: M.missionTime(tiles) };
  }

  // ---------- doing them ----------
  async start(id, kind) {
    if (!M.MISSIONS[kind]) throw new HttpError(400, 'No such mission.');
    return this.world.personal(async ch => {
      const { c } = await this.world.earn.lock(ch, id, false), m = this.stateOf(c); await this.seed(ch, c, m); const now = Date.now();
      if (!M.MISSIONS[kind].live) throw new HttpError(409, `${M.MISSIONS[kind].name} is coming soon.`);
      if (!M.openAt(kind, m.xp)) throw new HttpError(403, `${M.MISSIONS[kind].name} opens when you reach ${M.RANKS[M.MISSIONS[kind].rank].name}.`);
      if (m.active && now <= m.active.deadline) throw new HttpError(409, `You're already on a ${M.MISSIONS[m.active.kind].name.toLowerCase()}. Finish it or give it up first.`);
      if (m.last && now - m.last < M.MISSION.quitCooldown) throw new HttpError(429, 'Give it a moment before taking the next one.');
      const p = this.pos(id); if (!p) throw new HttpError(409, 'Go out on the street first (🚗 Drive): missions happen in the town.');
      if (p.mode !== 'car') throw new HttpError(409, 'You need to be driving for this one. Get in a car first.');
      const P = await this.plan(ch, p, kind); if (!P) throw new HttpError(409, 'Nothing nearby to do just now. Drive somewhere busier and try again.');
      m.active = { id: crypto.randomUUID().slice(0, 8), kind, steps: P.steps, step: 0, start: now, deadline: now + P.secs * 1000, fare: P.fare, xp: P.xp, at: now, from: { x: p.x, y: p.y }, line: crypto.randomInt(M.FARES.length) };
      await this.save(ch, c, m); return { ok: true, active: this.pub(m.active), ...this.view(m) };
    });
  }
  // you've pulled up at the next stop: the server checks you really are there, and in time
  async arrive(id) {
    return this.world.personal(async ch => {
      const { c } = await this.world.earn.lock(ch, id, false), m = this.stateOf(c), a = m.active, now = Date.now();
      if (!a) throw new HttpError(409, 'You aren\'t on a mission.');
      if (now > a.deadline) { m.active = null; m.last = now; await this.save(ch, c, m); return { ok: false, failed: 'time', ...this.view(m) }; }
      const p = this.pos(id), s = a.steps[a.step]; if (!p) throw new HttpError(409, 'Where are you? Go back out on the street.');
      if (!M.atStop(p, s)) throw new HttpError(409, `You're not at ${s.name} yet.`);
      if (now - a.at < M.dist(a.from, s) / M.MISSION.fastest * 1000) throw new HttpError(409, 'That was quicker than any car could get there.');
      a.step++; a.at = now; a.from = { x: s.x, y: s.y };
      if (a.step < a.steps.length) { await this.save(ch, c, m); return { ok: true, next: true, active: this.pub(a), ...this.view(m) }; }
      // done: the fare, a tip for the time to spare, and XP (which may move you up a rank and open something new)
      const left = (a.deadline - now) / (a.deadline - a.start), tip = M.tipOf(a.fare, left), before = M.rankOf(m.xp); m.active = null; m.last = 0; m.done = (m.done || 0) + 1;
      let paid = 0, short = false; if ((m.paid || 0) < M.MISSION.perDay) { const r = await this.world.earn.pay(ch, c, a.fare + tip, 'missions'); paid = r.paid; short = r.short; m.paid = (m.paid || 0) + 1; }
      m.xp += a.xp; const after = M.rankOf(m.xp); await this.save(ch, c, m);
      if (paid >= 300) await ch.event(`${M.MISSIONS[a.kind].icon} @${c.handle} finished a ${M.MISSIONS[a.kind].name.toLowerCase()} for ${paid.toLocaleString('en-US')} coins.`, 'gig');
      return { ok: true, done: true, kind: a.kind, fare: a.fare, tip, paid, short, xpGot: a.xp, coins: c.coins_base,
        rankUp: after > before ? { rank: after, ...M.RANKS[after], unlocks: M.unlocksAt(after).map(k => ({ kind: k, ...M.MISSIONS[k] })) } : null, ...this.view(m) };
    });
  }
  async quit(id) {
    return this.world.personal(async ch => { const { c } = await this.world.earn.lock(ch, id, false), m = this.stateOf(c); if (m.active) { m.active = null; m.last = Date.now(); } await this.save(ch, c, m); return { ok: true, ...this.view(m) }; });
  }
}
