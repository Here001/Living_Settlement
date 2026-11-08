// Crime progress: what keeps a thief coming back. After every real job (and every heist part played) this adds XP towards
// the next criminal rank, keeps each player's best score in each game, and ticks off the day's three contracts, paying
// each one's reward (coins from the treasury, scaled by the stabiliser; XP) the moment it's done, and a bonus for all three.
// The rules and numbers live in shared/rules.js ("Keeping crime worth coming back to").
import * as R from '../shared/rules.js';
import { BUILDING_TYPES, BANK_TYPES } from '../shared/catalog.js';
import { treasuryAdd } from './races.js';
import { track } from './stats.js';

const SHOPS = Object.keys(BUILDING_TYPES).filter(k => BUILDING_TYPES[k].cat === 'shops' && k !== 'cardealer');
const fmt = n => Math.round(n).toLocaleString('en-US');

// What the colony has, so nobody is set a contract that can't be done (no shop to rob, no Bank).
async function has(q) {
  const r = (await q('select exists(select 1 from buildings where type = any($1) and done and not ruin) shop, exists(select 1 from buildings where type = any($2) and done and not ruin) bank', [SHOPS, BANK_TYPES])).rows[0];
  return { shop: !!r.shop, bank: !!r.bank };
}
// Today's contracts for a player, made the first time they're asked for.
export async function contractsRow(q, citizenId, day = R.realDayKey()) {
  let row = (await q('select * from crime_contracts where citizen_id = $1 and day = $2', [citizenId, day])).rows[0];
  if (!row) { const ids = R.pickContracts(citizenId, day, await has(q));
    await q('insert into crime_contracts (citizen_id, day, ids, prog, paid) values ($1, $2, $3, $4, $5) on conflict do nothing', [citizenId, day, ids, ids.map(() => 0), ids.map(() => false)]);
    await q("delete from crime_contracts where citizen_id = $1 and day < $2", [citizenId, R.realDayKey(Date.now() - 7 * 86400000)]);
    row = (await q('select * from crime_contracts where citizen_id = $1 and day = $2', [citizenId, day])).rows[0]; }
  return row;
}
// How the contracts look to the player.
export const contractsOut = row => ({ day: row.day, bonus: !!row.bonus, all: R.CONTRACT_ALL, list: row.ids.map((id, i) => { const k = R.contractOf(id) || { text: id, n: 1, tier: 1 };
  return { id, text: k.text, tier: k.tier, n: k.n, prog: Math.min(k.n, row.prog[i] || 0), done: !!row.paid[i], pay: R.CONTRACT_PAY[k.tier] }; }) });

// Everything the Crime tab shows about a player's progress.
export async function progressOf(q, c) {
  const bests = Object.fromEntries((await q('select kind, score from crime_best where citizen_id = $1', [c.id])).rows.map(r => [r.kind, r.score]));
  return { rank: R.rankOf(c.crime_xp), bests, contracts: contractsOut(await contractsRow(q, c.id)), hot: R.hotMult(c.crime_streak) };
}

// One thing happened: ev = { solo, heist, kind, won, outcome, total, streak (after this job), state }.
// `c` is the player's row, locked in this change; any reward coins are added to it (the caller saves it).
export async function note(ch, world, c, ev) {
  const q = (s, v) => ch.q(s, v), before = R.rankOf(c.crime_xp);
  let xp = ev.heist ? R.CRIME_XP.heist : (R.CRIME_XP[ev.outcome] || 0) + (ev.won ? R.CRIME_XP.perStreak * Math.max(0, (ev.streak || 1) - 1) : 0);
  // personal best (solo games and practice alike are shown, but only real jobs reach here)
  let best = null;
  if (ev.solo && Number.isFinite(ev.total)) { const prev = (await q('select score from crime_best where citizen_id = $1 and kind = $2', [c.id, ev.kind])).rows[0]?.score ?? null;
    if (prev == null || ev.total > prev) await q('insert into crime_best (citizen_id, kind, score, at) values ($1, $2, $3, $4) on conflict (citizen_id, kind) do update set score = $3, at = $4', [c.id, ev.kind, ev.total, Date.now()]);
    best = { score: ev.total, prev, isNew: prev == null ? false : ev.total > prev }; }
  // contracts
  const row = await contractsRow(q, c.id), done = []; let coins = 0;
  const prog = row.prog.slice(), paid = row.paid.slice();
  row.ids.forEach((id, i) => { const k = R.contractOf(id); if (!k || paid[i] || !R.contractHit(id, ev)) return; prog[i] = Math.min(k.n, (prog[i] || 0) + 1);
    if (prog[i] >= k.n) { paid[i] = true; const P = R.CONTRACT_PAY[k.tier]; done.push({ id, text: k.text, coins: P.coins, xp: P.xp }); xp += P.xp; coins += P.coins; } });
  let bonus = row.bonus; if (!bonus && paid.every(Boolean)) { bonus = true; xp += R.CONTRACT_ALL.xp; coins += R.CONTRACT_ALL.coins; done.push({ id: 'all', text: 'All three of today’s contracts', coins: R.CONTRACT_ALL.coins, xp: R.CONTRACT_ALL.xp }); }
  if (done.length || prog.some((v, i) => v !== row.prog[i])) await q('update crime_contracts set prog = $3, paid = $4, bonus = $5 where citizen_id = $1 and day = $2', [c.id, row.day, prog, paid, bonus]);
  // contract coins come from the treasury like any reward: scaled by the stabiliser, and only what it can afford
  let paidCoins = 0;
  if (coins) { paidCoins = Math.max(0, Math.min(Math.round(coins * R.econF(ch.meta)), Math.floor(R.treasuryOn(ch.meta, ch.today))));
    if (paidCoins) { ch.coins(c); c.coins_base += paidCoins; treasuryAdd(ch, -paidCoins); track(ch, 'crime:contract', paidCoins, c.id); ch.touch(c); } }
  const total = Number((await q('update citizens set crime_xp = crime_xp + $2 where id = $1 returning crime_xp', [c.id, xp])).rows[0].crime_xp); c.crime_xp = total;
  const after = R.rankOf(total);
  if (after.i > before.i) { await ch.event(`${after.icon} @${c.handle} is now a ${after.name}.`, 'crime');
    await world.actions?.notify(ch, c.id, 'crime', `${after.icon} You're now a ${after.name}! Everything you take is ${Math.round(after.bonus * 100)}% bigger, for good.`); }
  // a solo job shows its contracts on the result screen; a heist settles later, so say it in a notice
  if (ev.heist) for (const d of done) if (d.id !== 'all') await world.actions?.notify(ch, c.id, 'crime', `📋 Contract done: ${d.text}. +${fmt(d.coins)} coins, +${d.xp} XP.`);
  return { xp: { gain: xp, rank: after, up: after.i > before.i ? after : null }, best, contracts: { ...contractsOut({ ...row, prog, paid, bonus }), done, coins: paidCoins } };
}
