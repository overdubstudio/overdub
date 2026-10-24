// The live room [liveroom]: core/liveroom.js, ui/liveroom.js and ui/liveroom-pixels.js (a prototype: /app/?room).
//   1. play it twice: a riff found in what was played, with its tempo, its 1 and its root (a two-bar metal riff, a
//      punk bar, a boogie, a two-beat shuffle, a varied last beat, quarter strums; drift, jitter and noodling first),
//      and nothing found in noodling; a four-bar riff first heard as one bar is called off (two notes that don't fit)
//      and then heard whole; the band's way in is on a bar line, after two passes; tap the 1: two taps on a riff's 1
//      make it a riff (snapped to its notes; its tempo from the pass before when there is one)
//   2. the band: the metal club's kick on the riff's chugs and its bass on the riff an octave down; the blues bar's
//      bass through the twelve-bar (I, IV, V); the same band for the same riff and seed; one dispatch's ops that land;
//      a tapped riff with no notes heard gets the groove's own kick and the bass on the root
//   3. the amp: every one of its settings as loud as Modern, and each place's first breaking up at a moderate input;
//      the levels: each place's band against a reference DI (its own riff, peaks at -12 dBFS, as an interface brings a
//      guitar in) through the place's first rig at LIVE_DB, by the canonical renderer: the guitar 3 dB over the band,
//      the drums 3 dB over the bass (PLACES gain; the numbers to set them to are printed)
//   4. the room in the page with a fake guitar playing the metal riff: what you bring, where, the soundcheck (the
//      Guitar track signed you, on the place's rig, armed), the room hears the riff and the band comes in on a bar line
//      (a preview: nothing in History), Space lands the take (yours from bar 1, the house band's from where it came
//      in), the control room has it (a Live room key on the top bar, before Song, goes back), and Give me a beat and
//      Esc leave the song as it was
//   5. a fake guitar that stops: the band finishes the bar with you and the take waits; leaving for the control room
//      keeps it, the drums to where the band stopped
//   6. a fake guitar the room doesn't call a riff (its fills change every pass): after a while it says how to tap it
//      in, once; T on its 1, twice (the real key, on time), and the band comes in on the next pass at its tempo; Esc
//      and it's gone
//   7. no page errors
// usage: node tools/liveroom-test.js     (screenshots: tools/.out/liveroom-*.png; LEVELS=0 skips the level renders;
//        PAGES=0 runs 1 to 3 only, in Node, with no browser)
import { open, tally, OUTDIR } from './pw.js';
import path from 'node:path';
import { writeWav } from './fake-wav.js';
import { PLACES, PLACE_IDS, findRiff, riffFromTaps, fitsRiff, nextEntry, bandFor, bandOps, AMP, RIGS, rigChain, rigLabel } from '../app/src/core/liveroom.js';
import { createStore } from '../app/src/core/store.js';
import { createProject } from '../app/src/core/project.js';
import '../app/src/devices/builtin/index.js';
import { getDevice } from '../app/src/devices/registry.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { measure, lufs } from '../app/src/audio/measure.js';
import { run, metalDI } from './amp-scenes.js';

const T = tally('liveroom');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g|the server responded with a status of 404/.test(e);
const step = async (name, fn) => { try { await fn(); } catch (e) { T.ok(false, `${name}: ${String(e && e.message || e).split('\n')[0].slice(0, 200)}`); } };
const SR = 48000, LIVE_DB = 6, REF_PEAK = -12;

/* ------------------------------------------------------------------------------------------------ riffs */
// [beat, midi, held beats (0: a palm-muted chug)]
const RIFFS = {
  metal: { place: 'metal', bpm: 132, beats: 8, root: 4, chord: true, notes: [[0, 40], [0.25, 40], [0.75, 40], [1, 43, 0.5], [1.5, 40], [2, 40], [2.25, 40], [2.75, 40], [3, 45, 0.5], [3.5, 40], [4, 40], [4.25, 40], [4.75, 40], [5, 43, 0.5], [5.5, 40], [6, 46, 0.5], [6.5, 45, 0.5], [7, 43, 1]] },
  punk: { place: 'basement', bpm: 180, beats: 4, root: 4, chord: true, notes: [[0, 40, 0.45], [0.5, 40, 0.45], [1, 40, 0.45], [1.5, 40, 0.45], [2, 45, 0.45], [2.5, 45, 0.45], [3, 43, 0.45], [3.5, 43, 0.45]] },
  boogie: { place: 'bluesbar', bpm: 96, beats: 4, root: 4, chord: false, notes: [[0, 40, 0.6], [2 / 3, 44, 0.3], [1, 47, 0.6], [5 / 3, 49, 0.3], [2, 50, 0.6], [8 / 3, 49, 0.3], [3, 47, 0.6], [11 / 3, 44, 0.3]] },
  // single notes, the only E its 1 (so a test can find the 1s in what the room heard)
  sloppy: { place: 'metal', bpm: 132, beats: 8, root: 4, chord: false, notes: [[0, 40, 0.5], [0.5, 43], [0.75, 43], [1, 45, 0.5], [1.5, 43], [2, 46, 0.5], [2.5, 45], [3, 43, 1], [4, 47, 0.5], [4.5, 45], [5, 43, 0.5], [5.5, 45], [6, 50, 0.5], [6.5, 48, 0.5], [7, 47, 1]] },
  // a skeleton (the only E its 1) with fills from `fill` that change every pass (riffAudio's fills)
  loose: { place: 'metal', bpm: 132, beats: 8, root: 4, chord: false, notes: [[0, 40, 0.5], [1, 45, 0.5], [2, 46, 0.5], [3, 43, 1], [4, 47, 0.5], [6, 50, 0.5], [7, 47, 1]], fill: [43, 45, 46, 47, 48, 50] },
};
function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
// played onsets: passes of a riff, with jitter (ms), drift (a fraction of the beat per pass) and noodling first
function play(riff, { passes = 3, start = 1, jitter = 12, drift = 0, noodle = 0, seed = 7 } = {}) {
  const r = rng(seed), jit = (ms) => ((r() * 2 - 1) * ms) / 1000, out = [];
  let t = start;
  for (let i = 0; i < noodle; i++) out.push({ t: t + i * 0.37 + jit(30), p: 40 + Math.floor(r() * 24) });
  if (noodle) t += noodle * 0.37 + 0.2;
  for (let k = 0; k < passes; k++) {
    const spb = (60 / riff.bpm) * (1 + drift * k);
    for (const [b, p] of riff.notes) out.push({ t: t + b * spb + jit(jitter), p });
    t += riff.beats * spb;
  }
  return out.sort((a, b) => a.t - b.t);
}
// the riff the room would hear first: onsets fed one at a time, as they come in
function hear(onsets, place) {
  for (let i = 4; i <= onsets.length; i++) { const r = findRiff(onsets.slice(0, i), { place }); if (r) return { r, i, now: onsets[i - 1].t + 0.05 }; }
  return null;
}
// the room's loop: heard -> waiting for its way in; two notes that don't fit call it off; the way in commits it
function room(onsets, place) {
  let pending = null, misses = 0;
  const log = [];
  for (let i = 1; i <= onsets.length; i++) {
    const now = onsets[i - 1].t + 0.05;
    if (pending && now >= pending.e.t - 0.35) { log.push({ commit: true, r: pending.r, e: pending.e }); break; }
    if (pending) { if (!fitsRiff(pending.r, onsets[i - 1]) && ++misses >= 2) { log.push({ off: true, n: pending.r.n }); pending = null; } continue; }
    const r = findRiff(onsets.slice(0, i), { place });
    if (r) { const e = nextEntry(r, now, { lead: 0.3 }); if (e) { pending = { r, e }; misses = 0; log.push({ heard: true, n: r.n }); } }
  }
  return log;
}

