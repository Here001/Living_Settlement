// Missions out in the 3D town (shared/missions.js has the ladder and the numbers). The server plans each one from the
// real town (buildings with a road beside them, near where you are) and checks every stop against where your car
// really is: each player's position comes in from the 3D view a few times a second (index.js keeps the latest in LIVE),
// so a stop only counts if you're truly there, and no sooner than a car could have got there.
// A colonist's missions live in citizens.missions: { xp, day, paid (today), active, last (quit time), seen (rank) }.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { BUILDING_TYPES, ROAD_TYPES, BANK_TYPES } from '../shared/catalog.js';
import * as M from '../shared/missions.js';
import { track } from './stats.js';

export const LIVE = new Map(); // player id → { x, y, mode, t }: where they are in the 3D town right now
const day = () => Math.floor(Date.now() / 86400000), FRESH = 15000;
const SHOPS = Object.keys(BUILDING_TYPES).filter(k => BUILDING_TYPES[k].cat === 'shops' && k !== 'cardealer'); /* (the shops the robbery game can be set in) */
const CHOP = ['garage', 'workshop', 'warehouse', 'factory', 'carplant', 'canalwarehouses', 'busdepot']; /* where a stolen car gets taken apart */
const DRIVE = Object.keys(ROAD_TYPES).filter(k => !ROAD_TYPES[k].nocars); /* the roads a car can drive on */
const Q = (db, sql, args) => (db.q ? db.q(sql, args) : db.query(sql, args)); /* (a change's own connection, or the pool) */
const nameOf = b => b.name || BUILDING_TYPES[b.type]?.name || 'a building';

