// Street games, live: the lobby, the matches (run ten times a second), the computer's players, and the prizes.
// Only the leader server runs matches. Players talk to it over their live connection: whichever server they're
// connected to passes their messages on over the bus, and the leader's replies come back the same way, so this
// works the same with one server or several.
import crypto from 'node:crypto';
import { pool } from './db.js';
import * as AR from '../shared/arena.js';
import { treasuryAdd } from './races.js';
import { track } from './stats.js';
import * as R from '../shared/rules.js';

const { A, MODES } = AR;
const rand = () => crypto.randomInt(0, 1e9) / 1e9;
const dayKey = () => new Date().toISOString().slice(0, 10);

export class Arena {
  constructor(world, bus) { this.world = world; this.bus = bus; this.queues = { tag: new Map(), hide: new Map() }; this.startAt = { tag: 0, hide: 0 }; this.matches = new Map(); this.inMatch = new Map(); this.timer = null; this.leader = () => false; }

  // ---------- talking to players ----------
  send(list) { if (list.length) this.bus.publish([{ arena: true, k: 'out', msgs: list.map(([to, m]) => [to, JSON.stringify({ type: 'arena', ...m })]) }]); }
  // A message from a player (passed on from whichever server they're connected to).
  async handle(o) {
    const pid = o.pid, m = o.m || {}; if (!pid) return;
    if (m.a === 'join') return this.join(pid, o.handle, m.mode);
    if (m.a === 'leave') return this.leave(pid);
    if (m.a === 'gone') { for (const [k, q] of Object.entries(this.queues)) if (q.delete(pid)) { if (!q.size) this.startAt[k] = 0; this.lobbyNews(k); } return; }
    if (m.a === 'go') { const q = this.queueOf(pid); if (q) { this.startAt[q] = Math.min(this.startAt[q], Date.now() + 3000); this.lobbyNews(q); } return; }
    if (m.a === 'pos') return this.pos(pid, m);
    if (m.a === 'state') { const id = this.inMatch.get(pid), M = id && this.matches.get(id); if (M) this.send([[pid, this.startMsg(M, M.players.find(p => p.id === pid))]]); else { const q = this.queueOf(pid); this.send([[pid, q ? this.lobbyMsg(q) : { k: 'idle' }]]); } }
  }
  queueOf(pid) { for (const k of Object.keys(this.queues)) if (this.queues[k].has(pid)) return k; return null; }

  // ---------- the lobby ----------
  async join(pid, handle, mode) {
    if (!MODES[mode]) return;
    if (this.inMatch.has(pid)) { const M = this.matches.get(this.inMatch.get(pid)); if (M) return this.send([[pid, this.startMsg(M, M.players.find(p => p.id === pid))]]); }
    const c = (await pool.query('select handle, jailed_until, home_id from citizens where id = $1', [pid])).rows[0];
    if (!c) return; if (!c.home_id) return this.send([[pid, { k: 'error', text: 'Move into a home first.' }]]);
    if (Number(c.jailed_until || 0) > Date.now()) return this.send([[pid, { k: 'error', text: "You're in jail. No street games until you're out." }]]);
    for (const q of Object.values(this.queues)) q.delete(pid);
    const Q = this.queues[mode]; Q.set(pid, { id: pid, h: c.handle || handle, at: Date.now() });
    if (Q.size === 1 || !this.startAt[mode]) this.startAt[mode] = Date.now() + A.lobby * 1000;
    if (Q.size >= A.maxPeople) this.startAt[mode] = Date.now(); // a full set of real people: off we go
    this.lobbyNews(mode); this.run();
  }
  leave(pid) {
    for (const [k, q] of Object.entries(this.queues)) if (q.delete(pid)) { if (!q.size) this.startAt[k] = 0; this.lobbyNews(k); }
    const id = this.inMatch.get(pid), M = id && this.matches.get(id);
    if (M) { const p = M.players.find(x => x.id === pid); if (p) { p.bot = true; p.left = true; } this.inMatch.delete(pid); }
    this.send([[pid, { k: 'idle' }]]);
  }
  lobbyMsg(mode) { const Q = this.queues[mode]; return { k: 'lobby', mode, players: [...Q.values()].map(p => p.h), startsIn: Math.max(0, this.startAt[mode] - Date.now()), max: A.maxPeople }; }
  lobbyNews(mode) { const msg = this.lobbyMsg(mode); this.send([...this.queues[mode].keys()].map(pid => [pid, msg])); }

