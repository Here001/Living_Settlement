// Colony radio: the DJs. Music is composed in the browser (public/music.js); this file writes and voices the talk.
//
// Every second song on each station opens with a DJ talk break, written fresh from what just happened in the colony:
// the Colony Log (races, heists, lottery wins, new arrivals, elections…), the Town Square and the mayor's race.
//   - With ANTHROPIC_API_KEY set, Claude writes each break in the DJ's own voice. It is shown the DJ's last breaks and
//     told not to reuse their jokes or lines; a break that still comes out too close to a recent one is rewritten.
//   - Without it, breaks are built from each DJ's phrase bank, never reusing a recent phrase.
//   - With FISH_API_KEY set, Fish Audio reads it aloud, in the voice picked for each DJ in the Stream tab (your own
//     voices and Nigerian voices from the Fish Audio library), or a Nigerian voice chosen automatically. When the
//     prepaid credit is nearly gone, breaks switch to text only.
//   - Or with ELEVENLABS_API_KEY set, ElevenLabs reads it aloud, in the voice picked for each DJ in the Stream tab (or one
//     chosen from your ElevenLabs voices). Before the account's monthly characters run out, breaks switch to text only,
//     so the radio never stops. (AZURE_SPEECH_KEY + AZURE_SPEECH_REGION also work, for Azure AI Speech.)
//     Without a voice the break still shows as on-air text.
// An event is only talked about once per station. Breaks are only made for stations someone is listening to (a player
// or the 24/7 stream), so nothing is spent when nobody is tuned in. The leader instance makes them; any instance serves them.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import express from 'express';
import { STATIONS, STATION_IDS, slotOf, slotStart, talkSlot, songTitle, timeline } from '../shared/radio.js';

const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const LISTEN_MS = 10 * 60000; // a station counts as listened to for 10 minutes after someone last tuned in
const LEAD_MS = 4 * 60000;    // breaks are written up to 4 minutes before they go on air
const PRIORITY = { race: 9, election: 9, disaster: 9, crime: 8, lottery: 8, champions: 8, cevent: 8, spawn: 7, casino: 7, gift: 6, find: 5, badge: 5, career: 5, property: 5,
  leave: 4, pet: 4, streak: 4, build: 4, demolish: 4, gig: 3, rename: 3, found: 3, day: 3, movein: 1 };
