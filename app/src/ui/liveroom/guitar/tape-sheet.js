// The last minute [ui; the guitar room's TAPE stream] (docs/research/GUITAR-ROOM.md §2.3 "that was the one";
// design/mock/guitar-room-2/ shot 03g-the-tape, design/mock/guitar-room/ 03a-03c). The tape machine's sheet: what's on
// app.input.tape drawn on the drummer's bar grid (tape.peaks, tape.lines), a default selection (tape.select: the last
// thing you played, snapped to its bars; a starting place, never a decision), two handles to trim it (snapped to bar
// lines while gr.tape.snap is on: tape.snap), Enter keeps it as a riff (tape.grab into ui/liveroom/riffs-db.js, never
// the song: the riff goes in the song only when it's put on the part line), and hearing it round and round through the
// rig (./tape-hear.js). The camera sits on the tape machine above it (the 'tape' target leaves room for it).
//
//   createTapeSheet(R, { hear, onKept }) -> sheet
//     sheet.open() -> Promise<{ ok, error? }>     the sheet up (R.overlay('tape')), the default selection found
//     sheet.close({ camera = true })             down; the camera back off the machine
//     sheet.isOpen() -> bool
//     sheet.keep() -> Promise<{ ok, riff?, error? }>   the selection (or, with the sheet down, the default one) into the
//                                                tray: riffs-db add, then onKept(row)
//     sheet.snap(on?) -> bool                    the handles snap to bar lines (R.gprefs snap; R.gr.tape.snap)
//     sheet.hear() -> Promise<bool>              the selection round and round (again: stop)
//     sheet.setSel({ from, to })                 move the handles (frames; snapped when snap is on)
//     sheet.frame(now), sheet.dispose()
// State: R.gr.tape = { open, sel: Selection-like { from, to (frames), ... } | null, snap }.

import { h, tok, clamp } from '../../dom.js';
import { fromPcm16 } from '../../../input/tape-core.js';
import * as riffs from '../riffs-db.js';
import { rigOf } from '../../../core/liveroom/guitar/rig.js';
import { roomOf } from '../../../core/liveroom/model.js';
import { TUNINGS } from '../../../core/fretboard.js';
import { beatsPerBar } from '../../../core/music.js';
import { TAPE_LINES as T_, barsOf, bars as nBars, secs } from './tape-lines.js';

const kbd = (k) => h('kbd', k);
export const tuningName = (p) => TUNINGS[roomOf(p)?.tuning]?.name || 'Standard';

