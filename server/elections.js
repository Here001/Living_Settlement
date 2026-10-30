// Mayor elections. Each week (Monday to Monday, UTC) verified colonists can run for mayor with a pledge, and everyone
// verified gets one vote (which they can change). When the week ends the most votes wins (a tie goes to whoever ran
// first), and the winner is mayor for the next week: their pledge takes effect, they wear a crown, and they draw a
// salary from the treasury each game day.
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { POLICIES, RUN_FEE, MAYOR_PAY, PITCH_MAX } from '../shared/elections.js';
import { weekOf, weekStart } from './leaderboards.js';
import { treasuryAdd } from './races.js';

const fmt = n => Math.round(n).toLocaleString('en-US');

export class Elections {
  constructor(world) { this.world = world; this.cache = { t: 0, week: null, mayor: null }; }
  // The mayor right now: the winner of last week's election.
  async mayor() {
    const w = weekOf() + (this.testShift || 0); if (this.cache.week === w && Date.now() - this.cache.t < 20000) return this.cache.mayor; // (testShift: tests jump a week ahead)
    const r = (await pool.query('select * from elections where week = $1 and winner_id is not null', [w - 1])).rows[0];
    const m = r ? { id: r.winner_id, handle: r.winner_handle, policy: r.policy, votes: r.votes, total: r.total, since: weekStart(w), until: weekStart(w + 1) } : null;
    this.cache = { t: Date.now(), week: w, mayor: m }; return m;
  }
  async policy() { return (await this.mayor())?.policy || null; }
  async has(policy) { return (await this.policy()) === policy; }
  async info(playerId) {
    const w = weekOf(), mayor = await this.mayor();
    const cands = (await pool.query(`select k.citizen_id id, k.handle, k.policy, k.pitch, k.t, c.display_name, c.gender,
      (select count(*) from mayor_votes v where v.week = k.week and v.candidate_id = k.citizen_id) votes
      from candidates k join citizens c on c.id = k.citizen_id where k.week = $1 order by votes desc, k.t`, [w])).rows;
    const myVote = playerId ? (await pool.query('select candidate_id from mayor_votes where week = $1 and voter_id = $2', [w, playerId])).rows[0]?.candidate_id || null : null;
    const last = (await pool.query('select week, winner_handle, policy, votes, total from elections where week < $1 order by week desc limit 4', [w])).rows;
    return { week: w, endsAt: weekStart(w + 1), now: Date.now(), mayor, fee: RUN_FEE, pay: MAYOR_PAY, pitchMax: PITCH_MAX, policies: POLICIES,
      candidates: cands.map(k => ({ handle: k.handle, name: k.display_name || '', g: k.gender || 'm', policy: k.policy, pitch: k.pitch || '', votes: Number(k.votes), me: k.id === playerId, myVote: k.id === myVote })),
      iVoted: !!myVote, iRun: cands.some(k => k.id === playerId), past: last.map(e => ({ week: e.week, winner: e.winner_handle, policy: e.policy, votes: e.votes, total: e.total })) };
  }
  async run(id, { policy, pitch }) {
    if (!POLICIES[policy]) throw new HttpError(400, 'Pick a pledge.');
    pitch = String(pitch || '').replace(/\s+/g, ' ').trim();
    if (pitch.length > PITCH_MAX) throw new HttpError(400, `Keep your pitch to ${PITCH_MAX} characters.`);
    if (/https?:\/\/|www\./i.test(pitch)) throw new HttpError(400, 'No links in your pitch, please.');
    return this.world.change(async ch => {
      const w = weekOf(), c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0];
      if (!c) throw new HttpError(404, 'No such citizen.');
      if (!c.pass_hash) throw new HttpError(403, 'Verify your avatar first (set a password) to run for mayor.');
      if (!c.home_id) throw new HttpError(409, 'You need a home in the colony to run for mayor.');
      if (Number(c.jailed_until || 0) > Date.now()) throw new HttpError(409, "You can't run for mayor from jail.");
      if ((await ch.q('select 1 from candidates where week = $1 and citizen_id = $2', [w, id])).rowCount) throw new HttpError(409, "You're already running this week.");
      ch.coins(c); if (c.coins_base < RUN_FEE) throw new HttpError(400, `Running for mayor costs ${fmt(RUN_FEE)} coins (cash). You have ${fmt(c.coins_base)} on you.`);
      c.coins_base -= RUN_FEE; treasuryAdd(ch, RUN_FEE); ch.touch(c); await ch.saveCitizen(c);
      await ch.q('insert into candidates (week, citizen_id, handle, policy, pitch, t) values ($1, $2, $3, $4, $5, $6)', [w, id, c.handle, policy, pitch, Date.now()]);
      await ch.event(`🗳️ @${c.handle} is running for mayor, pledging ${POLICIES[policy].icon} ${POLICIES[policy].name}.`, 'election');
      return { ok: true, coins: c.coins_base };
    });
  }
  async withdraw(id) {
    const w = weekOf();
    const r = await pool.query('delete from candidates where week = $1 and citizen_id = $2 returning handle', [w, id]);
    if (!r.rowCount) throw new HttpError(400, "You're not running this week.");
    await pool.query('delete from mayor_votes where week = $1 and candidate_id = $2', [w, id]);
    return { ok: true };
  }
  async vote(id, handle) {
    const w = weekOf(), h = R.cleanHandle(handle);
    const me = (await pool.query('select pass_hash from citizens where id = $1', [id])).rows[0];
    if (!me?.pass_hash) throw new HttpError(403, 'Verify your avatar first (set a password) to vote.');
    const k = (await pool.query('select citizen_id from candidates where week = $1 and lower(handle) = lower($2)', [w, h])).rows[0];
    if (!k) throw new HttpError(404, `@${h} isn't running this week.`);
    await pool.query(`insert into mayor_votes (week, voter_id, candidate_id, t) values ($1, $2, $3, $4)
      on conflict (week, voter_id) do update set candidate_id = $3, t = $4`, [w, id, k.citizen_id, Date.now()]);
    return { ok: true, votedFor: h };
  }
  // When a week ends: count its votes and crown the winner (once, by the leader server).
  async tally(now = Date.now()) {
    const w = weekOf(now) - 1;
    if ((await pool.query('select 1 from elections where week = $1', [w])).rowCount) return null;
    return this.world.change(async ch => {
      if ((await ch.q('select 1 from elections where week = $1', [w])).rowCount) return null;
      const rows = (await ch.q(`select k.citizen_id id, k.handle, k.policy, k.t, (select count(*) from mayor_votes v where v.week = k.week and v.candidate_id = k.citizen_id) votes
        from candidates k where k.week = $1 order by votes desc, k.t`, [w])).rows;
      const total = rows.reduce((s, r) => s + Number(r.votes), 0), win = rows[0] || null;
      await ch.q('insert into elections (week, winner_id, winner_handle, policy, votes, total, decided_at) values ($1, $2, $3, $4, $5, $6, $7)',
        [w, win?.id || null, win?.handle || null, win?.policy || null, win ? Number(win.votes) : 0, total, Date.now()]);
      if (win) {
        const P = POLICIES[win.policy];
        await ch.event(`👑 @${win.handle} is the new mayor with ${fmt(win.votes)} of ${fmt(total)} vote${total === 1 ? '' : 's'}! For the next week: ${P.icon} ${P.name}.`, 'election');
        ch.pushes.push([[win.id], { kind: 'win', title: '👑 You won the election!', body: `You're mayor for the next week. Your pledge, ${P.name}, is now in effect.`, tag: 'election', urgency: 'high' }]);
        const lost = rows.slice(1).map(r => r.id); if (lost.length) ch.pushes.push([lost, { kind: 'win', title: '🗳️ Election results', body: `@${win.handle} won with ${fmt(win.votes)} votes. Better luck next week!`, tag: 'election' }]);
      } else if (rows.length === 0) await ch.event('🗳️ Nobody ran for mayor last week, so the colony has no mayor this week.', 'election');
      this.cache.t = 0;
      return win;
    });
  }
}
