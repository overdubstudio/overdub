// @ts-check
// Calibration, drawn [ui; gauges]: strum on eight clicks, and the round trip is measured, judged and kept for the
// interface (input/calibrate.js runs it; input/latency.js clicks, captures and finds the onsets; docs/research/
// GUITAR-ROOM.md §2.1, Getting started's Timing). Eight lamps (the first two the count), each strum as a dot on a line
// of milliseconds after the click, the median and the browser's guess marked, how sure it is, and Keep and Again. Any
// screen mounts it; it draws in frame(now) from the host's loop and owns no keys (its buttons take focus and Enter).
//
//   mountTiming(el, { latency, label }) -> { frame(now), start(), stop(), cal (input/calibrate.js's), el, unmount() }
//     latency: app.input.audio.latency; label: the interface's name, or a function that gives it (the words say
//     "Kept for Scarlett Solo USB")
//
// The clicks are sound: start() plays them (through latency.measure). A check swaps latency.measure for a fake that
// calls onStep as the real one does (tools/input-test.js), so nothing plays on the machine running it.

import { h, css } from '../dom.js';
import { createCalibration, fmtMs } from '../../input/calibrate.js';

const CSS = `
.gg-timing { display: grid; gap: 10px; min-width: 0; width: 100%; color: var(--text); font-family: var(--font-ui); }
.gg-tm-lamps { display: flex; gap: 8px; flex-wrap: wrap; }
.gg-tm-lamp { display: grid; place-items: center; width: 34px; height: 34px; border: var(--rule-2); font: 700 12px/1 var(--font-mono); color: var(--text-3); transition: background-color 60ms linear; }
.gg-tm-lamp.w { border-style: dashed; }
.gg-tm-lamp.lit { background: var(--text); color: var(--bg); border-color: var(--text); }
.gg-tm-lamp.got { color: var(--text); border-color: var(--ok); }
.gg-tm-lamp.miss { color: var(--bad); border-color: var(--bad); }
.gg-tm-line { width: 100%; height: 84px; display: block; }
.gg-tm-line .ax { stroke: var(--line-2); stroke-width: 1; }
.gg-tm-line .tk { stroke: var(--line-2); }
.gg-tm-line .tk.z { stroke: var(--text-2); stroke-width: 2; }
.gg-tm-line text { fill: var(--text-3); font: 500 11px var(--font-mono); text-anchor: middle; }
.gg-tm-line .est { stroke: var(--text-3); stroke-dasharray: 3 3; }
.gg-tm-line text.est { fill: var(--text-3); stroke: none; }
.gg-tm-line .med { stroke: var(--ok); stroke-width: 2; }
.gg-tm-line text.med { fill: var(--ok); stroke: none; }
.gg-tm-line circle { fill: var(--text); }
.gg-tm-line circle.w { fill: none; stroke: var(--text-3); }
.gg-tm-line circle.out { fill: none; stroke: var(--bad); }
.gg-tm-say { margin: 0; min-height: 2.6em; font: 500 15px/1.35 var(--font-ui); color: var(--text-2); }
.gg-tm-conf { display: flex; align-items: center; gap: 10px; font: 500 13px/1 var(--font-mono); color: var(--text-2); }
.gg-tm-conf[hidden] { display: none; }
.gg-tm-conf i { position: relative; width: 120px; height: 6px; background: var(--bg-3); overflow: hidden; }
.gg-tm-conf i b { position: absolute; inset: 0; background: var(--ok); transform-origin: 0 50%; }
.gg-tm-acts { display: flex; flex-wrap: wrap; gap: 8px; }
.gg-tm-acts button { min-height: 36px; padding: 0 14px; border: var(--rule-2); border-radius: var(--r-press); background: transparent; color: var(--text); font: 600 14px/1 var(--font-ui); cursor: pointer; }
.gg-tm-acts button[hidden] { display: none; }
.gg-tm-acts button:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.gg-tm-acts .go { background: var(--text); color: var(--bg); border-color: var(--text); }
@media (hover: none) { .gg-tm-acts button { min-height: 44px; } }
`;

