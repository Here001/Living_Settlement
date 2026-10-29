// What a signed-in colonist can do themself: commit a crime, go somewhere, and keep a pet.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { BUILDING_TYPES } from '../shared/catalog.js';
import { CREATURES } from '../shared/creatures.js';
import { treasuryAdd } from './races.js';

export const CRIME_COOLDOWN = 10 * 60 * 1000;    // one crime every 10 real minutes
export const JAIL_TIME = 10 * 60 * 1000;         // caught: 10 real minutes in the Jail
export const VISIT_TIME = 4 * 60 * R.GAME_MIN_MS; // going somewhere lasts 4 game hours (5 real minutes)
export const PET_PRICE = 200;
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
    await ch.q('update citizens set visit_id = $2, visit_until = $3, visit_cx = $4, visit_cy = $5 where id = $1', [c.id, b?.id ?? null, b ? until : null, b?.cx ?? null, b?.cy ?? null]);
    const before = ch.citizens.get(c.id) || []; ch.touch(c);
    if (b) ch.citizens.set(c.id, [...new Set([...before, ...(ch.citizens.get(c.id) || []), R.chunkKey(b.cx, b.cy)])]);
  }
  async policeNear(ch, x, y) {
    return Number((await ch.q(`select count(*) n from buildings where type = any($3) and done and not ruin and abs(x - $1::int) + abs(y - $2::int) <= 40`, [x, y, POLICE])).rows[0].n);
  }

  // ---------- crime ----------
  // A pickpocket targets another colonist; a robbery hits the nearest shop's till (paid by the colony treasury).
  // Each Police station within 40 tiles makes getting caught likelier. Caught: a fine, and time in the Jail if there is one.
  async crimeInfo(id) {
    const c = (await pool.query('select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where c.id = $1', [id])).rows[0];
    if (!c) throw new HttpError(404, 'No such citizen.');
    const now = Date.now(), police = c.home_id ? Number((await pool.query(`select count(*) n from buildings where type = any($3) and done and not ruin and abs(x - $1::int) + abs(y - $2::int) <= 40`, [c.hx, c.hy, POLICE])).rows[0].n) : 0;
    return { housed: !!c.home_id, jailedFor: Math.max(0, Number(c.jailed_until || 0) - now), waitFor: Math.max(0, Number(c.crime_at || 0) + CRIME_COOLDOWN - now), police,
      chance: { pickpocket: Math.max(0.15, 0.55 - 0.12 * Math.min(3, police)), rob: Math.max(0.15, 0.4 - 0.12 * Math.min(3, police)) } };
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
        px = victim.hx; py = victim.hy; delete victim.hx; delete victim.hy;
        ch.coins(victim); if (victim.coins_base < 5) throw new HttpError(400, `@${victim.handle}'s pockets are empty.`);
        loot = Math.max(1, Math.min(300, Math.floor(victim.coins_base * (0.1 + rand() * 0.15))));
      } else {
        shop = (await ch.q(`select * from buildings where type = any($3) and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [hx, hy, SHOPS])).rows[0];
        if (!shop) throw new HttpError(409, 'There are no shops to rob.');
        px = shop.x; py = shop.y; loot = Math.max(1, Math.min(R.treasuryOn(ch.meta, ch.today), Math.floor(60 + rand() * 340)));
      }
      const police = await this.policeNear(ch, px, py), chance = Math.max(0.15, (kind === 'rob' ? 0.4 : 0.55) - 0.12 * Math.min(3, police));
      await ch.q('update citizens set crime_at = $2 where id = $1', [c.id, now]);
      ch.coins(c);
      if (rand() < chance) {
        c.coins_base += loot; ch.touch(c); await ch.saveCitizen(c);
        if (victim) { victim.coins_base -= loot; ch.touch(victim); await ch.saveCitizen(victim); await ch.event(`👛 Someone picked @${victim.handle}'s pocket and got away with ${fmt(loot)} coins!`, 'crime'); }
        else { treasuryAdd(ch, -loot); await ch.event(`🚨 ${nameOf(shop)} was robbed of ${fmt(loot)} coins! The thief got away.`, 'crime'); }
        return { ok: true, caught: false, loot, coins: c.coins_base, chance };
      }
      // Caught: a fine (twice what they tried to take, at least 25, never more than they have), and jail if the colony has one.
      const fine = Math.min(c.coins_base, Math.max(25, loot * 2)); c.coins_base -= fine; treasuryAdd(ch, fine); ch.touch(c); await ch.saveCitizen(c);
      const jail = (await ch.q(`select * from buildings where type = 'jail' and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [px, py])).rows[0];
      const what = victim ? `pickpocketing @${victim.handle}` : `robbing ${nameOf(shop)}`;
      if (jail) {
        const until = now + JAIL_TIME; await ch.q('update citizens set jailed_until = $2 where id = $1', [c.id, until]); await this.setVisit(ch, c, jail, until);
        await ch.event(`🚓 @${c.handle} was caught ${what}, fined ${fmt(fine)} coins and locked up for ${JAIL_TIME / 60000} minutes.`, 'crime');
      } else await ch.event(`🚓 @${c.handle} was caught ${what} and fined ${fmt(fine)} coins.`, 'crime');
      return { ok: true, caught: true, fine, jailed: !!jail, jailFor: jail ? JAIL_TIME : 0, coins: c.coins_base, chance };
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
      const until = Date.now() + VISIT_TIME; await this.setVisit(ch, c, b, until);
      return { ok: true, place: label, until };
    });
  }

  // ---------- pets ----------
  async adopt(id, { kind, name }) {
    if (!CREATURES[kind]) throw new HttpError(400, 'Pick one of the native creatures.');
    const n = String(name || '').trim().replace(/\s+/g, ' ');
    if (n && !/^[\p{L}][\p{L} '-]{0,19}$/u.test(n)) throw new HttpError(400, 'Use letters only for your pet’s name (up to 20).');
    return this.world.change(async ch => {
      const { c } = await this.load(ch, id);
      if (c.pet) throw new HttpError(409, 'You already have a pet. Let it go first if you want a different one.');
      ch.coins(c); if (c.coins_base < PET_PRICE) throw new HttpError(400, `Adopting costs ${PET_PRICE} coins. You have ${fmt(c.coins_base)}.`);
      c.coins_base -= PET_PRICE; treasuryAdd(ch, PET_PRICE); ch.touch(c); await ch.saveCitizen(c);
      const pet = { k: kind, n: n || CREATURES[kind].name }; await ch.q('update citizens set pet = $2 where id = $1', [c.id, JSON.stringify(pet)]);
      await ch.event(`🐾 @${c.handle} adopted a ${CREATURES[kind].name.toLowerCase()} called ${pet.n}.`, 'pet');
      return { ok: true, pet, coins: c.coins_base };
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
