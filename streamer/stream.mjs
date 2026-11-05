// The 24/7 streamer. Runs on a small cloud server (see README: "24/7 live stream").
//
// Every 30 s it asks the game which destinations are switched on (GET /api/stream/config, signed in with
// STREAM_TOKEN). For each shape in use (16:9 landscape, 9:16 portrait) it runs one pipeline:
//   a virtual screen (Xvfb) → Chromium showing GAME_URL/?stream=1 → ffmpeg, which films the screen, adds sound
//   (MUSIC_FILE on a loop, or silence) and sends one encoded stream to every destination of that shape at once.
// Anything that dies is restarted. A destination with a session limit (Facebook 8 h, Instagram 4 h) is
// reconnected just before it, and the page is reloaded every few hours to keep the browser fresh.
// It reports to the game every 30 s, so the developer's Stream tab shows what's live.
//
//   GAME_URL=https://playresurgence.com STREAM_TOKEN=… node stream.mjs
// Optional: MUSIC_FILE=/music/loop.mp3, RELOAD_HOURS=6, and TEST_OUTPUT=/tmp/test.flv (record to a file instead).
import { spawn } from 'node:child_process';
import os from 'node:os';
import { chromium } from 'playwright';

const GAME = (process.env.GAME_URL || 'https://playresurgence.com').replace(/\/+$/, '');
const TOKEN = process.env.STREAM_TOKEN || '';
const MUSIC = process.env.MUSIC_FILE || '';
const RELOAD_MS = Number(process.env.RELOAD_HOURS || 6) * 3600e3;
const TEST = process.env.TEST_OUTPUT || '';
const VERSION = '1.0';
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SIZES = { '720p': { landscape: [1280, 720], portrait: [720, 1280], kbps: 3000 }, '1080p': { landscape: [1920, 1080], portrait: [1080, 1920], kbps: 5500 } };

