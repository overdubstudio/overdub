// LiveRoomBench: how the live room's ear does on real playing (docs/research/LIVE-ROOM-MODE.md §11.3, §13; stream B
// makes it the read's bench). Your own DI recordings, read locally, through the room's ear: the note finder as
// core/liveroom/places.js earOf sets it (input/onsets.js). The audio never leaves the folder, and no recording is ever
// committed. Gates nothing.
//
//   node tools/liveroom-bench.js --dir <folder> [--list]
//     <name>.wav    a DI: the guitar straight into the interface, before any amp or pedal; PCM or float, any rate
//                   (more than one channel: their mean)
//     --list        every note it heard: the time, the pitch (or unpitched: a muted chug)
//
// Per clip: its length, the notes heard, how many had no pitch, and the lowest note (a riff's chugs are within five
// semitones of it: the chug rule, core/liveroom/band.js bandFor).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readWav } from './beat-bench.js';
import { createNoteFinder } from '../app/src/input/onsets.js';
import { earOf } from '../app/src/core/liveroom/places.js';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const noteName = (p) => (p == null ? 'unpitched' : `${NAMES[((Math.round(p) % 12) + 12) % 12]}${Math.floor(Math.round(p) / 12) - 1}`);
const BLOCK = 2048;

// The room's ear, offline: blocks of a mono DI in, its notes out ({ t (s), p (MIDI, null unpitched) })
export function hearClip(x, sr) {
  const finder = createNoteFinder(earOf(sr)), notes = [];
  for (let f0 = 0; f0 < x.length; f0 += BLOCK) {
    for (const e of finder.push(x.subarray(f0, Math.min(x.length, f0 + BLOCK)), f0)) notes.push({ t: e.f / sr, p: e.p ?? null });
  }
  return { notes, seconds: x.length / sr };
}

function benchDir(dir, { list = false } = {}) {
  const files = fs.readdirSync(dir).filter((f) => /\.wav$/i.test(f)).sort();
  if (!files.length) { console.log(`no .wav files in ${dir}`); return; }
  console.log('clip'.padEnd(30) + 'seconds  notes  unpitched  lowest');
  for (const f of files) {
    const w = readWav(fs.readFileSync(path.join(dir, f)));
    const x = new Float32Array(w.channels[0].length);
    for (const c of w.channels) for (let i = 0; i < x.length; i++) x[i] += c[i] / w.channels.length;
    const res = hearClip(x, w.sr);
    const pitched = res.notes.filter((n) => n.p != null);
    const low = pitched.length ? pitched.reduce((m, n) => Math.min(m, n.p), Infinity) : null;
    console.log(f.slice(0, 29).padEnd(30) + res.seconds.toFixed(1).padEnd(9) + String(res.notes.length).padEnd(7) + String(res.notes.length - pitched.length).padEnd(11) + (low == null ? '-' : noteName(low)));
    if (list) for (const n of res.notes) console.log(`    ${n.t.toFixed(3).padStart(8)} s  ${noteName(n.p)}`);
  }
}

/* ------------------------------------------------------------------ the command line */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  if (!process.argv.includes('--dir')) console.log('usage: node tools/liveroom-bench.js --dir <folder of DI .wav files> [--list]');
  else benchDir(arg('--dir'), { list: process.argv.includes('--list') });
}
