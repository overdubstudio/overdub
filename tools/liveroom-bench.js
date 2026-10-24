// LiveRoomBench: how the live room's ear does on real playing. Your own DI recordings, read locally, through the room's
// ear (the note finder as core/liveroom.js earOf sets it, input/onsets.js) and its "play it twice" (findRiff, fitsRiff,
// nextEntry), with the room's own timing (ui/liveroom.js onNote and frame: the band is planned when a riff is heard,
// called off by two notes that don't fit or 2.2 s of nothing, committed COMMIT_S before its way in, and out again a
// bar and 0.3 s after you stop). The audio never leaves the folder, and no recording is ever committed. Gates nothing.
//
//   node tools/liveroom-bench.js --dir <folder> [--place metal|basement|bluesbar] [--latency 0.02] [--list]
//     <name>.wav    a DI: the guitar straight into the interface, before any amp or pedal; PCM or float, any rate
//                   (more than one channel: their mean)
//     <name>.json   where there is one, what was played, to score against:
//                     { "place": "metal", "riff": 31.2, "bpm": 132, "one": 31.2 }
//                   riff: the time (s) the riff starts (before it, noodling); bpm: its tempo; one: the time of one of its
//                   1s (a downbeat). { "riff": null }: no riff in it at all, so every time the band comes in is a false
//                   entry. place (else --place, else metal) sets the tempo the room reads a riff at.
//     --latency     the round trip the room plans the band's way in with (s; default 0.02)
//     --list        every event: heard, called off, in, out
//
// Per clip: how many notes it heard, each time the band came in, and, against the labels, the first time it came in on
// the riff (which pass, its tempo against the label's, its way in against the nearest true bar line) and the false
// entries before it. Then the totals: riffs the band came in on, the median pass, and false entries per hour of
// noodling (the time before each riff, and the whole of a clip with no riff).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readWav } from './beat-bench.js';
import { createNoteFinder } from '../app/src/input/onsets.js';
import { earOf, findRiff, fitsRiff, nextEntry, pcName, placeOf } from '../app/src/core/liveroom.js';

const COMMIT_S = 0.35, BLOCK = 2048, LOUD_DB = -42;
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

// The room, offline: blocks of a mono DI in, the room's events out
export function hearClip(x, sr, { place = 'metal', latency = 0.02 } = {}) {
  const finder = createNoteFinder(earOf(sr)), ev = [];
  let onsets = [], phase = 'idle', riff = null, entry = null, misses = 0, lastNote = -Infinity, lastLoud = -Infinity, notes = 0;
  const off = (t, why) => { ev.push({ kind: 'off', t, why, n: riff?.n, bpm: riff?.bpm }); phase = 'idle'; riff = null; entry = null; misses = 0; onsets = []; };
  for (let f0 = 0; f0 < x.length; f0 += BLOCK) {
    const blk = x.subarray(f0, Math.min(x.length, f0 + BLOCK)), now = (f0 + blk.length) / sr + 0.005;
    let pk = 0;
    for (let i = 0; i < blk.length; i++) pk = Math.max(pk, Math.abs(blk[i]));
    if (20 * Math.log10(pk + 1e-9) > LOUD_DB) lastLoud = now;
    for (const e of finder.push(blk, f0)) {
      const o = { t: e.f / sr, p: e.p, ps: e.ps };
      notes++; lastNote = o.t;
      onsets.push(o);
      if (onsets.length > 600) onsets.splice(0, 200);
      if (phase === 'heard') { if (!fitsRiff(riff, o) && ++misses >= 2) off(now, 'two notes that don’t fit'); continue; }
      if (phase !== 'idle') continue;
      const r = findRiff(onsets, { place });
      const e2 = r && nextEntry(r, now, { lead: latency + COMMIT_S + 0.1 });
      if (e2) { riff = r; entry = { ...e2, at: e2.t - latency }; misses = 0; phase = 'heard'; ev.push({ kind: 'heard', t: now, n: r.n, bpm: r.bpm, root: r.root, t0: r.t0 }); }
    }
    if (phase === 'heard' && now >= entry.at - COMMIT_S) { phase = 'band'; ev.push({ kind: 'in', t: entry.t, beat: entry.beat, n: riff.n, bpm: riff.bpm, root: riff.root, t0: riff.t0, period: riff.period, heard: ev[ev.length - 1].t }); }
    else if (phase === 'heard' && now - lastNote > 2.2) off(now, 'stopped');
    else if (phase === 'band' && now > entry.t && now - Math.max(lastNote, lastLoud) > (4 * 60) / riff.bpm + 0.3) { ev.push({ kind: 'out', t: now }); phase = 'idle'; riff = null; entry = null; onsets = []; }
  }
  return { events: ev, notes, seconds: x.length / sr };
}

