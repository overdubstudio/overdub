// The live room's fakes [tools; frozen after the foundation] (docs/research/LIVE-ROOM-MODE.md §11): a guitar, a voice
// and the rest, synthesized and seeded (never Math.random), so a check knows exactly what was played and when. Node
// checks use the buffers; a page check writes them to a WAV that Chromium plays as the input (tools/pw.js open's
// fakeAudio, --use-file-for-fake-audio-capture), which nothing sends to a speaker (--mute-audio).
//
//   SR                                    48000
//   rng(seed) -> () => [0, 1)             the seeded generator every fake draws from
//   riffDI(riff, { passes, bpm, seed, jitter, solid, fills, peak, sr }) -> { buf, notes }
//       a riff's DI: plucked strings (Karplus-Strong), a fifth over each note when riff.chord (power chords), peaks at
//       `peak` dBFS (-12: as an interface brings a guitar in). riff: { bpm, beats, chord?, fill?, notes: [[beat, midi,
//       held beats (0 or none: a palm-muted chug)]] }; jitter: how far off each note is (s), solid: every 1 right on
//       it, fills: that many notes from riff.fill on its free sixteenths, new each pass. notes: what was played,
//       [{ t (s), p, d (s) }]
//   riffOf(riff, { bpm }) -> { n, bpm, root, notes: [{ t (beats), p, d (beats) }] }   the riff as the band takes one
//       (core/liveroom/band.js bandFor): what a read of it would give, exactly
//   strum(chords, { bpm, seed, pattern, peak, sr }) -> { buf, strums }
//       an acoustic guitar strummed: chords [{ beat, notes: [midi, low to high], beats }], each bar strummed on
//       `pattern` (beats in the bar; down on the beat, up between), the strings 6-12 ms apart. strums: [{ t (s), chord }]
//   voice(notes, { bpm, seed, vowel, peak, sr }) -> { buf, notes }
//       a voice: a seeded glottal pulse (a little jitter, a slow vibrato) through three formants. notes: [[beat, midi,
//       beats]]; vowel: 'a' | 'e' | 'i' | 'o' | 'u'
//   mix(parts, { peak, length }) -> Float32Array   parts [{ buf, at (s), gain (dB) }] summed (peak: normalized to it)
//   stereo(left, right, { sr }) -> { sr, channels: [left, right] }   an interface's inputs 1 and 2, padded to one length
//   session(script) -> { wav: { sr, channels }, timeline }
//       a whole session for one WAV, on one clock: script { bpm, meter: [4, 4], lead (s before bar 1), tail (s), sr,
//       channels (1 or 2), parts: [{ kind: 'riff', riff, bar, passes, seed, jitter, channel, gain } | { kind: 'strum',
//       chords, bar, channel, gain } | { kind: 'voice', notes, bar, channel, gain }] } (bar: 1 is the song's first).
//       timeline: { bar1 (s into the file), spb, bpb, parts: [{ kind, bar, at (s), length (s), notes }] }, so a check
//       lines the file up with the count (harness.js alignCount) and knows where each note should land
//   writeWav(file, wav, sr?) -> file      16-bit PCM, any number of channels: wav a Float32Array or { sr, channels }

import fs from 'node:fs';
import path from 'node:path';

export const SR = 48000;

export function rng(seed = 1) {
  let s = Math.abs(Math.floor(seed)) % 2147483647 || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}
const dbToGain = (db) => 10 ** (db / 20);
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
function normalize(buf, peak) {
  let pk = 0;
  for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]));
  if (pk > 0 && peak != null) { const g = dbToGain(peak) / pk; for (let i = 0; i < buf.length; i++) buf[i] *= g; }
  return buf;
}
// a plucked string into buf: Karplus-Strong, seeded, with a short fade at its end
function pluck(buf, sr, rnd, midi, t, dur, amp, damp) {
  const N = Math.max(2, Math.round(sr / midiHz(midi))), line = Float32Array.from({ length: N }, () => rnd() * amp);
  const a = Math.round(t * sr), b = Math.min(buf.length, a + Math.round(dur * sr)), fade = Math.round(sr * 0.01);
  for (let i = Math.max(0, a), k = 0; i < b; i++) { const y = line[k]; line[k] = 0.5 * (y + line[(k + 1) % N]) * damp; k = (k + 1) % N; buf[i] += y * (i > b - fade ? (b - i) / fade : 1); }
}
function withFills(riff, n, r) {
  const taken = new Set(riff.notes.map(([b]) => Math.round(b * 4))), free = [], out = [...riff.notes];
  for (let q = 2; q < riff.beats * 4 - 1; q++) if (!taken.has(q)) free.push(q);
  for (let j = 0; j < n && free.length; j++) out.push([free.splice(Math.floor(r() * free.length), 1)[0] / 4, riff.fill[Math.floor(r() * riff.fill.length)]]);
  return out;
}

