// Voice chat inside a place (a home, a business, a club). The voice travels through Cloudflare Realtime (its SFU): each
// player's phone keeps one connection to it, sends its microphone up as one track, and receives the tracks of the people
// it may hear. Every call to Cloudflare goes through this server, which holds the app's token and decides who hears whom:
//   - everyone in the place hears a speaker, unless the speaker has picked who may hear them ("Talk to");
//   - someone either of you has blocked is never heard;
//   - changing who may hear you cuts off anyone who no longer may, there and then.
// Set CF_REALTIME_APP_ID and CF_REALTIME_APP_TOKEN (from the Cloudflare dashboard: Realtime → SFU → create an app).
// Without them voice is simply off. Who's talking where is kept in memory (one server).
import { HttpError } from './world.js';

const base = () => (process.env.CF_REALTIME_URL || 'https://rtc.live.cloudflare.com/v1').replace(/\/+$/, '') + '/apps/' + encodeURIComponent(process.env.CF_REALTIME_APP_ID || '');
export const voiceOn = () => !!(process.env.CF_REALTIME_APP_ID && process.env.CF_REALTIME_APP_TOKEN);
const PLACE = /^(b|h|c):[A-Za-z0-9_.-]{1,64}$/; /* c: a phone call (server/phone.js) */
const desc = d => (d && (d.type === 'offer' || d.type === 'answer') && typeof d.sdp === 'string' && d.sdp.length < 200000 ? { type: d.type, sdp: d.sdp } : null);

