// Leaderboards: who's on top, among verified colonists. Four boards are weekly (they start again every Monday at 00:00 UTC,
// so newcomers can win), four are standings that never reset. Balances are private, so the money boards show the order only.
// The weekly winners are announced in the Colony Log when the week turns over, and kept as "last week's champions".
import { pool } from './db.js';
import * as R from '../shared/rules.js';

const WEEK = 7 * 86400000, MONDAY = 4 * 86400000; // 1 Jan 1970 was a Thursday; weeks start on Monday
export const weekOf = (t = Date.now()) => Math.floor((t - MONDAY) / WEEK);
export const weekStart = w => w * WEEK + MONDAY;
export const BOARDS = {
  racer:    { weekly: true,  icon: '🏁', name: 'Top racer',      unit: 'coins won at the races', show: true },
  casino:   { weekly: true,  icon: '🎰', name: 'Luckiest',       unit: 'coins won at the casino', show: true },
  wanted:   { weekly: true,  icon: '🦹', name: 'Most wanted',    unit: 'crimes got away with', show: true },
  generous: { weekly: true,  icon: '🎁', name: 'Most generous',  unit: 'gifted', show: false },
  richest:  { weekly: false, icon: '💰', name: 'Richest',        unit: 'coins', show: false },
  landlord: { weekly: false, icon: '🏙️', name: 'Biggest landlord', unit: 'buildings', show: true },
  streak:   { weekly: false, icon: '🔥', name: 'Longest streak', unit: 'days in a row', show: true },
  badges:   { weekly: false, icon: '🏅', name: 'Most badges',    unit: 'badges', show: true },
};

// Add to a colonist's score for this week (inside a change).
export async function score(ch, id, key, n) {
  n = Math.trunc(n); if (!n) return;
  await ch.q('insert into scores (week, key, citizen_id, value) values ($1, $2, $3, $4) on conflict (week, key, citizen_id) do update set value = scores.value + excluded.value', [weekOf(), key, id, n]);
}

export class Leaderboards {
  constructor(world) { this.world = world; this.cache = new Map(); }
  // Every verified colonist's value on a board, highest first (only positive values).
  sql(board, week) {
    const today = this.world.meta ? R.gameDay(Date.now(), this.world.meta.epoch) : 0, day = Math.floor(Date.now() / 86400000);
    const V = "c.pass_hash is not null";
    switch (board) {
      case 'racer': return [`select c.id, c.handle, c.display_name, c.gender, sum(coalesce(r.payout, 0) - r.amount)::bigint v from race_bets r join citizens c on c.id = r.citizen_id
        where ${V} and r.t >= $1 and r.t < $2 group by c.id having sum(coalesce(r.payout, 0) - r.amount) > 0`, [weekStart(week), weekStart(week + 1)]];
      case 'casino': case 'wanted': case 'generous': return [`select c.id, c.handle, c.display_name, c.gender, s.value v from scores s join citizens c on c.id = s.citizen_id
        where ${V} and s.week = $1 and s.key = $2 and s.value > 0`, [week, board === 'casino' ? 'casino_net' : board === 'wanted' ? 'crimes' : 'gifted']];
      case 'richest': return [`select c.id, c.handle, c.display_name, c.gender, (greatest(0, c.coins_base + greatest(0, $1::int - coalesce(c.coins_day, 0)) * c.net) + coalesce(c.bank, 0))::bigint v
        from citizens c where ${V}`, [today]];
      case 'landlord': return [`select c.id, c.handle, c.display_name, c.gender, count(*)::bigint v from buildings b join citizens c on c.id = b.owner_id where ${V} group by c.id`, []];
      case 'streak': return [`select c.id, c.handle, c.display_name, c.gender, c.daily_streak::bigint v from citizens c where ${V} and c.daily_day >= $1 and c.daily_streak > 0`, [day - 1]];
      case 'badges': return [`select c.id, c.handle, c.display_name, c.gender, count(*)::bigint v from achievements a join citizens c on c.id = a.citizen_id where ${V} group by c.id`, []];
    }
    return null;
  }
  async ranked(board, week) {
    const q = this.sql(board, week); if (!q) return [];
    return (await pool.query(`select *, rank() over (order by v desc) rk from (${q[0]}) x where v > 0 order by v desc, handle limit 2000`, q[1])).rows
      .map(r => ({ id: r.id, h: r.handle, n: r.display_name || '', g: r.gender || 'm', v: Number(r.v), rank: Number(r.rk) }));
  }
  async board(board, meId) {
    const B = BOARDS[board]; if (!B) return null; const week = weekOf();
    let c = this.cache.get(board); if (!c || Date.now() - c.t > 30000 || c.week !== week) { c = { t: Date.now(), week, rows: await this.ranked(board, week) }; this.cache.set(board, c); }
    const out = r => ({ h: r.h, n: r.n, g: r.g, rank: r.rank, v: B.show ? r.v : undefined, me: r.id === meId || undefined });
    const mine = meId ? c.rows.find(r => r.id === meId) : null;
    const champ = B.weekly ? (await pool.query('select handle, value from weekly_champions where board = $1 and week = $2', [board, week - 1])).rows[0] : null;
    return { board, ...B, top: c.rows.slice(0, 10).map(out), players: c.rows.length, me: mine ? out(mine) : null,
      resetsAt: B.weekly ? weekStart(week + 1) : null, lastChampion: champ ? { h: champ.handle, v: B.show ? Number(champ.value) : undefined } : null };
  }
  // When a new week starts: crown last week's winners (once), and say so in the Colony Log.
  async rollover() {
    const prev = weekOf() - 1;
    if ((await pool.query('select 1 from weekly_champions where week = $1 limit 1', [prev])).rowCount) return null;
    if ((await pool.query('select 1 from weekly_done where week = $1', [prev])).rowCount) return null;
    await pool.query('insert into weekly_done (week) values ($1) on conflict do nothing', [prev]);
    const winners = [];
    for (const [k, B] of Object.entries(BOARDS)) if (B.weekly) { const top = (await this.ranked(k, prev))[0]; if (top) winners.push([k, B, top]); }
    for (const [k, , top] of winners) await pool.query('insert into weekly_champions (week, board, citizen_id, handle, value) values ($1, $2, $3, $4, $5) on conflict do nothing', [prev, k, top.id, top.h, top.v]);
    if (winners.length && this.world.meta) await this.world.change(async ch => ch.event(`🏆 Last week's champions: ${winners.map(([, B, t]) => `${B.icon} ${B.name} @${t.h}`).join(', ')}. A new week has begun!`, 'champions')).catch(() => {});
    this.cache.clear(); return winners.map(([k, , t]) => [k, t.h]);
  }
}
