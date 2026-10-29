// Fit a kernel amp's free values to what the amp sounded like on the graph engine (tools/fixtures/amp-voices.json),
// within physical limits. The circuit (its stages in order, its tone stack's parts) is the voicing's and isn't
// touched; only what a builder would choose or a part's tolerance moves, each inside the range a real one has:
//   a stage's drive (0.5 to 60 times: what's left of a 12AX7's gain past the network after it), its coupling
//   high-pass (5 to 400 Hz: 22 nF into 1M down to a lead channel's 1 nF into 470k) and Miller low-pass (4 to 20 kHz: a
//   12AX7's Miller capacitance fed from a pot's wiper or a plate); a fixed gain (a stack's loss made up: 0 to 30 dB);
//   the GAIN pot's bottom (-60 to -12 dB at 0; full up it passes all of it, 0 dB, so its bright cap is gone there); the
//   bright cap (100 pF to 5 nF); the power amp's drive (-12 to +12 dB) and sag (0 to 0.6); the transformer's band (20
//   to 90 Hz, 10 to 20 kHz: the speaker rolls the top off, and that's the cab's); the speaker's resonance (70 to 140
//   Hz, 0 to +4 dB: a bump, never a dip); the input's coupling (20 to 150 Hz); a partly bypassed cathode (100 to 700
//   Hz, -12 to 0 dB: a cut, never a boost); presence's corner (3 to 5 kHz).
// Nothing else: no EQ the circuit doesn't have, so what's left of the difference is the circuit's and is reported.
// The score, at the gear's default knobs on the amp's own designed cab: the half-octave spectrum's difference from
// the old amp's over 100 Hz-8 kHz, loudness matched (rms + 0.3 x its worst band; the bands outside it, 40-70 Hz and
// 11-14.5 kHz, 0.2 x each dB past 3, so the ends can't run away while the middle is fitted), the drive (4 x |ln| of the
// THD ratio at 196 Hz), and GAIN's loudness travel at 0 and 10 (0.3 x |LU| each). A coordinate search.
//
//   node tools/amp-fit.js <id> [rounds]   starts from voicings.js (or FROM=file.json); writes tools/.out/amp-fit-<id>.json
//                                         and prints the voicing with its trim (the level that makes it as loud as
//                                         the graph amp on its default cab)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './amp-scenes.js';
import { halfOct, shape, thd, sine, clawdLufs, SR } from './amp-measure.js';
import { FIXTURE } from './amp-voices.js';
import { lufs } from '../app/src/audio/measure.js';
import { diStrum } from '../app/src/audio/testsignals.js';
import { ampDevice, CAB_IDS } from '../app/src/devices/guitar/amps.js';
import { AMP_VOICINGS } from '../app/src/devices/guitar/voicings.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OWN = CAB_IDS.indexOf('own');
const L = (x) => lufs({ sr: SR, channels: [x, x] });

// the values a voicing may move: [name, get, set, 'mul' | 'add', step, lo, hi]
export function freeValues(v) {
  const K = [];
  const at = (o, k) => [() => o[k], (x) => { o[k] = x; }];
  v.chain.forEach((b, i) => {
    if (b[0] === 'tri') {
      K.push(['g' + i, ...at(b, 1), 'mul', 1.25, 0.5, 60], ['hp' + i, ...at(b, 4), 'mul', 1.3, 5, 400], ['lp' + i, ...at(b, 5), 'mul', 1.2, 4000, 20000]);
    } else if (b[0] === 'gain' && b[1] > 0) K.push(['gain' + i, ...at(b, 1), 'add', 1, 0, 30]);
  });
  K.push(['pot0', ...at(v.pot, 0), 'add', 2, -60, -12]); // (turned full up, a pot passes all of it: pot[1] is 0 dB)
  if (v.bright) K.push(['bright', ...at(v.bright, 0), 'mul', 1.4, 100, 5000]);
  K.push(['pw', ...at(v, 'pw'), 'add', 1.5, -12, 12], ['sag', ...at(v, 'sag'), 'add', 0.05, 0, 0.6]);
  K.push(['xfhp', ...at(v.xf, 0), 'mul', 1.2, 20, 90], ['xflp', ...at(v.xf, 1), 'mul', 1.15, 10000, 20000]);
  if (v.depth) K.push(['depth', ...at(v.depth, 1), 'add', 0.5, 0, 4], ['depthHz', ...at(v.depth, 0), 'mul', 1.15, 70, 140]);
  K.push(['hp', ...at(v, 'hp'), 'mul', 1.2, 20, 150], ['presHz', ...at(v.pres, 0), 'mul', 1.1, 3000, 5000]);
  if (v.tight) K.push(['tight', ...at(v.tight, 1), 'add', 1, -12, 0], ['tightHz', ...at(v.tight, 0), 'mul', 1.2, 100, 700]);
  return K;
}

