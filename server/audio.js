// Getting an uploaded song ready for the radio: two MP3s made with ffmpeg, both at the same loudness so no song is
// much louder than the next:
//   - normal: 128 kbps stereo (about 1 MB a minute)
//   - data saver: 48 kbps mono (about 0.35 MB a minute), for slow connections
// and the song's real length. Without ffmpeg the original file is used as it is.
import { spawn } from 'node:child_process';

let has = null;
export async function ffmpegOn() { if (has != null) return has; has = await new Promise(ok => { const p = spawn('ffmpeg', ['-version']); p.on('error', () => ok(false)); p.on('exit', c => ok(c === 0)); }); return has; }

function run(args, input) {
  return new Promise((ok, no) => { const p = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] }), out = [], err = [];
    p.stdout.on('data', b => out.push(b)); p.stderr.on('data', b => err.push(b)); p.on('error', no);
    const t = setTimeout(() => p.kill('SIGKILL'), 120000);
    p.on('exit', c => { clearTimeout(t); c === 0 ? ok({ out: Buffer.concat(out), log: Buffer.concat(err).toString() }) : no(new Error('ffmpeg: ' + Buffer.concat(err).toString().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 200))); });
    p.stdin.on('error', () => {}); p.stdin.end(input); });
}
const mp3 = (input, extra) => run(['-hide_banner', '-i', 'pipe:0', '-vn', '-map_metadata', '-1', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', ...extra, '-f', 'mp3', 'pipe:1'], input);

export async function prepare(buf) {
  if (!(await ffmpegOn())) return null;
  const hi = await mp3(buf, ['-ac', '2', '-ar', '44100', '-b:a', '128k']);
  const lite = await mp3(hi.out, ['-ac', '1', '-ar', '32000', '-b:a', '48k']);
  // read from a pipe, ffmpeg can't know the length up front; its last progress line says how much it encoded
  const ts = [...hi.log.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop(), dur = ts ? Number(ts[1]) * 3600 + Number(ts[2]) * 60 + Number(ts[3]) : 0;
  return { hi: hi.out, lite: lite.out, dur };
}