{
  const near = (a, b, d) => Math.abs(a - b) <= d;
  const M = RIFFS.metal, cases = [
    ['a two-bar metal riff at 132', play(M), 'metal', 8, 132],
    ['with 2% drift a pass', play(M, { drift: 0.02 }), 'metal', 8, null],
    ['after ten noodled notes', play(M, { passes: 4, noodle: 10 }), 'metal', 8, 132],
    ['with 25 ms jitter', play(M, { jitter: 25 }), 'metal', 8, 132],
    ['a punk bar at 180', play(RIFFS.punk, { passes: 4 }), 'basement', 4, 180],
    ['a boogie at 96', play(RIFFS.boogie), 'bluesbar', 4, 96],
    ['a two-beat shuffle at 96', play({ bpm: 96, beats: 2, notes: [[0, 40], [2 / 3, 40], [1, 40], [5 / 3, 40]] }, { passes: 6 }), 'bluesbar', 2, 96],
    ['a bar whose last beat varies, at 120', play({ bpm: 120, beats: 4, notes: [[0, 45], [0.5, 45], [1, 45], [1.5, 47], [2, 45], [2.5, 45], [3, 45], [3.5, 48]] }), 'metal', 4, 120],
    ['quarter strums at 120', play({ bpm: 120, beats: 4, notes: [[0, 40], [1, 40], [2, 40], [3, 40]] }, { passes: 4 }), 'metal', null, 120],
  ];
  for (const [name, o, place, n, bpm] of cases) {
    const h = hear(o, place);
    T.ok(h && (n == null || h.r.n === n) && (bpm == null || near(h.r.bpm, bpm, 1.5)) && (h.r.root === 4 || h.r.root === 9 || n == null),
      `play it twice: ${name} is heard${h ? ` (${h.r.n} beats at ${h.r.bpm}, root ${h.r.root}, at note ${h.i} of ${o.length})` : ': nothing heard'}`);
  }
  const r = rng(3), noodle = [], penta = [];
  let t = 1, u = 1;
  for (let i = 0; i < 80; i++) { t += 0.15 + r() * 0.45; noodle.push({ t, p: 40 + Math.floor(r() * 20) }); }
  for (let i = 0; i < 80; i++) { u += 0.2 + Math.floor(r() * 3) * 0.2273; penta.push({ t: u, p: [40, 43, 45, 47][Math.floor(r() * 4)] }); }
  T.ok(!hear(noodle, 'metal') && !hear(penta, 'metal'), 'noodling is never a riff (80 notes anywhere, 80 on a pentatonic in eighths)');
  // the way in: on a bar line, after two passes, the lead from now
  const h = hear(play(M), 'metal'), e = h && nextEntry(h.r, h.now, { lead: 0.3 });
  T.ok(e && e.beat % 4 === 0 && e.pass >= 2 && e.t - h.now >= 0.3, `the band comes in on a bar line after two passes (beat ${e?.beat}, pass ${e?.pass}, ${e ? (e.t - h.now).toFixed(2) : '?'} s after it heard it)`);
  const fits = (() => { const o = play(M, { passes: 4 }), hh = hear(o, 'metal'); return o.slice(hh.i, hh.i + 8).every((x) => fitsRiff(hh.r, x)); })();
  T.ok(fits, 'the riff\'s next notes fit it (nothing calls the band off while you keep playing it)');
  const four = { bpm: 100, beats: 16, notes: [[0, 40], [1, 40], [1.5, 43], [2, 45], [3, 43], [4, 40], [5, 40], [5.5, 43], [6, 46], [7, 45], [8, 40], [9, 40], [9.5, 43], [10, 45], [11, 43], [12, 48], [13, 47], [14, 45], [15, 43]] };
  const log = room(play(four, { passes: 4 }), 'metal'), last = log[log.length - 1];
  T.ok(last?.commit && last.r.n === 16 && near(last.r.bpm, 100, 1), `a four-bar riff: ${log.map((x) => (x.commit ? `in at beat ${x.e.beat} (${x.r.n} beats at ${x.r.bpm})` : x.off ? `called off (${x.n} beats)` : `heard ${x.n} beats`)).join(', ')}`);

  // tap the 1: a pass and a bit isn't a riff by ear yet; two taps a few tens of ms off its 1 and the next one are
  const spb = 60 / 132, one = play(M, { passes: 2 }).filter((x) => x.t < 1 + 8 * spb + 0.2);
  const tr = riffFromTaps(one, [one[0].t + 0.04, 1 + 8 * spb - 0.03], { place: 'metal' });
  T.ok(!hear(one, 'metal') && tr?.tapped && tr.n === 8 && near(tr.bpm, 132, 1.5) && tr.root === 4 && tr.t0 === one[0].t && tr.notes.length === M.notes.length,
    `tap the 1: a pass and a bit of the metal riff isn't heard yet; two taps 30-40 ms off its 1s make it ${tr ? `${tr.n} beats at ${tr.bpm}, root ${tr.root}, ${tr.notes.length} notes, the 1 on its first note` : 'nothing'}`);
  T.ok(!riffFromTaps(one, [1, 1.4], { place: 'metal' }) && !riffFromTaps(one, [1, 12], { place: 'metal' }), 'taps 0.4 s or 11 s apart are no riff');
  // a sloppy player (every note within 60 ms): the tempo from every note of the tapped pass against the pass before,
  // over 40 players
  const errs = [], alone = [];
  for (let seed = 1; seed <= 40; seed++) {
    const o = play(RIFFS.sloppy, { passes: 6, jitter: 60, seed }), ones = o.filter((x) => x.p === 40).map((x) => x.t);
    const w = riffFromTaps(o, [ones[1] + 0.02, ones[2] - 0.03], { place: 'metal' });
    errs.push(Math.abs(w.bpm - 132) / 1.32);
    alone.push(Math.abs(480 / (ones[2] - ones[1]) - 132) / 1.32);
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  T.ok(mean(errs) <= 0.5 && mean(errs) < mean(alone) / 2, `tap the 1 on a sloppy riff (notes within 60 ms, played before the taps too): the tempo ${mean(errs).toFixed(2)}% off on average over 40 players, ${Math.max(...errs).toFixed(2)}% at worst (the two 1s alone: ${mean(alone).toFixed(2)}%, ${Math.max(...alone).toFixed(2)}%)`);
}

/* ------------------------------------------------------------------------------------------------ the band */
{
  const hm = hear(play(RIFFS.metal), 'metal').r, b = bandFor('metal', hm, { from: 16, length: 32, seed: 7 });
  const kicks = b.drums.filter((x) => x.p === 36 && x.t < 8).map((x) => x.t), chugs = hm.notes.filter((x) => x.p == null || x.p <= 45).map((x) => x.t);
  T.ok(chugs.every((t) => kicks.some((k) => Math.abs(k - t) < 0.02)) && kicks.length === chugs.length, `the metal club's kick is on the riff's chugs (${kicks.length} kicks for ${chugs.length} chugs in two bars)`);
  const bass = b.bass.filter((x) => x.t < 8);
  T.ok(bass.length === hm.notes.length && bass.every((x, i) => x.p >= 28 && x.p <= 47 && (hm.notes[i].p == null || (x.p - hm.notes[i].p) % 12 === 0)), `its bass doubles the riff, an octave or two down (${bass.map((x) => x.p).slice(0, 8).join(' ')}…)`);
  const hb = hear(play(RIFFS.boogie), 'bluesbar').r, bb = bandFor('bluesbar', hb, { from: 8, length: 48, seed: 7 });
  const rootOf = (bar) => bb.bass.find((x) => x.t >= bar * 4 - 1e-6)?.p % 12;
  T.ok(rootOf(0) === 4 && rootOf(4) === 9 && rootOf(8) === 11 && rootOf(9) === 9 && rootOf(11) === 11, `the blues bar's bass walks the twelve-bar in E: bars 1, 5, 9, 10, 12 on ${[0, 4, 8, 9, 11].map(rootOf).join(', ')} (E A B A B)`);
  T.ok(JSON.stringify(bandFor('metal', hm, { from: 16, length: 32, seed: 7 })) === JSON.stringify(b), 'the same riff and seed make the same band (no Math.random)');
  const s = createStore(createProject());
  const { ops } = bandOps('metal', hm, { from: 16, length: 32, seed: 7 });
  const res = s.dispatch(ops, { by: 'overdub' }), p = s.get();
  T.ok(res.ok && p.tracks.length === 2 && p.tracks.every((t) => t.clips.length === 1 && t.clips[0].start === 16), `bandOps lands in one dispatch: Drums and Bass, each one clip from beat 16 (${res.ok ? p.tracks.map((t) => t.name).join(', ') : res.error})`);
  const beatOps = bandOps('metal', null, { from: 0, length: 16, count: true, parts: ['drums'] });
  const st = beatOps.band.drums.filter((x) => x.p === 37);
  T.ok(beatOps.ops.length === 2 && st.length === 4 && st.every((x, i) => x.t === i), `Give me a beat: the drums alone, a bar of sticks first (${st.map((x) => x.t).join(' ')})`);
  const bare = bandFor('metal', riffFromTaps([], [1, 1 + 480 / 132], { place: 'metal' }), { from: 16, length: 32, seed: 7 });
  const bk = bare.drums.filter((x) => x.p === 36).length;
  T.ok(bk >= 16 && bare.bass.length >= 32 && bare.bass.every((x) => x.p % 12 === 4), `a tapped riff with no notes heard: the metal club's groove keeps its own kick (${bk} in 8 bars) and the bass plays the root (${bare.bass.length} notes, all E)`);
}

/* ------------------------------------------------------------------------------------------------ audio for the room */
// a riff's DI: plucked strings (Karplus-Strong, seeded), power chords where asked, peaks at REF_PEAK
// (jitter: how far off each note is, s; solid: the 1s right on it; fills: that many notes from riff.fill on its free
// sixteenths, different every pass, never next to the 1)
function riffAudio(riff, passes, { seed = 11, jitter = 0.004, solid = false, fills = 0 } = {}) {
  const r = rng(seed), rnd = () => r() * 2 - 1, spb = 60 / riff.bpm, len = Math.round(passes * riff.beats * spb * SR), buf = new Float32Array(len);
  const pluck = (midi, t, dur, amp, damp) => {
    const N = Math.round(SR / (440 * 2 ** ((midi - 69) / 12))), line = Float32Array.from({ length: N }, () => rnd() * amp);
    const a = Math.round(t * SR), b = Math.min(len, a + Math.round(dur * SR));
    for (let i = a, k = 0; i < b; i++) { const y = line[k]; line[k] = 0.5 * (y + line[(k + 1) % N]) * damp; k = (k + 1) % N; buf[i] += y * (i > b - 480 ? (b - i) / 480 : 1); }
  };
  const onsets = [];
  for (let k = 0; k < passes; k++) for (const [b, p, d] of fills ? withFills(riff, fills, r) : riff.notes) {
    const t = (k * riff.beats + b) * spb + (k + b > 0 && !(solid && b === 0) ? rnd() * jitter : 0), dur = d ? d * spb : 0.18;
    pluck(p, t, dur, 0.4, d ? 0.996 : 0.985);
    if (riff.chord) pluck(p + 7, t + 0.004, dur, 0.25, d ? 0.996 : 0.985);
    onsets.push({ t, p });
  }
  let pk = 0;
  for (let i = 0; i < len; i++) { buf[i] += rnd() * 0.0003; pk = Math.max(pk, Math.abs(buf[i])); }
  const g = 10 ** (REF_PEAK / 20) / pk;
  for (let i = 0; i < len; i++) buf[i] *= g;
  return { buf, onsets: onsets.sort((a, b) => a.t - b.t) };
}
function withFills(riff, n, r) {
  const taken = new Set(riff.notes.map(([b]) => Math.round(b * 4))), free = [], out = [...riff.notes];
  for (let q = 2; q < riff.beats * 4 - 1; q++) if (!taken.has(q)) free.push(q);
  for (let j = 0; j < n && free.length; j++) out.push([free.splice(Math.floor(r() * free.length), 1)[0] / 4, riff.fill[Math.floor(r() * riff.fill.length)]]);
  return out;
}

/* ------------------------------------------------------------------------------------------------ the amp */
// Every setting as loud as Modern on the metal DI fixtures (peaks at REF_PEAK: the two together, the lower gains a little
// louder on one and quieter on the other, as less of their sound is the amp's), and each place's first one breaking up
// at a moderate input: peaks at -24 dBFS, where the Guitar Studio rigs the room started with hardly did. Breakup is the
// share of what comes out that wasn't in what went in (harmonics and intermodulation), on four tones none of whose low
// harmonics or intermodulation products lands near another.
{
  const def = getDevice(AMP), norm = (x, db) => { let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v)); return x.map((v) => (v * 10 ** (db / 20)) / pk); };
  const dis = ['chords', 'chug'].map((k) => norm(metalDI(k), REF_PEAK)), loud = (id, x) => lufs({ sr: SR, channels: [run(def, rigChain(id)[0].params, x)[0]] });
  const off = Object.keys(RIGS).map((id) => ({ id, d: dis.map((x) => loud(id, x) - loud('modern', x)) }));
  T.ok(off.every((o) => Math.abs(o.d[0] + o.d[1]) / 2 <= 0.25 && o.d.every((d) => Math.abs(d) <= 0.75)), `the amp's settings come out as loud as Modern, within a quarter dB on the two DIs together (${off.map((o) => `${RIGS[o.id].name} ${o.d.map((d) => (d >= 0 ? '+' : '') + d.toFixed(1)).join('/')}`).join(', ')} dB)`);
  const F = [82.41, 131.7, 197.3, 613.9], A = [1, 0.8, 0.6, 0.35], N = 32768;
  const tones = norm(Float32Array.from({ length: SR * 2 }, (_, i) => F.reduce((s, f, k) => s + A[k] * Math.sin((2 * Math.PI * f * i) / SR + k), 0)), -24);
  const breakup = (y) => {
    const v = y.subarray(y.length - N), h = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    let wsum = 0, w2 = 0, all = 0, at = 0;
    for (let i = 0; i < N; i++) { wsum += h[i]; w2 += h[i] * h[i]; all += (v[i] * h[i]) ** 2; }
    for (const f of F) {
      let re = 0, im = 0;
      for (let i = 0; i < N; i++) { const q = v[i] * h[i], w = (2 * Math.PI * f * i) / SR; re += q * Math.cos(w); im += q * Math.sin(w); }
      at += ((2 * Math.hypot(re, im)) / wsum) ** 2 / 2 * w2;
    }
    return 1 - at / all;
  };
  const FLOOR = { metal: 0.15, basement: 0.1, bluesbar: 0.05 };
  const br = PLACE_IDS.map((pid) => ({ pid, id: PLACES[pid].rigs[0], b: breakup(run(def, rigChain(PLACES[pid].rigs[0])[0].params, tones)[0]) }));
  T.ok(br.every((x) => x.b >= FLOOR[x.pid]), `each place's amp breaks up with your guitar coming in at -24 dBFS: ${br.map((x) => `${PLACES[x.pid].name.toLowerCase()} (${rigLabel(x.id)}) ${(x.b * 100).toFixed(0)}%, at least ${FLOOR[x.pid] * 100}%`).join('; ')}`);
}

