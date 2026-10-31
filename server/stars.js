// Activity stars (1 to 12). Every action a signed-in player takes (anything that changes something, at most one every
// 5 seconds) is a point, and every real day they play adds 20 (shared/rules.js: STAR_STEPS).
import { pool } from './db.js';
import * as R from '../shared/rules.js';

const last = new Map(), days = new Map();
const SKIP = /^\/(dm\/[^/]+\/read|me\/push|me\/notices|report)/; // reading and settings don't count
export class Stars {
  constructor(world, bus) { this.world = world; this.bus = bus; }
  async daysOf(id) { const c = days.get(id); if (c && Date.now() - c.t < 600000) return c.n;
    const n = Number((await pool.query('select count(*) n from activity where citizen_id = $1', [id])).rows[0].n); days.set(id, { n, t: Date.now() }); if (days.size > 20000) days.clear(); return n; }
  async act(p, path) {
    if (!p || SKIP.test(path || '')) return; const now = Date.now(); if (now - (last.get(p.id) || 0) < 5000) return; last.set(p.id, now); if (last.size > 50000) last.clear();
    const r = (await pool.query('update citizens set acts = acts + 1 where id = $1 returning acts, stars, handle', [p.id])).rows[0]; if (!r) return;
    const score = Number(r.acts) + R.STAR_DAY_POINTS * await this.daysOf(p.id), stars = R.starsFor(score);
    if (stars > Number(r.stars)) { await pool.query('update citizens set stars = $2 where id = $1', [p.id, stars]);
      this.bus.publish([{ op: 'stars', private: true, to: [p.id], data: { stars } }]);
      if (stars >= 4 && this.world.meta) await this.world.change(async ch => ch.event(`⭐ @${r.handle} reached ${stars} stars.`, 'badge')).catch(() => {}); }
  }
  async info(id) {
    const r = (await pool.query('select acts, stars from citizens where id = $1', [id])).rows[0]; if (!r) return null;
    const d = await this.daysOf(id), score = Number(r.acts) + R.STAR_DAY_POINTS * d, stars = R.starsFor(score);
    if (stars !== Number(r.stars)) await pool.query('update citizens set stars = $2 where id = $1', [id, stars]);
    return { stars, score, acts: Number(r.acts), days: d, steps: R.STAR_STEPS, next: R.STAR_STEPS[stars] ?? null, prev: stars ? R.STAR_STEPS[stars - 1] : 0 };
  }
}
