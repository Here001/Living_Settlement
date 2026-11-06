// Colony radio: five stations, each with its own music style (composed live by public/music.js) and its own DJ.
// Shared by the server (DJ talk) and the browser (music and the radio dial).
//
// Every station runs on the same clock for everyone: a "song slot" lasts SLOT_MS and slot n of a station is always the
// same song, so two people tuned to one station hear the same thing at the same moment, like real radio.
export const SLOT_MS = 180000;
export const TALK_EVERY = 2; // a DJ talk break at the start of every 2nd song

export const STATIONS = {
  yoruba: { name: 'Ìlú FM', freq: '88.1', lang: 'Yoruba', style: 'Fuji · Jùjú · Apala', color: '#2f8f5b',
    dj: { name: 'DJ Àyìnkẹ́', voice: 'en-NG-EzinneNeural', vibe: 'warm, playful big-sister energy; sprinkles Yoruba greetings and proverbs (Ẹ kú àsìkò yìí, ẹ káàrọ̀, ẹ kú alẹ́, ó yá) into Nigerian English' },
    words: ['Ìfẹ́', 'Ayọ̀', 'Ọ̀rẹ́', 'Ìlú', 'Owó', 'Alẹ́', 'Àṣà', 'Ìrètí', 'Oríire', 'Ọ̀nà', 'Ìbàdàn Groove', 'Ọjà', 'Ilé', 'Àlàáfíà'] },
  igbo: { name: 'Obodo FM', freq: '91.5', lang: 'Igbo', style: 'Highlife', color: '#c0812c',
    dj: { name: 'Uncle Obiora', voice: 'en-NG-AbeoNeural', vibe: 'storyteller uncle, wise and teasing; uses Igbo greetings and sayings (Ndewo, Kedu, Daalụ, Ọ dị mma) in Nigerian English' },
    words: ['Ịhụnanya', 'Ọṅụ', 'Enyi', 'Obodo', 'Ego', 'Abalị', 'Nkem', 'Ụtọ', 'Udo', 'Ezi Ndụ', 'Onye Aghana Nwanne', 'Chi', 'Ụlọ', 'Ahịa'] },
  hausa: { name: 'Gari FM', freq: '94.3', lang: 'Hausa', style: 'Kalangu · Sahel', color: '#3a6fb0',
    dj: { name: 'Malam Sani', voice: 'en-NG-AbeoNeural', vibe: 'calm, dry, very witty elder; uses Hausa greetings (Sannu, Ina kwana, Barka da yamma, Na gode) in Nigerian English' },
    words: ['Soyayya', 'Farin Ciki', 'Aboki', 'Gari', 'Kudi', 'Dare', 'Zaman Lafiya', 'Hanya', 'Kasuwa', 'Iska', 'Sahara Wind', 'Gida', 'Rana', 'Wata'] },
  english: { name: 'Colony 101', freq: '101.1', lang: 'English', style: 'Afrobeats · Chill', color: '#7a4fc0',
    dj: { name: 'Tolu Waves', voice: 'en-NG-EzinneNeural', vibe: 'smooth late-night city radio host, clever and easy-going; does the colony news, Town Hall and election updates' },
    words: ['Soft Landing', 'Midnight Colony', 'Gliese Nights', 'Golden Hour', 'Slow Orbit', 'City Lights', 'New Arrivals', 'Rooftop', 'Afterglow', 'Low Gravity', 'Daydream', 'Night Shift', 'Landing Lights', 'Easy'] },
  pidgin: { name: 'Gbedu FM', freq: '105.9', lang: 'Pidgin', style: 'Amapiano · Street-pop', color: '#d2453c',
    dj: { name: 'Oga Gbedu', voice: 'en-NG-AbeoNeural', vibe: 'loud, hilarious street MC who speaks Nigerian Pidgin (Wetin dey happen, How far, E choke, No wahala, Na so, Omo); roasts people kindly, hypes races and gist' },
    words: ['No Wahala', 'Soft Life', 'Owo Dey', 'Enjoyment', 'Gbedu', 'E Choke', 'Jaiye', 'Wetin Dey', 'Small Small', 'Sharp Sharp', 'Body Dey Sweet', 'Colony Vibes', 'Steady', 'Na God'] },
};
// Each station has four presenters in two pairs that take turns on air (a 3-hour shift each). In a pair, the lead
// runs the show and the support is the funny one: jokes about everything, hypes the lead up. Some breaks are the lead
// alone, most are the two of them together. (dj above is the first pair's lead, used where one name is needed.)
const H = (id, name, gender, role, vibe) => ({ id, name, gender, role, vibe });
const FUNNY = 'the comic sidekick: always funny, full of humour, jokes about everything, quick comebacks and playful exaggeration; backs the lead up, compliments them, and never steals the show or insults anyone';
STATIONS.yoruba.hosts = [H('yoruba.0', 'DJ Àyìnkẹ́', 'female', 'lead', STATIONS.yoruba.dj.vibe), H('yoruba.1', 'Kọ́lá', 'male', 'support', FUNNY + '; drops Yoruba expressions (Ehn!, Ó tì o!, Àṣẹ!) and calls her "Àyìnkẹ́ my sister"'),
  H('yoruba.2', 'Bàbá Fẹ́mi', 'male', 'lead', 'warm, wise elder of the airwaves who loves old Jùjú stories; Yoruba proverbs and greetings in Nigerian English'), H('yoruba.3', 'Tòpẹ́', 'female', 'support', FUNNY + '; teases Bàbá Fẹ́mi about being "old school" with love')];