/** @param {HTMLElement} el @param {{ latency: any, label?: string | (() => string) }} o */
export function mountTiming(el, { latency, label = '' } = /** @type {any} */ ({})) {
  css('gg-timing', CSS);
  const cal = createCalibration({ latency, label });
  const lamps = Array.from({ length: 8 }, (_, i) => h('i.gg-tm-lamp' + (i < 2 ? '.w' : ''), { 'aria-hidden': 'true' }, i < 2 ? String(i + 1) : String(i - 1)));
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
  svg.setAttribute('class', 'gg-tm-line'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Your strums, in milliseconds after each click');
  const say = h('p.gg-tm-say', { 'aria-live': 'polite' });
  const confBar = h('b'), confTxt = h('span');
  const conf = h('div.gg-tm-conf', { hidden: true }, h('span', 'Sure'), h('i', confBar), confTxt);
  const go = h('button.go', { type: 'button', onclick: () => (cal.state.phase === 'listening' ? cal.stop() : cal.start()) }, 'Strum along');
  const keep = h('button', { type: 'button', hidden: true, onclick: () => cal.keep() }, 'Keep it');
  const forget = h('button', { type: 'button', hidden: true, onclick: () => cal.forget() }, 'Forget it');
  const root = h('div.gg-timing', { role: 'group', 'aria-label': 'Timing', dataset: { phase: 'idle' } },
    say, h('div.gg-tm-lamps', lamps), svg, conf, h('div.gg-tm-acts', go, keep, forget));
  el.append(root);
  let gone = false, dirty = true, lastStep = -2, litAt = 0, w0 = 0;
  const off = cal.on(() => { dirty = true; });

  function line() {
    const st = cal.state, hits = st.hits, est = (st.estimate || 0) * 1000, r = st.result;
    const W = Math.max(240, Math.round(svg.clientWidth || 600)), H = 84, L = 16, R = W - 16;
    w0 = W;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const vals = hits.filter((v) => v != null && Number.isFinite(v));
    const lo = Math.min(-20, Math.floor((Math.min(...vals, est || 0) - 10) / 20) * 20), hi = Math.max(80, Math.ceil((Math.max(...vals, est || 0) + 15) / 20) * 20);
    const X = (/** @type {number} */ ms) => L + ((ms - lo) / (hi - lo)) * (R - L), step = (hi - lo) / (W / 60) > 20 ? 50 : 20;
    let s = `<line class="ax" x1="${L}" x2="${R}" y1="56" y2="56"/>`;
    const last = Math.floor(hi / step) * step;
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) s += `<line class="tk${t === 0 ? ' z' : ''}" x1="${X(t)}" x2="${X(t)}" y1="${t === 0 ? 12 : 52}" y2="60"/><text x="${X(t)}" y="76">${t === 0 ? 'click' : t === last ? `${t} ms` : t}</text>`;
    if (est > 0) s += `<line class="est" x1="${X(est)}" x2="${X(est)}" y1="18" y2="56"/><text class="est" x="${X(est)}" y="12">guess</text>`;
    if (r && r.grade !== 'none' && Number.isFinite(r.ms)) s += `<line class="med" x1="${X(r.ms)}" x2="${X(r.ms)}" y1="18" y2="60"/><text class="med" x="${X(r.ms)}" y="12">${fmtMs(Math.max(0, r.ms))} ms</text>`;
    const placed = [];
    hits.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) return;
      const x = X(v);
      let y = 46;
      while (placed.some((p) => Math.abs(p.x - x) < 10 && Math.abs(p.y - y) < 9) && y > 22) y -= 9;
      placed.push({ x, y });
      const out = r && r.dropped != null && i >= 2 && v === r.dropped;
      s += `<circle class="${i < 2 ? 'w' : out ? 'out' : 'h'}" cx="${x.toFixed(1)}" cy="${y}" r="4.5"><title>${i < 2 ? `Count ${i + 1}` : `Strum ${i - 1}`}: ${fmtMs(v)} ms${out ? ' (left out)' : ''}</title></circle>`;
    });
    svg.innerHTML = s;
  }
  function paint() {
    const st = cal.state, r = st.result;
    root.dataset.phase = st.phase;
    say.textContent = cal.line();
    lamps.forEach((el2, i) => {
      el2.classList.toggle('got', st.hits[i] != null && st.hits[i] !== undefined);
      el2.classList.toggle('miss', st.hits[i] === null);
    });
    const listening = st.phase === 'listening';
    go.textContent = listening ? 'Stop' : r || st.measured ? 'Again' : 'Strum along';
    keep.hidden = !(st.phase === 'done' && r && r.grade !== 'none' && !st.kept);
    forget.hidden = listening || !st.measured;
    const showConf = !!(r && st.phase === 'done');
    conf.hidden = !showConf;
    if (showConf) { confBar.style.transform = `scaleX(${r.confidence})`; confTxt.textContent = `${Math.round(r.confidence * 100)}%`; }
    line();
  }

  return {
    el: root,
    cal,
    start: () => cal.start(),
    stop: () => cal.stop(),
    /** @param {number} now */
    frame(now) {
      if (gone) return;
      const t = Number.isFinite(now) ? now : performance.now();
      if (dirty || (svg.clientWidth && Math.abs(svg.clientWidth - w0) > 4)) { dirty = false; paint(); }
      // the lamp of the click sounding now, lit for 180 ms
      const step = cal.state.step;
      if (step !== lastStep) { lastStep = step; litAt = t; }
      lamps.forEach((el2, i) => el2.classList.toggle('lit', i === step && t - litAt < 180));
    },
    unmount() { gone = true; off(); cal.dispose(); root.remove(); },
  };
}
