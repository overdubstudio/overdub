// LiveRoomBench: how the live room's read does (docs/research/LIVE-ROOM-MODE.md §4.2, §4.7, §11.3, §13). Not a suite:
// it gates nothing, and prints the numbers the read's thresholds are argued from.
//
//   node tools/liveroom-bench.js                 the read on every fixture: fake.js's riffs (chugs, chords, tremolo at
//                                                90, 132, 160 and 200 BPM in E standard, drop C and B standard, ±10 ms
//                                                of jitter, 8 ms of latency error) and the DI Box fixtures
//                                                (tools/fixtures/metal-di), then the pair's thresholds; then AJ's own
//                                                DIs in tools/.out/liveroom-di/ when they're there
//   node tools/liveroom-bench.js --dir <folder>  the DIs in a folder only
//   --list                                       every note each DI read: its beat, pitch (or unpitched) and ms
//
// A DI is <name>.wav (the guitar straight into the interface, before any amp or pedal; PCM or float, any rate; more
// than one channel: their mean). What the read needs to place it, the tempo and the part's 1, comes from
// <name>.json beside it ({ tempo, start (seconds to bar 1), bars, grid, place }), or from the name ("chug@132.wav":
// 132 BPM, bar 1 at 0 s, as many bars as it runs); a DI with neither is only heard (the room's ear's notes). A
// <name>.json with "played": [{ t (beats from bar 1), p (MIDI), d (beats), mute }] is scored as the fixtures are.
// The audio never leaves the folder, and no recording is ever committed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readWav } from './beat-bench.js';
import { createNoteFinder } from '../app/src/input/onsets.js';
import { earOf } from '../app/src/core/liveroom/places.js';
import { readTake } from '../app/src/core/liveroom/read.js';
import { LIMIT_MS, BASEMENT_MS, TIGHT_MS, UNMATCHED, MATCH_MS } from '../app/src/core/liveroom/tight.js';
import { readFixtures, diBoxFixtures, scoreRead } from './liveroom/band-scene.js';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const noteName = (p) => (p == null ? 'unpitched' : `${NAMES[((Math.round(p) % 12) + 12) % 12]}${Math.floor(Math.round(p) / 12) - 1}`);
const BLOCK = 2048;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const AJ = path.join(HERE, '.out', 'liveroom-di');

// The room's ear, offline: blocks of a mono DI in, its notes out ({ t (s), p (MIDI, null unpitched) })
export function hearClip(x, sr) {
  const finder = createNoteFinder(earOf(sr)), notes = [];
  for (let f0 = 0; f0 < x.length; f0 += BLOCK) {
    for (const e of finder.push(x.subarray(f0, Math.min(x.length, f0 + BLOCK)), f0)) notes.push({ t: e.f / sr, p: e.p ?? null });
  }
  return { notes, seconds: x.length / sr };
}

const pct = (x) => `${(x * 100).toFixed(0)}%`.padStart(5);
function row(x) {
  return `${x.kind.padEnd(18)}${String(x.bpm).padEnd(6)}${x.tuning.padEnd(12)}${`${x.ok}/${x.n}`.padStart(8)} ${pct(x.kick)}${String(x.wrong).padStart(7)}${`${x.roots}/${x.beats}`.padStart(9)}${String(x.key ?? '-').padStart(6)}${String(x.want).padStart(6)}${String(x.read.lean ?? '-').padStart(7)}${String(x.read.cents ?? '-').padStart(7)}${(x.read.thin ? ' thin' : '').padEnd(6)}${String(x.ms).padStart(7)}`;
}
const HEAD = `${'riff'.padEnd(18)}${'bpm'.padEnd(6)}${'tuning'.padEnd(12)}${'kick'.padStart(8)} ${'on'.padStart(5)}${'wrong'.padStart(7)}${'roots'.padStart(9)}${'key'.padStart(6)}${'want'.padStart(6)}${'lean'.padStart(7)}${'cents'.padStart(7)}${''.padEnd(6)}${'ms'.padStart(7)}`;

