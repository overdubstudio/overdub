// The take's review [ui; the guitar room's TAKES stream] (docs/research/GUITAR-ROOM.md §2.6-§2.8; design/mock/
// guitar-room/ shots 05d, 05e, 06b; AJ: keep it or toss it after every take, the end handle easy to trim on the grid,
// hear what you just played). In R.sheet('review'), up while gr.overlay is 'review': the take on the bar grid, the
// parts along the top, the part's end and the ring past it hatched ("rings under the chorus"), your left take dim above
// it when this is the other side; the in and out handles (and, for a part the take just made, where the part ends);
// Keep (Enter), Toss (⌫), Again (R). It draws from the song and gr.take, and decides nothing: a handle's drag or
// arrows hand the stream a beat, a button an action.
//
//   createReview(R, on) -> { el, render(), frame(), handles() }
//     on = { keep(), toss(), again(), trim('in' | 'out', beat, { free }), partEnd(bars), stopHear() }
//     render(): again from the song (after any change); frame(): the playhead while it plays back
//   The handles are role=slider (the room's key table leaves a focused slider its arrows): ← → a beat, ⇧ a bar.
//   A drag snaps to the beat; ⇧ while dragging lets it go free. The part-end handle snaps to bars.

import { h } from '../../dom.js';
import { partLine, playingTake, takeGroups, takesIn } from './parts-plans.js';

const fmt = (x) => { const v = Math.round(x * 10) / 10; return Number.isInteger(v) ? String(v) : v.toFixed(1); };
const plural = (n, w) => `${fmt(n)} ${w}${Math.abs(n - 1) < 0.05 ? '' : 's'}`;
const kbd = (t) => h('kbd.grt-k', t);

