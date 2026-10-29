// @ts-check
// The tuner pedal, Tuna Fork, and its zoom [ui; the guitar room's START stream] (docs/research/GUITAR-ROOM.md §2.1
// "a real tuner, big, on the stage"; design/mock/guitar-room-2/ shots 01d, 01e, 03f). The room's own pedal, first on
// the board: not a device in the chain (nothing in the song). The room draws it (./stage.js, ./room-rig.js tunerFace);
// ./start.js reads the input and puts the reading at R.gr.tuner.reading for it; its footswitch and U stomp it; while
// it's on you're muted (./start.js mutes the monitor and puts it back). Its zoom's panel (R.panel('tuner')) holds the
// real gauge (ui/gauges/tuner.js: the needle or the strobe), the strings of the tuning lighting as each comes in, the
// tunings, and the way off.
//
//   createTunerPanel(el, { source, tuning, style, onStomp, onTuning, onStyle, tunings }) -> panel = {
//       frame(now, on) -> reading       read the input through the gauge while on (READING_NONE while off)
//       setTuning(id | null), setStyle('needle' | 'strobe'), done (Set of string indexes in tune since it went on),
//       resetDone(), reading, tuning (the tuning now: input/tuner.js's), unmount() }
//   PANEL_TUNINGS                    the tunings offered, six-string first

import { h, css } from '../../dom.js';
import { mountTuner } from '../../gauges/tuner.js';
import { READING_NONE, TUNER_TUNINGS, tuningOf, tuningName, noteName, tuningsFromLow } from '../../../input/tuner.js';
import { W, tunerSays, tuningLabel } from './start-plan.js';

export const PANEL_TUNINGS = Object.freeze(['standard', 'drop-d', 'half-down', 'd-standard', 'drop-c', 'c-standard', 'b-standard', 'drop-b', 'drop-a', '7-standard', '7-drop-a']);

const CSS = `
.gr-tp { display: grid; gap: 12px; align-content: start; font-family: var(--font-ui); }
.gr-tp-head small { display: block; font: 700 11px/1.2 var(--font-ui); letter-spacing: .04em; color: var(--text-3); }
.gr-tp-head h2 { margin: 2px 0 0; font: 800 italic 30px/1 var(--font-display); font-variation-settings: var(--font-display-vars); color: var(--text); }
.gr-tp p { margin: 0; color: var(--text-2); font-size: 14px; line-height: 1.4; }
.gr-tp .gr-tp-verdict { color: var(--text); font-weight: 600; min-height: 1.4em; }
.gr-tp-strings { display: flex; gap: 6px; }
.gr-tp-strings span { flex: 1; text-align: center; padding: 6px 0 4px; border: 1px solid var(--line-2); border-radius: 2px; font: 700 15px/1 var(--font-mono); color: var(--text-3); }
.gr-tp-strings span small { display: block; font: 600 10px/1 var(--font-ui); margin-top: 4px; }
.gr-tp-strings span.ok { color: var(--ok); border-color: var(--ok); }
.gr-tp-strings span.now { color: var(--text); border-color: #ffc85a; }
.gr-tp h3 { margin: 4px 0 6px; font: 700 12px/1 var(--font-ui); color: var(--text-2); letter-spacing: .02em; }
.gr-tp-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.gr-tp-chips button { border: 1px solid var(--line-2); background: none; color: var(--text-2); border-radius: 2px; padding: 6px 8px; min-height: 30px; font: 500 12.5px/1 var(--font-ui); cursor: pointer; }
.gr-tp-chips button:hover { color: var(--text); border-color: var(--text-3); }
.gr-tp-chips button[aria-pressed="true"] { color: var(--bg); background: var(--text); border-color: var(--text); }
.gr-tp-chips button:focus-visible, .gr-tp-go:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.gr-tp-ask { border-top: var(--rule); padding-top: 10px; }
.gr-tp-ask[hidden] { display: none; }
.gr-tp-go { justify-self: start; display: inline-flex; align-items: center; gap: 10px; min-height: 38px; padding: 0 14px; border: 1px solid var(--accent); border-radius: var(--r-press);
  background: var(--accent); color: var(--bg); font: 600 14px/1 var(--font-ui); cursor: pointer; }
.gr-tp-go[data-on="0"] { background: none; color: var(--text); border-color: var(--line-2); }
.gr-tp kbd { font: 400 11px/1 var(--font-mono); color: inherit; border: 1px solid currentColor; border-radius: var(--r-press); padding: 2px 4px; opacity: .72; }
.gr-tp .gg-tuner { margin-top: 2px; }
`;

/**
 * @param {HTMLElement} el
 * @param {{ source: any, tuning: string | null, style: 'needle' | 'strobe', onStomp: () => void, onTuning: (id: string) => void,
 *   onStyle: (s: 'needle' | 'strobe') => void, on: () => boolean, input: () => boolean }} o
 */