// Against the labels: the false entries before the riff, and the first entry on it
export function scoreClip(res, label) {
  const ins = res.events.filter((e) => e.kind === 'in');
  if (!label || label.riff === undefined) return { ins };
  const riffAt = label.riff == null ? Infinity : label.riff;
  const out = { ins, falses: ins.filter((e) => e.t < riffAt).length, noodle: Math.min(riffAt, res.seconds), riff: label.riff != null };
  const hit = ins.find((e) => e.t >= riffAt);
  if (label.riff != null && hit) {
    out.hit = { pass: Math.round((hit.t - riffAt) / hit.period), bpm: hit.bpm, n: hit.n };
    if (label.bpm) { const k = hit.bpm / label.bpm; out.hit.tempo = Math.abs(k - 2) < 0.08 ? 'double time' : Math.abs(k - 0.5) < 0.04 ? 'half time' : `${((k - 1) * 100).toFixed(1)}%`; }
    if (label.bpm && Number.isFinite(label.one)) { const bar = (4 * 60) / label.bpm, k = Math.round((hit.t - label.one) / bar); out.hit.ms = (hit.t - (label.one + k * bar)) * 1000; }
  }
  return out;
}

function benchDir(dir, { place = null, latency = 0.02, list = false } = {}) {
  const files = fs.readdirSync(dir).filter((f) => /\.wav$/i.test(f)).sort();
  if (!files.length) { console.log(`no .wav files in ${dir}`); return; }
  console.log('clip'.padEnd(30) + 'place      notes  in  false  on the riff');
  let riffs = 0, hits = 0, falses = 0, noodle = 0;
  const passes = [], errs = [];
  for (const f of files) {
    const w = readWav(fs.readFileSync(path.join(dir, f)));
    const x = new Float32Array(w.channels[0].length);
    for (const c of w.channels) for (let i = 0; i < x.length; i++) x[i] += c[i] / w.channels.length;
    const jf = path.join(dir, f.replace(/\.wav$/i, '.json'));
    const label = fs.existsSync(jf) ? JSON.parse(fs.readFileSync(jf, 'utf8')) : null;
    const pl = placeOf(label?.place || place || 'metal').id;
    const res = hearClip(x, w.sr, { place: pl, latency }), s = scoreClip(res, label);
    let on = label ? (label.riff == null ? '(no riff)' : 'never came in') : '(no labels)';
    if (s.hit) on = `pass ${s.hit.pass}, ${s.hit.n} beats at ${s.hit.bpm}${s.hit.tempo ? ` (${s.hit.tempo})` : ''}${s.hit.ms != null ? `, ${s.hit.ms >= 0 ? '+' : ''}${s.hit.ms.toFixed(0)} ms from the bar line` : ''}`;
    console.log(f.slice(0, 29).padEnd(30) + pl.padEnd(11) + String(res.notes).padEnd(7) + String(s.ins.length).padEnd(4) + String(s.falses ?? '-').padEnd(7) + on);
    if (list) for (const e of res.events) console.log(`    ${e.t.toFixed(2).padStart(7)} s  ${e.kind.padEnd(5)} ${e.kind === 'off' ? e.why : e.kind === 'out' ? '' : `${e.n} beats at ${e.bpm} in ${pcName(e.root)}, the 1 at ${e.t0.toFixed(2)} s${e.kind === 'in' ? `, on beat ${e.beat}` : ''}`}`);
    if (s.falses != null) { falses += s.falses; noodle += s.noodle; }
    if (s.riff) { riffs++; if (s.hit) { hits++; passes.push(s.hit.pass); if (s.hit.ms != null) errs.push(Math.abs(s.hit.ms)); } }
  }
  if (riffs) console.log(`\nthe band came in on ${hits} of ${riffs} riffs${passes.length ? `, on pass ${median(passes)} (the median)` : ''}${errs.length ? `, ${median(errs).toFixed(0)} ms from the bar line (the median)` : ''}`);
  if (noodle > 0) console.log(`false entries: ${falses} in ${(noodle / 60).toFixed(1)} min of noodling (${((falses / noodle) * 3600).toFixed(1)} an hour)`);
}

/* ------------------------------------------------------------------ the command line */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  if (!process.argv.includes('--dir')) console.log('usage: node tools/liveroom-bench.js --dir <folder of DI .wav files> [--place metal] [--latency 0.02] [--list]');
  else benchDir(arg('--dir'), { place: arg('--place', null), latency: Number(arg('--latency', 0.02)), list: process.argv.includes('--list') });
}
