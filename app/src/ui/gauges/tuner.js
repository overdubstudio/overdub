// @ts-check
// The tuner, drawn [ui; gauges]: a needle or a strobe over input/tuner.js's steady reading, the note big, the string
// it's on, the cents and the Hz (docs/research/GUITAR-ROOM.md §2.1: "a real tuner, big, on the stage"). Any screen
// mounts it; it draws in frame(now) from the host's loop (the shell's, or the room's) and owns no keys.
//
//   mountTuner(el, { source, tuning, style, size, onReading }) -> {
//       frame(now)            read the input (at most every 40 ms) and draw (every frame: the needle glides)
//       reading               the last reading (input/tuner.js's shape)
//       setTuning(id | { strings } | null)   the strings it names (null: any note, down to 30 Hz)
//       setStyle('needle' | 'strobe')        (with prefers-reduced-motion, the strobe draws as the needle)
//       el, tuner (the steady tuner), unmount() }
//     source: anything with samples() -> { buf, sr } | null: app.input.audio is one (input/audioin.js), a check's fake
//             is another; size: 'big' (the stage's card) | 'small' (a strip); onReading(reading) after each read
//
// What it shows: the nearest note and its octave; the needle from 50 cents flat to 50 sharp, a band at ±2 where it's in
// tune (the needle, the note and the band go --ok); the string ("6th string, low E") and, more than half a semitone off
// it, which way to turn ("Tune up to E"). While nothing plays, the last note stays dimmed for a second and a half. A
// line for screen readers says it at most once a second. Colours are the brand's tokens: never warm or cool (those
// are who did something), never leader green (that's the playhead).

import { h, css, canvas, tok } from '../dom.js';
import { createSteadyTuner, tuningName, tuningOf } from '../../input/tuner.js';

const CSS = `
.gg-tuner { display: grid; gap: 6px; justify-items: center; color: var(--text); font-family: var(--font-ui); min-width: 0; width: 100%; }
.gg-tu-face { position: relative; width: 100%; max-width: 560px; aspect-ratio: 2.4 / 1; }
.gg-tuner[data-size="small"] .gg-tu-face { max-width: 280px; aspect-ratio: 3.2 / 1; }
.gg-tu-face canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.gg-tu-read { display: flex; align-items: baseline; gap: 14px; min-height: 1em; font-variant-numeric: tabular-nums; }
.gg-tu-note { font: 800 italic 64px/1 var(--font-display); font-variation-settings: var(--font-display-vars); letter-spacing: -0.01em; min-width: 1.2em; text-align: center; }
.gg-tuner[data-size="small"] .gg-tu-note { font-size: 32px; }
.gg-tu-note sub { font: 600 0.32em/1 var(--font-mono); vertical-align: baseline; margin-left: 2px; color: var(--text-2); font-style: normal; }
.gg-tu-num { display: grid; gap: 2px; font: 500 14px/1.2 var(--font-mono); color: var(--text-2); }
.gg-tu-cents { font-size: 20px; color: var(--text); }
.gg-tuner[data-size="small"] .gg-tu-cents { font-size: 15px; }
.gg-tu-string { margin: 0; min-height: 1.3em; font: 600 15px/1.3 var(--font-ui); color: var(--text-2); text-align: center; }
.gg-tuner[data-state="intune"] .gg-tu-note, .gg-tuner[data-state="intune"] .gg-tu-cents { color: var(--ok); }
.gg-tuner[data-state="held"] .gg-tu-read, .gg-tuner[data-state="held"] .gg-tu-string { opacity: 0.5; }
.gg-tuner[data-state="none"] .gg-tu-note { color: var(--text-3); }
.gg-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
`;

const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/**
 * @param {HTMLElement} el
 * @param {{ source: { samples(): { buf: Float32Array, sr: number } | null } | null, tuning?: any, style?: 'needle' | 'strobe',
 *   size?: 'big' | 'small', onReading?: (r: any) => void }} o
 */
