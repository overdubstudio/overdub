// The inputs area's Node half: YIN, what capture makes of sloppy playing (tools/sloppy.js), the tuners over played and
// plucked strings, monitoring, the hum, tap, latency math, capture across a loop wrap and MIDI input choice. Moved
// intact from tools/input-test.js; the studio flows (musical typing, the fake mic, Sketch, the guitar room) stay there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yin, ftom, segment, frames, createPitchTracker } from '../../app/src/input/pitch.js';
import * as PITCH from '../../app/src/input/pitch.js';
import { phrase, render as renderVoice, makePhrase, scoreNotes } from '../../tools/hum-bench.js';
import v8 from 'node:v8';
import vm from 'node:vm';
import { hear, transcribe, guessKey, keyChosen } from '../../app/src/input/hum.js';
import { beatbox, toDrums, onsets } from '../../app/src/input/tap.js';
import { onset, xcorr, chirp, hits, median } from '../../app/src/input/latency.js';
import { noteName } from '../../app/src/core/music.js';
import { createCapture } from '../../app/src/input/capture.js';
import { createStore } from '../../app/src/core/store.js';

let seed = 12345;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
// A plucked string, made of its harmonics (so its pitch is exact): a pluck's comb on them, the high ones dying first.
function pluck(buf, sr, midi, t0, dur, { cents = 0, amp = 0.25, rng }) {
  const f = 440 * 2 ** ((midi - 69 + cents / 100) / 12),
    a = Math.round(t0 * sr),
    b = Math.min(buf.length, a + Math.round(dur * sr));
  const t60 = 3.2 * 2 ** (-(midi - 40) / 36),
    att = 0.002 * sr,
    rel = 0.02 * sr;
  for (let k = 1; k <= 16 && k * f < 7000; k++) {
    const ak = (amp * (k === 1 ? 1 : 0.85 / k) * Math.abs(Math.sin(Math.PI * k * 0.17))) / Math.sin(Math.PI * 0.17);
    const tau = t60 / 6.9 / (1 + 0.35 * (k - 1)),
      ph = rng() * 2 * Math.PI,
      w = (2 * Math.PI * k * f) / sr;
    for (let i = a; i < b; i++) {
      const n = i - a;
      buf[i] +=
        ak * Math.min(1, n / att) * Math.exp(-n / sr / tau) * (i > b - rel ? (b - i) / rel : 1) * Math.sin(w * n + ph);
    }
  }
}
// A take: [kind, ...] parts in a row. 'open': the six open strings, the G 15 cents flat; 'lick': A minor pentatonic
// with its blue note in 8ths; 'chords': A7, D7 and E7 stabs strummed, then an A5 let ring; 'g': the G string alone.
function guitarTake(sr, kinds) {
  let s = 99;
  const rng = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const buf = new Float32Array(Math.round(16 * sr)),
    parts = [];
  let t = 0.2;
  for (const kind of kinds) {
    if (kind === 'open' || kind === 'g')
      for (const [m, c] of kind === 'g'
        ? [[55, -15]]
        : [
            [40, 0],
            [45, 0],
            [50, 0],
            [55, -15],
            [59, 0],
            [64, 0],
          ]) {
        pluck(buf, sr, m, t, 1.1, { cents: c, rng });
        parts.push({ kind: 'open', m, c, t0: t, t1: t + 1.1 });
        t += 1.1;
      }
    if (kind === 'lick') {
      for (const m of [57, 60, 62, 63, 64, 67, 69, 67, 64, 62, 60, 57]) {
        pluck(buf, sr, m, t, 0.34, { amp: 0.22, rng });
        parts.push({ kind: 'lick', m, t0: t, t1: t + 0.3 });
        t += 0.3;
      }
      t += 0.3;
    }
    if (kind === 'chords') {
      for (const [name, ms, d] of [
        ['A7', [45, 52, 55, 61, 64], 0.55],
        ['D7', [50, 57, 60, 66], 0.55],
        ['E7', [40, 47, 50, 56, 59, 64], 0.55],
        ['A5', [45, 52, 57], 1.2],
      ]) {
        ms.forEach((m, i) => pluck(buf, sr, m, t + i * 0.012, d, { amp: 0.16, rng }));
        parts.push({ kind: 'chord', name, t0: t, t1: t + d });
        t += d + 0.15;
      }
    }
  }
  const out = buf.subarray(0, Math.round((t + 0.2) * sr));
  for (let i = 0; i < out.length; i++) out[i] += (rng() - 0.5) * 0.001;
  return { buf: out, parts };
}

test('YIN', async () => {
  {
    let worst = 0,
      worstAt = 0;
    for (const sr of [44100, 48000]) {
      for (let m = 33; m <= 81; m++) {
        // A1 .. A5
        const hz = 440 * 2 ** ((m - 69) / 12),
          b = new Float32Array(4096);
        for (let i = 0; i < b.length; i++)
          b[i] = 0.4 * Math.sin((2 * Math.PI * hz * i) / sr + 0.7) + 0.12 * Math.sin((4 * Math.PI * hz * i) / sr);
        const y = yin(b, sr, { lo: 40 });
        const c = y.hz ? Math.abs(ftom(y.hz) - m) * 100 : 999;
        if (c > worst) {
          worst = c;
          worstAt = m;
        }
      }
    }
    assert.ok(
      worst < 5,
      `YIN A1..A5 (49 notes, 44.1 and 48 kHz) within 5 cents (worst ${worst.toFixed(2)}¢ at ${noteName(worstAt)})`,
    );
    const noise = new Float32Array(4096);
    for (let i = 0; i < noise.length; i++) noise[i] = 0.3 * (rnd() - 0.5);
    assert.ok(yin(noise, 48000).hz === 0, 'YIN hears no pitch in noise (a breath)');
  }
});

