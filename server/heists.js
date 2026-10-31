// Group crimes (heists). A player plans one, picks a time (5 to 60 minutes away) and invites a crew; the crew get a
// group chat (with an invite from the colony) to agree the details. At the set time, or when the planner says
// "go now" with enough crew, it happens: one roll decides whether the job comes off, then each member is caught or not.
// Everyone who gets away shares the loot equally; anyone caught is fined (twice their share, at least 1,000, never
// more than they have) and jailed. Rules and numbers are in shared/rules.js (HEISTS).
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { BUILDING_TYPES, BANK_TYPES } from '../shared/catalog.js';
import { treasuryAdd } from './races.js';
import { track, ledger } from './stats.js';
import { bump } from './achievements.js';

const fmt = n => Math.round(n).toLocaleString('en-US');
const rand = () => crypto.randomInt(0, 1e9) / 1e9;
const nameOf = b => b?.name || BUILDING_TYPES[b?.type]?.name || 'town';
const near = (types, x, y) => pool.query(`select * from buildings where type = any($3) and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [x, y, types]);

export class Heists {
  constructor(world) { this.world = world; }
  get chat() { return this.world.chat; }
  get acts() { return this.world.actions; }

  // Where the job happens (for the police distance) and what it's against.
  async scene(kind, planner, targetId) {
    const home = planner.home_id ? (await pool.query('select x, y from buildings where id = $1', [planner.home_id])).rows[0] : null, x = home?.x ?? 0, y = home?.y ?? 0;
    if (kind === 'bank' || kind === 'armored') { const b = (await near(BANK_TYPES, x, y)).rows[0]; if (!b && kind === 'bank') throw new HttpError(409, "The colony doesn't have a Bank to rob.");
      return b ? { x: b.x, y: b.y, label: kind === 'bank' ? nameOf(b) : `the truck near ${nameOf(b)}`, building: b.id } : { x, y, label: 'the cash truck' }; }
    if (kind === 'mayor') { const m = await this.world.elections?.mayor(); if (!m) throw new HttpError(409, 'The colony has no Mayor right now.');
      const v = (await pool.query('select c.*, h.x hx, h.y hy from citizens c left join buildings h on h.id = c.home_id where c.id = $1', [m.id])).rows[0];
      const where = await this.acts.whereIs(pool, v), sc = await this.acts.sceneOf(pool, v, where); return { x: sc.x, y: sc.y, label: `Mayor @${v.handle}`, target: v.id, targetHandle: v.handle }; }
    if (kind === 'jailbreak') { const v = targetId && (await pool.query('select id, handle, jailed_until from citizens where id = $1 or lower(handle) = lower($1)', [String(targetId)])).rows[0];
      if (!v || Number(v.jailed_until || 0) <= Date.now()) throw new HttpError(409, 'Pick someone who is in jail right now.');
      const j = (await near(['jail'], x, y)).rows[0]; return { x: j?.x ?? x, y: j?.y ?? y, label: `@${v.handle} (in jail)`, target: v.id, targetHandle: v.handle, building: j?.id }; }
    throw new HttpError(400, 'Pick a group crime.');
  }

  // ---------- what the Crime tab shows ----------
  async info(id) {
    const c = (await pool.query('select id, handle, home_id, jailed_until, heist_at from citizens where id = $1', [id])).rows[0]; if (!c) throw new HttpError(404, 'No such citizen.');
    const wave = await this.acts.waveNow(), types = {};
    for (const [k, H] of Object.entries(R.HEISTS)) { try { const sc = await this.scene(k, c, null).catch(e => { if (k === 'jailbreak') return { x: 0, y: 0, label: 'an inmate' }; throw e; });
        types[k] = { ...H, at: sc.label, ...(await this.acts.odds(k, await this.acts.policeDist(pool, sc.x, sc.y), wave)) }; } catch (e) { types[k] = { ...H, unavailable: e.message }; } }
    const jailed = (await pool.query('select handle, jailed_until from citizens where jailed_until > $1 and pass_hash is not null and id <> $2 order by jailed_until desc limit 20', [Date.now(), id])).rows.map(r => ({ h: r.handle, until: Number(r.jailed_until) }));
    const mine = (await pool.query(`select h.*, m.status mstatus, p.handle planner from heists h join group_members m on m.group_id = h.group_id and m.citizen_id = $1 join citizens p on p.id = h.planner_id
      where (h.status = 'planning' and m.status in ('member', 'invited')) or (h.status <> 'planning' and h.at > $2 and m.status in ('member', 'left')) order by h.at desc limit 10`, [id, Date.now() - 6 * 3600 * 1000])).rows;
    const out = [];
    for (const h of mine) { const crew = (await pool.query(`select c.handle, m.status from group_members m join citizens c on c.id = m.citizen_id where m.group_id = $1 and m.status in ('member', 'invited')`, [h.group_id])).rows;
      out.push({ id: h.id, kind: h.kind, name: R.HEISTS[h.kind]?.name, icon: R.HEISTS[h.kind]?.icon, at: Number(h.at), status: h.status, target: h.target_label, planner: h.planner, mine: h.planner_id === id, me: h.mstatus,
        group: h.group_id, crew: crew.filter(x => x.status === 'member').map(x => x.handle), invited: crew.filter(x => x.status === 'invited').map(x => x.handle), result: h.result || null }); }
    return { types, jailed, mine: out, waitFor: Math.max(0, Number(c.heist_at || 0) + R.HEIST_COOLDOWN - Date.now()), jailedFor: Math.max(0, Number(c.jailed_until || 0) - Date.now()), waits: R.HEIST_WAIT };
  }

  // ---------- planning ----------
  async plan(meP, { kind, target, inMinutes, members }) {
    const H = R.HEISTS[kind]; if (!H) throw new HttpError(400, 'Pick a group crime.');
    const c = (await pool.query('select * from citizens where id = $1', [meP.id])).rows[0];
    if (!c.home_id) throw new HttpError(400, 'Move into a home first.');
    const why = await this.acts.blockedReason(c); if (why) throw new HttpError(409, why);
    const wait = Number(c.heist_at || 0) + R.HEIST_COOLDOWN - Date.now(); if (wait > 0) throw new HttpError(429, `Lie low for ${Math.ceil(wait / 60000)} more minutes before planning another job.`);
    if ((await pool.query(`select 1 from heists h join group_members m on m.group_id = h.group_id where h.status = 'planning' and m.citizen_id = $1 and m.status = 'member'`, [c.id])).rowCount) throw new HttpError(409, "You're already in a crew that's planning a job.");
    const mins = R.HEIST_WAIT.includes(Number(inMinutes)) ? Number(inMinutes) : 10;
    const list = [...new Set((Array.isArray(members) ? members : String(members || '').split(/[\s,]+/)).map(R.cleanHandle).filter(Boolean))].filter(h => h.toLowerCase() !== c.handle.toLowerCase());
    if (list.length < H.min - 1) throw new HttpError(400, `${H.name} needs a crew of at least ${H.min}: invite ${H.min - 1} or more.`);
    if (list.length > H.max - 1) throw new HttpError(400, `${H.name} takes at most ${H.max} people.`);
    const sc = await this.scene(kind, c, target);
    if (sc.target && list.some(h => h.toLowerCase() === sc.targetHandle.toLowerCase())) throw new HttpError(400, `@${sc.targetHandle} can't be in the crew.`);
    if (sc.target === c.id) throw new HttpError(400, "You can't do that to yourself.");
    const at = Date.now() + mins * 60000, gm = this.world.meta ? ((R.gameMinutes(at, this.world.meta.epoch) % 1440) + 1440) % 1440 : null, hhmm = gm == null ? null : `${String(Math.floor(gm / 60)).padStart(2, '0')}:${String(Math.floor(gm % 60)).padStart(2, '0')}`;
    const g = await this.chat.createGroup(meP, { name: `🕶️ ${H.name}${hhmm ? ' · ' + hhmm : ''}`, members: list });
    const id = crypto.randomUUID();
    await pool.query('insert into heists (id, kind, planner_id, group_id, target_id, target_label, building_id, at, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [id, kind, c.id, g.id, sc.target || null, sc.label, sc.building || null, at, 'planning', Date.now()]);
    await this.chat.system({ id: g.id }, `🕶️ @${c.handle} is planning: ${H.name} (${sc.label}). It goes down in ${mins} minutes. Crew needed: ${H.min} to ${H.max}. Join the chat to be in on it; whoever's in when the time comes takes part.`);
    return { ok: true, id, group: g.id, at, invited: g.invited };
  }
  async mineOr404(id, heistId) { const h = (await pool.query('select * from heists where id = $1', [String(heistId || '')])).rows[0]; if (!h) throw new HttpError(404, 'No such job.');
    if (h.planner_id !== id) throw new HttpError(403, 'Only the planner can do that.'); if (h.status !== 'planning') throw new HttpError(409, 'That job is over.'); return h; }
  async cancel(id, heistId) { const h = await this.mineOr404(id, heistId); await pool.query("update heists set status = 'cancelled' where id = $1", [h.id]);
    await this.chat.system({ id: h.group_id }, '❌ The planner called the job off.'); return { ok: true }; }
  async goNow(id, heistId) { const h = await this.mineOr404(id, heistId); return this.run(h.id, true); }

  // ---------- the job itself ----------
  async run(heistId, now = false) {
    const res = await this.world.change(async ch => {
      const h = (await ch.q("select * from heists where id = $1 and status = 'planning' for update", [heistId])).rows[0]; if (!h) return null;
      const H = R.HEISTS[h.kind];
      const rows = (await ch.q(`select c.* from group_members m join citizens c on c.id = m.citizen_id where m.group_id = $1 and m.status = 'member' order by m.t for update of c`, [h.group_id])).rows;
      const t = Date.now(), crew = [], out = [];
      for (const c of rows) { if (Number(c.jailed_until || 0) > t || !c.home_id || c.id === h.target_id) out.push(c.handle); else crew.push(c); }
      if (crew.length < H.min) { if (now) throw new HttpError(409, `You need a crew of ${H.min} who are free to go (you have ${crew.length}).`);
        await ch.q("update heists set status = 'cancelled', result = $2 where id = $1", [h.id, JSON.stringify({ why: 'crew', crew: crew.map(c => c.handle) })]);
        return { h, msg: `❌ Not enough crew turned up (${crew.length} of ${H.min} needed). The job is off.`, crew: [] }; }
      // the odds: police near the scene, night, a crime wave, the Mayor's pledge, plus the crew size
      const planner = rows.find(c => c.id === h.planner_id) || crew[0], sc = await this.scene(h.kind, planner, h.target_id).catch(() => null);
      if (!sc) { await ch.q("update heists set status = 'cancelled', result = $2 where id = $1", [h.id, JSON.stringify({ why: 'target' })]); return { h, msg: '❌ The target is gone (no Mayor, or the inmate is out). The job is off.', crew: [] }; }
      const odds = await this.acts.odds(h.kind, await this.acts.policeDist(ch.db, sc.x, sc.y), await this.acts.waveNow()), chance = Math.min(0.92, odds.chance + R.HEIST_CREW_BONUS * (crew.length - H.min));
      const win = rand() < chance;
      // the loot
      let loot = 0, mayor = null;
      if (win) {
        if (h.kind === 'mayor') { mayor = (await ch.q('select * from citizens where id = $1 for update', [h.target_id])).rows[0]; ch.coins(mayor);
          loot = Math.floor(mayor.coins_base * (H.lootShare[0] + rand() * (H.lootShare[1] - H.lootShare[0]))); if (mayor.coins_base < H.lootMin) loot = mayor.coins_base; }
        else loot = Math.max(0, Math.min(Math.floor(R.treasuryOn(ch.meta, ch.today)), Math.floor(H.loot[0] + rand() * (H.loot[1] - H.loot[0] + 1)))); }
      const share = crew.length ? Math.floor((win ? loot : (H.loot ? (H.loot[0] + H.loot[1]) / 2 : 5000)) / crew.length) : 0;
      const pCaught = Math.max(0.05, (win ? R.HEIST_CAUGHT.win : R.HEIST_CAUGHT.lose) - (odds.night ? 0.1 : 0));
      const got = [], caught = [], jail = (await ch.q(`select * from buildings where type = 'jail' and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [sc.x, sc.y])).rows[0];
      for (const c of crew) { ch.coins(c); await ch.q('update citizens set heist_at = $2 where id = $1', [c.id, t]);
        if (rand() < pCaught) { const fine = Math.min(c.coins_base, Math.max(1000, share * 2)); c.coins_base -= fine; treasuryAdd(ch, fine); track(ch, 'heist:fine', fine, c.id); ch.touch(c); await ch.saveCitizen(c);
          if (jail) { const until = t + H.jail * 60000; await ch.q('update citizens set jailed_until = $2 where id = $1', [c.id, until]); await this.acts.setVisit(ch, c, jail, until); await bump(ch, c.id, { jailed: 1 }); }
          caught.push({ c, fine }); }
        else got.push(c); }
      const each = win && got.length ? Math.floor(loot / got.length) : 0, paid = each * got.length;
      for (const c of got) { if (each) { c.coins_base += each; track(ch, 'heist:loot', each, c.id); } ch.touch(c); await ch.saveCitizen(c); await bump(ch, c.id, { crimes: 1, heists: win ? 1 : 0 }); }
      if (win) { if (mayor) { mayor.coins_base -= paid; ledger(ch, mayor.id, -paid, 'crime:victim', 'Robbed by a crew'); ch.touch(mayor); await ch.saveCitizen(mayor);
          await this.acts.notify(ch, mayor.id, 'pickpocket', `👑 A crew robbed you of ${fmt(paid)} coins! ${caught.length ? `The police caught ${caught.map(x => '@' + x.c.handle).join(', ')}.` : 'They all got away.'}`); }
        else if (paid) treasuryAdd(ch, -paid);
        if (h.kind === 'jailbreak') { await ch.q('update citizens set jailed_until = 0 where id = $1', [h.target_id]); const v = (await ch.q('select * from citizens where id = $1 for update', [h.target_id])).rows[0]; if (v) await this.acts.setVisit(ch, v, null);
          await this.acts.notify(ch, h.target_id, 'crime', `🔓 A crew broke you out of jail! You're free.`); } }
      else if (h.kind === 'jailbreak') { await ch.q('update citizens set jailed_until = greatest(jailed_until, $2) + 600000 where id = $1', [h.target_id, t]); await this.acts.notify(ch, h.target_id, 'crime', '🔒 A crew tried to break you out, but it went wrong. 10 more minutes inside.'); }
      for (const { c, fine } of caught) await this.acts.notify(ch, c.id, 'crime', `🚓 You were caught on the ${H.name.toLowerCase()} job: fined ${fmt(fine)} coins${jail ? ` and jailed for ${H.jail} minutes` : ''}.`);
      for (const c of got) await this.acts.notify(ch, c.id, 'crime', win ? `🕶️ The ${H.name.toLowerCase()} job came off. Your share: ${fmt(each)} coins.` : `🕶️ The ${H.name.toLowerCase()} job went wrong, but you got away.`);
      const names = a => a.map(c => '@' + c.handle).join(', ');
      const result = { win, chance, loot: paid, each, got: got.map(c => c.handle), caught: caught.map(x => ({ h: x.c.handle, fine: x.fine })), jail: jail ? H.jail : 0, absent: out };
      await ch.q("update heists set status = 'done', result = $2 where id = $1", [h.id, JSON.stringify(result)]);
      await ch.event(win ? `${H.icon} ${H.name}: a crew of ${crew.length} hit ${sc.label} and got away with ${fmt(paid)} coins!${caught.length ? ` Police caught ${names(caught.map(x => x.c))}.` : ''}`
        : `🚓 ${H.name} foiled! ${caught.length ? `Police caught ${names(caught.map(x => x.c))}.` : 'The crew scattered before the police arrived.'}`, 'crime');
      const msg = win ? `${H.icon} It came off! ${got.length ? `${names(got)} got away with ${fmt(each)} coins each.` : 'But everyone was caught: the loot went back.'}${caught.length ? ` Caught: ${caught.map(x => `@${x.c.handle} (fined ${fmt(x.fine)})`).join(', ')}${jail ? `, jailed for ${H.jail} minutes` : ''}.` : ''}`
        : `🚓 It went wrong.${caught.length ? ` Caught: ${caught.map(x => `@${x.c.handle} (fined ${fmt(x.fine)})`).join(', ')}${jail ? `, jailed for ${H.jail} minutes` : ''}.` : ''}${got.length ? ` ${names(got)} got away with nothing.` : ''}`;
      return { h, msg: msg + (out.length ? ` (${out.map(x => '@' + x).join(', ')} couldn't take part.)` : ''), result };
    });
    if (res) await this.chat.system({ id: res.h.group_id }, res.msg).catch(() => {});
    return res ? { ok: true, ...(res.result || {}), message: res.msg } : { ok: false };
  }
  async sweep() { for (const r of (await pool.query("select id from heists where status = 'planning' and at <= $1 limit 10", [Date.now()])).rows) await this.run(r.id).catch(e => console.error('heist:', e.message)); }
}