export function mountTuner(el, { source, tuning = 'standard', style = 'needle', size = 'big', onReading } = /** @type {any} */ ({})) {
  css('gg-tuner', CSS);
  const tuner = createSteadyTuner({ tuning });
  const cv = canvas('gg-tu-cv');
  const note = h('b.gg-tu-note', '–'), cents = h('span.gg-tu-cents', ''), hz = h('span.gg-tu-hz', '');
  const str = h('p.gg-tu-string', ''), sr = h('p.gg-sr', { 'aria-live': 'polite' });
  const root = h('div.gg-tuner', { role: 'group', 'aria-label': 'Tuner', dataset: { size, state: 'none', style } },
    h('div.gg-tu-face', cv.cv), h('div.gg-tu-read', note, h('span.gg-tu-num', cents, hz)), str, sr);
  el.append(root);
  let reading = tuner.reading, readAt = -1e9, saidAt = -1e9, said = '', lastNow = 0, needle = 0, phase = 0, gone = false;
  let st = style, colors = null, key = '', inputOn = false;
  const col = () => colors || (colors = { text: tok('--text') || '#f4ead6', t2: tok('--text-2') || '#cbc0aa', t3: tok('--text-3') || '#9a8f7c', line: tok('--line-2') || '#46413a', ok: tok('--ok') || '#8fdca0', mono: tok('--font-mono') || 'monospace', ui: tok('--font-ui') || 'sans-serif' });

  function paintText(r) {
    const k = `${inputOn}|${r.p}|${r.shown}|${r.inTune}|${r.live}|${r.held}|${r.string?.s}|${Math.round(r.string?.cents ?? 0)}|${r.hz.toFixed(1)}`;
    if (k === key) return;
    key = k;
    root.dataset.state = !r.p ? 'none' : r.held ? 'held' : r.inTune ? 'intune' : 'live';
    if (!r.p) { note.textContent = '–'; cents.textContent = ''; hz.textContent = ''; str.textContent = inputOn ? 'Play one string and let it ring.' : 'Plug in first.'; return; }
    note.replaceChildren(r.note, h('sub', String(r.octave)));
    cents.textContent = r.shown == null ? '' : r.shown === 0 ? '0¢' : `${r.shown > 0 ? '+' : '−'}${Math.abs(r.shown)}¢`;
    hz.textContent = `${r.hz.toFixed(1)} Hz`;
    const s = r.string, T = tuner.tuning;
    if (!s) { str.textContent = T ? '' : 'Any note'; return; }
    const strName = s.name.replace(/^(Low|High) /, (m) => m.toLowerCase());
    const where = `${ORD[s.number] || s.number} string, ${strName}`;
    str.textContent = Math.abs(s.cents) > 50 ? `${where}: tune ${s.cents < 0 ? 'up' : 'down'} to ${s.name.replace(/^(Low|High) /, '')}` : where;
  }
  function speak(r, now) {
    if (now - saidAt < 1000) return;
    const t = !r.p || r.held ? '' : r.shown == null ? r.note : r.inTune ? `${r.note}, in tune` : `${r.note}, ${Math.abs(r.shown)} cents ${r.shown < 0 ? 'flat' : 'sharp'}`;
    if (t && t !== said) { said = t; saidAt = now; sr.textContent = t; }
  }

  function drawNeedle(g, w, hh, c, r) {
    const cx = w / 2, cy = hh * 0.95, R = Math.min(w * 0.46, hh * 0.86), A = (Math.PI / 180) * 62; // ±62° for ±50 cents
    const ang = (x) => -Math.PI / 2 + (Math.max(-50, Math.min(50, x)) / 50) * A;
    // the in-tune band
    g.strokeStyle = c.ok; g.globalAlpha = r.inTune && r.live ? 0.55 : 0.22; g.lineWidth = Math.max(6, R * 0.07);
    g.beginPath(); g.arc(cx, cy, R * 0.93, ang(-2), ang(2)); g.stroke(); g.globalAlpha = 1;
    // ticks: every 5 cents, longer at 10s, longest at 0 and the ends
    for (let x = -50; x <= 50; x += 5) {
      const a = ang(x), big = x % 25 === 0, mid = x % 10 === 0, r0 = R * (big ? 0.78 : mid ? 0.83 : 0.87);
      g.strokeStyle = x === 0 ? c.text : big ? c.t2 : c.line; g.lineWidth = x === 0 ? 2.5 : big ? 2 : 1.25;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke();
    }
    g.fillStyle = c.t3; g.font = `600 ${Math.max(11, Math.round(R * 0.09))}px ${c.mono}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [x, t] of [[-50, '−50'], [-25, '−25'], [25, '+25'], [50, '+50']]) { const a = ang(+x); g.fillText(String(t), cx + Math.cos(a) * R * 0.66, cy + Math.sin(a) * R * 0.66); }
    g.font = `700 ${Math.max(14, Math.round(R * 0.16))}px ${c.ui}`;
    g.fillStyle = r.live && r.cents != null && r.cents <= -3 ? c.text : c.t3; g.fillText('♭', cx - R * 0.98, cy - R * 0.12);
    g.fillStyle = r.live && r.cents != null && r.cents >= 3 ? c.text : c.t3; g.fillText('♯', cx + R * 0.98, cy - R * 0.12);
    // the needle
    if (r.p) {
      const a = ang(needle);
      g.strokeStyle = r.inTune && r.live ? c.ok : c.text; g.globalAlpha = r.held ? 0.45 : r.cents == null ? 0.6 : 1; g.lineWidth = Math.max(2.5, R * 0.022); g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R * 0.97, cy + Math.sin(a) * R * 0.97); g.stroke();
      g.globalAlpha = 1; g.lineCap = 'butt';
    }
    g.fillStyle = c.t2; g.beginPath(); g.arc(cx, cy, Math.max(4, R * 0.035), 0, Math.PI * 2); g.fill();
  }
  // A strobe: three rows of marks (the note, its octave, two octaves) that drift left when flat and right when sharp,
  // faster the further off, and stand still in tune, as a Peterson's do
  function drawStrobe(g, w, hh, c, r) {
    const rows = 3, rh = hh / (rows + 0.6), pad = rh * 0.3;
    for (let k = 0; k < rows; k++) {
      const y = pad + k * rh, per = (w / 10) / (k + 1), off = ((phase * (k + 1)) % per + per) % per;
      g.fillStyle = r.inTune && r.live ? c.ok : c.text; g.globalAlpha = !r.p ? 0.12 : r.held ? 0.25 : 0.35 + 0.65 * Math.max(0, Math.min(1, (r.db + 50) / 30));
      for (let x = -per + off; x < w; x += per) g.fillRect(Math.round(x), Math.round(y), Math.max(2, Math.round(per / 2)), Math.round(rh * 0.7));
    }
    g.globalAlpha = 1;
    g.strokeStyle = c.t2; g.lineWidth = 1.5; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, hh); g.stroke();
  }

  const api = {
    el: root,
    tuner,
    get reading() { return reading; },
    setTuning(/** @type {any} */ t) { tuner.setTuning(t); key = ''; root.dataset.tuning = t == null ? '' : tuningOf(t).id; root.setAttribute('aria-label', t == null ? 'Tuner' : `Tuner, ${tuningName(tuningOf(t))}`); },
    setStyle(/** @type {'needle' | 'strobe'} */ s) { st = s === 'strobe' ? 'strobe' : 'needle'; root.dataset.style = st; },
    /** @param {number} now */
    frame(now) {
      if (gone) return;
      const t = Number.isFinite(now) ? now : performance.now();
      const dt = lastNow ? Math.max(0, Math.min(0.1, (t - lastNow) / 1000)) : 0;
      lastNow = t;
      if (t - readAt >= 40) {
        readAt = t;
        let s = null;
        try { s = source ? source.samples() : null; } catch { s = null; }
        inputOn = !!(s && s.buf && s.sr);
        if (s && s.buf && s.sr) { reading = tuner.push(s.buf, s.sr, t / 1000); try { onReading?.(reading); } catch (e) { console.error('tuner onReading', e); } }
      }
      const r = reading;
      // the needle glides to the reading (about 60 ms); with no cents yet it rests at 0
      const target = r.p ? (r.cents ?? (r.midi - r.p) * 100) : 0;
      needle += (target - needle) * (dt ? 1 - Math.exp(-dt / 0.06) : 1);
      phase += dt * (r.p && r.live && r.cents != null && !r.inTune ? Math.max(-50, Math.min(50, r.cents)) * 6 : 0);
      paintText(r);
      speak(r, t);
      cv.fit();
      const g = cv.g, w = cv.w, hh = cv.h, c = col();
      g.clearRect(0, 0, w, hh);
      if (st === 'strobe' && !reduced()) drawStrobe(g, w, hh, c, r); else drawNeedle(g, w, hh, c, r);
    },
    unmount() { gone = true; root.remove(); },
  };
  api.setTuning(tuning);
  api.setStyle(style);
  return api;
}
