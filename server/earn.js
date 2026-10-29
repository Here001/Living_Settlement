// More ways for a colonist to earn, on top of their daily wage: extra shifts, delivery gigs, fishing, foraging and
// scavenging round the landing station. Everything is paid from the colony treasury (if it runs dry, pay shrinks
// to what it holds), with cooldowns and daily limits so a job stays the main income. Each colonist's progress
// is kept in citizens.earn; "today" is the real-world day (UTC), like daily rewards.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { BUILDING_TYPES } from '../shared/catalog.js';
import { treasuryAdd } from './races.js';
import { bump } from './achievements.js';
import { earnBoost } from '../shared/events.js';

const fmt = n => Math.round(n).toLocaleString('en-US'), MIN = 60000, day = () => Math.floor(Date.now() / 86400000);
const rnd = n => crypto.randomInt(n), chance = () => crypto.randomInt(0, 1e9) / 1e9;
export const EARN = {
  shift: { perDay: 4, cooldown: 45 * MIN, mult: 8, length: 4 * MIN },          // pays 8× the job's daily salary
  gig: { perDay: 8, offers: 3, refresh: 10 * MIN },
  catch: { perDay: 30, gap: 6000, biteMin: 2500, biteMax: 7500, window: 1500 },  // fishing + foraging together
  scavenge: { perDay: 10, cooldown: 15 * MIN, length: 2 * MIN },
};
// What you can catch or find, with how often (w) and what the market pays.
export const LOOT = {
  fish: [{ id: 'glowfin', icon: '🐟', name: 'Glowfin', w: 40, pay: 15 }, { id: 'eel', icon: '🐍', name: 'Stripe eel', w: 25, pay: 30 }, { id: 'crab', icon: '🦀', name: 'Mud crab', w: 15, pay: 45 },
    { id: 'silverjaw', icon: '🐠', name: 'Silverjaw', w: 10, pay: 80 }, { id: 'boot', icon: '🥾', name: 'An old boot', w: 7, pay: 0 }, { id: 'relic', icon: '🏺', name: 'A sunken ark relic', w: 2.5, pay: 400 },
    { id: 'scale', icon: '🐉', name: 'A leviathan scale', w: 0.5, pay: 1000 }],
  forage: [{ id: 'berries', icon: '🫐', name: 'Sunberries', w: 40, pay: 12 }, { id: 'puffcap', icon: '🍄', name: 'Puffcap mushrooms', w: 25, pay: 25 }, { id: 'moss', icon: '🌿', name: 'Blue moss', w: 15, pay: 35 },
    { id: 'starfruit', icon: '⭐', name: 'Starfruit', w: 10, pay: 70 }, { id: 'twigs', icon: '🪵', name: 'Just twigs', w: 7.5, pay: 0 }, { id: 'crystal', icon: '💎', name: 'A crystal shard', w: 2.5, pay: 300 }],
  scavenge: [{ id: 'nothing', icon: '🕳️', name: 'Nothing useful', w: 25, pay: 0 }, { id: 'scrap', icon: '🔩', name: 'Scrap metal', w: 45, pay: 40 }, { id: 'board', icon: '🔌', name: 'An old circuit board', w: 20, pay: 100 },
    { id: 'pod', icon: '🛰️', name: 'A cryo-pod part', w: 8, pay: 250 }, { id: 'log', icon: '📜', name: "The captain's lost log", w: 2, pay: 1200 }],
};
const pick = list => { const t = list.reduce((s, x) => s + x.w, 0); let r = chance() * t; for (const x of list) if ((r -= x.w) < 0) return x; return list[0]; };
const PARKISH = ['park', 'garden', 'fitpark'];