export class Voice {
  constructor(world) { this.world = world; this.places = new Map(); this.sessions = new Map(); this.pre = new Map(); this.handles = new Map(); }
  config() { return this.ice().then(ice => ({ on: voiceOn(), ice })); }
  // How phones reach the voice service. Direct (STUN) works for most; some mobile networks and office or school wifi block
  // it, and then the sound goes through Cloudflare's relay (TURN). Set CF_TURN_KEY_ID and CF_TURN_KEY_TOKEN (Cloudflare
  // dashboard: Realtime -> TURN Server -> create a key) and phones get short-lived relay logins (kept for 12 hours here).
  async ice() { const stun = [{ urls: 'stun:stun.cloudflare.com:3478' }], id = process.env.CF_TURN_KEY_ID, tok = process.env.CF_TURN_KEY_TOKEN; if (!id || !tok) return stun;
    if (this.turn && Date.now() < this.turn.until) return this.turn.ice;
    const turnBase = (process.env.CF_TURN_URL || 'https://rtc.live.cloudflare.com/v1').replace(/\/+$/, '') + '/turn/keys/' + encodeURIComponent(id) + '/credentials/';
    for (const path of ['generate-ice-servers', 'generate']) {
      try { const r = await fetch(turnBase + path, { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }), signal: AbortSignal.timeout(8000) });
        if (!r.ok) { console.error('turn:', path, r.status); continue; } const j = await r.json(), list = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : [];
        const relay = list.filter(x => x && x.urls && /turns?:/.test(JSON.stringify(x.urls))); if (!relay.length) continue;
        const ice = [...stun, ...relay]; this.turn = { ice, until: Date.now() + 12 * 3600e3 }; return ice; }
      catch (e) { console.error('turn:', e.message); } }
    this.turn = { ice: stun, until: Date.now() + 5 * 60e3 }; return stun; } /* (tried again in five minutes) */
  async cf(method, path, body) {
    if (!voiceOn()) throw new HttpError(503, 'Voice chat isn’t set up on this server yet.');
    let r; try { r = await fetch(base() + path, { method, headers: { authorization: 'Bearer ' + process.env.CF_REALTIME_APP_TOKEN, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) }); } /* (a new session: no body at all, as Cloudflare's own examples do) */
    catch (e) { throw new HttpError(502, 'The voice service can’t be reached right now.'); }
    const j = await r.json().catch(() => ({})); if (!r.ok || j.errorCode) { console.error('voice:', method, path.replace(/sessions\/[^/]+/, 'sessions/…'), r.status, j.errorCode || '', j.errorDescription || ''); this.last = { at: Date.now(), status: r.status, code: j.errorCode || null, why: j.errorDescription || null };
      throw new HttpError(502, r.status === 401 || r.status === 403 ? 'The voice service didn’t accept the app’s key.' : `The voice service said no (${j.errorDescription || r.status}). Try again in a moment.`); }
    return j;
  }
  room(place) { let m = this.places.get(place); if (!m) this.places.set(place, m = new Map()); return m; }
  here(place, id) { if (place.startsWith('c:')) return !!this.world.phone?.inCall(place.slice(2), id); /* on the call */ const e = this.world.rooms.here.get(place)?.get('p:' + id); return !!e && Date.now() - e.at < 70000; }
  check(me, place) { this.note(me); if (!PLACE.test(String(place || ''))) throw new HttpError(400, 'Which place?'); if (!this.here(place, me.id)) throw new HttpError(409, place.startsWith('c:') ? 'That call has ended.' : 'You need to be there to use voice.'); }
  mine(me, place, sessionId) { const s = this.sessions.get(me.id + '|' + place); if (!s || s.sessionId !== String(sessionId || '')) throw new HttpError(409, 'Start voice again.'); return s; }
  send(place, voice) { if (place.startsWith('c:')) { const to = this.world.phone?.ids(place.slice(2)); if (to) this.world.bus.publish([{ op: 'phone', private: true, to, data: { kind: 'voice', place, voice } }]); return; } /* a call: just the two of you */
    this.world.bus.publish([{ inside: true, place, k: 'voice', club: voice }]); }
  async blocked(a, b) { const s = await this.world.chat.blockState(a, b); return s.iBlocked || s.blockedMe; }
  may(sp, me) { return !sp.to || sp.to.has(String(me.handle).toLowerCase()); }

  // your connection to the voice service, in this place (hearing comes first: it doesn't need your microphone)
  // for the developer: is the voice service set up and answering? (makes a session and says what Cloudflare said)
  async diagnose() { const out = { on: voiceOn(), appId: (process.env.CF_REALTIME_APP_ID || '').slice(0, 6) + '…', url: base().replace(/apps\/.*/, 'apps/…') };
    if (!out.on) return { ...out, ok: false, why: 'CF_REALTIME_APP_ID or CF_REALTIME_APP_TOKEN is missing.' };
    const ice = await this.ice(), relay = ice.some(x => /turns?:/.test(JSON.stringify(x.urls))); out.relay = !process.env.CF_TURN_KEY_ID ? 'not set up (optional)' : relay ? 'working' : 'set up, but Cloudflare didn’t give relay logins';
    try { const j = await this.cf('POST', '/sessions/new'); return { ...out, ok: !!j.sessionId, why: (j.sessionId ? 'Cloudflare made a voice session: the keys work.' : 'Cloudflare answered without a session.') + ` Relay (TURN): ${out.relay}.` }; }
    catch (e) { return { ...out, ok: false, why: e.message, last: this.last || null }; } }
  async session(me, place) { this.check(me, place); const j = await this.cf('POST', '/sessions/new');
    this.sessions.set(me.id + '|' + place, { sessionId: j.sessionId, pulls: new Map() }); return { sessionId: j.sessionId }; }
  // your microphone goes up as a track; everyone who may hear you is told you're on
  async publish(me, place, b = {}) { this.check(me, place); const s = this.mine(me, place, b.sessionId), offer = desc(b.offer), mid = String(b.mid ?? ''); if (!offer || !mid) throw new HttpError(400, 'Bad voice offer.');
    const trackName = 'mic-' + me.id; const j = await this.cf('POST', `/sessions/${encodeURIComponent(s.sessionId)}/tracks/new`, { sessionDescription: offer, tracks: [{ location: 'local', mid, trackName }] });
    this.room(place).set(me.id, { id: me.id, h: me.handle, sessionId: s.sessionId, trackName, to: this.pre.get(me.id + '|' + place) || null, at: Date.now() });
    this.send(place, { kind: 'on', id: 'p:' + me.id, h: me.handle }); return { answer: j.sessionDescription }; }
  // who's talking here that you may hear
  async list(me, place) { this.check(me, place); const out = [];
    for (const sp of this.room(place).values()) if (sp.id !== me.id && this.may(sp, me) && !(await this.blocked(me.id, sp.id))) out.push({ id: 'p:' + sp.id, h: sp.h });
    return { speakers: out }; }
  // start hearing some of them: the service sends an offer back, which your phone answers (answer())
  async pull(me, place, b = {}) { this.check(me, place); const s = this.mine(me, place, b.sessionId), want = [], tracks = [];
    for (const raw of (Array.isArray(b.ids) ? b.ids : []).slice(0, 40)) { const id = String(raw).replace(/^p:/, ''), sp = this.room(place).get(id);
      if (!sp || sp.id === me.id || !this.may(sp, me) || (await this.blocked(me.id, sp.id))) continue; want.push(sp); tracks.push({ location: 'remote', sessionId: sp.sessionId, trackName: sp.trackName }); }
    if (!tracks.length) return { tracks: [] };
    const j = await this.cf('POST', `/sessions/${encodeURIComponent(s.sessionId)}/tracks/new`, { tracks });
    const got = (j.tracks || []).map(t => { const sp = want.find(w => w.trackName === t.trackName && w.sessionId === t.sessionId); if (sp && t.mid != null) s.pulls.set(String(t.mid), sp.id); return sp && t.mid != null ? { mid: String(t.mid), id: 'p:' + sp.id, h: sp.h } : null; }).filter(Boolean);
    return { tracks: got, offer: j.requiresImmediateRenegotiation ? j.sessionDescription : null }; }
  async answer(me, place, b = {}) { const s = this.mine(me, place, b.sessionId), ans = desc(b.answer); if (!ans) throw new HttpError(400, 'Bad voice answer.');
    await this.cf('PUT', `/sessions/${encodeURIComponent(s.sessionId)}/renegotiate`, { sessionDescription: ans }); return { ok: true }; }
  // who may hear you: everyone here (null), or just the people you pick. Anyone left out stops hearing you at once.
  async audience(me, place, to) { this.check(me, place); const sp = this.room(place).get(me.id);
    const set = Array.isArray(to) ? new Set(to.slice(0, 50).map(h => String(h).replace(/^@/, '').toLowerCase()).filter(Boolean)) : null;
    this.pre.set(me.id + '|' + place, set); if (sp) { sp.to = set; await this.cutOff(place, sp); } /* (kept for when you start talking, too) */
    this.send(place, { kind: 'audience', id: 'p:' + me.id, h: me.handle }); return { ok: true, to: set ? [...set] : null }; }
  async cutOff(place, sp) { /* close the tracks of listeners who may no longer hear this speaker */
    for (const [key, s] of this.sessions) { if (!key.endsWith('|' + place)) continue; const lid = key.split('|')[0]; if (lid === sp.id) continue;
      const mids = [...s.pulls].filter(([, id]) => id === sp.id).map(([mid]) => mid); if (!mids.length) continue;
      const lh = this.handles.get(lid); if (lh && this.may(sp, { handle: lh })) continue; /* (still allowed) */
      try { await this.cf('PUT', `/sessions/${encodeURIComponent(s.sessionId)}/tracks/close`, { tracks: mids.map(mid => ({ mid })), force: true }); } catch (e) {}
      for (const m of mids) s.pulls.delete(m); } }
  // you've stopped talking or left
  async leave(me, place) { this.drop(me.id, place); return { ok: true }; }
  drop(id, place) { const sp = this.places.get(place)?.get(id); this.sessions.delete(id + '|' + place); this.pre.delete(id + '|' + place);
    if (sp) { this.places.get(place).delete(id); this.send(place, { kind: 'off', id: 'p:' + id }); } }
  note(me) { this.handles.set(me.id, me.handle); if (this.handles.size > 20000) this.handles.clear(); }
}
