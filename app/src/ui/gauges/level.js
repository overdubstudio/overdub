// @ts-check
// The level meter, drawn [ui; gauges]: the input's peak against the −12 to −6 dBFS window a guitar wants, a peak hold,
// a clip lamp, the number, and what to do with the interface's gain knob (input/level.js says it; docs/research/
// GUITAR-ROOM.md §2.1, Getting started's Plug in). Any screen mounts it; it draws in frame(now) from the host's loop
// and owns no keys.
//
//   mountLevel(el, { source, device, onPickChannel, advice }) -> {
//       frame(now)        read the input and draw (each frame: the analyser's window overlaps the last, so no peak
//                         between two frames is missed at 12 frames a second or more)
//       state             input/level.js's state (verdict, advice, strum, hold, clip, good ...)
//       setDevice(label)  the interface's name (a Focusrite's advice mentions the ring round its knob)
//       reset()           listen again (the gain was moved, or another input)
//       el, meter (input/level.js's), unmount() }
//     source: anything with samples() -> { buf, sr } | null (app.input.audio, or a check's fake); with levels() ->
//             [{ ch, db }] too and onPickChannel(ch) given, a small bar per channel, each a button that picks it (the
//             guitar is on the one that moves); advice: false leaves the words out (a strip)
//
// The bar runs −60 to 0 dBFS; the window is marked in --ok, the part over −6 in --warn, the clip lamp lights --bad
// (press it to put it out). The words change at most twice a second and are a polite live region.

import { h, css } from '../dom.js';
import { createLevel, meterPos } from '../../input/level.js';

const CSS = `
.gg-level { display: grid; gap: 8px; min-width: 0; width: 100%; color: var(--text); font-family: var(--font-ui); }
.gg-lv-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.gg-lv-bar { position: relative; flex: 1; min-width: 0; height: 18px; background: var(--bg-3); border: var(--rule-2); overflow: hidden; }
.gg-lv-zone { position: absolute; top: 0; bottom: 0; background: var(--ok); opacity: 0.22; }
.gg-lv-hot { position: absolute; top: 0; bottom: 0; right: 0; background: var(--warn); opacity: 0.12; }
.gg-lv-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; background: var(--text-2); transform-origin: 0 50%; transform: scaleX(0); }
.gg-level[data-verdict="ok"] .gg-lv-fill { background: var(--ok); }
.gg-level[data-verdict="hot"] .gg-lv-fill { background: var(--warn); }
.gg-level[data-verdict="clip"] .gg-lv-fill { background: var(--bad); }
.gg-lv-hold { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--text); left: 0; }
.gg-lv-db { flex: none; min-width: 7.5ch; text-align: right; font: 600 15px/1 var(--font-mono); font-variant-numeric: tabular-nums; }
.gg-lv-clip { flex: none; min-height: 28px; padding: 0 8px; border: var(--rule-2); border-radius: var(--r-press); background: transparent; color: var(--text-3); font: 700 11px/1 var(--font-mono); letter-spacing: 0.06em; cursor: pointer; }
.gg-lv-clip[aria-pressed="true"] { background: var(--bad); border-color: var(--bad); color: var(--bg); }
.gg-lv-clip:focus-visible, .gg-lv-ch:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.gg-lv-scale { position: relative; height: 14px; margin-right: calc(7.5ch + 10px + 52px); font: 500 11px/14px var(--font-mono); color: var(--text-3); }
.gg-lv-scale span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.gg-lv-scale span:first-child { transform: none; }
.gg-lv-scale span:last-child { transform: translateX(-100%); }
.gg-lv-scale .z { color: var(--ok); }
.gg-lv-say { margin: 0; min-height: 2.6em; font: 500 15px/1.35 var(--font-ui); color: var(--text-2); }
.gg-level[data-verdict="ok"] .gg-lv-say { color: var(--text); }
.gg-lv-chs { display: flex; flex-wrap: wrap; gap: 6px; }
.gg-lv-ch { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 10px; border: var(--rule-2); border-radius: var(--r-press); background: transparent; color: var(--text-2); font: 600 13px/1 var(--font-ui); cursor: pointer; }
.gg-lv-ch[aria-pressed="true"] { color: var(--text); border-color: var(--text-2); }
.gg-lv-ch i { position: relative; width: 36px; height: 6px; background: var(--bg-3); overflow: hidden; }
.gg-lv-ch i b { position: absolute; inset: 0; background: var(--text-2); transform-origin: 0 50%; transform: scaleX(0); }
@media (hover: none) { .gg-lv-clip, .gg-lv-ch { min-height: 44px; } }
`;

const pct = (/** @type {number} */ db) => `${(meterPos(db) * 100).toFixed(2)}%`;
const fmt = (/** @type {number} */ db) => (db <= -60 ? '−∞' : `${db < 0 ? '−' : '+'}${Math.abs(db).toFixed(1)}`);

/**
 * @param {HTMLElement} el
 * @param {{ source: any, device?: string, onPickChannel?: (ch: number) => void, advice?: boolean }} o
 */