export function createTunerPanel(el, { source, tuning, style, onStomp, onTuning, onStyle, on, input }) {
  css('gr-start-tuner', CSS);
  const say = h('p.gr-tp-say');
  const strings = h('div.gr-tp-strings', { role: 'list', 'aria-label': 'The strings' });
  const verdict = h('p.gr-tp-verdict', { 'aria-live': 'polite' });
  const gaugeEl = h('div.gr-tp-gauge');
  const ask = h('div.gr-tp-ask', { hidden: true });
  const chips = h('div.gr-tp-chips', { role: 'group', 'aria-label': 'Tuning' });
  const looks = h('div.gr-tp-chips', { role: 'group', 'aria-label': 'The look' });
  const go = h('button.gr-tp-go', { type: 'button', onclick: () => onStomp() });
  const root = h('div.gr-tp', h('div.gr-tp-head', h('small', W.tunerHead), h('h2', 'Tuna Fork')), say, strings, verdict, gaugeEl, ask,
    h('div', h('h3', W.tunerTunings), chips), h('div', h('h3', W.tunerLook), looks), go);
  el.replaceChildren(root);
  const gauge = mountTuner(gaugeEl, { source, tuning: tuningOf(tuning || 'standard'), style, size: 'big' });
  let T = tuningOf(tuning || 'standard'), tid = tuning || 'standard', st = style, reading = READING_NONE;
  const done = new Set();
  let inAt = -1, inS = -1, lowAt = -1, lowP = 0, asked = 0, sayKey = '', vKey = '', lastV = 0;

  function paintStrings(nowS = -1) {
    const k = `${tid}|${[...done].join(',')}|${nowS}`;
    if (strings.dataset.k === k) return;
    strings.dataset.k = k;
    const n = T.strings.length;
    strings.replaceChildren(...T.strings.map((m, i) => h('span' + (done.has(i) ? '.ok' : i === nowS ? '.now' : ''), { role: 'listitem', 'aria-label': `${n - i}: ${noteName(m)}${done.has(i) ? ', in tune' : ''}` }, noteName(m), h('small', String(n - i)))));
  }
  function paintChips() {
    chips.replaceChildren(...PANEL_TUNINGS.map((id) => h('button', { type: 'button', 'aria-pressed': String(id === tid), onclick: () => onTuning(id) }, tuningLabel(tuningName(TUNER_TUNINGS[id])))));
    looks.replaceChildren(...['needle', 'strobe'].map((s) => h('button', { type: 'button', 'aria-pressed': String(s === st), onclick: () => onStyle(/** @type {any} */ (s)) }, s === 'needle' ? 'Needle' : 'Strobe')));
  }
  function paintGo() {
    const o = on();
    go.dataset.on = o ? '1' : '0';
    go.replaceChildren(o ? 'Stomp it off' : 'Stomp it on', h('kbd', 'U'));
    say.textContent = o ? (input() ? W.tunerOn : W.tunerClosed) : W.tunerOff;
  }
  // a low string that isn't in the tuning: which tuning is it? (input/tuner.js tuningsFromLow; the input stream's
  // advice: ask from the low string)
  function paintAsk(p) {
    if (p === asked) return;
    asked = p;
    if (!p) { ask.hidden = true; ask.replaceChildren(); return; }
    const opts = tuningsFromLow(p, { strings: T.strings.length }).filter((x) => PANEL_TUNINGS.includes(x.id)).slice(0, 3);
    if (!opts.length) { ask.hidden = true; return; }
    ask.hidden = false;
    ask.replaceChildren(h('p', W.tunerWhich(noteName(p), tuningName(TUNER_TUNINGS[opts[0].id]), opts[1] ? tuningName(TUNER_TUNINGS[opts[1].id]) : '')),
      h('div.gr-tp-chips', opts.map((x) => h('button', { type: 'button', onclick: () => onTuning(x.id) }, tuningLabel(x.name)))));
  }

  paintStrings(); paintChips(); paintGo();
  let wasOn = null;
  return {
    get reading() { return reading; },
    get tuning() { return T; },
    get tuningId() { return tid; },
    done,
    resetDone() { done.clear(); inAt = -1; inS = -1; paintStrings(); },
    setTuning(/** @type {string | null} */ id) {
      tid = id && TUNER_TUNINGS[id] ? id : 'standard';
      T = tuningOf(tid);
      gauge.setTuning(T);
      done.clear(); paintStrings(); paintChips(); paintAsk(0); vKey = '';
    },
    setStyle(/** @type {'needle' | 'strobe'} */ s) { st = s === 'strobe' ? 'strobe' : 'needle'; gauge.setStyle(st); paintChips(); },
    /** @param {number} now @param {boolean} isOn */
    frame(now, isOn) {
      if (isOn !== wasOn) { wasOn = isOn; paintGo(); if (isOn) { gauge.tuner.reset(); reading = READING_NONE; } }
      if (!isOn) { reading = READING_NONE; return reading; }
      gauge.frame(now);
      reading = gauge.reading;
      const r = reading, s = r.string;
      // a string is in once it has read in tune to its own note, settled, for a quarter second (r.inTune is to the
      // nearest note: a C string tuned to C♯ is near it, and in tune to the wrong note)
      if (r.live && r.settled && r.inTune && s && s.near && (s.open == null || r.p === s.open)) {
        if (inS !== s.s) { inS = s.s; inAt = now; }
        else if (now - inAt >= 250 && !done.has(s.s)) done.add(s.s);
      } else if (!r.inTune) inS = -1;
      paintStrings(r.p && s ? s.s : -1);
      // a low note held a second that's no string of this tuning (or more than a semitone off its lowest): ask
      if (r.live && r.settled && r.p && r.p < T.strings[0] + 3 && (!s || !s.near)) { if (lowP !== r.p) { lowP = r.p; lowAt = now; } else if (now - lowAt > 900) paintAsk(r.p); }
      else if (s && s.near) { lowP = 0; if (asked) paintAsk(0); }
      // the line, at most four times a second
      if (now - lastV > 250) {
        lastV = now;
        // (nothing heard yet: the panel's first line already says what to do, so the verdict waits for a string)
        const v = !r.p && done.size < T.strings.length ? '' : tunerSays(r, { n: done.size, of: T.strings.length, tuning: tuningName(T) });
        if (v !== vKey) { vKey = v; verdict.textContent = v; }
      }
      const k = `${input()}`;
      if (k !== sayKey) { sayKey = k; paintGo(); }
      return reading;
    },
    unmount() { gauge.unmount(); root.remove(); },
  };
}