/* ------------------------------------------------------------------------------------------------ the levels */
// each place's band against a reference DI of its own riff through its first rig at LIVE_DB, by the canonical renderer
if (process.env.LEVELS !== '0') {
  for (const k of ['metal', 'punk', 'boogie']) {
    const R = RIFFS[k], { buf, onsets } = riffAudio(R, 4, { seed: 5 }), h = hear(onsets, R.place);
    if (!h) { T.ok(false, `the levels: ${k}'s DI isn't heard as a riff`); continue; }
    const P = PLACES[R.place], spb = 60 / h.r.bpm, seconds = buf.length / SR, to = Math.floor(seconds / spb / 4) * 4, id = 'lr_ref_' + R.place;
    const st = createStore(createProject({ tempo: h.r.bpm }));
    const r0 = st.dispatch([
      { type: 'track.add', ref: 'g', track: { name: 'Guitar', kind: 'audio', inserts: rigChain(P.rigs[0]), gain: LIVE_DB } },
      { type: 'asset.add', asset: { id, kind: 'audio', name: 'DI', sr: SR, channels: 1, duration: seconds } },
      { type: 'clip.add', track: '$g', clip: { kind: 'audio', asset: id, start: 0, length: seconds / spb, offset: 0 } },
    ], { by: 'you' });
    const r1 = st.dispatch(bandOps(R.place, h.r, { from: 0, length: to, seed: 7 }).ops, { by: 'overdub' });
    if (!r0.ok || !r1.ok) { T.ok(false, `the levels in ${P.name.toLowerCase()}: ${r0.error || r1.error}`); continue; }
    const p = st.get(), g = r0.created.g, d = r1.created.drums, b = r1.created.bass, assets = { [id]: { sr: SR, channels: [buf] } };
    const m = (tracks) => measure(renderSong(p, { from: 0, to, tracks, tail: 0.5, assets }));
    const x = { guitar: m([g]).lufs, drums: m([d]).lufs, bass: m([b]).lufs, band: m([d, b]).lufs, tp: m([g, d, b]).truePeak };
    const over = x.guitar - x.band, split = x.drums - x.bass;
    // what the faders would be for 3 dB over and a 3 dB split: drums at guitar - 4.8, bass at guitar - 7.8
    const want = { drums: Math.round((P.gain.drums + (x.guitar - 4.8 - x.drums)) * 2) / 2, bass: Math.round((P.gain.bass + (x.guitar - 7.8 - x.bass)) * 2) / 2 };
    T.ok(Math.abs(over - 3) <= 1 && Math.abs(split - 3) <= 1.5 && x.tp <= 0,
      `${P.name}: your guitar (through ${rigLabel(P.rigs[0])} at +${LIVE_DB} dB, ${x.guitar.toFixed(1)} LUFS) sits ${over.toFixed(1)} dB over the band (${x.band.toFixed(1)}), the drums ${split.toFixed(1)} dB over the bass, the mix ${x.tp.toFixed(1)} dBTP (faders drums ${P.gain.drums}, bass ${P.gain.bass}; measured, they'd be ${want.drums} and ${want.bass})`);
  }
}