export function mountLevel(el, { source, device = '', onPickChannel, advice = true } = /** @type {any} */ ({})) {
  css('gg-level', CSS);
  const meter = createLevel({ device });
  const fill = h('i.gg-lv-fill'), hold = h('i.gg-lv-hold'), db = h('span.gg-lv-db', '−∞');
  const zone = h('i.gg-lv-zone', { style: { left: pct(-12), width: `calc(${pct(-6)} - ${pct(-12)})` } }), hot = h('i.gg-lv-hot', { style: { left: pct(-6) } });
  const clip = h('button.gg-lv-clip', { type: 'button', 'aria-pressed': 'false', 'aria-label': 'Clip lamp (press to put it out)', onclick: () => { meter.clearClip(); paint(true); } }, 'CLIP');
  const bar = h('div.gg-lv-bar', { role: 'meter', 'aria-label': 'Input level', 'aria-valuemin': '-60', 'aria-valuemax': '0', 'aria-valuenow': '-60' }, zone, hot, fill, hold);
  const scale = h('div.gg-lv-scale', { 'aria-hidden': 'true' }, h('span', { style: { left: '0%' } }, '−60'), h('span', { style: { left: pct(-24) } }, '−24'), h('span.z', { style: { left: pct(-9) } }, '−12…−6'), h('span', { style: { left: '100%' } }, '0'));
  const say = h('p.gg-lv-say', { 'aria-live': 'polite' });
  const chs = h('div.gg-lv-chs', { hidden: true, role: 'group', 'aria-label': 'Input channels' });
  const root = h('div.gg-level', { dataset: { verdict: 'none' } }, chs, h('div.gg-lv-row', bar, db, clip), scale, advice ? say : null);
  el.append(root);
  let gone = false, sayAt = -1e9, saidText = '', last = { fill: -1, hold: -1, db: '', clip: null, verdict: '' }, chAt = -1e9;
  /** @type {Map<number, HTMLElement>} */
  const chEls = new Map();

  function paint(force = false) {
    const s = meter.state;
    if (!s) return;
    const f = Math.round(meterPos(s.db) * 400) / 400, hp = Math.round(meterPos(s.hold) * 400) / 400;
    if (force || f !== last.fill) { last.fill = f; fill.style.transform = `scaleX(${f})`; }
    if (force || hp !== last.hold) { last.hold = hp; hold.style.left = `${(hp * 100).toFixed(2)}%`; hold.hidden = s.hold <= -60; }
    const d = fmt(s.hold);
    if (force || d !== last.db) { last.db = d; db.textContent = `${d} dBFS`; bar.setAttribute('aria-valuenow', String(Math.max(-60, Math.round(s.hold)))); bar.setAttribute('aria-valuetext', `${d} dBFS peak`); }
    if (force || s.clip !== last.clip) { last.clip = s.clip; clip.setAttribute('aria-pressed', String(!!s.clip)); }
    if (force || s.verdict !== last.verdict) { last.verdict = s.verdict; root.dataset.verdict = s.verdict; }
  }
  function words(now) {
    const t = meter.state?.advice?.text || '';
    if (t === saidText || now - sayAt < 500) return;
    saidText = t; sayAt = now; say.textContent = t;
  }
  function channels(now) {
    if (!onPickChannel || !source?.levels || now - chAt < 50) return;
    chAt = now;
    let lv = [];
    try { lv = source.levels() || []; } catch { lv = []; }
    chs.hidden = lv.length < 2;
    if (lv.length < 2) return;
    const cur = String(source.state?.channel ?? '');
    // (another interface with fewer inputs: its missing channels' buttons go, so none picks an input that isn't there)
    for (const [ch, b] of chEls) if (!lv.some((x) => x.ch === ch)) { b.remove(); chEls.delete(ch); }
    for (const x of lv) {
      let b = chEls.get(x.ch);
      if (!b) {
        b = h('button.gg-lv-ch', { type: 'button', 'aria-pressed': 'false', onclick: () => onPickChannel(x.ch) }, `Input ${x.ch}`, h('i', h('b')));
        chEls.set(x.ch, b); chs.append(b);
      }
      /** @type {HTMLElement} */ (b.querySelector('b')).style.transform = `scaleX(${meterPos(x.db).toFixed(3)})`;
      b.setAttribute('aria-pressed', String(cur === String(x.ch)));
    }
  }

  return {
    el: root,
    meter,
    get state() { return meter.state; },
    setDevice(/** @type {string} */ label) { meter.device = String(label || ''); },
    reset() { meter.reset(); saidText = ''; paint(true); },
    /** @param {number} now */
    frame(now) {
      if (gone) return;
      const t = Number.isFinite(now) ? now : performance.now();
      let s = null;
      try { s = source ? source.samples() : null; } catch { s = null; }
      meter.push(s && s.buf ? s.buf : 0, t);
      if (!s && meter.state) meter.state.advice = { id: 'level.closed', text: 'The input isn’t open yet.', turn: null, by: 0 };
      paint();
      words(t);
      channels(t);
    },
    unmount() { gone = true; root.remove(); },
  };
}
