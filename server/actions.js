// What a signed-in colonist can do themself: commit a crime, go somewhere, and keep a pet.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { bump } from './achievements.js';
import { score } from './leaderboards.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { BUILDING_TYPES, BANK_TYPES, kindOf, pgList } from '../shared/catalog.js';
import { CREATURES, petPrice } from '../shared/creatures.js';
import { treasuryAdd } from './races.js';
import { track, ledger } from './stats.js';
import * as MG from '../shared/minigames.js';

export const CRIME_COOLDOWN = 10 * 60 * 1000;    // one crime every 10 real minutes (after a failed or empty-handed one)
export const CRIME_QUICK = 20 * 1000;            // ...but only 20 seconds after one that came off
// Each job that comes off in a row makes the next one harder: a harder game, and the police are more on the lookout
// (fewer points from the setting). Getting caught wipes the slate clean.
export const STREAK_CHANCE = 0.07;
const waitText = ms => ms < 60000 ? `${Math.ceil(ms / 1000)} more seconds` : `${Math.ceil(ms / 60000)} more minute${ms > 60000 ? 's' : ''}`;
const streakDiff = (base, streak) => Math.min(5, base + Math.min(4, streak || 0));
const streakChance = (chance, streak) => Math.max(0.05, chance - STREAK_CHANCE * (streak || 0));
export const JAIL_TIME = 10 * 60 * 1000;         // caught: 10 real minutes in the Jail
export const VISIT_TIME = 4 * 60 * R.GAME_MIN_MS; // going somewhere lasts 4 game hours (5 real minutes)
const fmt = n => Math.round(n).toLocaleString('en-US');
const rand = () => crypto.randomInt(0, 1e9) / 1e9;
const nameOf = b => b.name || BUILDING_TYPES[b.type]?.name || 'a building';
const POLICE = ['police', 'commissariat'];
const SHOPS = Object.keys(BUILDING_TYPES).filter(k => BUILDING_TYPES[k].cat === 'shops' && k !== 'cardealer');
const BANKS = BANK_TYPES;
// Places a colonist can go: anywhere people hang out, shop or eat, plus landmarks and parks.
const VISITABLE = Object.keys(BUILDING_TYPES).filter(k => { const t = BUILDING_TYPES[k]; return t.leisure || ['shops', 'parks', 'landmarks'].includes(t.cat); });

export class Actions {
  constructor(world) { this.world = world; this.origins = new Map(); }

