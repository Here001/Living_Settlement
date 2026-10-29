// Colonists' money beyond wages: the Bank, cars, choosing where to live, and owning buildings.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { BUILDING_TYPES, CAR_MODELS } from '../shared/catalog.js';
import { treasuryAdd } from './races.js';
import { bump } from './achievements.js';
import { score } from './leaderboards.js';

export const TREASURY_CUT = 0.2;        // the colony's share of every player business
export const BUSINESS_SHARE = 0.25;     // a business makes 25% of its wage bill in profit
// Savings grow 0.1% a game day (a game day is 30 real minutes), at most 20 coins a day each, and only while the
// treasury can pay it: interest moves existing coins around, it never creates them.
export const BANK_RATE = 0.001, BANK_CAP = 20;
export const GIFT_DAILY = 2000; // the most coins one colonist can gift in a game day
// Coming back every day: a reward once per real-world day (days start at midnight UTC), bigger the longer the streak,
// paid from the treasury. A week of it is worth about one real day of wages. Missing a day starts the streak again.
export const DAILY_REWARDS = [50, 75, 100, 125, 150, 200, 400];
export const DAILY_MILESTONES = new Set([7, 14, 30, 50, 100, 200, 365]);
const DAY_MS = 86400000, realDay = (t = Date.now()) => Math.floor(t / DAY_MS);
export const dailyRewardFor = streak => DAILY_REWARDS[(Math.max(1, streak) - 1) % DAILY_REWARDS.length];
export const MAX_CARS = 3, CAR_RESALE = 0.6, MAX_PROPERTIES = 5, PROPERTY_RESALE = 0.7;
const fmt = n => Math.round(n).toLocaleString('en-US');
const nameOf = b => b.name || BUILDING_TYPES[b.type]?.name || 'a building';
// What players may buy: homes and businesses. Public services, parks, landmarks, utilities and nature stay the colony's.
const BUYABLE_CATS = new Set(['housing', 'shops', 'offices', 'industry']);
export const buyable = type => { const t = BUILDING_TYPES[type]; return !!t && BUYABLE_CATS.has(t.cat) && !!(t.home || t.work); };
export const priceOf = type => Math.max(500, BUILDING_TYPES[type]?.cost || 0);
// A building's daily income for its owner, after the treasury's cut.
export function dailyIncome(b) {
  const t = BUILDING_TYPES[b.type] || {}; let gross = 0;
  if (t.home) gross += (b.home_used || 0) * (t.home.rent || 0);
  if (t.work) gross += (b.job_used || 0) * (t.work.salary || 0) * BUSINESS_SHARE;
  return { gross: Math.floor(gross), net: Math.floor(gross * (1 - TREASURY_CUT)) };
}