export function createTapeSheet(R, { hear, onKept = null } = {}) {
  const app = R.app, store = R.store;
  const tape = () => app.input?.tape || null;
  const T = R.gr.tape;
  T.snap = R.gprefs.get().snap !== false;
  let view = null;          // { from, to } frames: the window drawn (fixed while open)
  let keeping = false, finding = false, drawerWas = false, cols = { w: 0, h: 0 };
  let colors = null;

  /* ---------------------------------------------------------------- the sheet */
  const el = R.sheet('tape');
  el.classList.add('gr-tp');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'The last minute of tape');
  const meta = h('span.gr-tp-meta');
  const span = h('span.gr-tp-span');
  const cv = h('canvas.gr-tp-cv', { 'aria-hidden': 'true' });
  const handle = (end) => h(`div.gr-tp-h${end ? '.gr-tp-out' : ''}`, { role: 'slider', tabindex: 0, 'aria-label': end ? 'The end of the riff' : 'The start of the riff', dataset: { end: end ? '1' : '0' } }, h('span'));
  const hA = handle(false), hB = handle(true);
  const empty = h('p.gr-tp-empty', { hidden: true });
  const wrap = h('div.gr-tp-wrap', cv, hA, hB, empty);
  const keepBtn = h('button.btn.btn-go.gr-tp-keep', { type: 'button', onclick: () => R.press('riff:keep') }, h('span', 'Keep it as a riff'), kbd('Enter'));
  const hearBtn = h('button.btn.gr-tp-hear', { type: 'button', onclick: () => hearSel() }, h('span', 'Hear it, round and round'));
  const snapBtn = h('button.btn.gr-tp-snap', { type: 'button', 'aria-pressed': 'true', onclick: () => R.press('snap') }, h('i.gr-tp-lamp'), h('span', 'Snap to bars'), kbd('B'));
  const note = h('span.gr-tp-note', 'Drag the ends to trim. A focused end moves with ← →.');
  const closeBtn = h('button.btn', { type: 'button', onclick: () => R.press('back') }, 'Close', kbd('Esc'));
  el.replaceChildren(
    h('div.gr-tp-head', h('h2.gr-tp-h2', 'The last minute'), meta, h('span.gr-gap'), span),
    wrap,
    h('div.gr-tp-foot', keepBtn, hearBtn, snapBtn, note, h('span.gr-gap'), closeBtn));

  /* ---------------------------------------------------------------- reading the tape */
  const sr = () => tape()?.state?.sr || 48000;
  const head = () => tape()?.state?.head || 0;
  const X = (f, w) => ((f - view.from) / Math.max(1, view.to - view.from)) * w;
  const F = (x, w) => view.from + (x / Math.max(1, w)) * (view.to - view.from);
  // the grid at a frame, and the bar a frame starts (or ends) in
  const gridAt = (f) => { try { return tape()?.beatAt(f) || null; } catch { return null; } };
  function barOf(f, end = false) {
    const g = gridAt(end ? f - 1 : f);
    if (!g) return null;
    const s = end ? gridAt(f)?.s ?? g.s : g.s;
    // (a handle on a bar line reads as that bar: a frame's rounding either side of the line is the line)
    const tol = (2 / Math.max(1, g.spb * sr())) / g.bpb;
    return end ? Math.max(1, Math.round(s / g.bpb)) : Math.floor(s / g.bpb + tol) + 1;
  }
  // the selection in words: 'bars 30–33 · 4 bars · 7.3 s' (or the seconds, in free time)
  function selWords(sel) {
    if (!sel) return null;
    const s = (sel.to - sel.from) / sr();
    const a = gridAt(sel.from), b = gridAt(sel.to - 1);
    if (a && b && a.gen === b.gen) {
      const sb = gridAt(sel.to)?.s ?? b.s + (1 / Math.max(1e-9, b.spb)) / sr();
      const nb = Math.round(((sb - a.s) / a.bpb) * 4) / 4;
      const first = barOf(sel.from), last = Math.max(first, first + Math.ceil(nb - 1e-6) - 1);
      return { grid: true, a: first, b: last, n: nb, s, text: `${barsOf(first, last)} · ${nBars(nb)} · ${secs(s)}`, tempo: Math.round(60 / a.spb) };
    }
    return { grid: false, s, text: secs(s) };
  }
  const snapF = (f) => (T.snap ? tape()?.snap(f, 0) ?? f : f);

  /* ---------------------------------------------------------------- open, close */
  async function open() {
    if (R.busy()) return { ok: false, error: 'The tape’s here once the take is in.' };
    const tp = tape();
    drawerWas = !!R.gr.drawer;
    if (drawerWas) R.drawer(false);
    T.open = true;
    T.snap = R.gprefs.get().snap !== false;
    R.overlay('tape');
    if (R.gr.cam !== 'tape' && R.gr.world === 'stage') R.camera.zoomTo('tape');
    T.sel = null;
    hear?.stop();
    const sp = tp?.span?.() || { from: 0, to: 0 };
    view = sp.to > sp.from ? { from: sp.from, to: sp.to } : null;
    render();
    if (!tp || !tp.state?.open || !view) { R.say(T_.openNone()); return { ok: true }; }
    finding = true;
    render();
    let sel = null;
    try { sel = await tp.select({ within: tp.seconds || 60 }); } catch (e) { console.error('tape: select', e); }
    finding = false;
    if (!T.open) return { ok: true };
    if (sel) {
      T.sel = { ...sel };
      if (sel.to > view.to) view = { from: view.from, to: sel.to + Math.round(0.25 * sr()) };
      const w = selWords(T.sel);
      R.say(w?.grid ? T_.open({ a: w.a, b: w.b }) : T_.openFree({ s: Math.round((w?.s || 0) * 10) / 10 }));
      setTimeout(() => { if (T.open && !wrap.contains(document.activeElement)) hB.focus({ preventScroll: true }); }, 0);
    } else R.say(T_.openQuiet());
    render();
    return { ok: true };
  }
  function close({ camera = true } = {}) {
    if (!T.open) return false;
    T.open = false;
    if (hear?.key === 'tape') hear.stop();
    if (R.gr.overlay === 'tape') R.overlay(null);
    if (camera && R.gr.cam === 'tape') { if (!R.camera.back()) R.camera.home(); }
    if (drawerWas) { drawerWas = false; R.drawer(true); }
    return true;
  }

  /* ---------------------------------------------------------------- the handles */
  function setSel({ from, to }) {
    const tp = tape();
    if (!tp || !view) return;
    const min = Math.max(1, Math.round(0.05 * sr()));
    let a = Math.round(from), b = Math.round(to);
    a = clamp(a, view.from, view.to - min); b = clamp(b, a + min, view.to);
    T.sel = { ...(T.sel || {}), from: a, to: b };
    render();
  }
  function moveEnd(end, f) {
    if (!T.sel) return;
    const g = snapF(f);
    if (end) setSel({ from: T.sel.from, to: Math.max(g, T.sel.from + 1) });
    else setSel({ from: Math.min(g, T.sel.to - 1), to: T.sel.to });
  }
  // a focused end, a line along: the next bar line (snap on) or beat (off), or a tenth of a second where there's no grid
  function step(end, dir) {
    const tp = tape();
    if (!tp || !T.sel) return;
    const f = end ? T.sel.to : T.sel.from;
    const w = Math.round(20 * sr());
    const ls = tp.lines(f - w, f + w, T.snap ? 0 : 1).map((x) => x.f).filter((x) => (dir > 0 ? x > f + 1 : x < f - 1));
    const next = ls.length ? (dir > 0 ? Math.min(...ls) : Math.max(...ls)) : f + dir * Math.round(0.1 * sr());
    if (end) setSel({ from: T.sel.from, to: next }); else setSel({ from: next, to: T.sel.to });
  }
  for (const hd of [hA, hB]) {
    const end = hd === hB;
    hd.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); step(end, e.key === 'ArrowRight' ? 1 : -1); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); (end ? hA : hB).focus({ preventScroll: true }); }
      // (the shell leaves Enter to a focused slider: here it keeps the riff, as it does anywhere on the sheet)
      else if ((e.key === 'Enter') && !e.altKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); R.press('riff:keep'); }
    });
  }
  // a drag anywhere on the tape moves the nearer end (from the end itself, that end)
  let dragEnd = null;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !T.sel || !view) return;
    const r = cv.getBoundingClientRect(), f = F(e.clientX - r.left, r.width);
    const onH = e.target.closest?.('.gr-tp-h');
    dragEnd = onH ? onH === hB : Math.abs(f - T.sel.to) < Math.abs(f - T.sel.from);
    (dragEnd ? hB : hA).focus({ preventScroll: true });
    wrap.setPointerCapture(e.pointerId);
    moveEnd(dragEnd, f);
    e.preventDefault();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (dragEnd == null) return;
    const r = cv.getBoundingClientRect();
    moveEnd(dragEnd, F(clamp(e.clientX - r.left, 0, r.width), r.width));
  });
  const endDrag = (e) => { if (dragEnd == null) return; dragEnd = null; try { wrap.releasePointerCapture(e.pointerId); } catch { /* gone */ } if (hear?.key === 'tape') hearSel(true); };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);

  /* ---------------------------------------------------------------- snap, hear, keep */
  function snap(on) {
    T.snap = on === undefined ? !T.snap : !!on;
    R.gprefs.set({ snap: T.snap });
    if (T.snap && T.sel) setSel({ from: snapF(T.sel.from), to: snapF(T.sel.to) });
    render();
    return T.snap;
  }
  async function hearSel(again = false) {
    if (!again && hear?.key === 'tape') { hear.stop(); render(); return false; }
    const tp = tape(), sel = T.sel;
    if (!tp || !sel) return false;
    const to = Math.min(sel.to, head());
    const r = await tp.read(sel.from, to);
    if (!r || !r.d.length) return false;
    const ok = await hear.play('tape', { sr: sr(), data: fromPcm16(r.d) });
    if (ok && !again) { const w = selWords(sel); R.say(T_.hearSel({ what: w?.grid ? w.text.split(' · ')[0].replace(/^b/, 'B') : `The last ${secs(w?.s || 0)}` })); }
    render();
    return ok;
  }
  async function keep() {
    const tp = tape();
    if (keeping) return { ok: false, error: 'It’s going in the tray already.' };
    if (!tp || !tp.state?.open) return { ok: false, error: T_.openNone() };
    let sel = T.open ? T.sel : null;
    if (!sel) { try { sel = await tp.select({ within: tp.seconds || 60 }); } catch { sel = null; } }
    if (!sel) return { ok: false, error: T_.openQuiet() };
    keeping = true;
    render();
    try {
      const w = selWords(sel);
      if (sel.to > head() && w?.grid) R.say(T_.waiting({ bar: w.b }));
      const g = await tp.grab(sel, { put: false });
      if (!g.ok) return { ok: false, error: g.error };
      const p = store.get();
      const rig = rigOf(p), room = roomOf(p);
      const stack = rig ? { name: room?.stack?.name || '', chain: rig.chain, id: room?.stack?.id } : null;
      const meter = Array.isArray(p.meter) ? p.meter : [4, 4];
      const add = await riffs.add({
        audio: { sr: g.asset.sr, channels: [g.data] },
        tempo: g.place?.bpm || p.tempo,
        ...(g.place ? { beats: g.place.beats } : {}),
        meter, offset: g.lead, tuning: room?.tuning || 'standard', stack, song: p,
      });
      if (!add.ok) return { ok: false, error: add.error };
      const row = add.row;
      if (T.open) close();
      const tn = tuningName(p);
      R.say(g.place ? T_.kept({ name: row.name, n: Math.round((row.beats / beatsPerBar(meter)) * 4) / 4, tempo: Math.round(row.tempo), tuning: tn }) : T_.keptFree({ name: row.name, s: row.duration - row.offset, tuning: tn }));
      if (add.note) setTimeout(() => R.say(add.note), 2600);
      onKept?.(row);
      R.emit('tape:grab', { riff: row });
      return { ok: true, riff: row };
    } catch (e) {
      console.error('tape: keep', e);
      return { ok: false, error: String(e?.message || e) };
    } finally { keeping = false; render(); }
  }

  /* ---------------------------------------------------------------- drawing */
  function render() {
    el.dataset.snap = T.snap ? '1' : '';
    snapBtn.setAttribute('aria-pressed', String(!!T.snap));
    snapBtn.querySelector('span').textContent = T.snap ? 'Snap to bars: on' : 'Snap to bars: off';
    const w = selWords(T.sel);
    meta.textContent = finding ? 'Finding the last thing you played…' : w ? w.text : '';
    keepBtn.disabled = !T.sel || keeping;
    keepBtn.querySelector('span').textContent = keeping ? 'Keeping it…' : w?.grid ? `Keep ${w.text.split(' · ')[0]} as a riff` : 'Keep it as a riff';
    hearBtn.disabled = !T.sel;
    hearBtn.querySelector('span').textContent = hear?.key === 'tape' ? 'Stop hearing it' : 'Hear it, round and round';
    hearBtn.setAttribute('aria-pressed', String(hear?.key === 'tape'));
    const tp = tape();
    if (!view) { span.textContent = ''; empty.hidden = false; empty.textContent = T_.openNone(); }
    else {
      const ls = tp?.lines(view.from, view.to, 0) || [];
      const real = ls.filter((x) => x.bar >= 1);
      span.textContent = real.length >= 2 ? `the last ${Math.round((view.to - view.from) / sr())} s, on the drummer’s bars, ${real[0].bar} to ${real[real.length - 1].bar}` : `the last ${Math.round((view.to - view.from) / sr())} s, no drummer under it`;
      empty.hidden = !!T.sel || finding;
      empty.textContent = !T.sel && !finding ? T_.openQuiet() : '';
    }
    hA.hidden = hB.hidden = !T.sel;
    draw();
  }
  function draw() {
    if (!T.open || !view) return;
    const r = cv.getBoundingClientRect();
    if (!(r.width > 0)) return;
    const d = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(r.width), H = Math.round(r.height);
    if (cols.w !== W || cols.h !== H || cv.width !== W * d) { cv.width = W * d; cv.height = H * d; cols = { w: W, h: H }; }
    if (!colors) colors = { bg: '#0b090d', text: tok('--text') || '#f4ead6', t2: tok('--text-2') || '#cbc0aa', t3: tok('--text-3') || '#9a8f7c', ink3: tok('--ink-3') || '#6e6352', line: tok('--line') || '#2f2b25', line2: tok('--line-2') || '#46413a', accent: tok('--accent') || '#d9f36a', pencil: tok('--accent-2') || '#f1dc8a' };
    const C = colors, g = cv.getContext('2d'), tp = tape();
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    const top = 22, mid = top + (H - top) / 2, amp = (H - top) / 2 - 6;
    // what hasn't been played yet (a bar not over): hatched
    const hd = head();
    if (hd < view.to) { const x = X(hd, W); g.fillStyle = '#ffffff08'; for (let i = Math.floor(x); i < W; i += 6) g.fillRect(i, top, 2, H - top); }
    // the selection: grease pencil
    if (T.sel) { const a = X(T.sel.from, W), b = X(T.sel.to, W); g.fillStyle = C.pencil; g.globalAlpha = 0.12; g.fillRect(a, top, b - a, H - top); g.globalAlpha = 1; }
    // the beats and the bars, numbered
    if (tp) {
      const pxPerS = W / ((view.to - view.from) / sr());
      const beats = pxPerS > 24 ? tp.lines(view.from, view.to, 1) : [];
      g.fillStyle = C.line;
      for (const x of beats) if (x.beat) g.fillRect(Math.round(X(x.f, W)), top, 1, H - top);
      const bl = tp.lines(view.from, view.to, 0);
      const every = Math.max(1, Math.ceil(30 / Math.max(1, W / Math.max(1, bl.length))));
      g.font = '11px ' + (tok('--font-mono') || 'monospace'); g.textBaseline = 'top';
      for (const x of bl) {
        const px = Math.round(X(x.f, W));
        g.fillStyle = C.line2; g.fillRect(px, top - 6, 1, H - top + 6);
        if (x.bar >= 1 && (x.bar - 1) % every === 0 && px < W - 40) { g.fillStyle = C.t3; g.fillText(String(x.bar), px + 4, 5); }
      }
      // the waveform: the loudest in each column, the selection in cream
      const n = Math.max(8, Math.floor(W / 3)), pk = tp.peaks(view.from, Math.min(view.to, hd), Math.max(1, Math.round(n * Math.min(1, (Math.min(view.to, hd) - view.from) / (view.to - view.from)))));
      const wCol = (Math.min(view.to, hd) - view.from) / Math.max(1, pk.length);
      // (drawn to the loudest on the sheet, up to four times: a quiet guitar still reads)
      let loud = 0;
      for (let i = 0; i < pk.length; i++) if (pk[i] > loud) loud = pk[i];
      const k = loud > 0 ? Math.min(4, 0.92 / loud) : 1;
      for (let i = 0; i < pk.length; i++) {
        const f = view.from + (i + 0.5) * wCol, x = X(view.from + i * wCol, W);
        const inSel = T.sel && f >= T.sel.from && f <= T.sel.to;
        const v = Math.max(1, Math.min(1, pk[i] * k) * amp);
        g.fillStyle = inSel ? C.text : C.ink3;
        g.fillRect(Math.round(x), Math.round(mid - v), 2, Math.max(1, Math.round(v * 2)));
      }
      // now
      const xn = Math.min(W - 2, X(hd, W));
      g.fillStyle = C.t2; g.fillRect(Math.round(xn), top, 2, H - top);
      g.fillStyle = C.t3; g.textAlign = 'right'; g.fillText('now', Math.round(xn) - 4, 5); g.textAlign = 'left';
      // hearing it: the playhead (leader green: the playhead's)
      const pos = hear?.key === 'tape' ? hear.pos() : null;
      if (pos != null && T.sel) { const x = X(T.sel.from + pos * (Math.min(T.sel.to, hd) - T.sel.from), W); g.fillStyle = C.accent; g.fillRect(Math.round(x), top - 4, 2, H - top + 4); }
    }
    // the handles, where the selection's ends are
    if (T.sel) {
      const a = X(T.sel.from, W), b = X(T.sel.to, W);
      hA.style.left = `${a}px`; hB.style.left = `${b}px`;
      const ba = barOf(T.sel.from), bb = barOf(T.sel.to, true);
      hA.firstChild.textContent = ba != null ? `in ${ba}` : 'in';
      hB.firstChild.textContent = bb != null ? `out ${bb}` : 'out';
      hA.setAttribute('aria-valuetext', ba != null ? `bar ${ba}` : secs((T.sel.from - view.from) / sr()));
      hB.setAttribute('aria-valuetext', bb != null ? `the end of bar ${bb}` : secs((T.sel.to - view.from) / sr()));
      for (const [hd2, f] of [[hA, T.sel.from], [hB, T.sel.to]]) { hd2.setAttribute('aria-valuemin', '0'); hd2.setAttribute('aria-valuemax', String(Math.round((view.to - view.from) / sr() * 10) / 10)); hd2.setAttribute('aria-valuenow', String(Math.round((f - view.from) / sr() * 100) / 100)); }
    }
  }
  let lastDraw = 0;
  function frame(now) {
    if (!T.open) return;
    // (the tape keeps rolling in: a selection whose bar isn't over yet fills as it comes; otherwise a few times a second)
    if (now - lastDraw < (head() < (view?.to || 0) || hear?.key === 'tape' || dragEnd != null ? 16 : 120)) return;
    lastDraw = now;
    draw();
  }
  return {
    el, open, close, keep, snap, setSel, frame,
    hear: () => hearSel(),
    isOpen: () => !!T.open,
    view: () => (view ? { ...view } : null),
    dispose() { T.open = false; },
  };
}
