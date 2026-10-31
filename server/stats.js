// Developer stats: what the colony's players actually do, so the game can be tuned from real data.
// - activity: one row per signed-in player per real day they used the game (any signed-in request or live connection).
// - flows: every coin that moves, by kind ('earn:gigs', 'travel', 'car:buy'…), per real day, with how many times and
//   how many coins, plus which players did it (flow_players), so we know how many people use each way to earn or spend.
// - snapshots: how many coins exist (cash, savings, treasury), saved through each real day.
import { pool } from './db.js';
import * as R from '../shared/rules.js';

export const realDay = (t = Date.now()) => Math.floor(t / 86400000);

// Record a flow inside a change; it's saved with the change (and dropped if the change fails).
export function track(ch, key, coins = 0, citizenId = null) {
  if (!ch || !key) return; (ch.flows ||= []).push([key, Math.round(Number(coins) || 0), citizenId || null]);
  const sg = signOf(key); if (citizenId && sg) ledger(ch, citizenId, sg * (Number(coins) || 0), key);
}
// The cash-flow history each player sees in their Wallet: money in (+) and out (-), by kind. Most entries come from
// track(); a few (gifts received, a picked pocket, bank deposits, wages) are added where they happen.
const IN = /^(casino:win|game:\w+:win|table:\w+:(win|refund)|race:win|property:(sell|refund|income)|mayor:pay|lottery:win|guide|daily|car:sell|earn:.*|crime:(pickpocket|rob|scam|atm)|heist:loot|bank:interest|rent:income)$/;
const OUT = /^(casino:bet|game:\w+:bet|table:\w+:stake|travel|race:bet|property:buy|pet|lottery:ticket|election:fee|crime:fine|chat:fee|car:buy|bills:\w+|gift|rent:(fee|movers)|heist:fine)$/;
export const signOf = key => (key === 'dev:adjust' ? 1 : IN.test(key) ? 1 : OUT.test(key) ? -1 : 0);
export function ledger(ch, citizenId, coins, key, note = null) {
  coins = Math.round(Number(coins) || 0); if (!ch || !citizenId || !coins) return; (ch.ledger ||= []).push([citizenId, coins, key, note]);
}
export async function flushLedger(db, rows) {
  if (!rows?.length) return; const t = Date.now();
  await db.query('insert into ledger (citizen_id, t, key, coins, note) select i, $1, k, c, n from unnest($2::text[], $3::text[], $4::bigint[], $5::text[]) x(i, k, c, n)',
    [t, rows.map(r => r[0]), rows.map(r => r[2]), rows.map(r => r[1]), rows.map(r => r[3])]);
}
export async function history(id, limit = 60, before = null) {
  const rows = (await pool.query(`select id, t, key, coins, note from ledger where citizen_id = $1 ${before ? 'and id < $3' : ''} order by id desc limit $2`, before ? [id, limit, before] : [id, limit])).rows;
  const day = Date.now() - 86400000, sums = (await pool.query(`select coalesce(sum(case when coins > 0 then coins end), 0) inn, coalesce(sum(case when coins < 0 then -coins end), 0) outt from ledger where citizen_id = $1 and t > $2 and key not like 'bank:%'`, [id, day])).rows[0];
  return { list: rows.map(r => ({ id: Number(r.id), t: Number(r.t), key: r.key, coins: Number(r.coins), note: r.note })), day: { in: Number(sums.inn), out: Number(sums.outt) } };
}
export async function flushFlows(db, flows) {
  if (!flows?.length) return;
  const day = realDay(), agg = new Map(), who = new Map();
  for (const [k, c, id] of flows) { const a = agg.get(k) || { n: 0, coins: 0 }; a.n++; a.coins += c; agg.set(k, a); if (id) who.set(k + '\u0000' + id, [k, id]); }
  for (const [k, a] of agg) await db.query(`insert into flows (day, key, n, coins) values ($1, $2, $3, $4)
    on conflict (day, key) do update set n = flows.n + $3, coins = flows.coins + $4`, [day, k, a.n, a.coins]);
  if (who.size) { const v = [...who.values()];
    await db.query(`insert into flow_players (day, key, citizen_id) select $1, k, i from unnest($2::text[], $3::text[]) t(k, i) on conflict do nothing`, [day, v.map(x => x[0]), v.map(x => x[1])]); }
}

