// @ts-check
// The tuner pedal, Tuna Fork, and its zoom [ui; the guitar room's START stream] (docs/research/GUITAR-ROOM.md §2.1
// "a real tuner, big, on the stage"; design/mock/guitar-room-2/ shots 01d, 01e, 03f). The room's own pedal, first on
// the board: not a device in the chain (nothing in the song), so it's drawn here, at the place the room keeps for it
// (./stage.js rect('tuner')). Its window shows the note, the string and the cents; its footswitch and U stomp it; while
// it's on you're muted (./start.js mutes the monitor and puts it back). Its zoom's panel (R.panel('tuner')) holds the
// real gauge (ui/gauges/tuner.js: the needle or the strobe), the strings of the tuning lighting as each comes in, the
// tunings, and the way off.
//
//   createTunaFork({ onStomp }) -> pedal = { el, place(rect), update(reading, { on, input }) }
//       el: the pedal at its design size (120 x 182, a keycap under it), placed and scaled into a rect in stage world
//       units; update paints the window (cheap: it only touches what changed)
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
.gr-tf { position: absolute; left: 0; top: 0; width: 120px; height: 206px; transform-origin: 0 0; pointer-events: auto; }
.gr-tf-body { position: absolute; left: 0; top: 0; width: 120px; height: 182px; border-radius: 7px; background: linear-gradient(#2c3540, #1a2028);
  box-shadow: inset 0 0 0 1px #46525e, inset 0 2px 0 #ffffff14, 0 6px 10px #0009; font-family: var(--font-ui); color: #d8e4ee; cursor: pointer; }
.gr-tf-win { position: absolute; left: 9px; right: 9px; top: 12px; height: 62px; border-radius: 4px; background: #05080a; box-shadow: inset 0 0 0 2px #0f1418; overflow: hidden; }
.gr-tf-leds { position: absolute; left: 6px; right: 6px; top: 8px; display: flex; gap: 2px; justify-content: center; }
.gr-tf-leds i { flex: 1; height: 9px; border-radius: 1px; background: #16201a; }
.gr-tf-leds i.mid { background: #1d2a20; }
.gr-tf-leds i.on { background: #ffc85a; box-shadow: 0 0 4px #ffc85aaa; }
.gr-tf-leds i.mid.on { background: #8fdca0; box-shadow: 0 0 6px #8fdca0; }
.gr-tf-note { position: absolute; left: 0; right: 0; top: 22px; text-align: center; font: 700 30px/1 var(--font-mono); color: #1d2a20; }
.gr-tf-note sub { font-size: 11px; vertical-align: baseline; margin-left: 1px; }
.gr-tf[data-on="1"] .gr-tf-note { color: #d8f4e0; text-shadow: 0 0 8px #8fdca066; }
.gr-tf[data-on="1"] .gr-tf-note.in { color: #8fdca0; }
.gr-tf[data-on="1"][data-held="1"] .gr-tf-note { opacity: .55; }
.gr-tf-str, .gr-tf-cents { position: absolute; bottom: 3px; font: 600 8px/1 var(--font-mono); color: #4a6a54; letter-spacing: .04em; }
.gr-tf-str { left: 5px; } .gr-tf-cents { right: 5px; }
.gr-tf[data-on="1"] .gr-tf-str, .gr-tf[data-on="1"] .gr-tf-cents { color: #8fdca0; }
.gr-tf-name { position: absolute; left: 0; right: 0; top: 84px; text-align: center; pointer-events: none; }
.gr-tf-name b { display: block; font: 800 italic 17px/1 var(--font-display); font-variation-settings: var(--font-display-vars); color: #e8f2fa; }
.gr-tf-name small { display: block; margin-top: 4px; font: 700 8px/1 var(--font-ui); letter-spacing: .16em; color: #8aa0b2; }
.gr-tf-mute { position: absolute; left: 12px; top: 120px; font: 700 8px/1 var(--font-ui); letter-spacing: .14em; color: #4a5866; display: flex; align-items: center; gap: 5px; pointer-events: none; }
.gr-tf-mute i { width: 7px; height: 7px; border-radius: 50%; background: #3a3022; }
.gr-tf[data-on="1"] .gr-tf-mute { color: #d8e4ee; }
.gr-tf[data-on="1"] .gr-tf-mute i { background: #ffc85a; box-shadow: 0 0 6px #ffc85a; }
.gr-tf-sw { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); width: 40px; height: 40px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
  background: radial-gradient(circle at 40% 35%, #f4f4f6, #9a9aa2 60%, #5a5a62); box-shadow: 0 0 0 3px #222, 0 3px 4px #000a; }
.gr-tf-sw:active { transform: translateX(-50%) translateY(1px); }
.gr-tf-sw:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 3px; }
.gr-tf-cap { position: absolute; left: 50%; top: 186px; transform: translateX(-50%); padding: 2px 6px; border: 1px solid #3a3a3a; border-radius: 2px; background: #0d0c0b;
  font: 600 10px/1.1 var(--font-mono); color: #8a8f88; white-space: nowrap; pointer-events: none; }
.gr-tf-cap b { color: #8fdca0; font-weight: 600; margin-left: 4px; }
.gr-tf[data-on="1"] .gr-tf-cap { color: var(--text); border-color: #8a8f88; }

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
.gr-tp kbd, .gr-tf kbd { font: 400 11px/1 var(--font-mono); color: inherit; border: 1px solid currentColor; border-radius: var(--r-press); padding: 2px 4px; opacity: .72; }
.gr-tp .gg-tuner { margin-top: 2px; }
@media (prefers-reduced-motion: reduce) { .gr-tf-sw:active { transform: translateX(-50%); } }
`;

const LEDS = 15;

/** @param {{ onStomp: () => void }} o */
export function createTunaFork({ onStomp }) {
  css('gr-start-tuner', CSS);
  const leds = Array.from({ length: LEDS }, (_, i) => h('i' + (i === 7 ? '.mid' : '')));
  const note = h('div.gr-tf-note', '–'), str = h('span.gr-tf-str'), cents = h('span.gr-tf-cents'), capOn = h('b', 'off');
  const sw = h('button.gr-tf-sw', { type: 'button', 'aria-label': 'Tuna Fork, the tuner: stomp it on or off (U)', 'aria-pressed': 'false', onclick: (e) => { e.stopPropagation(); onStomp(); } });
  const body = h('div.gr-tf-body', { onclick: () => onStomp() },
    h('div.gr-tf-win', { 'aria-hidden': 'true' }, h('div.gr-tf-leds', leds), note, str, cents),
    h('div.gr-tf-name', { 'aria-hidden': 'true' }, h('b', 'Tuna Fork'), h('small', 'TUNER · MUTE')),
    h('div.gr-tf-mute', { 'aria-hidden': 'true' }, h('i'), 'MUTE'),
    sw);
  const el = h('div.gr-tf', { dataset: { on: '0', start: 'tuner' }, role: 'group', 'aria-label': 'Tuna Fork, the tuner pedal' }, body, h('span.gr-tf-cap', { 'aria-hidden': 'true' }, 'U', capOn));
  let key = '', at = '';
  return {
    el,
    /** @param {{ x: number, y: number, w: number, h: number } | null} r */
    place(r) {
      if (!r) return;
      const k = `${r.x},${r.y},${r.w},${r.h}`;
      if (k === at) return;
      at = k;
      const s = Math.min(r.w / 120, r.h / 206);
      el.style.transform = `translate(${(r.x + (r.w - 120 * s) / 2).toFixed(1)}px, ${r.y.toFixed(1)}px) scale(${s.toFixed(4)})`;
    },
    /** @param {any} rd @param {{ on: boolean, input: boolean }} o */
    update(rd, { on, input }) {
      const r = on ? rd || READING_NONE : READING_NONE;
      const c = r.p ? Math.max(-7, Math.min(7, Math.round((r.cents ?? (r.midi - r.p) * 100) / 6.5))) : null;
      const k = `${on}|${input}|${r.p}|${r.octave}|${c}|${r.inTune}|${r.held}|${r.shown}|${r.string?.number}`;
      if (k === key) return;
      key = k;
      el.dataset.on = on ? '1' : '0';
      el.dataset.held = r.held ? '1' : '0';
      sw.setAttribute('aria-pressed', String(!!on));
      capOn.textContent = on ? 'on' : 'off';
      leds.forEach((l, i) => l.classList.toggle('on', !!on && c != null && (i === 7 + c || (r.inTune && Math.abs(i - 7) <= 1))));
      if (!on) { note.textContent = '–'; str.textContent = ''; cents.textContent = ''; note.classList.remove('in'); return; }
      if (!r.p) { note.textContent = input ? '–' : '··'; str.textContent = input ? '' : 'NO INPUT'; cents.textContent = ''; note.classList.remove('in'); return; }
      note.replaceChildren(r.note, h('sub', String(r.octave)));
      note.classList.toggle('in', !!r.inTune);
      str.textContent = r.string ? `STRING ${r.string.number}` : '';
      cents.textContent = r.shown == null ? '' : r.shown === 0 ? '0¢' : `${r.shown > 0 ? '+' : '−'}${Math.abs(r.shown)}¢`;
    },
  };
}

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
        const v = tunerSays(r, { n: done.size, of: T.strings.length, tuning: tuningName(T) });
        if (v !== vKey) { vKey = v; verdict.textContent = v; }
      }
      const k = `${input()}`;
      if (k !== sayKey) { sayKey = k; paintGo(); }
      return reading;
    },
    unmount() { gauge.unmount(); root.remove(); },
  };
}