export function riffDI(riff, { passes = 4, bpm = riff.bpm, seed = 11, jitter = 0.004, solid = false, fills = 0, peak = -12, sr = SR, tail = 0.5 } = {}) {
  const r = rng(seed), rnd = () => r() * 2 - 1, spb = 60 / bpm;
  const buf = new Float32Array(Math.round((passes * riff.beats * spb + tail) * sr)), notes = [];
  for (let k = 0; k < passes; k++) {
    for (const [b, p, d] of fills ? withFills(riff, fills, r) : riff.notes) {
      const t = (k * riff.beats + b) * spb + (k + b > 0 && !(solid && b === 0) ? rnd() * jitter : 0), dur = d ? d * spb : 0.18;
      pluck(buf, sr, rnd, p, t, dur, 0.4, d ? 0.996 : 0.985);
      if (riff.chord) pluck(buf, sr, rnd, p + 7, t + 0.004, dur, 0.25, d ? 0.996 : 0.985);
      notes.push({ t, p, d: dur });
    }
  }
  for (let i = 0; i < buf.length; i++) buf[i] += rnd() * 0.0003;
  return { buf: normalize(buf, peak), notes: notes.sort((a, b) => a.t - b.t) };
}

export function riffOf(riff, { bpm = riff.bpm } = {}) {
  const low = riff.notes.reduce((m, [, p]) => Math.min(m, p), Infinity);
  return { n: riff.beats, bpm, root: riff.root ?? ((low % 12) + 12) % 12, notes: riff.notes.map(([t, p, d]) => ({ t, p, d: d || 0.25 })) };
}

export function strum(chords, { bpm = 96, seed = 5, pattern = [0, 1, 1.5, 2.5, 3, 3.5], bpb = 4, peak = -14, sr = SR, tail = 1 } = {}) {
  const r = rng(seed), rnd = () => r() * 2 - 1, spb = 60 / bpm;
  const end = chords.reduce((m, c) => Math.max(m, c.beat + (c.beats || bpb)), 0);
  const buf = new Float32Array(Math.round((end * spb + tail) * sr)), strums = [];
  chords.forEach((c, ci) => {
    const span = c.beats || bpb;
    for (let bar = 0; bar < span; bar += bpb) {
      for (const at of pattern) {
        if (bar + at >= span - 1e-9) continue;
        const up = Math.abs(at - Math.round(at)) > 1e-6, t = (c.beat + bar + at) * spb + rnd() * 0.006;
        const order = up ? [...c.notes].reverse() : c.notes, gap = 0.006 + r() * 0.006;
        order.forEach((p, i) => pluck(buf, sr, rnd, p, t + i * gap, spb * 0.95, up ? 0.22 : 0.32, 0.9985));
        strums.push({ t, chord: ci, up });
      }
    }
  });
  return { buf: normalize(buf, peak), strums };
}