export function scorer(id) {
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).amps[id];
  const x8 = diStrum(8, SR), x4 = x8.subarray(0, 4 * SR), s196 = sine(196, -18, 1.6);
  const old = { half: fx.own.half, thd: fx.thd, g0: fx.travel.gain[0].lufs - fx.travel.base.lufs, g10: fx.travel.gain[10].lufs - fx.travel.base.lufs };
  return (v) => {
    const def = ampDevice(id, v), y = run(def, { cab: OWN }, x8)[0], sp = shape(halfOct(y), old.half), t = thd(run(def, { cab: OWN }, s196)[0]);
    const b4 = L(run(def, { cab: OWN }, x4)[0]), g0 = L(run(def, { cab: OWN, gain: 0 }, x4)[0]) - b4, g10 = L(run(def, { cab: OWN, gain: 10 }, x4)[0]) - b4;
    let ends = 0;
    sp.d.forEach((d, i) => { if (i < 2 || i > 14) ends += Math.max(0, Math.abs(d) - 3); });
    const s = sp.rms + 0.3 * sp.max + 0.2 * ends + 4 * Math.abs(Math.log(Math.max(0.02, t) / Math.max(0.02, old.thd))) + 0.3 * (Math.abs(g0 - old.g0) + Math.abs(g10 - old.g10));
    return { s, rms: sp.rms, max: sp.max, bands: sp.d, thd: t, thdOld: old.thd, g0, g10, g0Old: old.g0, g10Old: old.g10 };
  };
}

// the trim that makes the amp on its default cab as loud as the graph amp was (clawd-o-matic's loudness on the DI
// strum, the fixture's def.clawd; tools/guitar-test.js 4 reads them both at -14 on the house's plug level)
export function trimFor(id, v) {
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).amps[id];
  const def = ampDevice(id, { ...v, trim: 0 }), y = run(def, {}, diStrum(8, SR))[0];
  return Math.round((fx.def.clawd - clawdLufs(y)) * 100) / 100;
}

async function main() {
  const id = process.argv[2], rounds = +(process.argv[3] || 5);
  if (!id) { console.log('usage: node tools/amp-fit.js <id> [rounds]'); process.exit(1); }
  const v = JSON.parse(process.env.FROM ? fs.readFileSync(process.env.FROM, 'utf8') : JSON.stringify(AMP_VOICINGS[id]));
  const score = scorer(id), K = freeValues(v), cache = new Map();
  const at = () => { const k = JSON.stringify(v); if (!cache.has(k)) cache.set(k, score(v)); return cache.get(k); };
  let best = at();
  const say = (w) => console.log(id, w, 'spectrum', best.rms.toFixed(2), '/', best.max.toFixed(2), 'dB, THD', best.thd.toFixed(1), 'old', best.thdOld, ', GAIN', best.g0.toFixed(1), best.g10.toFixed(1), 'old', best.g0Old.toFixed(1), best.g10Old.toFixed(1), 'score', best.s.toFixed(3));
  say('start');
  for (let r = 0; r < rounds; r++) {
    const s0 = best.s;
    for (const [, get, set, kind, step, lo, hi] of K) {
      for (const dir of [1, -1]) {
        for (;;) {
          const x0 = get(), x1 = kind === 'mul' ? (dir > 0 ? x0 * step : x0 / step) : x0 + dir * step;
          if (x1 < lo - 1e-9 || x1 > hi + 1e-9) break;
          set(Math.round(x1 * 1000) / 1000);
          const sc = at();
          if (sc.s < best.s - 1e-3) best = sc; else { set(x0); break; }
        }
      }
    }
    say('round ' + r);
    if (s0 - best.s < 0.01) break;
  }
  v.trim = trimFor(id, v);
  const out = { id, voicing: v, ...best };
  fs.mkdirSync(path.join(HERE, '.out'), { recursive: true });
  fs.writeFileSync(path.join(HERE, '.out', `amp-fit-${id}.json`), JSON.stringify(out, null, 1));
  console.log(id, 'bands (new - old, 40 Hz to 14.5 kHz):', best.bands.join(' '));
  console.log(JSON.stringify(v));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
