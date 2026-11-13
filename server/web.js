// The in-game browser's check: can this website be shown inside the game?
// Many sites forbid being shown inside another site or app (X-Frame-Options, or a Content-Security-Policy with
// frame-ancestors); inside the game they'd just appear blank. So before the game opens a business's website in its own
// browser it asks here, and if the site says no, the game offers to open it in a new tab instead.
// The server only ever fetches public web addresses: anything that resolves to a private, local or internal address is
// refused (so a player's link can't be used to reach machines behind the server), redirects are followed by hand and
// checked the same way, only the headers are read, and each answer is kept for an hour.
import dns from 'node:dns/promises';
import net from 'node:net';
import * as R from '../shared/rules.js';

const cache = new Map(); // url → { at, out }
const HOUR = 3600000, MAX_CACHE = 2000;

// private, loopback, link-local, carrier-grade NAT, multicast and other non-public ranges
function privateIp(ip) {
  if (net.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224; }
  const v = ip.toLowerCase(); if (v === '::' || v === '::1') return true;
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}
// 'public', 'private' (never fetched), or 'unknown' (the name didn't resolve just now)
async function hostKind(host) {
  if (net.isIP(host)) return privateIp(host) ? 'private' : 'public';
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) return 'private';
  try { const addrs = await dns.lookup(host, { all: true }); if (!addrs.length) return 'unknown'; return addrs.every(a => !privateIp(a.address)) ? 'public' : 'private'; } catch (e) { return 'unknown'; }
}
// Does a response's headers let `origin` show the page in a frame?
export function frameAllowed(headers, origin) {
  const xfo = String(headers.get('x-frame-options') || '').trim().toLowerCase();
  if (xfo === 'deny' || xfo === 'sameorigin' || xfo.startsWith('allow-from')) return false;
  const csp = String(headers.get('content-security-policy') || ''), m = csp.match(/(?:^|;)\s*frame-ancestors\s+([^;]*)/i);
  if (m) { const list = m[1].trim().split(/\s+/).map(s => s.toLowerCase());
    if (list.includes("'none'")) return false;
    const host = origin ? new URL(origin).host : '';
    const ok = list.some(s => s === '*' || s === 'https:' || (host && (s === origin.toLowerCase() || s === host || s === 'https://' + host || (s.startsWith('*.') && host.endsWith(s.slice(1))) || (s.startsWith('https://*.') && host.endsWith(s.slice(9))))));
    if (!ok) return false; }
  return true;
}
// { ok, url, frame, why }: `frame` true when the game can show it inside; false with a reason when it should open in a new tab.
export async function checkSite(raw, origin) {
  const url = R.cleanWebsite(raw); if (!url) return { ok: false, frame: false, why: 'That isn’t a web address.' };
  const hit = cache.get(url); if (hit && Date.now() - hit.at < HOUR) return hit.out;
  const done = out => { if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value); cache.set(url, { at: Date.now(), out }); return out; };
  if (!url.startsWith('https:')) return done({ ok: true, url, frame: false, why: 'This site isn’t secure (no https), so it can only open in a new tab.' });
  let at = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(at); if (u.protocol !== 'https:') return done({ ok: true, url, frame: false, why: 'This site isn’t secure (no https), so it can only open in a new tab.' });
    if (u.port && u.port !== '443') return done({ ok: true, url, frame: false, why: 'This site can only open in a new tab.' });
    const kind = await hostKind(u.hostname);
    if (kind === 'private') return done({ ok: false, url, frame: false, why: 'That address isn’t a public website.' });
    if (kind === 'unknown') return { ok: true, url, frame: false, why: 'The site couldn’t be reached just now. You can still try it in a new tab.' }; // not remembered: it may work in a moment
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 5000);
    let res; try { res = await fetch(at, { method: 'GET', redirect: 'manual', signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; ResurgenceGameBrowser/1.0)', accept: 'text/html' } }); }
    catch (e) { clearTimeout(timer); return done({ ok: true, url, frame: false, why: 'The site didn’t answer just now. You can still try it in a new tab.' }); }
    clearTimeout(timer); try { res.body?.cancel(); } catch (e) {} // only the headers matter
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { at = new URL(res.headers.get('location'), at).toString(); continue; }
    if (res.status >= 400) return done({ ok: true, url, frame: false, why: 'The site didn’t open just now. You can still try it in a new tab.' });
    return done(frameAllowed(res.headers, origin) ? { ok: true, url: at, frame: true } : { ok: true, url, frame: false, why: 'This site doesn’t let other apps show it inside them, so it opens in a new tab.' });
  }
  return done({ ok: true, url, frame: false, why: 'The site kept redirecting. You can still try it in a new tab.' });
}
