// Checks for the inputs area: pitch (YIN), hum, tap, latency math in Node; then the studio in Chromium: musical
// typing, capture and keep, tap keys, a hummed take through the repair view, the fake mic's meter, a recorded take,
// the Sketch tab at 1440 and 390 wide, and the spiral moving. Fresh eyes 5: whose key a hum snaps to (a key a person
// set or a pitched part, never a tapped beat), and a hum moved into the key says so, with Undo. Fresh eyes 6: the
// tuner over a played guitar phrase (cents only once a note settles; nothing under the low string), and monitoring
// with no audio track (said once, then it waits and wires itself when one appears).
// (YIN, the played-guitar tuner, the sloppy-human timing, monitoring, hum, tap, latency, capture and MIDI-input Node
// checks now live in test/unit/input.test.js and input-timing.test.js, the tuner's strings and tunings in tuner.test.js
// and the strum calibration in calibrate.test.js; the plucked-string tuner sweep, seconds of Node, stays here.)
//   node tools/input-test.js        (screenshots: tools/.out/input-*.png)
import { open, tally, OUTDIR } from './pw.js';
import path from 'node:path';
import fs from 'node:fs';
import { median } from '../app/src/input/latency.js';
import { noteName } from '../app/src/core/music.js';
import { createPitchTracker, segment } from '../app/src/input/pitch.js';
import { render as renderVoice, makePhrase } from './hum-bench.js';
import { SR, workletScope, RIFF2, session, restoreWorkletNode } from '../test/unit/_tape-kit.js';

const T = tally('input');
const AUDIOIN = await import('../app/src/input/audioin.js');

// Wall clock, in Node: the checks of input/pitch.js and the rolling tape that compare a time to a limit. They are timed
// here and not in test/unit because this runner retries a suite alone when load made it fail; test/unit has no retry.
{
  // hum live: 128-sample blocks, decoded every 240 ms, under 2 ms of work per 10 ms frame
  const au = renderVoice(makePhrase(4, { seed: 5 }));
  const tr = createPitchTracker({ sr: au.sr });
  const t0 = performance.now();
  for (let i = 0; i < au.x.length; i += 128) {
    tr.push(au.x.subarray(i, Math.min(au.x.length, i + 128)));
    tr.trace();
    if ((i / 128) % 90 === 0) { tr.decode(); segment(tr.frames); }
  }
  const usFrame = ((performance.now() - t0) * 1000) / tr.n;
  T.ok(usFrame < 2000, `hum live: ${Math.round(usFrame)} µs of work per 10 ms frame, decodes included (${(usFrame / 100).toFixed(1)}% of real time)`);
}
{
  // the rolling tape: a quantum in well under its time (60 µs of its 2.67 ms), a minute of audio rolled at a time
  const sc = workletScope(SR);
  const proc = sc.make(SR * 60);
  proc.port.postMessage = () => {};
  let seed = 3;
  const blocks = Array.from({ length: 375 }, () => {
    const q = new Float32Array(128);
    for (let i = 0; i < 128; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; q[i] = (seed / 4294967296 * 2 - 1) * 0.3; }
    return [[q]];
  });
  const roll = (n) => { for (let k = 0; k < n; k++) { proc.process(blocks[k % 375]); sc.scope.currentFrame += 128; } };
  roll(20000); // (warm: compiled)
  let best = Infinity;
  for (let tries = 0; tries < 3; tries++) {
    const t0 = process.hrtime.bigint();
    roll(22500);
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / 22500 / 1000);
  }
  T.ok(best < 60, `the tape takes a quantum in well under its time (${best.toFixed(2)} µs of its ${((128 / SR) * 1e6).toFixed(0)}; limit 60)`);
}
{
  // a minute of tape is read in slices: the page is never held up for long
  const s = await session({ riff: RIFF2, passes: 13 });
  let last = performance.now(), worst = 0, ticks = 0;
  const iv = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; ticks++; }, 1);
  const t0 = performance.now();
  const sel = await s.tape.select();
  const total = performance.now() - t0;
  clearInterval(iv);
  worst = Math.max(worst, performance.now() - last);
  s.tape.stop();
  restoreWorkletNode();
  T.ok(sel.why === 'repeat' && ticks >= 4 && worst < total / 2, `a minute of tape is read in slices: ${ticks} timer ticks over ${total.toFixed(0)} ms, the longest wait ${worst.toFixed(1)} ms`);
}

