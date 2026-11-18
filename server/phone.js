// The in-game phone: calling another player. A call rings on their screen (wherever they are in the game: on the map
// or inside a place); they answer or decline. Once answered, the two of you talk through the same voice service as voice
// chat inside places (server/voice.js), in a private "place" of your own: 'c:<call id>'. Nobody else can join it.
// Calls are kept in memory (one server): a call that's never answered stops ringing after RING_MS and the person you
// called gets a "missed call" notice; a call ends when either of you hangs up, or after MAX_MS.
import { pool } from './db.js';
import { HttpError } from './world.js';

export const RING_MS = 30000;          // how long a call rings before it's missed
export const MAX_MS = 60 * 60000;      // the longest a call can go on
const PER_HOUR = 30;                   // calls you can make in an hour

export class Phone {
  constructor(world) { this.world = world; this.calls = new Map(); this.byUser = new Map(); this.made = new Map(); this.online = () => true; }
  pub(call, data) { this.world.bus.publish([{ op: 'phone', private: true, to: [call.from.id, call.to.id], data }]); }
  view(c) { return { id: c.id, from: c.from.h, to: c.to.h, state: c.state, t: c.t, at: c.at || null, place: 'c:' + c.id }; }
  // is this person on this call, and is it live (for voice)?
  inCall(id, who) { const c = this.calls.get(id); return !!c && c.state === 'live' && (c.from.id === who || c.to.id === who); }
  ids(id) { const c = this.calls.get(id); return c ? [c.from.id, c.to.id] : null; }
  mine(me, id) { const c = this.calls.get(String(id || '')); if (!c || (c.from.id !== me.id && c.to.id !== me.id)) throw new HttpError(404, 'That call has ended.'); return c; }
  // what you're on right now (when your page reloads mid-call)
  now(me) { const c = this.calls.get(this.byUser.get(me.id)); return { call: c ? this.view(c) : null }; }

  async call(me, handle) {
    const h = String(handle || '').replace(/^@/, '').trim(); if (!h) throw new HttpError(400, 'Who do you want to call?');
    const to = (await pool.query('select id, handle, pass_hash is not null verified from citizens where lower(handle) = lower($1)', [h])).rows[0];
    if (!to) throw new HttpError(404, 'No colonist with that name.'); if (to.id === me.id) throw new HttpError(400, 'You can’t call yourself.');
    if (!to.verified) throw new HttpError(409, `@${to.handle} hasn’t verified their avatar yet, so they don’t have a phone.`);
    const b = await this.world.chat.blockState(me.id, to.id); if (b.iBlocked) throw new HttpError(409, `You blocked @${to.handle}.`); if (b.blockedMe) throw new HttpError(409, `@${to.handle} can’t take your calls.`);
    if (this.byUser.has(me.id)) throw new HttpError(409, 'You’re already on a call. Hang up first.');
    if (this.byUser.has(to.id)) throw new HttpError(409, `@${to.handle} is on another call. Try again in a bit.`);
    if (!this.online(to.id)) throw new HttpError(409, `@${to.handle} isn’t online right now. Send them a message instead.`);
    const now = Date.now(), made = (this.made.get(me.id) || []).filter(t => now - t < 3600000); if (made.length >= PER_HOUR) throw new HttpError(429, 'You’ve made a lot of calls. Take a break and try again later.');
    made.push(now); this.made.set(me.id, made); if (this.made.size > 20000) this.made.clear();
    const id = now.toString(36) + Math.random().toString(36).slice(2, 8), c = { id, from: { id: me.id, h: me.handle }, to: { id: to.id, h: to.handle }, state: 'ringing', t: now };
    this.calls.set(id, c); this.byUser.set(me.id, id); this.byUser.set(to.id, id);
    c.timer = setTimeout(() => this.end(c, 'missed'), RING_MS); c.timer.unref?.();
    this.pub(c, { kind: 'ring', call: this.view(c) }); return { call: this.view(c) };
  }
  async answer(me, id, accept) { const c = this.mine(me, id);
    if (c.to.id !== me.id) throw new HttpError(409, 'Only the person being called can answer.'); if (c.state !== 'ringing') return { call: this.view(c) };
    if (!accept) { this.end(c, 'declined'); return { ok: true }; }
    clearTimeout(c.timer); c.state = 'live'; c.at = Date.now(); c.timer = setTimeout(() => this.end(c, 'long'), MAX_MS); c.timer.unref?.();
    this.pub(c, { kind: 'live', call: this.view(c) }); return { call: this.view(c) }; }
  async hangup(me, id) { const c = this.mine(me, id); this.end(c, c.state === 'ringing' && c.from.id === me.id ? 'cancelled' : 'ended', me.id); return { ok: true }; }
  end(c, why, by) { if (!this.calls.has(c.id)) return; clearTimeout(c.timer); this.calls.delete(c.id);
    for (const p of [c.from, c.to]) { if (this.byUser.get(p.id) === c.id) this.byUser.delete(p.id); this.world.voice?.drop(p.id, 'c:' + c.id); }
    this.pub(c, { kind: 'end', id: c.id, why, by: by === c.from.id ? c.from.h : by === c.to.id ? c.to.h : null, secs: c.at ? Math.round((Date.now() - c.at) / 1000) : 0 });
    if (why === 'missed' || why === 'cancelled') this.world.personal(ch => this.world.actions?.notify(ch, c.to.id, 'call', `📞 Missed call from @${c.from.h}.`)).catch(() => {}); }
  // someone left the game altogether (their last connection closed): their call ends
  gone(id) { const cid = this.byUser.get(id), c = cid && this.calls.get(cid); if (c) this.end(c, 'ended', id); }
}