async function getConfig() {
  if (TEST) return { quality: '720p', destinations: [{ id: 'test', name: 'Test file', layout: process.env.TEST_LAYOUT || 'landscape', url: TEST, key: '', maxHours: 0 }] };
  const r = await fetch(GAME + '/api/stream/config', { headers: { authorization: 'Bearer ' + TOKEN } });
  if (!r.ok) throw new Error(`config: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.json();
}
const target = d => (d.key ? `${d.url.replace(/\/+$/, '')}/${d.key}` : d.url);

class Pipeline {
  constructor(layout, display) { this.layout = layout; this.display = display; this.dests = []; this.sig = ''; this.up = false; this.since = 0; this.restarts = 0; this.error = ''; this.fps = 0; }
  // Start (or restart) everything for this shape with these destinations.
  async start(dests, quality) {
    await this.stop(); this.dests = dests; this.quality = quality; const [w, h] = SIZES[quality][this.layout];
    this.sig = JSON.stringify([quality, dests.map(d => [d.id, d.url, d.key])]);
    this.xvfb = spawn('Xvfb', [`:${this.display}`, '-screen', '0', `${w}x${h}x24`, '-nolisten', 'tcp'], { stdio: 'ignore' });
    await sleep(800);
    // one kiosk window (no tabs, address bar or scrollbars), exactly the size of the virtual screen
    this.browser = await chromium.launchPersistentContext('', { headless: false, viewport: null, env: { ...process.env, DISPLAY: `:${this.display}` },
      ignoreDefaultArgs: ['--enable-automation'],
      args: [`--window-size=${w},${h}`, '--window-position=0,0', '--kiosk', '--no-first-run', '--disable-infobars', '--autoplay-policy=no-user-gesture-required', '--disable-features=Translate', '--hide-scrollbars', '--disable-session-crashed-bubble'] });
    this.page = this.browser.pages()[0] || await this.browser.newPage(); this.page.on('crash', () => { this.error = 'page crashed'; this.restartSoon(); });
    await this.page.goto(GAME + '/?stream=1', { waitUntil: 'domcontentloaded', timeout: 60000 }); this.loadedAt = Date.now();
    await sleep(6000); // let the map and the first shot load
    // film the screen, add sound, encode once, send to every destination
    const kbps = SIZES[quality].kbps, audio = MUSIC ? ['-stream_loop', '-1', '-re', '-i', MUSIC] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
    const outs = dests.map(d => `[f=flv:onfail=ignore]${target(d)}`).join('|');
    const args = ['-hide_banner', '-loglevel', 'warning', '-stats_period', '5', '-progress', 'pipe:2',
      '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30', '-video_size', `${w}x${h}`, '-i', `:${this.display}.0+0,0`, ...audio,
      '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60', '-keyint_min', '60',
      '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-shortest_buf_duration', '1',
      '-f', 'tee', outs];
    if (TEST) args.splice(args.indexOf('-f', args.indexOf('aac')), 3, '-t', String(Number(process.env.TEST_SECONDS || 15)), '-f', 'flv', TEST);
    this.ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.ff.stderr.on('data', b => { const s = String(b), m = /fps=\s*([\d.]+)/.exec(s); if (m) this.fps = Math.round(Number(m[1])); const e = s.split('\n').find(l => /error|failed|refused|denied/i.test(l)); if (e) this.error = e.trim().slice(0, 200); });
    this.ff.on('exit', code => { this.up = false; if (this.stopping) return; this.error = this.error || `encoder stopped (${code})`; log(this.layout, 'ffmpeg exited', code); if (TEST) { process.exit(code ? 1 : 0); } this.restartSoon(); });
    this.up = true; this.since = Date.now(); this.error = ''; log(this.layout, `live → ${dests.map(d => d.name).join(', ')} at ${w}x${h}`);
    // reconnect before a platform's session limit
    const cap = Math.min(...dests.map(d => d.maxHours || Infinity)); clearTimeout(this.capTimer);
    if (Number.isFinite(cap)) this.capTimer = setTimeout(() => { log(this.layout, 'session limit: reconnecting'); this.restartSoon(0); }, Math.max(10 * 60e3, cap * 3600e3 - 5 * 60e3));
  }
  restartSoon(wait) { if (this.pending) return; this.restarts++; const ms = wait ?? Math.min(60000, 3000 * this.restarts);
    this.pending = setTimeout(async () => { this.pending = null; try { await this.start(this.dests, this.quality); } catch (e) { this.error = e.message; log(this.layout, 'restart failed:', e.message); this.restartSoon(); } }, ms); }
  async stop() { this.stopping = true; clearTimeout(this.capTimer); try { this.ff?.kill('SIGINT'); } catch {} await sleep(this.ff ? 1500 : 0); try { this.ff?.kill('SIGKILL'); } catch {}
    try { await this.browser?.close(); } catch {} try { this.xvfb?.kill(); } catch {} this.ff = this.browser = this.xvfb = this.page = null; this.up = false; this.stopping = false; }
  // keep the page healthy: reload it every few hours (the encoder keeps running), and if it has stopped answering
  async check() { if (!this.page || this.pending) return; try {
      if (Date.now() - this.loadedAt > RELOAD_MS) { log(this.layout, 'reloading the page'); this.loadedAt = Date.now(); await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }); }
      else await this.page.evaluate('1', { timeout: 10000 }); } catch (e) { this.error = 'page not responding'; this.restartSoon(); } }
  report() { return { layout: this.layout, up: this.up, since: this.since, fps: this.fps, restarts: this.restarts, error: this.error, dests: this.dests.map(d => d.name) }; }
}

const pipes = { landscape: new Pipeline('landscape', 99), portrait: new Pipeline('portrait', 100) };
async function tick() {
  let cfg; try { cfg = await getConfig(); } catch (e) { log('could not reach the game:', e.message); return; }
  const quality = SIZES[cfg.quality] ? cfg.quality : '720p';
  for (const layout of ['landscape', 'portrait']) {
    const P = pipes[layout], dests = (cfg.destinations || []).filter(d => (d.layout || 'landscape') === layout), sig = JSON.stringify([quality, dests.map(d => [d.id, d.url, d.key])]);
    if (!dests.length) { if (P.dests.length || P.up) { log(layout, 'no destinations: stopping'); P.dests = []; P.sig = ''; await P.stop(); } continue; }
    if (sig !== P.sig && !P.pending) { try { await P.start(dests, quality); } catch (e) { P.error = e.message; log(layout, 'start failed:', e.message); P.restartSoon(); } }
    else await P.check();
  }
  if (!TEST) fetch(GAME + '/api/stream/status', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ host: os.hostname(), version: VERSION, pipelines: Object.values(pipes).filter(p => p.dests.length).map(p => p.report()) }) }).catch(() => {});
}
if (!TOKEN && !TEST) { console.error('Set STREAM_TOKEN (the same value as on the game server).'); process.exit(1); }
log(`streamer ${VERSION}: ${GAME}`); await tick(); setInterval(tick, 30000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { for (const p of Object.values(pipes)) await p.stop(); process.exit(0); });
