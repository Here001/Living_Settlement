// The 24/7 live stream. A small cloud server (streamer/ in this repo) opens the stream page (/?stream=1, or
// /?stream=1&portrait=1 for phone-shaped platforms) in a browser and sends it to every switched-on destination.
//
// The developer manages destinations (YouTube, Twitch, Facebook, Instagram, TikTok or any RTMP address) in the
// Stream tab. Stream keys are kept in the settings table (never in the colony's public data) and only given to:
//   - the developer (builder token), and
//   - the streamer, which signs in with its own STREAM_TOKEN (so the cloud server never holds the builder token).
// The streamer checks in every 30 s and reports how each pipeline is doing; the Stream tab shows that.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import { STATIONS } from '../shared/radio.js';

export const PLATFORMS = {
  youtube: { name: 'YouTube Live', url: 'rtmp://a.rtmp.youtube.com/live2', layout: 'landscape', maxHours: 0, note: 'YouTube Studio → Go live → Stream: copy the stream key (turn on "Auto-start"). Runs 24/7.' },
  twitch: { name: 'Twitch', url: 'rtmp://live.twitch.tv/app', layout: 'landscape', maxHours: 0, note: 'Twitch dashboard → Settings → Stream: copy the primary stream key. Runs 24/7.' },
  facebook: { name: 'Facebook Live', url: 'rtmps://live-api-s.facebook.com:443/rtmp', layout: 'landscape', maxHours: 8, note: 'Facebook Live Producer → Streaming software → "Use a persistent stream key". Facebook ends a live after 8 hours; the streamer reconnects and a new live starts.' },
  instagram: { name: 'Instagram Live', url: 'rtmps://edgetee-upload-dfw.xx.fbcdn.net:443/rtmp', layout: 'portrait', maxHours: 4, note: 'Instagram on a computer → Create → Live video: copy the stream URL and key. The key works for one live only, and Instagram ends a live after 4 hours: paste a new key each time you go live.' },
  tiktok: { name: 'TikTok Live', url: '', layout: 'portrait', maxHours: 0, note: 'TikTok LIVE Studio or "LIVE with streaming software" (needs LIVE access): copy the server URL and key. TikTok gives a new key for each live: paste it each time.' },
  custom: { name: 'Other (RTMP)', url: '', layout: 'landscape', maxHours: 0, note: 'Any RTMP or RTMPS server address and key.' },
};
const DEFAULT = { destinations: [], cta: 'Comment SPAWN on our Instagram, or join at playresurgence.com', fps: 30, quality: '720p', radio: 'rotate' };
const status = { at: 0, pipelines: [], host: null, version: null };
// stream pages that are open right now (in OBS, the cloud streamer, or a browser), so the developer can see OBS is working
const pages = new Map();