test('the tuner over a played guitar', async () => {
  const E2 = 440 * 2 ** ((40 - 69) / 12),
    FRET22 = 440 * 2 ** ((86 - 69) / 12); // a guitar's range in standard tuning
  {
    // The tracker on its own: a held A2 that jumps to E3. While the pitch has moved and the held note hasn't caught up,
    // the reading isn't settled and has no cents (main measured the E3 against the held A2: 700 cents sharp).
    const tr = PITCH.createTracker(),
      seen = [];
    for (let i = 0; i < 20; i++) seen.push({ ...tr.push({ t: i * 0.04, hz: i < 10 ? 110 : 164.814, conf: 0.9 }) });
    const off = seen.filter((x) => x.cents != null && Math.abs(x.cents) > 50).map((x) => x.cents);
    const last = seen[seen.length - 1];
    assert.ok(
      !off.length && seen.some((x) => x.p === 45 && !x.stable) && last.p === 52 && last.stable && last.cents === 0,
      `tracker: a held A2 that jumps to E3 is never measured against the A2 (${off.length ? 'cents ' + off.join(', ') : 'no cents past ±50'}), reads unsettled while it moves, then settles on E3 (${last.p}, ${last.cents} cents)`,
    );

    // The tuner as audio.tune({ lo, hi }) runs it, over a played phrase: the open strings, a lick, chord stabs. (Main had
    // no range and no createTuner: YIN down to 38 Hz into the tracker, which is what this falls back to there.)
    const sr = 48000,
      { buf, parts } = guitarTake(sr, ['open', 'lick', 'chords']);
    const tuner = PITCH.createTuner
      ? PITCH.createTuner({ lo: E2, hi: FRET22 })
      : (() => {
          const tr2 = PITCH.createTracker(),
            y = {};
          return {
            push: (b, r, t) => {
              yin(b, r, { lo: 38, hi: 1400, out: y });
              const x = tr2.push({ t, hz: y.hz, conf: y.conf });
              return x.p ? { p: x.p, cents: x.cents, stable: x.stable } : null;
            },
          };
        })();
    const win = new Float32Array(4096),
      reads = [];
    for (let t = 0.1; t * sr < buf.length; t += 0.04) {
      const e = Math.round(t * sr);
      for (let i = 0; i < win.length; i++) {
        const j = e - win.length + i;
        win[i] = j >= 0 ? buf[j] : 0;
      }
      const r = tuner.push(win, sr, t),
        at = parts.find((x) => t >= x.t0 && t < x.t1 + 0.05);
      if (r) reads.push({ ...r, t, at });
    }
    const opens = parts
      .filter((x) => x.kind === 'open')
      .map((x) => {
        const mid = reads.filter((r) => r.at === x && r.t > x.t0 + 0.3 && r.t < x.t1 - 0.1);
        return {
          name: noteName(x.m),
          ok: mid.length >= 10 && mid.every((r) => r.stable && r.p === x.m && Math.abs(r.cents - x.c) <= 2),
          cents: mid.length ? mid[mid.length >> 1].cents : null,
        };
      });
    assert.ok(
      opens.every((x) => x.ok),
      `tuner: each open string reads its note and cents once settled (${opens.map((x) => `${x.name} ${x.cents}`).join(', ')}; the G was tuned 15 cents flat)`,
    );
    const loud = reads.filter((r) => r.cents != null && (Math.abs(r.cents) > 50 || !r.stable));
    assert.ok(
      !loud.length && reads.some((r) => r.at?.kind === 'lick' && r.stable) && reads.some((r) => r.cents == null),
      `tuner: cents only once a note has settled, never past ±50, through the lick's changes too (${
        loud.length
          ? loud
              .slice(0, 4)
              .map((r) => `${noteName(r.p)} ${r.cents} at ${r.t.toFixed(2)} s`)
              .join(', ')
          : 'none past ±50 or unsettled'
      })`,
    );
    const low = reads.filter((r) => r.p < 40),
      chordSettled = reads.filter((r) => r.at?.kind === 'chord' && r.stable);
    assert.ok(
      !low.length && !chordSettled.length,
      `tuner: with a guitar's range nothing reads under the low E, and nothing settles during the A7, D7, E7 and A5 (${
        low.length
          ? low
              .slice(0, 3)
              .map((r) => noteName(r.p))
              .join(', ') + ' under it; '
          : ''
      }${chordSettled.length} settled readings on chords)`,
    );
  }
});

