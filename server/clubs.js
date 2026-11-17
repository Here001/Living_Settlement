// Night clubs: spraying money. Inside a club you can spray someone (the notes fall on their screen and they tap to pick
// them up; a quarter of what they miss is theirs anyway, the rest the club's),
// or spray the whole club: for RAIN_MS money falls from the ceiling on everyone inside, and each of them grabs what they
// can by tapping the falling notes, a bit at a time, until it's all gone. Whatever nobody grabs is swept up by the
// club (its owner; the treasury if it has none). Spraying the whole club gets you a shout-out from the DJ.
import { pool } from './db.js';
import { HttpError } from './world.js';
import { BUILDING_TYPES } from '../shared/catalog.js';
import { treasuryAdd } from './races.js';
import { track } from './stats.js';

export const SPRAY_PERSON = [200, 1000, 5000, 20000];       // quick amounts for spraying one person (any amount you have is fine)
export const SPRAY_CLUB = [10000, 50000, 200000, 1000000];  // quick amounts for spraying the whole club (any amount you have is fine)
const amountOf = v => { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 1 || n > 1e12) throw new HttpError(400, 'How much do you want to spray?'); return n; };
export const RAIN_MS = 20000;                               // how long the money falls on the whole club
export const PERSON_MS = 10000;                             // how long it falls on someone you spray (each spray keeps it going)
export const BACK_SHARE = 0.25;                             // what's left of a spray on someone when it stops: this much of it is theirs anyway
const fmt = n => Math.round(n).toLocaleString('en-US');
const SHOUTS = [
  (h, a, c) => `Make some noise for @${h}! The whole of ${c} just got sprayed with ${a} coins! Grab it, grab it! 💸`,
  (h, a) => `Big boss @${h} in the building! ${a} coins raining down on everybody, hands up! 💸💸`,
  (h, a) => `Ehen! @${h} don spray the whole club, ${a} coins! Odogwu! Who get money pass @${h}? Nobody! 💸`,
  (h, a, c) => `${c}, are you feeling it?! @${h} is making it rain, ${a} coins for everybody! Pick am sharp sharp! 💸`,
];