export class Missions {
  constructor(world) { this.world = world; }
  stateOf(c) { const m = { xp: 0, ...(c.missions || {}) }; if (m.day !== day()) { m.day = day(); m.paid = 0; m.goals = null; m.bonus = 0; }
    if (!m.goals) this.goals(c, m); return m; }
  goals(c, m) { let h = day(); for (const ch of String(c.id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; m.goals = M.dailyGoals(h, m.xp); } /* (the same three for a player all day) */
  async save(db, c, m) { c.missions = m; await Q(db, 'update citizens set missions = $2 where id = $1', [c.id, JSON.stringify(m)]); }
  // players who already pulled off crimes and heists before missions came in keep doing them: they start at Operator
  async seed(db, c, m) { if (m.seeded) return false; m.seeded = 1;
    const n = Number((await Q(db, 'select count(*) n from crime_runs where citizen_id = $1 and not practice', [c.id])).rows[0].n); if (n > 0) m.xp = Math.max(m.xp, M.RANKS[3].xp);
    m.seen = M.rankOf(m.xp); this.goals(c, m); return true; }
  pos(id) { const p = LIVE.get(id); return p && Date.now() - p.t < FRESH ? p : null; }
  // what the Missions app shows
  view(m) { const pr = M.rankProgress(m.xp), now = Date.now(), D = this.drop && now < this.drop.until ? this.drop : null;
    return { bounties: this.board || [], drop: D ? { id: D.id, x: D.x, y: D.y, amount: D.amount, until: D.until } : null, goals: (m.goals || []).map(g => ({ ...g, text: M.goalText(g), done: g.got >= g.need })), bonus: m.bonus ? 0 : M.dailyBonus(pr.rank), bonusGot: !!m.bonus, xp: m.xp, rank: pr.rank, nextXp: pr.next, frac: pr.frac, ranks: M.RANKS, paidLeft: Math.max(0, M.MISSION.perDay - (m.paid || 0)),
      list: M.MISSION_IDS.map(k => ({ kind: k, ...M.MISSIONS[k], open: M.openAt(k, m.xp) })), active: m.active && now <= m.active.deadline ? this.pub(m.active) : null }; }
  pub(a) { return { id: a.id, kind: a.kind, step: a.step, steps: a.steps.map(s => ({ k: s.k, name: s.name, x: s.x, y: s.y, w: s.w, h: s.h, bid: s.bid, kx: s.kx, ky: s.ky, need: s.need, car: s.car, game: s.game, getaway: s.getaway, target: s.target })), play: !!a.play, patrol: !!a.patrol, start: a.start, deadline: a.deadline, fare: a.fare, xp: a.xp, line: a.line, times: a.times }; }
  async info(id) { const c = (await pool.query('select id, missions from citizens where id = $1', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.'); await this.loadBoard(); this.dropTick();
    const fresh = !c.missions || !c.missions.goals || c.missions.day !== day(), m = this.stateOf(c); if ((await this.seed(pool, c, m)) || fresh) await this.save(pool, c, m); return this.view(m); }

  // ---------- the wanted, the board, the cash drop ----------
  // players on the run right now: driving a hot car or getting away from a hold-up, out on the street
  async wanted(db, not) { const rows = (await Q(db, "select id, handle, missions->'active' a from citizens where missions->'active'->>'kind' = any($1) and id <> $2", [['hotcar', 'holdup'], not])).rows;
    return rows.map(r => { const a = r.a, s = a && a.steps && a.steps[a.step], p = this.pos(r.id); return s && s.k === 'drop' && s.need === 'car' && p && p.mode === 'car' && Date.now() <= a.deadline ? { id: r.id, handle: r.handle, aid: a.id, x: p.x, y: p.y } : null; }).filter(Boolean); }
  // the bounties up (the ten biggest), refreshed at most every few seconds
  async loadBoard(force = false) { if (!force && this.boardAt && Date.now() - this.boardAt < 5000) return this.board; this.boardAt = Date.now();
    this.board = (await pool.query('select id, target_id, target_handle, by_handle, amount, t from bounties where claimed_by is null order by amount desc, t limit 10')).rows.map(b => ({ id: b.id, target: b.target_id, handle: b.target_handle, by: b.by_handle, amount: b.amount, t: Number(b.t), out: !!this.pos(b.target_id) })); return this.board; }
  async placeBounty(id, handle, amount) { amount = Math.round(Number(amount) || 0); const B0 = M.MISSION.bounty;
    if (!(amount >= B0.min && amount <= B0.max)) throw new HttpError(400, `A bounty is ${B0.min.toLocaleString('en-US')} to ${B0.max.toLocaleString('en-US')} coins.`);
    return this.world.personal(async ch => { const { c } = await this.world.earn.lock(ch, id, false), t = (await Q(ch, 'select id, handle from citizens where lower(handle) = lower($1)', [String(handle || '').replace(/^@/, '')])).rows[0];
      if (!t) throw new HttpError(404, 'No one by that name.'); if (t.id === c.id) throw new HttpError(400, 'Not on yourself.');
      if (c.coins_base < amount) throw new HttpError(409, 'You don\'t have that much on you.');
      c.coins_base -= amount; track(ch, 'bounty:place', amount, c.id); ch.touch(c); await ch.saveCitizen(c);
      await Q(ch, 'insert into bounties (id, target_id, target_handle, by_id, by_handle, amount, t) values ($1, $2, $3, $4, $5, $6, $7)', [crypto.randomUUID(), t.id, t.handle, c.id, c.handle, amount, Date.now()]);
      await this.world.actions.notify(ch, t.id, 'crime', `🎯 Someone put a ${amount.toLocaleString('en-US')}-coin bounty on you. Watch your back out in town.`);
      await ch.event(`🎯 A ${amount.toLocaleString('en-US')}-coin bounty is up on @${t.handle}.`, 'crime'); this.boardAt = 0; return { ok: true, coins: c.coins_base }; }); }
  // a cash drop somewhere near the people out in town: one at a time, every so often, gone if no one gets there
  dropTick() { const now = Date.now(), D0 = M.MISSION.drop; if (this.drop && now >= this.drop.until) { this.drop = null; this.nextDrop = now + 60000 * (D0.every[0] + Math.random() * (D0.every[1] - D0.every[0])); }
    if (this.drop || this.dropping) return; if (!this.nextDrop) { this.nextDrop = now + 60000 * D0.every[0]; return; } if (now < this.nextDrop) return;
    const out = [...LIVE].filter(([, p]) => now - p.t < FRESH); if (!out.length) return; const [, p] = out[crypto.randomInt(out.length)]; this.dropping = true;
    this.roads(pool, p, 30).then(set => { const near = [...set].filter(k => { const [x, y] = k.split(',').map(Number), d = Math.abs(x - p.x) + Math.abs(y - p.y); return d >= 8 && d <= 30; });
      if (near.length) { const [x, y] = near[crypto.randomInt(near.length)].split(',').map(Number); this.drop = { id: crypto.randomUUID().slice(0, 8), x: x + 0.5, y: y + 0.5, amount: D0.amount[0] + crypto.randomInt(D0.amount[1] - D0.amount[0] + 1), until: now + D0.life * 60000 }; }
      else this.nextDrop = now + 60000; }).catch(() => {}).finally(() => { this.dropping = false; }); }
  async grab(id) { const D = this.drop, now = Date.now(); if (!D || now >= D.until) throw new HttpError(409, 'Someone got there first.'); const p = this.pos(id);
    if (!p || Math.hypot(p.x - D.x, p.y - D.y) > M.MISSION.drop.grab) throw new HttpError(409, 'Not close enough yet.');
    this.drop = null; const D0 = M.MISSION.drop; this.nextDrop = now + 60000 * (D0.every[0] + Math.random() * (D0.every[1] - D0.every[0]));
    return this.world.personal(async ch => { const { c } = await this.world.earn.lock(ch, id, false), r = await this.world.earn.pay(ch, c, D.amount, 'missions', true);
      await ch.event(`💰 @${c.handle} grabbed a cash drop: ${r.paid.toLocaleString('en-US')} coins.`, 'gig'); return { ok: true, paid: r.paid, coins: c.coins_base }; }); }

  // ---------- planning ----------
  // buildings a car can pull up beside (a road within a couple of tiles), between min and max tiles from p
  async spots(db, p, min, max, { work = false, not = [], only = null } = {}) {
    const rows = (await Q(db, `select b.id, b.type, b.name, b.x, b.y, b.level, b.rot,
        array(select array[r.x, r.y] from roads r where r.type = any($5) and r.x between b.x - 2 and b.x + 7 and r.y between b.y - 2 and b.y + 7) near
      from buildings b where b.done and not b.ruin and abs(b.x - $1::int) + abs(b.y - $2::int) between $3 and $4
      order by random() limit 40`, [Math.round(p.x), Math.round(p.y), min, max, DRIVE])).rows;
    const out = [];
    for (const b of rows) { if (!R.canGoTo(b.type) || not.includes(b.id) || (work && BUILDING_TYPES[b.type].home) || (only && !only.includes(b.type))) continue;
      const [w, h] = R.footprint(R.levelSize(b.type, b.level || 1), b.rot), f = { x: b.x, y: b.y, w, h }; let kerb = null, kd = 9;
      for (const [x, y] of b.near || []) { const d = M.offEdge({ x: x + 0.5, y: y + 0.5 }, f); if (d > 0 && d < kd) { kd = d; kerb = { kx: x, ky: y }; } }
      if (kerb && kd <= 2) out.push({ bid: b.id, name: nameOf(b), x: b.x, y: b.y, w, h, type: b.type, ...kerb }); } /* (a road right beside it, to pull up on) */
    return out; }
  // the drivable road tiles round p (within R), and how far each is from a start tile along the roads
  async roads(db, p, R) { const px = Math.round(p.x), py = Math.round(p.y);
    return new Set((await Q(db, 'select x, y from roads where type = any($3) and x between $1::int - $4 and $1::int + $4 and y between $2::int - $4 and $2::int + $4', [px, py, DRIVE, R])).rows.map(r => r.x + ',' + r.y)); }
  bfs(set, from) { const d = new Map([[from, 0]]), q = [from]; for (let i = 0; i < q.length; i++) { const [x, y] = q[i].split(',').map(Number), n = d.get(q[i]);
      for (const k of [(x + 1) + ',' + y, (x - 1) + ',' + y, x + ',' + (y + 1), x + ',' + (y - 1)]) if (set.has(k) && !d.has(k)) { d.set(k, n + 1); q.push(k); } } return d; }
  nearestRoad(set, p) { let best = null, bd = 4; for (const k of set) { const [x, y] = k.split(',').map(Number), d = Math.abs(x + 0.5 - p.x) + Math.abs(y + 0.5 - p.y); if (d < bd) { bd = d; best = k; } } return best; }
  // a street race: checkpoints one after another along the roads round you, each a good stretch from the last
  async racePlan(db, p) { const set = await this.roads(db, p, 60), start = this.nearestRoad(set, p); if (!start) return null;
    const RC = M.MISSION.race, cps = []; let cur = start, D = 0;
    for (let i = 0; i < RC.checkpoints; i++) { const d = this.bfs(set, cur); let ok = [];
      for (const [lo, hi, gap] of [[RC.leg[0], RC.leg[1], 6], [RC.leg[0], RC.leg[1], 3], [6, 26, 2]]) { /* (a small town: shorter legs, closer together) */
        ok = [...d].filter(([k, n]) => n >= lo && n <= hi && [start, ...cps].every(c => { const [a, b] = c.split(','), [x, y] = k.split(','); return Math.abs(a - x) + Math.abs(b - y) > gap; })) .concat([]); if (ok.length) break; }
      if (!ok.length) { if (i < 3) return null; break; } const [k, n] = ok[crypto.randomInt(ok.length)]; cps.push(k); D += n; cur = k; }
    const steps = cps.map((k, i) => { const [x, y] = k.split(',').map(Number); return { k: 'cp', name: i === cps.length - 1 ? 'the finish' : `checkpoint ${i + 1}`, x, y, w: 1, h: 1, kx: x, ky: y }; });
    const times = M.raceTimes(D); return { steps, tiles: D, times, fare: Math.min(RC.pay.max, Math.round(RC.pay.base + RC.pay.perTile * D)), xp: Math.round(RC.xp.base + RC.xp.perTile * D), secs: times.bronze }; }
  // a hot car: a parked car a walk away (you take it on foot), then the chop shop across town
  async hotPlan(db, p) { const set = await this.roads(db, p, 30), H0 = M.MISSION.hotcar, near = [...set].filter(k => { const [x, y] = k.split(',').map(Number), d = Math.abs(x - p.x) + Math.abs(y - p.y); return d >= 5 && d <= 22; });
    if (!near.length) return null; const [x, y] = near[crypto.randomInt(near.length)].split(',').map(Number), steal = { k: 'steal', name: 'the parked car', x, y, w: 1, h: 1, kx: x, ky: y, need: 'walk', car: { m: H0.cars[crypto.randomInt(H0.cars.length)], col: ['#C8382E', '#1F1F24', '#E2B13C', '#2F4A7A', '#F4F4F0', '#1E7A55'][crypto.randomInt(6)] } };
    const one = async (a, b, o) => { for (const [lo, hi] of [[a, b], [8, b + 40]]) { const s = (await this.spots(db, steal, lo, hi, o))[0]; if (s) return s; } return null; };
    const chop = await one(15, 60, { only: CHOP }) || await one(15, 60, { work: true }); if (!chop) return null;
    const trip = M.dist(steal, chop); return { steps: [steal, { k: 'drop', ...chop, need: 'car', chop: true }], tiles: M.dist(p, steal) + trip,
      fare: Math.min(H0.pay.max, Math.round(H0.pay.base + H0.pay.perTile * trip)), xp: Math.round(H0.xp.base + H0.xp.perTile * trip), secs: Math.round(45 + 2.2 * M.dist(p, steal) + M.MISSION.time.perTile * trip) }; }
  // a crime: the store (then a getaway to a hideout), the tourist or the ATM; you walk up to it and play its game there
  async gamePlan(db, p, kind) { const G = M.MISSION.game[kind], game = M.GAME_OF[kind];
    const one = async (from, a, b, o) => { for (const [lo, hi] of [[a, b], [2, b + 40]]) { const s = (await this.spots(db, from, lo, hi, o))[0]; if (s) return s; } return null; };
    const t = kind === 'holdup' ? await one(p, 4, 26, { only: SHOPS }) : kind === 'atm' ? await one(p, 4, 30, { only: BANK_TYPES }) : await one(p, 4, 24, { work: true }); if (!t) return null;
    const name = kind === 'holdup' ? t.name : kind === 'atm' ? `the ATM at ${t.name}` : `the tourist outside ${t.name}`, steps = [{ k: 'game', game, ...t, name, need: 'walk' }];
    let trip = 0; if (kind === 'holdup') { const h = await one(t, 15, 50, { not: [t.bid] }); if (!h) return null; steps.push({ k: 'drop', ...h, name: `${h.name} (your hideout)`, need: 'car', getaway: true }); trip = M.dist(t, h); }
    const fare = Math.min(G.max || 1e9, Math.round(G.base + (G.perTile || 0) * trip));
    return { steps, tiles: M.dist(p, t) + trip, fare, xp: G.xp, secs: Math.round(40 + 2.2 * M.dist(p, t) + M.MISSION.game.extra + M.MISSION.time.perTile * trip) }; }
  async plan(db, p, kind, o = {}) { /* o: { me, bounty } */
    const one = async (from, a, b, o) => { for (const [lo, hi] of [[a, b], [Math.max(2, a - 4), b + 20], [2, b + 60]]) { const s = (await this.spots(db, from, lo, hi, o))[0]; if (s) return s; } return null; };
    if (M.GAME_OF[kind]) return this.gamePlan(db, p, kind);
    if (kind === 'police') { const W = (await this.wanted(db, o.me)).map(w => ({ ...w, d: Math.hypot(w.x - p.x, w.y - p.y) })).filter(w => w.d <= M.MISSION.police.range).sort((a, b) => a.d - b.d)[0], P0 = M.MISSION.police;
      if (W) return { steps: [{ k: 'chase', target: W.id, aid: W.aid, name: `@${W.handle}`, x: Math.round(W.x), y: Math.round(W.y), w: 1, h: 1 }], tiles: 0, fare: P0.pay, xp: P0.xp, secs: P0.secs };
      const R0 = await this.racePlan(db, p); if (!R0) return null; R0.steps.forEach((s, i) => { s.name = i === R0.steps.length - 1 ? 'the end of your round' : `patrol point ${i + 1}`; }); /* (no one on the run: a round of the streets) */
      return { steps: R0.steps, tiles: R0.tiles, fare: Math.round(R0.fare * P0.patrol.pay), xp: Math.round(R0.xp * P0.patrol.xp), secs: R0.times.bronze + 20, patrol: true }; }
    if (kind === 'bounty') { const b = (await Q(db, 'select * from bounties where id = $1 and claimed_by is null', [o.bounty || ''])).rows[0]; if (!b) throw new HttpError(404, 'That bounty has gone. Pick another.');
      if (b.target_id === o.me) throw new HttpError(400, 'That one\'s on you.'); const t = this.pos(b.target_id); if (!t) throw new HttpError(409, `@${b.target_handle} isn't out in town right now. Try again when they are.`);
      return { steps: [{ k: 'hunt', target: b.target_id, bounty: b.id, name: `@${b.target_handle}`, x: Math.round(t.x), y: Math.round(t.y), w: 1, h: 1 }], tiles: 0, fare: b.amount, xp: M.MISSION.bounty.xp, secs: M.MISSION.bounty.secs }; }
    if (kind === 'race') return this.racePlan(db, p);
    if (kind === 'hotcar') return this.hotPlan(db, p);
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
  async start(id, kind, opts = {}) {
    if (!M.MISSIONS[kind]) throw new HttpError(400, 'No such mission.'); if (M.MISSIONS[kind].link) throw new HttpError(409, `${M.MISSIONS[kind].name} are planned from the Crime tab on your card.`);
    return this.world.personal(async ch => {
      const { c } = await this.world.earn.lock(ch, id, false), m = this.stateOf(c); await this.seed(ch, c, m); const now = Date.now();
      if (!M.MISSIONS[kind].live) throw new HttpError(409, `${M.MISSIONS[kind].name} is coming soon.`);
      if (!M.openAt(kind, m.xp)) throw new HttpError(403, `${M.MISSIONS[kind].name} opens when you reach ${M.RANKS[M.MISSIONS[kind].rank].name}.`);
      if (m.active && now <= m.active.deadline) throw new HttpError(409, `You're already on a ${M.MISSIONS[m.active.kind].name.toLowerCase()}. Finish it or give it up first.`);
      if (m.last && now - m.last < M.MISSION.quitCooldown) throw new HttpError(429, 'Give it a moment before taking the next one.');
      const p = this.pos(id); if (!p) throw new HttpError(409, 'Go out on the street first (🚗 Drive): missions happen in the town.');
      if (p.mode !== 'car' && kind !== 'hotcar' && kind !== 'bounty' && !M.GAME_OF[kind]) throw new HttpError(409, 'You need to be driving for this one. Get in a car first.');
      const P = await this.plan(ch, p, kind, { me: id, bounty: opts.bounty ? String(opts.bounty) : null }); if (!P) throw new HttpError(409, 'Nothing nearby to do just now. Drive somewhere busier and try again.');
      const t0 = kind === 'race' ? now + M.MISSION.race.countdown * 1000 : now; /* (a race starts on the green light) */
      m.active = { id: crypto.randomUUID().slice(0, 8), kind, steps: P.steps, step: 0, start: t0, deadline: t0 + P.secs * 1000, fare: P.fare, xp: P.xp, at: t0, from: { x: p.x, y: p.y }, line: crypto.randomInt(M.FARES.length), ...(P.times && !P.patrol ? { times: P.times } : {}), ...(P.patrol ? { patrol: true } : {}) };
      await this.save(ch, c, m); return { ok: true, active: this.pub(m.active), ...this.view(m) };
    });
  }
  // you've pulled up at the next stop: the server checks you really are there, and in time
  async arrive(id, run = null) {
    return this.world.personal(async ch => {
      const { c } = await this.world.earn.lock(ch, id, false), m = this.stateOf(c), a = m.active, now = Date.now();
      if (!a) throw new HttpError(409, 'You aren\'t on a mission.');
      if (now > a.deadline) { m.active = null; m.last = now; await this.save(ch, c, m); return { ok: false, failed: 'time', ...this.view(m) }; }
      const s0 = a.steps[a.step];
      if (s0 && s0.k === 'game' && a.play && run) { /* the game you just played there: the server replayed and scored it */
        const r = (await Q(ch, 'select kind, practice, started_at, finished_at, result from crime_runs where id = $1 and citizen_id = $2', [String(run), id])).rows[0];
        if (!r || r.kind !== s0.game || !r.practice || Number(r.started_at) < a.play.at - 1000 || !r.finished_at) throw new HttpError(409, 'That game doesn\'t belong to this job.');
        const res = r.result || {}, perf = res.game && !res.game.invalid && res.score ? Math.max(0, Math.min(1, res.score.play / 60)) : 0; a.perf = perf; a.play = null;
        if (perf < M.MISSION.game.botched) { m.active = null; m.last = now; await this.save(ch, c, m); return { ok: false, failed: 'botched', ...this.view(m) }; }
        a.step++; a.at = now; a.from = { x: s0.x, y: s0.y }; a.fare = Math.round(a.fare * (0.3 + 0.7 * perf)); /* (the take: how well you played) */
        if (a.step < a.steps.length) { await this.save(ch, c, m); return { ok: true, next: true, perf, active: this.pub(a), ...this.view(m) }; }
        return this.finish(ch, c, m, a, now); }
      const p = this.pos(id), s = a.steps[a.step]; if (!p) throw new HttpError(409, 'Where are you? Go back out on the street.');
      if (now < a.start) throw new HttpError(409, 'Wait for the green light!');
      if (s.k === 'chase' || s.k === 'hunt') { const t = this.pos(s.target), R1 = s.k === 'chase' ? M.MISSION.police.catch : M.MISSION.bounty.catch;
        if (!t || Math.hypot(t.x - p.x, t.y - p.y) > R1) throw new HttpError(409, `You're not close enough to ${s.name}.`);
        const tc = (await Q(ch, 'select id, handle, missions from citizens where id = $1 for update', [s.target])).rows[0];
        if (s.k === 'chase') { const ta = tc && tc.missions && tc.missions.active; if (!ta || ta.id !== s.aid) { m.active = null; m.last = 0; await this.save(ch, c, m); return { ok: false, failed: 'gone', ...this.view(m) }; }
          tc.missions.active = null; tc.missions.last = now; await Q(ch, 'update citizens set missions = $2 where id = $1', [tc.id, JSON.stringify(tc.missions)]); /* (their job's over) */
          ch.extraOps.push({ op: 'mission', private: true, to: [tc.id], data: { kind: 'arrested', by: c.handle } }); await this.world.actions.notify(ch, tc.id, 'crime', `🚓 @${c.handle} pulled you over: you were arrested and the job's off.`);
          await ch.event(`🚓 Officer @${c.handle} arrested @${tc.handle} on the run.`, 'crime'); }
        else { const b = (await Q(ch, 'select * from bounties where id = $1 and claimed_by is null for update', [s.bounty])).rows[0]; if (!b) { m.active = null; m.last = 0; await this.save(ch, c, m); return { ok: false, failed: 'gone', ...this.view(m) }; }
          await Q(ch, 'update bounties set claimed_by = $2, claimed_at = $3 where id = $1', [b.id, c.id, now]); this.boardAt = 0;
          ch.extraOps.push({ op: 'mission', private: true, to: [tc.id], data: { kind: 'bountied', by: c.handle, amount: b.amount } }); await this.world.actions.notify(ch, tc.id, 'crime', `🎯 @${c.handle} caught up with you and collected the ${b.amount.toLocaleString('en-US')}-coin bounty on your head.`);
          await ch.event(`🎯 @${c.handle} collected the ${b.amount.toLocaleString('en-US')}-coin bounty on @${tc.handle}.`, 'crime'); a.escrow = b.amount; }
        a.step++; return this.finish(ch, c, m, a, now); }
      if (!M.atStop(p, s)) throw new HttpError(409, `You're not at ${s.name} yet.`);
      if (s.need && p.mode !== s.need) throw new HttpError(409, s.need === 'walk' ? 'Get out and walk up to it.' : 'You need to be driving it.');
      if (s.k === 'game') { a.play = { at: now }; await this.save(ch, c, m); return { ok: true, play: s.game, active: this.pub(a), ...this.view(m) }; } /* (you're there: now play it) */
      if (now - a.at < M.dist(a.from, s) / M.MISSION.fastest * 1000) throw new HttpError(409, 'That was quicker than any car could get there.');
      a.step++; a.at = now; a.from = { x: s.x, y: s.y };
      if (a.step < a.steps.length) { await this.save(ch, c, m); return { ok: true, next: true, active: this.pub(a), ...this.view(m) }; }
      return this.finish(ch, c, m, a, now);
    });
  }
  async finish(ch, c, m, a, now) {
    // done: the fare, a tip for the time to spare, and XP (which may move you up a rank and open something new)
      const left = (a.deadline - now) / (a.deadline - a.start), secs = +((now - a.start) / 1000).toFixed(1), medal = a.times && !a.patrol ? M.medalOf(secs, a.times) || 'bronze' : null;
      const fare = medal ? Math.round(a.fare * M.MISSION.race.medal[medal]) : a.fare, tip = medal || a.escrow || a.patrol ? 0 : M.tipOf(a.fare, left), before = M.rankOf(m.xp); m.active = null; m.last = 0; m.done = (m.done || 0) + 1; /* (a race pays by medal, no tip) */
      if (medal) { const xpGot = Math.round(a.xp * M.MISSION.race.medal[medal]); a.xp = Math.max(10, xpGot); }
      let paid = 0, short = false; if (a.escrow) { paid = a.escrow; c.coins_base += paid; track(ch, 'bounty:claim', paid, c.id); ch.touch(c); await ch.saveCitizen(c); } /* (the bounty: the coins someone put up) */
      else if ((m.paid || 0) < M.MISSION.perDay) { const r = await this.world.earn.pay(ch, c, fare + tip, 'missions'); paid = r.paid; short = r.short; m.paid = (m.paid || 0) + 1; }
      m.xp += a.xp;
      // today's goals: count this one, and the bonus when all three are done
      const goalsDone = []; for (const g of m.goals || []) { if (g.got >= g.need) continue; if (g.k === 'do' && g.kind === a.kind) g.got++; else if (g.k === 'earn') g.got = Math.min(g.need, g.got + paid); else if (g.k === 'medal' && medal === 'gold') g.got++; if (g.got >= g.need) goalsDone.push(M.goalText(g)); }
      let bonus = 0; if (!m.bonus && m.goals && m.goals.every(g => g.got >= g.need)) { const r = await this.world.earn.pay(ch, c, M.dailyBonus(M.rankOf(m.xp)), 'missions', true); bonus = r.paid; m.bonus = 1; m.xp += M.DAILY.bonus.xp; }
      const after = M.rankOf(m.xp); await this.save(ch, c, m);
      if (paid >= 300) await ch.event(`${M.MISSIONS[a.kind].icon} @${c.handle} finished a ${M.MISSIONS[a.kind].name.toLowerCase()} for ${paid.toLocaleString('en-US')} coins.`, 'gig');
      return { ok: true, done: true, kind: a.kind, fare, tip, paid, short, xpGot: a.xp, coins: c.coins_base, medal, secs, goalsDone, dailyBonus: bonus,
        rankUp: after > before ? { rank: after, ...M.RANKS[after], unlocks: M.unlocksAt(after).map(k => ({ kind: k, ...M.MISSIONS[k] })) } : null, ...this.view(m) };
  }
  async quit(id) {
    return this.world.personal(async ch => { const { c } = await this.world.earn.lock(ch, id, false), m = this.stateOf(c); if (m.active) { m.active = null; m.last = Date.now(); } await this.save(ch, c, m); return { ok: true, ...this.view(m) }; });
  }
}