test('monitoring by itself and the feedback guard', async () => {
  // Monitoring starts by itself for an instrument interface or line input, never for a microphone: what an input is comes
  // from its name. Then the guard that turns monitoring off when a microphone hears itself through the speakers.
  const AUDIOIN = await import('../../app/src/input/audioin.js');
  {
    const kind = AUDIOIN.inputKind || (() => 'none');
    const ifaces = [
      'Scarlett 2i2 USB',
      'Microphone (Focusrite USB Audio)',
      'UMC204HD 192k',
      'Audient iD14',
      'EVO4',
      'Apogee Jam+',
      'BOSS KATANA',
      'HX Stomp',
      'Line 6 POD Go',
      'iRig HD 2',
      'MOTU M2',
      'Steinberg UR22C',
      'Volt 2',
      'SSL 2+',
      'Line In (Realtek Audio)',
    ];
    const mics = [
      'MacBook Pro Microphone',
      'Built-in Microphone',
      'Default - MacBook Pro Microphone (Built-in)',
      'Internal Microphone',
      'FaceTime HD Camera',
      'Logitech Webcam C920',
      'AirPods Pro',
      "AJ's iPhone Microphone",
      'Headset Microphone (Jabra EVOLVE 20)',
      'Yeti Stereo Microphone',
      'Default',
    ];
    const wrong = [
      ...ifaces.filter((l) => kind(l, { channels: 2 }) !== 'interface'),
      ...mics.filter((l) => kind(l, { channels: 1 }) !== 'mic'),
    ];
    const other = {
      def: kind('Default - Scarlett 2i2 USB', { channels: 2 }),
      loop: kind('BlackHole 2ch', { channels: 2 }),
      oneCh: kind('USB PnP Sound Device', { channels: 1, isDefault: true }),
    };
    assert.ok(
      !wrong.length && other.def === 'interface' && other.loop === 'virtual' && other.oneCh === 'mic',
      `an input's kind from its name: ${ifaces.length} interfaces and line inputs, ${mics.length} microphones${wrong.length ? '; wrong: ' + wrong.join(', ') : ''}; the browser's default reads as its device, a loopback is virtual, an unnamed one-channel default is a microphone`,
    );
  }
  {
    // Feedback: a sine ringing up from -60 dBFS at 10-80 dB a second, alone or over a strummed guitar. Guitar playing:
    // held notes decaying, a lick, chord stabs, volume swells, tremolo crescendos. (A lone howl trips within half a
    // second of starting; one under strumming once it's as loud as the guitar.)
    const sr = 48000,
      mk = (seed) => {
        let s = seed;
        return () => (s = (s * 16807) % 2147483647) / 2147483647;
      };
    const noise = (b, rng) => {
      for (let i = 0; i < b.length; i++) b[i] += (rng() - 0.5) * 0.001;
      return b;
    };
    const howl = (b, f, rate, t0) => {
      const a0 = Math.round(t0 * sr);
      let ph = 0;
      for (let i = a0; i < b.length; i++) {
        const db = Math.min(-3, -60 + (rate * (i - a0)) / sr);
        ph += (2 * Math.PI * f) / sr;
        b[i] += 10 ** (db / 20) * Math.SQRT2 * Math.sin(ph);
      }
      return b;
    };
    const strums = (b, rng) => {
      for (let k = 0; k < 9; k++)
        [40, 47, 52, 56, 59, 64].forEach((m, i) =>
          pluck(b, sr, m, 0.2 + k * 0.7 + i * 0.012, 0.69, { amp: 0.12, rng }),
        );
      return b;
    };
    const swell = (m, len, rng) => {
      const b = new Float32Array(sr * 3);
      pluck(b, sr, m, 0.2, 2.6, { amp: 0.3, rng });
      for (let i = 0; i < b.length; i++) {
        const t = i / sr - 0.2;
        b[i] *= t < 0 ? 0 : Math.min(1, (t / len) ** 2);
      }
      return b;
    };
    const tremolo = (m, rng) => {
      const b = new Float32Array(sr * 4.5);
      for (let k = 0; k < 40; k++) pluck(b, sr, m, 0.2 + k * 0.1, 0.12, { amp: 0.02 + k * 0.006, rng });
      return b;
    };
    const listen = (b) => {
      if (!AUDIOIN.createFeedbackGuard) return { at: null, ms: 0 };
      const g = AUDIOIN.createFeedbackGuard(),
        win = new Float32Array(4096);
      let ms = 0,
        n = 0;
      for (let t = 0.1; t * sr < b.length; t += 0.05) {
        const e = Math.round(t * sr);
        for (let i = 0; i < win.length; i++) {
          const j = e - win.length + i;
          win[i] = j >= 0 ? b[j] : 0;
        }
        const t0 = performance.now(),
          hit = g.push(win, sr, t);
        ms += performance.now() - t0;
        n++;
        if (hit) return { at: t, ms: ms / n };
      }
      return { at: null, ms: ms / n };
    };
    const feed = [],
      cost = [];
    for (const f of [150, 440, 1250, 2700, 6000])
      for (const rate of [10, 40, 80]) {
        const r = listen(noise(howl(new Float32Array(sr * 3), f, rate, 0.5), mk(f + rate)));
        cost.push(r.ms);
        feed.push({ name: `${f} Hz +${rate} dB/s`, at: r.at, ok: r.at != null && r.at - 0.5 <= 0.5 });
      }
    for (const f of [700, 2100]) {
      const r = listen(noise(howl(strums(new Float32Array(sr * 6.5), mk(f)), f, 40, 1.0), mk(f)));
      feed.push({ name: `${f} Hz +40 dB/s under strums`, at: r.at, ok: r.at != null });
    }
    const missed = feed.filter((x) => !x.ok),
      quickest = Math.min(...feed.filter((x) => x.at != null && !/strums/.test(x.name)).map((x) => x.at - 0.5));
    assert.ok(
      !missed.length && quickest >= 0.3 - 1e-6,
      `feedback guard: ${feed.length} howls (150 Hz to 6 kHz, 10 to 80 dB/s, two under a strummed guitar) all trip it, the lone ones within ${Math.max(...feed.filter((x) => !/strums/.test(x.name) && x.at != null).map((x) => x.at - 0.5)).toFixed(2)} s of starting and none before ${quickest.toFixed(2)} s${missed.length ? '; missed: ' + missed.map((x) => x.name).join(', ') : ''} (${(cost.reduce((a, b) => a + b, 0) / Math.max(1, cost.length)).toFixed(2)} ms a look)`,
    );
    const safe = [];
    const rng = mk(11);
    {
      const b = new Float32Array(sr * 17);
      [40, 50, 59, 69].forEach((m, i) => pluck(b, sr, m, 0.2 + i * 4, 4, { amp: 0.3, rng }));
      safe.push(['held notes, 4 s each, ringing out', b]);
    }
    {
      const { buf } = guitarTake(sr, ['open', 'lick', 'chords']);
      safe.push(['the open strings, a lick, stabs', buf]);
    }
    for (const m of [40, 52, 64, 76])
      for (const len of [0.3, 1]) safe.push([`a swell on ${noteName(m)} over ${len} s`, swell(m, len, rng)]);
    for (const m of [40, 55, 69, 81]) safe.push([`tremolo picking a crescendo on ${noteName(m)}`, tremolo(m, rng)]);
    const tripped = safe.map(([name, b]) => ({ name, at: listen(noise(b, rng)).at })).filter((x) => x.at != null);
    assert.ok(
      AUDIOIN.createFeedbackGuard && !tripped.length,
      `feedback guard: ${safe.length} kinds of guitar playing never trip it (held notes decaying, a lick, chord stabs, volume swells, tremolo crescendos)${tripped.length ? '; tripped: ' + tripped.map((x) => `${x.name} at ${x.at.toFixed(2)} s`).join(', ') : ''}`,
    );
  }
});