function fixtures() {
  console.log('The read on the fixtures (kick: chugs with the kick within 15 ms of where they were played; wrong: kicks on a note that isn\'t a chug; roots: beats on the played root; key: the read root and the played; lean: the median chug offset, ms; cents: the median tuning)');
  console.log(HEAD);
  const rows = [...readFixtures(), ...diBoxFixtures()];
  for (const x of rows) console.log(row(x));
  const syn = rows.filter((x) => !/DI Box/.test(x.kind));
  const all = (k) => syn.reduce((s, x) => s + x[k], 0);
  console.log(`fake.js riffs together: the kick on ${pct(all('ok') / all('n'))} of chugs, ${all('wrong')} wrong, the root on ${pct(all('roots') / all('beats'))} of beats, the key's root right on ${syn.filter((x) => x.key === x.want).length} of ${syn.length}`);
  console.log(`(the suite holds each fake.js riff to 95% of chugs, none wrong, 90% of roots and the key: tools/liveroom/checks-band.js. The DI Box fixtures' attacks are soft and their palm mutes masked by the chords before them; they're here to watch, not held)`);
  console.log(`\nThe pair (core/liveroom/tight.js): matched within ${MATCH_MS} ms; a bar drifts over ${LIMIT_MS} ms (or a quarter of a sixteenth, whichever is less; ${BASEMENT_MS} at the basement) or with more than ${UNMATCHED * 100}% of its attacks unmatched; tight when every bar is within ${TIGHT_MS} ms`);
}

function dirOf(dir, { list = false } = {}) {
  const files = fs.readdirSync(dir).filter((f) => /\.wav$/i.test(f)).sort();
  if (!files.length) { console.log(`no .wav files in ${dir}`); return; }
  console.log(`\nThe DIs in ${dir}`);
  for (const f of files) {
    const w = readWav(fs.readFileSync(path.join(dir, f)));
    const x = new Float32Array(w.channels[0].length);
    for (const c of w.channels) for (let i = 0; i < x.length; i++) x[i] += c[i] / w.channels.length;
    const side = path.join(dir, f.replace(/\.wav$/i, '.json'));
    let o = fs.existsSync(side) ? JSON.parse(fs.readFileSync(side, 'utf8')) : null;
    const at = /@(\d{2,3})(?:\D|$)/.exec(f);
    if (!o && at) o = { tempo: +at[1], start: 0 };
    if (!o || !Number.isFinite(o.tempo)) {
      const res = hearClip(x, w.sr), pitched = res.notes.filter((n) => n.p != null);
      const low = pitched.length ? pitched.reduce((m, n) => Math.min(m, n.p), Infinity) : null;
      console.log(`${f}: ${res.seconds.toFixed(1)} s, ${res.notes.length} notes heard, ${res.notes.length - pitched.length} unpitched, the lowest ${low == null ? '-' : noteName(low)} (no tempo: name it <name>@<bpm>.wav or give it a .json to read it)`);
      if (list) for (const n of res.notes) console.log(`    ${n.t.toFixed(3).padStart(8)} s  ${noteName(n.p)}`);
      continue;
    }
    const spb = 60 / o.tempo, start = o.start || 0, bars = o.bars || Math.floor((x.length / w.sr - start) / spb / 4);
    const t0 = Date.now(), read = readTake(x, w.sr, { tempo: o.tempo, start, bars, grid: o.grid || 4, place: o.place || 'metal' }), ms = Date.now() - t0;
    const roots = read.roots.map((r) => (r == null ? '-' : NAMES[r])).join(' ');
    console.log(`${f}: ${bars} bars at ${o.tempo}, read in ${ms} ms: ${read.notes.length} notes on the grid (${read.notes.filter((n) => n.p == null).length} unpitched), ${read.chugs.length} chugs, the lowest ${noteName(read.low)}, the key ${read.key ? NAMES[read.key.root] + ' ' + read.key.scale : '-'}, lean ${read.lean ?? '-'} ms, tuning ${read.cents ?? '-'} cents${read.thin ? ', thin' : ''}`);
    console.log(`    roots by beat: ${roots}`);
    if (Array.isArray(o.played)) {
      const played = o.played.map((n) => ({ s: start + n.t * spb, g: Math.round(n.t * 4) / 4, p: n.p, d: n.d, mute: !!n.mute }));
      const sc = scoreRead(read, played, { bpm: o.tempo, start, beats: bars * 4 });
      console.log(`    against what was played: the kick on ${sc.ok} of ${sc.n} chugs (${pct(sc.kick).trim()}), ${sc.wrong} wrong, the root on ${sc.roots} of ${sc.beats} beats, the key's root ${sc.key} (played ${sc.want})`);
    }
    if (list) for (const n of read.notes) console.log(`    beat ${String(n.t).padStart(6)}  ${noteName(n.p).padEnd(10)} ${String(n.ms).padStart(6)} ms  ${n.db} dB`);
  }
}

/* ------------------------------------------------------------------ the command line */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const list = process.argv.includes('--list');
  if (process.argv.includes('--dir')) dirOf(arg('--dir'), { list });
  else {
    fixtures();
    if (fs.existsSync(AJ)) dirOf(AJ, { list });
    else console.log(`\n(no DIs of your own in ${path.relative(process.cwd(), AJ) || AJ}: put .wav files there to read them)`);
  }
}