export class Earn {
  constructor(world) { this.world = world; }
  // A colonist's earning state, reset each real day.
  stateOf(c) { const e = c.earn || {}; if (e.day !== day()) return { day: day(), shifts: 0, gigsDone: 0, catches: 0, scavDone: 0, gigs: e.gigs || [], gigsAt: e.gigsAt || 0, gig: e.gig || null, scav: e.scav || null, shiftAt: e.shiftAt || 0, scavAt: e.scavAt || 0, cast: null, castAt: e.castAt || 0 }; return { ...e }; }
  async lock(ch, id, needHome = true) {
    const c = (await ch.q('select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where c.id = $1 for update of c', [id])).rows[0];
    if (!c) throw new HttpError(404, 'No such citizen.');
    if (needHome && !c.home_id) throw new HttpError(400, "You're still in cryosleep. Once you have a home you can earn coins.");
    const why = this.world.blockedReason && await this.world.blockedReason(c); if (why) throw new HttpError(409, why);
    const hx = c.hx ?? 0, hy = c.hy ?? 0; delete c.hx; delete c.hy; ch.coins(c); return { c, hx, hy };
  }
  // Pay from the treasury (as much as it holds), and keep a count for badges.
  async pay(ch, c, want, stat, noBoost = false) {
    if (!noBoost) want = Math.round(want * earnBoost(await this.event(), stat)); // a colony event can boost some earnings
    const t = Math.floor(R.treasuryOn(ch.meta, ch.today)), paid = Math.max(0, Math.min(want, t));
    if (paid) { c.coins_base += paid; treasuryAdd(ch, -paid); } ch.touch(c); await ch.saveCitizen(c);
    if (stat) await bump(ch, c.id, { [stat]: 1, earned: paid });
    return { paid, short: paid < want };
  }
  async save(ch, c, e) { await ch.q('update citizens set earn = $2 where id = $1', [c.id, JSON.stringify(e)]); }
  async go(ch, c, b, until) { if (b && this.world.actions) await this.world.actions.setVisit(ch, c, b, until); }
  async event() { return this.world.cevents ? this.world.cevents.kindNow() : null; }
  salary(job) { return BUILDING_TYPES[job?.type]?.work?.salary || 0; }

  // Everything the Earn tab shows.
  async info(id) {
    const c = (await pool.query('select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where c.id = $1', [id])).rows[0];
    if (!c) throw new HttpError(404, 'No such citizen.');
    const e = this.stateOf(c), now = Date.now();
    const job = c.job_id ? (await pool.query('select id, type, name from buildings where id = $1', [c.job_id])).rows[0] : null;
    const water = Number((await pool.query('select count(*) n from water')).rows[0].n) > 0;
    const park = await this.parkNear(pool, c.hx ?? 0, c.hy ?? 0), landing = (await pool.query("select id, name from buildings where type = 'landing' and done and not ruin limit 1")).rows[0];
    const today = this.world.meta ? R.gameDay(now, this.world.meta.epoch) : 0, ev = this.world.cevents ? await this.world.cevents.current() : null;
    return {
      housed: !!c.home_id, now, resetsAt: (day() + 1) * 86400000, salary: this.salary(job), net: Number(c.net || 0), coins: R.balanceOn(c.coins_base, c.coins_day, c.net, today),
      shift: { job: job ? (job.name || BUILDING_TYPES[job.type]?.name) : null, pay: this.salary(job) * EARN.shift.mult, left: EARN.shift.perDay - e.shifts, readyAt: (e.shiftAt || 0) + EARN.shift.cooldown },
      gigs: { left: EARN.gig.perDay - e.gigsDone, offers: c.home_id ? await this.offers(c, e) : [], active: e.gig },
      fishing: { ok: water, left: EARN.catch.perDay - e.catches, cast: e.cast ? { kind: e.cast.kind, at: e.cast.at } : null },
      foraging: { ok: !!park, where: park ? (park.name || BUILDING_TYPES[park.type]?.name) : null, left: EARN.catch.perDay - e.catches },
      scavenge: { ok: !!landing, left: EARN.scavenge.perDay - e.scavDone, readyAt: (e.scavAt || 0) + EARN.scavenge.cooldown, active: e.scav },
      loot: LOOT, limits: EARN, event: ev, supply: ev?.kind === 'supply' ? { left: ev.data.left || 0, claimed: (ev.data.claimed || []).includes(c.id) } : null,
    };
  }
  async parkNear(db, x, y) {
    const sql = 'select id, type, name, cx, cy, x, y from buildings where type = any($3) and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int) limit 1';
    return (await (db.q ? db.q(sql, [x, y, PARKISH]) : db.query(sql, [x, y, PARKISH]))).rows[0] || null; // works in a change (ch.q) or on the pool
  }

  // ---------- extra shifts ----------
  async shift(id) {
    return this.world.change(async ch => {
      const { c } = await this.lock(ch, id), e = this.stateOf(c), now = Date.now();
      if (!c.job_id) throw new HttpError(400, 'You need a job to work an extra shift. Pick one in the Work tab.');
      if (e.shifts >= EARN.shift.perDay) throw new HttpError(429, `You've worked ${EARN.shift.perDay} extra shifts today. Rest up and come back tomorrow.`);
      if (now < (e.shiftAt || 0) + EARN.shift.cooldown) throw new HttpError(429, `You're still tired from your last shift. Try again in ${Math.ceil(((e.shiftAt || 0) + EARN.shift.cooldown - now) / MIN)} min.`);
      const job = (await ch.q('select * from buildings where id = $1', [c.job_id])).rows[0], want = this.salary(job) * EARN.shift.mult;
      if (!want) throw new HttpError(400, "Your job doesn't pay a wage.");
      e.shifts++; e.shiftAt = now; await this.go(ch, c, job, now + EARN.shift.length);
      const r = await this.pay(ch, c, want, 'shifts'); await this.save(ch, c, e);
      return { ok: true, ...r, coins: c.coins_base, left: EARN.shift.perDay - e.shifts, readyAt: now + EARN.shift.cooldown };
    });
  }

