// The first-day guide: a short checklist that walks a new colonist through the game, with a small reward for each
// step (paid once, by the treasury) and a bonus for finishing. Every step is checked from what they've actually done.
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { treasuryAdd } from './races.js';
import { track } from './stats.js';

export const GUIDE_STEPS = [
  { id: 'daily', icon: '🎁', title: 'Collect your daily reward', how: 'Free coins every day, more the longer your streak.', reward: 250 },
  { id: 'job', icon: '💼', title: 'Get a job', how: 'A job pays wages every game day. Pick one near home.', reward: 500 },
  { id: 'earn', icon: '📦', title: 'Earn coins on the side', how: 'Do a delivery, an extra shift, fishing, foraging or scavenging in 💰 Earn.', reward: 500 },
  { id: 'bank', icon: '🏦', title: 'Put cash in the Bank', how: "Cash on you can be pickpocketed. Tap a Bank on the map and deposit some.", reward: 500 },
  { id: 'out', icon: '🚶', title: 'Go out somewhere', how: 'Tap any building on the map and press Go here, then watch them go.', reward: 250 },
  { id: 'post', icon: '📣', title: 'Say hello in Town Square', how: 'Post a message so the colony knows you’ve arrived.', reward: 250 },
];
export const GUIDE_BONUS = 1500;

export class Guide {
  constructor(world) { this.world = world; }
  async state(db, id) {
    const c = (await db.query(`select c.id, c.job_id, c.bank, c.daily_streak, c.daily_day, c.stats, c.guide, c.pass_hash,
      (select count(*) from messages m where m.citizen_id = c.id) posts from citizens c where c.id = $1`, [id])).rows[0];
    if (!c) throw new HttpError(404, 'No such citizen.');
    const st = c.stats || {}, g = c.guide || {}, got = new Set(g.claimed || []);
    const done = { daily: c.daily_day != null || Number(c.daily_streak) > 0, job: !!c.job_id, earn: Number(st.earned || 0) > 0,
      bank: Number(st.deposits || 0) > 0 || Number(c.bank || 0) > 0, out: Number(st.outings || 0) > 0, post: Number(c.posts) > 0 };
    const steps = GUIDE_STEPS.map(s => ({ ...s, done: !!done[s.id], claimed: got.has(s.id) }));
    return { c, g, got, steps, bonus: { reward: GUIDE_BONUS, claimed: got.has('bonus'), ready: steps.every(s => s.done) }, hidden: !!g.hidden };
  }
  async info(id) { const { steps, bonus, hidden } = await this.state(pool, id); return { steps, bonus, hidden, finished: bonus.claimed }; }
  // Collect the reward for a finished step (or the bonus once they're all done).
  async claim(id, step) {
    return this.world.change(async ch => {
      const S = await this.state({ query: (q, a) => ch.q(q, a) }, id), { got } = S;
      const s = step === 'bonus' ? { id: 'bonus', reward: GUIDE_BONUS, done: S.bonus.ready } : S.steps.find(x => x.id === step);
      if (!s) throw new HttpError(400, 'No such step.');
      if (!s.done) throw new HttpError(409, step === 'bonus' ? 'Finish every step first.' : "You haven't done that yet.");
      if (got.has(s.id)) throw new HttpError(409, "You've already collected that.");
      const c = (await ch.q('select * from citizens where id = $1 for update', [id])).rows[0];
      const paid = Math.max(0, Math.min(s.reward, Math.floor(R.treasuryOn(ch.meta, ch.today))));
      ch.coins(c); c.coins_base += paid; if (paid) treasuryAdd(ch, -paid); track(ch, 'guide', paid, c.id); ch.touch(c); await ch.saveCitizen(c);
      got.add(s.id); await ch.q('update citizens set guide = $2 where id = $1', [id, JSON.stringify({ ...S.g, claimed: [...got] })]);
      return { ok: true, step: s.id, paid, coins: c.coins_base };
    });
  }
  async hide(id, hidden) { await pool.query("update citizens set guide = coalesce(guide, '{}'::jsonb) || jsonb_build_object('hidden', $2::boolean) where id = $1", [id, !!hidden]); return { ok: true }; }
}
