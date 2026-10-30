// The guitar amps' voices, as numbers: what each amp sounded like on the gear's graph engine (plugAmp, native nodes,
// rendered in muted headless Chromium), fixed once in tools/fixtures/amp-voices.json, so the amps on the kernel engine
// (devices/guitar/voicings.js) are held against what they were. The graph engine is gone (retired on 2026-10-29, once
// every amp was on the kernel; the renderer that made the fixture went with it, at commit b30a1a7): the fixture is what
// it was.
//
//   node tools/amp-voices.js [ids]         the kernel amps (all, or these) against the fixture, in Node: level,
//                                          spectrum, drive, knob travel, aliasing, latency, CPU (tools/.out/amp-voices.json)
//
// Per amp, at the gear's default knobs (PLUG_DEFAULT) with the DI strum (the bass DI for a bass amp), on its own
// designed cab unless it says otherwise: BS.1770 and clawd-o-matic loudness, half-octave and third-octave bands (on
// its default cab too), THD of a 196 Hz sine at -18 dBFS, each knob at 0 and 10 (the share of its band and the
// loudness, 4 s of the strum), aliasing of sines at 1, 2.5 and 5 kHz (-12 dBFS, GAIN 10; to 24 kHz and to 16 kHz),
// and its latency. tools/amp-measure.js says how each is measured.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { halfOct, thirds, thd, alias, share, clawdLufs, sine, shape, KNOB_BAND, SR } from './amp-measure.js';
import { lufs } from '../app/src/audio/measure.js';
import { diStrum, bassDI } from '../app/src/audio/testsignals.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE = path.join(HERE, 'fixtures', 'amp-voices.json');
const KNOBS = ['bass', 'mid', 'treble', 'presence', 'gain'];
const ALIAS_F = [1000, 2500, 5000];
const r2 = (v) => Math.round(v * 100) / 100;
const L = (x) => lufs({ sr: SR, channels: [x, x] });

// The numbers for one amp from its renders: render(params, x) -> Float32Array (mono), params the gear's knobs plus
// cab ('own' or the default), x the input. Async so a browser can render.
export async function voiceOf(render, { bass }) {
  const x8 = bass ? bassDI(8, SR) : diStrum(8, SR), x4 = x8.subarray(0, 4 * SR);
  const own = await render({ cab: 'own' }, x8), dflt = await render({}, x8);
  const v = {
    own: { lufs: r2(L(own)), clawd: r2(clawdLufs(own)), half: halfOct(own), thirds: thirds(own) },
    def: { lufs: r2(L(dflt)), clawd: r2(clawdLufs(dflt)), half: halfOct(dflt) },
    thd: r2(thd(await render({ cab: 'own' }, sine(196, -18, 2.5)))),
    travel: {}, alias: {},
  };
  const base = await render({ cab: 'own' }, x4);
  v.travel.base = { lufs: r2(L(base)), share: Object.fromEntries(KNOBS.filter((k) => KNOB_BAND[k]).map((k) => [k, r2(share(base, ...KNOB_BAND[k]))])) };
  for (const k of KNOBS) {
    v.travel[k] = {};
    for (const val of [0, 10]) {
      const y = await render({ cab: 'own', [k]: val }, x4);
      v.travel[k][val] = { lufs: r2(L(y)), half: halfOct(y), ...(KNOB_BAND[k] ? { share: r2(share(y, ...KNOB_BAND[k])) } : {}) };
    }
  }
  for (const f of ALIAS_F) {
    const y = await render({ cab: 'own', gain: 10 }, sine(f, -12, 2.5));
    v.alias[f] = { full: r2(alias(y, f)), to16k: r2(alias(y, f, 16000)) };
  }
  return v;
}

// Knob travel as AJ would hear it: each knob at 0 and 10 against the default, the change in its band's share (dB; GAIN:
// in loudness, LU)
export function travelOf(v) {
  const out = {};
  for (const k of KNOBS) out[k] = [0, 10].map((val) => r2(KNOB_BAND[k] ? v.travel[k][val].share - v.travel.base.share[k] : v.travel[k][val].lufs - v.travel.base.lufs));
  return out;
}

// The kernel amps against the fixture (Node, the worklet's KernelCore): per amp { lufs, spectrum, thd, alias, travel,
// latency, usPerBlock }, each old against new
export async function report(ids) {
  const { run } = await import('./amp-scenes.js');
  const { getDevice } = await import('../app/src/devices/registry.js');
  await import('../app/src/devices/guitar/index.js');
  const { AMP_VOICINGS } = await import('../app/src/devices/guitar/voicings.js');
  const { CAB_IDS } = await import('../app/src/devices/guitar/amps.js');
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const own = CAB_IDS.indexOf('own'), rows = {};
  for (const id of ids || Object.keys(AMP_VOICINGS)) {
    const def = getDevice('amp.' + id), old = fx.amps[id];
    const render = async (p, x) => { const q = { ...p }; if (q.cab === 'own') q.cab = own; else delete q.cab; return run(def, q, x)[0]; };
    const nv = await voiceOf(render, { bass: old.signal === 'bass' }), x2 = diStrum(2, SR), us = [];
    for (let k = 0; k < 3; k++) { const t0 = performance.now(); run(def, { cab: own }, x2); us.push(((performance.now() - t0) * 1000) / (x2.length / 128)); }
    const sp = shape(nv.own.half, old.own.half), spd = shape(nv.def.half, old.def.half);
    rows[id] = {
      name: def.name, os: AMP_VOICINGS[id].os,
      lufs: { own: [old.own.lufs, nv.own.lufs], def: [old.def.lufs, nv.def.lufs], clawdDef: [old.def.clawd, nv.def.clawd] },
      spectrum: { own: { rms: r2(sp.rms), max: r2(sp.max), d: sp.d }, def: { rms: r2(spd.rms), max: r2(spd.max), d: spd.d } },
      thd: [old.thd, nv.thd],
      alias: Object.fromEntries(ALIAS_F.map((f) => [f, { to16k: [old.alias[f].to16k, nv.alias[f].to16k], full: [old.alias[f].full, nv.alias[f].full] }])),
      travel: { old: travelOf(old), new: travelOf(nv) },
      latency: [old.latency, Math.round((def.latency || 0) * SR)],
      usPerBlock: r2(Math.min(...us)),
    };
  }
  return rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const rows = await report(process.argv[2] ? process.argv[2].split(',') : null);
  fs.mkdirSync(path.join(HERE, '.out'), { recursive: true });
  fs.writeFileSync(path.join(HERE, '.out', 'amp-voices.json'), JSON.stringify(rows, null, 1));
  console.log(JSON.stringify(rows, null, 1));
}