const FORMANTS = { a: [800, 1150, 2900], e: [400, 1700, 2600], i: [300, 2200, 3000], o: [450, 800, 2830], u: [325, 700, 2530] };
export function voice(notes, { bpm = 90, seed = 3, vowel = 'a', peak = -16, sr = SR, tail = 0.5 } = {}) {
  const r = rng(seed), spb = 60 / bpm;
  const end = notes.reduce((m, [b, , d]) => Math.max(m, b + d), 0);
  const buf = new Float32Array(Math.round((end * spb + tail) * sr)), out = [];
  const F = FORMANTS[vowel] || FORMANTS.a, BW = [80, 90, 120];
  for (const [b, p, d] of notes) {
    const t0 = b * spb + (r() * 2 - 1) * 0.01, dur = d * spb * 0.92, a = Math.round(t0 * sr), n = Math.round(dur * sr), f0 = midiHz(p);
    // the source: a pulse train with a little jitter and a slow vibrato, its harmonics falling off
    const src = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const vib = 1 + 0.004 * Math.sin((2 * Math.PI * 5.2 * i) / sr), f = f0 * vib * (1 + (r() * 2 - 1) * 0.002);
      ph += f / sr;
      if (ph >= 1) ph -= 1;
      src[i] = 1 - 2 * ph;
    }
    // three formants (two-pole resonators), in parallel
    const y = new Float32Array(n);
    F.forEach((fc, k) => {
      const R = Math.exp((-Math.PI * BW[k]) / sr), c1 = 2 * R * Math.cos((2 * Math.PI * fc) / sr), c2 = -R * R, g = (1 - R) * (k === 0 ? 1 : 0.6 / k);
      let y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) { const v = g * src[i] + c1 * y1 + c2 * y2; y2 = y1; y1 = v; y[i] += v; }
    });
    const att = Math.round(sr * 0.03), rel = Math.round(sr * 0.06);
    for (let i = 0; i < n && a + i < buf.length; i++) buf[a + i] += y[i] * Math.min(1, i / att, (n - i) / rel);
    out.push({ t: t0, p, d: dur });
  }
  return { buf: normalize(buf, peak), notes: out };
}

export function mix(parts, { peak = null, length = 0, sr = SR } = {}) {
  const n = Math.max(length, ...parts.map((x) => Math.round((x.at || 0) * sr) + x.buf.length));
  const out = new Float32Array(n);
  for (const x of parts) {
    const a = Math.round((x.at || 0) * sr), g = dbToGain(x.gain || 0);
    for (let i = 0; i < x.buf.length && a + i < n; i++) if (a + i >= 0) out[a + i] += x.buf[i] * g;
  }
  return peak == null ? out : normalize(out, peak);
}

export function stereo(left, right, { sr = SR } = {}) {
  const n = Math.max(left.length, right.length), L = new Float32Array(n), R = new Float32Array(n);
  L.set(left); R.set(right);
  return { sr, channels: [L, R] };
}

export function session({ bpm = 120, meter = [4, 4], lead = 1, tail = 2, sr = SR, channels = 1, parts = [] } = {}) {
  const bpb = (meter[0] * 4) / meter[1], spb = 60 / bpm, barAt = (bar) => lead + (bar - 1) * bpb * spb;
  const lanes = Array.from({ length: channels }, () => []), timeline = { bar1: lead, spb, bpb, parts: [] };
  for (const part of parts) {
    const at = barAt(part.bar ?? 1);
    let made = null;
    if (part.kind === 'riff') made = riffDI(part.riff, { passes: part.passes ?? 2, bpm, seed: part.seed ?? 11, jitter: part.jitter ?? 0.004, solid: !!part.solid, fills: part.fills || 0, peak: part.peak ?? -12, sr, tail: 0 });
    else if (part.kind === 'strum') { const s = strum(part.chords, { bpm, seed: part.seed ?? 5, pattern: part.pattern, bpb, peak: part.peak ?? -14, sr, tail: 0 }); made = { buf: s.buf, notes: s.strums }; }
    else if (part.kind === 'voice') made = voice(part.notes, { bpm, seed: part.seed ?? 3, vowel: part.vowel, peak: part.peak ?? -16, sr, tail: 0 });
    else continue;
    lanes[Math.min(channels - 1, part.channel || 0)].push({ buf: made.buf, at, gain: part.gain || 0 });
    timeline.parts.push({ kind: part.kind, bar: part.bar ?? 1, at, length: made.buf.length / sr, notes: made.notes.map((x) => ({ ...x, t: x.t + at })) });
  }
  const end = Math.max(Math.round((lead + tail) * sr), ...lanes.flat().map((x) => Math.round(x.at * sr) + x.buf.length + Math.round(tail * sr)));
  return { wav: { sr, channels: lanes.map((l) => mix(l, { length: end, sr })) }, timeline };
}

export function writeWav(file, wav, sr = SR) {
  const W = wav instanceof Float32Array ? { sr, channels: [wav] } : wav, ch = W.channels, nc = ch.length, n = Math.max(...ch.map((c) => c.length));
  const b = Buffer.alloc(44 + n * nc * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * nc * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(nc, 22);
  b.writeUInt32LE(W.sr, 24); b.writeUInt32LE(W.sr * nc * 2, 28); b.writeUInt16LE(nc * 2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * nc * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, ch[c][i] || 0)) * 32767), 44 + (i * nc + c) * 2);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, b);
  return file;
}
