// @ts-check
// Calibration: strum on eight clicks, and the round trip is measured and kept for the interface (docs/research/
// GUITAR-ROOM.md §2.1, Getting started's Timing). The clicks, the capture and the onsets are input/latency.js's
// (ported from Claw'd-o-Matic's plug/00-latency.js); this is the run around them: the steps as they happen, the verdict
// with a confidence, the words, keep and again. No DOM: ui/gauges/timing.js draws it, and any screen can drive it.
//
//   createCalibration({ latency, label, autoKeep }) -> cal       latency: app.input.audio.latency (createLatency's)
//     cal.state     { phase: 'idle' | 'listening' | 'done' | 'stopped' | 'error', step (the click sounding now, -1),
//                     hits: [ms | null | undefined] x 8 (undefined: not reached yet), warm (2), result (judgeTaps' plus
//                     how) | null, kept (this result was kept), measured (latency.measured), estimate (s: the browser's
//                     guess), error }
//     cal.start()   eight clicks at 100 BPM, the first two the count (resolves with the result, or null when stopped)
//     cal.stop()    stop listening (the clicks already scheduled play out: they're 40 ms each)
//     cal.keep()    keep this result for the interface (latency.set: ms, spread, confidence); a good one (`autoKeep`,
//                   the default) is kept by itself
//     cal.again()   = start()
//     cal.forget()  the measurement off this interface (back to the browser's guess)
//     cal.line()    what the engineer says now (calibrationLine)
//     cal.on(fn) -> off   fn(state) on every change
//   calibrationLine(state, { label }) -> string        the words, alone (pure: test/unit/calibrate.test.js)
//   fmtMs(ms) -> '14.2' under 100 ms, '140' over
//
// A good one is strums within 8 ms of each other; fair within 20; poor within 40 (kept only if you say so); looser, or
// fewer than four of the six heard, isn't a measurement. The round trip is per input device (localStorage
// overdub:latency, keyed by deviceId), so it's done once per interface.

import { judgeTaps } from './latency.js';