test('hum: a synthetic, untrained voice', async () => {
  function sing(
    mel,
    { sr = 48000, bpm = 100, vibrato = 0.45, glide = 0.07, drift = 0.15, breath = true, legatoRepeat = true } = {},
  ) {
    const spb = 60 / bpm;
    let tot = 0.4;
    const sched = [];
    for (const [m, b, g = 0] of mel) {
      tot += g * spb;
      sched.push({ m, t0: tot, t1: tot + b * spb });
      tot += b * spb;
    }
    const N = Math.ceil((tot + 0.6) * sr),
      x = new Float32Array(N);
    let ph = 0;
    for (let i = 0; i < N; i++) {
      const t = i / sr,
        k = sched.findIndex((s) => t >= s.t0 && t < s.t1);
      let amp = 0,
        m = 60;
      if (k >= 0) {
        const s = sched[k],
          into = t - s.t0,
          left = s.t1 - t,
          prev = sched[k - 1];
        m = s.m + drift * Math.sin(t * 0.7);
        const joined = prev && Math.abs(prev.t1 - s.t0) < 1e-6;
        if (joined && prev.m !== s.m && into < glide) m = prev.m + (s.m - prev.m) * (into / glide); // a slide into the note
        if (into > 0.15) m += vibrato * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, (into - 0.15) / 0.2);
        amp = 0.3 * Math.min(1, into / 0.03) * Math.min(1, left / 0.04 + 0.5);
        // a repeated note sung legato: only a short dip in level between the two syllables
        if (legatoRepeat && joined && prev.m === s.m) amp *= Math.min(1, 0.15 + into / 0.035);
      }
      ph += (2 * Math.PI * 440 * 2 ** ((m - 69) / 12)) / sr;
      x[i] = amp * (Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.15 * Math.sin(3 * ph)) + 0.003 * (rnd() - 0.5);
      if (breath && ((t > 0.05 && t < 0.3) || (sched[8] && t > sched[8].t0 - 0.25 && t < sched[8].t0 - 0.05)))
        x[i] += 0.06 * (rnd() - 0.5);
    }
    return { x, sched, sr, spb };
  }
  {
    // A minor: two phrases, slides between notes, vibrato on the long ones, a breath between, and a repeated A sung legato
    const mel = [
      [69, 1],
      [72, 0.5],
      [76, 0.5],
      [74, 1],
      [72, 0.5],
      [69, 0.5],
      [67, 1],
      [69, 1],
      [69, 1],
      [69, 0.5, 0.5],
      [71, 0.5],
      [72, 1],
      [64, 1],
    ];
    const s = sing(mel);
    const t0 = performance.now();
    const { segs } = hear(s.x, s.sr);
    const ms = performance.now() - t0;
    const want = mel.map(([m]) => m);
    const got = segs.map((g) => g.p);
    assert.ok(
      JSON.stringify(got) === JSON.stringify(want),
      `hum: ${want.length} sung notes recovered through vibrato, slides, drift and breath (${got.map(noteName).join(' ')}) in ${Math.round(ms)} ms`,
    );
    const r = transcribe(segs, { tempo: 100, key: { root: 'A', scale: 'minor' }, origin: s.sched[0].t0 });
    const wantT = s.sched.map((x) => Math.round(((x.t0 - s.sched[0].t0) / s.spb) * 4) / 4);
    assert.ok(
      r.notes.length === want.length && r.notes.every((n, i) => Math.abs(n.t - wantT[i]) < 1e-6),
      `hum: onsets quantised to the 16th grid at the song's tempo (${r.text.split(' ').slice(0, 5).join(' ')} …)`,
    );
    assert.ok(
      r.moved.length === 0 && r.low === 0,
      'hum: an in-tune, in-key take moves nothing and is sure of every note',
    );
    assert.ok(
      guessKey(r.notes.map((n) => ({ p: n.p, d: n.d })))?.root === 'A',
      `hum: key guess from the notes is A (${r.keyGuess.root} ${r.keyGuess.scale})`,
    );
  }
  {
    // snapping: a flat singer (40 cents low on one note, a C#5 sung where A minor wants C or D) and a lazy rhythm
    const mel = [
      [69, 1],
      [73.4, 1],
      [76, 1],
      [72, 1],
    ];
    const s = sing(mel, { vibrato: 0.2, drift: 0 });
    const { segs } = hear(s.x, s.sr);
    const key = { root: 'A', scale: 'minor' };
    const snapped = transcribe(segs, { tempo: 100, key, snapKey: true, origin: s.sched[0].t0 });
    const raw = transcribe(segs, { tempo: 100, key, snapKey: false, origin: s.sched[0].t0 });
    assert.ok(
      snapped.notes[1].p === 74 && snapped.moved.length === 1 && snapped.moved[0].from === 73,
      `snap to key: the off note (raw ${noteName(raw.notes[1].p)}) moves to ${noteName(snapped.notes[1].p)} and is reported (${snapped.moved.length} moved)`,
    );
    assert.ok(raw.notes[1].p === 73 && raw.moved.length === 0, 'snap off: the note stays where it was sung');
    // grid vs keep my timing: shift the take 70 ms late against its origin
    const late = transcribe(segs, { tempo: 100, key, origin: s.sched[0].t0 - 0.07, grid: 0.5 });
    const kept = transcribe(segs, { tempo: 100, key, origin: s.sched[0].t0 - 0.07, keepTiming: true });
    assert.ok(
      late.notes.every((n) => Math.abs(n.t / 0.5 - Math.round(n.t / 0.5)) < 1e-9),
      `grid 1/8: every start on the grid (${late.notes.map((n) => n.t).join(', ')})`,
    );
    assert.ok(
      kept.notes.some((n) => Math.abs(n.t * 4 - Math.round(n.t * 4)) > 0.01),
      `keep my timing: starts stay off the grid (${kept.notes.map((n) => n.t).join(', ')})`,
    );
    const lowConf = segment(
      frames(
        new Float32Array(48000).map(() => 0.2 * (rnd() - 0.5)),
        48000,
      ),
    );
    assert.ok(lowConf.length === 0, 'hum: a breath alone makes no notes');
  }
});

