// Badges: what each colonist has earned. Facts are read straight from the database, so most badges need no bookkeeping;
// the few things that leave no other trace (casino wins, gifts, crimes, jail) are counted in citizens.stats by bump().
// A colonist is checked after anything they do, and every minute while they have the colony open (for race and lottery wins).
import { pool } from './db.js';
import * as R from '../shared/rules.js';
import { ACHIEVEMENTS, BY_ID, earned } from '../shared/achievements.js';

// Add to counters (inc) and raise high-water marks (max) in citizens.stats, inside a change.
export async function bump(ch, id, inc = {}, max = {}) {
  let expr = "coalesce(stats, '{}'::jsonb)"; const params = [id];
  for (const [k, v] of Object.entries(inc)) { params.push(k, Math.trunc(v)); const a = params.length - 1, b = params.length;
    expr = `jsonb_set(${expr}, array[$${a}::text], to_jsonb(coalesce((stats->>$${a}::text)::bigint, 0) + $${b}::bigint))`; }
  for (const [k, v] of Object.entries(max)) { params.push(k, Math.trunc(v)); const a = params.length - 1, b = params.length;
    expr = `jsonb_set(${expr}, array[$${a}::text], to_jsonb(greatest(coalesce((stats->>$${a}::text)::bigint, 0), $${b}::bigint)))`; }
  if (params.length > 1) await ch.q(`update citizens set stats = ${expr} where id = $1`, params);
}

export class Achievements {
  constructor(world, bus) { this.world = world; this.bus = bus; this.pending = new Map(); this.rarityCache = { t: 0, v: null }; }
  async facts(id) {
    const r = (await pool.query(`select c.id, c.handle, c.pass_hash is not null verified, c.home_id, c.job_id, c.display_name, c.coins_base, c.coins_day, c.net, c.bank,
        c.cars, c.pet, c.daily_best, c.seq, c.stats,
        (select count(*) from buildings b where b.owner_id = c.id) props,
        (select count(*) from race_bets r where r.citizen_id = c.id and r.payout > 0) race_wins,
        (select count(*) from lotteries l where l.drawn and lower(l.winner) = lower(c.handle)) lotto,
        (select count(distinct d.recipient_id) from dms d where d.sender_id = c.id) dm_people,
        (select count(*) from messages m where m.citizen_id = c.id) posts,
        array(select a.id from achievements a where a.citizen_id = c.id) have
      from citizens c where c.id = $1`, [id])).rows[0];
    if (!r) return null;
    const today = this.world.meta ? R.gameDay(Date.now(), this.world.meta.epoch) : 0;
    return { row: r, f: { verified: r.verified, home: !!r.home_id, job: !!r.job_id, named: !!r.display_name, seq: Number(r.seq || 0),
      coins: R.balanceOn(r.coins_base, r.coins_day, r.net, today), bank: Number(r.bank || 0), cars: Array.isArray(r.cars) ? r.cars.length : 0, pet: !!r.pet,
      props: Number(r.props), raceWins: Number(r.race_wins), lottery: Number(r.lotto), dmPeople: Number(r.dm_people), posts: Number(r.posts),
      dailyBest: Number(r.daily_best || 0), stats: r.stats || {} } };
  }
  // Award anything new. Returns the newly earned badge ids.
  async check(id) {
    const x = await this.facts(id); if (!x || !x.row.verified) return [];
    const have = new Set(x.row.have), fresh = earned(x.f).filter(a => !have.has(a)); if (!fresh.length) return [];
    const now = Date.now(), got = [];
    for (const a of fresh) { const ins = await pool.query('insert into achievements (citizen_id, id, t) values ($1, $2, $3) on conflict do nothing', [id, a, now]); if (ins.rowCount) got.push(a); }
    if (!got.length) return [];
    this.bus.publish([{ op: 'badge', private: true, to: [id], data: { ids: got } }]);
    const gold = got.filter(a => BY_ID[a].tier === 3);
    if (gold.length && this.world.meta) await this.world.change(async ch => { for (const a of gold) await ch.event(`🏅 @${x.row.handle} earned the ${BY_ID[a].icon} ${BY_ID[a].name} badge.`, 'badge'); }).catch(() => {});
    return got;
  }
  // After an action: check shortly (several actions in a row are checked once).
  soon(id) { if (!id || this.pending.has(id)) return; this.pending.set(id, setTimeout(() => { this.pending.delete(id); this.check(id).catch(e => console.error('badges:', e.message)); }, 400)); }
  async checkMany(ids) { for (const id of ids) { try { await this.check(id); } catch (e) { console.error('badges:', e.message); } } }
  async ids(id) { return (await pool.query('select id from achievements where citizen_id = $1 order by t', [id])).rows.map(r => r.id); }
  // How many verified colonists have each badge, as a share (cached for a minute).
  async rarity() {
    if (Date.now() - this.rarityCache.t < 60000 && this.rarityCache.v) return this.rarityCache.v;
    const n = Number((await pool.query('select count(*) n from citizens where pass_hash is not null')).rows[0].n) || 1;
    const by = Object.fromEntries((await pool.query('select id, count(*) n from achievements group by id')).rows.map(r => [r.id, Number(r.n)]));
    const v = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, Math.min(100, Math.round(100 * (by[a.id] || 0) / n))]));
    this.rarityCache = { t: Date.now(), v }; return v;
  }
  async list(id) {
    await this.check(id);
    const got = new Map((await pool.query('select id, t from achievements where citizen_id = $1', [id])).rows.map(r => [r.id, Number(r.t)])), rare = await this.rarity();
    return { earned: got.size, total: ACHIEVEMENTS.length, badges: ACHIEVEMENTS.map(a => ({ ...a, t: got.get(a.id) || 0, pct: rare[a.id] })) };
  }
}