STATIONS.igbo.hosts = [H('igbo.0', 'Uncle Obiora', 'male', 'lead', STATIONS.igbo.dj.vibe), H('igbo.1', 'Chioma', 'female', 'support', FUNNY + '; sassy, laughs loudly, says "Uncle, ehn!" and "Chineke!"'),
  H('igbo.2', 'Nneka', 'female', 'lead', 'bright, sharp morning-show host, proud of her people, Igbo greetings (Ndewo, Kedu, Daalụ) in Nigerian English'), H('igbo.3', 'Emeka', 'male', 'support', FUNNY + '; always has a "business idea" for everything that happens')];
STATIONS.hausa.hosts = [H('hausa.0', 'Malam Sani', 'male', 'lead', STATIONS.hausa.dj.vibe), H('hausa.1', 'Hauwa', 'female', 'support', FUNNY + '; quick, clever wordplay, says "Kai!" and "Haba Malam!"'),
  H('hausa.2', 'Zainab', 'female', 'lead', 'graceful, calm evening host with a gentle sense of fun; Hausa greetings (Sannu, Barka da yamma, Na gode) in Nigerian English'), H('hausa.3', 'Danladi', 'male', 'support', FUNNY + '; dramatic storyteller who exaggerates everything')];
STATIONS.english.hosts = [H('english.0', 'Tolu Waves', 'female', 'lead', STATIONS.english.dj.vibe), H('english.1', 'Big Dayo', 'male', 'support', FUNNY + '; big laugh, punny one-liners, calls her "the voice of the colony"'),
  H('english.2', 'David Ace', 'male', 'lead', 'upbeat drive-time host, crisp colony news and race updates'), H('english.3', 'Lola Laughs', 'female', 'support', FUNNY + '; witty, sarcastic in a friendly way, loves roasting David\'s jokes')];
STATIONS.pidgin.hosts = [H('pidgin.0', 'Oga Gbedu', 'male', 'lead', STATIONS.pidgin.dj.vibe), H('pidgin.1', 'Ada Wahala', 'female', 'support', FUNNY + '; speaks Nigerian Pidgin, hypes everything with "Ehen!", "I no fit shout!", "Na who dey breathe?"'),
  H('pidgin.2', 'Madam Rita', 'female', 'lead', 'bold, no-nonsense Pidgin-speaking host who keeps the show moving'), H('pidgin.3', 'Bobo Chuks', 'male', 'support', FUNNY + '; speaks Nigerian Pidgin, cracks jokes about everything, always "hungry"')];
