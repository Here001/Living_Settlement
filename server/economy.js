// Colonists' money beyond wages: the Bank, cars, choosing where to live, and owning buildings.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { BUILDING_TYPES, CAR_MODELS, BANK_TYPES, carPaid, carKind, ridden, needsHangar, hangarCap } from '../shared/catalog.js';
import { treasuryAdd } from './races.js';
import { track, snapshot, ledger, econTick } from './stats.js';
import { bump } from './achievements.js';
import { score } from './leaderboards.js';
import { MAYOR_PAY } from '../shared/elections.js';

export const TREASURY_CUT = R.TREASURY_CUT, BUSINESS_SHARE = R.BUSINESS_SHARE;
// Savings grow 0.02% a game day, about 1% a real day (48 game days), at most 100 coins a game day each, and only while
// the treasury can pay it: interest moves existing coins around, it never creates them. A building earns its owner about
// three times that, so savings are safe but slow, as in real life.
export const BANK_RATE = 0.0002, BANK_CAP = 100;
export const GIFT_DAILY = 10000; // the most coins one colonist can gift in a real day (about two days of hard work)
// Coming back every day: a reward once per real-world day (days start at midnight UTC), bigger the longer the streak,
// paid from the treasury. A week of it is worth about one real day of wages. Missing a day starts the streak again.
export const DAILY_REWARDS = [200, 300, 400, 500, 600, 800, 1600]; // once a real day; day 7 is about a third of a busy day's earnings
export const DAILY_MILESTONES = new Set([7, 14, 30, 50, 100, 200, 365]);
const DAY_MS = 86400000, realDay = (t = Date.now()) => Math.floor(t / DAY_MS);
export const dailyRewardFor = streak => DAILY_REWARDS[(Math.max(1, streak) - 1) % DAILY_REWARDS.length];
export const MAX_CARS = 3, CAR_RESALE = 0.6, MAX_PROPERTIES = 5, PROPERTY_RESALE = 0.7;
const fmt = n => Math.round(n).toLocaleString('en-US');
const nameOf = b => b.name || BUILDING_TYPES[b.type]?.name || 'a building';
// What players may buy: homes and businesses. Public services, parks, landmarks, utilities and nature stay the colony's.
const BUYABLE_CATS = new Set(['housing', 'shops', 'offices', 'industry']);
export const buyable = type => { const t = BUILDING_TYPES[type]; return !!t && BUYABLE_CATS.has(t.cat) && !!(t.home || t.work); };
export const priceOf = (type, level = 1) => R.propertyPrice(type) * (level > 1 ? R.levelMul(level) : 1);
// How many properties a colonist holds: each plot of land (whatever stands on it) and each building bought on its own.
export async function ownedCount(q, id) { return Number((await q('select (select count(distinct coalesce(estate, id)) from plots where owner_id = $1) + (select count(*) from buildings where owner_id = $1 and plot_id is null) n', [id])).rows[0].n); } // an estate of joined plots is one property
export async function limitOf(q, id) { return R.propertyLimit((await q('select stars from citizens where id = $1', [id])).rows[0]?.stars || 0); } // see shared/rules.js: about a real month to pay for itself
// A building's daily income for its owner, after the treasury's cut.
// `self` is 1 when the owner lives there: they pay no rent, so there's none to collect from them.
export function dailyIncome(b, self = 0) {
  const t = BUILDING_TYPES[b.type] || {}; let gross = 0;
  if (t.home) gross += Math.max(0, (b.home_used || 0) - self) * (t.home.rent || 0);
  if (t.work) gross += (b.job_used || 0) * (t.work.salary || 0) * BUSINESS_SHARE;
  gross *= R.levelPay(b.level); // upgraded buildings earn more on each tenant or worker
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
    const st = this.dailyState(c), m = await this.dailyBoost(); if (m > 1) { st.reward = Math.round(st.reward * m); st.rewards = st.rewards.map(r => Math.round(r * m)); st.mayorBonus = m; } return st;
  }
  async dailyBoost() { return (await this.world.elections?.has('daily')) ? 1.5 : 1; } // a mayor's Daily bonus pledge
  async daily(id) {
    return this.world.change(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
      const st = this.dailyState(c); if (st.claimed) throw new HttpError(409, `You've collected today's reward. Come back after midnight UTC for day ${st.streak + 1}.`);
      const streak = st.streak + 1, want = Math.round(dailyRewardFor(streak) * await this.dailyBoost() * R.econF(ch.meta)), t = Math.floor(R.treasuryOn(ch.meta, ch.today)), paid = Math.max(0, Math.min(want, t));
      ch.coins(c); c.coins_base += paid; if (paid) treasuryAdd(ch, -paid); track(ch, 'daily', paid, c.id);
      ch.touch(c); await ch.saveCitizen(c);
      await ch.q('update citizens set daily_day = $2, daily_streak = $3, daily_best = greatest(daily_best, $3) where id = $1', [c.id, realDay(), streak]);
      if (DAILY_MILESTONES.has(streak)) await ch.event(`🔥 @${c.handle} has come back ${streak} days in a row.`, 'streak');
      return { ok: true, streak, paid, wanted: want, short: paid < want, coins: c.coins_base, best: Math.max(Number(c.daily_best || 0), streak), next: dailyRewardFor(streak + 1), resetsAt: (realDay() + 1) * DAY_MS };
    });
  }

  // ---------- the Bank ----------
  async hasBank(db = pool) { return (await db.query('select 1 from buildings where type = any($1) and done and not ruin limit 1', [BANK_TYPES])).rowCount > 0; }
  async bankInfo(id) {
    const c = (await pool.query('select * from citizens where id = $1', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
    const today = this.world.meta ? R.gameDay(Date.now(), this.world.meta.epoch) : 0;
    const bank = Number(c.bank || 0), home = c.home_id ? (await pool.query('select x, y from buildings where id = $1', [c.home_id])).rows[0] : null;
    const nb = (await pool.query('select id, x, y, type from buildings where type = any($3) and done and not ruin order by abs(x - $1::int) + abs(y - $2::int), id limit 1', [home ? home.x : 0, home ? home.y : 0, BANK_TYPES])).rows[0];
    return { hasBank: !!nb, nearest: nb ? { id: nb.id, x: nb.x, y: nb.y, type: nb.type } : null, wallet: R.balanceOn(c.coins_base, c.coins_day, c.net, today), bank, interest: Math.min(BANK_CAP, Math.floor(bank * BANK_RATE)), rate: BANK_RATE, cap: BANK_CAP };
  }
  // Deposits and withdrawals happen at a Bank: the player taps a Bank on the map and uses its card.
  async bank(id, kind, amount, bankId) {
    amount = Math.floor(Number(amount)); if (!(amount >= 1)) throw new HttpError(400, 'Enter an amount of at least 1 coin.');
    if (!bankId) throw new HttpError(400, 'Go to a Bank to do that: tap any Bank on the map and use its card.');
    return this.world.change(async ch => {
      const at = (await ch.q('select id from buildings where id = $1 and type = any($2) and done and not ruin', [bankId, BANK_TYPES])).rows[0];
      if (!at) throw new HttpError(409, "That isn't an open Bank. Tap a finished Bank on the map.");
      const c = await this.lockMe(ch, id); ch.coins(c);
      if (kind === 'deposit') {
        if (c.coins_base < amount) throw new HttpError(400, `You only have ${fmt(c.coins_base)} coins on you.`);
        c.coins_base -= amount; c.bank = Number(c.bank || 0) + amount;
      } else {
        if (Number(c.bank || 0) < amount) throw new HttpError(400, `You only have ${fmt(c.bank || 0)} coins in the bank.`);
        c.bank = Number(c.bank) - amount; c.coins_base += amount;
      }
      ch.touch(c); await ch.saveCitizen(c); await ch.q('update citizens set bank = $2 where id = $1', [c.id, c.bank]);
      if (kind === 'deposit') await bump(ch, c.id, { deposits: 1 });
      ledger(ch, c.id, kind === 'deposit' ? -amount : amount, kind === 'deposit' ? 'bank:deposit' : 'bank:withdraw');
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
      c.coins_base += amount; if (fromTreasury) treasuryAdd(ch, -amount); track(ch, 'dev:adjust', amount, c.id); ch.touch(c); await ch.saveCitizen(c);
      return { ok: true, coins: c.coins_base, treasury: R.treasuryOn(ch.meta, ch.today) };
    });
  }

  // ---------- gifts ----------
  // A colonist sends coins to another verified colonist: from their pocket first, and the rest from their bank savings.
  // At most GIFT_DAILY a real day, so nobody can pour a stack of accounts into one. Only avatars that have been claimed
  // (verified with a password) can receive. The Colony Log says who gifted whom, never how much (balances are private).
  async giftInfo(id) {
    const c = (await pool.query('select gift_day, gift_sent from citizens where id = $1', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
    const today = realDay();
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
      const today = realDay(), sent = c.gift_day === today ? c.gift_sent : 0, left = GIFT_DAILY - sent;
      if (amount > left) throw new HttpError(429, left > 0 ? `You can gift ${fmt(left)} more coins today (${fmt(GIFT_DAILY)} a day).` : `You've gifted ${fmt(GIFT_DAILY)} coins today. You can send more tomorrow.`);
      ch.coins(c); const bank = Number(c.bank || 0);
      // Gifts are paid in cash, from what you have on you (savings stay in the bank until you withdraw them at a Bank).
      if (c.coins_base < amount) throw new HttpError(400, `You have ${fmt(c.coins_base)} coins on you. Gifts are paid in cash${bank ? ': withdraw some at a Bank first' : ''}.`);
      const fromPocket = amount, fromBank = 0;
      ch.coins(r); c.coins_base -= fromPocket; r.coins_base += amount; track(ch, 'gift', amount, c.id); ledger(ch, r.id, amount, 'gift:in', '@' + c.handle);
      ch.ledger[ch.ledger.length - 2][3] = '@' + r.handle; // the sender's line says who it went to
      ch.touch(c); ch.touch(r); await ch.saveCitizen(c); await ch.saveCitizen(r);
      if (fromBank) await ch.q('update citizens set bank = bank - $2 where id = $1', [c.id, fromBank]);
      await ch.q('update citizens set gift_day = $2, gift_sent = $3 where id = $1', [c.id, today, sent + amount]);
      await ch.event(`🎁 @${c.handle} sent @${r.handle} a gift.`, 'gift');
      ch.pushes.push([[r.id], { kind: 'gift', title: '🎁 You got a gift', body: `@${c.handle} sent you ${fmt(amount)} coins.`, tag: 'gift' }]); await bump(ch, c.id, { gifts: 1 }); await score(ch, c.id, 'gifted', amount);
      return { ok: true, to: r.handle, amount, fromPocket, fromBank, coins: c.coins_base, bank: bank - fromBank, left: left - amount };
    });
  }

  // ---------- hangars ----------
  // Planes are kept in hangars (a Plane hangar or a Private airport) on the owner's land. Each holds a set number.
  // `without`: hangars about to be lost (sold or knocked down), which no longer count.
  async hangars(ch, ownerId, cars, without = []) {
    const rows = (await ch.q('select id, type, name, x, y, w, d from buildings where owner_id = $1 and done and not ruin', [ownerId])).rows.filter(b => hangarCap(b.type) && !without.includes(b.id));
    const list = rows.map(b => ({ ...b, cap: hangarCap(b.type), used: (cars || []).filter(x => x.hangar === b.id).length }));
    return { list, cap: list.reduce((n, b) => n + b.cap, 0), used: list.reduce((n, b) => n + b.used, 0), free: list.filter(b => b.used < b.cap).sort((a, b) => (b.cap - b.used) - (a.cap - a.used))[0] || null };
  }
  // Where a plane in a hangar flies from: just above the hangar.
  hangarSpot(b) { return { x: b.x + Math.floor((b.w || 1) / 2), y: b.y + Math.floor((b.d || 1) / 2) }; }
  // Before a colonist loses hangars (`lostIds`), the planes parked in them move to their other hangars. Returns why it
  // can't be done (no room left for them), or null once they've moved. `c` is the colonist's row, already locked.
  async rehomePlanes(ch, c, lostIds) {
    const cars = Array.isArray(c.cars) ? c.cars : [], moving = cars.filter(x => x.hangar && lostIds.includes(x.hangar)); if (!moving.length) return null;
    const H = await this.hangars(ch, c.id, cars, lostIds), room = H.list.reduce((n, b) => n + b.cap - b.used, 0);
    if (room < moving.length) return `${moving.length === 1 ? 'A plane is' : `${moving.length} planes are`} parked there and your other hangars don't have room. Sell ${moving.length === 1 ? 'it' : 'some'} or build another hangar first.`;
    for (const car of moving) { const b = H.list.find(h => h.used < h.cap); b.used++; car.hangar = b.id; const p = this.hangarSpot(b), [cx, cy] = R.chunkOf(p.x, p.y);
      const v = (await ch.q('select id, cx, cy from vehicles where car_id = $1 and owner_id = $2', [car.id, c.id])).rows[0];
      if (v) { await ch.q('update vehicles set x = $2, y = $3, cx = $4, cy = $5 where id = $1', [v.id, p.x, p.y, cx, cy]); const row = (await ch.q('select * from vehicles where id = $1', [v.id])).rows[0];
        ch.extraOps.push({ op: 'removeVehicle', id: v.id, chunks: [R.chunkKey(v.cx, v.cy)] }, { op: 'vehicle', data: { id: row.id, type: row.type, x: row.x, y: row.y, cx, cy, placedAt: row.placed_at, owner: c.handle }, chunks: [R.chunkKey(cx, cy)] }); } }
    await ch.q('update citizens set cars = $2 where id = $1', [c.id, JSON.stringify(cars)]); c.cars = cars; return null;
  }
  async hangarInfo(buildingId) {
    const b = (await pool.query('select id, type, owner_id from buildings where id = $1', [String(buildingId)])).rows[0]; if (!b || !hangarCap(b.type)) throw new HttpError(404, 'That isn\'t a hangar.');
    const o = b.owner_id ? (await pool.query('select cars from citizens where id = $1', [b.owner_id])).rows[0] : null, cars = Array.isArray(o?.cars) ? o.cars : [];
    return { cap: hangarCap(b.type), planes: cars.filter(x => x.hangar === b.id).map(x => ({ id: x.id, m: x.m, name: CAR_MODELS[x.m]?.name || 'Plane', col: x.col })) };
  }

  // ---------- cars ----------
  // Cars are bought at a Car dealership: tap one on the map.
  async buyCar(id, model, color, buildingId) {
    const M = CAR_MODELS[model]; if (!M) throw new HttpError(400, 'Pick a car from the dealer.');
    if (!M.colors.includes(color)) color = M.colors[0];
    return this.world.change(async ch => {
      const lot = (await ch.q("select id from buildings where id = $1 and type = 'cardealer' and done and not ruin", [String(buildingId || '')])).rows[0];
      if (!lot) throw new HttpError(409, 'Cars are sold at a Car dealership. Tap one on the map.');
      const c = await this.lockMe(ch, id); if (!c.home_id) throw new HttpError(400, 'You need a home (and a driveway) before you buy a car.');
      const cars = Array.isArray(c.cars) ? c.cars : [], road = ridden(model), plane = needsHangar(model), same = cars.filter(x => ridden(x.m) === road && !needsHangar(x.m)).length;
      // up to 3 cars and bikes in the garage, and up to 3 boats and other aircraft; planes as many as the hangars hold
      let hangar = null;
      if (plane) { const H = await this.hangars(ch, c.id, cars);
        if (!H.cap) throw new HttpError(409, `Planes are kept in a hangar. Build a Plane hangar (holds ${hangarCap('planehangar')}) or a Private airport (holds ${hangarCap('airport')}) on your land first: tap your plot, then Build here → Services → Aviation.`);
        if (!H.free) throw new HttpError(409, `Your hangars are full (${H.used} of ${H.cap} planes). Build another hangar or an airport, or sell a plane.`);
        hangar = H.free; }
      else if (same >= MAX_CARS) throw new HttpError(409, road ? `Your garage holds ${MAX_CARS} cars and bikes. Sell one first.` : `You can keep ${MAX_CARS} boats and aircraft. Sell one first.`);
      ch.coins(c); if (c.coins_base < M.price) throw new HttpError(400, `The ${M.name} costs ${fmt(M.price)} coins. You have ${fmt(c.coins_base)} on you.`);
      // a boat goes on the water nearest your home; a plane flies from its hangar; other aircraft take to the sky over your home
      let spot = null; const home = (await ch.q('select x, y from buildings where id = $1', [c.home_id])).rows[0];
      if (hangar) spot = this.hangarSpot(hangar);
      else if (M.kind === 'water') { spot = (await ch.q('select x, y from water order by (x - $1) * (x - $1) + (y - $2) * (y - $2) limit 1', [home.x, home.y])).rows[0];
        if (!spot) throw new HttpError(409, 'The colony has no water for a boat yet.'); }
      else if (M.kind === 'air') spot = { x: home.x, y: home.y };
      c.coins_base -= M.price; treasuryAdd(ch, M.price); track(ch, 'car:buy', M.price, c.id);
      const car = { id: crypto.randomUUID().slice(0, 8), m: model, col: color, at: Date.now(), paid: M.price, ...(hangar ? { hangar: hangar.id } : {}) }; cars.push(car); await bump(ch, c.id, { cars_bought: 1 });
      await ch.q('update citizens set cars = $2, car_active = coalesce(car_active, $3) where id = $1', [c.id, JSON.stringify(cars), road ? car.id : null]);
      if (spot) { const [cx, cy] = R.chunkOf(spot.x, spot.y), vid = crypto.randomUUID();
        const v = (await ch.q('insert into vehicles (id, type, x, y, cx, cy, placed_at, owner_id, owner_handle, car_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *', [vid, M.vtype, spot.x, spot.y, cx, cy, Date.now(), c.id, c.handle, car.id])).rows[0];
        ch.extraOps.push({ op: 'vehicle', data: { id: v.id, type: v.type, x: v.x, y: v.y, cx, cy, placedAt: v.placed_at, owner: c.handle }, chunks: [R.chunkKey(cx, cy)] }); }
      ch.touch(c); await ch.saveCitizen(c);
      return { ok: true, car, coins: c.coins_base, hangar: hangar ? (hangar.name || BUILDING_TYPES[hangar.type].name) : null };
    });
  }
  async sellCar(id, carId) {
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id); const cars = Array.isArray(c.cars) ? c.cars : [], car = cars.find(x => x.id === carId);
      if (!car) throw new HttpError(404, "That car isn't in your garage.");
      const back = Math.floor(carPaid(car) * CAR_RESALE); ch.coins(c); c.coins_base += back; treasuryAdd(ch, -back); track(ch, 'car:sell', back, c.id);
      const left = cars.filter(x => x.id !== carId), active = c.car_active === carId ? (left.find(x => ridden(x.m))?.id ?? null) : c.car_active;
      const v = (await ch.q('delete from vehicles where car_id = $1 and owner_id = $2 returning id, cx, cy', [carId, c.id])).rows[0];
      if (v) ch.extraOps.push({ op: 'removeVehicle', id: v.id, chunks: [R.chunkKey(v.cx, v.cy)] });
      await ch.q('update citizens set cars = $2, car_active = $3 where id = $1', [c.id, left.length ? JSON.stringify(left) : null, active]);
      ch.touch(c); await ch.saveCitizen(c); return { ok: true, back, coins: c.coins_base };
    });
  }
  async driveCar(id, carId) {
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id); const cars = Array.isArray(c.cars) ? c.cars : [];
      const car = cars.find(x => x.id === carId); if (!car) throw new HttpError(404, "That car isn't in your garage.");
      if (!ridden(car.m)) throw new HttpError(409, 'Boats and aircraft stay at the water and in the sky. Pick a car or bike to ride.');
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
  // Renting: "Rent here" on any home with space (or one you own). You pay a moving-in fee and the movers; if you live
  // somewhere else you move out of there first. A home you own has no moving-in fee. Once a game day.
  async rentHere(id, buildingId) {
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id); if (!c.pass_hash) throw new HttpError(403, 'Claim your colonist first.');
      if (c.home_changed_day === ch.today) throw new HttpError(429, "You've already moved today. You can move again tomorrow (game time).");
      const h = (await ch.q('select * from buildings where id = $1 for update', [String(buildingId)])).rows[0];
      if (!h || !h.done || h.ruin || !h.home_cap) throw new HttpError(400, "You can't live there.");
      if (h.id === c.home_id) throw new HttpError(409, 'You already live here.');
      if (h.home_used >= h.home_cap && h.owner_id !== c.id) throw new HttpError(409, 'That home is full. Pick one with space.');
      const cur = c.home_id ? (await ch.q('select type, x, y from buildings where id = $1', [c.home_id])).rows[0] : null;
      const cost = R.rentCost(h.type, cur ? [cur.x, cur.y] : null, [h.x, h.y]), fee = h.owner_id === c.id ? 0 : cost.fee, total = fee + cost.movers;
      ch.coins(c); if (c.coins_base < total) throw new HttpError(400, `Moving in costs ${fmt(total)} coins (${fee ? `${fmt(fee)} moving-in fee + ` : ''}${fmt(cost.movers)} for the movers). You have ${fmt(c.coins_base)} on you${c.bank ? '; withdraw some at a Bank first' : ''}.`);
      c.coins_base -= total; ch.touch(c); await ch.saveCitizen(c);
      track(ch, 'rent:movers', cost.movers, c.id); treasuryAdd(ch, cost.movers);
      if (fee) { track(ch, 'rent:fee', fee, c.id);
        const owner = h.owner_id ? (await ch.q('select * from citizens where id = $1 for update', [h.owner_id])).rows[0] : null;
        if (owner) { const cut = Math.floor(fee * TREASURY_CUT), got = fee - cut; ch.coins(owner); owner.coins_base += got; ch.touch(owner); await ch.saveCitizen(owner); treasuryAdd(ch, cut); track(ch, 'rent:income', got, owner.id);
          await this.world.actions?.notify(ch, owner.id, 'property', `🏠 @${c.handle} moved into ${nameOf(h)}. You got ${fmt(got)} coins of their moving-in fee.`); }
        else treasuryAdd(ch, fee); }
      if (h.home_used >= h.home_cap) { // an owner moving into their own full building: the newest unclaimed tenant makes room
        const out = (await ch.q(`select r.*, j.type jtype from citizens r left join buildings j on j.id = r.job_id where r.home_id = $1 and r.pass_hash is null order by r.seq desc limit 1 for update of r`, [h.id])).rows[0];
        if (!out) throw new HttpError(409, 'Everyone living there has claimed their avatar, so nobody can be moved out.');
        const jt = out.jtype; delete out.jtype; await ch.moveOut(out, { home: h.type, job: jt }); }
      const c2 = (await ch.q('select * from citizens where id = $1', [c.id])).rows[0];
      if (c2.home_id) { const job = c2.job_id ? (await ch.q('select type from buildings where id = $1', [c2.job_id])).rows[0] : null; await ch.rehome(c2, h, { home: cur?.type, job: job?.type }); }
      else await ch.moveIn(c2, h);
      await ch.q('update citizens set home_changed_day = $2, left_home = false where id = $1', [c.id, ch.today]);
      await ch.fillVacancies();
      return { ok: true, home: nameOf(h), paid: total, fee, movers: cost.movers, coins: c.coins_base };
    });
  }
  // Leaving home: you move out (and leave your job, which came with living nearby) until you rent somewhere else.
  async leaveHome(id) {
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id); if (!c.home_id) throw new HttpError(409, "You don't live anywhere right now.");
      const h = (await ch.q('select type from buildings where id = $1', [c.home_id])).rows[0], j = c.job_id ? (await ch.q('select type from buildings where id = $1', [c.job_id])).rows[0] : null;
      await ch.moveOut(c, { home: h?.type, job: j?.type });
      await ch.q('update citizens set left_home = true where id = $1', [c.id]);
      await ch.fillVacancies();
      return { ok: true };
    });
  }
  // Where you live, for the Home tab.
  async myHome(id) {
    const c = (await pool.query('select c.home_id, c.left_home, c.home_changed_day, c.job_id, c.job_changed_day, h.type, h.name, h.x, h.y, h.owner_id from citizens c left join buildings h on h.id = c.home_id where c.id = $1', [id])).rows[0];
    if (!c) throw new HttpError(404, 'No such citizen.');
    const today = this.world.meta ? R.gameDay(Date.now(), this.world.meta.epoch) : 0;
    const q = (a, v) => pool.query(a, v), props = await ownedCount(q, id), max = await limitOf(q, id);
    return { home: c.home_id ? { id: c.home_id, name: c.name || BUILDING_TYPES[c.type]?.name, type: c.type, rent: c.owner_id === id ? 0 : BUILDING_TYPES[c.type]?.home?.rent || 0, x: c.x, y: c.y, mine: c.owner_id === id, where: this.world.housing?.placeName(c.x, c.y) || '' } : null,
      leftHome: !!c.left_home, canMoveToday: c.home_changed_day !== today, hasJob: !!c.job_id, jobId: c.job_id || null, canWorkToday: c.job_changed_day !== today, props, max };
  }

  // ---------- owning buildings ----------
  async properties(id) {
    const q = (a, b) => pool.query(a, b);
    const rows = (await pool.query('select * from buildings where owner_id = $1 order by bought_at', [id])).rows;
    const plots = (await pool.query('select * from plots where owner_id = $1 order by bought_at', [id])).rows;
    const me = (await pool.query('select stars, home_id from citizens where id = $1', [id])).rows[0], max = await limitOf(q, id), stars = me?.stars || 0, inc = b => dailyIncome(b, me?.home_id === b.id ? 1 : 0).net; // you don't pay yourself rent
    const one = b => ({ id: b.id, name: nameOf(b), type: b.type, price: b.price, income: inc(b), sell: Math.floor((b.price || priceOf(b.type, b.level)) * PROPERTY_RESALE), ruin: b.ruin, level: b.level || 1, plot: b.plot_id || null, done: b.done, x: b.x, y: b.y });
    const list = rows.filter(b => !b.plot_id).map(one);
    // plots joined into an estate are listed as one property, under the first plot's id and name
    const groups = new Map(); for (const p of plots) { const k = p.estate || p.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
    const land = [...groups.entries()].map(([k, ps]) => { const root = ps.find(p => p.id === k) || ps[0], ids = new Set(ps.map(p => p.id)), on = rows.filter(b => ids.has(b.plot_id)), price = ps.reduce((s, p) => s + Number(p.price), 0), worth = price + on.reduce((s, b) => s + Number(b.price || 0), 0);
      const x0 = Math.min(...ps.map(p => p.x)), y0 = Math.min(...ps.map(p => p.y)), x1 = Math.max(...ps.map(p => p.x + p.w)), y1 = Math.max(...ps.map(p => p.y + p.d)), tiles = ps.reduce((s, p) => s + p.w * p.d, 0);
      return { id: k, name: root.name || (ps.length > 1 ? `Estate of ${ps.length} plots` : `Plot ${root.w}×${root.d}`), x: x0, y: y0, w: x1 - x0, d: y1 - y0, tiles, plots: ps.length, price, income: on.reduce((s, b) => s + inc(b), 0), sell: Math.floor(worth * PROPERTY_RESALE), buildings: on.map(one) }; });
    return { max, stars, count: list.length + land.length, next: R.propertyLimit(Math.min(12, stars + 1)), cut: TREASURY_CUT, list, plots: land };
  }
  async buy(id, buildingId) {
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id);
      const b = (await ch.q('select * from buildings where id = $1 for update', [String(buildingId)])).rows[0];
      if (!b) throw new HttpError(404, 'No such building.');
      if (!buyable(b.type)) throw new HttpError(400, "That building belongs to the colony and isn't for sale.");
      if (!b.done || b.ruin) throw new HttpError(409, b.ruin ? "It's in ruins." : "It's still being built.");
      if (b.owner_id) throw new HttpError(409, b.owner_id === c.id ? 'You already own it.' : `@${b.owner_handle} already owns it.`);
      const q = (a, v) => ch.q(a, v), n = await ownedCount(q, c.id), max = R.propertyLimit(c.stars);
      if (n >= max) throw new HttpError(409, `With ${c.stars || 0} star${c.stars === 1 ? '' : 's'} you can own up to ${max} properties. Sell one first, or earn more stars.`);
      const price = priceOf(b.type, b.level); ch.coins(c);
      if (c.coins_base < price) throw new HttpError(400, `It costs ${fmt(price)} coins. You have ${fmt(c.coins_base)} on you${c.bank ? ' (withdraw some at a Bank first)' : ''}.`);
      c.coins_base -= price; treasuryAdd(ch, price); track(ch, 'property:buy', price, c.id); ch.touch(c); await ch.saveCitizen(c);
      await ch.ownerChanged(b.id, null, c.id); // living there already? the rent stops
      await ch.q('update buildings set owner_id = $2, owner_handle = $3, bought_at = $4, price = $5 where id = $1', [b.id, c.id, c.handle, Date.now(), price]); ch.buildings.add(b.id); await bump(ch, c.id, { bought: 1 });
      return { ok: true, price, coins: c.coins_base, income: dailyIncome(b).net };
    });
  }
  async sell(id, buildingId) {
    return this.world.change(async ch => {
      const c = await this.lockMe(ch, id);
      const b = (await ch.q('select * from buildings where id = $1 and owner_id = $2 for update', [String(buildingId), c.id])).rows[0];
      if (!b) throw new HttpError(404, "You don't own that building.");
      if (b.plot_id) throw new HttpError(409, "It stands on your land: sell the whole plot from its card, or knock it down.");
      const back = Math.floor((b.price || priceOf(b.type, b.level)) * PROPERTY_RESALE); ch.coins(c); c.coins_base += back; treasuryAdd(ch, -back); track(ch, 'property:sell', back, c.id); ch.touch(c); await ch.saveCitizen(c);
      await ch.ownerChanged(b.id, c.id, null);
      await ch.q('update buildings set owner_id = null, owner_handle = null, bought_at = null, price = null where id = $1', [b.id]); ch.buildings.add(b.id);
      return { ok: true, back, coins: c.coins_base };
    });
  }
  // A building is knocked down: its owner gets back what they paid.
  async refundDemolished(ch, b) {
    if (!b.owner_id) return;
    const c = (await ch.q('select * from citizens where id = $1 for update', [b.owner_id])).rows[0]; if (!c) return;
    const back = b.price || priceOf(b.type); ch.coins(c); c.coins_base += back; treasuryAdd(ch, -back); track(ch, 'property:refund', back, c.id); ch.touch(c); await ch.saveCitizen(c);
  }

  // ---------- bills: cars every game week, property twice a game year ----------
  // Every 7 game days: each car's upkeep. Every 26 game weeks (twice a game year): property upkeep, 0.1% of the price of
  // every building and plot a colonist owns for each of those weeks (2.6%). Paid from cash first,
  // then savings; anything still owed puts the wallet in the minus (wages pay it back). Everyone billed gets a notice and a phone notification.
  async weeklyBills(ch, force = false) {
    const week = Math.floor(ch.today / 7);
    if (!force) { if (ch.meta.billsWeek == null) { ch.meta.billsWeek = week; return null; } if (ch.meta.billsWeek >= week) return null; }
    ch.meta.billsWeek = week;
    // property: once each half game year (the first time it's seen, the count just starts; a test run bills it straight away)
    const half = Math.floor(ch.today / R.PROPERTY_BILL_DAYS), propDue = force || (ch.meta.propHalf != null && ch.meta.propHalf < half); if (ch.meta.propHalf == null || ch.meta.propHalf < half) ch.meta.propHalf = half;
    const byOwner = new Map(), rate = R.UPKEEP_RATE * R.PROPERTY_BILL_WEEKS;
    if (propDue) { for (const b of (await ch.q('select owner_id, type, price from buildings where owner_id is not null')).rows) byOwner.set(b.owner_id, (byOwner.get(b.owner_id) || 0) + Math.round((b.price || priceOf(b.type)) * rate));
      for (const p of (await ch.q('select owner_id, price from plots')).rows) byOwner.set(p.owner_id, (byOwner.get(p.owner_id) || 0) + Math.round(Number(p.price) * rate)); } // land too
    const ids = [...new Set([...byOwner.keys(), ...(await ch.q("select id from citizens where cars is not null and jsonb_array_length(cars) > 0")).rows.map(r => r.id)])];
    let total = 0, billed = 0; const notes = [];
    // In batches of 500: one read, one write and one set of notices each, instead of a few queries per person.
    for (let i = 0; i < ids.length; i += 500) {
      const up = { id: [], base: [], bank: [] };
      for (const c of (await ch.q('select id, coins_base, coins_day, net, bank, cars from citizens where id = any($1) for update', [ids.slice(i, i + 500)])).rows) {
        const id = c.id, cars = Array.isArray(c.cars) ? c.cars : [], carFee = cars.reduce((s, x) => s + (CAR_MODELS[x.m]?.upkeep || 0), 0), propFee = byOwner.get(id) || 0, due = carFee + propFee;
        if (!due) continue;
        ch.coins(c); const fromCash = Math.min(Math.max(0, c.coins_base), due), fromBank = Math.min(Number(c.bank || 0), due - fromCash), debt = due - fromCash - fromBank, paid = due;
        up.id.push(id); up.base.push(c.coins_base - fromCash - debt); up.bank.push(fromBank); // what cash and savings can't cover puts the wallet in the minus (not touched: coins don't show on the map)
        treasuryAdd(ch, paid); total += paid; billed++; if (carFee) track(ch, 'bills:car', Math.min(paid, carFee), id); if (paid > carFee) track(ch, 'bills:property', paid - carFee, id);
        const parts = [carFee ? `🚗 car upkeep ${fmt(carFee)}` : '', propFee ? `🏠 property upkeep ${fmt(propFee)} (half-yearly)` : ''].filter(Boolean).join(' + ');
        const how = [fromCash ? `${fmt(fromCash)} from your cash` : '', fromBank ? `${fmt(fromBank)} from the bank` : '', debt ? `${fmt(debt)} owed: your wallet is in the minus until your wages pay it back` : ''].filter(Boolean).join(', ');
        notes.push([id, 'bills', `🧾 ${propFee ? 'Bills' : 'Weekly bills'}: ${parts} = ${fmt(due)} coins: ${how}.`]);
      }
      if (up.id.length) await ch.q(`update citizens c set coins_base = u.base, coins_day = $4, bank = c.bank - u.bank
        from unnest($1::text[], $2::numeric[], $3::numeric[]) u(id, base, bank) where c.id = u.id`, [up.id, up.base, up.bank, ch.today]);
    }
    if (this.world.actions) await this.world.actions.notifyMany(ch, notes);
    return { billed, total };
  }

  // Status: the next title up (Bronze, Silver, Gold…), each four times the price of the last, paid in cash to the treasury.
  // Only for show: it sits by your name. It's there so the richest players have something worth spending on.
  async buyStatus(id) {
    return this.world.change(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
      const tier = Number(c.status_tier || 0); if (tier >= R.STATUS.length) throw new HttpError(409, `You already hold the highest status, ${R.STATUS[R.STATUS.length - 1].name}.`);
      const S = R.STATUS[tier]; ch.coins(c);
      if (c.coins_base < S.price) throw new HttpError(402, `${S.name} status costs ${fmt(S.price)} coins in cash. You have ${fmt(Math.max(0, c.coins_base))}.`);
      c.coins_base -= S.price; treasuryAdd(ch, S.price); track(ch, 'status:buy', S.price, c.id);
      await ch.q('update citizens set status_tier = $2 where id = $1', [c.id, tier + 1]); ch.touch(c); await ch.saveCitizen(c);
      await ch.event(`${S.icon} @${c.handle} bought ${S.name} status.`, 'status');
      return { ok: true, tier: tier + 1, status: S, next: R.STATUS[tier + 1] || null, coins: c.coins_base };
    });
  }

  // ---------- once a game day (called by the clock) ----------
  // Owners collect their buildings' income, and savings earn interest. The treasury pays both, keeping its cut.
  async day(ch, days) {
    days = Math.max(1, Math.min(3, days)); let rent = 0, owners = 0, interest = 0;
    await this.weeklyBills(ch);
    const mayor = await this.world.elections?.mayor(), im = (mayor?.policy === 'savers' ? 2 : 1) * R.econF(ch.meta); // a mayor's Savers first pledge doubles interest; the stabiliser trims or loosens it
    const own = (await ch.q('select * from buildings where owner_id is not null and done and not ruin')).rows, byOwner = new Map();
    // Players living in a home they own pay no rent: anyone still being charged it (from before that rule) is put right here.
    for (const c of (await ch.q(`select c.*, j.type jtype, h.type htype from citizens c join buildings h on h.id = c.home_id and h.owner_id = c.id
        join buildings j on j.id = c.job_id where c.pass_hash is not null for update of c`)).rows) {
      const want = R.netOf(R.capacities(c.jtype).salary, 0); if (Number(c.net) === want) continue;
      delete c.jtype; delete c.htype; ch.coins(c); ch.income(Number(c.net) - want); c.net = want; await ch.saveCitizen(c); }
    const selfIn = new Set((await ch.q('select c.home_id from citizens c join buildings b on b.id = c.home_id and b.owner_id = c.id')).rows.map(r => r.home_id));
    for (const b of own) { const inc = dailyIncome(b, selfIn.has(b.id) ? 1 : 0).net * days; if (inc > 0) byOwner.set(b.owner_id, (byOwner.get(b.owner_id) || 0) + inc); }
    // Rents and profits come out of the treasury: if it can't cover them all, every owner gets the same share (never new coins).
    { const all = [...byOwner.values()].reduce((a, b) => a + b, 0), have = Math.max(0, Math.floor(R.treasuryOn(ch.meta, ch.today)));
      if (all > have) { const k = have / all; for (const [id, v] of byOwner) { const v2 = Math.floor(v * k); if (v2 > 0) byOwner.set(id, v2); else byOwner.delete(id); } } }
    // Interest is paid only from what the treasury holds after rents and profits; if it can't cover everyone, everyone gets the same share.
    const kitty = Math.max(0, R.treasuryOn(ch.meta, ch.today) - [...byOwner.values()].reduce((a, b) => a + b, 0));
    const want = Number((await ch.q('select coalesce(sum(least($1::numeric, floor(bank * $2::numeric))), 0) w from citizens where bank > 0', [BANK_CAP, BANK_RATE])).rows[0].w) * days * im;
    const share = want > 0 ? Math.min(1, kitty / want) : 0;
    const savers = share > 0 ? (await ch.q('select id from citizens where bank > 0')).rows.map(r => r.id) : [];
    const ids = [...new Set([...byOwner.keys(), ...savers])];
    // Saved in one statement per 500 people, and nobody is "touched": coins don't show on the map, so viewers aren't sent
    // anything (touching hundreds of colonists made every phone re-download its whole map once a game day).
    for (let i = 0; i < ids.length; i += 500) {
      const up = { id: [], base: [], add: [] };
      for (const c of (await ch.q('select id, coins_base, coins_day, net, bank from citizens where id = any($1) for update', [ids.slice(i, i + 500)])).rows) {
        const inc = byOwner.get(c.id) || 0, intr = Math.floor(Math.min(BANK_CAP, Math.floor(Number(c.bank || 0) * BANK_RATE)) * days * share * im);
        if (!inc && !intr) continue;
        ch.coins(c); c.coins_base += inc; up.id.push(c.id); up.base.push(c.coins_base); up.add.push(intr);
        rent += inc; interest += intr; if (inc) { owners++; track(ch, 'property:income', inc, c.id); } if (intr) track(ch, 'bank:interest', intr, c.id);
      }
      if (up.id.length) await ch.q(`update citizens c set coins_base = u.base, coins_day = $4, bank = c.bank + u.add
        from unnest($1::text[], $2::numeric[], $3::numeric[]) u(id, base, add) where c.id = u.id`, [up.id, up.base, up.add, ch.today]);
    }
    if (rent || interest) treasuryAdd(ch, -(rent + interest));
    // Wealth tax: a small slice of cash plus savings above 250,000 goes back to the treasury (0.5% a real day).
    { let wt = 0; for (const c of (await ch.q(`select * from citizens where pass_hash is not null and coins_base + bank + greatest(0, net) * greatest(0, $1 - coins_day) > $2 for update`, [ch.today, R.WEALTH_FREE])).rows) {
        ch.coins(c); const tax = R.wealthTaxPerGameDay(c.coins_base + Number(c.bank || 0)) * days; if (tax <= 0) continue;
        await ch.takeFrom(c, tax); await ch.saveCitizen(c); track(ch, 'tax:wealth', tax, c.id); wt += tax; }
      if (wt) treasuryAdd(ch, wt); }
    // Wages (after rent) build up in each player's pocket through the day; the ledger notes them once a day.
    for (const w of (await ch.q('select id, net from citizens where pass_hash is not null and net > 0')).rows) ledger(ch, w.id, Number(w.net) * days, 'wages');
    await ch.q('delete from ledger where t < $1', [Date.now() - 30 * 86400000]); // a month of history is plenty
    // The mayor's salary, in cash, while the treasury can pay it.
    if (mayor) { const pay = Math.min(MAYOR_PAY * days, Math.floor(R.treasuryOn(ch.meta, ch.today))); const m = pay > 0 && (await ch.q('select * from citizens where id = $1 for update', [mayor.id])).rows[0];
      if (m) { ch.coins(m); m.coins_base += pay; treasuryAdd(ch, -pay); track(ch, 'mayor:pay', pay, m.id); ch.touch(m); await ch.saveCitizen(m); } }
    if (rent) await ch.event(`🏠 ${owners} building owner${owners === 1 ? '' : 's'} collected ${fmt(rent)} coins in rent and profits (the treasury kept its ${Math.round(TREASURY_CUT * 100)}%).`, 'property');
    await econTick(ch).catch(e => console.error('econ:', e.message)); // the stabiliser, once a real hour
    await snapshot(ch.db, ch.meta); // developer stats: how many coins exist, saved through each real day
    return { rent, interest };
  }
}
