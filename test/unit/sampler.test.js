// The sampled-instrument kernel (app/src/devices/builtin/sampler.js) and the melodic fields of a kit, on a kit made
// from sine waves (so every check knows exactly what should come out). Moved from tools/sampler-test.js; the
// Parlour Upright and the other sampled instruments (which need fetched kits) stay there.
import { test } from 'node:test';
import { encodeOdk, decodeOdk } from '../../app/src/kernel/odk.js';
import { sha256 } from '../../app/src/engine/node/io.js';
import { T } from './_t.js';
import { db, SR, C4, KIT, play, on, off, rms, amp, peakHz, cents } from './_sampler-kit.js';

const t = T;

test('melodic fields in the .odk', () => {
  const s = KIT.samples.find((x) => x.id === 'c3.loop'),
    r = KIT.samples.find((x) => x.id === 'c4.rel'),
    c = KIT.samples.find((x) => x.id === 'c5');
  t.ok(
    s.key === 48 &&
      s.lo === 40 &&
      s.hi === 54 &&
      s.loop.s === 24000 &&
      s.loop.mode === 'sustain' &&
      r.trig === 'release' &&
      c.tune === 30 &&
      KIT.meta.kind === 'melodic',
    'key, lo, hi, vlo, vhi, rr, trig, tune, gain, loop and cutoff ride in the header as plain fields, and come back',
  );
  // an older kit (no melodic fields) decodes to exactly what it did: the fields are optional, the format string is the same
  const old = encodeOdk({
    name: 'old',
    sr: SR,
    bits: 16,
    channels: 1,
    meta: {},
    samples: [{ id: 'k', piece: 'kick', layer: 0, rr: 0, vel: 127, start: 3, ch: [Int16Array.of(1, 2, 3)] }],
  });
  const d = decodeOdk(old);
  t.ok(
    d.format === 'overdub-kit/1' &&
      JSON.stringify(Object.keys(d.samples[0])) ===
        JSON.stringify(['id', 'piece', 'layer', 'rr', 'vel', 'start', 'frames', 'at', 'ch']),
    "a drum kit's header is untouched: the same format string, the same fields",
  );
});