const clean = s => String(s ?? '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
// what the voice reads: "@tunde_web" → "Tunde web"
export const speakable = s => clean(s).replace(/@([\w.]+)/g, (_, h) => h.replace(/[._]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())).replace(/\bpts?\b/gi, 'points');
const words = s => clean(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
function similarity(a, b) { const g = s => { const w = words(s), out = new Set(); for (let i = 0; i + 2 < w.length; i++) out.add(w.slice(i, i + 3).join(' ')); return out; };
  const A = g(a), B = g(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / Math.min(A.size, B.size); }
const GREET = { 'late night': 'evening', morning: 'morning', afternoon: 'afternoon', evening: 'evening', night: 'evening' };
const YORUBA_POD = { 'late night': 'alẹ́', morning: 'àárọ̀', afternoon: 'ọ̀sán', evening: 'irọ̀lẹ́', night: 'alẹ́' };
const HAUSA_POD = { 'late night': 'dare', morning: 'safiya', afternoon: 'rana', evening: 'yamma', night: 'dare' };
const pick = a => a[Math.floor(Math.random() * a.length)];
const fmtClock = m => { m = ((Math.floor(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const partOfDay = m => { const h = (((m % 1440) + 1440) % 1440) / 60; return h < 5 ? 'late night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night'; };

// ---------- the phrase banks (used when there's no AI writer) ----------
// {dj} the DJ's name, {station} the station, {colony} the colony, {e} an event, {title} the next song, {time}, {weather}, {pop}
const BANK = {
  yoruba: { open: ['Ẹ kú àsìkò yìí, my people! {dj} on {station}.', 'Ẹ káàbọ̀ o! This is {dj}, keeping {colony} sweet on {station}.', 'Ó yá, {colony}! {dj} dey here with you on {station}.', 'Ẹ kú {pod}, everybody. Na {dj} on {station}.', 'My good people of {colony}, ẹ ṣé gan for staying with {dj}.'],
    news: ['Small gist from town: {e}. Ah, this colony no dey sleep!', 'Did you hear? {e}. Àṣẹ!', 'Fresh from the Colony Log: {e}. Ẹ ṣé o, life is sweet.', 'They told me say {e}. Ọlọ́run tóbi o!', 'Now this one: {e}. Ẹ gbọ́ ṣá!'],
    close: ['Now let me give you {title}. Ẹ jó o!', 'Dance with me: here is {title}.', 'Na {title} be this, turn it up!', 'Up next, {title}. Ó dàbọ̀ for now!'] },
  igbo: { open: ['Ndewo nu, {colony}! {dj} on {station}.', 'Kedu! It is {dj} on {station}, sit down let me tell you something.', 'Ndewo, my people. {dj} here on {station}.', 'Good {pod}, {colony}. {dj} on {station}, ọ dị mma?'],
    news: ['Listen to this one: {e}. As our people say, a child who washes his hands eats with elders.', 'So I hear {e}. Chineke!', 'News reach me: {e}. Ọ dị mma, the colony is moving!', 'Ehen, {e}. Nwanne, life is a market.', 'The Colony Log says {e}. Udo, my people.'],
    close: ['Let me play {title} for you. Daalụ!', 'Here is {title}, enjoy.', 'This one is {title}. Ka ọ dị!', 'Now, {title}. Uncle has spoken.'] },
  hausa: { open: ['Sannu da zuwa, {colony}. {dj} on {station}.', 'Barka da {podh}, my friends. {dj} here on {station}.', 'Sannu, sannu. It is {dj}, on {station}.', 'Yaya dai, {colony}? {dj} on {station}.'],
    news: ['Some news: {e}. Patience, my friends, patience.', 'I was told {e}. Allah ya kiyaye.', 'From the Colony Log: {e}. Interesting. Very interesting.', 'Hmm, {e}. Some people are busy.', 'So, {e}. Na gode, colony.'],
    close: ['Now, {title}. Relax.', 'Here is {title}. Na gode.', 'Let the wind bring you {title}.', 'Sit back for {title}.'] },
  english: { open: ['Good {pod}, {colony}. You are locked in to {station} with {dj}.', 'This is {dj} on {station}, keeping you company in {colony}.', 'Hey {colony}, it is {time} and {weather}. {dj} on {station}.', '{station}, {pop} colonists strong. I am {dj}.'],
    news: ['Colony news: {e}.', 'Headline from the Colony Log: {e}.', 'In case you missed it, {e}.', 'Here is one for the group chat: {e}.', 'Breaking, sort of: {e}.'],
    close: ['Coming up, {title}.', 'Here is {title}. Stay smooth.', 'Let us slow it down with {title}.', 'This is {title}, on {station}.'] },
  pidgin: { open: ['Wetin dey happen, {colony}! Na your guy {dj} on {station}!', 'How far my people! {dj} dey for {station}, make una gather!', 'Omo! {dj} don land for {station} again!', 'Oya oya, {colony}! Na {station} with {dj}!'],
    news: ['Gist don land: {e}. E choke!', 'Una hear am? {e}. Wahala no dey finish for this colony!', 'Na so I hear say {e}. Omo!', 'Breaking gist: {e}. Who send am?', 'See as {e}. Na wa o!'],
    close: ['Make I drop {title} for una. Shake body!', 'Na {title} be this, no dull yourself!', 'Oya, {title}. Turn am up!', 'Make we enjoy {title}, sharp sharp!'] },
};

export class Radio {
  constructor(world, bus) { this.world = world; this.bus = bus; this.listenAt = {}; this.wrote = {}; this.busy = false; }
  // ---- uploaded songs ----
  // The list (without the audio) is cached; a change clears it and tells every radio to refresh its running order.
  async tracks(fresh) { if (!fresh && this.trk && Date.now() - this.trkAt < 60000) return this.trk;
    const rows = (await pool.query('select id, station, title, dur, size, mime, enabled, t from radio_tracks order by t')).rows; this.trkAt = Date.now();
    this.trk = { all: rows, by: Object.fromEntries(STATION_IDS.map(k => [k, rows.filter(r => r.station === k && r.enabled).map(r => ({ id: r.id, dur: r.dur, title: r.title }))])) }; return this.trk; }
  changed() { this.trk = null; this.bus?.publish([{ op: 'radioTracks' }]); }
  // The audio itself: kept in memory for the songs played lately (up to ~80 MB), so many listeners don't each hit the database.
  async audio(id) { this.cache ||= new Map(); const hit = this.cache.get(id); if (hit) { this.cache.delete(id); this.cache.set(id, hit); return hit; }
    const r = (await pool.query('select data, mime from radio_tracks where id = $1', [id])).rows[0]; if (!r) return null;
    this.cache.set(id, r); let total = 0; for (const v of this.cache.values()) total += v.data.length;
    for (const [k, v] of this.cache) { if (total <= 80e6) break; this.cache.delete(k); total -= v.data.length; } return r; }
  // what a station is playing at time t (and its title)
  async playing(st, t) { return timeline(st, (await this.tracks()).by[st], t); }
  voiceKind() { return process.env.FISH_API_KEY ? 'fish' : process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION ? 'azure' : 'text'; }
  status() { return { writer: process.env.ANTHROPIC_API_KEY ? 'claude' : 'phrases', voice: this.voiceKind(), model: this.model() }; }
  model() { return process.env.RADIO_MODEL || 'claude-haiku-5-5'; }
  // Someone is tuned in (a player's radio or the 24/7 stream). Shared with the leader through the settings table.
  async listen(st) { if (!STATIONS[st]) return; const now = Date.now(); if (now - (this.wrote[st] || 0) < 60000) return; this.wrote[st] = now;
    await pool.query("insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = $2", ['radio:listen:' + st, now]); }
  // The developer's switches: the whole radio on or off, and each station on or off. A station that's off isn't on
  // anyone's dial and gets no DJ breaks (so nothing is spent on it).
  async config(fresh) { if (!fresh && this.cfg && Date.now() - this.cfgAt < 30000) return this.cfg;
    const r = (await pool.query("select value from settings where key = 'radio:config'")).rows[0]?.value || {};
    this.cfg = { on: r.on !== false, stations: Object.fromEntries(STATION_IDS.map(k => [k, r.stations?.[k] !== false])),
      talkEvery: Math.max(1, Math.min(6, Number(r.talkEvery) || 2)), voices: { ...(r.voices || {}) } }; this.cfgAt = Date.now(); return this.cfg; }
  async onAir() { const c = await this.config(); return c.on ? STATION_IDS.filter(k => c.stations[k]) : []; }
  async setConfig(b) { const c = { ...(await this.config(true)) }; c.stations = { ...c.stations };
    if (typeof b.on === 'boolean') c.on = b.on;
    if (b.stations && typeof b.stations === 'object') for (const k of STATION_IDS) if (typeof b.stations[k] === 'boolean') c.stations[k] = b.stations[k];
    if (b.talkEvery != null) c.talkEvery = Math.max(1, Math.min(6, Math.round(Number(b.talkEvery)) || 2)); // a DJ break every N songs
    if (b.voices && typeof b.voices === 'object') { c.voices = { ...c.voices }; for (const k of STATION_IDS) if (k in b.voices) { const v = String(b.voices[k] || '').trim();
      if (v && !/^[A-Za-z0-9]{8,40}$/.test(v)) throw new HttpError(400, 'That isn’t an ElevenLabs voice ID.'); if (v) c.voices[k] = v; else delete c.voices[k]; } }
    await pool.query("insert into settings (key, value) values ('radio:config', $1) on conflict (key) do update set value = $1", [c]); this.cfg = c; this.cfgAt = Date.now();
    const onAir = await this.onAir(); this.bus?.publish([{ op: 'radioConfig', onAir }]); return { ...c, onAir }; }
  async listening() { const r = (await pool.query("select key, value from settings where key like 'radio:listen:%'")).rows, now = Date.now(), on = await this.onAir();
    return on.filter(st => { const x = r.find(k => k.key === 'radio:listen:' + st); return x && now - Number(x.value) < LISTEN_MS; }); }

  // Run every 15 s on the leader: write the next break for each station someone is listening to.
  async tick() {
    if (this.busy || !this.world.meta) return; this.busy = true;
    try { const now = Date.now();
      for (const st of await this.listening()) {
        const every = (await this.config()).talkEvery; for (let n = slotOf(st, now) + 1; slotStart(st, n) < now + LEAD_MS; n++) { if (n % every !== 0) continue;
          const has = (await pool.query('select 1 from radio_talk where station = $1 and slot = $2', [st, n])).rowCount; if (has) continue;
          await this.make(st, n, slotStart(st, n) + 1500).catch(e => console.error('radio:', st, e.message)); }
      }
      if (Math.random() < 0.02) await pool.query('delete from radio_talk where t < $1', [now - 2 * 86400e3]);
    } finally { this.busy = false; }
  }

  // What's worth saying: the freshest events this station hasn't talked about, the Town Square and the mayor's race.
  async facts(st) {
    const w = this.world, m = w.meta, now = Date.now(), gm = (now - m.epoch) / R.GAME_MIN_MS;
    const done = new Set((await pool.query("select unnest(events) id from radio_talk where station = $1 and t > $2", [st, now - 86400e3])).rows.map(r => r.id));
    const last = (await pool.query('select max(t) t from radio_talk where station = $1', [st])).rows[0].t || now - 3600e3;
    const evs = (await pool.query('select id, t, kind, text from events where t > $1 order by t desc limit 60', [Math.min(Number(last), now - 15 * 60000) - 60000])).rows
      .filter(e => !done.has(e.id) && (PRIORITY[e.kind] || 2) >= 2)
      .map(e => ({ ...e, score: (PRIORITY[e.kind] || 2) * 10 - (now - Number(e.t)) / 60000 })).sort((a, b) => b.score - a.score)
      // the same news twice (three towers built) is told once, and counts as told for all of them
      .reduce((out, e) => { const k = clean(e.text).toLowerCase(), same = out.find(x => x.key === k); if (same) same.ids.push(e.id); else out.push({ ...e, key: k, ids: [e.id] }); return out; }, []).slice(0, 3);
    const square = (await pool.query("select handle, text from messages where t > $1 and length(text) between 8 and 200 order by t desc limit 6", [now - 45 * 60000])).rows.map(r => `@${r.handle}: ${clean(r.text)}`);
    let election = null; try { const e = await w.elections?.info(null); if (e) { const top = e.candidates.slice(0, 3).map(c => `@${c.handle} (${c.votes} votes, pledge: ${c.policy})`);
      election = { mayor: e.mayor ? '@' + e.mayor.handle : null, candidates: top, closesInHours: Math.max(0, Math.round((e.endsAt - now) / 3600e3)) }; } } catch {}
    let race = null; try { const t = await w.races?.soonest(); if (t) { const at = w.races.startOf(t, w.races.nextN(t, now)); race = { track: t.name, inMinutes: Math.max(0, Math.round((at - now) / 60000)), x: t.x, y: t.y }; } } catch {}
    return { colony: m.name, planet: 'Gliese 12 b', time: fmtClock(gm), partOfDay: partOfDay(gm), weather: R.weatherAt(m, gm), population: m.population || 0,
      events: evs.map(e => ({ id: e.id, ids: e.ids, kind: e.kind, text: clean(e.text), minutesAgo: Math.round((now - Number(e.t)) / 60000) })), townSquare: square, election, race };
  }
  async recent(st, n = 12) { return (await pool.query('select text from radio_talk where station = $1 order by t desc limit $2', [st, n])).rows.map(r => r.text); }

  async make(st, slot, at, opts = {}) {
    const S = STATIONS[st], f = await this.facts(st), recent = await this.recent(st);
    // the song to introduce: the one playing when the DJ starts, or the next one if this is nearly over
    const cur = await this.playing(st, at), song = cur.end - at < 45000 ? await this.playing(st, cur.end + 1) : cur, title = song.title;
    let text = null, source = 'phrases';
    if (process.env.ANTHROPIC_API_KEY) { try { text = await this.write(st, f, recent, title); source = 'claude'; } catch (e) { console.error('radio writer:', e.message); } }
    if (!text) text = this.phrases(st, f, recent, title);
    // what the camera should look at while the DJ talks: the first person or place in the break
    const ev = f.events.find(e => text.includes(e.text.slice(0, 18))) || f.events[0], handle = /@([\w.]+)/.exec(text)?.[1] || (ev && /@([\w.]+)/.exec(ev.text)?.[1]);
    const focus = handle ? { handle } : (f.race && /race|track/i.test(text) && f.race.inMinutes < 5) ? { x: f.race.x, y: f.race.y, race: true } : null;
    let audio = null, dur = Math.max(6, words(text).length / 2.6);
    if (this.voiceKind() !== 'text') { try { const v = await this.voice(st, text); if (v) { audio = v.audio; dur = audio.length * 8 / v.bps; } } catch (e) { console.error('radio voice:', e.message); } }
    const row = { id: uid(), station: st, slot, t: Date.now(), at, kind: opts.kind || 'talk', text, events: f.events.filter((e, i) => text.includes(e.text.slice(0, 18)) || (/@[\w.]+/.exec(e.text) && text.includes(/@[\w.]+/.exec(e.text)[0])) || (source === 'claude' && i === 0)).flatMap(e => e.ids), focus, dur, source };
    const saved = await pool.query(`insert into radio_talk (id, station, slot, t, at, kind, text, events, focus, audio, dur, source) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (station, slot) do nothing`,
      [row.id, st, slot, row.t, at, row.kind, text, row.events, focus, audio, dur, source]);
    if (!saved.rowCount) throw new HttpError(409, 'That break was already written.'); // another instance got there first
    const out = { id: row.id, station: st, at, kind: row.kind, text, focus, dur, audio: audio ? `/api/radio/voice/${row.id}` : null, dj: S.dj.name };
    this.bus?.publish([{ op: 'radio', talk: out }]); // radios tuned to this station pick it up at once
    return { ...out, slot, events: row.events, source };
  }

  // Claude writes the break in the DJ's voice, from the facts, without reusing their recent lines.
  async write(st, f, recent, title, retry = 0) {
    const S = STATIONS[st];
    const system = `You are ${S.dj.name}, the DJ of ${S.name} (${S.freq}), a ${S.lang}-flavoured music station in ${f.colony}, a colony on the planet ${f.planet} in the game Resurgence, where every colonist is a real player.
Personality: ${S.dj.vibe}. Chill and funny, never mean.
Write ONE short radio talk break, spoken aloud, 35 to 75 words. Plain spoken words only: no emojis, hashtags, stage directions, quotation marks or lists.
Use one or two of the facts you are given, the most interesting first, and say them accurately. Refer to players by their @handle exactly as written.
Tease lightly, never insult anyone, never joke about ethnicity, religion, gender, money troubles or real-world politics. Nothing sexual.
End by introducing the next song by its title.
Do not reuse any joke, catchphrase, opening or sentence from your recent breaks. Every break must feel new.`;
    const user = `Facts right now:\n${JSON.stringify({ ...f, events: f.events.map(({ id, ids, ...e }) => e) }, null, 1)}\n\nNext song: "${title}"\n\nYour recent breaks (do not repeat them):\n${recent.map(t => '- ' + t).join('\n') || '(none yet)'}\n\nWrite the break.`;
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model(), max_tokens: 300, temperature: 1, system, messages: [{ role: 'user', content: user }] }), signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error(`Claude API ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const text = clean((await r.json()).content?.map(c => c.text || '').join(' ')).replace(/^["']|["']$/g, '').slice(0, 700);
    if (!text) throw new Error('empty break');
    if (retry < 1 && recent.some(p => similarity(p, text) > 0.3)) return this.write(st, f, [text, ...recent], title, retry + 1);
    return text;
  }

  // The phrase bank: an opener, one or two pieces of news and a song intro, avoiding anything said recently.
  phrases(st, f, recent, title) {
    const B = BANK[st], S = STATIONS[st], said = recent.join(' \n ');
    const fresh = list => { const unused = list.filter(p => !said.includes(p.split('{')[0].trim().slice(0, 24) || '~')); return pick(unused.length ? unused : list); };
    const fill = p => p.replace(/\{dj\}/g, S.dj.name).replace(/\{station\}/g, S.name).replace(/\{colony\}/g, f.colony).replace(/\{title\}/g, title).replace(/\{time\}/g, f.time)
      .replace(/\{weather\}/g, { sunny: 'sunny outside', cloudy: 'a bit cloudy', rain: 'raining', fog: 'foggy out there', storm: 'stormy, so stay indoors' }[f.weather] || f.weather).replace(/\{pop\}/g, f.population.toLocaleString('en-US'))
      .replace(/\{pod\}/g, (st === 'yoruba' ? YORUBA_POD : GREET)[f.partOfDay]).replace(/\{podh\}/g, HAUSA_POD[f.partOfDay]);
    const parts = [fill(fresh(B.open))];
    const news = f.events.slice(0, 2).map(e => e.text.replace(/\.$/, ''));
    if (!news.length && f.race && f.race.inMinutes <= 10) news.push(`the next race at ${f.race.track} starts in ${f.race.inMinutes} minutes, so place your bets`);
    if (!news.length && f.election?.candidates.length) news.push(`the mayor's race is on with ${f.election.candidates.length} candidates, and voting closes in ${f.election.closesInHours} hours`);
    if (!news.length && f.townSquare.length) news.push(`over in the Town Square, ${f.townSquare[0]}`);
    for (const e of news) parts.push(fill(fresh(B.news)).replace('{e}', e));
    parts.push(fill(fresh(B.close)));
    return parts.join(' ');
  }

  // Azure AI Speech reads the break (a Nigerian-English voice, paced to the DJ).
  // ---- Fish Audio ----
  async fish(path, opts = {}) { const r = await fetch('https://api.fish.audio' + path, { ...opts, headers: { authorization: 'Bearer ' + process.env.FISH_API_KEY, ...(opts.headers || {}) }, signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error(`Fish Audio ${r.status}: ${(await r.text()).slice(0, 200)}`); return r; }
  // your own voices, and the most used Nigerian voices in the Fish Audio library
  async fishVoices() { const get = q => this.fish('/model?' + new URLSearchParams(q)).then(r => r.json()).then(j => j.items || []).catch(() => []);
    const [mine, ...found] = await Promise.all([get({ self: 'true', page_size: '50' }), ...['nigerian', 'naija', 'pidgin', 'yoruba', 'igbo', 'hausa', 'lagos'].map(t => get({ title: t, page_size: '15', sort_by: 'task_count' }))]);
    const seen = new Set(), out = [];
    for (const [list, cat] of [[mine, 'mine'], [found.flat().sort((a, b) => (b.task_count || 0) - (a.task_count || 0)), 'library']]) for (const m of list) { if (seen.has(m._id) || (m.type && m.type !== 'tts')) continue; seen.add(m._id);
      const tags = (m.tags || []).map(t => String(t).toLowerCase()); out.push({ id: m._id, name: m.title, accent: tags.filter(t => !['male', 'female'].includes(t)).slice(0, 3).join(', '), gender: tags.includes('female') ? 'female' : tags.includes('male') ? 'male' : '', category: cat, uses: m.task_count || 0 }); }
    return out.slice(0, 80); }
  // ---- ElevenLabs ----
  async eleven(path, opts = {}) { const r = await fetch('https://api.elevenlabs.io' + path, { ...opts, headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, ...(opts.headers || {}) }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`); return r; }
  // the voices on the account (your own and ones added from the Voice Library), cached for 10 minutes
  async voices(fresh) { if (!fresh && this.vcs && Date.now() - this.vcsAt < 600000) return this.vcs;
    if (this.voiceKind() === 'fish') { this.vcsAt = Date.now(); return (this.vcs = await this.fishVoices()); }
    const j = await (await this.eleven('/v1/voices')).json(); this.vcsAt = Date.now();
    return (this.vcs = (j.voices || []).map(v => ({ id: v.voice_id, name: v.name, accent: v.labels?.accent || '', gender: v.labels?.gender || '', category: v.category || '' }))); }
  // how much of the month's characters are used (checked at most every 5 minutes)
  async quota(fresh) { if (!fresh && this.qta && Date.now() - this.qtaAt < 300000) return this.qta;
    if (this.voiceKind() === 'fish') { const j = await (await this.fish('/wallet/self/api-credit')).json(); this.qtaAt = Date.now(); return (this.qta = { credit: Number(j.credit) || 0, kind: 'fish' }); }
    const j = await (await this.eleven('/v1/user/subscription')).json(); this.qtaAt = Date.now();
    return (this.qta = { used: j.character_count || 0, limit: j.character_limit || 0, resets: (j.next_character_count_reset_unix || 0) * 1000, tier: j.tier || '' }); }
  // the DJ's voice: the one picked in the Stream tab, or else the best match from the account (a Nigerian voice of
  // the DJ's gender if there is one)
  async voiceFor(st) { const c = await this.config(); if (c.voices[st]) return c.voices[st];
    const all = await this.voices().catch(() => []), female = ['yoruba', 'english'].includes(st), want = v => (v.gender || '').toLowerCase() === (female ? 'female' : 'male');
    const ng = all.filter(v => /nigeria|naija|pidgin|african|yoruba|igbo|hausa|lagos/i.test(v.accent + ' ' + v.name));
    return (ng.find(want) || ng[0] || all.find(want) || all[0])?.id || (this.voiceKind() === 'fish' ? null : female ? 'EXAVITQu4vr4xnSDxMaL' : 'JBFqnCBsd6RMkjVDRZzb'); }
  async voice(st, text) {
    const speedOf = { pidgin: 1.06, yoruba: 1.02, igbo: 1, hausa: 0.94, english: 0.98 };
    if (this.voiceKind() === 'fish') {
      const q = await this.quota().catch(() => null); if (q && q.credit < 0.05) { console.log('radio voice: Fish Audio credit used up; text only'); return null; }
      const ref = await this.voiceFor(st), body = { text: speakable(text), format: 'mp3', mp3_bitrate: 64, normalize: true, latency: 'normal', prosody: { speed: speedOf[st] || 1, volume: 0 } };
      if (ref) body.reference_id = ref;
      const r = await this.fish('/v1/tts', { method: 'POST', headers: { 'content-type': 'application/json', model: process.env.FISH_MODEL || 's2.1-pro' }, body: JSON.stringify(body) });
      if (this.qta) this.qta.credit -= Buffer.byteLength(body.text) / 1e6 * 15; return { audio: Buffer.from(await r.arrayBuffer()), bps: 64000 };
    }
    if (process.env.ELEVENLABS_API_KEY) {
      const words = speakable(text), q = await this.quota().catch(() => null);
      if (q && q.limit && q.used + words.length > q.limit - 300) { console.log('radio voice: ElevenLabs characters used up for this month; text only'); return null; }
      const speed = { pidgin: 1.06, yoruba: 1.02, igbo: 1, hausa: 0.94, english: 0.98 }[st] || 1;
      const r = await this.eleven(`/v1/text-to-speech/${await this.voiceFor(st)}?output_format=mp3_44100_64`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text: words, model_id: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5', voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed } }) });
      if (this.qta) this.qta.used += words.length; return { audio: Buffer.from(await r.arrayBuffer()), bps: 64000 };
    }
    const S = STATIONS[st], esc = s => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
    const rate = { pidgin: '+8%', yoruba: '+3%', igbo: '0%', hausa: '-6%', english: '-2%' }[st] || '0%';
    const ssml = `<speak version="1.0" xml:lang="en-NG"><voice name="${process.env['AZURE_VOICE_' + st.toUpperCase()] || S.dj.voice}"><prosody rate="${rate}">${esc(speakable(text))}</prosody></voice></speak>`;
    const r = await fetch(`https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'resurgence-radio' },
      body: ssml, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error(`Azure speech ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return { audio: Buffer.from(await r.arrayBuffer()), bps: 48000 };
  }

  // What a radio needs: each station's song now, and the talk breaks around now for the station being listened to.
  async now(on) {
    const now = Date.now(), stations = {};
    const T = await this.tracks();
    for (const st of STATION_IDS) { const it = timeline(st, T.by[st], now), nx = timeline(st, T.by[st], it.end + 1); stations[st] = { kind: it.kind, start: it.start, end: it.end, title: it.title, next: nx.title }; }
    let talk = []; const onAir = await this.onAir();
    if (STATIONS[on] && onAir.includes(on)) { await this.listen(on).catch(() => {});
      talk = (await pool.query('select id, station, slot, at, kind, text, focus, dur, audio is not null has_audio from radio_talk where station = $1 and at > $2 and at < $3 order by at', [on, now - 120000, now + 10 * 60000])).rows
        .map(r => ({ id: r.id, station: r.station, at: Number(r.at), kind: r.kind, text: r.text, focus: r.focus, dur: r.dur, audio: r.has_audio ? `/api/radio/voice/${r.id}` : null, dj: STATIONS[r.station].dj.name })); }
    return { serverNow: now, onAir, stations, talk, tracks: STATIONS[on] ? T.by[on] : undefined };
  }
}

export function radioRoutes(app, { radio, admin, send, limit }) {
  app.get('/api/radio', limit, send(async req => radio.now(String(req.query.on || ''))));
  // a song, with byte ranges so players can start mid-song and phones (Safari) can play it at all
  app.get('/api/radio/track/:id', async (req, res) => {
    try { const r = await radio.audio(String(req.params.id)); if (!r) return res.status(404).end(); const buf = r.data, n = buf.length;
      res.set({ 'content-type': r.mime, 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=31536000, immutable' });
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') || '');
      if (m) { let a = m[1] === '' ? n - Number(m[2]) : Number(m[1]), b = m[1] !== '' && m[2] !== '' ? Number(m[2]) : n - 1; a = Math.max(0, a); b = Math.min(n - 1, b);
        if (a > b) return res.status(416).set('content-range', `bytes */${n}`).end();
        return res.status(206).set({ 'content-range': `bytes ${a}-${b}/${n}`, 'content-length': String(b - a + 1) }).end(buf.subarray(a, b + 1)); }
      res.set('content-length', String(n)).end(buf); } catch (e) { res.status(500).end(); }
  });
  app.get('/api/radio/voice/:id', limit, async (req, res) => {
    try { const r = (await pool.query('select audio from radio_talk where id = $1', [String(req.params.id)])).rows[0]; if (!r?.audio) return res.status(404).end();
      res.set({ 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=86400' }).send(r.audio); } catch (e) { res.status(500).end(); }
  });
  // the ElevenLabs voices to choose from
  app.get('/api/admin/radio/voices', admin, send(async () => { if (!['fish', 'elevenlabs'].includes(radio.voiceKind())) throw new HttpError(400, 'Set FISH_API_KEY (or ELEVENLABS_API_KEY) on the server first.'); return { voices: await radio.voices(true) }; }));
  app.get('/api/admin/radio', admin, send(async () => ({ ...radio.status(), quota: ['fish', 'elevenlabs'].includes(radio.voiceKind()) ? await radio.quota(true).catch(e => ({ error: e.message })) : null, ...(await radio.config(true)), onAir: await radio.onAir(), listening: await radio.listening(),
    recent: (await pool.query('select id, station, at, text, source, dur, audio is not null has_audio from radio_talk order by t desc limit 30')).rows.map(r => ({ ...r, at: Number(r.at) })) })));
  // the developer's songs: upload (the file itself as the body; ?station, ?title, ?dur in seconds), list, edit, delete
  const AUDIO = { 'audio/mpeg': 1, 'audio/mp3': 1, 'audio/mp4': 1, 'audio/x-m4a': 1, 'audio/aac': 1, 'audio/ogg': 1, 'audio/webm': 1, 'audio/wav': 1, 'audio/x-wav': 1 };
  app.get('/api/admin/radio/tracks', admin, send(async () => { const T = await radio.tracks(true); return { tracks: T.all.map(r => ({ ...r, t: Number(r.t) })), bytes: T.all.reduce((s, r) => s + r.size, 0) }; }));
  app.post('/api/admin/radio/tracks', admin, express.raw({ type: () => true, limit: '15mb' }), send(async req => {
    const st = String(req.query.station || ''), mime = String(req.get('content-type') || '').split(';')[0].toLowerCase(), dur = Number(req.query.dur);
    if (!STATIONS[st]) throw new HttpError(400, 'Pick a station.');
    if (!AUDIO[mime]) throw new HttpError(400, 'That isn’t a sound file. Use MP3 or M4A.');
    if (!Buffer.isBuffer(req.body) || req.body.length < 10000) throw new HttpError(400, 'That file is empty.');
    if (!(dur >= 20 && dur <= 1200)) throw new HttpError(400, 'A song has to be between 20 seconds and 20 minutes long.');
    const title = clean(req.query.title).replace(/\.(mp3|m4a|aac|ogg|wav|webm)$/i, '').replace(/[_]+/g, ' ').slice(0, 80) || 'Untitled', id = uid();
    await pool.query('insert into radio_tracks (id, station, title, dur, mime, size, data, t) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id, st, title, dur, mime === 'audio/mp3' ? 'audio/mpeg' : mime, req.body.length, req.body, Date.now()]);
    radio.changed(); return { id, station: st, title, dur, size: req.body.length };
  }));
  app.patch('/api/admin/radio/tracks/:id', admin, send(async req => { const b = req.body || {}, sets = [], vals = [String(req.params.id)];
    if (typeof b.enabled === 'boolean') { vals.push(b.enabled); sets.push(`enabled = $${vals.length}`); }
    if (typeof b.title === 'string' && clean(b.title)) { vals.push(clean(b.title).slice(0, 80)); sets.push(`title = $${vals.length}`); }
    if (STATIONS[b.station]) { vals.push(b.station); sets.push(`station = $${vals.length}`); }
    if (!sets.length) throw new HttpError(400, 'Nothing to change.');
    const r = await pool.query(`update radio_tracks set ${sets.join(', ')} where id = $1`, vals); if (!r.rowCount) throw new HttpError(404, 'No such song.');
    radio.changed(); return { ok: true }; }));
  app.delete('/api/admin/radio/tracks/:id', admin, send(async req => { const r = await pool.query('delete from radio_tracks where id = $1', [String(req.params.id)]);
    if (!r.rowCount) throw new HttpError(404, 'No such song.'); radio.cache?.delete(String(req.params.id)); radio.changed(); return { ok: true }; }));
  // the developer's switches: { on: false } takes the whole radio off air; { stations: { hausa: false } } one station
  app.put('/api/admin/radio', admin, send(async req => radio.setConfig(req.body || {})));
  // the developer: put a break on air now (to try a DJ out)
  app.post('/api/admin/radio/talk', admin, send(async req => { const st = String(req.body?.station || ''); if (!STATIONS[st]) throw new HttpError(400, 'Pick a station.');
    if (!(await radio.onAir()).includes(st)) throw new HttpError(400, `${STATIONS[st].name} is switched off. Switch it on first.`);
    return radio.make(st, -1 - Math.floor(Math.random() * 2e9), Date.now() + 2500, { kind: 'live' }); })); // a break outside the song slots: its own (negative) number
}