if (process.env.PAGES === '0') { T.done(); process.exit(); }

const fake = path.join(OUTDIR, 'liveroom-riff.wav');
writeWav(fake, riffAudio(RIFFS.metal, 8).buf);
const s = await open('/app/?room', { width: 1440, height: 900, fakeAudio: fake });
const { page } = s;
const E = (fn, arg) => page.evaluate(fn, arg);
try {
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });

  /* ---------------------------------------------------------------------------------------------- the room */
  const where = () => E(() => { const R = window.overdub.liveRoom?.state; return R ? { step: R.step, phase: R.phase, open: R.open } : null; });
  await step('what you bring', async () => {
    const w = await where(), up = await E(() => { const el = document.querySelector('.lr'); return !!el && !el.hidden && getComputedStyle(el).display !== 'none'; });
    const cards = await E(() => [...document.querySelectorAll('.lr-things .lr-card')].map((b) => ({ id: b.dataset.thing, off: b.disabled })));
    T.ok(up && w?.step === 'bring' && cards.length === 4 && cards.filter((c) => !c.off).map((c) => c.id).join() === 'electric', `?room opens the live room over the studio: what are you bringing (${cards.map((c) => c.id + (c.off ? ' (not yet)' : '')).join(', ')})`);
    await s.shot('liveroom-bring');
    await page.click('.lr-card[data-thing="electric"]');
    await page.waitForFunction(() => window.overdub.liveRoom.state.step === 'place', null, { timeout: 4000 });
    await sleep(400);
    await s.shot('liveroom-place');
    const places = await E(() => [...document.querySelectorAll('.lr-placecard')].map((b) => b.dataset.place));
    T.ok(places.join() === PLACE_IDS.join(), `where are we playing: ${places.join(', ')}`);
  });
  await step('the soundcheck', async () => {
    await page.click('.lr-placecard[data-place="metal"]');
    await page.waitForFunction(() => window.overdub.liveRoom.state.step === 'check', null, { timeout: 4000 });
    // monitoring on, as an interface's is by itself, and the Jam room the panel open in the control room behind the
    // glass: an input that monitors with no audio track to play through gets the Jam room's own Live guitar
    const jam = await E(() => { const o = window.overdub; o.input.audio.monitor(true); o.ui.show('jam', { save: false }); return o.ui.visible('jam'); });
    await page.locator('.lr-steps button', { hasText: 'Plug in' }).click();
    await page.waitForFunction(() => window.overdub.input.audio.state.open && window.overdub.liveRoom.state.guitar, null, { timeout: 10000 });
    await page.waitForFunction(() => window.overdub.input.audio.monitorTrack(), null, { timeout: 3000 }).catch(() => {});
    const mon = await E(() => { const o = window.overdub, t = o.input.audio.monitorTrack(); return { room: !!t && t.id === o.liveRoom.state.guitar, name: t?.name || null, line: document.querySelector('.lr-steps li .lr-line')?.textContent || '' }; });
    await sleep(1200);
    const g = await E(() => {
      const o = window.overdub, R = o.liveRoom.state, t = o.store.track(R.guitar), last = o.store.history[o.store.history.length - 1];
      const audios = o.store.get().tracks.filter((x) => x.kind === 'audio').map((x) => x.name + (x.arm ? ' (armed)' : ''));
      return { name: t?.name, kind: t?.kind, arm: t?.arm, gain: t?.gain, chain: t?.inserts.map((x) => x.device).join('>'), by: last?.by, label: last?.label, rig: R.rig, open: o.input.audio.state.open, audios, line: document.querySelector('.lr-steps li .lr-line')?.textContent };
    });
    await E(() => window.overdub.input.audio.monitor(false));
    const rig = rigChain(g.rig).map((x) => x.device).join('>');
    T.ok(g.open && g.name === 'Guitar' && g.kind === 'audio' && g.arm && g.gain === LIVE_DB && g.chain === rig && g.by === 'you' && g.rig === PLACES.metal.rigs[0],
      `soundcheck: plugged in, a Guitar track by you on the metal club's first rig (${rigLabel(g.rig)}: ${g.chain}), armed, at +${g.gain} dB ("${g.label}"); "${(g.line || '').slice(0, 70)}"`);
    T.ok(jam && mon.room && /through the Half Stack, set to Modern\./.test(mon.line) && g.audios.join() === 'Guitar (armed)',
      `with the Jam room ${jam ? 'open' : 'NOT open (the check missed its setup)'} behind the glass, your guitar monitors through the room's Guitar and its rig, not a Live guitar of the Jam room's (through ${mon.name}; the song's audio tracks: ${g.audios.join(', ')}); "${mon.line.slice(0, 80)}"`);
    await s.shot('liveroom-check');
    await page.click('.lr-go');
    await page.waitForFunction(() => window.overdub.liveRoom.state.step === 'room', null, { timeout: 4000 });
  });
  await step('the band comes in', async () => {
    const h0 = await E(() => window.overdub.store.history.length);
    const t0 = Date.now();
    let w = null;
    while (Date.now() - t0 < 45000) { w = await where(); if (w.phase === 'band') break; await sleep(250); }
    const info = await E(() => {
      const o = window.overdub, R = o.liveRoom.state, p = o.store.get();
      return { phase: R.phase, n: R.riff?.n, bpm: R.riff?.bpm, root: R.riff?.root, beat: R.entry?.beat, onsets: R.onsets.length, tracks: p.tracks.map((t) => t.name), tempo: p.tempo, h: o.store.history.length, playing: o.engine.playing, status: document.querySelector('.lr-status')?.textContent, said: R.said };
    });
    T.ok(info.phase === 'band' && info.n === 8 && Math.abs(info.bpm - 132) <= 1.5 && info.root === 4 && info.beat % 4 === 0 && info.playing,
      `the room hears the riff and the band comes in: ${info.n} beats at ${info.bpm} in E (root ${info.root}), on beat ${info.beat}, ${((Date.now() - t0) / 1000).toFixed(1)} s in (${info.onsets} notes heard; "${info.status}")`);
    T.ok(info.tracks.join() === 'Guitar,Drums,Bass' && info.h === h0 && info.tempo === info.bpm, `the band is a preview while you play: ${info.tracks.join(', ')} at ${info.tempo} BPM, nothing in History (${info.h - h0} new steps)`);
    await sleep(2500);
    await s.shot('liveroom-room');
  });
  await step('the take', async () => {
    const before = await E(() => ({ h: window.overdub.store.history.length, beat: window.overdub.liveRoom.state.entry?.beat }));
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.overdub.liveRoom.state.step === 'take', null, { timeout: 8000 });
    const t = await E((before) => {
      const o = window.overdub, p = o.store.get(), H = o.store.history, R = o.liveRoom.state;
      const g = p.tracks.find((x) => x.id === R.guitar), c = g?.clips[0];
      return {
        tracks: p.tracks.map((x) => ({ name: x.name, by: x.clips[0]?.by, start: x.clips[0]?.start, length: x.clips[0]?.length, kind: x.clips[0]?.kind })),
        clip: c && { kind: c.kind, start: c.start, offset: c.offset, length: c.length, name: c.name, asset: !!p.assets[c.asset] },
        tempo: p.tempo, key: p.key, steps: H.slice(before.h).map((x) => ({ by: x.by, label: x.label })), playing: o.engine.playing,
        line: document.querySelector('.lr-sub')?.textContent, take: R.take,
      };
    }, before);
    T.ok(t.clip && t.clip.kind === 'audio' && t.clip.start === 0 && t.clip.asset && t.clip.length > 8 && !t.playing, `Space: the take lands on the Guitar track from bar 1 (${t.clip?.name}, ${t.clip?.length.toFixed(1)} beats, offset ${t.clip?.offset} s), the band stops (the song: ${t.tracks.map((x) => x.name).join(', ')})`);
    const d = t.tracks.find((x) => x.name === 'Drums'), b = t.tracks.find((x) => x.name === 'Bass');
    T.ok(d && b && d.start === before.beat && b.start === before.beat && d.length % 4 === 0, `the house band's Drums and Bass from where they came in (beat ${d?.start}) to the end of that bar (${d?.length} beats)`);
    T.ok(t.steps.length === 2 && t.steps[0].by === 'you' && t.steps[1].by === 'overdub' && Math.abs(t.tempo - 132) <= 1.5 && t.key?.root === 'E' && t.key?.scale === 'minor',
      `two undo steps, yours then the house's (${t.steps.map((x) => `${x.by}: "${x.label}"`).join('; ')}); the song at ${t.tempo} BPM in ${t.key?.root} ${t.key?.scale}`);
    const head = await E(() => document.querySelector('.lr-h')?.textContent);
    T.ok(head === 'Take 1 is in.' && /^\d+ bars at 13\d in E\. Your guitar from bar 1, the band from bar \d+\.$/.test(t.line || ''), `the tape box says what was recorded ("${head}" "${t.line}")`);
    await sleep(300);
    await s.shot('liveroom-take');
  });
  await step('the control room', async () => {
    await page.locator('.lr-foot .btn-go').click();
    await sleep(500);
    const c = await E(() => {
      const k = document.querySelector('.ew-region-top .lr-key'), r = k?.getBoundingClientRect(), song = document.querySelector('.ew-panel[data-panel="song"]')?.getBoundingClientRect();
      return { open: window.overdub.liveRoom.state.open, hidden: document.querySelector('.lr').hidden, key: !!r && r.width > 0 && r.bottom <= 64, before: !!r && !!song && r.right <= song.left + 1, inert: [...document.body.children].filter((x) => x.inert).length, url: location.search };
    });
    T.ok(!c.open && c.hidden && c.key && c.before && c.inert === 0 && !/room/.test(c.url), `Into the control room: the studio with the take in it, and a Live room key on the top bar before Song to go back (nothing left inert; the address "${c.url}")`);
    await s.shot('liveroom-studio');
  });
  await step('give me a beat', async () => {
    const n0 = await E(() => window.overdub.store.get().tracks.length), h0 = await E(() => window.overdub.store.history.length);
    await page.click('.lr-key');
    await page.waitForFunction(() => window.overdub.liveRoom.state.step === 'room', null, { timeout: 4000 });
    await E(() => window.overdub.liveRoom.state.onsets.splice(0));
    await page.keyboard.press('KeyB');
    await sleep(1500);
    const b = await E(() => ({ phase: window.overdub.liveRoom.state.phase, tracks: window.overdub.store.get().tracks.length, playing: window.overdub.engine.playing }));
    await page.keyboard.press('Escape');
    await sleep(300);
    const a = await E(() => ({ phase: window.overdub.liveRoom.state.phase, tracks: window.overdub.store.get().tracks.length, h: window.overdub.store.history.length, playing: window.overdub.engine.playing }));
    T.ok(b.phase === 'beat' && b.tracks === n0 + 1 && b.playing && a.phase === 'idle' && a.tracks === n0 && a.h === h0 && !a.playing,
      `Give me a beat (B): the drums alone on a preview (${b.tracks - n0} track, ${b.phase}, ${b.playing ? 'playing' : 'stopped'}), Esc and they're gone: the song as it was (${a.tracks} tracks of ${n0}, ${a.h - h0} new steps, ${a.phase}, ${a.playing ? 'playing' : 'stopped'})`);
  });
  const errs = s.errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ').slice(0, 400) : ''}`);
} finally {
  await s.close();
}