  // ---------- running ----------
  run() { if (!this.timer) this.timer = setInterval(() => this.tick().catch(e => console.error('arena:', e.message)), A.tick * 1000); }
  async tick() {
    if (!this.leader()) return;
    const now = Date.now();
    for (const mode of Object.keys(this.queues)) { const Q = this.queues[mode];
      if (Q.size && now >= this.startAt[mode]) await this.start(mode);
      else if (Q.size && (now / 100 | 0) % 10 === 0) this.lobbyNews(mode); }
    for (const M of this.matches.values()) this.step(M, now);
    if (!this.matches.size && ![...Object.values(this.queues)].some(q => q.size)) { clearInterval(this.timer); this.timer = null; }
  }
  async start(mode) {
    const Q = this.queues[mode], humans = [...Q.values()].slice(0, A.maxPeople); for (const h of humans) Q.delete(h.id); this.startAt[mode] = Q.size ? Date.now() + A.lobby * 1000 : 0;
    const nBots = Math.max(0, A.players - humans.length); // the computer fills the rest
    const bots = nBots ? (await pool.query('select id, handle from citizens where pass_hash is null and home_id is not null and handle is not null order by random() limit $1', [nBots])).rows : [];
    while (bots.length < nBots) bots.push({ id: 'bot' + bots.length, handle: ['Kemi', 'Tunde', 'Ada', 'Bayo', 'Zainab', 'Chidi'][bots.length % 6] + '_' + (bots.length + 1) });
    const seed = crypto.randomInt(1, 2 ** 31), wire = await this.area(humans[0]?.id, seed), L = AR.prepare({ ...wire }), all = [...humans.map(h => ({ id: h.id, h: h.h, bot: false, human: true })), ...bots.map(b => ({ id: 'b:' + b.id, h: b.handle, bot: true, human: false }))];
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    const nCh = Math.max(1, Math.round(all.length / 4)), M = { id: crypto.randomUUID(), mode, seed, L, wire, started: Date.now(), humans: humans.length, feed: [], bags: [], over: false };
    const hideMs = MODES[mode].hide * 1000; M.playFrom = M.started + hideMs; M.until = M.playFrom + MODES[mode].play * 1000;
    // the computer's players take the chasing parts first, so people get to run and hide
    all.sort((a, b) => (b.bot ? 1 : 0) - (a.bot ? 1 : 0)); const roles = all.map((p, i) => i < nCh ? AR.chasers(mode) : AR.runners(mode));
    M.players = all.map((p, i) => { const ch = roles[i] === AR.chasers(mode), at = ch ? L.corners[i % L.corners.length] : { x: L.spawn.x + (rand() - 0.5) * 4, y: L.spawn.y + (rand() - 0.5) * 4 };
      const pos = AR.fits(L, at.x, at.y) ? at : L.spawn;
      return { ...p, i, role: roles[i], first: roles[i], x: pos.x, y: pos.y, out: false, catches: 0, bags: 0, seenAt: Date.now(), lastPos: Date.now(), credit: 2, ai: {}, caughtAt: 0 }; });
    M.players.sort((a, b) => a.i - b.i);
    if (mode === 'tag') for (let i = 0; i < 6; i++) M.bags.push(this.freeTile(M));
    this.matches.set(M.id, M); for (const p of M.players) if (p.human) this.inMatch.set(p.id, M.id);
    this.send(M.players.filter(p => p.human).map(p => [p.id, this.startMsg(M, p)]));
  }
  startMsg(M, p) { return { k: 'start', id: M.id, mode: M.mode, seed: M.seed, L: M.wire, you: p ? p.i : -1, roster: M.players.map(q => ({ i: q.i, h: q.h, bot: q.bot && !q.human })), playFrom: M.playFrom, until: M.until, now: Date.now(), x: p?.x, y: p?.y, role: p?.role }; }
  freeTile(M) { const L = M.L; for (let i = 0; i < 300; i++) { const x = (1 + Math.floor(rand() * (L.W - 2))) * AR.CELL + AR.CELL / 2, y = (1 + Math.floor(rand() * (L.H - 2))) * AR.CELL + AR.CELL / 2; if (AR.fits(L, x, y) && M.players.every(p => Math.hypot(p.x - x, p.y - y) > 12)) return { x, y }; } return { ...L.spawn }; }
  // The play area: the real streets around the first player's home (or the middle of town).
  async area(pid, seed) {
    const home = pid ? (await pool.query('select h.x, h.y from citizens c join buildings h on h.id = c.home_id where c.id = $1', [pid])).rows[0] : null;
    const at = home || (await pool.query('select round(avg(x)) x, round(avg(y)) y from buildings where done and not ruin')).rows[0] || { x: 0, y: 0 };
    const x0 = Math.round(Number(at.x || 0)) - Math.floor(A.tilesW / 2), y0 = Math.round(Number(at.y || 0)) - Math.floor(A.tilesH / 2), x1 = x0 + A.tilesW, y1 = y0 + A.tilesH;
    const m = 8, X0 = x0 - m, Y0 = y0 - m, X1 = x1 + m, Y1 = y1 + m; // the town around it too, as scenery
    const [b, r, w] = await Promise.all([
      pool.query('select id, type, x, y, rot, level, name from buildings where done and not ruin and x > $1 - 7 and x < $2 and y > $3 - 7 and y < $4 limit 900', [X0, X1, Y0, Y1]),
      pool.query('select x, y, type from roads where x >= $1 and x < $2 and y >= $3 and y < $4 limit 3000', [X0, X1, Y0, Y1]),
      pool.query('select x, y from water where x >= $1 and x < $2 and y >= $3 and y < $4 limit 3000', [X0, X1, Y0, Y1])]);
    return AR.arenaFromMap({ x0, y0, buildings: b.rows, roads: r.rows.map(q => [q.x, q.y, q.type]), water: w.rows.map(q => [q.x, q.y]) }, seed);
  }

