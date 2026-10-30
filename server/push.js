// Phone notifications (Web Push): a colonist turns them on in a browser or on their phone, and the colony can then
// tell them about things that happen while the game is closed (a picked pocket, a gift, a message, a win).
// The keys that identify the colony to the push services come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY if set,
// otherwise they're made once and kept in the database, so it works with no setup.
import webpush from 'web-push';
import { pool } from './db.js';
import { HttpError } from './world.js';

export const PUSH_KINDS = {
  crime: 'Pickpockets and thieves', gift: 'Gifts', bills: 'Weekly bills', chat: 'Chat messages', win: 'Race, lottery and casino wins', guide: 'Daily reward reminders',
};
const DEFAULT_PREFS = Object.fromEntries(Object.keys(PUSH_KINDS).map(k => [k, true]));

export class Push {
  constructor() { this.readyP = null; this.publicKey = null; this.sent = 0; this.log = []; }
  get ready() { return this.readyP || (this.readyP = this.init().catch(e => { this.readyP = null; throw e; })); } // set up on first use (after migrations)
  async init() {
    let pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) {
      const row = (await pool.query("select value from settings where key = 'vapid'")).rows[0];
      if (row) ({ publicKey: pub, privateKey: priv } = row.value);
      else { const k = webpush.generateVAPIDKeys(); pub = k.publicKey; priv = k.privateKey;
        await pool.query("insert into settings (key, value) values ('vapid', $1) on conflict (key) do nothing", [JSON.stringify(k)]);
        const again = (await pool.query("select value from settings where key = 'vapid'")).rows[0].value; pub = again.publicKey; priv = again.privateKey; } // another server may have won the race
    }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hello@playresurgence.com', pub, priv);
    this.publicKey = pub;
  }
  async key() { await this.ready; return { key: this.publicKey, kinds: PUSH_KINDS }; }
  async subscribe(citizenId, sub, prefs) {
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new HttpError(400, "That browser didn't give a usable subscription.");
    await pool.query(`insert into push_subs (endpoint, citizen_id, keys, prefs, created) values ($1, $2, $3, $4, $5)
      on conflict (endpoint) do update set citizen_id = $2, keys = $3, prefs = coalesce($4, push_subs.prefs), fails = 0`,
      [sub.endpoint.slice(0, 1000), citizenId, JSON.stringify({ p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }), prefs ? JSON.stringify(this.clean(prefs)) : null, Date.now()]);
    return this.status(citizenId);
  }
  clean(prefs) { const out = {}; for (const k of Object.keys(PUSH_KINDS)) out[k] = prefs[k] !== false; return out; }
  async unsubscribe(citizenId, endpoint) {
    if (endpoint) await pool.query('delete from push_subs where citizen_id = $1 and endpoint = $2', [citizenId, String(endpoint)]);
    else await pool.query('delete from push_subs where citizen_id = $1', [citizenId]);
    return this.status(citizenId);
  }
  async setPrefs(citizenId, prefs) { await pool.query('update push_subs set prefs = $2 where citizen_id = $1', [citizenId, JSON.stringify(this.clean(prefs || {}))]); return this.status(citizenId); }
  async status(citizenId) {
    const rows = (await pool.query('select endpoint, prefs from push_subs where citizen_id = $1', [citizenId])).rows;
    return { devices: rows.length, endpoints: rows.map(r => r.endpoint), prefs: { ...DEFAULT_PREFS, ...(rows[0]?.prefs || {}) }, kinds: PUSH_KINDS };
  }
  // Once a day (18:00 UTC, 7pm in Lagos): anyone with a streak going who hasn't collected today's reward gets a nudge.
  async dailyReminder(now = Date.now()) {
    const day = Math.floor(now / 86400000); if (new Date(now).getUTCHours() !== 18) return 0;
    const done = (await pool.query("select value from settings where key = 'daily_push'")).rows[0]; if (done && Number(done.value) >= day) return 0;
    await pool.query("insert into settings (key, value) values ('daily_push', $1) on conflict (key) do update set value = $1", [JSON.stringify(day)]);
    const rows = (await pool.query(`select distinct c.id, c.daily_streak from citizens c join push_subs p on p.citizen_id = c.id
      where c.daily_day = $1 and c.daily_streak > 0`, [day - 1])).rows;
    for (const r of rows) await this.send([r.id], { kind: 'guide', title: `🔥 Keep your ${r.daily_streak}-day streak`, body: "Today's reward is waiting. Collect it before midnight UTC.", tag: 'daily' });
    return rows.length;
  }
  // Send to every phone/browser these colonists turned notifications on in (skipping kinds they switched off).
  // msg: { kind, title, body, url, tag }
  async send(ids, msg) {
    ids = [...new Set([].concat(ids).filter(Boolean))]; if (!ids.length) return 0;
    this.log.push({ t: Date.now(), ids, kind: msg.kind, title: msg.title, body: msg.body }); if (this.log.length > 50) this.log.shift(); // the latest few, for the tests
    await this.ready;
    const subs = (await pool.query('select * from push_subs where citizen_id = any($1)', [ids])).rows;
    const payload = JSON.stringify({ title: msg.title || 'Resurgence', body: msg.body || '', url: msg.url || '/', tag: msg.tag || msg.kind || 'resurgence', kind: msg.kind || '' });
    let n = 0;
    await Promise.all(subs.map(async s => {
      const prefs = { ...DEFAULT_PREFS, ...(s.prefs || {}) }; if (msg.kind && prefs[msg.kind] === false) return;
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 6 * 3600, urgency: msg.urgency || 'normal' }); n++; this.sent++;
        if (s.fails) await pool.query('update push_subs set fails = 0 where endpoint = $1', [s.endpoint]); }
      catch (e) { // gone (uninstalled, permission removed): forget it; anything else: give up after a few tries
        if (e.statusCode === 404 || e.statusCode === 410) await pool.query('delete from push_subs where endpoint = $1', [s.endpoint]);
        else await pool.query('update push_subs set fails = fails + 1 where endpoint = $1', [s.endpoint]).then(() => pool.query('delete from push_subs where endpoint = $1 and fails >= 5', [s.endpoint])); }
    }));
    return n;
  }
}