// A signed-in player used the game today (written once per player per day).
const seen = new Set(); let seenDay = -1;
export function noteActive(id) {
  if (!id) return; const d = realDay(); if (d !== seenDay) { seen.clear(); seenDay = d; }
  if (seen.has(id)) return; seen.add(id); if (seen.size > 200000) seen.clear();
  pool.query('insert into activity (day, citizen_id, t) values ($1, $2, $3) on conflict do nothing', [d, id, Date.now()]).catch(() => {});
}

// Coins in the colony right now. Players are colonists with a password; everyone else is a townsperson.
async function money(db, meta) {
  const today = meta ? R.gameDay(Date.now(), meta.epoch) : 0;
  const r = (await db.query(`select (pass_hash is not null) player, count(*) n,
      coalesce(sum(greatest(0, coins_base + greatest(0, $1 - coalesce(coins_day, $1)) * coalesce(net, 0))), 0) cash,
      coalesce(sum(bank), 0) bank, coalesce(sum(case when net > 0 then net else 0 end), 0) wages
    from citizens group by 1`, [today])).rows;
  const P = r.find(x => x.player) || {}, N = r.find(x => !x.player) || {};
  return { players: Number(P.n || 0), playerCash: Number(P.cash || 0), playerBank: Number(P.bank || 0), playerWagesPerGameDay: Number(P.wages || 0),
    townCash: Number(N.cash || 0), townBank: Number(N.bank || 0), treasury: Math.floor(R.treasuryOn(meta, today)) };
}
export async function snapshot(db, meta) {
  if (!meta) return; const m = await money(db, meta);
  await db.query('insert into snapshots (day, data, t) values ($1, $2, $3) on conflict (day) do update set data = $2, t = $3', [realDay(), m, Date.now()]);
}

