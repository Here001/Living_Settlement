// What a signed-in colonist can do themself: commit a crime, go somewhere, and keep a pet.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { bump } from './achievements.js';
import { score } from './leaderboards.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { BUILDING_TYPES } from '../shared/catalog.js';
import { CREATURES, petPrice } from '../shared/creatures.js';
import { treasuryAdd } from './races.js';

export const CRIME_COOLDOWN = 10 * 60 * 1000;    // one crime every 10 real minutes
export const JAIL_TIME = 10 * 60 * 1000;         // caught: 10 real minutes in the Jail
export const VISIT_TIME = 4 * 60 * R.GAME_MIN_MS; // going somewhere lasts 4 game hours (5 real minutes)
const fmt = n => Math.round(n).toLocaleString('en-US');
const rand = () => crypto.randomInt(0, 1e9) / 1e9;
const nameOf = b => b.name || BUILDING_TYPES[b.type]?.name || 'a building';
const POLICE = ['police', 'commissariat'];
const SHOPS = Object.keys(BUILDING_TYPES).filter(k => BUILDING_TYPES[k].cat === 'shops');
// Places a colonist can go: anywhere people hang out, shop or eat, plus landmarks and parks.
const VISITABLE = Object.keys(BUILDING_TYPES).filter(k => { const t = BUILDING_TYPES[k]; return t.leisure || ['shops', 'parks', 'landmarks'].includes(t.cat); });

export class Actions {
  constructor(world) { this.world = world; }