export async function getConfig() { const r = (await pool.query("select value from settings where key = 'stream'")).rows[0]; return { ...DEFAULT, ...(r ? r.value : {}) }; }
async function saveConfig(v) { await pool.query("insert into settings (key, value) values ('stream', $1) on conflict (key) do update set value = $1", [v]); }
const clean = s => String(s ?? '').trim().slice(0, 400);
function cleanDest(d) {
  const p = PLATFORMS[d.platform] ? d.platform : 'custom', url = clean(d.url) || PLATFORMS[p].url;
  if (url && !/^rtmps?:\/\//i.test(url)) throw new HttpError(400, 'A stream address starts with rtmp:// or rtmps://.');
  return { id: clean(d.id) || crypto.randomUUID().slice(0, 8), platform: p, name: clean(d.name).slice(0, 40) || PLATFORMS[p].name, url, key: clean(d.key),
    enabled: !!d.enabled, layout: d.layout === 'portrait' || d.layout === 'landscape' ? d.layout : PLATFORMS[p].layout, maxHours: Math.max(0, Math.min(48, Number(d.maxHours ?? PLATFORMS[p].maxHours) || 0)),
    keyAt: Number(d.keyAt) || Date.now() };
}
// What the developer sees: keys are shown masked unless they ask to see them.
const mask = k => (k ? (k.length <= 6 ? '••••' : k.slice(0, 3) + '••••' + k.slice(-3)) : '');

// The director: the stream's camera picks its own shots (auto), or the developer picks one and holds it (manual).
// A shot is { type: 'person', handle } | { type: 'building', id } | { type: 'race' } | { type: 'overview' } | { type: 'calm' } | { type: 'view', x, y, z }.
// Changes reach the stream page at once through the live connection; n changes on every pick so the page knows it's new.
const SHOTS = new Set(['person', 'building', 'race', 'overview', 'calm', 'view']);
export async function getDirector() { const r = (await pool.query("select value from settings where key = 'stream:director'")).rows[0]; return r ? r.value : { mode: 'auto', n: 0 }; }
function cleanShot(x) { if (!x || !SHOTS.has(x.type)) throw new HttpError(400, 'Pick a shot.'); const o = { type: x.type };
  if (x.type === 'person') { o.handle = clean(x.handle).replace(/^@/, '').slice(0, 40); if (!/^[\w.]+$/.test(o.handle)) throw new HttpError(400, 'Type a username.'); }
  if (x.type === 'building') { o.id = clean(x.id).slice(0, 60); if (!o.id) throw new HttpError(400, 'Pick a place.'); }
  if (x.type === 'view') for (const k of ['x', 'y', 'z']) { o[k] = Number(x[k]); if (!Number.isFinite(o[k])) throw new HttpError(400, 'Bad view.'); }
  if (x.label) o.label = clean(x.label).slice(0, 60); return o; }

export function streamRoutes(app, { admin, send, limit, bus }) {
  const streamer = (req, res, next) => { const t = (req.get('authorization') || '').replace(/^Bearer\s+/i, ''), want = process.env.STREAM_TOKEN;
    if (want && t && t.length === want.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(want))) return next();
    if (admin.check(req)) return next(); return res.status(401).json({ error: 'Stream token required.' }); };
  // the stream page: the call to action and the radio choice (no keys)
  app.get('/api/stream/public', limit, send(async () => { const c = await getConfig(); return { cta: c.cta, radio: c.radio, director: await getDirector() }; }));
  // a stream page checks in every 30 s: what it is (OBS, the cloud streamer, a browser), its size, the station and whether sound is running
  app.post('/api/stream/ping', limit, send(async req => { const b = req.body || {}, id = clean(b.id).slice(0, 24); if (!/^[\w-]{6,24}$/.test(id)) throw new HttpError(400, 'Bad page.');
    pages.set(id, { kind: ['obs', 'streamer', 'browser'].includes(b.kind) ? b.kind : 'browser', w: Math.min(8000, Number(b.w) || 0), h: Math.min(8000, Number(b.h) || 0), station: STATIONS[b.station] ? b.station : null, audio: clean(b.audio).slice(0, 12), at: Date.now() });
    for (const [k, v] of pages) if (Date.now() - v.at > 120000 || pages.size > 60) pages.delete(k); return { ok: true }; }));
  // the developer
  app.get('/api/admin/stream', admin, send(async req => { const c = await getConfig(), show = req.query.keys === '1';
    return { ...c, destinations: c.destinations.map(d => ({ ...d, key: show ? d.key : mask(d.key), hasKey: !!d.key })), platforms: PLATFORMS, status, director: await getDirector(), tokenSet: !!process.env.STREAM_TOKEN, pages: [...pages.values()].filter(p => Date.now() - p.at < 90000) }; }));
  app.put('/api/admin/stream', admin, send(async req => {
    const b = req.body || {}, cur = await getConfig(), out = { ...cur };
    if (b.cta != null) out.cta = clean(b.cta).slice(0, 140);
    if (b.quality === '720p' || b.quality === '1080p') out.quality = b.quality;
    if (b.radio === 'off' || b.radio === 'rotate' || STATIONS[b.radio]) out.radio = b.radio; // the stream's sound: one station, a new one each hour, or none
    if (Array.isArray(b.destinations)) out.destinations = b.destinations.slice(0, 8).map(d => { const old = cur.destinations.find(x => x.id === d.id);
      // a masked key coming back unchanged keeps the saved one; a new key restarts its session clock
      const key = d.key == null || (old && d.key === mask(old.key)) ? old?.key || '' : d.key; return cleanDest({ ...d, key, keyAt: old && old.key === key ? old.keyAt : Date.now() }); });
    await saveConfig(out); return { ok: true };
  }));
  // the developer steers the camera: { mode: 'manual', shot, holdMin } puts a shot on air (holdMin 0 = until released),
  // { mode: 'auto' } hands it back, { next: true } skips to the next automatic shot
  app.put('/api/admin/stream/director', admin, send(async req => { const b = req.body || {}, cur = await getDirector(), n = (cur.n || 0) + 1; let d;
    if (b.next) d = { ...cur, mode: 'auto', shot: null, until: null, skip: n, n };
    else if (b.mode === 'manual') { const hold = Math.max(0, Math.min(240, Number(b.holdMin) || 0)); d = { mode: 'manual', shot: cleanShot(b.shot), until: hold ? Date.now() + hold * 60000 : null, at: Date.now(), n }; }
    else d = { mode: 'auto', shot: null, until: null, n };
    await pool.query("insert into settings (key, value) values ('stream:director', $1) on conflict (key) do update set value = $1", [d]);
    bus?.publish([{ op: 'director', data: d }]); return d; }));
  // the streamer
  app.get('/api/stream/config', streamer, send(async () => { const c = await getConfig(); return { ...c, destinations: c.destinations.filter(d => d.enabled && d.url && d.key) }; }));
  app.post('/api/stream/status', streamer, send(async req => { const b = req.body || {};
    status.at = Date.now(); status.host = clean(b.host).slice(0, 60); status.version = clean(b.version).slice(0, 20);
    status.pipelines = (Array.isArray(b.pipelines) ? b.pipelines : []).slice(0, 4).map(p => ({ layout: p.layout === 'portrait' ? 'portrait' : 'landscape', up: !!p.up, since: Number(p.since) || 0,
      fps: Number(p.fps) || 0, restarts: Number(p.restarts) || 0, error: clean(p.error).slice(0, 200), dests: (Array.isArray(p.dests) ? p.dests : []).slice(0, 8).map(clean),
      onAir: clean(p.onAir).slice(0, 200), // what's on screen right now, and a small picture of it
      snap: typeof p.snap === 'string' && p.snap.length < 200000 && /^[A-Za-z0-9+/=]+$/.test(p.snap) ? p.snap : null }));
    return { ok: true }; }));
}
