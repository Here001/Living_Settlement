// Colony radio: the DJs. Music is composed in the browser (public/music.js); this file writes and voices the talk.
//
// Every second song on each station opens with a DJ talk break, written fresh from what just happened in the colony:
// the Colony Log (races, heists, lottery wins, new arrivals, elections…), the Town Square and the mayor's race.
//   - With ANTHROPIC_API_KEY set, Claude writes each break in the DJ's own voice. It is shown the DJ's last breaks and
//     told not to reuse their jokes or lines; a break that still comes out too close to a recent one is rewritten.
//   - Without it, breaks are built from each DJ's phrase bank, never reusing a recent phrase.
//   - With AZURE_SPEECH_KEY and AZURE_SPEECH_REGION set, Azure AI Speech reads it aloud (Nigerian-English voices).
//     Without them the break still shows as on-air text.
// An event is only talked about once per station. Breaks are only made for stations someone is listening to (a player
// or the 24/7 stream), so nothing is spent when nobody is tuned in. The leader instance makes them; any instance serves them.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { HttpError } from './world.js';
import * as R from '../shared/rules.js';
import { STATIONS, STATION_IDS, slotOf, slotStart, talkSlot, songTitle } from '../shared/radio.js';

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
  status() { return { writer: process.env.ANTHROPIC_API_KEY ? 'claude' : 'phrases', voice: process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION ? 'azure' : 'text', model: this.model() }; }
  model() { return process.env.RADIO_MODEL || 'claude-haiku-5-5'; }
  // Someone is tuned in (a player's radio or the 24/7 stream). Shared with the leader through the settings table.
  async listen(st) { if (!STATIONS[st]) return; const now = Date.now(); if (now - (this.wrote[st] || 0) < 60000) return; this.wrote[st] = now;
    await pool.query("insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = $2", ['radio:listen:' + st, now]); }
  // The developer's switches: the whole radio on or off, and each station on or off. A station that's off isn't on
  // anyone's dial and gets no DJ breaks (so nothing is spent on it).
  async config(fresh) { if (!fresh && this.cfg && Date.now() - this.cfgAt < 30000) return this.cfg;
    const r = (await pool.query("select value from settings where key = 'radio:config'")).rows[0]?.value || {};
    this.cfg = { on: r.on !== false, stations: Object.fromEntries(STATION_IDS.map(k => [k, r.stations?.[k] !== false])) }; this.cfgAt = Date.now(); return this.cfg; }
  async onAir() { const c = await this.config(); return c.on ? STATION_IDS.filter(k => c.stations[k]) : []; }
  async setConfig(b) { const c = { ...(await this.config(true)) }; c.stations = { ...c.stations };
    if (typeof b.on === 'boolean') c.on = b.on;
    if (b.stations && typeof b.stations === 'object') for (const k of STATION_IDS) if (typeof b.stations[k] === 'boolean') c.stations[k] = b.stations[k];
    await pool.query("insert into settings (key, value) values ('radio:config', $1) on conflict (key) do update set value = $1", [c]); this.cfg = c; this.cfgAt = Date.now();
    const onAir = await this.onAir(); this.bus?.publish([{ op: 'radioConfig', onAir }]); return { ...c, onAir }; }
  async listening() { const r = (await pool.query("select key, value from settings where key like 'radio:listen:%'")).rows, now = Date.now(), on = await this.onAir();
    return on.filter(st => { const x = r.find(k => k.key === 'radio:listen:' + st); return x && now - Number(x.value) < LISTEN_MS; }); }

  // Run every 15 s on the leader: write the next break for each station someone is listening to.
  async tick() {
    if (this.busy || !this.world.meta) return; this.busy = true;
    try { const now = Date.now();
      for (const st of await this.listening()) {
        for (let n = slotOf(st, now) + 1; slotStart(st, n) < now + LEAD_MS; n++) { if (!talkSlot(st, n)) continue;
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
    const S = STATIONS[st], f = await this.facts(st), recent = await this.recent(st), title = songTitle(st, slot >= 0 ? slot : slotOf(st, at));
    let text = null, source = 'phrases';
    if (process.env.ANTHROPIC_API_KEY) { try { text = await this.write(st, f, recent, title); source = 'claude'; } catch (e) { console.error('radio writer:', e.message); } }
    if (!text) text = this.phrases(st, f, recent, title);
    // what the camera should look at while the DJ talks: the first person or place in the break
    const ev = f.events.find(e => text.includes(e.text.slice(0, 18))) || f.events[0], handle = /@([\w.]+)/.exec(text)?.[1] || (ev && /@([\w.]+)/.exec(ev.text)?.[1]);
    const focus = handle ? { handle } : (f.race && /race|track/i.test(text) && f.race.inMinutes < 5) ? { x: f.race.x, y: f.race.y, race: true } : null;
    let audio = null, dur = Math.max(6, words(text).length / 2.6);
    if (process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION) { try { audio = await this.voice(st, text); dur = audio.length * 8 / 48000; } catch (e) { console.error('radio voice:', e.message); } }
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
  async voice(st, text) {
    const S = STATIONS[st], esc = s => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
    const rate = { pidgin: '+8%', yoruba: '+3%', igbo: '0%', hausa: '-6%', english: '-2%' }[st] || '0%';
    const ssml = `<speak version="1.0" xml:lang="en-NG"><voice name="${process.env['AZURE_VOICE_' + st.toUpperCase()] || S.dj.voice}"><prosody rate="${rate}">${esc(speakable(text))}</prosody></voice></speak>`;
    const r = await fetch(`https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'resurgence-radio' },
      body: ssml, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error(`Azure speech ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return Buffer.from(await r.arrayBuffer());
  }

  // What a radio needs: each station's song now, and the talk breaks around now for the station being listened to.
  async now(on) {
    const now = Date.now(), stations = {};
    for (const st of STATION_IDS) { const n = slotOf(st, now); stations[st] = { slot: n, start: slotStart(st, n), title: songTitle(st, n), next: songTitle(st, n + 1) }; }
    let talk = []; const onAir = await this.onAir();
    if (STATIONS[on] && onAir.includes(on)) { await this.listen(on).catch(() => {});
      talk = (await pool.query('select id, station, slot, at, kind, text, focus, dur, audio is not null has_audio from radio_talk where station = $1 and at > $2 and at < $3 order by at', [on, now - 120000, now + 10 * 60000])).rows
        .map(r => ({ id: r.id, station: r.station, at: Number(r.at), kind: r.kind, text: r.text, focus: r.focus, dur: r.dur, audio: r.has_audio ? `/api/radio/voice/${r.id}` : null, dj: STATIONS[r.station].dj.name })); }
    return { serverNow: now, onAir, stations, talk };
  }
}

export function radioRoutes(app, { radio, admin, send, limit }) {
  app.get('/api/radio', limit, send(async req => radio.now(String(req.query.on || ''))));
  app.get('/api/radio/voice/:id', limit, async (req, res) => {
    try { const r = (await pool.query('select audio from radio_talk where id = $1', [String(req.params.id)])).rows[0]; if (!r?.audio) return res.status(404).end();
      res.set({ 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=86400' }).send(r.audio); } catch (e) { res.status(500).end(); }
  });
  app.get('/api/admin/radio', admin, send(async () => ({ ...radio.status(), ...(await radio.config(true)), onAir: await radio.onAir(), listening: await radio.listening(),
    recent: (await pool.query('select id, station, at, text, source, dur, audio is not null has_audio from radio_talk order by t desc limit 30')).rows.map(r => ({ ...r, at: Number(r.at) })) })));
  // the developer's switches: { on: false } takes the whole radio off air; { stations: { hausa: false } } one station
  app.put('/api/admin/radio', admin, send(async req => radio.setConfig(req.body || {})));
  // the developer: put a break on air now (to try a DJ out)
  app.post('/api/admin/radio/talk', admin, send(async req => { const st = String(req.body?.station || ''); if (!STATIONS[st]) throw new HttpError(400, 'Pick a station.');
    if (!(await radio.onAir()).includes(st)) throw new HttpError(400, `${STATIONS[st].name} is switched off. Switch it on first.`);
    return radio.make(st, -1 - Math.floor(Math.random() * 2e9), Date.now() + 2500, { kind: 'live' }); })); // a break outside the song slots: its own (negative) number
}