export class Economy {
  constructor(world) { this.world = world; }
  async lockMe(ch, id) {
    const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0];
    if (!c) throw new HttpError(404, 'No such citizen.');
    const why = this.world.blockedReason && await this.world.blockedReason(c); if (why) throw new HttpError(409, why);
    return c;
  }
  bankOn(c, today) { return Number(c.bank || 0); }

  // ---------- daily rewards ----------
  // streak: days in a row so far (0 once a day is missed); reward: what collecting now pays (or tomorrow, once collected);
  // day: where that collection falls in the 7-day cycle (1–7); missed: the streak that was lost by skipping a day.
  dailyState(c, now = Date.now()) {
    const today = realDay(now), last = c.daily_day ?? null, claimed = last === today, alive = last != null && last >= today - 1;
    const streak = alive ? Number(c.daily_streak || 0) : 0, upcoming = streak + 1;
    return { claimed, streak, best: Number(c.daily_best || 0), reward: dailyRewardFor(upcoming), day: ((claimed ? streak : upcoming) - 1) % 7 + 1,
      rewards: DAILY_REWARDS, resetsAt: (today + 1) * DAY_MS, missed: !alive && last != null && Number(c.daily_streak || 0) > 1 ? Number(c.daily_streak) : 0 };
  }
  async dailyInfo(id) {
    const c = (await pool.query('select daily_day, daily_streak, daily_best from citizens where id = $1', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
    return this.dailyState(c);
  }
  async daily(id) {
    return this.world.change(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
      const st = this.dailyState(c); if (st.claimed) throw new HttpError(409, `You've collected today's reward. Come back after midnight UTC for day ${st.streak + 1}.`);
      const streak = st.streak + 1, want = dailyRewardFor(streak), t = Math.floor(R.treasuryOn(ch.meta, ch.today)), paid = Math.max(0, Math.min(want, t));
      ch.coins(c); c.coins_base += paid; if (paid) treasuryAdd(ch, -paid);
      ch.touch(c); await ch.saveCitizen(c);
      await ch.q('update citizens set daily_day = $2, daily_streak = $3, daily_best = greatest(daily_best, $3) where id = $1', [c.id, realDay(), streak]);
      if (DAILY_MILESTONES.has(streak)) await ch.event(`🔥 @${c.handle} has come back ${streak} days in a row.`, 'streak');
      return { ok: true, streak, paid, wanted: want, short: paid < want, coins: c.coins_base, best: Math.max(Number(c.daily_best || 0), streak), next: dailyRewardFor(streak + 1), resetsAt: (realDay() + 1) * DAY_MS };
    });
  }

  // ---------- the Bank ----------
  async hasBank(db = pool) { return (await db.query("select 1 from buildings where type = 'bank' and done and not ruin limit 1")).rowCount > 0; }
  async bankInfo(id) {
    const c = (await pool.query('select * from citizens where id = $1', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
    const today = this.world.meta ? R.gameDay(Date.now(), this.world.meta.epoch) : 0;
    const bank = Number(c.bank || 0);
    return { hasBank: await this.hasBank(), wallet: R.balanceOn(c.coins_base, c.coins_day, c.net, today), bank, interest: Math.min(BANK_CAP, Math.floor(bank * BANK_RATE)), rate: BANK_RATE, cap: BANK_CAP };
  }
  async bank(id, kind, amount) {
    amount = Math.floor(Number(amount)); if (!(amount >= 1)) throw new HttpError(400, 'Enter an amount of at least 1 coin.');
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id); ch.coins(c);
      if (kind === 'deposit') {
        if (!(await this.hasBank(ch.db))) throw new HttpError(409, "The colony doesn't have a Bank yet.");
        if (c.coins_base < amount) throw new HttpError(400, `You only have ${fmt(c.coins_base)} coins on you.`);
        c.coins_base -= amount; c.bank = Number(c.bank || 0) + amount;
      } else {
        if (Number(c.bank || 0) < amount) throw new HttpError(400, `You only have ${fmt(c.bank || 0)} coins in the bank.`);
        c.bank = Number(c.bank) - amount; c.coins_base += amount;
      }
      ch.touch(c); await ch.saveCitizen(c); await ch.q('update citizens set bank = $2 where id = $1', [c.id, c.bank]);
      return { ok: true, wallet: c.coins_base, bank: c.bank, coins: c.coins_base };
    });
  }

  // ---------- the developer adjusts a colonist's coins ----------
  // Adding takes the coins from the treasury and taking away puts them back, so the colony's total stays the same.
  async adjust(id, amount, { fromTreasury = true } = {}) {
    amount = Math.trunc(Number(amount)); if (!amount || Math.abs(amount) > 10000000) throw new HttpError(400, 'Enter an amount (use a minus sign to take coins away).');
    return this.world.change(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
      ch.coins(c);
      if (amount < 0 && c.coins_base < -amount) throw new HttpError(400, `@${c.handle} only has ${fmt(c.coins_base)} coins on them.`);
      if (amount > 0 && fromTreasury) { const t = R.treasuryOn(ch.meta, ch.today); if (t < amount) throw new HttpError(400, `The treasury only has ${fmt(t)} coins.`); }
      c.coins_base += amount; if (fromTreasury) treasuryAdd(ch, -amount); ch.touch(c); await ch.saveCitizen(c);
      return { ok: true, coins: c.coins_base, treasury: R.treasuryOn(ch.meta, ch.today) };
    });
  }

  // ---------- gifts ----------
  // A colonist sends coins to another verified colonist: from their pocket first, and the rest from their bank savings.
  // At most GIFT_DAILY a game day, so nobody can pour a stack of accounts into one. Only avatars that have been claimed
  // (verified with a password) can receive. The Colony Log says who gifted whom, never how much (balances are private).
  async giftInfo(id) {
    const c = (await pool.query('select gift_day, gift_sent from citizens where id = $1', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
    const today = this.world.meta ? R.gameDay(Date.now(), this.world.meta.epoch) : 0;
    return { limit: GIFT_DAILY, left: GIFT_DAILY - (c.gift_day === today ? c.gift_sent : 0) };
  }
  async gift(id, to, amount) {
    amount = Math.floor(Number(amount)); if (!(amount >= 1)) throw new HttpError(400, 'Gift at least 1 coin.');
    const h = R.cleanHandle(to); if (!h) throw new HttpError(400, 'Who is the gift for? Type their username.');
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id);
      const r = (await ch.q('select * from citizens where lower(handle) = lower($1) for update', [h])).rows[0];
      if (!r) throw new HttpError(404, `There's no colonist called @${h}.`);
      if (r.id === c.id) throw new HttpError(400, "You can't send a gift to yourself.");
      if (!r.pass_hash) throw new HttpError(403, `@${r.handle} hasn't verified their avatar yet, so they can't receive gifts.`);
      const sent = c.gift_day === ch.today ? c.gift_sent : 0, left = GIFT_DAILY - sent;
      if (amount > left) throw new HttpError(429, left > 0 ? `You can gift ${fmt(left)} more coins today (${fmt(GIFT_DAILY)} a day).` : `You've gifted ${fmt(GIFT_DAILY)} coins today. You can send more tomorrow (game time).`);
      ch.coins(c); const bank = Number(c.bank || 0);
      if (c.coins_base + bank < amount) throw new HttpError(400, `You have ${fmt(c.coins_base)} coins on you and ${fmt(bank)} in the bank, ${fmt(c.coins_base + bank)} in all.`);
      const fromPocket = Math.min(c.coins_base, amount), fromBank = amount - fromPocket;
      ch.coins(r); c.coins_base -= fromPocket; r.coins_base += amount;
      ch.touch(c); ch.touch(r); await ch.saveCitizen(c); await ch.saveCitizen(r);
      if (fromBank) await ch.q('update citizens set bank = bank - $2 where id = $1', [c.id, fromBank]);
      await ch.q('update citizens set gift_day = $2, gift_sent = $3 where id = $1', [c.id, ch.today, sent + amount]);
      await ch.event(`🎁 @${c.handle} sent @${r.handle} a gift.`, 'gift'); await bump(ch, c.id, { gifts: 1 }); await score(ch, c.id, 'gifted', amount);
      return { ok: true, to: r.handle, amount, fromPocket, fromBank, coins: c.coins_base, bank: bank - fromBank, left: left - amount };
    });
  }

  // ---------- cars ----------
  async buyCar(id, model, color) {
    const M = CAR_MODELS[model]; if (!M) throw new HttpError(400, 'Pick a car from the dealer.');
    if (!M.colors.includes(color)) color = M.colors[0];
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id); if (!c.home_id) throw new HttpError(400, 'You need a home (and a driveway) before you buy a car.');
      const cars = Array.isArray(c.cars) ? c.cars : [];
      if (cars.length >= MAX_CARS) throw new HttpError(409, `Your garage holds ${MAX_CARS} cars. Sell one first.`);
      ch.coins(c); if (c.coins_base < M.price) throw new HttpError(400, `The ${M.name} costs ${fmt(M.price)} coins. You have ${fmt(c.coins_base)} on you.`);
      c.coins_base -= M.price; treasuryAdd(ch, M.price);
      const car = { id: crypto.randomUUID().slice(0, 8), m: model, col: color, at: Date.now() }; cars.push(car); await bump(ch, c.id, { cars_bought: 1 });
      await ch.q('update citizens set cars = $2, car_active = coalesce(car_active, $3) where id = $1', [c.id, JSON.stringify(cars), car.id]);
      ch.touch(c); await ch.saveCitizen(c);
      await ch.event(`🚗 @${c.handle} drove a new ${M.name.toLowerCase()} out of the dealership.`, 'car');
      return { ok: true, car, coins: c.coins_base };
    });
  }
  async sellCar(id, carId) {
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id); const cars = Array.isArray(c.cars) ? c.cars : [], car = cars.find(x => x.id === carId);
      if (!car) throw new HttpError(404, "That car isn't in your garage.");
      const back = Math.floor(CAR_MODELS[car.m].price * CAR_RESALE); ch.coins(c); c.coins_base += back; treasuryAdd(ch, -back);
      const left = cars.filter(x => x.id !== carId), active = c.car_active === carId ? (left[0]?.id ?? null) : c.car_active;
      await ch.q('update citizens set cars = $2, car_active = $3 where id = $1', [c.id, left.length ? JSON.stringify(left) : null, active]);
      ch.touch(c); await ch.saveCitizen(c); return { ok: true, back, coins: c.coins_base };
    });
  }
  async driveCar(id, carId) {
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id); const cars = Array.isArray(c.cars) ? c.cars : [];
      if (!cars.some(x => x.id === carId)) throw new HttpError(404, "That car isn't in your garage.");
      await ch.q('update citizens set car_active = $2 where id = $1', [c.id, carId]); ch.touch(c); return { ok: true };
    });
  }

  // ---------- where to live ----------
  // Homes with space nearest the colonist's current home, plus every home they own (they can always move into those).
  async homes(id) {
    const c = (await pool.query('select c.*, h.x hx, h.y hy, h.type htype, h.name hname from citizens c left join buildings h on h.id = c.home_id where c.id = $1', [id])).rows[0];
    if (!c) throw new HttpError(404, 'No such citizen.');
    const today = this.world.meta ? R.gameDay(Date.now(), this.world.meta.epoch) : 0;
    const x = c.hx ?? 0, y = c.hy ?? 0, out = { housed: !!c.home_id, canMoveToday: c.home_changed_day !== today, current: null, homes: [] };
    if (c.home_id) out.current = { id: c.home_id, name: c.hname || BUILDING_TYPES[c.htype]?.name, rent: BUILDING_TYPES[c.htype]?.home?.rent || 0 };
    const rows = (await pool.query(`select * from buildings where done and not ruin and home_cap > 0 and id is distinct from $3 and (home_used < home_cap or owner_id = $4)
      order by (owner_id = $4) desc, (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 25`, [x, y, c.home_id, c.id])).rows;
    for (const b of rows) out.homes.push({ id: b.id, name: nameOf(b), rent: BUILDING_TYPES[b.type]?.home?.rent || 0, space: b.home_cap - b.home_used, mine: b.owner_id === c.id, dist: Math.abs(b.x - x) + Math.abs(b.y - y), owner: b.owner_handle || null });
    return out;
  }
  async moveHome(id, buildingId) {
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id); if (!c.home_id) throw new HttpError(400, "You're still in cryosleep. You'll be given a home when one is free.");
      if (c.home_changed_day === ch.today) throw new HttpError(429, "You've already moved today. You can move again tomorrow (game time).");
      const h = (await ch.q('select * from buildings where id = $1 for update', [String(buildingId)])).rows[0];
      if (!h || !h.done || h.ruin || !h.home_cap) throw new HttpError(400, "You can't live there.");
      if (h.id === c.home_id) return { ok: true };
      if (h.home_used >= h.home_cap) {
        // Owners can always move into their own home: the newest tenant who hasn't claimed their avatar makes room.
        if (h.owner_id !== c.id) throw new HttpError(409, 'That home is full. Pick one with space.');
        const out = (await ch.q(`select r.*, j.type jtype from citizens r left join buildings j on j.id = r.job_id where r.home_id = $1 and r.pass_hash is null order by r.seq desc limit 1 for update of r`, [h.id])).rows[0];
        if (!out) throw new HttpError(409, 'Everyone living there has claimed their avatar, so nobody can be moved out.');
        const jt = out.jtype; delete out.jtype; await ch.moveOut(out, { home: h.type, job: jt });
      }
      const cur = (await ch.q('select type from buildings where id = $1', [c.home_id])).rows[0], job = c.job_id ? (await ch.q('select type from buildings where id = $1', [c.job_id])).rows[0] : null;
      await ch.rehome(c, h, { home: cur?.type, job: job?.type });
      await ch.q('update citizens set home_changed_day = $2 where id = $1', [c.id, ch.today]);
      await ch.fillVacancies();
      return { ok: true, home: nameOf(h) };
    });
  }

  // ---------- owning buildings ----------
  async properties(id) {
    const rows = (await pool.query('select * from buildings where owner_id = $1 order by bought_at', [id])).rows;
    return { max: MAX_PROPERTIES, cut: TREASURY_CUT, list: rows.map(b => ({ id: b.id, name: nameOf(b), type: b.type, price: b.price, income: dailyIncome(b).net, sell: Math.floor((b.price || priceOf(b.type)) * PROPERTY_RESALE), ruin: b.ruin })) };
  }
  async buy(id, buildingId) {
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id);
      const b = (await ch.q('select * from buildings where id = $1 for update', [String(buildingId)])).rows[0];
      if (!b) throw new HttpError(404, 'No such building.');
      if (!buyable(b.type)) throw new HttpError(400, "That building belongs to the colony and isn't for sale.");
      if (!b.done || b.ruin) throw new HttpError(409, b.ruin ? "It's in ruins." : "It's still being built.");
      if (b.owner_id) throw new HttpError(409, b.owner_id === c.id ? 'You already own it.' : `@${b.owner_handle} already owns it.`);
      const n = Number((await ch.q('select count(*) n from buildings where owner_id = $1', [c.id])).rows[0].n);
      if (n >= MAX_PROPERTIES) throw new HttpError(409, `You can own up to ${MAX_PROPERTIES} buildings. Sell one first.`);
      const price = priceOf(b.type); ch.coins(c);
      if (c.coins_base < price) throw new HttpError(400, `It costs ${fmt(price)} coins. You have ${fmt(c.coins_base)} on you${c.bank ? ' (withdraw from the bank first)' : ''}.`);
      c.coins_base -= price; treasuryAdd(ch, price); ch.touch(c); await ch.saveCitizen(c);
      await ch.q('update buildings set owner_id = $2, owner_handle = $3, bought_at = $4, price = $5 where id = $1', [b.id, c.id, c.handle, Date.now(), price]); ch.buildings.add(b.id); await bump(ch, c.id, { bought: 1 });
      await ch.event(`🏠 @${c.handle} bought ${nameOf(b)} for ${fmt(price)} coins.`, 'property');
      return { ok: true, price, coins: c.coins_base, income: dailyIncome(b).net };
    });
  }
  async sell(id, buildingId) {
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id);
      const b = (await ch.q('select * from buildings where id = $1 and owner_id = $2 for update', [String(buildingId), c.id])).rows[0];
      if (!b) throw new HttpError(404, "You don't own that building.");
      const back = Math.floor((b.price || priceOf(b.type)) * PROPERTY_RESALE); ch.coins(c); c.coins_base += back; treasuryAdd(ch, -back); ch.touch(c); await ch.saveCitizen(c);
      await ch.q('update buildings set owner_id = null, owner_handle = null, bought_at = null, price = null where id = $1', [b.id]); ch.buildings.add(b.id);
      return { ok: true, back, coins: c.coins_base };
    });
  }
  // A building is knocked down: its owner gets back what they paid.
  async refundDemolished(ch, b) {
    if (!b.owner_id) return;
    const c = (await ch.q('select * from citizens where id = $1 for update', [b.owner_id])).rows[0]; if (!c) return;
    const back = b.price || priceOf(b.type); ch.coins(c); c.coins_base += back; treasuryAdd(ch, -back); ch.touch(c); await ch.saveCitizen(c);
  }

  // ---------- once a game day (called by the clock) ----------
  // Owners collect their buildings' income, and savings earn interest. The treasury pays both, keeping its cut.
  async day(ch, days) {
    days = Math.max(1, Math.min(3, days)); let rent = 0, owners = 0, interest = 0;
    const own = (await ch.q('select * from buildings where owner_id is not null and done and not ruin')).rows, byOwner = new Map();
    for (const b of own) { const inc = dailyIncome(b).net * days; if (inc > 0) byOwner.set(b.owner_id, (byOwner.get(b.owner_id) || 0) + inc); }
    // Interest is paid only from what the treasury holds after rents and profits; if it can't cover everyone, everyone gets the same share.
    const kitty = Math.max(0, R.treasuryOn(ch.meta, ch.today) - [...byOwner.values()].reduce((a, b) => a + b, 0));
    const want = Number((await ch.q('select coalesce(sum(least($1::numeric, floor(bank * $2::numeric))), 0) w from citizens where bank > 0', [BANK_CAP, BANK_RATE])).rows[0].w) * days;
    const share = want > 0 ? Math.min(1, kitty / want) : 0;
    const savers = share > 0 ? (await ch.q('select id from citizens where bank > 0')).rows.map(r => r.id) : [];
    const ids = [...new Set([...byOwner.keys(), ...savers])];
    for (let i = 0; i < ids.length; i += 500) {
      for (const c of (await ch.q('select * from citizens where id = any($1) for update', [ids.slice(i, i + 500)])).rows) {
        const inc = byOwner.get(c.id) || 0, intr = Math.floor(Math.min(BANK_CAP, Math.floor(Number(c.bank || 0) * BANK_RATE)) * days * share);
        if (!inc && !intr) continue;
        ch.coins(c); c.coins_base += inc; ch.touch(c); await ch.saveCitizen(c);
        if (intr) await ch.q('update citizens set bank = bank + $2 where id = $1', [c.id, intr]);
        rent += inc; interest += intr; if (inc) owners++;
      }
    }
    if (rent || interest) treasuryAdd(ch, -(rent + interest));
    if (rent) await ch.event(`🏠 ${owners} building owner${owners === 1 ? '' : 's'} collected ${fmt(rent)} coins in rent and profits (the treasury kept its ${Math.round(TREASURY_CUT * 100)}%).`, 'property');
    return { rent, interest };
  }
}