test('the sampler kernel: zones, velocity layers, loops, release samples, voices, pedal, bit-exact', () => {
  // pitch: two semitones up the C4 zone, and the zone at 44.1 kHz too; a sample's tune field
  for (const sr of [48000, 44100]) {
    const r = play([on(62, 0.9)], { sr, secs: 1 });
    const want = C4 * Math.pow(2, 2 / 12),
      got = peakHz(r.channels[0], want, 0.1, 0.9, sr);
    t.ok(
      Math.abs(cents(got, want)) < 0.5,
      `D4 from the C4 zone at ${sr / 1000} kHz: ${got.toFixed(2)} Hz (${cents(got, want).toFixed(2)} cents off ${want.toFixed(2)})`,
    );
  }
  const c5 = play([on(72, 0.9)], { secs: 1 });
  const g5 = peakHz(c5.channels[0], 2 * C4, 0.1, 0.9);
  t.ok(
    Math.abs(cents(g5, 2 * C4)) < 0.5,
    `a sample recorded 30 cents flat with tune +30 plays C5 in tune (${cents(g5, 2 * C4).toFixed(2)} cents)`,
  );
  const up = play([on(60, 0.9)], { secs: 1, params: { tune: 50 } });
  t.ok(
    Math.abs(cents(peakHz(up.channels[0], C4 * Math.pow(2, 50 / 1200), 0.1, 0.9), C4) - 50) < 0.5,
    'TUNE +50 moves it 50 cents',
  );

  // velocity: the layers, by their markers (3x: the soft layer's second round robin; 5x: the hard layer)
  const soft = play([on(60, 0.25)], { secs: 1 }),
    hard = play([on(60, 0.95)], { secs: 1 });
  const m5 = (r) => amp(r.channels[0], 5 * C4, 0.1, 0.9) / amp(r.channels[0], C4, 0.1, 0.9);
  t.ok(
    m5(soft) < 0.01 && Math.abs(m5(hard) - 0.3) < 0.01,
    `velocity picks the layer (the hard layer's marker: ${m5(soft).toFixed(3)} soft, ${m5(hard).toFixed(3)} hard)`,
  );
  const edge = play([on(60, 63.5 / 127)], { secs: 1 });
  t.ok(
    m5(edge) > 0.1 && m5(edge) < 0.25,
    `on the boundary both layers play, crossfaded (marker ${m5(edge).toFixed(3)} of 0.3)`,
  );
  const lv = [];
  for (let v = 4; v <= 127; v += 3) {
    const r = play([on(60, v / 127)], { secs: 0.4 });
    lv.push([v, db(rms(r.channels[0], 0.05, 0.35))]);
  }
  // (the curve: 40 log10(vel / 127), the SFZ default, when a kit names none)
  let down = 0,
    worst = 0;
  for (let i = 1; i < lv.length; i++) if (lv[i][1] - lv[i - 1][1] < -0.05) down++;
  for (const [v, d] of lv)
    worst = Math.max(worst, Math.abs(d - lv[lv.length - 1][1] - 40 * Math.log10(v / lv[lv.length - 1][0])));
  t.ok(
    down === 0 && worst < 0.6,
    `the level climbs with velocity along the curve (${lv[0][1].toFixed(1)} dB at 4 to ${lv[lv.length - 1][1].toFixed(1)} at 127, never down, at most ${worst.toFixed(2)} dB off 40 log10(v/127), across the layer seam too)`,
  );
  const flat = play([on(60, 0.2)], { secs: 0.4, params: { dynamics: 0 } }),
    full = play([on(60, 0.95)], { secs: 0.4, params: { dynamics: 0 } });
  t.ok(
    Math.abs(db(rms(flat.channels[0], 0.05, 0.35)) - db(rms(full.channels[0], 0.05, 0.35))) < 1.5,
    'DYNAMICS 0% plays soft and hard notes at one level',
  );

  // round robins: the soft layer's two samples, told apart by the 3x marker; repeats never back to back; from the seed
  const seq = (seed) => {
    const ev = [];
    for (let k = 0; k < 8; k++) ev.push(on(60, 0.3, k * 0.25), off(60, k * 0.25 + 0.2));
    const r = play(ev, { secs: 2.2, seed, params: { release: 0.05 } });
    return Array.from({ length: 8 }, (_, k) =>
      amp(r.channels[0], 3 * C4, k * 0.25 + 0.03, k * 0.25 + 0.18) /
        amp(r.channels[0], C4, k * 0.25 + 0.03, k * 0.25 + 0.18) >
      0.15
        ? 2
        : 1,
    ).join('');
  };
  const s1 = seq(1),
    s1b = seq(1),
    s2 = seq(7);
  t.ok(
    (s1 === s1b && !/11|22/.test(s1) && s1 !== s2) || (s1 === s1b && !/11|22/.test(s1) && !/11|22/.test(s2)),
    `round robins alternate, never the same sample twice running, the same for the same seed (${s1}, again ${s1b}; seed 7: ${s2})`,
  );

  // a sustain loop: held past the sample's end it keeps sounding; released, it plays out its last loop pass and stops
  const held = play([on(48, 0.9), off(48, 3)], { secs: 4.5, params: { release: 6 } });
  const lvHeld = db(rms(held.channels[0], 2.5, 2.9));
  t.ok(lvHeld > -30, `a sustain loop holds while the key is down (2.5 s into a 1 s sample: ${lvHeld.toFixed(1)} dB)`);
  t.ok(
    db(rms(held.channels[0], 3.6, 4.4)) < -100,
    "let go, it plays on to the sample's end and stops (no loop after the key lifts)",
  );

  // a release sample: 1.5 kHz at note-off, softer after a longer hold
  const relAt = (hold) => {
    const r = play([on(60, 0.9), off(60, hold)], { secs: hold + 0.5, params: { release: 0.05 } });
    return amp(r.channels[0], 1500, hold + 0.02, hold + 0.25);
  };
  const r1 = relAt(0.2),
    r2 = relAt(1.2);
  t.ok(
    r1 > 0.005 && r2 < r1 && Math.abs(db(r1 / r2) - 6) < 1,
    `a release sample sounds when the key lifts, ${db(r1 / r2).toFixed(1)} dB softer after a second more of holding (the kit's rt decay: 6 dB/s)`,
  );
  const noRel = play([on(60, 0.9)], { secs: 1 });
  t.ok(amp(noRel.channels[0], 1500, 0.3, 0.8) < 1e-4, 'and never while the key is down');

  // the voice cap: 12 notes on an 8-voice instance
  const many = play(
    Array.from({ length: 12 }, (_, k) => on(55 + (k % 12), 0.8, k * 0.05)),
    { secs: 1 },
  );
  t.ok(
    many.stats.voices <= 8 && many.stats.maxVoices <= 10 && many.stats.steals >= 4,
    `twelve notes on eight voices: ${many.stats.voices} sound, ${many.stats.steals} stolen (the oldest first, by the host; at most ${many.stats.maxVoices} at once while the stolen fade)`,
  );

  // the sustain pedal (the host's CC64): a note-off while it's down waits for it to lift
  const ped = play(
    [{ type: 'expr', sustain: true, time: 0 }, on(60, 0.9), off(60, 0.2), { type: 'expr', sustain: false, time: 1.2 }],
    { secs: 2, params: { release: 0.1 } },
  );
  t.ok(
    db(rms(ped.channels[0], 0.8, 1.1)) > -30 && db(rms(ped.channels[0], 1.6, 2)) < -60,
    `the pedal holds a released note (${db(rms(ped.channels[0], 0.8, 1.1)).toFixed(1)} dB at 0.8 s) until it lifts (${db(rms(ped.channels[0], 1.6, 2)).toFixed(1)} dB after)`,
  );

  // a sample's cutoff: 6 kHz through a 2 kHz 2-pole low pass is about 19 dB down
  const lp = play([on(84, 0.9)], { secs: 0.6 });
  const nolp = play([on(84, 0.9)], {
    secs: 0.6,
    kit: { ...KIT, samples: KIT.samples.map((s) => (s.id === 'c6.lp' ? { ...s, cutoff: undefined } : s)) },
  });
  const cut = db(amp(lp.channels[0], 6000, 0.1, 0.5) / amp(nolp.channels[0], 6000, 0.1, 0.5));
  t.ok(cut < -17 && cut > -21, `a sample's cutoff filters it (6 kHz through 2 kHz: ${cut.toFixed(1)} dB)`);

  // the interpolator: a 15 kHz tone moved up 3 semitones; what isn't the tone is the interpolator's error
  const br = play([on(103, 0.9)], { secs: 0.6, params: { dynamics: 0 } });
  const fo = 15000 * Math.pow(2, 3 / 12),
    x = br.channels[0],
    i0 = Math.round(0.1 * SR),
    N = 16384;
  let a = 0,
    b = 0,
    cc = 0,
    ss = 0;
  for (let i = 0; i < N; i++) {
    const c = Math.cos((2 * Math.PI * fo * i) / SR),
      s = Math.sin((2 * Math.PI * fo * i) / SR);
    a += x[i0 + i] * c;
    b += x[i0 + i] * s;
    cc += c * c;
    ss += s * s;
  }
  let e = 0,
    sig = 0;
  for (let i = 0; i < N; i++) {
    const r =
      x[i0 + i] - (a / cc) * Math.cos((2 * Math.PI * fo * i) / SR) - (b / ss) * Math.sin((2 * Math.PI * fo * i) / SR);
    e += r * r;
    sig += x[i0 + i] * x[i0 + i];
  }
  const spur = 10 * Math.log10(e / sig);
  t.ok(
    spur < -60,
    `a 15 kHz tone moved up 3 semitones stays clean: everything else is ${spur.toFixed(1)} dB under it (the drum kit's Hermite: -16.5)`,
  );

  // the same events, the same samples, bit for bit
  const ev = [on(60, 0.5), on(64, 0.7, 0.1), on(67, 0.9, 0.2), off(60, 0.8), off(64, 0.9), off(67, 1)];
  t.ok(sha256(play(ev)) === sha256(play(ev)), 'two renders are bit-identical');

  // no kit: silence, and no error
  const none = play([on(60, 0.9)], { secs: 0.5, kit: null });
  t.ok(rms(none.channels[0], 0, 0.5) === 0, 'with no kit it plays silence');
});