export function createReview(R, on) {
  const el = R.sheet('review');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'The take');
  const title = h('h2');
  const meta = h('span.grt-meta');
  const hearing = h('span.grt-hearing');
  const cv = h('canvas', { 'aria-hidden': 'true' });
  const hIn = h('div.grt-h.grt-in', { role: 'slider', tabindex: 0, 'aria-label': 'The take’s in-point', dataset: { h: 'in' } }, h('span'));
  const hOut = h('div.grt-h.grt-out', { role: 'slider', tabindex: 0, 'aria-label': 'The take’s out-point: drag it back to cut the ring', dataset: { h: 'out' } }, h('span'));
  const hPe = h('div.grt-h.grt-pe', { role: 'slider', tabindex: 0, 'aria-label': 'Where the part ends', dataset: { h: 'pe' } }, h('span'));
  const tl = h('div.grt-tl', cv, hIn, hOut, hPe);
  const bKeep = h('button.grt-b.grt-go', { type: 'button', onclick: () => on.keep() }, 'Keep', kbd('Enter'));
  const bToss = h('button.grt-b', { type: 'button', onclick: () => on.toss() }, 'Toss', kbd('⌫'));
  const bAgain = h('button.grt-b', { type: 'button', onclick: () => on.again() }, 'Again', kbd('R'));
  const note = h('span.grt-note');
  const list = h('span.grt-list');
  el.replaceChildren(h('div.grt-rv-h', title, meta, hearing), tl, h('div.grt-rv-f', bKeep, bToss, bAgain, note, h('span.grt-gap'), list));

  let V = null;          // what's drawn: the take, the part, the range, the waveforms
  let dragging = null;   // { which, beat }
  const bufs = new Map();

  function bufOf(asset) {
    if (!asset) return null;
    if (bufs.has(asset)) return bufs.get(asset);
    const eng = R.app.engine;
    const b = eng?.assets?.peek?.(asset) || null;
    if (b) { bufs.set(asset, b); return b; }
    bufs.set(asset, null);
    Promise.resolve(eng?.assets?.get?.(asset)).then((x) => { if (x) { bufs.set(asset, x); draw(); } }, () => {});
    return null;
  }
  function clipOf(track, clip) {
    const t = R.store.get().tracks.find((x) => x.id === track);
    return t?.clips.find((c) => c.id === clip) || null;
  }

  function render() {
    const T = R.gr.take;
    if (!T) { V = null; return; }
    const p = R.store.get(), line = partLine(p);
    const part = line.parts.find((x) => x.id === T.section) || null;
    const c = clipOf(T.track, T.clip);
    if (!part || !c) { V = null; return; }
    const bpb = line.bpb;
    const i = line.parts.indexOf(part);
    const next = line.parts[i + 1] || null;
    const s0 = part.start, pe = part.start + part.length;
    const cin = c.start, cout = c.start + c.length;
    const recEnd = Math.max(cout, T.recEnd || cout);
    const left = T.side === 'R' ? (takesIn(p, { section: part.id, side: 'L' }).find((x) => !x.mute) || null) : null;
    const b0 = s0 - bpb, b1 = Math.max(pe + 2 * bpb, recEnd + bpb / 2);
    V = { T, p, line, part, i, next, c, s0, pe, cin, cout, recEnd, left, bpb, b0, b1, spb: 60 / (p.tempo || 120) };
    const n = T.take || 1;
    title.textContent = `${part.name}${T.side === 'R' ? ', the other side' : ''}: take ${n}`;
    const ring = Math.max(0, cout - pe), stopped = Math.floor((recEnd - s0) / bpb) + 1;
    meta.textContent = T.side === 'R' && T.pairWords ? T.pairWords
      : recEnd < pe - 1e-3 ? `You stopped in bar ${Math.max(1, stopped)} of ${fmt(part.bars)}; the rest of the part keeps what it had.`
      : `${plural(part.bars, 'bar')}${ring > 0.05 * bpb ? `, and ${plural(ring / bpb, 'bar')} rang past ${next ? `into ${next.name}` : 'the end'}` : ''}. It’s all on the take.`;
    note.textContent = T.isNew ? 'The out handle sits where you stopped; the amber one is where the part ends. Drag either.' : 'The out handle sits where you stopped. Drag it back to cut the ring.';
    const kept = takeGroups(p, { section: part.id, side: T.side }), on1 = playingTake(kept);
    list.replaceChildren(...(kept.length > 1 ? ['takes: ', ...kept.flatMap((x, k) => [h(k === on1 ? 'b' : 'span', `take ${k + 1}`), k < kept.length - 1 ? ' ' : ''])] : ['the first take of this part on this side']));
    tl.classList.toggle('grt-two', T.side === 'R');
    hPe.hidden = !T.isNew;
    draw();
  }

  function X(beat) { const w = tl.clientWidth || 1; return ((beat - V.b0) / (V.b1 - V.b0)) * w; }
  function beatAt(clientX) { const r = tl.getBoundingClientRect(); return V.b0 + Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * (V.b1 - V.b0); }

  function draw() {
    if (!V || el.hidden) return;
    const r = tl.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * d)), hh = Math.max(1, Math.round(r.height * d));
    if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
    const g = cv.getContext('2d');
    if (!g) return;
    const css = getComputedStyle(el);
    const C = (k, f) => css.getPropertyValue(k).trim() || f;
    const col = { text: C('--text', '#f4ead6'), t2: C('--text-2', '#cbc0aa'), t3: C('--text-3', '#9a8f7c'), line: C('--line', '#2f2b25'), line2: C('--line-2', '#46413a'), bg: C('--bg', '#141210'), bg3: C('--bg-3', '#24211c'), accent: C('--accent', '#d9f36a') };
    const mono = C('--font-mono', 'monospace'), ui = C('--font-ui', 'sans-serif');
    const Xd = (b) => X(b) * d;
    g.clearRect(0, 0, w, hh);
    const top = 30 * d;
    // the parts along the top, the one this take is for lit
    g.font = `600 ${12 * d}px ${ui}`; g.textBaseline = 'middle';
    for (const pp of V.line.parts) {
      const x0 = Xd(pp.start), x1 = Xd(pp.start + pp.length);
      if (x1 < 0 || x0 > w) continue;
      const mine = pp.id === V.part.id;
      g.fillStyle = mine ? col.text : col.bg3; g.fillRect(x0 + 1, 2 * d, Math.max(1, x1 - x0 - 2), 22 * d);
      g.fillStyle = mine ? col.bg : col.t2;
      g.save(); g.beginPath(); g.rect(x0, 0, x1 - x0, 26 * d); g.clip(); g.fillText(pp.name, Math.max(x0, 0) + 8 * d, 13 * d); g.restore();
    }
    // bars and beats, numbered from the part's 1
    g.font = `${11 * d}px ${mono}`; g.textBaseline = 'top';
    const bpb = V.bpb;
    for (let b = Math.ceil(V.b0); b <= V.b1; b += 1) {
      const x = Math.round(Xd(b)), whole = Math.abs(((b - V.s0) % bpb + bpb) % bpb) < 1e-6;
      g.fillStyle = whole ? col.line2 : col.line; g.fillRect(x, top, 1, hh - top);
      if (whole) { g.fillStyle = col.t3; g.fillText(String(Math.round((b - V.s0) / bpb) + 1), x + 3 * d, top + 3 * d); }
    }
    // the part's end, and past it the ring, hatched: it rings under the next part
    const pe = dragging?.which === 'pe' ? dragging.beat : V.pe;
    const out = dragging?.which === 'out' ? dragging.beat : V.cout;
    const inn = dragging?.which === 'in' ? dragging.beat : V.cin;
    const xe = Xd(pe), xo = Xd(out);
    g.fillStyle = col.text; g.fillRect(Math.round(xe), top, 2 * d, hh - top);
    if (xo > xe + 2) {
      g.save(); g.beginPath(); g.rect(xe, top, xo - xe, hh - top); g.clip();
      g.strokeStyle = col.line2; g.lineWidth = d;
      for (let x = xe - hh; x < xo + hh; x += 9 * d) { g.beginPath(); g.moveTo(x, hh); g.lineTo(x + (hh - top), top); g.stroke(); }
      g.restore();
      g.fillStyle = col.t2; g.font = `${12 * d}px ${ui}`; g.textBaseline = 'bottom';
      g.fillText(`rings ${V.next ? `under ${V.next.name}` : 'past the end'}`, xe + 16 * d, hh - 6 * d);
    }
    // the waveforms: your left take (dim) when this is the other side, then this take
    const lanes = V.T.side === 'R' && V.left ? [[V.left, top + 18 * d, (hh - top - 26 * d) / 2, 'L  your kept take'], [V.c, top + 18 * d + (hh - top - 26 * d) / 2, (hh - top - 26 * d) / 2, 'R  this take']] : [[V.c, top + 18 * d, hh - top - 26 * d, '']];
    for (const [c, y0, lh, label] of lanes) {
      const mine = c === V.c;
      const buf = bufOf(c.asset);
      const data = buf?.getChannelData ? buf.getChannelData(0) : null, sr = buf?.sampleRate || 48000;
      const mid = y0 + lh / 2, amp = lh / 2 - 3 * d;
      const a = mine ? Math.min(inn, V.cin) : c.start, b = mine ? Math.max(V.recEnd, out) : c.start + c.length;
      const step = 3 * d;
      if (data) {
        for (let x = Math.max(0, Math.floor(Xd(a))); x < Math.min(w, Xd(b)); x += step) {
          const bb = V.b0 + (x / w) * (V.b1 - V.b0), bb2 = V.b0 + ((x + step) / w) * (V.b1 - V.b0);
          const s1 = Math.floor(((c.offset || 0) + (bb - c.start) * V.spb) * sr), s2 = Math.floor(((c.offset || 0) + (bb2 - c.start) * V.spb) * sr);
          let pk = 0;
          for (let i = Math.max(0, s1); i < Math.min(data.length, s2); i += 2) { const v = Math.abs(data[i]); if (v > pk) pk = v; }
          const inside = !mine || (bb >= inn - 1e-6 && bb <= out + 1e-6);
          g.fillStyle = !mine ? col.t3 : inside ? col.text : col.line2;
          const v = Math.max(1, Math.sqrt(pk) * amp);
          g.fillRect(x, Math.round(mid - v), 2 * d, Math.round(v * 2));
        }
      } else {
        g.fillStyle = col.line2; g.fillRect(Xd(a), Math.round(mid), Math.max(1, Xd(b) - Xd(a)), 1);
      }
      if (label) { g.fillStyle = col.t3; g.font = `${11 * d}px ${mono}`; g.textBaseline = 'top'; g.fillText(label, 6 * d, y0); }
    }
    // playing it back: the playhead
    const e = R.app.engine;
    if (V.T.hear && e?.playing && Number.isFinite(e.beat)) { g.fillStyle = col.accent; g.fillRect(Math.round(Xd(e.beat)), top - 4 * d, 2 * d, hh - top + 4 * d); }
    // the handles
    const place = (hEl, beat, text, value) => {
      hEl.style.left = `${X(beat)}px`;
      hEl.querySelector('span').textContent = text;
      hEl.setAttribute('aria-valuetext', value);
    };
    const barOf = (b) => fmt((b - V.s0) / bpb + 1);
    place(hIn, inn, `in bar ${barOf(inn)}`, `bar ${barOf(inn)}`);
    // (the in and out labels face each other: on a narrow grid, a short take, the in's steps down a line)
    hIn.classList.toggle('grt-low', X(out) - X(inn) < 200);
    const past = (out - pe) / bpb;
    place(hOut, out, past > 0.02 ? `out +${fmt(past)} past` : past < -0.02 ? `out bar ${barOf(out)}` : 'out at the end', past > 0.02 ? `${fmt(past)} bars past the part’s end` : `bar ${barOf(out)}`);
    if (V.T.isNew) place(hPe, pe, `the part: ${plural((pe - V.s0) / bpb, 'bar')}`, `${fmt((pe - V.s0) / bpb)} bars`);
    hearing.textContent = V.T.hear ? 'playing it back once · any key stops it' : 'Space hears it again';
  }

  /* ------------------------------------------------------------------------------------------- the handles */
  const snapOf = (which, beat, free) => {
    if (which === 'pe') return V.s0 + Math.max(1, Math.round((beat - V.s0) / V.bpb)) * V.bpb;
    return free ? Math.round(beat * 64) / 64 : Math.round(beat);
  };
  const bound = (which, b) => {
    if (which === 'in') return Math.max(V.cin - V.bpb, Math.min(b, V.cout - 1));
    if (which === 'out') return Math.max(V.cin + 1, Math.min(b, V.recEnd));
    return Math.max(V.s0 + V.bpb, Math.min(b, V.s0 + Math.max(V.bpb, Math.ceil((V.recEnd - V.s0) / V.bpb) * V.bpb)));
  };
  function commit(which, beat, free) {
    if (which === 'pe') on.partEnd(Math.round((beat - V.s0) / V.bpb));
    else on.trim(which, beat, { free });
  }
  for (const hEl of [hIn, hOut, hPe]) {
    const which = hEl.dataset.h;
    hEl.addEventListener('pointerdown', (e) => {
      if (!V || e.button !== 0) return;
      e.preventDefault();
      on.stopHear();
      hEl.setPointerCapture?.(e.pointerId);
      hEl.focus({ preventScroll: true });
      dragging = { which, beat: which === 'in' ? V.cin : which === 'out' ? V.cout : V.pe, free: false };
      const move = (ev) => { if (!dragging) return; dragging.free = ev.shiftKey; dragging.beat = bound(which, snapOf(which, beatAt(ev.clientX), ev.shiftKey)); draw(); };
      const up = () => {
        hEl.removeEventListener('pointermove', move); hEl.removeEventListener('pointerup', up); hEl.removeEventListener('pointercancel', up);
        const d = dragging; dragging = null;
        if (d && V) {
          const was = which === 'in' ? V.cin : which === 'out' ? V.cout : V.pe;
          if (Math.abs(d.beat - was) > 1e-4) commit(which, d.beat, d.free); else draw();
        }
      };
      hEl.addEventListener('pointermove', move); hEl.addEventListener('pointerup', up); hEl.addEventListener('pointercancel', up);
    });
    hEl.addEventListener('keydown', (e) => {
      if (!V || e.metaKey || e.ctrlKey || e.altKey) return;
      // (Enter on a focused handle: the shell leaves a focused slider its Enter, so the room's Enter row never runs on
      // one, and a handle has nothing to activate: it's Keep, as everywhere in the review. After a drag the handle has
      // focus. A key the studio declares and the live room holds may have marked it on the way, doing nothing)
      if (e.key === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) on.keep(); return; }
      const step = which === 'pe' ? V.bpb : e.shiftKey ? V.bpb : 1;
      const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'PageDown' ? -V.bpb / step : e.key === 'PageUp' ? V.bpb / step : 0;
      if (!dir) return;
      e.preventDefault(); e.stopPropagation();
      on.stopHear();
      const was = which === 'in' ? V.cin : which === 'out' ? V.cout : V.pe;
      const b = bound(which, which === 'pe' ? snapOf('pe', was + dir * step, false) : Math.round(was) === was || e.shiftKey ? was + dir * step : dir > 0 ? Math.ceil(was) : Math.floor(was));
      if (Math.abs(b - was) > 1e-4) commit(which, b, true);
    });
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw()) : null;
  ro?.observe(tl);

  return {
    el, render, frame() { if (V && V.T.hear) draw(); }, draw,
    dragging: () => !!dragging,
    dispose() { ro?.disconnect(); },
  };
}