/* ------------------------------------------------------------------------------------------------ the band stops with you */
// a second fake guitar: six passes of the riff, then nine seconds of nothing (the browser loops it)
{
  const riff = riffAudio(RIFFS.metal, 6).buf, wav = new Float32Array(riff.length + 9 * SR);
  wav.set(riff);
  const stops = path.join(OUTDIR, 'liveroom-stop.wav');
  writeWav(stops, wav);
  const s2 = await open('/app/?room', { width: 1280, height: 800, fakeAudio: stops });
  const p2 = s2.page, E2 = (fn, arg) => p2.evaluate(fn, arg);
  try {
    await p2.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await step('the band stops with you', async () => {
      await p2.click('.lr-card[data-thing="electric"]');
      await p2.click('.lr-placecard[data-place="metal"]');
      await p2.locator('.lr-steps button', { hasText: 'Plug in' }).click();
      await p2.waitForFunction(() => window.overdub.input.audio.state.open && window.overdub.liveRoom.state.guitar, null, { timeout: 10000 });
      await p2.click('.lr-go');
      await p2.waitForFunction(() => window.overdub.liveRoom.state.phase === 'band', null, { timeout: 45000 });
      await p2.waitForFunction(() => window.overdub.liveRoom.state.phase === 'ended', null, { timeout: 30000 });
      const e = await E2(() => { const o = window.overdub, R = o.liveRoom.state; return { ended: R.ended, entry: R.entry?.beat, playing: o.engine.playing, status: document.querySelector('.lr-status')?.textContent, h: o.store.history.length }; });
      T.ok(e.ended && e.ended.beat % 4 === 0 && e.ended.beat > e.entry && !e.playing && /^The band stopped with you\./.test(e.status || ''),
        `you stop: the band finishes the bar with you (stopped on beat ${e.ended?.beat}, in on ${e.entry}) and the take waits ("${e.status}")`);
      await s2.shot('liveroom-ended');
      // leaving for the control room keeps the take, as Space would
      await p2.click('.lr-glass');
      await p2.waitForFunction(() => !window.overdub.liveRoom.state.open, null, { timeout: 8000 });
      const k = await E2((h0) => {
        const o = window.overdub, p = o.store.get(), d = p.tracks.find((x) => x.name === 'Drums'), g = p.tracks.find((x) => x.name === 'Guitar');
        return { steps: o.store.history.slice(h0).map((x) => x.by), d: d && { start: d.clips[0]?.start, length: d.clips[0]?.length }, g: g?.clips.length };
      }, e.h);
      T.ok(k.steps.join() === 'you,overdub' && k.g === 1 && k.d && k.d.start === e.entry && k.d.start + k.d.length === e.ended.beat,
        `Control room with the band stopped keeps the take first: yours, then the house's (${k.steps.join(', ')}), the drums from beat ${k.d?.start} to ${k.d ? k.d.start + k.d.length : '?'}, where the band stopped`);
    });
    const errs = s2.errors.filter((x) => !ignorable(x));
    T.ok(!errs.length, `no page errors with a guitar that stops${errs.length ? ': ' + errs.slice(0, 3).join(' | ').slice(0, 400) : ''}`);
  } finally {
    await s2.close();
  }
}
/* ------------------------------------------------------------------------------------------------ tap the 1 */
// a third fake guitar: a riff's skeleton with six fills a pass that change every pass, eight passes (looped)
{
  const sl = riffAudio(RIFFS.loose, 8, { seed: 23, fills: 6, solid: true });
  T.ok(!hear(sl.onsets, 'metal'), `a riff whose fills change every pass isn't a riff by ear (${sl.onsets.length} notes in eight passes, seven of each pass's thirteen the same every time)`);
  const wav = path.join(OUTDIR, 'liveroom-loose.wav');
  writeWav(wav, sl.buf);
  const s3 = await open('/app/?room', { width: 1280, height: 800, fakeAudio: wav });
  const p3 = s3.page, E3 = (fn, arg) => p3.evaluate(fn, arg), P = (8 * 60) / 132;
  try {
    await p3.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await step('tap the 1', async () => {
      await p3.click('.lr-card[data-thing="electric"]');
      await p3.click('.lr-placecard[data-place="metal"]');
      await p3.locator('.lr-steps button', { hasText: 'Plug in' }).click();
      await p3.waitForFunction(() => window.overdub.input.audio.state.open && window.overdub.liveRoom.state.guitar, null, { timeout: 10000 });
      await p3.click('.lr-go');
      await p3.waitForFunction(() => window.overdub.liveRoom.state.step === 'room', null, { timeout: 4000 });
      const h0 = await E3(() => ({ h: window.overdub.store.history.length, tracks: window.overdub.store.get().tracks.length }));
      // after a while of playing with nothing caught, the room says how to tell it, once
      await p3.waitForFunction(() => /tap T on its 1/.test(document.querySelector('.lr-status')?.textContent || ''), null, { timeout: 40000 });
      const hint = await E3(() => ({ phase: window.overdub.liveRoom.state.phase, status: document.querySelector('.lr-status').textContent, notes: window.overdub.liveRoom.state.onsets.length }));
      T.ok(hint.phase === 'idle', `nothing caught by ear in ${hint.notes} notes, and the room says how to tap it in ("${hint.status}")`);
      // the 1s the room heard (the riff's only E), and the next two on the input's clock
      const at = await E3((P) => {
        const o = window.overdub, R = o.liveRoom.state, a = o.input.audio, ones = R.onsets.filter((x) => x.p != null && ((Math.round(x.p) % 12) + 12) % 12 === 4).map((x) => x.t);
        const inLat = Math.max(0, a.latency.get() - a.outLatency()), last = ones[ones.length - 1], now = o.engine.ctx.currentTime + inLat;
        let k = 1;
        while (last + k * P < now + 0.6) k++;
        return { ones: ones.length, inLat, first: last + k * P };
      }, P);
      const press = async (t) => {
        await p3.waitForFunction(({ t, inLat }) => window.overdub.engine.ctx.currentTime + inLat >= t, { t, inLat: at.inLat }, { timeout: 10000, polling: 4 });
        await p3.keyboard.press('KeyT');
      };
      await press(at.first);
      const one = await E3(() => ({ taps: [...window.overdub.liveRoom.state.taps], status: document.querySelector('.lr-status').textContent }));
      T.ok(one.taps.length === 1 && Math.abs(one.taps[0] - at.first) < 0.06 && one.status === 'One. And again on the next 1.',
        `T on the riff's 1: one tap, put on the input's clock ${one.taps.length ? ((one.taps[0] - at.first) * 1000).toFixed(0) : '?'} ms from the note ("${one.status}")`);
      await press(at.first + P);
      await p3.waitForFunction(() => window.overdub.liveRoom.state.phase !== 'idle', null, { timeout: 2000 });
      const got = await E3(() => { const R = window.overdub.liveRoom.state; return { phase: R.phase, tapped: R.riff?.tapped, n: R.riff?.n, bpm: R.riff?.bpm, root: R.riff?.root, entry: R.entry && { t: R.entry.t, beat: R.entry.beat }, status: document.querySelector('.lr-status').textContent }; });
      T.ok(got.phase === 'heard' && got.tapped && got.n === 8 && Math.abs(got.bpm - 132) <= 2 && got.root === 4 && /^Got it: two bars at 13\d in E\./.test(got.status),
        `T on the next 1: ${got.n} beats at ${got.bpm} in E (root ${got.root}), the band's in on the next pass ("${got.status}")`);
      await p3.waitForFunction(() => window.overdub.liveRoom.state.phase === 'band', null, { timeout: 8000 });
      const b = await E3(() => { const o = window.overdub; return { tracks: o.store.get().tracks.map((x) => x.name), h: o.store.history.length, playing: o.engine.playing }; });
      const off = got.entry ? got.entry.t - (at.first + 2 * P) : NaN;
      T.ok(b.playing && got.entry.beat % 4 === 0 && Math.abs(off) < 0.1 && b.tracks.join() === 'Guitar,Drums,Bass' && b.h === h0.h,
        `the band comes in on the pass after the taps (beat ${got.entry?.beat}, ${(off * 1000).toFixed(0)} ms from that pass's 1), a preview: ${b.tracks.join(', ')}, nothing in History`);
      await s3.shot('liveroom-tapped');
      await p3.keyboard.press('Escape');
      await sleep(300);
      const a = await E3(() => ({ phase: window.overdub.liveRoom.state.phase, tracks: window.overdub.store.get().tracks.length, h: window.overdub.store.history.length, playing: window.overdub.engine.playing }));
      T.ok(a.phase === 'idle' && a.tracks === h0.tracks && a.h === h0.h && !a.playing, `Esc and the tapped band is gone: the song as it was (${a.tracks} track, ${a.h - h0.h} new steps)`);
    });
    const errs = s3.errors.filter((x) => !ignorable(x));
    T.ok(!errs.length, `no page errors with a tapped riff${errs.length ? ': ' + errs.slice(0, 3).join(' | ').slice(0, 400) : ''}`);
  } finally {
    await s3.close();
  }
}
T.done();