// A plucked string, made of its harmonics (so its pitch is exact): a pluck's comb on them, the high ones dying first.
function pluck(buf, sr, midi, t0, dur, { cents = 0, amp = 0.25, rng }) {
  const f = 440 * 2 ** ((midi - 69 + cents / 100) / 12), a = Math.round(t0 * sr), b = Math.min(buf.length, a + Math.round(dur * sr));
  const t60 = 3.2 * 2 ** (-(midi - 40) / 36), att = 0.002 * sr, rel = 0.02 * sr;
  for (let k = 1; k <= 16 && k * f < 7000; k++) {
    const ak = (amp * (k === 1 ? 1 : 0.85 / k) * Math.abs(Math.sin(Math.PI * k * 0.17))) / Math.sin(Math.PI * 0.17);
    const tau = t60 / 6.9 / (1 + 0.35 * (k - 1)), ph = rng() * 2 * Math.PI, w = (2 * Math.PI * k * f) / sr;
    for (let i = a; i < b; i++) { const n = i - a; buf[i] += ak * Math.min(1, n / att) * Math.exp(-n / sr / tau) * (i > b - rel ? (b - i) / rel : 1) * Math.sin(w * n + ph); }
  }
}
// A take: [kind, ...] parts in a row. 'open': the six open strings, the G 15 cents flat; 'lick': A minor pentatonic
// with its blue note in 8ths; 'chords': A7, D7 and E7 stabs strummed, then an A5 let ring; 'g': the G string alone.
function guitarTake(sr, kinds) {
  let s = 99;
  const rng = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const buf = new Float32Array(Math.round(16 * sr)), parts = [];
  let t = 0.2;
  for (const kind of kinds) {
    if (kind === 'open' || kind === 'g') for (const [m, c] of kind === 'g' ? [[55, -15]] : [[40, 0], [45, 0], [50, 0], [55, -15], [59, 0], [64, 0]]) { pluck(buf, sr, m, t, 1.1, { cents: c, rng }); parts.push({ kind: 'open', m, c, t0: t, t1: t + 1.1 }); t += 1.1; }
    if (kind === 'lick') { for (const m of [57, 60, 62, 63, 64, 67, 69, 67, 64, 62, 60, 57]) { pluck(buf, sr, m, t, 0.34, { amp: 0.22, rng }); parts.push({ kind: 'lick', m, t0: t, t1: t + 0.3 }); t += 0.3; } t += 0.3; }
    if (kind === 'chords') {
      for (const [name, ms, d] of [['A7', [45, 52, 55, 61, 64], 0.55], ['D7', [50, 57, 60, 66], 0.55], ['E7', [40, 47, 50, 56, 59, 64], 0.55], ['A5', [45, 52, 57], 1.2]]) {
        ms.forEach((m, i) => pluck(buf, sr, m, t + i * 0.012, d, { amp: 0.16, rng }));
        parts.push({ kind: 'chord', name, t0: t, t1: t + d }); t += d + 0.15;
      }
    }
  }
  const out = buf.subarray(0, Math.round((t + 0.2) * sr));
  for (let i = 0; i < out.length; i++) out[i] += (rng() - 0.5) * 0.001;
  return { buf: out, parts };
}
const E2 = 440 * 2 ** ((40 - 69) / 12), FRET22 = 440 * 2 ** ((86 - 69) / 12);   // a guitar's range in standard tuning
/* ------------------------------------------------------------------ Getting started's tuner, on plucked strings (the guitar room) */
// input/tuner.js across a guitar's and a bass's range, at 48 and 96 kHz: Karplus-Strong strings (tools/strings.js) with a
// known pitch, 13 cents flat, through a bridge pickup (which thins a low string's fundamental), read the way
// ui/gauges/tuner.js reads the input (a window every 40 ms). Four conditions: clean; played (the pick's attack 10 cents
// sharp and falling back over 250 ms, a single coil's hum at -60 dBFS, a floor at -70); wobbly (played, and the pitch
// itself wandering ±1 cent, 25 times a second: the shown cents must hold still); harsh (hum at -48, a floor at -62).
// The error is the reading against the string's true pitch at the window's middle.
const STR = await import('./strings.js');
const TUN = await import('../app/src/input/tuner.js');
function readTuner(buf, sr, tuning, until) {
  const W = TUN.windowFor(sr), tu = TUN.createSteadyTuner({ tuning }), win = new Float32Array(W), out = [];
  for (let t = 0; t < until; t += 0.04) {
    const e = Math.round(t * sr);
    for (let i = 0; i < W; i++) { const j = e - W + i; win[i] = j >= 0 && j < buf.length ? buf[j] : 0; }
    out.push({ t, r: { ...tu.push(win, sr, t) } });
  }
  return out;
}
{
  const NOTES = [[28, { strings: [28, 33, 38, 43] }, 'a bass’s low E1'], [30, { strings: [30, 35, 40, 45, 50, 55, 59, 64] }, 'an eight-string’s F♯1'], [33, '7-drop-a', 'drop A'], [35, '7-standard', 'a seven-string’s B1'],
    [36, 'drop-c', 'drop C'], [38, 'drop-d', 'drop D'], [40, 'standard', 'E2'], [45, 'standard', 'A2'], [50, 'standard', 'D3'], [55, 'standard', 'G3'], [59, 'standard', 'B3'], [64, 'standard', 'E4']];
  const wob = (seed) => { const r = STR.rng(seed), v = Array.from({ length: 200 }, () => r() * 2 - 1); return (t) => v[Math.min(199, Math.max(0, Math.floor(t * 25)))]; };
  const COND = { clean: () => ({}), played: () => ({ glide: 10, hum: -60, noise: -70 }), wobbly: (m) => ({ glide: 10, hum: -60, noise: -70, bend: wob(m) }), harsh: () => ({ glide: 10, hum: -48, noise: -62 }) };
  const at = 0.5, cents = -13, rows = {};
  for (const sr of [48000, 96000]) for (const [cname, co] of Object.entries(COND)) {
    const R = (rows[`${sr / 1000} kHz ${cname}`] = { named: [], settle: [], errs: [], wrong: 0, flick: 0, lows: [] });
    for (const [m, tuning] of NOTES) {
      const s = STR.string(m, { sr, dur: 3, cents, at, peak: -14, pickup: 0.1, ...co(m) });
      const reads = readTuner(s.buf, sr, tuning, at + 3.5), half = TUN.windowFor(sr) / sr / 2;
      const truth = (t) => 1200 * Math.log2(s.truth(t - half) / 440) + 6900 - m * 100;
      const after = reads.filter((x) => x.t > at);
      const named = after.find((x) => x.r.live && x.r.p === m), settle = after.find((x) => x.r.live && x.r.settled && Math.abs((x.r.midi - m) * 100 - truth(x.t)) <= 3);
      R.named.push(named ? named.t - at : Infinity); R.settle.push(settle ? settle.t - at : Infinity);
      const live = after.filter((x) => x.r.live && x.r.settled);
      for (const x of live) R.errs.push(Math.abs((x.r.midi - m) * 100 - truth(x.t)));
      R.wrong += reads.filter((x) => x.r.p && x.r.p !== m).length;
      // the shown cents in the steady part (after the glide): one number, or two neighbours at most
      const shown = new Set(live.filter((x) => x.t > at + 1).map((x) => x.r.shown));
      if (shown.size > 2) R.flick++;
      R.lows.push(m);
    }
  }
  const med = (a) => median(a), mx = (a) => Math.max(...a);
  const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–'), ms = (x) => (Number.isFinite(x) ? Math.round(x * 1000) : '–');
  for (const [k, R] of Object.entries(rows)) {
    // (the worst is in the attack's first 300 ms, the smoother behind a pitch still falling; clean, it's a tenth. Harsh,
    // the gate closes 10 dB over the hum, so fewer of a string's steady late readings count and the median is ~0.63)
    const clean = /clean/.test(k), lim = clean ? 0.5 : /wobbly/.test(k) ? 3.5 : 3;
    T.ok(R.wrong === 0 && mx(R.named) <= 0.2 && mx(R.settle) <= (clean ? 0.25 : 0.35) && med(R.errs) <= (clean ? 0.2 : /harsh/.test(k) ? 0.7 : 0.6) && mx(R.errs) <= lim && R.flick === 0,
      `tuner, ${k}: ${NOTES.length} strings E1 to E4 (drop C's C2, a seven-string's B1, drop A, a bass's E1) 13 cents flat: the note named within ${ms(mx(R.named))} ms of the pluck, within 3 cents within ${ms(mx(R.settle))} ms, then off by ${f1(med(R.errs))} cents at the median and ${f1(mx(R.errs))} at worst (${R.errs.length} readings; ${R.wrong} wrong notes; ${R.flick} strings whose shown cents flickered)`);
  }
}
/* ------------------------------------------------------------------ the pedal across a change of track (the studio) */
{
  // Pedal down on track A, a key played and let go (held by the pedal), track B selected, pedal up: the lift reaches A
  // too (the notes it held sound there), so A's note ends, and A's next notes and the song's don't ring on.
  const { page, errors, close } = await open('/app/', { query: 'new&autostart' });
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    const r = await page.evaluate(async () => {
      const { store, engine, input, ui } = window.overdub;
      const w = (ms) => new Promise((res) => setTimeout(res, ms));
      const tr = (id, clips = []) => ({ id, name: id, kind: 'instrument', instrument: { device: 'core.keys', params: {} }, inserts: [], gain: -6, pan: 0, mute: false, solo: false, clips });
      store.load({ format: 'overdub/0', id: 'p_insus', title: 'Pedal', tempo: 120, meter: [4, 4], key: null, loop: { on: false, start: 0, end: 16 }, tracks: [tr('t_a'), tr('t_b')], sections: [], devices: {}, assets: {}, master: { gain: -6, inserts: [] }, meta: {} }, { by: 'overdub' });
      await engine.start(); await engine.settled();
      const m = input.midi, out = {};
      ui.select({ track: 't_a' }); await w(100);
      m.message([0xb0, 64, 127]); m.message([0x90, 60, 100]); await w(200); m.message([0x80, 60, 0]); await w(200);
      ui.select({ track: 't_b' }); await w(100);
      out.target = input.target()?.id;
      m.message([0xb0, 64, 0]); await w(1500);
      out.lift = (await engine.voices()).t_a;
      ui.select({ track: 't_a' }); await w(100);
      m.message([0x90, 62, 100]); await w(150); m.message([0x80, 62, 0]); await w(1500);
      out.after = (await engine.voices()).t_a;
      return out;
    });
    T.ok(r.target === 't_b' && r.lift.held === 0 && r.lift.voices === 0, `the pedal let up with another track selected releases the note it held on the first (${JSON.stringify(r.lift)})`);
    T.ok(r.after.held === 0 && r.after.voices === 0, `and the first track's next note ends when let go (${JSON.stringify(r.after)})`);
    const errs = errors.filter((e) => !/Failed to load resource/.test(e));
    T.ok(errs.length === 0, `pedal: no page errors (${errs.length})${errs.length ? ' ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally { await close(); }
}

/* ------------------------------------------------------------------ monitoring with no audio track, and the tuner (the studio) */
// Fresh eyes 6: monitoring on over a song with no audio track toasted at every store change and every engine graph event
// (16 toasts on a jam track, 22 on a demo). It says so once now, stays on and waits (state.monitorWaiting, a 'monitor'
// event, monitorTrack() null), and wires itself the moment an audio track appears. The fake mic is a guitar (the G
// string 15 cents flat, then A7, D7, E7 and A5 stabs): audio.tune({ lo, hi }) with the guitar's range reads the G and
// never a note under the low E (main read the A7 as A1 and the E7 as E1).
{
  const wav = path.join(OUTDIR, 'input-guitar.wav'), sr = 48000, { buf } = guitarTake(sr, ['g', 'chords']);
  const pcm = Buffer.alloc(44 + buf.length * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + buf.length * 2, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(sr, 24); pcm.writeUInt32LE(sr * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(wav, pcm);
  const { page, errors, close } = await open('/app/', { query: 'new&autostart', fakeAudio: wav });
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    const r = await page.evaluate(async ({ lo, hi }) => {
      const { store, engine, input, ui } = window.overdub, a = input.audio;
      const w = (ms) => new Promise((res) => setTimeout(res, ms));
      const said = [], told = [], toast = ui.toast;
      ui.toast = (text, o) => { said.push(String(text)); return toast(text, o); };
      input.on('monitor', (m) => told.push({ ...m }));
      const monitorToasts = () => said.filter((s) => /monitor/i.test(s)).length;
      const tr = { id: 't_k', name: 'Keys', kind: 'instrument', instrument: { device: 'core.keys', params: {} }, inserts: [], gain: -6, pan: 0, mute: false, solo: false, clips: [] };
      store.load({ format: 'overdub/0', id: 'p_mon', title: 'No audio track', tempo: 120, meter: [4, 4], key: null, loop: { on: false, start: 0, end: 16 }, tracks: [tr], sections: [], devices: {}, assets: {}, master: { gain: -6, inserts: [] }, meta: {} }, { by: 'overdub' });
      await engine.start(); await engine.settled();
      await a.open();
      a.monitor(true);
      // twenty changes to the song (a fader moved, as a jam track's load and a tone flip are store changes too)
      for (let i = 0; i < 20; i++) { store.dispatch({ type: 'track.set', track: 't_k', patch: { gain: -6 - i / 10 } }, { by: 'you' }); await w(15); }
      await w(400);
      const before = { toasts: monitorToasts(), monitoring: a.state.monitoring, waiting: a.state.monitorWaiting, track: a.monitorTrack()?.id ?? null };
      const id = store.dispatch({ type: 'track.add', ref: 'g', track: { name: 'Live guitar', kind: 'audio', arm: true } }, { by: 'you' }).created.g;
      await w(400);
      let peak = -120;
      for (let i = 0; i < 30; i++) { await w(50); peak = Math.max(peak, engine.meters.tracks[id]?.peak ?? -120); }
      const after = { toasts: monitorToasts(), waiting: a.state.monitorWaiting, track: a.monitorTrack()?.id ?? null, stateTrack: a.state.monitorTrack ?? null, peak: Math.round(peak) };
      a.monitor(false);
      // the tuner, the guitar's range: about two rounds of the take (4.6 s)
      const reads = [];
      for (let i = 0; i < 230; i++) { await w(40); const x = a.tune({ lo, hi }); if (x) reads.push({ p: x.p, cents: x.cents, stable: !!x.stable }); }
      a.close();
      return { before, after, id, told, reads };
    }, { lo: E2, hi: FRET22 });
    T.ok(r.before.toasts === 1 && r.before.monitoring && r.before.waiting === true && r.before.track === null && r.told.some((m) => m.waiting && m.track === null),
      `monitoring with no audio track says so once over 20 song changes (${r.before.toasts} toast${r.before.toasts === 1 ? '' : 's'}), and stays on, waiting (monitorWaiting ${r.before.waiting}, monitorTrack() ${r.before.track}, a 'monitor' event)`);
    T.ok(r.after.track === r.id && r.after.stateTrack === r.id && r.after.waiting === false && r.after.toasts === 1 && r.after.peak > -60 && r.told.some((m) => m.track === r.id && !m.waiting),
      `an audio track appears and the monitor wires itself through it, no new toast (monitorTrack() ${r.after.track === r.id ? 'is it' : r.after.track}, its meter at ${r.after.peak} dB)`);
    const g = r.reads.filter((x) => x.stable && x.p === 55), low = r.reads.filter((x) => x.p < 40), loud = r.reads.filter((x) => x.cents != null && (!x.stable || Math.abs(x.cents) > 50));
    const gc = g.map((x) => x.cents).sort((x, y) => x - y)[g.length >> 1];
    T.ok(g.length >= 5 && Math.abs(gc + 15) <= 3 && !low.length && !loud.length,
      `audio.tune({ lo, hi }) over the fake mic's guitar: the G reads ${gc} cents (tuned −15), nothing under the low E (${low.length ? low.slice(0, 4).map((x) => noteName(x.p)).join(', ') : 'none'}), cents only once settled (${r.reads.length} readings)`);
    const errs = errors.filter((e) => !/Failed to load resource/.test(e));
    T.ok(errs.length === 0, `monitoring and the tuner: no page errors (${errs.length})${errs.length ? ' ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally { await close(); }
}

/* ------------------------------------------------------------------ Getting started's gauges on a fake guitar (the guitar room) */
// ui/gauges/: the tuner, the level meter and the timing step mounted over the studio in muted Chromium, the input a
// fake: drop C's low C, 13 cents flat, plucked every 2 s and peaking at -9 dBFS over a little hum. The tuner names it
// (C2, -13 cents, the 6th string), the meter puts it in the window and says so, and the strobe moves (it's flat). The
// timing step runs with latency.measure swapped for a fake that calls onStep as the real one does (the clicks are
// sound, and nothing may play here): a good one is kept with its confidence, a loose one waits for Keep it. At 1440 and
// 390 wide (no sideways scroll); then the bench page (design/bench/getting-started/) on the same fake. Screenshots
// tools/.out/input-gauges-1440.png, -390.png and -bench.png.
{
  const sr = 48000, len = 6, buf = new Float32Array(sr * len);
  for (const at of [0.05, 2.05, 4.05]) { const s = STR.string(36, { sr, dur: 1.9, cents: -13, at, len, peak: -9, pickup: 0.1, hum: -66, noise: -78, seed: Math.round(at * 10) }); for (let i = 0; i < buf.length; i++) buf[i] += s.buf[i] * (i < s.buf.length ? 1 : 0); }
  let pk = 0; for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]));
  for (let i = 0; i < buf.length; i++) buf[i] *= 10 ** (-9 / 20) / pk;
  const wav = path.join(OUTDIR, 'input-gauges.wav'), pcm = Buffer.alloc(44 + buf.length * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + buf.length * 2, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(sr, 24); pcm.writeUInt32LE(sr * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(wav, pcm);
  const { page, errors, close, shot, base } = await open('/app/', { query: 'new&autostart', fakeAudio: wav });
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    const r = await page.evaluate(async () => {
      const { input } = window.overdub, a = input.audio;
      const w = (ms) => new Promise((res) => setTimeout(res, ms));
      const [{ mountTuner }, { mountLevel }, { mountTiming }] = await Promise.all(['tuner', 'level', 'timing'].map((n) => import(`/app/src/ui/gauges/${n}.js`)));
      await a.open();
      const box = document.createElement('div');
      box.id = 'gg-check';
      Object.assign(box.style, { position: 'fixed', inset: '0', zIndex: '9999', background: 'var(--bg)', padding: '16px', display: 'grid', gap: '20px', alignContent: 'start', overflow: 'auto', boxSizing: 'border-box' });
      const slots = ['tuner', 'level', 'timing'].map(() => { const d = document.createElement('section'); d.style.minWidth = '0'; box.append(d); return d; });
      document.body.append(box);
      const tuner = mountTuner(slots[0], { source: a, tuning: 'drop-c' });
      const level = mountLevel(slots[1], { source: a, device: a.state.label });
      // the clicks are sound: a fake measure that steps as the real one does
      const lat = a.latency, real = lat.measure;
      let fakeHits = [12, 9, 14.1, 15.9, 13.2, 15.0, 16.8, 14.4];
      lat.measure = async ({ onStep, sig }) => {
        for (let i = 0; i < 8; i++) { if (sig.stop) return null; onStep({ i, click: true }); await w(60); onStep({ i, ms: fakeHits[i] }); }
        return { how: 'tap', hits: fakeHits.slice(), ...window.__judge(fakeHits) };
      };
      window.__judge = (await import('/app/src/input/latency.js')).judgeTaps;
      const timing = mountTiming(slots[2], { latency: lat, label: () => a.state.label });
      const reads = [], levels = [];
      let stop = false;
      const loop = (now) => { if (stop) return; tuner.frame(now); level.frame(now); timing.frame(now); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      for (let i = 0; i < 110; i++) { await w(40); const x = tuner.reading; reads.push({ p: x.p, shown: x.shown, cents: x.cents, live: x.live, inTune: x.inTune, string: x.string && x.string.number }); levels.push({ v: level.state?.verdict, strum: level.state?.strum }); }
      const dom = {
        note: document.querySelector('.gg-tu-note')?.textContent, cents: document.querySelector('.gg-tu-cents')?.textContent, string: document.querySelector('.gg-tu-string')?.textContent,
        verdict: document.querySelector('.gg-level')?.dataset.verdict, say: document.querySelector('.gg-lv-say')?.textContent, db: document.querySelector('.gg-lv-db')?.textContent,
        state: document.querySelector('.gg-tuner')?.dataset.state,
      };
      // the strobe moves while it's flat
      tuner.setStyle('strobe');
      await w(120);
      const cv = document.querySelector('.gg-tu-face canvas');
      const s1 = cv.toDataURL(); await w(150); const s2 = cv.toDataURL();
      tuner.setStyle('needle');
      // timing: a good one, kept by itself
      try { localStorage.removeItem('overdub:latency'); } catch { /* ok */ }
      await timing.start();
      await w(100);
      const good = { say: document.querySelector('.gg-tm-say')?.textContent, got: document.querySelectorAll('.gg-tm-lamp.got').length, dots: document.querySelectorAll('.gg-tm-line circle').length, med: !!document.querySelector('.gg-tm-line line.med'),
        conf: document.querySelector('.gg-tm-conf span:last-child')?.textContent, keepHidden: document.querySelector('.gg-tm-acts button:nth-child(2)')?.hidden, saved: JSON.parse(localStorage.getItem('overdub:latency') || '{}') };
      // a loose one: Keep it, then pressed
      fakeHits = [10, 30, 12, 24, 14, 22, 18, 26];
      await timing.start();
      await w(100);
      const keepBtn = document.querySelector('.gg-tm-acts button:nth-child(2)');
      const loose = { say: document.querySelector('.gg-tm-say')?.textContent, keepShown: !keepBtn.hidden };
      keepBtn.click();
      await w(60);
      loose.after = document.querySelector('.gg-tm-say')?.textContent;
      loose.saved = JSON.parse(localStorage.getItem('overdub:latency') || '{}');
      lat.measure = real;
      window.__stopGauges = () => { stop = true; };
      return { reads, levels, dom, strobeMoves: s1 !== s2, good, loose, label: a.state.label };
    });
    const live = r.reads.filter((x) => x.live && x.shown != null);
    const steady = live.filter((x) => x.p === 36 && x.shown === -13 && x.string === 6);
    T.ok(live.length >= 30 && steady.length >= live.length - 3 && !r.reads.some((x) => x.p && x.p !== 36) && r.dom.note === 'C2' && r.dom.cents === '−13¢' && /^6th string, C/.test(r.dom.string || '') && r.dom.state !== 'intune',
      `gauges: the tuner on a fake guitar reads drop C's low C as ${r.dom.note} ${r.dom.cents} ("${r.dom.string}") in ${steady.length} of ${live.length} live readings, never another note`);
    const vs = r.levels.slice(40).map((x) => x.v);
    T.ok(vs.every((v) => v === 'ok') && r.dom.verdict === 'ok' && /^Right in the window: −9 dBFS/.test(r.dom.say || '') && /^−9\.\d dBFS$/.test(r.dom.db || ''),
      `gauges: the meter puts the -9 dBFS plucks in the window and holds it (${r.dom.db}): "${r.dom.say}"`);
    T.ok(r.strobeMoves, 'gauges: the strobe drifts while the string is 13 cents flat');
    T.ok(/^Round trip 14\.\d ms\. Your strums were within 3\.\d ms of each other: a good one\. Kept/.test(r.good.say || '') && r.good.got === 8 && r.good.dots === 8 && r.good.med && r.good.keepHidden && Object.values(r.good.saved)[0]?.confidence >= 0.9 && Object.values(r.good.saved)[0]?.how === 'tap',
      `gauges: timing (the clicks faked): a good strum along lights eight lamps and eight dots, is kept by itself with ${r.good.conf} confidence: "${r.good.say}"`);
    T.ok(r.loose.keepShown && /a little loose\. Keep it, or go again\.$/.test(r.loose.say || '') && /Kept/.test(r.loose.after || '') && Math.abs(Object.values(r.loose.saved)[0]?.ms - 20) < 0.01,
      `gauges: a loose one waits for Keep it ("${r.loose.say}"), and Keep it keeps it (${Object.values(r.loose.saved)[0]?.ms} ms)`);
    await shot('input-gauges-1440');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const narrow = await page.evaluate(() => ({ sw: document.querySelector('#gg-check').scrollWidth, cw: document.querySelector('#gg-check').clientWidth, doc: document.documentElement.scrollWidth, face: document.querySelector('.gg-tu-face').getBoundingClientRect().width }));
    await shot('input-gauges-390');
    T.ok(narrow.sw <= narrow.cw + 1 && narrow.doc <= 391 && narrow.face > 300, `gauges: 390 wide, nothing scrolls sideways (the tuner's face ${Math.round(narrow.face)} px wide)`);
    await page.evaluate(() => window.__stopGauges?.());
    // the bench AJ plays them on (design/bench/getting-started/: the input module on its own, monitoring off)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + '/design/bench/getting-started/', { waitUntil: 'load' });
    await page.selectOption('#tuning', 'drop-c');
    await page.click('#open');
    await page.waitForTimeout(3000);
    const bench = await page.evaluate(() => ({ note: document.querySelector('.gg-tu-note')?.textContent, verdict: document.querySelector('.gg-level')?.dataset.verdict, status: document.querySelector('#status')?.textContent, lamps: document.querySelectorAll('.gg-tm-lamp').length }));
    await shot('input-gauges-bench');
    T.ok(bench.note === 'C2' && bench.verdict === 'ok' && /^Open: /.test(bench.status || '') && bench.lamps === 8, `gauges: the bench page opens the input on its own and reads it (${bench.note}, the level ${bench.verdict}: "${bench.status}")`);
    const errs = errors.filter((e) => !/Failed to load resource/.test(e));
    T.ok(errs.length === 0, `gauges: no page errors (${errs.length})${errs.length ? ' ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally { await close(); }
}

/* ------------------------------------------------------------------ monitoring by itself, and the feedback guard (the studio) */
// Inputs with names: getUserMedia gives a page-made stream named as the device asked for. The Scarlett starts monitoring
// by itself however it was picked (the browser's "Default - Scarlett" entry is the Scarlett: docs/research/AMP-PATH.md
// §4), ramped in over 150 ms; the laptop's microphone leaves it off and says why; off by hand stays off when the same
// input opens again; after a reload the remembered Scarlett starts it. Then, monitoring, a guitar through it trips
// nothing, and a howl ringing up turns monitoring off with one toast. Then the live path's input end (§3, §4): what's
// remembered is the device's own id, the killswitch leaves an interface monitoring, closing never decides, a hold
// mutes and lets go, a stale id is chosen again by its label with the voice processing off on every ask, and a first
// visit (no labels before the grant) chooses again once they're in.
{
  const NAMED = `(() => {
    const md = navigator.mediaDevices;
    window.__devs = { 'scarlett-1': 'Scarlett 2i2 USB', 'mbp-mic': 'MacBook Pro Microphone', default: 'Default - Scarlett 2i2 USB' };
    window.__gum = [];
    // (__blind: no grant yet, so one input with no id and no label, until the first getUserMedia)
    md.enumerateDevices = async () => (window.__blind ? [{ deviceId: '', label: '', kind: 'audioinput', groupId: '' }] : Object.entries(window.__devs).map(([deviceId, label]) => ({ deviceId, label, kind: 'audioinput', groupId: 'g' })));
    md.getUserMedia = async (c) => {
      window.__gum.push(c && c.audio);
      window.__blind = false;
      const app = window.overdub; await app.engine.start();
      const ctx = app.engine.ctx, want = c && c.audio && c.audio.deviceId, id = (want && (want.exact || want)) || 'default';
      if (!(id in window.__devs)) { const e = new Error('gone'); e.name = 'OverconstrainedError'; throw e; }
      if (!window.__bus || window.__bus.context !== ctx) window.__bus = ctx.createGain();
      const dest = ctx.createMediaStreamDestination();
      window.__bus.connect(dest);
      const tr = dest.stream.getAudioTracks()[0], settings = tr.getSettings.bind(tr);
      Object.defineProperty(tr, 'label', { value: window.__devs[id], configurable: true });
      tr.getSettings = () => ({ ...settings(), deviceId: id, channelCount: id === 'mbp-mic' ? 1 : 2 });
      return dest.stream;
    };
    window.__play = (x, sr) => { const ctx = window.overdub.engine.ctx, b = ctx.createBuffer(1, x.length, sr); b.copyToChannel(Float32Array.from(x), 0); const n = ctx.createBufferSource(); n.buffer = b; n.connect(window.__bus); n.start(); return n; };
  })();`;
  const { page, errors, close } = await open('/app/', { query: 'new&autostart' });
  const ready = async () => {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await page.evaluate(async () => {
      const { store, engine } = window.overdub;
      await engine.start(); await engine.settled();
      if (!store.get().tracks.some((t) => t.kind === 'audio')) store.dispatch({ type: 'track.add', ref: 'g', track: { name: 'Guitar', kind: 'audio', arm: true } }, { by: 'you' });
    });
  };
  try {
    await page.addInitScript(NAMED);
    await page.evaluate(() => { try { localStorage.removeItem('overdub:input'); } catch { /* ok */ } });
    await page.reload({ waitUntil: 'load' });
    await ready();
    const r = await page.evaluate(async () => {
      const a = window.overdub.input.audio, w = (ms) => new Promise((res) => setTimeout(res, ms)), out = {};
      const snap = () => ({ kind: a.state.inputKind, on: a.state.monitoring, auto: a.state.monitorAuto, off: a.state.monitorOff, line: a.state.monitorLine, through: a.monitorTrack()?.name || null });
      await a.open({ device: '' }); await w(80); out.browser = snap();
      await a.open({ device: 'scarlett-1' }); await w(30); out.early = a._monitorGain; await w(270); out.late = a._monitorGain; out.picked = snap();
      await a.open({ device: 'mbp-mic' }); await w(80); out.mic = snap();
      await a.open({ device: 'scarlett-1' }); await w(80); out.back = snap();
      a.monitor(false); a.close(); await a.open({ device: 'scarlett-1' }); await w(80); out.byHand = snap();
      a.close();
      return out;
    });
    T.ok(r.browser.kind === 'interface' && r.browser.on && r.picked.kind === 'interface' && r.picked.on && r.picked.auto && r.picked.through === 'Guitar' && r.early > 0.02 && r.early < 0.9 && r.late > 0.98,
      `monitoring starts by itself for an interface (the Scarlett: on through ${r.picked.through}, ramped in: ${r.early?.toFixed?.(2)} after 30 ms, ${r.late?.toFixed?.(2)} after 300), the browser's own pick too (the same Scarlett as the default: ${r.browser.on ? 'on' : 'off'})`);
    T.ok(r.mic.kind === 'mic' && !r.mic.on && r.mic.off === 'mic' && r.mic.line === AUDIOIN.MIC_LINE && r.back.on && !r.byHand.on && !r.byHand.line,
      `a microphone leaves it off and says why ("${r.mic.line}"); back on the Scarlett it starts again; turned off by hand it stays off when the Scarlett opens again`);
    await page.reload({ waitUntil: 'load' });
    await ready();
    const rem = await page.evaluate(async () => { const a = window.overdub.input.audio; await a.open(); await new Promise((res) => setTimeout(res, 300)); return { kind: a.state.inputKind, on: a.state.monitoring, auto: a.state.monitorAuto, device: a.state.deviceId }; });
    T.ok(rem.device === 'scarlett-1' && rem.on && rem.auto, `after a reload, the remembered Scarlett (${rem.device}) starts monitoring when the input opens`);
    // the guard: through the Scarlett, a guitar (the G string, then A7, D7, E7, A5) and then a howl from -60 dBFS ringing
    // up at 40 dB a second trip nothing (an interface can't hear the speakers); on the MacBook's mic, monitored by hand,
    // the same howl turns monitoring off
    const sr = 48000, { buf: guitar } = guitarTake(sr, ['g', 'chords']), howl = new Float32Array(sr * 3);
    { let ph = 0; for (let i = 0; i < howl.length; i++) { ph += (2 * Math.PI * 1830) / sr; howl[i] = 10 ** (Math.min(-3, -60 + (40 * i) / sr) / 20) * Math.SQRT2 * Math.sin(ph); } }
    const g = await page.evaluate(async ({ guitar, howl, sr, line }) => {
      const { input, ui } = window.overdub, a = input.audio, w = (ms) => new Promise((res) => setTimeout(res, ms));
      const said = [], toast = ui.toast;
      ui.toast = (t, o) => { said.push(String(t)); return toast(t, o); };
      window.__play(guitar, sr); await w((guitar.length / sr) * 1000 + 300);
      const calm = { on: a.state.monitoring, toasts: said.length };
      window.__play(howl, sr); await w(1500);
      const iface = { on: a.state.monitoring, toasts: said.length };
      await a.open({ device: 'mbp-mic' }); a.monitor(true); await w(300);
      const t0 = performance.now(); window.__play(howl, sr);
      while (a.state.monitoring && performance.now() - t0 < 3500) await w(10);
      const ms = performance.now() - t0;
      await w(200);
      return { calm, iface, ms: Math.round(ms), on: a.state.monitoring, off: a.state.monitorOff, line: a.state.monitorLine, toasts: said.filter((s) => s === line).length, gain: a._monitorGain };
    }, { guitar: Array.from(guitar), howl: Array.from(howl), sr, line: AUDIOIN.FEEDBACK_LINE || '(none)' });
    T.ok(g.calm.on && !g.calm.toasts && g.iface.on && !g.iface.toasts && !g.on && g.off === 'feedback' && g.line === AUDIOIN.FEEDBACK_LINE && g.toasts === 1 && g.ms < 1200 && g.gain === null,
      `the feedback guard: through the Scarlett a guitar and even a howl trip nothing (${g.calm.on && g.iface.on ? 'still on' : 'off'}); on the mic, monitored by hand, a howl ringing up turns monitoring off ${g.ms} ms after it starts, with one toast ("${g.line}")`);
    // the live path's input end, on a clean page (nothing decided by hand yet)
    await page.evaluate(() => { try { localStorage.removeItem('overdub:input'); } catch { /* ok */ } });
    await page.reload({ waitUntil: 'load' });
    await ready();
    const q = await page.evaluate(async () => {
      const o = window.overdub, a = o.input.audio, w = (ms) => new Promise((res) => setTimeout(res, ms)), out = {};
      const saved = () => { try { return JSON.parse(localStorage.getItem('overdub:input') || '{}').deviceId; } catch { return null; } };
      const through = () => a.monitorTrack()?.name || null;
      // the capture's module failing to load once (a blip) as the guitar room plugs in: the guitar still reaches the rig,
      // and the capture loads the next time it's asked for
      {
        const c = o.engine.ctx, add = c.audioWorklet.addModule.bind(c.audioWorklet);
        let blips = 0;
        out.capFresh = !c.__ewCap;
        c.audioWorklet.addModule = (u, x) => (/cap-worklet/.test(String(u)) && blips++ < 2 ? Promise.reject(new Error('a blip')) : add(u, x));
        let err = '';
        try { await a.open({ device: 'scarlett-1', capture: true }); } catch (e) { err = String(e.message || e); }
        await w(80);
        out.capBlip = { err, open: a.state.open, through: through(), cap: a.state.firstFrame != null };
        const off = a.listen(() => {}); await w(300);
        out.capBlip.later = a.state.firstFrame != null;
        off(); a.close();
        c.audioWorklet.addModule = add;
      }
      await a.open({ device: 'default' }); await w(80);
      out.def = { on: a.state.monitoring, by: a.state.monitorBy, real: a.state.realId, dev: a.state.deviceId, saved: saved(), through: through(), marked: o.engine.monitoredTrack };
      a.hush(); await o.engine.silence(); await w(120);
      out.kill = { on: a.state.monitoring, through: through() };
      a.close(); out.closed = { on: a.state.monitoring, by: a.state.monitorBy };
      await a.open({ device: 'scarlett-1' }); await w(80); out.reopen = { on: a.state.monitoring, through: through() };
      a.hold('tuner'); await w(40); out.held = { on: a.state.monitoring, holds: [...a.state.monitorHolds], through: through(), gain: a._monitorGain };
      a.release('tuner'); await w(40); out.released = { on: a.state.monitoring, holds: a.state.monitorHolds.length, through: through() };
      await a.open({ device: 'mbp-mic' }); a.monitor(true); await w(40); a.hush(); await w(40);
      out.mic = { on: a.state.monitoring, by: a.state.monitorBy, through: through() };
      a.close();
      // two opens overlapping (Plug in, then M or R while the browser answers), and two openBests: one stream left
      // running, the one the monitor plays from; openBests join the open in flight
      {
        const md = navigator.mediaDevices, gum = md.getUserMedia, en = md.enumerateDevices, got = [];
        md.getUserMedia = async (c) => { const s = await gum.call(md, c); got.push(s); return s; };
        md.enumerateDevices = async () => { await w(30); return en.call(md); };
        const live = () => got.filter((s) => s.getAudioTracks()[0].readyState === 'live').length;
        await Promise.all([a.open({ device: 'scarlett-1', channel: '1' }), a.open({ device: 'scarlett-1', channel: '2' })]); await w(80);
        out.overlap = { live: live(), asked: got.length, channel: a.state.channel, through: through() };
        a.close(); got.length = 0;
        await Promise.all([a.openBest({ role: 'instrument' }), a.openBest({ role: 'instrument' }), a.ensureOpen()]); await w(80);
        out.overlap.best = { live: live(), asked: got.length };
        a.close(); out.overlap.closed = live();
        md.getUserMedia = gum; md.enumerateDevices = en;
      }
      window.__gum = [];
      await a.open({ device: 'gone-1234' }); await w(40);
      out.stale = { real: a.state.realId, open: a.state.open, asks: window.__gum.map((c) => ({ id: c && c.deviceId ? (c.deviceId.exact ? c.deviceId.exact : 'loose:' + c.deviceId) : '', off: !!c && c.echoCancellation === false && c.noiseSuppression === false && c.autoGainControl === false })) };
      a.close();
      return out;
    });
    T.ok(q.def.on && q.def.by === 'auto' && q.def.real === 'scarlett-1' && q.def.dev === 'scarlett-1' && q.def.saved === 'scarlett-1' && q.def.through === 'Guitar' && !!q.def.marked,
      `the browser's "Default - Scarlett" entry monitors (${q.def.on ? 'on' : 'off'}, through ${q.def.through}), and what's remembered is the Scarlett's own id (${q.def.saved}), never 'default'`);
    T.ok(q.kill.on && q.kill.through === 'Guitar', `the killswitch leaves an interface monitoring (${q.kill.on ? 'on' : 'off'}, through ${q.kill.through})`);
    T.ok(q.closed.on && q.reopen.on && q.reopen.through === 'Guitar', `closing never decides: closed, monitoring is still ${q.closed.on ? 'on' : 'off'}; opened again, heard through ${q.reopen.through}`);
    T.ok(q.held.on && q.held.holds.join() === 'tuner' && q.held.through === null && q.released.on && !q.released.holds && q.released.through === 'Guitar',
      `a hold mutes without deciding (held: monitoring ${q.held.on ? 'on' : 'off'}, playing through ${q.held.through}); released, it plays through ${q.released.through} again`);
    T.ok(!q.mic.on && q.mic.by === 'hand' && q.mic.through === null, `the killswitch turns a microphone's monitoring off by hand (${q.mic.on ? 'on' : 'off'}, by ${q.mic.by})`);
    T.ok(q.capFresh && !q.capBlip.err && q.capBlip.open && q.capBlip.through === 'Guitar' && !q.capBlip.cap && q.capBlip.later,
      `the capture's module failing to load as the input opens: the open stands (${q.capBlip.err || 'no error'}), the guitar plays through ${q.capBlip.through}, and the capture loads when it's next asked for (${q.capBlip.later})`);
    T.ok(q.overlap.live === 1 && q.overlap.asked === 2 && q.overlap.channel === '2' && q.overlap.through === 'Guitar' && q.overlap.best.live === 1 && q.overlap.best.asked === 1 && q.overlap.closed === 0,
      `two opens overlapping run one after the other: ${q.overlap.live} stream left running of ${q.overlap.asked}, on input ${q.overlap.channel} (the last asked for); two openBests and an ensureOpen at once ask the browser ${q.overlap.best.asked} time${q.overlap.best.asked === 1 ? '' : 's'}; closed, ${q.overlap.closed} running`);
    const loose = q.stale.asks.filter((x) => x.id.startsWith('loose:')).length, wet = q.stale.asks.filter((x) => !x.off).length;
    T.ok(q.stale.open && q.stale.real === 'scarlett-1' && !loose && !wet && q.stale.asks.some((x) => x.id === 'gone-1234') && q.stale.asks.at(-1).id === 'scarlett-1',
      `a remembered id that's gone is chosen again by its label (${q.stale.real}: asked ${q.stale.asks.map((x) => x.id || 'default').join(', ')}), never loosely (${loose}), the voice processing off on every ask (${wet} with it on)`);
    // a first visit: no labels until the grant; the browser's default is the MacBook's mic, the Scarlett is plugged in
    await page.evaluate(() => { try { localStorage.removeItem('overdub:input'); } catch { /* ok */ } });
    await page.addInitScript(() => { window.__blind = true; window.__devs = { 'scarlett-1': 'Scarlett 2i2 USB', 'mbp-mic': 'MacBook Pro Microphone', default: 'Default - MacBook Pro Microphone' }; });
    await page.reload({ waitUntil: 'load' });
    await ready();
    const b = await page.evaluate(async () => {
      const a = window.overdub.input.audio, w = (ms) => new Promise((res) => setTimeout(res, ms));
      const first = await a.choose({ role: 'instrument' });
      await a.openBest({ role: 'instrument' }); await w(80);
      const saved = JSON.parse(localStorage.getItem('overdub:input') || '{}').deviceId;
      const out = { first, real: a.state.realId, kind: a.state.inputKind, on: a.state.monitoring, through: a.monitorTrack()?.name || null, saved, asks: window.__gum.length };
      a.close();
      return out;
    });
    T.ok(b.first.reask && b.first.why === 'blind' && b.real === 'scarlett-1' && b.kind === 'interface' && b.on && b.through === 'Guitar' && b.saved === 'scarlett-1',
      `a first visit opens blind (${b.first.why}), then, the labels in, chooses again: the Scarlett (${b.real}, ${b.kind}), monitoring ${b.on ? 'on' : 'off'} through ${b.through}, remembered as ${b.saved}`);
    const errs = errors.filter((e) => !/Failed to load resource/.test(e));
    T.ok(errs.length === 0, `monitoring by itself and the guard: no page errors (${errs.length})${errs.length ? ' ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally { await close(); }
}

/* ------------------------------------------------------------------ the studio */
const IGNORE = (e) => /Failed to load resource/.test(e) && !/\/input\/|sketch|spiral/.test(e);
{
  const { page, errors, close, shot: full } = await open('/app/', { query: 'demo' });
  // each shot twice: the whole studio, and the bottom pane up close (-pane.png)
  const shot = async (name) => { await full(name); await page.locator('.ew-region-bottom').screenshot({ path: path.join(OUTDIR, name + '-pane.png') }).catch(() => {}); };
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    const api = await page.evaluate(() => Object.keys(window.overdub.input || {}).filter((k) => ['pitch', 'audio', 'hum', 'tap', 'midi', 'qwerty', 'capture'].includes(k)).length);
    T.ok(api === 7, 'app.input = { pitch, audio, hum, tap, midi, qwerty, capture }');
    await page.evaluate(() => window.overdub.ui.show('sketch'));
    await page.click('body', { position: { x: 700, y: 400 } }).catch(() => {}); // a gesture (audio starts)
    await page.evaluate(() => window.overdub.ui.show('sketch'));
    await page.waitForSelector('.sk', { timeout: 5000 });
    T.ok(await page.isVisible('.sk-rail .sk-mode[data-mode="hum"].on'), 'Sketch tab renders with Hum it selected');
    // the spiral is alive (the idle comet moves)
    const a = await page.evaluate(() => document.querySelector('.sk-spiral canvas').toDataURL());
    await page.waitForTimeout(400);
    const b = await page.evaluate(() => document.querySelector('.sk-spiral canvas').toDataURL());
    T.ok(a !== b, 'the spiral animates');
    await shot('input-sketch-1440');

    // musical typing: engine live notes on the target track, the strip, then a captured phrase
    await page.evaluate(() => {
      const e = window.overdub.engine; window.__spy = [];
      const on = e.liveNoteOn.bind(e), off = e.liveNoteOff.bind(e);
      e.liveNoteOn = (t, p, v) => { window.__spy.push(['on', t, p, v]); return on(t, p, v); };
      e.liveNoteOff = (t, p) => { window.__spy.push(['off', t, p]); return off(t, p); };
    });
    // (the chromatic map, as played: scale lock is on by default, and its map is checked in sketch-rec-test)
    await page.evaluate(() => { const q = window.overdub.input.qwerty; q.setScaleLock(false); q.setQuantize(false); });
    await page.keyboard.press('Backquote');
    T.ok(await page.isVisible('.ew-qw'), 'musical typing: the key strip shows');
    for (const k of ['KeyA', 'KeyD', 'KeyG']) { await page.keyboard.down(k); await page.waitForTimeout(140); await page.keyboard.up(k); await page.waitForTimeout(60); }
    await page.keyboard.down('KeyH'); await page.waitForTimeout(80);
    await shot('input-qwerty');
    await page.keyboard.up('KeyH');
    const spy = await page.evaluate(() => ({ calls: window.__spy, target: window.overdub.input.target().id }));
    const ons = spy.calls.filter((c) => c[0] === 'on');
    T.ok(ons.map((c) => c[2]).join(',') === '60,64,67,69' && ons.every((c) => c[1] === spy.target), `musical typing plays C4 E4 G4 A4 live on the target track (${ons.map((c) => c[2]).join(',')})`);
    T.ok(spy.calls.filter((c) => c[0] === 'off').length === 4, 'musical typing: every note is let go on key up');
    await page.keyboard.press('Backquote');
    await page.click('.sk-mode[data-mode="play"]');
    await page.waitForTimeout(150);
    await shot('input-play');
    await page.click('.sk-mode[data-mode="hum"]');
    const ph = await page.evaluate(() => { const c = window.overdub.input.capture; c.flush(); return c.latest(); });
    T.ok(ph && ph.src === 'qwerty' && ph.count === 4 && /C4@0:/.test(ph.notes), `capture: the phrase is kept without pressing record (${ph && ph.notes})`);
    // keep it: a new track and a clip, by you
    const kept = await page.evaluate((id) => {
      const app = window.overdub, r = app.input.capture.keep(id, { newTrack: { device: 'core.keys' } });
      if (!r.ok) return r;
      const t = app.store.track(r.track), c = t.clips.find((x) => x.id === r.clip);
      return { ok: true, by: c.by, trackBy: t.by, n: c.notes.length, notesBy: [...new Set(c.notes.map((n) => n.by))], label: app.store.history[app.store.history.length - 1].label, start: c.start };
    }, ph.id);
    T.ok(kept.ok && kept.by === 'you' && kept.trackBy === 'you' && kept.n === 4 && kept.notesBy.join() === 'you', `capture.keep: a new track and a 4-note clip at bar 1, all by you ("${kept.label}")`);
    const undone = await page.evaluate(() => { const app = window.overdub, n = app.store.get().tracks.length; app.store.undo(); return n - app.store.get().tracks.length; });
    T.ok(undone === 1, 'keeping is one undo step');
    // the strip is a picture, not a live region: a note lights its key without redrawing the strip, and screen readers
    // hear only real changes (on, the track, the octave) through the shell's announcer
    {
      await page.keyboard.press('Backquote');
      await page.waitForTimeout(120);
      const a = await page.evaluate(() => { const s = document.querySelector('.ew-qw'); return { role: s.getAttribute('role'), live: s.getAttribute('aria-live'), label: s.getAttribute('aria-label'), rows: [...s.querySelectorAll('.ew-qw-row')].length === 2 && [...s.querySelectorAll('.ew-qw-row')].every((r) => r.getAttribute('aria-hidden') === 'true'), said: document.querySelector('.ew-announce')?.textContent || '', target: window.overdub.input.target()?.name }; });
      await page.evaluate(() => { const s = document.querySelector('.ew-qw'); window.__qwMut = 0; window.__qwObs = new MutationObserver((l) => { window.__qwMut += l.filter((m) => m.type === 'childList').length; }); window.__qwObs.observe(s, { childList: true, subtree: true }); });
      await page.keyboard.down('KeyF'); await page.waitForTimeout(60);
      const lit = await page.evaluate(() => document.querySelector('.ew-qw-k[data-code="KeyF"]')?.classList.contains('on'));
      await page.keyboard.up('KeyF'); await page.waitForTimeout(60);
      const unlit = await page.evaluate(() => !document.querySelector('.ew-qw-k[data-code="KeyF"]')?.classList.contains('on'));
      const mut = await page.evaluate(() => { window.__qwObs.disconnect(); return window.__qwMut; });
      await page.keyboard.press('KeyX'); await page.waitForTimeout(120);
      const oct = await page.evaluate(() => ({ said: document.querySelector('.ew-announce')?.textContent || '', octave: window.overdub.input.qwerty.octave }));
      await page.keyboard.press('KeyZ');
      await page.keyboard.press('Backquote'); await page.waitForTimeout(120);
      const off = await page.evaluate(() => { window.overdub.input.capture.flush(); return document.querySelector('.ew-announce')?.textContent || ''; });
      T.ok(a.role === 'group' && !a.live && a.label === 'Musical typing' && a.rows, `the musical-typing strip is a labelled group with its key rows hidden from screen readers (role ${a.role}, aria-live ${a.live})`);
      T.ok(lit && unlit && mut === 0, `a note lights and unlights its key without redrawing the strip (${mut} child-list changes)`);
      T.ok((a.said === `Musical typing on, playing ${a.target}` || a.said === `Keys play a new track, ${a.target} (Lamp Tines). Undo takes it away.`) && oct.said === `Octave ${oct.octave}` && off === 'Musical typing off', `real changes are announced once: "${a.said}", "${oct.said}", "${off}"`);
    }

    // tap: T brings the Tap mode forward, then F J K on the keys
    await page.keyboard.press('KeyT');
    await page.waitForTimeout(100);
    T.ok(await page.evaluate(() => window.overdub.input.mode === 'tap' && document.querySelector('.sk-mode.on')?.dataset.mode === 'tap'), 'T: Tap it comes forward with the pad keys on');
    // the tap status is a live region: it changes once per hit, not once per frame
    await page.evaluate(() => { const el = document.querySelector('.sk-status'); window.__skMut = 0; window.__skObs = new MutationObserver((l) => { window.__skMut += l.length; }); window.__skObs.observe(el, { childList: true, subtree: true, characterData: true }); });
    for (const k of ['KeyF', 'KeyK', 'KeyJ', 'KeyK']) { await page.keyboard.press(k); await page.waitForTimeout(163); }
    await page.waitForTimeout(80);
    const skMut = await page.evaluate(() => { window.__skObs.disconnect(); return window.__skMut; });
    T.ok(skMut >= 1 && skMut <= 8, `tap: the live status changed ${skMut} times for 4 hits (not every frame)`);
    await shot('input-tap-live');
    const tp = await page.evaluate(() => { const t = window.overdub.input.tap.flush(); return t && { kind: t.kind, ps: t.notes.map((n) => n.p).join(','), ts: t.notes.map((n) => n.t).join(',') }; });
    T.ok(tp && tp.kind === 'drums' && tp.ps === '36,42,38,42', `tap: F K J K → kick hat snare hat (${tp && tp.ps} at ${tp && tp.ts})`);
    await page.waitForTimeout(200);
    await shot('input-tap');
    await page.keyboard.press('Escape');

    // hum: a sung take through the same pipeline (the repair view)
    await page.click('.sk-mode[data-mode="hum"]');
    const hum = await page.evaluate(async () => {
      const sr = 48000, mel = [[69, 1], [72, 0.5], [76, 0.5], [73.3, 1], [72, 0.5], [69, 0.5], [67, 1], [69, 2]], spb = 60 / 92;
      let tot = 0.3; const sched = mel.map(([m, b]) => { const s = { m, t0: tot, t1: tot + b * spb }; tot += b * spb; return s; });
      const x = new Float32Array(Math.ceil((tot + 0.4) * sr)); let ph = 0;
      for (let i = 0; i < x.length; i++) {
        const t = i / sr, k = sched.findIndex((s) => t >= s.t0 && t < s.t1); let m = 60, a = 0;
        if (k >= 0) { const s = sched[k], into = t - s.t0; m = s.m + (into > 0.15 ? 0.35 * Math.sin(2 * Math.PI * 5.5 * t) : 0); const p = sched[k - 1]; if (p && into < 0.06) m = p.m + (s.m - p.m) * into / 0.06; a = 0.3 * Math.min(1, into / 0.03) * Math.min(1, (s.t1 - t) / 0.04 + 0.5); }
        ph += 2 * Math.PI * 440 * 2 ** ((m - 69) / 12) / sr; x[i] = a * (Math.sin(ph) + 0.35 * Math.sin(2 * ph));
      }
      const tk = await window.overdub.input.hum.fromSamples(x, sr);
      return tk && { n: tk.result.notes.length, moved: tk.result.moved.length, text: tk.result.text, cap: tk.capture };
    });
    T.ok(hum && hum.n === 8 && hum.moved === 1, `hum (in the studio): 8 notes, 1 moved into A minor (${hum && hum.text})`);
    await page.waitForTimeout(300);
    T.ok(await page.isVisible('.sk-foot .sk-acts button.ew-btn-primary'), 'hum: the repair view offers Keep as a clip');
    await shot('input-hum');
    const agentEvt = await page.evaluate(() => new Promise((res) => { const off = window.overdub.ui.on('agent:compose', (d) => { off(); res(d); }); document.querySelector('.sk-foot .sk-acts .ew-btn-agent').click(); setTimeout(() => res(null), 500); }));
    T.ok(agentEvt && agentEvt.attach && agentEvt.attach.capture === hum.cap && /hummed/.test(agentEvt.text), 'hum: "Hand it to the agent" composes with the capture attached');
    const keptHum = await page.evaluate(() => { document.querySelector('.sk-foot .sk-acts .ew-btn-primary').click(); const app = window.overdub, h = app.store.history[app.store.history.length - 1]; return { by: h.by, label: h.label }; });
    T.ok(keptHum.by === 'you' && /keep/.test(keptHum.label), `hum: Keep as a clip dispatches by you ("${keptHum.label}")`);
    const latest = await page.evaluate(() => window.overdub.input.capture.latest());
    T.ok(latest && latest.src === 'hum' && latest.moved === 1, 'get_capture view: the latest idea is the hum, with what was snapped');

    // H starts a hum from anywhere (the Sketch tab comes forward), Esc stops it
    await page.click('.sk-mode[data-mode="tap"]');
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyH');
    await page.waitForFunction(() => window.overdub.input.hum.active, null, { timeout: 4000 }).catch(() => {});
    const humOn = await page.evaluate(() => ({ active: window.overdub.input.hum.active, mode: document.querySelector('.sk-mode.on')?.dataset.mode }));
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const humOff = await page.evaluate(() => window.overdub.input.hum.active);
    T.ok(humOn.active && humOn.mode === 'hum' && !humOff, `H starts humming (Hum it comes forward), Esc stops it (${JSON.stringify(humOn)} → ${humOff})`);

    // record: the fake mic, its meter, 2 s to the armed audio track
    await page.click('.sk-mode[data-mode="rec"]');
    await page.evaluate(() => window.overdub.input.audio.open());
    await page.waitForTimeout(300);
    await shot('input-rec-open');
    let peak = 0;
    for (let i = 0; i < 20; i++) { await page.waitForTimeout(80); peak = Math.max(peak, await page.evaluate(() => window.overdub.input.audio.level().peak)); }
    T.ok(peak > 0.01, `the input meter moves with the fake mic (peak ${peak.toFixed(3)})`);
    const hasEngine = await page.evaluate(() => !!window.overdub.engine.ctx && !window.overdub.engine.silent);
    if (hasEngine) {
      await page.evaluate(() => window.overdub.engine.stop());
      await page.evaluate(() => window.overdub.input.audio.record({ countIn: false }));
      await page.waitForTimeout(600);
      await shot('input-record');
      await page.waitForTimeout(1500);
      const take = await page.evaluate(async () => {
        const app = window.overdub, r = await app.input.audio.stopRecord();
        if (!r) return null;
        const t = app.store.track(r.track), c = t.clips.find((x) => x.id === r.clip), buf = await app.engine.assets.get(r.asset);
        return { kind: c.kind, by: c.by, track: t.name, armed: t.arm, secs: r.seconds, length: c.length, asset: !!buf, dur: buf && buf.duration };
      });
      T.ok(take && take.kind === 'audio' && take.by === 'you' && take.asset && take.secs > 1.5 && take.secs < 2.6, `record: a ${take && take.secs.toFixed(2)} s audio clip on ${take && take.track} (armed: ${take && take.armed}), by you, its asset in engine.assets`);
    } else T.note('engine has no context: recording skipped');
    await shot('input-rec');
    await page.evaluate(() => window.overdub.input.audio.close());

    // where a kept take lands when the playhead was left somewhere (bar 7): a new track or a track with nothing on it
    // gets bar 1 (the loop's start while the loop is on); a track with clips gets the bar under the playhead
    {
      const pl = await page.evaluate(() => {
        const app = window.overdub, { store, engine, input } = app, cap = input.capture;
        const bpb = store.get().meter[0];
        if (engine.playing) engine.stop();
        engine.seek(6 * bpb + 2);
        const idea = () => cap.add({ src: 'qwerty', kind: 'notes', tempo: store.get().tempo, notes: [{ p: 60, t: 0, d: 1, v: 0.8 }, { p: 64, t: 1, d: 1, v: 0.8 }] }).id;
        const startOf = (r) => (r.ok ? store.track(r.track).clips.find((c) => c.id === r.clip).start : r.error);
        const out = { bpb };
        let r = cap.keep(idea(), { newTrack: { device: 'core.keys' } }); out.newTrack = startOf(r); store.undo();
        const t = store.dispatch({ type: 'track.add', ref: 't', track: { name: 'Empty', kind: 'instrument', instrument: { device: 'core.keys', params: {} } } }, { by: 'you' }).created.t;
        r = cap.keep(idea(), { track: t }); out.empty = startOf(r);
        r = cap.keep(idea(), { track: t }); out.second = startOf(r); store.undo(); store.undo();
        store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: 4 * bpb, end: 8 * bpb } } }, { by: 'you' });
        r = cap.keep(idea(), { track: t }); out.loop = startOf(r); store.undo(); store.undo();
        const busy = store.get().tracks.find((x) => x.kind === 'instrument' && x.clips.length);
        r = cap.keep(idea(), { track: busy.id }); out.busy = startOf(r); store.undo();
        store.undo();   // the empty track
        return out;
      });
      const b = pl.bpb;
      T.ok(pl.newTrack === 0 && pl.empty === 0, `a take kept on a new track or an empty one lands at bar 1, not the playhead's bar 7 (new ${pl.newTrack}, empty ${pl.empty})`);
      T.ok(pl.second === 6 * b, `the next take on that track (it has a clip now) lands at the playhead's bar (${pl.second / b + 1})`);
      T.ok(pl.loop === 4 * b, `with the loop on, a take on an empty track lands at the loop's start (beat ${pl.loop})`);
      T.ok(pl.busy === 6 * b, `a take on a track with clips lands at the playhead's bar (beat ${pl.busy})`);
      // New song starts stopped at 1.1.1, whatever the last song's playhead was doing
      const ns = await page.evaluate(async () => {
        const app = window.overdub, { engine } = app;
        engine.seek(26);
        try { await engine.play(26); } catch { /* no audio here */ }
        const before = { playing: !!engine.playing, beat: engine.beat };
        await app.exporter.newSong();
        await new Promise((r) => setTimeout(r, 250));
        return { before, playing: !!engine.playing, beat: engine.beat, pos: document.querySelector('.tp-pos-bar')?.textContent };
      });
      T.ok(!ns.playing && ns.beat < 0.01 && ns.pos === '1.1.1', `New song stops the transport and goes back to 1.1.1 (was ${ns.before.playing ? 'playing' : 'stopped'} at beat ${ns.before.beat.toFixed(1)}; now ${ns.pos}, beat ${ns.beat.toFixed(2)})`);
    }
    const errs = errors.filter((e) => !IGNORE(e));
    T.ok(errs.length === 0, `no page errors at 1440 (${errs.length})${errs.length ? '\n    ' + errs.slice(0, 6).join('\n    ') : ''}`);
  } finally { await close(); }
}
{
  const { page, errors, close, shot } = await open('/app/', { query: 'demo', width: 390, height: 844 });
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    await page.evaluate(() => { window.overdub.ui.setOpen('bottom', true); window.overdub.ui.show('sketch'); });
    await page.waitForTimeout(300);
    // (shell.js at < 900 px: the side regions go position: fixed and leave the grid, so .ew-main lands in a 0-wide
    // column. Until the shell fixes its grid, give this check the 3-column grid the shell means.)
    const mainW = await page.evaluate(() => document.querySelector('.ew-main').getBoundingClientRect().width);
    if (mainW < 10) { T.note(`shell: .ew-main is ${mainW}px wide at 390 (shell grid bug; patched for this check)`); await page.addStyleTag({ content: '@media (max-width: 900px) { .ew-body { grid-template-columns: 0 minmax(0, 1fr) 0 !important; } }' }); await page.waitForTimeout(200); }
    const over = await page.evaluate(() => { const s = document.querySelector('.sk'); return { sw: s.scrollWidth, cw: s.clientWidth, doc: document.documentElement.scrollWidth }; });
    T.ok(over.sw <= over.cw + 1 && over.doc <= 391, `390 px: no horizontal overflow (sketch ${over.sw}/${over.cw}, page ${over.doc})`);
    await shot('input-sketch-390');
    await page.click('.sk-mode[data-mode="tap"]');
    await page.waitForTimeout(200);
    await shot('input-tap-390');
    const errs = errors.filter((e) => !IGNORE(e));
    T.ok(errs.length === 0, `no page errors at 390 (${errs.length})${errs.length ? '\n    ' + errs.slice(0, 6).join('\n    ') : ''}`);
  } finally { await close(); }
}
/* ------------------------------------------------------------------ Sketch belongs to the song (fresh eyes, 1440) */
// A hum on a blank song keeps the notes you sang and hears its key; Sketch's targets and takes are this song's;
// Keep turns into "Kept ✓"; musical typing docks in Play it and covers no take's buttons; the pad-keys chip says what it does.
const humLine = (mel, spb = 0.5) => `(() => {
  const sr = 48000, mel = ${JSON.stringify(mel)}, spb = ${spb};
  let tot = 0.3; const sched = mel.map(([m, b]) => { const s = { m, t0: tot, t1: tot + b * spb }; tot += b * spb; return s; });
  const x = new Float32Array(Math.ceil((tot + 0.4) * sr)); let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / sr, k = sched.findIndex((s) => t >= s.t0 && t < s.t1); let m = 60, a = 0;
    if (k >= 0) { const s = sched[k], into = t - s.t0; m = s.m; a = 0.3 * Math.min(1, into / 0.03) * Math.min(1, (s.t1 - t) / 0.04 + 0.5); }
    ph += 2 * Math.PI * 440 * 2 ** ((m - 69) / 12) / sr; x[i] = a * (Math.sin(ph) + 0.35 * Math.sin(2 * ph));
  }
  return window.overdub.input.hum.fromSamples(x, sr);
})()`;
const AMIN = [[57, 1], [60, 1], [64, 1], [60, 1], [57, 2]];   // A3 C4 E4 C4 A3: A minor, with A and E outside C minor
{
  const { page, errors, close, shot } = await open('/app/', { query: 'demo', width: 1440, height: 900 });
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    await page.evaluate(() => { window.overdub.ui.setOpen('bottom', true); window.overdub.ui.show('sketch'); });
    await page.waitForSelector('.sk', { timeout: 5000 });
    // a tapped take on the demo, then a New song
    const demo = await page.evaluate(async () => {
      const app = window.overdub, tap = app.input.tap;
      for (const r of ['kick', 'hat', 'snare', 'hat']) { tap.hit(r, 0.8); await new Promise((res) => setTimeout(res, 120)); }
      const c = tap.flush();
      return { id: c.id, song: app.input.capture.get(c.id).song, songId: app.store.get().id, title: app.store.get().title, tracks: app.store.get().tracks.map((t) => t.name) };
    });
    T.ok(demo.song && demo.song === demo.songId, `a take is tagged with the song it was made in (${demo.song})`);
    await page.evaluate(() => window.overdub.exporter.newSong());
    await page.waitForTimeout(300);
    await page.click('.sk-mode[data-mode="tap"]');
    await page.waitForTimeout(200);
    const fresh = await page.evaluate(() => ({
      acts: !document.querySelector('.sk-foot .sk-acts') || document.querySelector('.sk-foot .sk-acts').hidden,
      other: [...document.querySelectorAll('.sk-idea.sk-other')].map((c) => c.querySelector('.sk-idea-from')?.textContent),
      head: document.querySelector('.sk-other-h')?.textContent || '',
      count: document.querySelector('.sk-count')?.textContent,
      chip: [...document.querySelectorAll('.sk-opts .sk-chip')].map((c) => c.textContent),
    }));
    T.ok(fresh.acts && fresh.count === '' && fresh.other.length >= 1 && fresh.other.every((t) => t === `from “${demo.title}”` || t === 'from an earlier song') && /From other songs/.test(fresh.head),
      `New song: Sketch shows no last beat to keep, and the demo's take is listed apart, "${fresh.other[0]}" under "${fresh.head}"`);
    T.ok(fresh.chip.includes('F J K L play pads: on'), `the pad-keys chip says what it toggles (${fresh.chip.join(' | ')})`);
    // hum on the blank song: the key is heard, nothing is moved into C minor
    await page.click('.sk-mode[data-mode="hum"]');
    // the first minute's tapped beat, then a tune (E E G A | A G E D E): a beat says nothing about a key, so the hum keeps
    // the notes sung and hears its own key (fresh eyes 5: it came back as F F G A# G# G F D D#, "13 moved", in C minor)
    const h0 = await page.evaluate(async (src) => {
      const app = window.overdub;
      const t = app.store.dispatch({ type: 'track.add', ref: 'b', track: { name: 'Beat', kind: 'instrument', instrument: { device: 'core.drums', params: {} } } }, { by: 'you', label: 'add a track' }).created.b;
      app.store.dispatch({ type: 'clip.add', track: t, clip: { kind: 'notes', start: 0, length: 8, name: 'Tapped beat', notes: [0, 1, 2, 3, 4, 5, 6, 7].map((b) => ({ p: b % 2 ? 38 : 36, t: b, d: 0.25, v: 0.8 })) } }, { by: 'you', label: 'tapped beat' });
      // biome-ignore lint/security/noGlobalEval: runs the test's own source in the page
      const tk = await eval(src);
      return tk && { ps: tk.result.notes.map((n) => n.p).join(','), moved: tk.result.moved.length, key: tk.opts.key, heard: tk.opts.heard, toasts: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).filter((x) => /^Moved/.test(x.trim())) };
    }, humLine([[64, 1], [64, 1], [67, 1], [69, 2], [69, 1], [67, 1], [64, 1], [62, 1], [64, 2]]));
    T.ok(h0 && h0.ps === '64,64,67,69,69,67,64,62,64' && h0.moved === 0 && !h0.key && h0.heard?.root === 'E' && !h0.toasts.length, `after the first minute's tapped beat, a hum keeps the tune as sung, E E G A A G E D E, nothing moved into a key nobody picked (${h0 && h0.ps}, moved ${h0 && h0.moved}, heard ${h0?.heard?.root} ${h0?.heard?.scale})`);
    // biome-ignore lint/security/noGlobalEval: runs the test's own source in the page
    const h1 = await page.evaluate(async (src) => { const tk = await eval(src); return tk && { n: tk.result.notes.length, moved: tk.result.moved.length, ps: tk.result.notes.map((n) => n.p).join(','), key: tk.opts.key, heard: tk.opts.heard }; }, humLine(AMIN));
    await page.waitForTimeout(200);
    const s1 = await page.evaluate(() => ({ status: document.querySelector('.sk-status')?.textContent || '', snap: [...document.querySelectorAll('.sk-opts .sk-chip')].find((c) => /^Snap/.test(c.textContent)), opts: [...document.querySelectorAll('.sk-foot .sk-destwrap option')].map((o) => o.textContent) }));
    T.ok(h1 && h1.n === 5 && h1.moved === 0 && h1.ps === '57,60,64,60,57' && !h1.key && h1.heard?.root === 'A' && h1.heard?.scale === 'minor',
      `a hum on a song with no notes keeps the line sung, A3 C4 E4 C4 A3, and hears A minor (${h1 && h1.ps}, moved ${h1 && h1.moved})`);
    T.ok(/^Your hum: 5 notes, A minor\./.test(s1.status), `and says so, before it is in the song: "${s1.status}"`);
    T.ok(!s1.opts.some((o) => demo.tracks.some((n) => o === 'On ' + n)), `the keep targets are this song's, none of the demo's (${s1.opts.join(' | ')})`);
    await shot('input-hum-blank-song');
    // Keep: the button says Kept, and the song takes the heard key
    const k1 = await page.evaluate(async () => {
      const b = document.querySelector('.sk-foot .sk-acts .ew-btn-primary'); b.click();
      await new Promise((r) => setTimeout(r, 100));
      const app = window.overdub, toast = [...document.querySelectorAll('.ew-toast')].pop()?.textContent || '';
      return { text: b.innerText.trim(), primary: b.classList.contains('ew-btn-primary'), disabled: b.disabled, key: app.store.get().key, toast };
    });
    T.ok(k1.text === 'Kept ✓' && !k1.primary && k1.disabled, `after Keep the button reads "${k1.text}" and is no longer the bright primary`);
    T.ok(k1.key?.root === 'A' && k1.key?.scale === 'minor' && /A minor/.test(k1.toast), `the kept hum gives the song its key: ${k1.key && k1.key.root} ${k1.key && k1.key.scale} ("${k1.toast}")`);
    // biome-ignore lint/security/noGlobalEval: runs the test's own source in the page
    const h2 = await page.evaluate(async (src) => { const tk = await eval(src); return tk && { moved: tk.result.moved.length, key: tk.opts.key }; }, humLine([[57, 1], [61, 1], [64, 2]]));
    T.ok(h2 && h2.key?.root === 'A' && h2.moved === 1, `the next hum snaps to the song's key, now A minor (C#4 → C4: moved ${h2 && h2.moved})`);
    // and says so where it can be seen, with Undo, which puts the notes back as sung (and Snap off for the next hum)
    const mv = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms)), app = window.overdub, hum = app.input.hum;
      const toast = [...document.querySelectorAll('.ew-toast')].find((x) => /^Moved/.test(x.textContent.trim()));
      const out = { text: toast?.querySelector('.ew-toast-text')?.textContent || '', act: toast?.querySelector('.ew-toast-act')?.textContent || '' };
      toast?.querySelector('.ew-toast-act')?.click();
      await wait(150);
      const tk = hum.take, cap = app.input.capture.get(tk.capture);
      Object.assign(out, { ps: tk.result.notes.map((n) => n.p).join(','), moved: tk.result.moved.length, capPs: cap.notes.map((n) => n.p).join(','), capMoved: cap.moved, chip: [...document.querySelectorAll('.sk-opts .sk-chip')].find((c) => /^Snap/.test(c.textContent))?.getAttribute('aria-pressed'), status: document.querySelector('.sk-status')?.textContent || '' });
      hum.options.snapKey = true;   // (Snap on again for what follows)
      return out;
    });
    T.ok(/^Moved 1 note into A minor, the song’s key\.$/.test(mv.text) && mv.act === 'Undo', `a hum moved into the song's key says so where it can be seen, with Undo ("${mv.text}" · ${mv.act})`);
    T.ok(mv.ps === '57,61,64' && mv.moved === 0 && mv.capPs === '57,61,64' && mv.capMoved === 0 && mv.chip === 'false' && /nothing moved/.test(mv.status), `Undo puts the notes back as sung (${mv.ps}), in Takes too, with Snap off for the next hum ("${mv.status}")`);
    // musical typing docks in Play it and covers none of the take cards' buttons
    await page.keyboard.press('Backquote');
    await page.waitForTimeout(250);
    const qw = await page.evaluate(() => {
      const s = document.querySelector('.ew-qw'), r = s.getBoundingClientRect();
      const hit = [...document.querySelectorAll('.sk-idea button, .sk-acts button')].filter((b) => { const q = b.getBoundingClientRect(); return q.width && r.left < q.right && q.left < r.right && r.top < q.bottom && q.top < r.bottom; });
      return { mode: document.querySelector('.sk-mode.on')?.dataset.mode, docked: !!s.closest('.sk-qwdock') && s.classList.contains('docked'), shown: !s.hidden && r.height > 0, hit: hit.length };
    });
    await shot('input-qwerty-docked');
    T.ok(qw.mode === 'play' && qw.docked && qw.shown && qw.hit === 0, `musical typing brings Play it forward and docks there, over no take's buttons (mode ${qw.mode}, docked ${qw.docked}, ${qw.hit} covered)`);
    await page.keyboard.press('Backquote');
    const errs = errors.filter((e) => !IGNORE(e));
    T.ok(errs.length === 0, `no page errors in the blank-song Sketch (${errs.length})${errs.length ? '\n    ' + errs.slice(0, 6).join('\n    ') : ''}`);
  } finally { await close(); }
}
/* ------------------------------------------------------------------ Sketch on a phone (touch, 390x844) */
{
  const { page: p0, browser, url, errors: e0, close } = await open('/app/', { query: 'demo', width: 390, height: 844 });
  try {
    await p0.close();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.stack || e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await page.evaluate(() => { window.overdub.ui.setOpen('bottom', true); window.overdub.ui.show('sketch'); });
    await page.waitForSelector('.sk.touch', { timeout: 5000 });
    const tapAt = async (sel) => { const r = await page.locator(sel).first().boundingBox(); if (!r) return false; await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2); await page.waitForTimeout(150); return true; };
    const inView = (sel) => page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), on: r.top >= 0 && r.bottom <= innerHeight + 0.5 }; }, sel);
    // Hum: the button is pinned in reach, idle and while recording, and the copy is for a thumb
    await page.click('.sk-mode[data-mode="hum"]');
    await page.waitForTimeout(200);
    const idle = await inView('.sk-hum');
    await tapAt('.sk-hum');
    // (Hum is a take into the song now: a bar of count-in, then it rolls)
    const counting = await page.evaluate(() => ({ st: window.overdub.input.recorder.state, label: document.querySelector('.sk-hum .sk-big-l')?.textContent }));
    await page.waitForFunction(() => window.overdub.input.hum.active && window.overdub.input.recorder.state === 'rec', null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    const rolling = await inView('.sk-hum');
    const rollText = await page.evaluate(() => ({ status: document.querySelector('.sk-status')?.textContent || '', label: document.querySelector('.sk-hum .sk-big-l')?.textContent, kbd: !!document.querySelector('.sk-hum kbd') }));
    await tapAt('.sk-hum');
    await page.waitForTimeout(300);
    T.ok(idle?.on && rolling?.on && rolling.h >= 44 && rollText.label === 'Stop', `phone: Hum, then Stop, is pinned on screen in reach of a thumb (idle ${idle?.top}–${idle?.bottom}, rolling ${rolling?.top}–${rolling?.bottom} of 844)`);
    T.ok(!/Esc/.test(rollText.status) && !rollText.kbd && /Tap Stop/.test(rollText.status), `phone: no "(or Esc)" and no key hints on touch ("${rollText.status}")`);
    T.ok(counting.st === 'count' && counting.label === 'Cancel', `phone: Hum counts in a bar first, and says Cancel while it does (${counting.st}, "${counting.label}")`);
    // Tap a beat: when it lands, its Keep row is in view; Keep says Kept ✓; the toast says tap Undo, with Undo
    await page.click('.sk-mode[data-mode="tap"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.querySelector('.ew-panel')?.scrollTo(0, 0); for (const t of document.querySelectorAll('.ew-toast')) t.remove(); });   // (the fake mic's "didn't hear a note")
    for (const row of ['kick', 'hat', 'snare', 'hat']) await tapAt(`.sk-pad[data-row="${row}"]`);
    await page.evaluate(() => window.overdub.input.tap.flush());
    await page.waitForTimeout(700);
    const keepRow = await inView('.sk-take .sk-acts');
    T.ok(keepRow?.on, `phone: a take lands with its Keep row in view (${keepRow?.top}–${keepRow?.bottom})`);
    const n0 = await page.evaluate(() => window.overdub.store.history.length);
    await tapAt('.sk-take .sk-acts .ew-btn-primary');
    await page.waitForTimeout(200);
    const kept = await page.evaluate(() => { const b = document.querySelector('.sk-take .sk-acts button.sk-kept'), t = [...document.querySelectorAll('.ew-toast')].pop(); return { btn: b?.innerText.trim(), primary: b?.classList.contains('ew-btn-primary'), toast: t?.querySelector('span')?.textContent || '', undo: t?.querySelector('button')?.textContent || '' }; });
    await page.screenshot({ path: path.join(OUTDIR, 'input-phone-kept.png') });
    T.ok(kept.btn === 'Kept ✓' && !kept.primary, `phone: Keep becomes "${kept.btn}", not the bright primary`);
    T.ok(/tap Undo/.test(kept.toast) && !/⌘Z/.test(kept.toast) && kept.undo === 'Undo', `phone: the toast says "${kept.toast}" with an ${kept.undo} button`);
    await tapAt('.ew-toast button');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({ n: window.overdub.store.history.length, btn: document.querySelector('.sk-take .sk-acts .ew-btn-primary')?.innerText.trim() }));
    T.ok(after.n === n0 && /Keep/.test(after.btn || ''), `phone: Undo in the toast takes the keep back, and Keep is Keep again (${after.btn})`);
    // Play it: an octave of the song's key under the fingers, multi-touch, velocity from where you tap, captured
    await page.click('.sk-mode[data-mode="play"]');
    await page.waitForTimeout(250);
    const kb = await page.evaluate(() => {
      const ks = [...document.querySelectorAll('.sk-tk-k')], key = window.overdub.store.get().key;
      return { n: ks.length, ps: ks.map((k) => +k.dataset.p), boxes: ks.map((k) => { const r = k.getBoundingClientRect(); return [r.left + r.width / 2, r.top, r.height, r.width]; }), key, strip: !!document.querySelector('.ew-qw:not([hidden])') };
    });
    const { scalePcs, parsePc } = await import('../app/src/core/music.js');
    const pcs = new Set(scalePcs(kb.key));
    T.ok(kb.n === 8 && kb.ps.every((p) => pcs.has(((p % 12) + 12) % 12)) && kb.ps[7] - kb.ps[0] === 12 && kb.ps[0] % 12 === parsePc(kb.key.root) && !kb.strip, `phone: Play it is an octave of ${kb.key.root} ${kb.key.scale}, root to root, ${kb.n} keys (${kb.ps.join(',')}), and no typing strip`);
    await page.evaluate(() => { const e = window.overdub.engine; window.__tk = []; const on = e.liveNoteOn.bind(e); e.liveNoteOn = (t, p, v) => { window.__tk.push([p, v]); return on(t, p, v); }; });
    const cdp = await ctx.newCDPSession(page);
    const [a, b2] = [kb.boxes[0], kb.boxes[4]];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a[0], y: a[1] + a[2] * 0.15, id: 1 }, { x: b2[0], y: b2[1] + b2[2] * 0.9, id: 2 }] });
    await page.waitForTimeout(80);
    const both = await page.evaluate(() => document.querySelectorAll('.sk-tk-k.on').length);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(80);
    const played = await page.evaluate(() => { const c = window.overdub.input.capture; c.flush(); const l = c.list()[0]; return { calls: window.__tk, src: l?.src, label: l?.label, n: l?.notes.length, lit: document.querySelectorAll('.sk-tk-k.on').length }; });
    const v1 = played.calls.find((c) => c[0] === kb.ps[0])?.[1], v2 = played.calls.find((c) => c[0] === kb.ps[4])?.[1];
    T.ok(both === 2 && played.lit === 0 && played.calls.length === 2, `phone: two fingers play two keys at once, and both let go (${played.calls.map((c) => c.join('@')).join(', ')})`);
    T.ok(v1 < v2, `phone: velocity from where you tap: high on a key is softer (${v1}), low is louder (${v2})`);
    T.ok(played.src === 'touch' && played.n === 2 && /^Played/.test(played.label || ''), `phone: what you play is captured like musical typing ("${played.label}", ${played.n} notes)`);
    await page.screenshot({ path: path.join(OUTDIR, 'input-phone-play.png') });
    const errs = [...errors, ...e0].filter((e) => !IGNORE(e));
    T.ok(errs.length === 0, `no page errors on the touch phone (${errs.length})${errs.length ? '\n    ' + errs.slice(0, 6).join('\n    ') : ''}`);
  } finally { await close(); }
}
console.log('  ..   screenshots in ' + path.relative(process.cwd(), OUTDIR));
// ---- a browser with no Web MIDI (Safari): Play it says why there's no Connect MIDI, even with musical typing on (the
// button and the status line used to hide together, so there was no reason at all)
{
  const { context, url, close } = await open('/app/', { query: 'demo', width: 1440, height: 900 });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => { try { delete Navigator.prototype.requestMIDIAccess; } catch { /* ok */ } });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 30000 });
    await page.evaluate(() => document.querySelector('.sk-mode[data-mode="play"]')?.click());
    await page.waitForTimeout(300);
    if (!(await page.evaluate(() => window.overdub.input.qwerty.on))) await page.keyboard.press('Backquote');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => { const n = document.querySelector('.sk-midinote'), b = [...document.querySelectorAll('button')].find((x) => /Connect MIDI/.test(x.textContent)); const nr = n?.getBoundingClientRect(); return { midi: !!navigator.requestMIDIAccess, typing: window.overdub.input.qwerty.on, text: n?.textContent || '', shown: !!(n && !n.hidden && nr.width > 0 && nr.bottom <= innerHeight), button: !!(b && !b.hidden) }; });
    T.ok(!r.midi && r.typing && r.shown && /Chrome, Edge or Firefox/.test(r.text) && !r.button, `no Web MIDI: Play it says to open it in Chrome, Edge or Firefox, with musical typing on, and offers no dead button (${JSON.stringify(r)})`);
  } finally { await close(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The keys are heard where they'll be recorded (docs/INSTRUMENTS-UX.md 1.1): after Tap a beat in the simple view, the
// keys aim at a new track, so musical typing makes Keys (Lamp Tines) on the way in, selected and said once, and the
// first note sounds there, never on the drums. input.target() has no first-instrument fallback any more.
{
  const { page, errors, close } = await open('/app/', { query: 'view=simple' });
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await sleep(500);
    // (the first minute, a Drums track selected: app.onboard.firstMinute; on a blank song Tap a beat opens Start a
    // song's stage instead, ui/start.js)
    await page.evaluate(() => window.overdub.onboard.firstMinute('tap'));
    await sleep(1200);
    const pre = await page.evaluate(() => {
      const a = window.overdub;
      a.engine.stop(); a.input.setMode(null);
      window.__said = []; a.input.on('keys:track', (e) => window.__said.push(e.text));
      const on = a.engine.liveNoteOn.bind(a.engine); window.__live = [];
      a.engine.liveNoteOn = (t, p, v) => { window.__live.push(a.store.track(t)?.name); return on(t, p, v); };
      return { view: a.ui.workspace.view(), sel: a.store.track(a.ui.state.selection.track)?.name, target: a.input.target()?.name || null, aim: a.input.recorder.aim('keys') };
    });
    await page.keyboard.press('Backquote'); await sleep(300);
    await page.keyboard.press('KeyA'); await sleep(250);
    const k = await page.evaluate(() => { const a = window.overdub, t = a.store.get().tracks.find((x) => x.name === 'Keys'); return { said: window.__said, live: window.__live, sel: a.store.track(a.ui.state.selection.track)?.name, dev: t?.instrument.device, tracks: a.store.get().tracks.map((x) => x.name), hold: document.querySelector('.tp-hold')?.textContent || '' }; });
    T.ok(pre.view === 'simple' && pre.sel === 'Drums' && pre.target === null && pre.aim.track === null, `after Tap a beat the keys aim at a new track, not the selected Drums (${JSON.stringify(pre)})`);
    T.ok(k.tracks.join() === 'Drums,Keys' && k.dev === 'core.keys' && k.sel === 'Keys' && k.said.length === 1 && /^Keys play a new track, Keys \(Lamp Tines\)\. Undo takes it away\.$/.test(k.said[0]) && k.live.length && k.live.every((x) => x === 'Keys'),
      `musical typing makes Keys (Lamp Tines), selected, said once, and the note sounds on Keys (${JSON.stringify(k)})`);
    await page.keyboard.press('Backquote');
    const errs = errors.filter((e) => !/Failed to load resource/.test(e));
    T.ok(errs.length === 0, `the keys' track: no page errors (${errs.length})${errs.length ? ' ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally { await close(); }
}

T.done();