export const fmtMs = (/** @type {number} */ ms) => (!Number.isFinite(ms) ? '–' : Math.abs(ms) >= 100 ? String(Math.round(ms)) : (Math.round(ms * 10) / 10).toFixed(1));
const N = 8, WARM = 2;
const dateOf = (/** @type {number} */ at) => { try { return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch { return ''; } };

/** @param {any} st @param {{ label?: string }} [o] */
export function calibrationLine(st, { label = '' } = {}) {
  const on = label ? ` for ${label}` : '';
  if (!st) return '';
  if (st.phase === 'error') return st.error || 'Couldn’t measure here.';
  if (st.phase === 'listening') {
    const i = st.step;
    if (i < WARM) return 'Mute the strings with your fretting hand. Two clicks to count you in, then strum on every click.';
    const done = (st.hits || []).slice(WARM).filter((h) => h !== undefined), last = done[done.length - 1];
    const k = Math.min(N - WARM, i - WARM + 1);
    return `Strum ${k} of ${N - WARM}.${last === undefined ? '' : last === null ? ' Didn’t hear the last one.' : ` The last was ${fmtMs(last)} ms after the click.`}`;
  }
  const r = st.result;
  if ((st.phase === 'done' || st.phase === 'stopped') && r) {
    const ms = Math.max(0, r.ms), ahead = r.ahead ? ' You played ahead of the click, so it keeps 0.' : '';
    if (r.grade === 'none') return Number.isFinite(r.spread) && r.used >= 4
      ? `The strums were ${fmtMs(r.spread)} ms apart: too loose to measure. Go again, and strum right on each click.`
      : `Heard ${r.used} of ${r.of} strums. Strum harder, or turn the guitar up, and go again.`;
    if (r.grade === 'good') return `Round trip ${fmtMs(ms)} ms. Your strums were within ${fmtMs(r.spread)} ms of each other: a good one.${st.kept ? ` Kept${on}.` : ''}${ahead}`;
    if (r.grade === 'fair') return `Round trip ${fmtMs(ms)} ms. The strums were ${fmtMs(r.spread)} ms apart: a little loose.${st.kept ? ` Kept${on}.` : ' Keep it, or go again.'}${ahead}`;
    return `Round trip ${fmtMs(ms)} ms, but the strums were ${fmtMs(r.spread)} ms apart.${st.kept ? ` Kept${on}.` : ' Go again: mute the strings and strum right on the click.'}${ahead}`;
  }
  if (st.phase === 'stopped') return 'Stopped. Nothing was kept.';
  const m = st.measured;
  if (m) return `Round trip ${fmtMs(m.ms)} ms, measured${m.at ? ` ${dateOf(m.at)}` : ''}${m.label ? ` on ${m.label}` : ''}.`;
  const est = Math.round((st.estimate || 0) * 1000);
  return `Not measured yet${est > 0 ? `: the browser guesses ${est} ms, often wrong on a real interface` : ''}. Eight clicks, about 30 seconds, once per interface.`;
}

/** @param {{ latency: any, label?: string | (() => string), autoKeep?: boolean }} o */
export function createCalibration({ latency, label = '', autoKeep = true }) {
  const fns = new Set();
  /** @type {any} */
  let sig = null;
  const nameOf = () => (typeof label === 'function' ? label() : label) || latency?.measured?.label || '';
  const state = {
    phase: 'idle', step: -1, hits: /** @type {(number | null | undefined)[]} */ (new Array(N).fill(undefined)), warm: WARM,
    result: /** @type {any} */ (null), kept: false, measured: latency?.measured || null, estimate: safe(() => latency.estimate(), 0), error: '',
  };
  function safe(/** @type {() => any} */ f, d) { try { return f(); } catch { return d; } }
  const fire = () => { state.measured = latency?.measured || null; state.estimate = safe(() => latency.estimate(), 0); for (const fn of [...fns]) { try { fn(state); } catch (e) { console.error('calibration listener', e); } } };
  const offLat = latency?.onChange ? latency.onChange(() => fire()) : null;
  const cal = {
    state,
    get label() { return nameOf(); },
    on(/** @type {(s: any) => void} */ fn) { fns.add(fn); return () => fns.delete(fn); },
    line() { return calibrationLine(state, { label: nameOf() }); },
    async start() {
      if (state.phase === 'listening') return null;
      if (!latency?.measure) { Object.assign(state, { phase: 'error', error: 'This browser can’t measure the round trip.' }); fire(); return null; }
      const me = (sig = { stop: false });
      Object.assign(state, { phase: 'listening', step: -1, hits: new Array(N).fill(undefined), result: null, kept: false, error: '' });
      fire();
      let res = null;
      try {
        res = await latency.measure({ how: 'tap', sig: me, onStep: (/** @type {any} */ s) => {
          if (sig !== me) return;
          if (s.click) state.step = s.i;
          else if ('ms' in s) state.hits[s.i] = s.ms == null ? null : s.ms;
          fire();
        } });
      } catch (e) {
        if (sig === me) { sig = null; Object.assign(state, { phase: 'error', step: -1, error: String(/** @type {any} */ (e)?.message || e) }); fire(); }
        return null;
      }
      if (sig !== me) return null;
      sig = null;
      state.step = -1;
      if (!res) { state.phase = 'stopped'; fire(); return null; }
      // (a measure that only gave hits, or an older shape: judged here the same way)
      const j = res.grade ? res : { ...res, ...judgeTaps(res.hits || [], { warm: WARM }) };
      if (Array.isArray(res.hits)) state.hits = res.hits.slice(0, N);
      state.result = { how: 'tap', ...j };
      state.phase = 'done';
      if (autoKeep && j.grade === 'good') cal.keep();
      else fire();
      return state.result;
    },
    stop() { if (sig) { sig.stop = true; sig = null; state.phase = 'stopped'; state.step = -1; fire(); } },
    keep() {
      const r = state.result;
      if (!r || r.grade === 'none' || state.kept) return false;
      const ok = latency.set(Math.max(0, r.ms), { how: 'tap', spread: r.spread, confidence: r.confidence, label: nameOf() || undefined });
      if (ok !== false) state.kept = true;
      fire();
      return state.kept;
    },
    again() { return cal.start(); },
    forget() { latency?.clear?.(); state.result = null; state.kept = false; state.phase = 'idle'; fire(); },
    dispose() { cal.stop(); fns.clear(); try { offLat?.(); } catch { /* ok */ } },
  };
  return cal;
}
