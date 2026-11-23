// @ts-check
// core.tremolo: Ceiling Fan. Tremolo and auto-pan: an LFO turns the level up and down (TREMOLO, both sides together)
// or swings it from side to side (PAN, the sides opposite each other), at RATE in Hz or, with SYNC on a note length,
// one cycle per note in time with the song (dsp.lfo's sync: phase-locked to the beat while the transport plays).
//
// The gain law, with the LFO at m (-1..1), DEPTH d (0..1), a = 1 - d/2 and h = d/2: TREMOLO gives both sides
// (a + h m) mk; PAN gives the left (a + h m) mk and the right (a - h m) mk, so the two always add to the same and the
// mono sum doesn't pulse. At DEPTH 1 the bottom of each cycle is silent (or, in PAN, one side is).
//
// Level-matched: mk = 1 / sqrt(a^2 + h^2 E[m^2]), E[m^2] being 1/2 for the sine, 1/3 for the triangle and 1 for the
// square (each has mean 0), so the gain's average power over a cycle is unity and the integrated level stays at
// bypass on any program; the loud point of a cycle is over unity (+2.3 dB at the defaults).
//
// No clicks: each side's gain goes through a 3 ms slew (dsp.slew) before it meets the sample, which rounds the
// square's edges and any jump from SHAPE, MODE, a SYNC re-phase or a per-block makeup step. At DEPTH 0 the gain is
// exactly 1 and the input passes through sample for sample.
import { defineDevice } from '../registry.js';
import { kernel, DIV_LABELS } from './lib.js';

export const PRESETS = [
  { name: 'Surf amp', blurb: 'A deep, quick sine tremolo: the amp in the corner of a surf record',
    params: { rate: 6, sync: 'FREE', depth: 0.7, shape: 'SINE', mode: 'TREMOLO' } },
  { name: 'Eighth chop', blurb: 'A square chop on the eighth notes, in time with the song',
    params: { sync: '1/8', depth: 0.9, shape: 'SQUARE', mode: 'TREMOLO' } },
  { name: 'Slow sway', blurb: 'Side to side once a bar, a slow sine pan',
    params: { sync: '1 BAR', depth: 0.8, shape: 'SINE', mode: 'PAN' } },
];

export default defineDevice({
  id: 'core.tremolo', name: 'Ceiling Fan', kind: 'effect', cat: 'mod', by: 'overdub',
  blurb: 'Tremolo and auto-pan, in Hz or in time with the song',
  nod: 'the amp tremolo and the studio auto-panner',
  params: [
    { key: 'rate', label: 'RATE', min: 0.1, max: 20, def: 4.5, curve: 'log', unit: 'Hz', role: 'rate', desc: 'speed in Hz when SYNC is FREE' },
    { key: 'sync', label: 'SYNC', opts: ['FREE', ...DIV_LABELS], def: 0, role: 'time', desc: 'FREE follows RATE; a note length locks it to the song tempo' },
    { key: 'depth', label: 'DEPTH', min: 0, max: 1, def: 0.5, role: 'depth', desc: 'none (0) to full: silent at the bottom of each cycle (1)' },
    { key: 'shape', label: 'SHAPE', opts: ['SINE', 'TRIANGLE', 'SQUARE'], def: 0, role: 'shape', desc: 'smooth, linear ramps, or a chop' },
    { key: 'mode', label: 'MODE', opts: ['TREMOLO', 'PAN'], def: 0, role: 'width', desc: 'TREMOLO moves both sides together; PAN moves them opposite (auto-pan)' },
  ],
  presets: PRESETS,
  // a fan's teal housing with a warm pull-chain light
  look: { color: '#2e5b5f', ink: '#eafaf7', shape: 'box', finish: 'sparkle', knob: 'chrome', label: 'script', led: '#ffcf5a' },
  tail: 0.01,
  kernel: kernel(String.raw`
return {
  create({ sr, dsp }) {
    // three LFOs given the same rate and the same next() every sample, so their phases stay together: SHAPE picks one
    const lfos = [dsp.lfo('sine'), dsp.lfo('tri'), dsp.lfo('square')];
    const sL = dsp.slew(3, 3, 1), sR = dsp.slew(3, 3, 1);
    const M2 = [0.5, 1 / 3, 1];   // E[m^2] of each shape (each has mean 0)
    return {
      process(L, R, n, P, t) {
        const di = P.sync | 0;
        for (let k = 0; k < 3; k++) { if (di === 0) lfos[k].rate(P.rate); else lfos[k].sync(DIVS[di - 1][1], t); }
        const sh = clamp(P.shape | 0, 0, 2), pan = (P.mode | 0) === 1;
        const d = clamp(P.depth, 0, 1), a = 1 - d / 2, h = d / 2;
        const mk = 1 / Math.sqrt(a * a + h * h * M2[sh]);
        const o0 = lfos[0], o1 = lfos[1], o2 = lfos[2];
        for (let i = 0; i < n; i++) {
          const m0 = o0.next(), m1 = o1.next(), m2 = o2.next();
          const m = sh === 0 ? m0 : sh === 1 ? m1 : m2;
          const gl = (a + h * m) * mk, gr = (pan ? a - h * m : a + h * m) * mk;
          L[i] *= sL.tick(gl); R[i] *= sR.tick(gr);
        }
      },
    };
  },
};
`),
});