test('hum: whose key it is', async () => {
  {
    // After the first minute's tapped beat a hum came back in a key nobody picked ("E E G A" as "F F G A#", 13 moved
    // into C minor): the drum hits counted as the song having a key. Only a key a person set, or a pitched part, counts.
    const cmin = { root: 'C', scale: 'minor' };
    const beat = {
      kind: 'instrument',
      name: 'Drums',
      instrument: { device: 'core.drums' },
      clips: [
        {
          kind: 'notes',
          notes: [
            { p: 36, t: 0, d: 0.25, v: 0.8 },
            { p: 38, t: 1, d: 0.25, v: 0.8 },
          ],
        },
      ],
    };
    const tune = {
      kind: 'instrument',
      name: 'Keys',
      instrument: { device: 'core.keys' },
      clips: [{ kind: 'notes', notes: [{ p: 60, t: 0, d: 1, v: 0.8 }] }],
    };
    const take = { kind: 'audio', name: 'Audio', clips: [{ kind: 'audio', asset: 'a_x', start: 0, length: 8 }] };
    const setKey = [{ ops: [{ type: 'project.set', patch: { key: cmin } }] }];
    const got = {
      blank: keyChosen({ key: cmin, tracks: [] }),
      beat: keyChosen({ key: cmin, tracks: [beat] }),
      audio: keyChosen({ key: cmin, tracks: [take] }),
      tune: keyChosen({ key: cmin, tracks: [beat, tune] }),
      set: keyChosen({ key: cmin, tracks: [beat] }, setKey),
      other: keyChosen({ key: { root: 'A', scale: 'minor' }, tracks: [] }),
    };
    assert.ok(
      !got.blank && !got.beat && !got.audio,
      `a blank song's default C minor isn't a chosen key, and a tapped beat or an audio take doesn't make it one (${JSON.stringify(got)})`,
    );
    assert.ok(
      got.tune && got.set && got.other,
      "a pitched part, a key set by a person, or a key other than the default is the song's key",
    );
    // "13 moved" over 9 notes: what was moved is counted among the notes it became, not the ones that gave their step away
    const seg = (midi, t0, t1, conf, db = -12) => ({ midi, p: Math.round(midi), t0, t1, conf, db, cents: 0 });
    const r = transcribe([seg(60, 0, 0.45, 0.95), seg(61.1, 0.01, 0.1, 0.5), seg(67, 0.5, 0.95, 0.9)], {
      tempo: 120,
      key: cmin,
      origin: 0,
    });
    assert.ok(
      r.notes.length === 2 && r.moved.length === r.notes.filter((n) => n.moved != null).length,
      `moved notes are the ones in the take (${r.notes.length} notes, ${r.moved.length} moved; a C#4 that lost its step to C4 isn't one)`,
    );
    // a key heard in a hum is spelled the way it is written: Eb minor, not D# minor; Db major, not C# major
    const ebm = guessKey([63, 65, 66, 68, 70, 71, 73, 75, 63, 66, 70].map((p) => ({ p, d: 1 })));
    const dbM = guessKey([61, 63, 65, 66, 68, 70, 72, 73, 61, 65, 68].map((p) => ({ p, d: 1 })));
    assert.ok(
      ebm?.root === 'Eb' && ebm.scale === 'minor' && dbM?.root === 'Db' && dbM.scale === 'major',
      `a heard key's root is spelled as written (${ebm?.root} ${ebm?.scale}, ${dbM?.root} ${dbM?.scale})`,
    );
  }
});