export class Clubs {
  constructor(world) { this.world = world; this.last = new Map(); }
  // the club a place is ('b:<building id>'), or an error
  async club(place) {
    const m = /^b:([A-Za-z0-9_.-]{1,64})$/.exec(String(place || '')); if (!m) throw new HttpError(400, 'Which club?');
    const b = (await pool.query('select id, type, name, owner_id from buildings where id = $1', [m[1]])).rows[0];
    if (!b || !BUILDING_TYPES[b.type]?.guests) throw new HttpError(404, 'You can only spray money in a night club.');
    return { ...b, name: b.name || BUILDING_TYPES[b.type].name };
  }
  here(place, id) { const e = this.world.rooms.here.get(place)?.get('p:' + id); return !!e && Date.now() - e.at < 70000; }
  people(place) { const m = this.world.rooms.here.get(place), now = Date.now(); return m ? [...m].filter(([w, e]) => w.startsWith('p:') && now - e.at < 70000).map(([w, e]) => ({ id: w.slice(2), name: e.name })) : []; }
  send(place, club) { this.world.bus.publish([{ inside: true, place, k: 'club', club }]); }
  // spray one person who's in the club with you
  // spray someone in the club with you: the money falls on their screen and they tap to pick it up (only they can).
  // Spraying them again while it's still falling adds to it and keeps it falling. When it stops, BACK_SHARE of what they
  // didn't pick still comes to them; the rest is swept up by the club.
  async sprayPerson(me, place, handle, amount) {
    amount = amountOf(amount);
    const club = await this.club(place); if (!this.here(place, me.id)) throw new HttpError(409, 'You need to be in the club.');
    const to = (await pool.query('select id, handle from citizens where lower(handle) = lower($1)', [String(handle || '').replace(/^@/, '')])).rows[0];
    if (!to) throw new HttpError(404, 'No colonist with that name.'); if (to.id === me.id) throw new HttpError(400, 'Spray someone else!');
    if (!this.here(place, to.id)) throw new HttpError(409, `@${to.handle} isn’t in the club right now.`);
    const now = Date.now(), until = now + PERSON_MS;
    const r = await this.world.personal(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [me.id])).rows[0]; ch.coins(c);
      if (Number(c.coins_base) < amount) throw new HttpError(400, `You need ${fmt(amount)} coins on you to spray that. You have ${fmt(c.coins_base)}.`);
      c.coins_base = Number(c.coins_base) - amount; ch.touch(c); await ch.saveCitizen(c); track(ch, 'club:spray', amount, c.id);
      const cur = (await ch.q('select id from club_rains where place = $1 and from_id = $2 and to_id = $3 and not done and until > $4 for update', [place, me.id, to.id, now])).rows[0];
      let id; if (cur) { id = cur.id; await ch.q('update club_rains set total = total + $2, left_amt = left_amt + $2, until = $3 where id = $1', [id, amount, until]); } /* still falling: more of it, for longer */
      else { id = 'spray-' + now.toString(36) + Math.random().toString(36).slice(2, 7);
        await ch.q('insert into club_rains (id, place, building_id, from_id, from_handle, to_id, to_handle, total, left_amt, t, until) values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10)', [id, place, club.id, me.id, me.handle, to.id, to.handle, amount, now, until]);
        await this.world.actions?.notify(ch, to.id, 'club', `💸 @${me.handle} is spraying you money at ${club.name}! Tap the notes to pick it up.`); }
      return { id, coins: Math.round(c.coins_base) };
    });
    this.send(place, { kind: 'spray', id: r.id, from: me.handle, to: to.handle, amount, until, ms: PERSON_MS });
    return { ok: true, ...r };
  }
  // spray the whole club: the money rains on everyone inside for a while, and they grab what they can
  async sprayClub(me, place, amount) {
    amount = amountOf(amount);
    const club = await this.club(place); if (!this.here(place, me.id)) throw new HttpError(409, 'You need to be in the club.');
    const busy = (await pool.query('select 1 from club_rains where place = $1 and to_id is null and not done and until > $2 limit 1', [place, Date.now()])).rowCount;
    if (busy) throw new HttpError(409, 'Money is already raining in here! Wait for it to finish.');
    const now = Date.now(), id = 'rain-' + now.toString(36) + Math.random().toString(36).slice(2, 7), until = now + RAIN_MS;
    const r = await this.world.personal(async ch => {
      const c = (await ch.q('select * from citizens where id = $1 for update', [me.id])).rows[0]; ch.coins(c);
      if (Number(c.coins_base) < amount) throw new HttpError(400, `You need ${fmt(amount)} coins on you to spray the club. You have ${fmt(c.coins_base)}.`);
      c.coins_base = Number(c.coins_base) - amount; ch.touch(c); await ch.saveCitizen(c); track(ch, 'club:rain', amount, c.id);
      await ch.q('insert into club_rains (id, place, building_id, from_id, from_handle, total, left_amt, t, until) values ($1, $2, $3, $4, $5, $6, $6, $7, $8)', [id, place, club.id, me.id, me.handle, amount, now, until]);
      if (amount >= 200000) await ch.event?.(`💸 @${me.handle} sprayed the whole of ${club.name} with ${fmt(amount)} coins!`, 'club');
      return { coins: Math.round(c.coins_base) };
    });
    const shout = SHOUTS[Math.floor(Math.random() * SHOUTS.length)](me.handle, fmt(amount), club.name);
    this.send(place, { kind: 'rain', id, from: me.handle, amount, until, ms: RAIN_MS });
    this.send(place, { kind: 'dj', text: shout, for: me.handle });
    return { ok: true, id, until, ...r };
  }
  // a tap on a falling note: a share of what's left
  async grab(me, id) {
    const now = Date.now(), k = me.id + ':' + id; if (now - (this.last.get(k) || 0) < 180) return { ok: true, got: 0 }; this.last.set(k, now); if (this.last.size > 20000) this.last.clear();
    const rain = (await pool.query('select * from club_rains where id = $1', [String(id)])).rows[0];
    if (!rain || rain.done || Number(rain.until) < now) return { ok: true, got: 0, over: true };
    if (rain.from_id === me.id) return { ok: true, got: 0, own: true }; /* you can't grab your own money back */
    if (rain.to_id && rain.to_id !== me.id) return { ok: true, got: 0, notYours: true }; /* money sprayed on someone is theirs to pick */
    if (!this.here(rain.place, me.id)) throw new HttpError(409, 'You need to be in the club.');
    const n = rain.to_id ? 1.4 : Math.max(3, this.people(rain.place).length - 1), share = Math.max(1, Math.round(Number(rain.total) / (n * 6) * (0.6 + Math.random() * 0.8)));
    return this.world.personal(async ch => {
      const cur = (await ch.q('select left_amt from club_rains where id = $1 and not done and until > $2 for update', [rain.id, Date.now()])).rows[0];
      if (!cur || Number(cur.left_amt) <= 0) return { ok: true, got: 0, over: true };
      const got = Math.min(share, Number(cur.left_amt)), left = { left_amt: Number(cur.left_amt) - got }; /* the last grab may get less */
      await ch.q('update club_rains set left_amt = $2 where id = $1', [rain.id, left.left_amt]);
      const c = (await ch.q('select * from citizens where id = $1 for update', [me.id])).rows[0]; ch.coins(c); c.coins_base = Number(c.coins_base) + got; ch.touch(c); await ch.saveCitizen(c);
      await ch.q('insert into club_grabs (rain_id, citizen_id, handle, got) values ($1, $2, $3, $4) on conflict (rain_id, citizen_id) do update set got = club_grabs.got + excluded.got', [rain.id, me.id, me.handle, got]);
      track(ch, 'club:grab', got, c.id);
      return { ok: true, got, left: Number(left.left_amt), coins: Math.round(c.coins_base) };
    });
  }
  // every few seconds: money that has stopped falling. What's left goes to the club; everyone hears who grabbed most.
  async sweep() {
    const due = (await pool.query('select * from club_rains where not done and until <= $1 limit 20', [Date.now()])).rows;
    for (const r of due) {
      const res = await this.world.personal(async ch => {
        const x = (await ch.q('update club_rains set done = true where id = $1 and not done returning left_amt', [r.id])).rows[0]; if (!x) return null;
        let left = Number(x.left_amt), back = 0; const b = (await ch.q('select owner_id, name, type from buildings where id = $1', [r.building_id])).rows[0];
        if (r.to_id && left > 0) { back = Math.floor(left * BACK_SHARE); left -= back; const t = (await ch.q('select * from citizens where id = $1 for update', [r.to_id])).rows[0];
          if (t && back > 0) { ch.coins(t); t.coins_base = Number(t.coins_base) + back; ch.touch(t); await ch.saveCitizen(t); track(ch, 'club:sprayback', back, t.id); } } /* someone sprayed: part of what they missed is still theirs */
        if (left > 0) { if (b?.owner_id && b.owner_id !== r.from_id) { const o = (await ch.q('select * from citizens where id = $1 for update', [b.owner_id])).rows[0]; if (o) { ch.coins(o); o.coins_base = Number(o.coins_base) + left; ch.touch(o); await ch.saveCitizen(o); track(ch, 'club:swept', left, o.id); } }
          else treasuryAdd(ch, left); }
        const top = (await ch.q('select handle, got from club_grabs where rain_id = $1 order by got desc limit 3', [r.id])).rows.map(t => ({ h: t.handle, got: Number(t.got) }));
        return { left, back, top };
      });
      if (res) this.send(r.place, { kind: 'rainEnd', id: r.id, from: r.from_handle, ...(r.to_handle ? { to: r.to_handle, back: res.back } : {}), total: Number(r.total), left: res.left, top: res.top });
    }
    await pool.query('delete from club_rains where done and t < $1', [Date.now() - 7 * 86400000]).catch(() => {});
  }
}