  // Why this colonist can't act right now (jail), or null.
  async blockedReason(c) {
    const until = Number(c.jailed_until || 0);
    if (until > Date.now()) { const m = Math.max(1, Math.ceil((until - Date.now()) / 60000)); return `You're in jail for ${m} more minute${m === 1 ? '' : 's'}.`; }
    return null;
  }
  async load(ch, id) {
    const c = (await ch.q('select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where c.id = $1 for update of c', [id])).rows[0];
    if (!c) throw new HttpError(404, 'No such citizen.');
    if (!c.home_id) throw new HttpError(400, "You're still in cryosleep. Wake up and move in first.");
    const why = await this.blockedReason(c); if (why) throw new HttpError(409, why);
    const hx = c.hx, hy = c.hy; delete c.hx; delete c.hy; return { c, hx, hy };
  }
  async setVisit(ch, c, b, until) {
    if (!b) { await ch.q('update citizens set visit_until = least(visit_until, $2) where id = $1 and visit_until > $2', [c.id, Date.now()]); ch.touch(c); return; } // ending early: head back from here
    await ch.q('update citizens set visit_from = case when visit_id = $2 and visit_until > $6 then visit_from else $6 end, visit_id = $2, visit_until = $3, visit_cx = $4, visit_cy = $5 where id = $1', [c.id, b.id, until, b.cx, b.cy, Date.now()]);
    const before = ch.citizens.get(c.id) || []; ch.touch(c);
    if (b) ch.citizens.set(c.id, [...new Set([...before, ...(ch.citizens.get(c.id) || []), R.chunkKey(b.cx, b.cy)])]);
  }
  // Where a colonist is now, for pickpocketing: 'home', 'work', 'jail' or 'out'.
  async whereIs(ch, c, now = Date.now()) {
    if (Number(c.jailed_until || 0) > now) return 'jail';
    if (c.visit_id && Number(c.visit_until || 0) > now && Number(c.visit_from || 0) <= now) { // on a trip they chose
      const b = (await (ch.q ? ch.q('select type from buildings where id = $1', [c.visit_id]) : ch.query('select type from buildings where id = $1', [c.visit_id]))).rows[0];
      if (!b) return 'out'; if (b.type === 'jail') return 'jail'; if (BUILDING_TYPES[b.type]?.home) return 'home';
      return c.job_id && c.visit_id === c.job_id ? 'work' : 'out';
    }
    const meta = this.world.meta; if (!meta) return 'out';
    return R.routineAt(R.gameMinutes(now, meta.epoch), !!c.job_id);
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
    const b = (visiting && await at(v.visit_id)) || (where === 'work' && await at(v.job_id)) || (where === 'out' && await at(v.hang_id)) || await at(v.home_id);
    return b ? { x: b.x, y: b.y, name: b.name || BUILDING_TYPES[b.type]?.name || 'town' } : { x: v.hx, y: v.hy, name: 'town' };
  }
  // A personal notice: shown straight away if they're online, and kept until they've seen it.
  async notify(ch, citizenId, kind, text) {
    const t = Date.now(), id = (await ch.q('insert into notices (citizen_id, t, kind, text) values ($1, $2, $3, $4) returning id', [citizenId, t, kind, text])).rows[0].id;
    ch.extraOps.push({ op: 'notice', private: true, to: [citizenId], data: { id: String(id), t, kind, text } });
    ch.pushes.push([[citizenId], { kind: kind === 'pickpocket' ? 'crime' : kind, title: kind === 'pickpocket' ? (text.startsWith('🚓') ? 'Thief caught: you’ve been refunded' : 'Your pocket was picked') : 'Resurgence', body: text.replace(/^\S+\s/, ''), tag: 'notice-' + id }]);
  }
  async notices(id) {
    const rows = (await pool.query('update notices set seen = true where id in (select id from notices where citizen_id = $1 and not seen order by t desc limit 20) returning id, t, kind, text', [id])).rows;
    return { notices: rows.map(n => ({ ...n, id: String(n.id), t: Number(n.t) })).sort((a, b) => b.t - a.t) };
  }
  async seenNotice(id, noticeId) { await pool.query('update notices set seen = true where citizen_id = $1 and id = $2', [id, Number(noticeId) || 0]); return { ok: true }; }
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
    const rob = shop ? { ...R.crimeOdds('rob', await this.policeDist(pool, shop.x, shop.y), wave), shop: nameOf(shop) } : null;
    let pick = null;
    const h = target && R.cleanHandle(target);
    if (h) { const v = (await pool.query('select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where lower(c.handle) = lower($1)', [h])).rows[0];
      if (!v) pick = { error: `There's no colonist called @${h}.` };
      else { const where = await this.whereIs(pool, v, now), scene = await this.sceneOf(pool, v, where);
        const blocked = !v.home_id ? 'still in cryosleep' : where === 'home' ? 'safe at home' : where === 'jail' ? 'locked up' : where === 'work' && v.job_id !== c.job_id ? 'at work' : null;
        pick = { handle: v.handle, where, at: scene.name, blocked, ...R.crimeOdds('pickpocket', await this.policeDist(pool, scene.x, scene.y), wave) }; } }
    return { housed: !!c.home_id, jailedFor: Math.max(0, Number(c.jailed_until || 0) - now), waitFor: Math.max(0, Number(c.crime_at || 0) + CRIME_COOLDOWN - now), wave,
      rates: R.CRIME_RATES, near: R.CRIME_NEAR, far: R.CRIME_FAR, rob, pick };
  }
  async crime(id, { kind, target }) {
    if (kind !== 'pickpocket' && kind !== 'rob') throw new HttpError(400, 'Pick a crime: pickpocket or rob a shop.');
    return this.world.change(async ch => {
      const { c, hx, hy } = await this.load(ch, id), now = Date.now();
      const wait = Number(c.crime_at || 0) + CRIME_COOLDOWN - now;
      if (wait > 0) throw new HttpError(429, `Lie low for ${Math.ceil(wait / 60000)} more minute${wait > 60000 ? 's' : ''} before trying again.`);
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
        loot = Math.max(1, Math.min(300, Math.floor(victim.coins_base * (0.1 + rand() * 0.15))));
      } else {
        shop = (await ch.q(`select * from buildings where type = any($3) and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [hx, hy, SHOPS])).rows[0];
        if (!shop) throw new HttpError(409, 'There are no shops to rob.');
        px = shop.x; py = shop.y; loot = Math.max(1, Math.min(R.treasuryOn(ch.meta, ch.today), Math.floor(60 + rand() * 340)));
      }
      // The farther the nearest Police station is from the scene, the likelier the thief gets away (a crime wave helps too).
      const odds = R.crimeOdds(kind, await this.policeDist(ch.db, px, py), await this.waveNow()), chance = odds.chance;
      await ch.q('update citizens set crime_at = $2 where id = $1', [c.id, now]);
      ch.coins(c);
      if (rand() < chance) {
        c.coins_base += loot; ch.touch(c); await ch.saveCitizen(c); await bump(ch, c.id, { crimes: 1 }); await score(ch, c.id, 'crimes', 1);
        if (victim) { victim.coins_base -= loot; ch.touch(victim); await ch.saveCitizen(victim); await ch.event(`👛 Someone picked @${victim.handle}'s pocket and got away with ${fmt(loot)} coins!`, 'crime');
          await this.notify(ch, victim.id, 'pickpocket', `👛 Someone just picked your pocket and got away with ${fmt(loot)} coins. Keep your cash in a Bank to keep it safe.`); }
        else { treasuryAdd(ch, -loot); await ch.event(`🚨 ${nameOf(shop)} was robbed of ${fmt(loot)} coins! The thief got away.`, 'crime'); }
        return { ok: true, caught: false, loot, coins: c.coins_base, chance, band: odds.band, police: odds.dist };
      }
      // Caught: a fine (twice what they tried to take, at least 25, never more than they have), and jail if the colony has one.
      const fine = Math.min(c.coins_base, Math.max(25, loot * 2)); c.coins_base -= fine; treasuryAdd(ch, fine); ch.touch(c); await ch.saveCitizen(c);
      const jail = (await ch.q(`select * from buildings where type = 'jail' and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [px, py])).rows[0];
      const what = victim ? `pickpocketing @${victim.handle}` : `robbing ${nameOf(shop)}`;
      if (victim) await this.notify(ch, victim.id, 'pickpocket', `🚓 @${c.handle} picked your pocket but got caught by the police. Your ${fmt(loot)} coins have been refunded.`);
      if (jail) {
        const until = now + JAIL_TIME; await ch.q('update citizens set jailed_until = $2 where id = $1', [c.id, until]); await bump(ch, c.id, { jailed: 1 }); await this.setVisit(ch, c, jail, until);
        await ch.event(`🚓 @${c.handle} was caught ${what}, fined ${fmt(fine)} coins and locked up for ${JAIL_TIME / 60000} minutes.`, 'crime');
      } else await ch.event(`🚓 @${c.handle} was caught ${what} and fined ${fmt(fine)} coins.`, 'crime');
      return { ok: true, caught: true, fine, jailed: !!jail, jailFor: jail ? JAIL_TIME : 0, coins: c.coins_base, chance, band: odds.band, police: odds.dist };
    });
  }

  // ---------- going somewhere ----------
  async places(id) {
    const c = (await pool.query('select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where c.id = $1', [id])).rows[0];
    if (!c) throw new HttpError(404, 'No such citizen.'); if (!c.home_id) return { housed: false, places: [] };
    const rows = (await pool.query(`select id, type, name, x, y from buildings where type = any($3) and done and not ruin
      order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 15`, [c.hx, c.hy, VISITABLE])).rows;
    const v = c.visit_id && Number(c.visit_until) > Date.now() ? (await pool.query('select id, type, name from buildings where id = $1', [c.visit_id])).rows[0] : null;
    return { housed: true, jailed: Number(c.jailed_until || 0) > Date.now(), visiting: v ? { id: v.id, name: nameOf(v), until: Number(c.visit_until) } : null,
      places: rows.map(b => ({ id: b.id, name: nameOf(b), type: b.type, dist: Math.abs(b.x - c.hx) + Math.abs(b.y - c.hy) })) };
  }
  // Send the colonist to a place, or to a friend's home (by username). null ends the visit.
  async visit(id, { buildingId, friend }) {
    return this.world.change(async ch => {
      const { c } = await this.load(ch, id);
      if (!buildingId && !friend) { await this.setVisit(ch, c, null); return { ok: true, home: true }; }
      let b, label;
      if (friend) {
        const f = (await ch.q('select c.handle, h.* from citizens c join buildings h on h.id = c.home_id where lower(c.handle) = lower($1)', [R.cleanHandle(friend)])).rows[0];
        if (!f) throw new HttpError(404, `@${R.cleanHandle(friend)} doesn't have a home yet.`);
        if (f.handle.toLowerCase() === c.handle.toLowerCase()) throw new HttpError(400, "That's your own home.");
        b = f; label = `@${f.handle}'s home`;
      } else {
        b = (await ch.q('select * from buildings where id = $1 and done and not ruin', [String(buildingId)])).rows[0];
        if (!b || !VISITABLE.includes(b.type)) throw new HttpError(400, "You can't go there. Pick a park, shop or place to hang out.");
        label = nameOf(b);
      }
      const until = Date.now() + VISIT_TIME; await this.setVisit(ch, c, b, until); await bump(ch, c.id, { outings: 1 });
      return { ok: true, place: label, until };
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
    return this.world.change(async ch => {
      const store = (await ch.q("select id from buildings where id = $1 and type = 'petstore' and done and not ruin", [buildingId])).rows[0];
      if (!store) throw new HttpError(409, "That isn't an open Pet store.");
      const { c } = await this.load(ch, id);
      if (c.pet) throw new HttpError(409, 'You already have a pet. Let it go first if you want a different one.');
      ch.coins(c); if (c.coins_base < price) throw new HttpError(400, `A ${CREATURES[kind].name} costs ${fmt(price)} coins. You have ${fmt(c.coins_base)} on you.`);
      c.coins_base -= price; treasuryAdd(ch, price); ch.touch(c); await ch.saveCitizen(c);
      const pet = { k: kind, n: n || CREATURES[kind].name }; await ch.q('update citizens set pet = $2 where id = $1', [c.id, JSON.stringify(pet)]); await bump(ch, c.id, { pets: 1 });
      await ch.event(`🐾 @${c.handle} adopted a ${CREATURES[kind].name.toLowerCase()} called ${pet.n}.`, 'pet'); // News flash
      return { ok: true, pet, price, coins: c.coins_base };
    });
  }
  async renamePet(id, name) {
    const n = String(name || '').trim().replace(/\s+/g, ' ');
    if (!/^[\p{L}][\p{L} '-]{0,19}$/u.test(n)) throw new HttpError(400, 'Use letters only for your pet’s name (up to 20).');
    return this.world.change(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c?.pet) throw new HttpError(400, "You don't have a pet.");
      const pet = { ...c.pet, n }; await ch.q('update citizens set pet = $2 where id = $1', [id, JSON.stringify(pet)]); ch.touch(c); return { ok: true, pet };
    });
  }
  async release(id) {
    return this.world.change(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c?.pet) throw new HttpError(400, "You don't have a pet.");
      await ch.q('update citizens set pet = null where id = $1', [id]); ch.touch(c); return { ok: true };
    });
  }
}
