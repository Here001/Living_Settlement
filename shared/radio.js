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