  // ---------- delivery gigs ----------
  // Three parcels to take somewhere in town, offered for ten minutes at a time. Longer trips pay more.
  async offers(c, e, db = pool) {
    if (e.gigs?.length && Date.now() - (e.gigsAt || 0) < EARN.gig.refresh) return e.gigs;
    const hx = c.hx ?? 0, hy = c.hy ?? 0;
    const spots = (await db.query(`select id, type, name, x, y from buildings b where done and not ruin and type <> all($3)
      and abs(x - $1::int) + abs(y - $2::int) between 6 and 120 order by random() limit 12`, [hx, hy, ['tree', 'pine', 'birch', 'bush', 'rocks']])).rows.filter(b => BUILDING_TYPES[b.type] && !['nature', 'decor'].includes(BUILDING_TYPES[b.type].cat));
    const out = [];
    for (let i = 0; i + 1 < spots.length && out.length < EARN.gig.offers; i += 2) {
      const a = spots[i], b = spots[i + 1], dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.x - hx) + Math.abs(a.y - hy);
      if (dist < 8) continue;
      const pay = Math.min(260, Math.round(30 + dist * 2.2)), mins = Math.max(1, Math.min(5, Math.round(1 + dist / 30)));
      out.push({ id: crypto.randomUUID().slice(0, 8), from: { id: a.id, name: a.name || BUILDING_TYPES[a.type].name }, to: { id: b.id, name: b.name || BUILDING_TYPES[b.type].name, x: b.x, y: b.y }, dist, pay, mins });
    }
    e.gigs = out; e.gigsAt = Date.now(); if (db === pool) await pool.query('update citizens set earn = $2 where id = $1', [c.id, JSON.stringify(e)]);
    return out;
  }
  async takeGig(id, gigId) {
    return this.world.change(async ch => {
      const { c } = await this.lock(ch, id), e = this.stateOf(c), now = Date.now();
      if (e.gig) throw new HttpError(409, `You're already delivering to ${e.gig.to.name}.`);
      if (e.gigsDone >= EARN.gig.perDay) throw new HttpError(429, `You've done ${EARN.gig.perDay} deliveries today. More tomorrow!`);
      const g = (e.gigs || []).find(x => x.id === gigId); if (!g) throw new HttpError(404, 'That delivery has been taken. Pick another.');
      const to = (await ch.q('select * from buildings where id = $1 and done and not ruin', [g.to.id])).rows[0]; if (!to) throw new HttpError(409, "That address isn't there any more. Pick another delivery.");
      e.gig = { ...g, until: now + g.mins * MIN, at: now }; e.gigs = e.gigs.filter(x => x.id !== gigId);
      await this.go(ch, c, to, e.gig.until + MIN); await this.save(ch, c, e);
      return { ok: true, gig: e.gig };
    });
  }
  async deliver(id) {
    return this.world.change(async ch => {
      const { c } = await this.lock(ch, id), e = this.stateOf(c), now = Date.now();
      if (!e.gig) throw new HttpError(409, "You aren't delivering anything.");
      if (now < e.gig.until - 1000) throw new HttpError(409, `Still on the way: ${Math.ceil((e.gig.until - now) / 1000)} s to go.`);
      const g = e.gig; e.gig = null; e.gigsDone++;
      const r = await this.pay(ch, c, g.pay, 'gigs'); await this.save(ch, c, e);
      if (g.pay >= 200 && r.paid) await ch.event(`📦 @${c.handle} delivered a parcel to ${g.to.name}.`, 'gig');
      return { ok: true, ...r, coins: c.coins_base, to: g.to.name, left: EARN.gig.perDay - e.gigsDone };
    });
  }
  async dropGig(id) {
    return this.world.change(async ch => { const { c } = await this.lock(ch, id, false), e = this.stateOf(c); e.gig = null; await this.save(ch, c, e); return { ok: true }; });
  }

  // ---------- fishing and foraging: cast, wait for a bite, tap in time ----------
  async cast(id, kind) {
    if (!['fish', 'forage'].includes(kind)) throw new HttpError(400, 'Go fishing or foraging.');
    return this.world.change(async ch => {
      const { c, hx, hy } = await this.lock(ch, id), e = this.stateOf(c), now = Date.now();
      if (e.catches >= EARN.catch.perDay) throw new HttpError(429, `You've brought in ${EARN.catch.perDay} catches today. The market's full until tomorrow.`);
      if (now - (e.castAt || 0) < EARN.catch.gap) throw new HttpError(429, 'Catch your breath for a moment.');
      const ev = await this.event(); if (ev === 'storm') throw new HttpError(409, "It's far too stormy to go out there. Try a delivery instead: they pay extra in a storm.");
      let spot = null;
      if (kind === 'fish') { if (!(await ch.q('select 1 from water limit 1')).rowCount) throw new HttpError(409, 'The colony has no water to fish in yet.'); spot = await this.parkNear(ch, hx, hy); }
      else { spot = await this.parkNear(ch, hx, hy); if (!spot) throw new HttpError(409, 'There are no parks or gardens to forage in yet.'); }
      const fast = ev === 'frenzy' && kind === 'fish', lo = fast ? 1200 : EARN.catch.biteMin, hi = fast ? 3500 : EARN.catch.biteMax;
      e.cast = { kind, at: now, bite: now + lo + rnd(hi - lo) }; e.castAt = now;
      if (spot) await this.go(ch, c, spot, now + 5 * MIN);
      await this.save(ch, c, e);
      return { ok: true, kind, at: now, biteIn: e.cast.bite - now }; // the browser shows the bite when it comes
    });
  }
  async reel(id) {
    return this.world.change(async ch => {
      const { c } = await this.lock(ch, id), e = this.stateOf(c), now = Date.now();
      if (!e.cast) throw new HttpError(409, kindMsg());
      const { kind, bite } = e.cast; e.cast = null;
      if (now < bite - 150) { await this.save(ch, c, e); return { ok: true, kind, result: 'early' }; }
      if (now > bite + EARN.catch.window) { await this.save(ch, c, e); return { ok: true, kind, result: 'late' }; }
      const got = pick(LOOT[kind]); e.catches++;
      const r = await this.pay(ch, c, got.pay, kind === 'fish' ? 'fish' : 'forage'); await this.save(ch, c, e);
      if (got.pay >= 300 && r.paid) await ch.event(`${got.icon} @${c.handle} ${kind === 'fish' ? 'fished up' : 'found'} ${got.name.toLowerCase()} and sold it for ${fmt(r.paid)} coins!`, 'find');
      return { ok: true, kind, result: 'caught', item: got, ...r, coins: c.coins_base, left: EARN.catch.perDay - e.catches };
    });
  }

  // ---------- scavenging: two minutes searching the old drop pods by the landing station ----------
  async scavenge(id, action) {
    return this.world.change(async ch => {
      const { c } = await this.lock(ch, id), e = this.stateOf(c), now = Date.now();
      if (action === 'start') {
        if (e.scav) throw new HttpError(409, "You're already searching.");
        if (e.scavDone >= EARN.scavenge.perDay) throw new HttpError(429, "You've searched the wreckage enough for one day.");
        const meteor = (await this.event()) === 'meteor';
        if (!meteor && now < (e.scavAt || 0) + EARN.scavenge.cooldown) throw new HttpError(429, `Others are picking over it right now. Try again in ${Math.ceil(((e.scavAt || 0) + EARN.scavenge.cooldown - now) / MIN)} min.`);
        const land = (await ch.q("select * from buildings where type = 'landing' and done and not ruin limit 1")).rows[0];
        if (!land) throw new HttpError(409, "There's no landing station to search around.");
        e.scav = { at: now, until: now + EARN.scavenge.length / (meteor ? 2 : 1) }; e.scavAt = meteor ? 0 : now;
        await this.go(ch, c, land, e.scav.until + MIN); await this.save(ch, c, e);
        return { ok: true, scav: e.scav };
      }
      if (action === 'collect') {
        if (!e.scav) throw new HttpError(409, 'Start a search first.');
        if (now < e.scav.until - 1000) throw new HttpError(409, `Still searching: ${Math.ceil((e.scav.until - now) / 1000)} s to go.`);
        e.scav = null; e.scavDone++; const got = pick(LOOT.scavenge);
        const r = await this.pay(ch, c, got.pay, 'scavenged'); await this.save(ch, c, e);
        if (got.pay >= 1000 && r.paid) await ch.event(`${got.icon} @${c.handle} found ${got.name.toLowerCase()} in the old drop pods!`, 'find');
        return { ok: true, item: got, ...r, coins: c.coins_base, left: EARN.scavenge.perDay - e.scavDone };
      }
      throw new HttpError(400, 'Start or collect.');
    });
  }
}
const kindMsg = () => 'Cast your line (or start looking) first.';
