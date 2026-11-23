// @ts-check
// core.tremolo: Flutter Valve. Amplitude tremolo, or an auto-pan with MODE, from one LFO that is either free (RATE in
// Hz) or locked to the song (SYNC, a note division from the transport's tempo). SHAPE picks sine, triangle or square.
// Every gain goes through a 2.5 ms slew, so a square steps without a click and a MODE switch glides. DEPTH 0 is
// exactly the input; otherwise a fixed makeup, worked out from the shape and depth, keeps the level near bypass.
import { defineDevice } from '../registry.js';
import { kernel, DIV_LABELS } from './lib.js';

export default defineDevice({
  id: 'core.tremolo', name: 'Flutter Valve', kind: 'effect', cat: 'mod', by: 'overdub',
  blurb: 'Tremolo and stereo auto-pan, free or in time with the song',
  nod: 'a suitcase-amp tremolo and a stereo auto-panner',
  params: [
    { key: 'rate', label: 'RATE', min: 0.1, max: 20, def: 4, curve: 'log', unit: 'Hz', role: 'rate', desc: 'how fast it pulses when SYNC is FREE' },
    { key: 'div', label: 'SYNC', opts: ['FREE', ...DIV_LABELS], def: 0, role: 'time', desc: 'pulse as a note length of the song tempo (FREE uses RATE)' },
    { key: 'depth', label: 'DEPTH', min: 0, max: 1, def: 0.5, role: 'depth', desc: 'how far the level dips: none to all the way' },
    { key: 'shape', label: 'SHAPE', opts: ['SINE', 'TRIANGLE', 'SQUARE'], def: 0, role: 'shape', desc: 'smooth, pointed, or on and off' },
    { key: 'mode', label: 'MODE', opts: ['TREMOLO', 'PAN'], def: 0, role: 'width', desc: 'both sides together, or swinging left and right' },
  ],
  look: { color: '#5b2a3c', ink: '#ffeef3', shape: 'box', finish: 'tolex', knob: 'chrome', label: 'block', led: '#ff9db8' },
  tail: 0,
  kernel: kernel(String.raw`
return {
  create({ sr, dsp }) {
    const lf = [dsp.lfo('sine', 4), dsp.lfo('tri', 4), dsp.lfo('square', 4)];
    const gl = dsp.slew(2.5, 2.5, 1), gr = dsp.slew(2.5, 2.5, 1);
    // mean of u squared for sine, triangle and square, u being the LFO in 0..1
    const U2 = [3 / 8, 1 / 3, 1 / 2];
    return {
      process(L, R, n, P, t) {
        const di = P.div | 0, sh = clamp(P.shape | 0, 0, 2), pan = (P.mode | 0) === 1;
        const d = clamp(P.depth, 0, 1);
        const beats = di > 0 ? DIVS[clamp(di, 1, DIVS.length) - 1][1] : 0;
        for (let k = 0; k < 3; k++) {
          if (beats > 0) { lf[k].rate(2 / beats); if (t) lf[k].sync(beats, t); }
          else lf[k].rate(clamp(P.rate, 0.1, 20));
        }
        const mk = d === 0 ? 1 : Math.min(1.26, 1 / Math.sqrt(1 - d + d * d * U2[sh]));
        for (let i = 0; i < n; i++) {
          // all three advance together, so switching SHAPE never jumps the phase
          const a = lf[0].next(), b = lf[1].next(), c = lf[2].next();
          const u = 0.5 + 0.5 * (sh === 0 ? a : sh === 1 ? b : c);
          const tl = (1 - d * u) * mk, tr = (pan ? 1 - d * (1 - u) : 1 - d * u) * mk;
          L[i] *= gl.tick(tl); R[i] *= gr.tick(tr);
        }
      },
    };
  },
};
`),
});
