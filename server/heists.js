// Group crimes (heists). A player plans one, picks a time (5 to 60 minutes away) and invites a crew; the crew get a
// group chat (with an invite from the colony) to agree the details, and each picks a part (driver, hacker, safecracker,
// lookout, muscle). At the set time, or when the planner says "go now" with enough crew, the job goes live: everyone
// plays their part's mini game at the same time on their own phone (shared/minigames.js), within a couple of minutes.
// The crew's average play (0-60) plus the setting (0-40) decides how it goes, like a solo crime: a great job pays up to
// 1.5x the loot, a bad one gets the whole crew fined (twice the share, at least 1,000, from cash then savings, then into
// the minus) and, at worst, jailed. Anyone who botches their own part is caught even if the rest get away; anyone who
// doesn't play sits it out with nothing. Rules and numbers are in shared/rules.js (HEISTS).
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { BUILDING_TYPES, BANK_TYPES, typesOf, pgList } from '../shared/catalog.js';
import { treasuryAdd } from './races.js';
import { track, ledger } from './stats.js';
import { bump } from './achievements.js';
import * as MG from '../shared/minigames.js';

export const LIVE_MS = 150 * 1000; const LIVE_TXT = '2½ minutes'; // how long the crew has to play their parts once the job goes live
const BOTCHED = 12; // a part played this badly (out of 60) gets that member caught, whatever the rest do