test('hum: the hard cases', async () => {
  {
    // a glottal-pulse voice through formants, with breath and room noise: the cases an untrained voice brings
    const run = (ph) => {
      const au = renderVoice(ph);
      const { segs, frames: fr } = hear(au.x, au.sr);
      return { au, segs, fr, sc: scoreNotes(au.notes, segs) };
    };
    const got = (segs) => segs.map((g) => noteName(g.p)).join(' ');
    // repeated notes sung legato, only a dip in level between them (no gap, no pitch change)
    const rep = run(
      phrase(
        [
          { m: 62, beats: 1 },
          { m: 62, beats: 0.5, dip: 10 },
          { m: 62, beats: 0.5, dip: 8 },
          { m: 62, beats: 1, dip: 12 },
          { m: 64, beats: 1 },
        ],
        { tempo: 96 },
      ),
    );
    assert.ok(
      rep.sc.tp === 5 && rep.segs.length === 5,
      `hum: three repeats split by a dip in level alone are four D4s, then E4 (${got(rep.segs)})`,
    );
    // a long note with a wide vibrato (±80 cents at 5 Hz): one note, and its pitch is the vibrato's centre
    const vib = run(
      phrase(
        [
          { m: 57, beats: 4, vib: [5, 0.8] },
          { m: 60, beats: 1 },
        ],
        { tempo: 90, style: 'sung' },
      ),
    );
    assert.ok(
      vib.segs.length === 2 && vib.segs[0].p === 57 && Math.abs(vib.segs[0].cents) < 15,
      `hum: a 2.7 s note with ±80-cent vibrato is one A3 (${got(vib.segs)}, ${vib.segs[0]?.cents} cents)`,
    );
    // scoops: 2 semitones from below over 180 ms; the note starts where the scoop does and is the note it reaches
    const sc = run(
      phrase(
        [
          { m: 60, beats: 1, scoop: [2, 0.18] },
          { m: 64, beats: 1, scoop: [2.5, 0.16] },
          { m: 67, beats: 1, gap: 0.5, scoop: [1.5, 0.15] },
        ],
        { tempo: 100 },
      ),
    );
    assert.ok(
      sc.sc.tp === 3 && sc.segs.length === 3,
      `hum: notes scooped into from below are C4 E4 G4, onsets at the scoop (${got(sc.segs)}; ${sc.segs.map((g, i) => Math.round((g.t0 - sc.au.notes[i]?.t0) * 1000) + ' ms').join(', ')})`,
    );
    // a low hum through a laptop mic (the fundamental 15 dB down), with a period-doubled pulse: the right octave
    const low = run(
      phrase(
        [
          { m: 45, beats: 1 },
          { m: 43, beats: 1 },
          { m: 41, beats: 1 },
          { m: 40, beats: 2 },
        ],
        { tempo: 90, range: 'bass', lowHum: true, fry: true },
      ),
    );
    assert.ok(
      low.sc.tp === 4 && low.sc.octave === 0,
      `hum: a low hum through a small mic, fry and all, stays in its octave (${got(low.segs)})`,
    );
    // drift: the singer sinks 40 cents across the phrase; the notes don't
    const dr = run(
      phrase(
        [60, 62, 64, 65, 67, 65, 64, 62, 60].map((m) => ({ m, beats: 1 })),
        { tempo: 110, drift: -0.4 },
      ),
    );
    assert.ok(
      dr.sc.tp === 9 && dr.segs.every((g) => Math.abs(g.cents) < 25),
      `hum: a phrase that sinks 40 cents lands on its nine notes (${got(dr.segs)}; drift taken off: ${dr.segs.map((g) => Math.round(g.tune * 100)).join(' ')} cents)`,
    );
    // room noise alone (30 dB under a voice that isn't there) makes no notes
    const room = run({ ...phrase([{ m: 60, beats: 1 }], { room: 0 }), notes: [] });
    assert.ok(room.segs.length === 0, 'hum: room noise alone makes no notes');
    // the bench in small: twelve generated phrases (three ranges, hummed and sung)
    let tp = 0,
      nr = 0,
      ne = 0;
    for (let i = 0; i < 12; i++) {
      const r = run(makePhrase(i, { seed: 5 }));
      tp += r.sc.tp;
      nr += r.sc.nRef;
      ne += r.sc.nEst;
    }
    const f1 = (2 * tp) / (nr + ne);
    assert.ok(
      f1 >= 0.88,
      `hum: twelve generated phrases, note F1 ${(f1 * 100).toFixed(1)}% (onset ±80 ms, pitch ±50 cents; ${tp} of ${nr} notes, ${ne} heard)`,
    );
    // real time: fed in 128-sample blocks and decoded every 240 ms, the take ends as the offline one does
    const au = renderVoice(makePhrase(4, { seed: 5 }));
    const tr = createPitchTracker({ sr: au.sr });
    let lastSegs = [];
    const t0 = performance.now();
    for (let i = 0; i < au.x.length; i += 128) {
      tr.push(au.x.subarray(i, Math.min(au.x.length, i + 128)));
      tr.trace();
      if ((i / 128) % 90 === 0) {
        tr.decode();
        lastSegs = segment(tr.frames);
      }
    }
    const usFrame = ((performance.now() - t0) * 1000) / tr.n;
    tr.decode();
    lastSegs = segment(tr.frames);
    const off = hear(au.x, au.sr).segs;
    assert.ok(
      JSON.stringify(lastSegs.map((g) => [g.p, Math.round(g.t0 * 100)])) ===
        JSON.stringify(off.map((g) => [g.p, Math.round(g.t0 * 100)])),
      `hum live: 128-sample blocks, decoded as it goes, end on the offline notes (${lastSegs.length} notes)`,
    );
    assert.ok(
      usFrame < 2000,
      `hum live: ${Math.round(usFrame)} µs of work per 10 ms frame, decodes included (${(usFrame / 100).toFixed(1)}% of real time)`,
    );
    // and the per-frame path allocates nothing: a warm tracker takes 4 s of audio without the heap growing
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc');
    const tr2 = createPitchTracker({ sr: au.sr, chunk: 1024 });
    tr2.push(au.x.subarray(0, 4096));
    const blk = new Float32Array(128);
    gc();
    const h0 = process.memoryUsage().heapUsed;
    for (let i = 4096; i + 128 <= 4096 + 4 * au.sr; i += 128) {
      blk.set(au.x.subarray(i % (au.x.length - 128), (i % (au.x.length - 128)) + 128));
      tr2.push(blk);
    }
    gc();
    const grew = process.memoryUsage().heapUsed - h0;
    assert.ok(
      grew < 64 * 1024,
      `hum live: ${tr2.n} frames analysed with the heap moving ${(grew / 1024).toFixed(1)} KB (no allocation per frame)`,
    );
  }
});