// Everything the developer's Stats tab shows.
export async function dashboard(world, days = 30) {
  days = Math.max(7, Math.min(90, Math.floor(Number(days) || 30)));
  const today = realDay(), from = today - days + 1, meta = world.meta, q = (s, a) => pool.query(s, a).then(r => r.rows);
  const DAY = 86400000;
  const [now, act, signups, snaps, flowRows, flowWho, players7, funnelRow, lapsed, cohorts, firstFlow] = await Promise.all([
    money(pool, meta),
    q(`select day, count(*) n from activity where day >= $1 group by day`, [from]),
    q(`select floor(pass_set_at / ${DAY})::int as day, count(*) n from citizens where pass_set_at >= $1 group by 1`, [from * DAY]),
    q(`select day, data from snapshots where day >= $1 order by day`, [from]),
    q(`select day, key, n, coins from flows where day >= $1`, [from]),
    q(`select key, count(distinct citizen_id) p1 from flow_players where day = $1 group by key`, [today]),
    q(`select key, count(distinct citizen_id) p from flow_players where day > $1 group by key`, [today - 7]),
    q(`select
        (select count(distinct citizen_id) from claims) claimed,
        (select count(distinct citizen_id) from claims where verified_at is not null) verified,
        count(*) filter (where pass_hash is not null) signed,
        count(*) filter (where pass_hash is not null and job_id is not null) job,
        count(*) filter (where pass_hash is not null and (daily_day is not null or daily_streak > 0)) daily,
        count(*) filter (where pass_hash is not null and coalesce((stats->>'earned')::bigint, 0) > 0) earned,
        count(*) filter (where pass_hash is not null and (coalesce((stats->>'deposits')::bigint, 0) > 0 or bank > 0)) banked,
        count(*) filter (where pass_hash is not null and coalesce((stats->>'outings')::bigint, 0) > 0) outing,
        count(*) filter (where pass_hash is not null and (cars is not null and jsonb_array_length(cars) > 0)) car,
        count(*) filter (where pass_hash is not null and exists (select 1 from buildings b where b.owner_id = citizens.id)) owner,
        count(*) filter (where pass_hash is not null and (select count(*) from activity a where a.citizen_id = citizens.id) >= 2) returned
      from citizens`),
    q(`select case when s is null then 'never' when s >= $1 then 'today' when s >= $1 - 2 then '1-2' when s >= $1 - 7 then '3-7' when s >= $1 - 30 then '8-30' else '30+' end b, count(*) n
       from (select c.id, greatest(floor(coalesce(c.last_seen, 0) / ${DAY}), (select max(day) from activity a where a.citizen_id = c.id)) s from citizens c where c.pass_hash is not null) x group by 1`, [today]),
    q(`select floor(c.pass_set_at / ${DAY})::int d0, count(*) n,
        count(*) filter (where exists (select 1 from activity a where a.citizen_id = c.id and a.day = floor(c.pass_set_at / ${DAY})::int + 1)) d1,
        count(*) filter (where exists (select 1 from activity a where a.citizen_id = c.id and a.day between floor(c.pass_set_at / ${DAY})::int + 2 and floor(c.pass_set_at / ${DAY})::int + 3)) d3,
        count(*) filter (where exists (select 1 from activity a where a.citizen_id = c.id and a.day between floor(c.pass_set_at / ${DAY})::int + 6 and floor(c.pass_set_at / ${DAY})::int + 8)) d7
       from citizens c where c.pass_set_at >= $1 group by 1 order by 1 desc`, [(today - 21) * DAY]),
    q(`select least((select min(day) from flows), (select min(day) from activity)) d`),
  ]);
  const wau = Number((await q(`select count(distinct citizen_id) n from activity where day > $1`, [today - 7]))[0].n);
  const mau = Number((await q(`select count(distinct citizen_id) n from activity where day > $1`, [today - 30]))[0].n);
  const series = [];
  for (let d = from; d <= today; d++) series.push({ day: d, active: Number(act.find(r => r.day === d)?.n || 0), new: Number(signups.find(r => r.day === d)?.n || 0), money: snaps.find(r => r.day === d)?.data || null });
  const flows = {}; // key → { today: {n, coins, players}, week: {...}, days: [coins per day] }
  for (const r of flowRows) { const f = flows[r.key] ||= { today: { n: 0, coins: 0, players: 0 }, week: { n: 0, coins: 0, players: 0 }, range: { n: 0, coins: 0 }, days: {} };
    const n = Number(r.n), c = Number(r.coins); f.range.n += n; f.range.coins += c; f.days[r.day] = c;
    if (r.day === today) { f.today.n += n; f.today.coins += c; } if (r.day > today - 7) { f.week.n += n; f.week.coins += c; } }
  for (const r of flowWho) if (flows[r.key]) flows[r.key].today.players = Number(r.p1);
  for (const r of players7) if (flows[r.key]) flows[r.key].week.players = Number(r.p);
  for (const r of await q(`select key, count(*) users, count(*) filter (where d >= 2) again from (select key, citizen_id, count(distinct day) d from flow_players where day >= $1 group by 1, 2) x group by key`, [from]))
    if (flows[r.key]) Object.assign(flows[r.key].range, { players: Number(r.users), again: Number(r.again) });
  const F = funnelRow[0] || {}; const fn = k => Number(F[k] || 0);
  return { now: Date.now(), today, days, since: firstFlow[0]?.d ?? today,
    players: { today: series[series.length - 1].active, week: wau, month: mau, signedUp: fn('signed'), newToday: series[series.length - 1].new, newWeek: series.slice(-7).reduce((s, x) => s + x.new, 0) },
    money: now, series, flows,
    funnel: [['claimed', 'Started claiming an avatar', fn('claimed')], ['verified', 'Proved it on Instagram', fn('verified')], ['signed', 'Set a password', fn('signed')],
      ['job', 'Has a job', fn('job')], ['daily', 'Collected a daily reward', fn('daily')], ['earned', 'Earned on the side', fn('earned')], ['outing', 'Went somewhere', fn('outing')],
      ['banked', 'Used the Bank', fn('banked')], ['returned', 'Came back another day', fn('returned')], ['car', 'Bought a car', fn('car')], ['owner', 'Bought a building', fn('owner')]],
    lapsed: Object.fromEntries(lapsed.map(r => [r.b, Number(r.n)])),
    cohorts: cohorts.map(r => ({ day: r.d0, n: Number(r.n), d1: Number(r.d1), d3: Number(r.d3), d7: Number(r.d7) })) };
}