const fmt = n => Math.round(n).toLocaleString('en-US');
const rand = () => crypto.randomInt(0, 1e9) / 1e9;
const nameOf = b => b?.name || BUILDING_TYPES[b?.type]?.name || 'town';
const HEIST_PARTS = kind => [...new Set(MG.HEIST_ROLES[kind] || [])];
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
      const j = (await near(typesOf('jail'), x, y)).rows[0]; return { x: j?.x ?? x, y: j?.y ?? y, label: `@${v.handle} (in jail)`, target: v.id, targetHandle: v.handle, building: j?.id }; }
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
      where (h.status in ('planning', 'live') and m.status in ('member', 'invited')) or (h.status not in ('planning', 'live') and h.at > $2 and m.status in ('member', 'left')) order by h.at desc limit 10`, [id, Date.now() - 6 * 3600 * 1000])).rows;
    const out = [];
    for (const h of mine) { const crew = (await pool.query(`select c.id, c.handle, m.status from group_members m join citizens c on c.id = m.citizen_id where m.group_id = $1 and m.status in ('member', 'invited') order by m.t`, [h.group_id])).rows;
      const members = crew.filter(x => x.status === 'member'), wants = h.roles || {}, parts = {};
      if (h.status === 'planning') MG.assignRoles(h.kind, members.map(m => wants[m.id] || null)).forEach((r, i) => { parts[members[i].handle] = { role: r, picked: !!wants[members[i].id] }; });
      out.push({ id: h.id, kind: h.kind, name: R.HEISTS[h.kind]?.name, icon: R.HEISTS[h.kind]?.icon, at: Number(h.at), status: h.status, target: h.target_label, planner: h.planner, mine: h.planner_id === id, me: h.mstatus,
        group: h.group_id, crew: members.map(x => x.handle), invited: crew.filter(x => x.status === 'invited').map(x => x.handle), result: h.result || null,
        roles: HEIST_PARTS(h.kind), parts, live: h.status === 'live' ? await this.liveView(h, id) : null }); }
    return { types, jailed, mine: out, waitFor: Math.max(0, Number(c.heist_at || 0) + R.HEIST_COOLDOWN - Date.now()), jailedFor: Math.max(0, Number(c.jailed_until || 0) - Date.now()), waits: R.HEIST_WAIT };
  }

  // ---------- planning ----------
  async plan(meP, { kind, target, inMinutes, members }) {
    const H = R.HEISTS[kind]; if (!H) throw new HttpError(400, 'Pick a group crime.');
    const c = (await pool.query('select * from citizens where id = $1', [meP.id])).rows[0];
    if (!c.home_id) throw new HttpError(400, 'Move into a home first.');
    const why = await this.acts.blockedReason(c); if (why) throw new HttpError(409, why);
    const wait = Number(c.heist_at || 0) + R.HEIST_COOLDOWN - Date.now(); if (wait > 0) throw new HttpError(429, `Lie low for ${Math.ceil(wait / 60000)} more minutes before planning another job.`);
    if ((await pool.query(`select 1 from heists h join group_members m on m.group_id = h.group_id where h.status in ('planning', 'live') and m.citizen_id = $1 and m.status = 'member'`, [c.id])).rowCount) throw new HttpError(409, "You're already in a crew that's planning a job.");
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
    await this.chat.system({ id: g.id }, `🕶️ @${c.handle} is planning: ${H.name} (${sc.label}). It goes down in ${mins} minutes. Crew needed: ${H.min} to ${H.max}. Join the chat to be in on it, and pick your part in the Crime tab. When it goes down, everyone plays their part live on their phone.`);
    return { ok: true, id, group: g.id, at, invited: g.invited };
  }
  async mineOr404(id, heistId) { const h = (await pool.query('select * from heists where id = $1', [String(heistId || '')])).rows[0]; if (!h) throw new HttpError(404, 'No such job.');
    if (h.planner_id !== id) throw new HttpError(403, 'Only the planner can do that.'); if (h.status !== 'planning') throw new HttpError(409, 'That job is over.'); return h; }
  async cancel(id, heistId) { const h = await this.mineOr404(id, heistId); await pool.query("update heists set status = 'cancelled' where id = $1", [h.id]);
    await this.chat.system({ id: h.group_id }, '❌ The planner called the job off.'); return { ok: true }; }
  async goNow(id, heistId) { const h = await this.mineOr404(id, heistId); return this.goLive(h.id, true); }

  // Pick your part for a job you're in (the crew sees who does what before it goes down).
  async role(id, heistId, { role }) {
    const h = (await pool.query('select * from heists where id = $1', [String(heistId || '')])).rows[0]; if (!h) throw new HttpError(404, 'No such job.');
    if (h.status !== 'planning') throw new HttpError(409, 'Too late: the job has started.');
    if (!(await pool.query("select 1 from group_members where group_id = $1 and citizen_id = $2 and status = 'member'", [h.group_id, id])).rowCount) throw new HttpError(403, 'Join the crew first.');
    if (role && !HEIST_PARTS(h.kind).includes(role)) throw new HttpError(400, 'That part isn’t needed on this job.');
    await pool.query("update heists set roles = coalesce(roles, '{}'::jsonb) || jsonb_build_object($2::text, $3::text) where id = $1", [h.id, id, role || null]);
    return { ok: true };
  }

  // ---------- the job itself: it goes live, everyone plays their part, then it's settled ----------
  async run(heistId, now = false) { return this.goLive(heistId, now); }
  async goLive(heistId, now = false) {
    const res = await this.world.change(async ch => {
      const h = (await ch.q("select * from heists where id = $1 and status = 'planning' for update", [heistId])).rows[0]; if (!h) return null;
      const H = R.HEISTS[h.kind];
      const rows = (await ch.q(`select c.* from group_members m join citizens c on c.id = m.citizen_id where m.group_id = $1 and m.status = 'member' order by m.t for update of c`, [h.group_id])).rows;
      const t = Date.now(), crew = [], out = [];
      for (const c of rows) { if (Number(c.jailed_until || 0) > t || !c.home_id || c.id === h.target_id) out.push(c.handle); else crew.push(c); }
      if (crew.length < H.min) { if (now) throw new HttpError(409, `You need a crew of ${H.min} who are free to go (you have ${crew.length}).`);
        await ch.q("update heists set status = 'cancelled', result = $2 where id = $1", [h.id, JSON.stringify({ why: 'crew', crew: crew.map(c => c.handle) })]);
        return { h, msg: `❌ Not enough crew turned up (${crew.length} of ${H.min} needed). The job is off.` }; }
      const planner = rows.find(c => c.id === h.planner_id) || crew[0], sc = await this.scene(h.kind, planner, h.target_id).catch(() => null);
      if (!sc) { await ch.q("update heists set status = 'cancelled', result = $2 where id = $1", [h.id, JSON.stringify({ why: 'target' })]); return { h, msg: '❌ The target is gone (no Mayor, or the inmate is out). The job is off.' }; }
      // the odds: police near the scene, night, a crime wave, the Mayor's pledge, plus the crew size
      const odds = await this.acts.odds(h.kind, await this.acts.policeDist(ch.db, sc.x, sc.y), await this.acts.waveNow()), chance = Math.min(0.92, odds.chance + R.HEIST_CREW_BONUS * (crew.length - H.min));
      const wants = h.roles || {}, parts = MG.assignRoles(h.kind, crew.map(c => wants[c.id] || null));
      const live = { chance, band: odds.band, night: !!odds.night, sc: { x: sc.x, y: sc.y, label: sc.label }, started: t, until: t + LIVE_MS, absent: out,
        crew: crew.map((c, i) => ({ id: c.id, h: c.handle, role: parts[i], seed: crypto.randomInt(1, 2 ** 31), diff: Math.min(5, MG.difficultyOf(parts[i], odds.band) + Math.min(4, Number(c.crime_streak || 0))) })) };
      await ch.q("update heists set status = 'live', live = $2 where id = $1", [h.id, JSON.stringify(live)]);
      for (const c of crew) await ch.q('update citizens set heist_at = $2 where id = $1', [c.id, t]); // the crew lies low from now
      for (const m of live.crew) await this.acts.notify(ch, m.id, 'crime', `🚨 Go time! ${H.icon} ${H.name}: the job is on. Open the Crime tab and play your part (${MG.ROLES[m.role].icon} ${MG.ROLES[m.role].name}) in the next ${LIVE_TXT}.`);
      return { h, live, msg: `🚨 GO TIME! ${H.icon} ${H.name} is on. Everyone, open the Crime tab and play your part now (you have ${LIVE_TXT}): ${live.crew.map(m => `@${m.h} ${MG.ROLES[m.role].icon} ${MG.ROLES[m.role].name}`).join(', ')}.${out.length ? ` (${out.map(x => '@' + x).join(', ')} can't take part.)` : ''}` };
    });
    if (res) await this.chat.system({ id: res.h.group_id }, res.msg).catch(() => {});
    return res ? { ok: !!res.live, live: !!res.live, until: res.live?.until, message: res.msg } : { ok: false };
  }
  // What a crew member sees while the job is live: who plays what, who's done, and the clock.
  async liveView(h, id) {
    const L0 = h.live || {}, runs = (await pool.query('select citizen_id, finished_at from crime_runs where heist_id = $1', [h.id])).rows, by = new Map(runs.map(r => [r.citizen_id, r]));
    const me = (L0.crew || []).find(m => m.id === id);
    return { until: Number(L0.until), chance: L0.chance, band: L0.band, night: L0.night, at: L0.sc?.label, myRole: me?.role || null, iPlayed: !!(me && by.get(id)?.finished_at), iStarted: !!(me && by.get(id)),
      crew: (L0.crew || []).map(m => ({ h: m.h, role: m.role, done: !!by.get(m.id)?.finished_at, playing: !!by.get(m.id) && !by.get(m.id).finished_at })) };
  }
  async status(id, heistId) {
    const h = (await pool.query('select * from heists where id = $1', [String(heistId || '')])).rows[0]; if (!h) throw new HttpError(404, 'No such job.');
    if (!(h.live?.crew || []).some(m => m.id === id)) throw new HttpError(403, "You're not on this job.");
    return { status: h.status, name: R.HEISTS[h.kind]?.name, icon: R.HEISTS[h.kind]?.icon, live: await this.liveView(h, id), result: h.status === 'done' ? h.result : null };
  }
  // Start your part: the game for your role, from the level the job dealt you. One go each.
  async play(id, heistId) {
    const h = (await pool.query('select * from heists where id = $1', [String(heistId || '')])).rows[0]; if (!h) throw new HttpError(404, 'No such job.');
    const m = (h.live?.crew || []).find(x => x.id === id); if (!m) throw new HttpError(403, "You're not on this job.");
    if (h.status !== 'live' || Date.now() > Number(h.live.until)) throw new HttpError(409, 'Too late: the job is over.');
    const old = (await pool.query('select * from crime_runs where heist_id = $1 and citizen_id = $2', [h.id, id])).rows[0];
    if (old?.finished_at) throw new HttpError(409, "You've played your part. Waiting for the crew.");
    const rid = old?.id || crypto.randomUUID();
    if (!old) await pool.query('insert into crime_runs (id, citizen_id, kind, seed, diff, practice, started_at, chance, band, night, loot, scene, heist_id) values ($1,$2,$3,$4,$5,false,$6,$7,$8,$9,0,$10,$11) on conflict do nothing',
      [rid, id, m.role, m.seed, m.diff, Date.now(), h.live.chance, h.live.band, !!h.live.night, JSON.stringify({ heist: h.id }), h.id]);
    return { id: rid, kind: m.role, seed: m.seed, diff: m.diff, practice: false, chance: h.live.chance, band: h.live.band, night: h.live.night, at: h.live.sc?.label, heist: h.id, until: Number(h.live.until) };
  }
  // Settle the job once everyone has played (or the time is up): the crew's average play plus the setting.
  async settle(heistId, force = false) {
    const res = await this.world.change(async ch => {
      const h = (await ch.q("select * from heists where id = $1 and status = 'live' for update", [heistId])).rows[0]; if (!h) return null;
      const H = R.HEISTS[h.kind], L0 = h.live, t = Date.now();
      const runs = new Map((await ch.q('select * from crime_runs where heist_id = $1', [h.id])).rows.map(r => [r.citizen_id, r]));
      const allDone = L0.crew.every(m => runs.get(m.id)?.finished_at);
      if (!allDone && !force && t < Number(L0.until)) return null;
      const parts = L0.crew.map(m => { const r = runs.get(m.id), sc = r?.finished_at && r.result ? r.result.score : null; return { ...m, play: sc ? sc.play : 0, played: !!sc, invalid: !!r?.result?.game?.invalid }; });
      const setting = MG.scoreOf(0, L0.chance).setting, play = Math.round(parts.reduce((a, p) => a + p.play, 0) / parts.length), total = play + setting, out = MG.outcomeOf(total, true);
      const rows = new Map((await ch.q('select * from citizens where id = any($1) for update', [parts.map(p => p.id)])).rows.map(c => [c.id, c]));
      // the takings on offer
      let base, mayor = null;
      if (h.kind === 'mayor') { mayor = (await ch.q('select * from citizens where id = $1 for update', [h.target_id])).rows[0]; if (mayor) { ch.coins(mayor); base = Math.max(0, Math.floor(mayor.coins_base * (H.lootShare[0] + rand() * (H.lootShare[1] - H.lootShare[0])))); if (mayor.coins_base < H.lootMin) base = Math.max(0, mayor.coins_base); } else base = 0; }
      else base = Math.floor(H.loot[0] + rand() * (H.loot[1] - H.loot[0] + 1));
      const share0 = Math.floor((base || (H.loot ? (H.loot[0] + H.loot[1]) / 2 : 5000)) / parts.length);
      const crewCaught = out.key === 'fined' || out.key === 'jailed', jailToo = out.key === 'jailed';
      const jail = (await ch.q(`select * from buildings where type = any('${pgList('jail')}') and done and not ruin order by (x - $1::int) * (x - $1::int) + (y - $2::int) * (y - $2::int), id limit 1`, [L0.sc.x, L0.sc.y])).rows[0];
      const got = [], caught = [], sat = [];
      for (const p of parts) { const c = rows.get(p.id); if (!c) continue; ch.coins(c);
        if (!p.played) { p.status = 'noshow'; sat.push(c); continue; }
        if (crewCaught || p.play < BOTCHED) { const fine = Math.max(1000, share0 * 2); await ch.takeFrom(c, fine); treasuryAdd(ch, fine); track(ch, 'heist:fine', fine, c.id); ch.touch(c); await ch.saveCitizen(c);
          const jailed = !!jail && (jailToo || (crewCaught ? false : p.play < BOTCHED / 2));
          if (jailed) { const until = t + H.jail * 60000; await ch.q('update citizens set jailed_until = $2 where id = $1', [c.id, until]); await this.acts.setVisit(ch, c, jail, until); await bump(ch, c.id, { jailed: 1 }); }
          p.status = 'caught'; p.fine = fine; p.jailed = jailed; caught.push({ c, fine, jailed }); }
        else { p.status = 'got'; got.push(c); } }
      // the money: the takings times the outcome (up to 1.5x), shared by everyone who got away
      let loot = 0; if (out.mult > 0 && got.length) { const cap = mayor ? mayor.coins_base : Math.floor(R.treasuryOn(ch.meta, ch.today)); loot = Math.max(0, Math.min(cap, Math.round(base * out.mult))); }
      const each = got.length ? Math.floor(loot / got.length) : 0, paid = each * got.length, win = paid > 0;
      for (const c of got) { if (each) { c.coins_base += each; track(ch, 'heist:loot', each, c.id); } ch.touch(c); await ch.saveCitizen(c); await bump(ch, c.id, { crimes: 1, heists: win ? 1 : 0 });
        // it came off: lie low just a moment, but the next job will be harder
        if (win) await ch.q('update citizens set heist_at = $2, crime_streak = crime_streak + 1 where id = $1', [c.id, t - R.HEIST_COOLDOWN + 20000]); }
      for (const x of caught) await ch.q('update citizens set crime_streak = 0 where id = $1', [x.c.id]);
      for (const p of parts) if (p.status === 'got') p.each = each;
      if (win) { if (mayor) { mayor.coins_base -= paid; ledger(ch, mayor.id, -paid, 'crime:victim', 'Robbed by a crew'); ch.touch(mayor); await ch.saveCitizen(mayor);
          await this.acts.notify(ch, mayor.id, 'pickpocket', `👑 A crew robbed you of ${fmt(paid)} coins! ${caught.length ? `The police caught ${caught.map(x => '@' + x.c.handle).join(', ')}.` : 'They all got away.'}`); }
        else treasuryAdd(ch, -paid); }
      if (h.kind === 'jailbreak') { if (out.mult > 0 && got.length) { await ch.q('update citizens set jailed_until = 0 where id = $1', [h.target_id]); const v = (await ch.q('select * from citizens where id = $1 for update', [h.target_id])).rows[0]; if (v) await this.acts.setVisit(ch, v, null);
          await this.acts.notify(ch, h.target_id, 'crime', '🔓 A crew broke you out of jail! You\'re free.'); }
        else if (crewCaught) { await ch.q('update citizens set jailed_until = greatest(jailed_until, $2) + 600000 where id = $1', [h.target_id, t]); await this.acts.notify(ch, h.target_id, 'crime', '🔒 A crew tried to break you out, but it went wrong. 10 more minutes inside.'); } }
      for (const { c, fine, jailed } of caught) await this.acts.notify(ch, c.id, 'crime', `🚓 You were caught on the job (${H.name}): fined ${fmt(fine)} coins${jailed ? ` and jailed for ${H.jail} minutes` : ''}.`);
      for (const c of got) await this.acts.notify(ch, c.id, 'crime', win ? `🕶️ The job came off (${H.name}). Your share: ${fmt(each)} coins.` : `🕶️ The job (${H.name}) came to nothing, but you got away.`);
      const names = a => a.map(c => '@' + c.handle).join(', ');
      const result = { win, outcome: out.key, title: out.title, mult: out.mult, score: { play, setting, total }, chance: L0.chance, loot: paid, each,
        parts: parts.map(p => ({ h: p.h, role: p.role, play: p.play, status: p.status, fine: p.fine || 0, jailed: !!p.jailed, each: p.each || 0, invalid: p.invalid })),
        got: got.map(c => c.handle), caught: caught.map(x => ({ h: x.c.handle, fine: x.fine, jailed: x.jailed })), jail: caught.some(x => x.jailed) ? H.jail : 0, absent: [...(L0.absent || []), ...sat.map(c => c.handle)] };
      await ch.q("update heists set status = 'done', result = $2 where id = $1", [h.id, JSON.stringify(result)]);
      await ch.event(win ? `${H.icon} ${H.name}: a crew of ${parts.length} hit ${L0.sc.label} and got away with ${fmt(paid)} coins!${caught.length ? ` Police caught ${names(caught.map(x => x.c))}.` : ''}`
        : crewCaught ? `🚓 ${H.name} foiled! Police caught ${names(caught.map(x => x.c))}.` : `${H.icon} ${H.name}: a crew tried it and came away with nothing.`, 'crime');
      const line = p => `@${p.h} ${MG.ROLES[p.role].icon} ${p.played ? `${p.play}/60` : 'didn’t show'}`;
      const msg = `${win ? `${H.icon} It came off! ${out.title}.` : crewCaught ? '🚓 It went wrong.' : '🫥 Everyone got away, but with nothing.'} Crew score ${total} (play ${play} + setting ${setting}). ${parts.map(line).join(', ')}.`
        + (win ? ` ${names(got)} got ${fmt(each)} coins each.` : '') + (caught.length ? ` Caught: ${caught.map(x => `@${x.c.handle} (fined ${fmt(x.fine)}${x.jailed ? `, jailed ${H.jail} min` : ''})`).join(', ')}.` : '');
      return { h, msg, result };
    });
    if (res) await this.chat.system({ id: res.h.group_id }, res.msg).catch(() => {});
    return res ? { ok: true, ...res.result, message: res.msg } : null;
  }
  async sweep() {
    for (const r of (await pool.query("select id from heists where status = 'planning' and at <= $1 limit 10", [Date.now()])).rows) await this.goLive(r.id).catch(e => console.error('heist:', e.message));
    for (const r of (await pool.query("select id from heists where status = 'live' and (live->>'until')::bigint <= $1 limit 10", [Date.now()])).rows) await this.settle(r.id, true).catch(e => console.error('heist settle:', e.message));
  }
}