test('tap / beatbox', async () => {
  function drum(kind, sr, len = 0.25) {
    const n = Math.round(len * sr),
      y = new Float32Array(n);
    let lp = 0,
      hpPrev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if (kind === 'kick') {
        const f = 45 + 90 * Math.exp(-t / 0.03);
        y[i] = 0.9 * Math.exp(-t / 0.12) * Math.sin(2 * Math.PI * (45 * t + 90 * 0.03 * (1 - Math.exp(-t / 0.03))));
        void f;
      } else if (kind === 'snare') {
        const nz = rnd() * 2 - 1;
        lp += 0.35 * (nz - lp);
        y[i] = Math.exp(-t / 0.09) * (0.35 * Math.sin(2 * Math.PI * 190 * t) + 0.6 * lp + 0.25 * nz);
      } else {
        const nz = rnd() * 2 - 1,
          hp = nz - hpPrev;
        hpPrev = nz;
        y[i] = 0.45 * Math.exp(-t / 0.03) * hp;
      }
    }
    return y;
  }
  {
    const sr = 48000,
      bpm = 120,
      spb = 60 / bpm,
      pattern = ['kick', 'hat', 'snare', 'hat', 'kick', 'kick', 'snare', 'hat'];
    const x = new Float32Array(Math.round((pattern.length * spb * 0.5 + 0.6) * sr));
    pattern.forEach((k, i) => {
      const at = Math.round((0.2 + i * spb * 0.5) * sr),
        d = drum(k, sr);
      for (let j = 0; j < d.length && at + j < x.length; j++) x[at + j] += d[j] * (k === 'hat' ? 0.7 : 1);
    });
    for (let i = 0; i < x.length; i++) x[i] += 0.002 * (rnd() - 0.5);
    const hs = beatbox(x, sr);
    assert.ok(
      hs.length === pattern.length,
      `beatbox: ${hs.length} hits found for ${pattern.length} (no double triggers)`,
    );
    assert.ok(
      hs.map((h) => h.row).join(' ') === pattern.join(' '),
      `beatbox: classified kick / snare / hat (${hs.map((h) => h.row).join(' ')})`,
    );
    const res = toDrums(hs, { tempo: bpm });
    assert.ok(
      res.notes.length === pattern.length && res.notes.every((n, i) => Math.abs(n.t - i * 0.5) < 1e-9),
      `beatbox → drums on the grid: ${JSON.stringify(res.grid.rows)}`,
    );
    assert.ok(
      hs.every((h) => h.v > 0.3 && h.v <= 1) && hs.find((h) => h.row === 'hat').v < hs.find((h) => h.row === 'kick').v,
      'beatbox: velocities follow loudness (the hats are softer)',
    );
    const taps = toDrums(
      [
        { t: 1, row: 'kick' },
        { t: 1.26, row: 'hat' },
        { t: 1.49, row: 'snare' },
        { t: 1.52, row: 'snare', v: 1 },
      ],
      { tempo: 120 },
    );
    assert.ok(
      taps.notes.length === 3 && taps.notes[2].p === 38 && taps.notes[2].v === 1,
      'taps: a double hit on one step merges (the louder wins)',
    );
    void onsets;
  }
});

test('latency math', async () => {
  {
    const sr = 48000,
      x = new Float32Array(sr * 2),
      clicks = [Math.round(0.3 * sr), Math.round(0.9 * sr), Math.round(1.5 * sr)],
      delays = [0.0235, 0.025, 0.022];
    for (let i = 0; i < x.length; i++) x[i] = 0.002 * (rnd() - 0.5);
    clicks.forEach((c, k) => {
      const at = c + Math.round(delays[k] * sr);
      for (let j = 0; j < 2000; j++) x[at + j] += 0.6 * Math.exp(-j / 300) * (rnd() - 0.5);
    });
    const hs = hits(x, sr, clicks);
    const ok = hs.every((ms, k) => ms != null && Math.abs(ms - delays[k] * 1000) < 0.5);
    assert.ok(
      ok,
      `latency: strum onsets found within 0.5 ms (${hs.map((v) => v && v.toFixed(2)).join(', ')} ms; median ${median(hs).toFixed(2)})`,
    );
    const ref = chirp(sr),
      y = new Float32Array(sr),
      lag = 1234;
    for (let i = 0; i < y.length; i++) y[i] = 0.01 * (rnd() - 0.5);
    for (let j = 0; j < ref.length; j++) y[lag + j] -= 0.5 * ref[j]; // (a flipped interface)
    const f = xcorr(ref, y, 0, Math.round(0.45 * sr));
    assert.ok(
      Math.abs(f.lag - lag) < 0.5 && f.ratio > 8 && f.sign === -1,
      `latency: loopback chirp found at ${f.lag.toFixed(2)} samples (want ${lag}), either polarity (ratio ${f.ratio.toFixed(1)})`,
    );
    assert.ok(
      onset(
        new Float32Array(sr).map(() => 0.01 * (rnd() - 0.5)),
        sr,
        0,
        sr,
      ) === -1,
      'latency: no onset in plain noise',
    );
  }
});