export const SHIFT_MS = 3 * 3600e3;
const SHIFT_OFF = { yoruba: 0, igbo: 1, hausa: 0, english: 1, pidgin: 0 }; // neighbouring stations swap at different times
// the pair on air at time t, and when their shift ends
export function hostsOn(station, t) { const k = Math.floor(t / SHIFT_MS), p = (k + (SHIFT_OFF[station] || 0)) % 2, Hs = STATIONS[station].hosts;
  return { pair: p, lead: Hs[p * 2], support: Hs[p * 2 + 1], until: (k + 1) * SHIFT_MS }; }
export const STATION_IDS = Object.keys(STATIONS);
// Each station starts its slots at a different moment, so the stations don't all change song together.
const OFFSET = { yoruba: 0, igbo: 37000, hausa: 74000, english: 111000, pidgin: 148000 };
export const slotOf = (station, t) => Math.floor((t - (OFFSET[station] || 0)) / SLOT_MS);
export const slotStart = (station, n) => n * SLOT_MS + (OFFSET[station] || 0);
export const talkSlot = (station, n) => n % TALK_EVERY === 0;

export function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// The song in a slot: its title is made from the station's words, so every listener sees the same title.
export function songTitle(station, n) {
  const S = STATIONS[station], r = rng(hash(station + ':title:' + n)), w = S.words, a = w[Math.floor(r() * w.length)];
  const tails = { english: ['', '', ' (Interlude)', ' Pt. 2', ' (Late Mix)'], pidgin: ['', '', ' Remix', ' (Street Mix)', ' ft. The Colony'], default: ['', '', '', ' (Live)', ' Pt. 2'] };
  const t = (tails[station] || tails.default); return a + t[Math.floor(r() * t.length)];
}

// ---------- the station's running order ----------
// With uploaded songs, a station plays each of them once per cycle in a shuffled order (a new order every cycle).
// While it has fewer than 8, a generated song follows every second track, so a short list doesn't repeat too often.
// With none, it plays generated songs only. Everyone works out the same running order from the same list and clock.
// tracks: [{ id, dur (seconds), title }]. Returns what's playing at time t: { kind: 'track', track, start, end, title }
// or { kind: 'gen', n, start, end, title } (n picks the generated song). seq numbers the items one after another, so
// the DJ can talk at the start of every Nth one.
const GAP_MS = 1500;
export function timeline(station, tracks, t) {
  const list = (tracks || []).filter(x => x && x.dur >= 20).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!list.length) { const n = slotOf(station, t); return { kind: 'gen', n, seq: n, start: slotStart(station, n), end: slotStart(station, n + 1), title: songTitle(station, n), key: 'g' + n }; }
  const fill = list.length < 8, gens = fill ? Math.ceil(list.length / 2) : 0;
  const L = list.reduce((s, x) => s + x.dur * 1000 + GAP_MS, 0) + gens * SLOT_MS, base = OFFSET[station] || 0;
  const k = Math.floor((t - base) / L); let at = base + k * L;
  const r = rng(hash(station + ':cycle:' + k)), order = list.slice(); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const C = order.length + gens, seq0 = 1e8 + k * C; let j = 0;
  for (let i = 0, g = 0; i < order.length; i++) {
    const tr = order[i], end = at + tr.dur * 1000 + GAP_MS;
    if (t < end) return { kind: 'track', track: tr, seq: seq0 + j, start: at, end, title: tr.title, key: 't' + tr.id + ':' + k + ':' + i };
    at = end; j++;
    if (fill && i % 2 === 1 || (fill && i === order.length - 1 && g < gens)) { if (g >= gens) continue; const n = 1e6 + (k % 1e5) * 16 + g++, gend = at + SLOT_MS;
      if (t < gend) return { kind: 'gen', n, seq: seq0 + j, start: at, end: gend, title: songTitle(station, n), key: 'g' + n + ':' + k };
      at = gend; j++; }
  }
  return { kind: 'gen', n: 1e6 + 99, seq: seq0 + j, start: at, end: at + SLOT_MS, title: songTitle(station, 1e6 + 99), key: 'gx' + k }; // not reached
}