  // Why this colonist can't act right now (jail), or null.
  async blockedReason(c) {
    const until = Number(c.jailed_until || 0);
    if (until > Date.now()) { const m = Math.max(1, Math.ceil((until - Date.now()) / 60000)); return `You're in jail for ${m} more minute${m === 1 ? '' : 's'}.`; }
    return null;
  }
  // Bail: out of jail now, for a price that falls as the time left runs down. Paid from cash, then savings; unlike a fine
  // it can't be owed, so you need the coins.
  async bail(id) {
    return this.world.change(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
      const left = Number(c.jailed_until || 0) - Date.now(); if (left <= 0) throw new HttpError(409, "You're not in jail.");
      const cost = R.bailCost(left); ch.coins(c); const bank = Number(c.bank || 0);
      if (Math.max(0, c.coins_base) + bank < cost) throw new HttpError(400, `Bail is ${fmt(cost)} coins, and you have ${fmt(Math.max(0, c.coins_base))} on you${bank ? ` and ${fmt(bank)} in the bank` : ''}.`);
      const paid = await ch.takeFrom(c, cost); treasuryAdd(ch, cost); track(ch, 'crime:bail', cost, c.id); ch.touch(c); await ch.saveCitizen(c);
      await ch.q('update citizens set jailed_until = null where id = $1', [c.id]); c.jailed_until = null; await this.setVisit(ch, c, null);
      await ch.event(`🔓 @${c.handle} paid ${fmt(cost)} coins bail and walked out of jail.`, 'crime');
      return { ok: true, cost, paid, coins: c.coins_base };
    });
  }
  async load(ch, id) {
    const c = (await ch.q('select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where c.id = $1 for update of c', [id])).rows[0];
    if (!c) throw new HttpError(404, 'No such citizen.');
    if (!c.home_id) throw new HttpError(400, "You're still in cryosleep. Wake up and move in first.");
    const why = await this.blockedReason(c); if (why) throw new HttpError(409, why);
    const hx = c.hx, hy = c.hy; delete c.hx; delete c.hy; return { c, hx, hy };
  }
  // Where a player's colonist really is right now (their phone works it out and sends it with the request), so a new
  // trip starts from there: mid-journey, or from the last place they went, not from where their routine would put them.
  noteOrigin(id, from) { if (!from || !Number.isFinite(Number(from.x)) || !Number.isFinite(Number(from.y))) return;
    const o = { x: Math.round(Number(from.x) * 100) / 100, y: Math.round(Number(from.y) * 100) / 100, b: typeof from.b === 'string' && from.b.length <= 64 ? from.b : null, t: Date.now() };
    if (Math.abs(o.x) > 1e6 || Math.abs(o.y) > 1e6) return; this.origins.set(id, o); if (this.origins.size > 5000) this.origins.clear(); }
  takeOrigin(id) { const o = this.origins.get(id); this.origins.delete(id); return o && Date.now() - o.t < 15000 ? o : null; }
  async setVisit(ch, c, b, until) {
    if (!b) { await ch.q('update citizens set visit_until = least(visit_until, $2) where id = $1 and visit_until > $2', [c.id, Date.now()]); ch.touch(c); return; } // ending early: head back from here
    const now = Date.now(), same = c.visit_id === b.id && Number(c.visit_until || 0) > now; // tapping the same place again changes nothing
    let origin = same ? c.visit_origin : this.takeOrigin(c.id), fare = 0, mode = 'walk';
    if (!same && kindOf(b.type) !== 'jail') { // travel costs: fuel for a car, a fare for a cab, there and back (walk if the cab is too dear)
      const home = c.home_id ? (await ch.q('select x, y from buildings where id = $1', [c.home_id])).rows[0] : null;
      const ox = origin ? origin.x : home ? home.x : b.x, oy = origin ? origin.y : home ? home.y : b.y, own = Array.isArray(c.cars) && c.cars.length > 0;
      const out = R.tripFare(Math.abs(ox - b.x) + Math.abs(oy - b.y), own), back = home ? R.tripFare(Math.abs(b.x - home.x) + Math.abs(b.y - home.y), own) : { fare: 0, mode: 'walk' };
      fare = out.fare + back.fare; mode = out.mode !== 'walk' ? out.mode : back.mode;
      ch.coins(c);
      if (fare > 0 && c.coins_base < fare) { origin = { ...(origin || {}), walk: true }; fare = 0; mode = 'walk'; } // can't afford it: walk
      else if (fare > 0) { c.coins_base -= fare; treasuryAdd(ch, fare); track(ch, 'travel', fare, c.id); await ch.saveCitizen(c); await bump(ch, c.id, { travel: fare }); }
      if (origin) delete origin.t;
    }
    await ch.q('update citizens set visit_from = case when visit_id = $2 and visit_until > $6 then visit_from else $6 end, visit_id = $2, visit_until = $3, visit_cx = $4, visit_cy = $5, visit_origin = $7 where id = $1',
      [c.id, b.id, until, b.cx, b.cy, now, origin ? JSON.stringify(origin) : null]);
    c.lastTrip = { fare, mode };
    const before = ch.citizens.get(c.id) || []; ch.touch(c);
    if (b) ch.citizens.set(c.id, [...new Set([...before, ...(ch.citizens.get(c.id) || []), R.chunkKey(b.cx, b.cy)])]);
  }
  // Where a colonist is now, for pickpocketing: 'home', 'work', 'jail' or 'out'.
  async whereIs(ch, c, now = Date.now()) {
    if (Number(c.jailed_until || 0) > now) return 'jail';
    if (c.visit_id && Number(c.visit_until || 0) > now && Number(c.visit_from || 0) <= now) { // on a trip they chose
      const b = (await (ch.q ? ch.q('select type from buildings where id = $1', [c.visit_id]) : ch.query('select type from buildings where id = $1', [c.visit_id]))).rows[0];
      if (!b) return 'out'; if (kindOf(b.type) === 'jail') return 'jail'; if (BUILDING_TYPES[b.type]?.home) return 'home';
      return c.job_id && c.visit_id === c.job_id ? 'work' : 'out';
    }
    const meta = this.world.meta; if (!meta) return 'out';
    const jt = c.job_id ? (await (ch.q ? ch.q('select type from buildings where id = $1', [c.job_id]) : ch.query('select type from buildings where id = $1', [c.job_id]))).rows[0]?.type : null;
    return R.routineAt(R.gameMinutes(now, meta.epoch), !!c.job_id, R.shiftOf(c.id, c.job_id, jt), R.owlOf(c.id));
  }
  // Tiles from (x, y) to the nearest working Police station, or null if the colony has none.
  async policeDist(db, x, y) {
    if (x == null || y == null) return null;
    const d = (await db.query(`select min(abs(x - $1::int) + abs(y - $2::int)) d from buildings where type = any($3) and done and not ruin`, [x, y, POLICE])).rows[0].d;
    return d == null ? null : Number(d);
  }
  // Where a pickpocket would find someone right now: the place they're visiting, their workplace, their hangout, or near home.
  async sceneOf(db, v, where) {
    const at = async id => id ? (await db.query('select id, x, y, type, name from buildings where id = $1', [id])).rows[0] : null;
    const now = Date.now(), visiting = v.visit_id && Number(v.visit_until || 0) > now && Number(v.visit_from || 0) <= now;
    if (visiting && /^spot:/.test(v.visit_id)) { const [x, y] = String(v.visit_id).slice(5).split(',').map(Number); return { x, y, name: 'the street' }; } // out on foot somewhere
    const b = (visiting && await at(v.visit_id)) || (where === 'work' && await at(v.job_id)) || (where === 'out' && await at(v.hang_id)) || await at(v.home_id);
    return b ? { x: b.x, y: b.y, name: b.name || BUILDING_TYPES[b.type]?.name || 'town' } : { x: v.hx, y: v.hy, name: 'town' };
  }
  // Many notices at once (weekly bills): one insert for all of them. rows: [[citizenId, kind, text], …]
  async notifyMany(ch, rows) {
    if (!rows.length) return; const t = Date.now();
    const ids = (await ch.q('insert into notices (citizen_id, t, kind, text) select i, $1, k, x from unnest($2::text[], $3::text[], $4::text[]) with ordinality u(i, k, x, n) order by n returning id',
      [t, rows.map(r => r[0]), rows.map(r => r[1]), rows.map(r => r[2])])).rows.map(r => r.id);
    rows.forEach(([cid, kind, text], i) => { ch.extraOps.push({ op: 'notice', private: true, to: [cid], data: { id: String(ids[i]), t, kind, text } });
      ch.pushes.push([[cid], { kind, title: kind === 'bills' ? '🧾 Weekly bills' : 'Resurgence', body: text.replace(/^\S+\s/, ''), tag: 'notice-' + ids[i] }]); });
  }
  // A personal notice: shown straight away if they're online, and kept until they've seen it.
  async notify(ch, citizenId, kind, text) {
    const t = Date.now(), id = (await ch.q('insert into notices (citizen_id, t, kind, text) values ($1, $2, $3, $4) returning id', [citizenId, t, kind, text])).rows[0].id;
    ch.extraOps.push({ op: 'notice', private: true, to: [citizenId], data: { id: String(id), t, kind, text } });
    ch.pushes.push([[citizenId], { kind: kind === 'pickpocket' ? 'crime' : kind, title: kind === 'pickpocket' ? (text.startsWith('🚓') ? 'Thief caught: you’ve been refunded' : 'Your pocket was picked') : kind === 'bills' ? '🧾 Weekly bills' : 'Resurgence', body: text.replace(/^\S+\s/, ''), tag: 'notice-' + id }]);
  }
  async notices(id) {
    const rows = (await pool.query('update notices set seen = true where id in (select id from notices where citizen_id = $1 and not seen order by t desc limit 20) returning id, t, kind, text', [id])).rows;
    return { notices: rows.map(n => ({ ...n, id: String(n.id), t: Number(n.t) })).sort((a, b) => b.t - a.t) };
  }
  async seenNotice(id, noticeId) { await pool.query('update notices set seen = true where citizen_id = $1 and id = $2', [id, Number(noticeId) || 0]); return { ok: true }; }
  // Crime odds, less a mayor's Tough on crime pledge (15 points, never below 5%).
  async odds(kind, dist, wave) { const meta = this.world.meta, o = R.crimeOdds(kind, dist, wave, !!meta && R.isNight(R.gameMinutes(Date.now(), meta.epoch)));
    if (await this.world.elections?.has('safety')) { o.chance = Math.max(0.05, Math.round((o.chance - 0.15) * 100) / 100); o.mayor = true; } return o; }
  async waveNow() { return this.world.cevents && (await this.world.cevents.kindNow()) === 'crimewave' ? 0.15 : 0; }

  // ---------- crime ----------
  // A pickpocket targets another colonist; a robbery hits the nearest shop's till (paid by the colony treasury).
  // Each Police station within 40 tiles makes getting caught likelier. Caught: a fine, and time in the Jail if there is one.
  // What the Crime tab shows: the odds of robbing the nearest shop and, given a username, of picking that colonist's pocket where they are now.
  async crimeInfo(id, target) {
    const c = (await pool.query('select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where c.id = $1', [id])).rows[0];
    if (!c) throw new HttpError(404, 'No such citizen.');
    const now = Date.now(), wave = await this.waveNow();
    const shop = c.home_id ? (await pool.query(`select * from buildings where type = any($3) and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [c.hx, c.hy, SHOPS])).rows[0] : null;
    const rob = shop ? { ...(await this.odds('rob', await this.policeDist(pool, shop.x, shop.y), wave)), shop: nameOf(shop) } : null;
    let pick = null;
    const h = target && R.cleanHandle(target);
    if (h) { const v = (await pool.query('select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where lower(c.handle) = lower($1)', [h])).rows[0];
      if (!v) pick = { error: `There's no colonist called @${h}.` };
      else { const where = await this.whereIs(pool, v, now), scene = await this.sceneOf(pool, v, where);
        const blocked = !v.home_id ? 'still in cryosleep' : where === 'home' ? 'safe at home' : where === 'jail' ? 'locked up' : where === 'work' && v.job_id !== c.job_id ? 'at work' : null;
        pick = { handle: v.handle, where, at: scene.name, blocked, ...(await this.odds('pickpocket', await this.policeDist(pool, scene.x, scene.y), wave)) }; } }
    const solo = {}; for (const [k, S] of Object.entries(R.SOLO_CRIMES)) { let x = c.hx, y = c.hy, at = null;
      if (S.needs === 'bank' && c.home_id) { const bk = (await pool.query(`select * from buildings where type = any($3) and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [c.hx, c.hy, BANKS])).rows[0]; if (!bk) continue; x = bk.x; y = bk.y; at = nameOf(bk); }
      if (c.home_id) solo[k] = { ...(await this.odds(k, await this.policeDist(pool, x, y), wave)), at }; }
    return { streak: Number(c.crime_streak || 0), solo, housed: !!c.home_id, jailedFor: Math.max(0, Number(c.jailed_until || 0) - now), waitFor: Math.max(0, Number(c.crime_at || 0) + CRIME_COOLDOWN - now), wave,
      rates: R.CRIME_RATES, near: R.CRIME_NEAR, far: R.CRIME_FAR, rob, pick };
  }
  async crime(id, { kind, target }) {
    if (MG.GAMES[kind]) throw new HttpError(409, 'This crime is a mini game now. Update the game (close and reopen it) to play it.');
    if (!['pickpocket', 'rob', ...Object.keys(R.SOLO_CRIMES)].includes(kind)) throw new HttpError(400, 'Pick a crime.');
    return this.world.change(async ch => {
      const { c, hx, hy } = await this.load(ch, id), now = Date.now();
      const wait = Number(c.crime_at || 0) + CRIME_COOLDOWN - now;
      if (wait > 0) throw new HttpError(429, `Lie low for ${waitText(wait)} before trying again.`);
      let victim = null, shop = null, loot = 0, px = hx, py = hy;
      if (kind === 'pickpocket') {
        const h = R.cleanHandle(target); if (!h) throw new HttpError(400, "Whose pocket? Type their username.");
        victim = (await ch.q('select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where lower(c.handle) = lower($1) for update of c', [h])).rows[0];
        if (!victim) throw new HttpError(404, `There's no colonist called @${h}.`);
        if (victim.id === c.id) throw new HttpError(400, "You can't pick your own pocket.");
        if (!victim.home_id) throw new HttpError(400, `@${victim.handle} is still in cryosleep.`);
        // Only someone out and about can have their pocket picked: not at home, and not at work, unless you work there too.
        const where = await this.whereIs(ch, victim, now);
        if (where === 'home') throw new HttpError(409, `@${victim.handle} is safe at home right now. Wait until they're out and about.`);
        if (where === 'jail') throw new HttpError(409, `@${victim.handle} is locked up in the Jail.`);
        if (where === 'work' && victim.job_id !== c.job_id) throw new HttpError(409, `@${victim.handle} is at work, and only their workmates can get close. Catch them on their lunch break or after work.`);
        const scene = await this.sceneOf(ch.db, victim, where); px = scene.x; py = scene.y; delete victim.hx; delete victim.hy; // where they are now
        ch.coins(victim); if (victim.coins_base < 5) throw new HttpError(400, `@${victim.handle}'s pockets are empty.`);
        loot = Math.max(1, Math.min(1500, Math.floor(victim.coins_base * (0.1 + rand() * 0.15))));
      } else if (R.SOLO_CRIMES[kind]) { // a con on the street near home, or the ATM at the nearest Bank
        const S = R.SOLO_CRIMES[kind];
        if (S.needs === 'bank') { shop = (await ch.q(`select * from buildings where type = any($3) and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [hx, hy, BANKS])).rows[0];
          if (!shop) throw new HttpError(409, "There's no Bank, so no ATM to hack."); px = shop.x; py = shop.y; }
        loot = Math.max(1, Math.min(R.treasuryOn(ch.meta, ch.today), Math.floor(S.loot[0] + rand() * (S.loot[1] - S.loot[0] + 1))));
      } else {
        shop = (await ch.q(`select * from buildings where type = any($3) and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [hx, hy, SHOPS])).rows[0];
        if (!shop) throw new HttpError(409, 'There are no shops to rob.');
        px = shop.x; py = shop.y; loot = Math.max(1, Math.min(R.treasuryOn(ch.meta, ch.today), Math.floor(5000 + rand() * 5001)));
      }
      // The farther the nearest Police station is from the scene, the likelier the thief gets away (a crime wave helps too).
      const odds = await this.odds(kind, await this.policeDist(ch.db, px, py), await this.waveNow()), chance = odds.chance;
      await ch.q('update citizens set crime_at = $2 where id = $1', [c.id, now]);
      ch.coins(c);
      if (rand() < chance) {
        c.coins_base += loot; ch.touch(c); await ch.saveCitizen(c); track(ch, victim ? 'crime:pickpocket' : 'crime:' + kind, loot, c.id); await bump(ch, c.id, { crimes: 1 }); await score(ch, c.id, 'crimes', 1);
        if (victim) { victim.coins_base -= loot; ledger(ch, victim.id, -loot, 'crime:victim', 'Pickpocketed'); ch.touch(victim); await ch.saveCitizen(victim); await ch.event(`👛 Someone picked @${victim.handle}'s pocket and got away with ${fmt(loot)} coins!`, 'crime');
          await this.notify(ch, victim.id, 'pickpocket', `👛 Someone just picked your pocket and got away with ${fmt(loot)} coins. Keep your cash in a Bank to keep it safe.`); }
        else { treasuryAdd(ch, -loot); await ch.event(kind === 'scam' ? `🎭 A tourist was conned out of ${fmt(loot)} coins. The con artist vanished.` : kind === 'atm' ? `🏧 The ATM at ${nameOf(shop)} was hacked for ${fmt(loot)} coins!` : `🚨 ${nameOf(shop)} was robbed of ${fmt(loot)} coins! The thief got away.`, 'crime'); }
        await ch.q('update citizens set crime_at = $2 where id = $1', [c.id, now - CRIME_COOLDOWN + CRIME_QUICK]); // it came off: lie low just a moment
        return { ok: true, caught: false, loot, coins: c.coins_base, chance, band: odds.band, police: odds.dist };
      }
      // Caught: a fine (twice what they tried to take, at least 250), and jail if the colony has one. The fine comes from
      // their cash, then their savings, and whatever's left puts their wallet in the minus.
      const fine = Math.max(250, loot * 2), paid = await ch.takeFrom(c, fine); treasuryAdd(ch, fine); track(ch, 'crime:fine', fine, c.id); ch.touch(c); await ch.saveCitizen(c);
      await this.notify(ch, c.id, 'crime', `🚓 You were caught and fined ${fmt(fine)} coins: ${paid.how}.`);
      const jail = (await ch.q(`select * from buildings where type = any('${pgList('jail')}') and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [px, py])).rows[0];
      const what = victim ? `pickpocketing @${victim.handle}` : kind === 'scam' ? 'conning a tourist' : kind === 'atm' ? `hacking the ATM at ${nameOf(shop)}` : `robbing ${nameOf(shop)}`;
      if (victim) await this.notify(ch, victim.id, 'pickpocket', `🚓 @${c.handle} picked your pocket but got caught by the police. Your ${fmt(loot)} coins have been refunded.`);
      if (jail) {
        const until = now + JAIL_TIME; await ch.q('update citizens set jailed_until = $2 where id = $1', [c.id, until]); await bump(ch, c.id, { jailed: 1 }); await this.setVisit(ch, c, jail, until);
        await ch.event(`🚓 @${c.handle} was caught ${what}, fined ${fmt(fine)} coins and locked up for ${JAIL_TIME / 60000} minutes.`, 'crime');
      } else await ch.event(`🚓 @${c.handle} was caught ${what} and fined ${fmt(fine)} coins.`, 'crime');
      return { ok: true, caught: true, fine, paid, jailed: !!jail, jailFor: jail ? JAIL_TIME : 0, coins: c.coins_base, chance, band: odds.band, police: odds.dist };
    });
  }

  // ---------- crime mini games ----------
  // Where a solo crime happens and what's there to take: the nearest shop, the ATM at the nearest Bank, or a tourist on
  // the street near home.
  async crimeScene(db, c, kind) {
    let shop = null, px = c.hx, py = c.hy, loot;
    if (MG.ROLES[kind]) return { shop: null, px, py, loot: 0 }; // practising a heist part: the setting is home turf
    if (kind === 'rob') { shop = (await db.query(`select * from buildings where type = any($3) and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [c.hx, c.hy, SHOPS])).rows[0];
      if (!shop) throw new HttpError(409, 'There are no shops to rob.'); loot = 5000 + Math.floor(rand() * 5001); }
    else { const S = R.SOLO_CRIMES[kind];
      if (S.needs === 'bank') { shop = (await db.query(`select * from buildings where type = any($3) and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [c.hx, c.hy, BANKS])).rows[0];
        if (!shop) throw new HttpError(409, "There's no Bank, so no ATM to hack."); }
      loot = Math.floor(S.loot[0] + rand() * (S.loot[1] - S.loot[0] + 1)); }
    if (shop) { px = shop.x; py = shop.y; }
    return { shop: shop ? { id: shop.id, name: nameOf(shop), type: shop.type, x: shop.x, y: shop.y } : null, px, py, loot };
  }
  // Deal a game: a level from a fresh seed, its difficulty from the setting, and (for real) the cooldown starts now, so
  // walking away from a bad game doesn't give you another go. Practice is free: no money, no risk, no waiting.
  async crimeStart(id, { kind, practice }) {
    if (!MG.GAMES[kind]) throw new HttpError(400, 'Pick a crime.');
    if (!practice && !MG.SOLO.includes(kind)) throw new HttpError(400, 'Heist parts are played when the job goes live. You can practise them any time.');
    const go = async db => {
      const c = (await db.query(`select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where c.id = $1${practice ? '' : ' for update of c'}`, [id])).rows[0];
      if (!c) throw new HttpError(404, 'No such citizen.'); if (!c.home_id) throw new HttpError(400, "You're still in cryosleep.");
      const now = Date.now();
      if (!practice) { const why = await this.blockedReason(c); if (why) throw new HttpError(409, why);
        const wait = Number(c.crime_at || 0) + CRIME_COOLDOWN - now; if (wait > 0) throw new HttpError(429, `Lie low for ${waitText(wait)} before the next job. You can practise meanwhile.`); }
      const sc = await this.crimeScene(db, c, kind), wave = await this.waveNow(), odds = await this.odds(MG.ROLES[kind] ? 'armored' : kind, await this.policeDist(db, sc.px, sc.py), wave);
      const streak = practice ? 0 : Number(c.crime_streak || 0), diff = streakDiff(MG.difficultyOf(kind, odds.band), streak), chance = streakChance(odds.chance, streak), seed = crypto.randomInt(1, 2 ** 31), rid = crypto.randomUUID();
      await db.query('insert into crime_runs (id, citizen_id, kind, seed, diff, practice, started_at, chance, band, night, loot, scene) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [rid, id, kind, seed, diff, !!practice, now, chance, odds.band, !!odds.night, sc.loot, JSON.stringify(sc)]);
      if (!practice) await db.query('update citizens set crime_at = $2 where id = $1', [id, now]);
      await db.query('delete from crime_runs where citizen_id = $1 and started_at < $2', [id, now - 7 * 86400000]);
      return { id: rid, kind, seed, diff, streak, practice: !!practice, chance, band: odds.band, police: odds.dist, night: !!odds.night, wave, at: sc.shop?.name || null, loot: practice ? null : [Math.round(sc.loot * 0.3), Math.round(sc.loot * 1.5)] };
    };
    return practice ? go(pool) : this.world.change(ch => go({ query: (a, v) => ch.q(a, v) }));
  }
  // The game is over: replay what the player did with the game's own rules, score it, and settle.
  async crimeFinish(id, body) {
    const r = await this.crimeFinish0(id, body);
    if (r.heistId) { // a heist part: settle the job once the whole crew has played, and say where it stands
      await this.world.heists.settle(r.heistId).catch(e => console.error('heist settle:', e.message));
      r.heist = await this.world.heists.status(id, r.heistId).catch(() => null); }
    return r;
  }
  async crimeFinish0(id, { runId, log }) {
    return this.world.change(async ch => {
      const run = (await ch.q('select * from crime_runs where id = $1 for update', [String(runId || '')])).rows[0];
      if (!run || run.citizen_id !== id) throw new HttpError(404, 'No such game.'); if (run.finished_at) throw new HttpError(409, 'That game is already over.');
      const now = Date.now(), L = MG.levelOf(run.kind, Number(run.seed), run.diff), took = (now - Number(run.started_at)) / 1000;
      let rp = MG.replay(run.kind, L, log || {});
      // a result faster than the game can be played, or one that breaks the game's rules, counts as a botched job
      if (rp.ok && took + 4 < MG.minTime(run.kind, L, rp.state)) rp = { ok: false, why: 'too quick' };
      if (took > (L.limit || 75) + 600) rp = { ok: false, why: 'too late' };
      const perf = rp.ok ? rp.perf : 0, sc = MG.scoreOf(perf, Number(run.chance)), out = MG.outcomeOf(sc.total, rp.ok && rp.money);
      const res = { score: sc, outcome: out.key, title: out.title, mult: out.mult, game: rp.ok ? rp.state : { invalid: rp.why }, practice: run.practice };
      await ch.q('update crime_runs set finished_at = $2, result = $3 where id = $1', [run.id, now, JSON.stringify(res)]);
      if (run.heist_id) return { ...res, money: 0, heistId: run.heist_id, role: run.kind };
      if (run.practice) return { ...res, money: 0, practiceLoot: out.mult ? Math.round(Number(run.loot) * out.mult) : 0 };
      return { ...res, ...(await this.settleCrime(ch, id, run, out, sc, rp.ok ? rp.extra || 0 : 0)) };
    });
  }
  async settleCrime(ch, id, run, out, sc, extra = 0) {
    const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
    const scene = run.scene || {}, shop = scene.shop, kind = run.kind, base = Number(run.loot);
    const where = kind === 'scam' ? 'conning a tourist' : kind === 'atm' ? `hacking the ATM at ${shop?.name || 'the Bank'}` : `robbing ${shop?.name || 'a shop'}`;
    ch.coins(c);
    if (out.mult > 0) {
      // the extra loot grabbed in a shop adds to the takings
      const loot = Math.max(1, Math.min(R.treasuryOn(ch.meta, ch.today), Math.round(base * out.mult * (1 + MG.STEALTH.itemBonus * extra))));
      c.coins_base += loot; ch.touch(c); await ch.saveCitizen(c); treasuryAdd(ch, -loot); track(ch, 'crime:' + kind, loot, c.id); await bump(ch, c.id, { crimes: 1 }); await score(ch, c.id, 'crimes', 1);
      await ch.event(kind === 'scam' ? `🎭 A tourist was conned out of ${fmt(loot)} coins. The con artist vanished.` : kind === 'atm' ? `🏧 The ATM at ${shop?.name || 'the Bank'} was hacked for ${fmt(loot)} coins!` : `🚨 ${shop?.name || 'A shop'} was robbed of ${fmt(loot)} coins! The thief got away.`, 'crime');
      // it came off: lie low just a moment, but the next job will be harder
      const streak = Number(c.crime_streak || 0) + 1; await ch.q('update citizens set crime_at = $2, crime_streak = $3 where id = $1', [c.id, Date.now() - CRIME_COOLDOWN + CRIME_QUICK, streak]);
      return { money: loot, coins: c.coins_base, extra, streak, waitFor: CRIME_QUICK };
    }
    if (out.key === 'empty') { await ch.event(kind === 'scam' ? '🎭 A con artist tried their luck on a tourist and came away with nothing.' : kind === 'atm' ? `🏧 Someone tampered with the ATM at ${shop?.name || 'the Bank'}, but got nothing.` : `🚨 A thief slipped into ${shop?.name || 'a shop'} and out again, empty-handed.`, 'crime');
      return { money: 0, coins: c.coins_base }; }
    // caught: a fine (twice the takings on offer, at least 250) from cash, then savings, then into the minus; jail for the worst
    const fine = Math.max(250, base * 2), paid = await ch.takeFrom(c, fine); treasuryAdd(ch, fine); track(ch, 'crime:fine', fine, c.id); ch.touch(c); await ch.saveCitizen(c);
    await ch.q('update citizens set crime_streak = 0 where id = $1', [c.id]); // caught: the slate is wiped clean
    await this.notify(ch, c.id, 'crime', `🚓 You were caught ${where} and fined ${fmt(fine)} coins: ${paid.how}.`);
    let jailed = false;
    if (out.key === 'jailed') { const jail = (await ch.q(`select * from buildings where type = any('${pgList('jail')}') and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [scene.px ?? 0, scene.py ?? 0])).rows[0];
      if (jail) { const until = Date.now() + JAIL_TIME; await ch.q('update citizens set jailed_until = $2 where id = $1', [c.id, until]); await bump(ch, c.id, { jailed: 1 }); await this.setVisit(ch, c, jail, until); jailed = true; } }
    await ch.event(`🚓 @${c.handle} was caught ${where}${jailed ? `, fined ${fmt(fine)} coins and locked up for ${JAIL_TIME / 60000} minutes` : ` and fined ${fmt(fine)} coins`}.`, 'crime');
    return { money: 0, fine, paid, jailed, jailFor: jailed ? JAIL_TIME : 0, coins: c.coins_base };
  }

  // ---------- going somewhere ----------
  async places(id) {
    const c = (await pool.query('select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where c.id = $1', [id])).rows[0];
    if (!c) throw new HttpError(404, 'No such citizen.'); if (!c.home_id) return { housed: false, places: [] };
    const rows = (await pool.query(`select id, type, name, x, y from buildings where type = any($3) and done and not ruin
      order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 15`, [c.hx, c.hy, VISITABLE])).rows;
    const v = c.visit_id && Number(c.visit_until) > Date.now() ? (/^spot:/.test(c.visit_id) ? { id: c.visit_id, type: 'spot', name: 'a spot you picked on the map' } : (await pool.query('select id, type, name from buildings where id = $1', [c.visit_id])).rows[0]) : null;
    return { housed: true, jailed: Number(c.jailed_until || 0) > Date.now(), jailedFor: Math.max(0, Number(c.jailed_until || 0) - Date.now()), visiting: v ? { id: v.id, name: nameOf(v), until: Number(c.visit_until) } : null,
      places: rows.map(b => ({ id: b.id, name: nameOf(b), type: b.type, dist: Math.abs(b.x - c.hx) + Math.abs(b.y - c.hy) })) };
  }
  // Send the colonist to a place, or to a friend's home (by username). null ends the visit.
  // `spot` {x, y}: any tile on the map (a patch of grass, a street corner); they go there, stay a while, and come back.
  async visit(id, { buildingId, friend, spot }) {
    return this.world.personal(async ch => {
      const { c } = await this.load(ch, id);
      if (!buildingId && !friend && !spot) { await this.setVisit(ch, c, null); return { ok: true, home: true }; }
      let b, label;
      if (spot) {
        const x = Math.trunc(Number(spot.x)), y = Math.trunc(Number(spot.y));
        if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100000 || Math.abs(y) > 100000) throw new HttpError(400, 'Bad spot.');
        if ((await ch.q('select 1 from water where x = $1 and y = $2', [x, y])).rowCount) throw new HttpError(400, "That's water: pick a spot on dry land.");
        const [cx, cy] = R.chunkOf(x, y); b = { id: `spot:${x},${y}`, type: 'spot', x, y, cx, cy }; label = 'that spot';
      } else if (friend) {
        const f = (await ch.q('select c.handle, h.* from citizens c join buildings h on h.id = c.home_id where lower(c.handle) = lower($1)', [R.cleanHandle(friend)])).rows[0];
        if (!f) throw new HttpError(404, `@${R.cleanHandle(friend)} doesn't have a home yet.`);
        if (f.handle.toLowerCase() === c.handle.toLowerCase()) throw new HttpError(400, "That's your own home.");
        b = f; label = `@${f.handle}'s home`;
      } else {
        b = (await ch.q('select * from buildings where id = $1 and done and not ruin', [String(buildingId)])).rows[0];
        if (!b || !R.canGoTo(b.type)) throw new HttpError(400, b && R.NO_GO.has(b.type) ? "You can't just walk in there." : "You can't go there.");
        if (b.id === c.home_id) { await this.setVisit(ch, c, null); return { ok: true, home: true, place: 'home' }; } // going home
        label = nameOf(b);
      }
      const until = Date.now() + VISIT_TIME; await this.setVisit(ch, c, b, until); await bump(ch, c.id, { outings: 1 });
      return { ok: true, place: label, until, fare: c.lastTrip?.fare || 0, mode: c.lastTrip?.mode || 'walk', coins: c.coins_base };
    });
  }

  // ---------- pets ----------
  // Pets are adopted at a Pet store: the colonist taps one on the map and picks from its card.
  async adopt(id, { kind, name, buildingId }) {
    if (!CREATURES[kind]) throw new HttpError(400, 'Pick one of the native creatures.');
    const n = String(name || '').trim().replace(/\s+/g, ' ');
    if (n && !/^[\p{L}][\p{L} '-]{0,19}$/u.test(n)) throw new HttpError(400, 'Use letters only for your pet’s name (up to 20).');
    if (!buildingId) throw new HttpError(400, 'Pets are adopted at a Pet store: tap one on the map.');
    const price = petPrice(kind);
    return this.world.personal(async ch => {
      const store = (await ch.q("select id from buildings where id = $1 and type = 'petstore' and done and not ruin", [buildingId])).rows[0];
      if (!store) throw new HttpError(409, "That isn't an open Pet store.");
      const { c } = await this.load(ch, id);
      if (c.pet) throw new HttpError(409, 'You already have a pet. Let it go first if you want a different one.');
      ch.coins(c); if (c.coins_base < price) throw new HttpError(400, `A ${CREATURES[kind].name} costs ${fmt(price)} coins. You have ${fmt(c.coins_base)} on you.`);
      c.coins_base -= price; treasuryAdd(ch, price); track(ch, 'pet', price, c.id); ch.touch(c); await ch.saveCitizen(c);
      const pet = { k: kind, n: n || CREATURES[kind].name }; await ch.q('update citizens set pet = $2 where id = $1', [c.id, JSON.stringify(pet)]); await bump(ch, c.id, { pets: 1 });
      await ch.event(`🐾 @${c.handle} adopted a ${CREATURES[kind].name.toLowerCase()} called ${pet.n}.`, 'pet'); // News flash
      return { ok: true, pet, price, coins: c.coins_base };
    });
  }
  async renamePet(id, name) {
    const n = String(name || '').trim().replace(/\s+/g, ' ');
    if (!/^[\p{L}][\p{L} '-]{0,19}$/u.test(n)) throw new HttpError(400, 'Use letters only for your pet’s name (up to 20).');
    return this.world.personal(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c?.pet) throw new HttpError(400, "You don't have a pet.");
      const pet = { ...c.pet, n }; await ch.q('update citizens set pet = $2 where id = $1', [id, JSON.stringify(pet)]); ch.touch(c); return { ok: true, pet };
    });
  }
  async release(id) {
    return this.world.personal(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c?.pet) throw new HttpError(400, "You don't have a pet.");
      await ch.q('update citizens set pet = null where id = $1', [id]); ch.touch(c); return { ok: true };
    });
  }
}