test('capture across a loop wrap', async () => {
  {
    // loop beats 8-16: one note a beat at 12, 13, 14, 15, then (wrapped) 8.02, 9, 10, 11, with no gap. Every note is
    // kept, in the order played, from the bar the phrase started in. With the engine's unwrapped grid, and without it.
    const realNow = performance.now;
    let clock = 1000;
    performance.now = () => clock * 1000;
    for (const grid of [true, false]) {
      const eng = { playing: true, beat: 0, gridBeat: null };
      const cap = createCapture({ store: createStore(), engine: eng }, { emit() {} });
      const played = [12, 13, 14, 15, 8.02, 9, 10, 11];
      played.forEach((b, i) => {
        const u = 12 + i + (i >= 4 ? 0.02 : 0); // the grid keeps counting through the wrap
        clock = 1000 + (u - 12) * 0.5;
        eng.beat = b;
        eng.gridBeat = grid ? u : undefined;
        cap.noteOn('midi', 60 + i, 0.8);
        clock += 0.25;
        eng.beat = b + 0.5;
        eng.gridBeat = grid ? u + 0.5 : undefined;
        cap.noteOff('midi', 60 + i);
      });
      const ph = cap.flush();
      const ts = ph.notes.map((n) => n.t);
      assert.ok(
        ph.notes.length === 8 &&
          ph.beat === 12 &&
          ts.every((t, i) => Math.abs(t - (i + (i >= 4 ? 0.02 : 0))) < 1e-3) &&
          ph.notes.every((n) => Math.abs(n.d - 0.5) < 1e-3),
        `capture keeps a phrase played across a loop wrap ${grid ? 'on the unwrapped grid' : 'without the grid (from the seconds)'}: ${ph.notes.length} of 8 notes, from beat ${ph.beat} (t ${ts.join(', ')})`,
      );
    }
    performance.now = realNow;
  }
});

test('MIDI: choosing another input', async () => {
  {
    // A key (or the pedal) down on input A when B is chosen in the MIDI menu: A is no longer listened to, so its key's
    // off (or its pedal's lift) can never arrive. The switch lets them go itself; nothing stays held.
    const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
      hadDoc = 'document' in globalThis;
    const mkPort = (id) => ({ id, name: id, state: 'connected', onmidimessage: null });
    const run = async (fn) => {
      const A = mkPort('A'),
        B = mkPort('B'),
        calls = [];
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          requestMIDIAccess: async () => ({
            inputs: new Map([
              ['A', A],
              ['B', B],
            ]),
          }),
        },
        configurable: true,
        writable: true,
      });
      if (!hadDoc) globalThis.document = { addEventListener() {}, hidden: false };
      try {
        const { createMidi } = await import('../../app/src/input/midi.js');
        const input = {
          noteOn: (src, p) => calls.push(`on ${src} ${p}`),
          noteOff: (src, p) => calls.push(`off ${src} ${p}`),
          expr: (src, x) => calls.push(`expr ${src} ${JSON.stringify(x)}`),
          emit() {},
        };
        const midi = createMidi({ ui: null }, input);
        await midi.connect();
        const send = (port, bytes) => port.onmidimessage && port.onmidimessage({ data: bytes });
        await fn({ A, B, midi, send });
        return { calls, sustain: midi.state.sustain };
      } finally {
        if (nav) Object.defineProperty(globalThis, 'navigator', nav);
        else delete globalThis.navigator;
        if (!hadDoc) delete globalThis.document;
      }
    };
    const key = await run(async ({ A, B, midi, send }) => {
      send(A, [0x90, 60, 100]);
      midi.setDevice('B');
      send(A, [0x80, 60, 0]);
      send(B, [0x90, 62, 100]);
      send(B, [0x80, 62, 0]);
    });
    assert.ok(
      key.calls.includes('off midi:A 60') && key.calls.includes('off midi:B 62'),
      `MIDI: a key held on A when B is chosen is let go at the switch (${key.calls.join(', ')})`,
    );
    const ped = await run(async ({ A, B, midi, send }) => {
      send(A, [0xb0, 64, 127]);
      midi.setDevice('B');
      send(A, [0xb0, 64, 0]);
      send(B, [0x90, 62, 100]);
      send(B, [0x80, 62, 0]);
    });
    assert.ok(
      !ped.sustain && ped.calls.includes('expr midi:A {"sustain":false}') && ped.calls.includes('off midi:B 62'),
      `MIDI: the pedal down on A when B is chosen is lifted at the switch, so B's notes end when let go (${ped.calls.join(', ')})`,
    );
    const all = await run(async ({ A, B, midi, send }) => {
      midi.setDevice('');
      send(A, [0x90, 60, 100]);
      send(B, [0xb0, 64, 127]);
      midi.setDevice('B');
      send(B, [0x90, 62, 100]);
      send(B, [0x80, 62, 0]);
    });
    assert.ok(
      all.calls.includes('off midi:A 60') && all.sustain && !all.calls.includes('off midi:B 62'),
      `MIDI: from every input to B alone, A's key is let go and B's own pedal stays down (${all.calls.join(', ')})`,
    );
  }
});
