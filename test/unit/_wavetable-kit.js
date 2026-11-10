// Light Table's test rig: the device, its tables, and a way to render a few notes through the canonical Node renderer.
// Shared by test/unit/wavetable.test.js and tools/wavetable-test.js. Not a test file.
import { renderSong } from '../../app/src/engine/node/render.js';
import { createProject } from '../../app/src/core/project.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { tables, TABLE_NAMES } from '../../app/src/devices/builtin/wavetables.js';

export const ID = 'core.wavetable';
export const SR = 48000;
export const BPM = 120;
export const BEAT = 60 / BPM;
export const STAMP = '2026-10-02T00:00:00.000Z';
export const def = getDevice(ID);
export const LT = tables();
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const dB = (x) => 20 * Math.log10(Math.max(1e-12, x));
export const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
export const T = (name) => TABLE_NAMES.indexOf(name);
// a clean, open voice: one oscillator, the filter wide open and flat, no envelope on it, no effects
export const CLEAN = {
  a_unison: 1,
  flt_type: 'LP12',
  flt_cutoff: 20000,
  flt_res: 0,
  flt_env: 0,
  flt_key: 0,
  flt_drive: 0,
  fx_verb_mix: 0,
  env1_attack: 0.001,
  env1_vel: 0,
};

// switches may be given by label, as in a preset
export function vals(params) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    const p = def.params.find((q) => q.key === k);
    if (!p) throw new Error('no param ' + k);
    out[k] = typeof v === 'string' && p.opts ? p.opts.findIndex((o) => o.toLowerCase() === v.toLowerCase()) : v;
    if (typeof v === 'string' && out[k] < 0) throw new Error(`no option ${v} for ${k}`);
  }
  return out;
}
export function project(notes, params, beats, { tempo = BPM, auto = null, device = ID } = {}) {
  return {
    ...createProject(),
    id: 'p_lt',
    title: 'light table',
    key: null,
    tempo,
    meta: { created: STAMP, modified: STAMP, authors: {} },
    tracks: [
      {
        id: 't_lt',
        name: 'LT',
        kind: 'instrument',
        instrument: {
          device,
          params: device === ID || device.startsWith('test.lt') ? vals(params) : params,
          ...(auto ? { auto } : {}),
        },
        inserts: [],
        clips: [
          {
            id: 'c_lt',
            kind: 'notes',
            start: 0,
            length: beats,
            notes: notes.map((n, i) => ({ id: 'n' + (i + 1), by: 'overdub', p: n.p, t: n.t, d: n.d, v: n.v ?? 0.8 })),
            by: 'overdub',
          },
        ],
        gain: 0,
        pan: 0,
        mute: false,
        solo: false,
        arm: false,
        by: 'overdub',
      },
    ],
  };
}
// notes in seconds -> { L, R, m (the mono mix), r }
export function play(notes, params = {}, secs = 2, { tail = 0.3, tempo = BPM, auto = null, device = ID } = {}) {
  const beat = 60 / tempo,
    beats = Math.ceil(secs / beat);
  const r = renderSong(
    project(
      notes.map((n) => ({ ...n, t: n.t / beat, d: n.d / beat })),
      params,
      beats,
      { tempo, auto, device },
    ),
    { from: 0, to: beats, tail },
  );
  if (r.warnings.length) throw new Error('render warnings: ' + JSON.stringify(r.warnings));
  const [L, R] = r.channels,
    m = new Float32Array(L.length);
  for (let i = 0; i < m.length; i++) m[i] = 0.5 * (L[i] + R[i]);
  return { L, R, m, r };
}
export const held = (p, secs = 1.5, v = 0.8) => [{ p, t: 0, d: secs, v }];