  // A player's phone says where they are now. It's checked: no faster than the role allows, never through a wall.
  pos(pid, m) {
    const id = this.inMatch.get(pid), M = id && this.matches.get(id); if (!M || M.over || m.id !== M.id) return;
    const p = M.players.find(x => x.id === pid); if (!p || p.out) return;
    const now = Date.now(), x = Number(m.x), y = Number(m.y); p.seenAt = now; if (p.left) return; p.bot = false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    // how far you may have moved: a running allowance that refills at your top speed (with some slack), so messages
    // that arrive bunched together over a jumpy connection are never mistaken for running too fast
    const frozen = now < M.playFrom && p.role === AR.chasers(M.mode), dt = Math.min(2, (now - p.lastPos) / 1000);
    p.credit = frozen ? 0.3 : Math.min(A.speed[p.role] * 1.6, p.credit + A.speed[p.role] * dt * 1.25); p.lastPos = now;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d > p.credit + 0.3 || !AR.fits(M.L, x, y)) { p.fix = true; return; }
    p.credit = Math.max(0, p.credit - d); p.x = x; p.y = y;
  }

  step(M, now) {
    if (M.over) return; const L = M.L, mode = M.mode, CH = AR.chasers(mode), RU = AR.runners(mode), live = now >= M.playFrom;
    for (const p of M.players) if (!p.bot && now - p.seenAt > 8000) p.bot = true; // gone quiet: the computer takes over
    for (const p of M.players) if (p.bot && !p.out) this.ai(M, p, now, live);
    if (live) {
      // catching: a chaser close enough to someone still running
      for (const c of M.players) { if (c.role !== CH) continue;
        for (const v of M.players) { if (v.role !== RU || v.out) continue; const d = Math.hypot(c.x - v.x, c.y - v.y);
          if (d <= (mode === 'tag' ? A.tagR : A.findR)) { v.role = CH; v.caughtAt = now; c.catches++; M.feed.push(mode === 'tag' ? `🏃 @${c.h} caught @${v.h}!` : `🙈 @${c.h} found @${v.h}!`); } } }
      if (mode === 'tag') for (const v of M.players) { if (v.role !== RU) continue; const bi = M.bags.findIndex(b => Math.hypot(b.x - v.x, b.y - v.y) < 1.3); if (bi >= 0) { v.bags++; M.bags[bi] = this.freeTile(M); M.feed.push(`💰 @${v.h} grabbed a bag`); } }
      const left = M.players.filter(p => p.role === RU).length;
      if (!left || now >= M.until) return this.end(M, now);
    }
    // what each person sees: everything in Hunters & Civilians; in Hide and seek the seekers only see hiders who are out
    // in the open and in sight, or right next to them
    const feed = M.feed.splice(0), msgs = [];
    for (const me of M.players) { if (!me.human || me.left) continue;
      const others = [];
      for (const q of M.players) { if (q === me) continue; const hidden = mode === 'hide' && q.role === RU && !!AR.spotAt(L, q);
        if (mode === 'hide' && me.role === CH && q.role === RU) { const near = Math.hypot(q.x - me.x, q.y - me.y) <= A.findR + 0.6; if (!near && (hidden || !AR.sees(L, me, q))) continue; if (!live) continue; }
        others.push([q.i, +q.x.toFixed(2), +q.y.toFixed(2), q.role === CH ? 1 : 0, hidden ? 1 : 0]); }
      const msg = { k: 's', id: M.id, t: now, tl: Math.max(0, (live ? M.until : M.playFrom) - now), live, role: me.role, p: others,
        n: M.players.filter(p => p.role === RU).length, sc: mode === 'tag' ? me.bags : me.catches };
      if (mode === 'tag') msg.b = M.bags.map(b => [b.x, b.y]);
      if (me.fix) { msg.fix = [me.x, me.y]; me.fix = false; }
      if (me.bot) msg.auto = true; if (me.caughtAt && now - me.caughtAt < 300) msg.caught = true;
      if (feed.length) msg.f = feed;
      msgs.push([me.id, msg]); }
    this.send(msgs);
  }

  // The computer's players.
  ai(M, p, now, live) {
    const L = M.L, CH = AR.chasers(M.mode), RU = AR.runners(M.mode), sp = A.speed[p.role] * (p.human ? 1 : 0.9) * A.tick, a = p.ai;
    const go = (tx, ty) => { if (!a.wp || now - a.at > 400 || Math.hypot(a.wp.x - p.x, a.wp.y - p.y) < 0.4) { a.wp = AR.nextStep(L, p, { x: tx, y: ty }); a.at = now; }
      const q = AR.moveBy(L, p, a.wp.x - p.x, a.wp.y - p.y, Math.min(sp, Math.hypot(a.wp.x - p.x, a.wp.y - p.y))); p.x = q.x; p.y = q.y; };
    if (p.role === CH) {
      if (!live) return; // seekers wait while the hiders hide
      const prey = M.players.filter(v => v.role === RU && (M.mode === 'tag' || (!AR.spotAt(L, v) && AR.sees(L, p, v)) || Math.hypot(v.x - p.x, v.y - p.y) < A.findR + 0.6));
      prey.sort((u, v) => Math.hypot(u.x - p.x, u.y - p.y) - Math.hypot(v.x - p.x, v.y - p.y));
      if (prey[0]) return go(prey[0].x, prey[0].y);
      // nobody in sight: check the hiding spots, nearest first, then wander
      a.checked = a.checked || new Set(); const spots = L.spots.filter((s, i) => !a.checked.has(i)).map(s => [s, L.spots.indexOf(s)]);
      if (!spots.length) a.checked.clear();
      spots.sort((u, v) => Math.hypot(u[0].x - p.x, u[0].y - p.y) - Math.hypot(v[0].x - p.x, v[0].y - p.y));
      const t = spots[0]; if (t) { if (Math.hypot(t[0].x - p.x, t[0].y - p.y) < 1.5) a.checked.add(t[1]); return go(t[0].x, t[0].y); }
      return;
    }
    // running and hiding
    if (M.mode === 'hide') {
      if (a.spot == null || (M.players.some(o => o !== p && o.role === RU && o.ai?.spot === a.spot && o.i < p.i))) { const free = L.spots.map((s, i) => i).filter(i => !M.players.some(o => o !== p && o.role === RU && o.ai?.spot === i)); a.spot = free.length ? free[Math.floor(rand() * free.length)] : 0; }
      const s = L.spots[a.spot]; if (Math.hypot(s.x - p.x, s.y - p.y) > 0.4) go(s.x, s.y); return;
    }
    const hunters = M.players.filter(h => h.role === CH), near = hunters.filter(h => Math.hypot(h.x - p.x, h.y - p.y) < 16);
    if (near.length) { // flee: of the nearby open tiles, the one furthest from the hunters
      if (!a.flee || now - a.fleeAt > 600) { let best = null, bv = -1; for (let i = 0; i < 16; i++) { const ang = i / 16 * Math.PI * 2, tx = p.x + Math.cos(ang) * 8, ty = p.y + Math.sin(ang) * 8; if (!AR.fits(L, tx, ty)) continue; const v = Math.min(...near.map(h => Math.hypot(h.x - tx, h.y - ty))); if (v > bv) { bv = v; best = { x: tx, y: ty }; } } a.flee = best; a.fleeAt = now; }
      if (a.flee) return go(a.flee.x, a.flee.y);
    }
    const bag = M.bags.slice().sort((u, v) => Math.hypot(u.x - p.x, u.y - p.y) - Math.hypot(v.x - p.x, v.y - p.y))[0]; if (bag) go(bag.x, bag.y);
  }

  // The end: who won, and the prizes (only when at least two real colonists played, a few wins a day).
  async end(M, now) {
    M.over = true; this.matches.delete(M.id);
    try { await this.end0(M, now); } catch (e) { console.error('arena end:', e.message); this.send(M.players.filter(p => p.human).map(p => [p.id, { k: 'idle' }])); }
    for (const p of M.players) if (this.inMatch.get(p.id) === M.id) this.inMatch.delete(p.id);
  }
  async end0(M, now) {
    const RU = AR.runners(M.mode), CH = AR.chasers(M.mode), survivors = M.players.filter(p => p.role === RU);
    const winners = survivors.length ? survivors : M.players.filter(p => p.first === CH);
    const paid = M.humans >= 2, results = [];
    for (const p of winners) { if (!p.human || p.left) continue;
      let prize = 0;
      if (paid) prize = await this.pay(p.id, M).catch(e => { console.error('arena pay:', e.message); return 0; });
      results.push({ h: p.h, prize }); }
    const summary = { mode: M.mode, winners: winners.map(p => p.h), side: survivors.length ? RU : CH, survivors: survivors.map(p => p.h), paid,
      players: M.players.map(p => ({ h: p.h, bot: p.bot && !p.human, first: p.first, role: p.role, catches: p.catches, bags: p.bags })) };
    await pool.query('insert into arena_results (id, mode, started_at, ended_at, humans, result) values ($1, $2, $3, $4, $5, $6)', [M.id, M.mode, M.started, now, M.humans, JSON.stringify(summary)]).catch(() => {});
    if (paid && results.length) await this.world.change(ch => ch.event(`${MODES[M.mode].icon} ${MODES[M.mode].name}: ${results.map(r => '@' + r.h).join(', ')} won a street game${results.some(r => r.prize) ? ` (+${A.prize} coins)` : ''}.`, 'game')).catch(() => {});
    this.send(M.players.filter(p => p.human && !p.left).map(p => [p.id, { k: 'end', id: M.id, ...summary, won: winners.includes(p), prize: results.find(r => r.h === p.h)?.prize || 0, mine: { catches: p.catches, bags: p.bags, first: p.first } }]));
    for (const p of M.players) if (this.inMatch.get(p.id) === M.id) this.inMatch.delete(p.id);
  }
  async pay(pid, M) {
    const day = dayKey(), n = (await pool.query('insert into arena_pay (citizen_id, day, n) values ($1, $2, 1) on conflict (citizen_id, day) do update set n = arena_pay.n + 1 returning n', [pid, day])).rows[0].n;
    if (n > A.paidWins) return 0;
    return this.world.change(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [pid])).rows[0]; if (!c) return 0;
      const prize = Math.max(0, Math.min(A.prize, Math.floor(R.treasuryOn(ch.meta, ch.today)))); if (!prize) return 0;
      ch.coins(c); c.coins_base += prize; ch.touch(c); await ch.saveCitizen(c); treasuryAdd(ch, -prize); track(ch, 'arena:win', prize, c.id);
      return prize;
    });
  }
  info() { return { modes: MODES, prize: A.prize, paidWins: A.paidWins, lobby: Object.fromEntries(Object.entries(this.queues).map(([k, q]) => [k, q.size])), live: [...this.matches.values()].map(M => ({ mode: M.mode, players: M.players.length })) }; }
}
