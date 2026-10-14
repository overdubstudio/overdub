// Start a song's coach strip (the source spec §3.8): once the first idea is in, the stage folds away and the strip docks
// at the foot of the arranger, over the bottom pane, across the centre column (ui.dock, ui/shell.js). One ruled line:
// "Start a song", the run sheet (Beat ✓ · Tune · Band: each word a button), one line of copy, the one primary
// (.btn-go), up to two words beside it and ×. No box, no fill, no stripe and no pill: rules above and below.
//
// The run sheet depends on the door (RUNS):
//   Tap a beat, Draw a beat, Pick a groove   Beat ✓ · Tune · Band    Hum over it (Tap more on the drums, Play keys over it)
//   Hum a tune, over a beat                  Beat ✓ · Tune ✓ · Band  Build a band around it
//   Hum freely, Play the keys                Tune ✓ · Beat · Band    Put a beat under it (Tap a beat over it)
//   Ask {Agent}                              {Agent} ✓ · Band        Build a band around it
// Hum over it, Play keys over it, Tap more on the drums and Tap a beat over it reopen the stage over the song
// (app.start.open({ kind, over })). Put a beat under it opens Grooves at the song's tempo (app.grooves.fit); its Use it
// moves the run on ('grooves:placed'). Build a band around it opens the style rows in the strip (core/arrange.js
// STYLES, each with its blurb): ↓/↑ hear one on the loop (agent/arrange-tool.js buildBand({ preview: true }): a
// store.preview, nothing in History), Keep the band is one dispatch signed 'overdub' (measured, as the house band is),
// Not this one goes back to the rows; with an agent connected a sixth row asks it to build one (arrange_around). Then
// the song, counted: "Your song: {n} tracks, {b} bars at {bpm} BPM. Take one was yours.", Make it longer and Share; then
// "Done. Find (⌘K) gets you anywhere." for 6 s, and the strip goes. × ends the run at any step and changes nothing.
//
// It docks when app.start closes to the song after a landing (Back to the song, Esc on 'in', a next part), or, for
// the doors that don't use the stage (Draw a beat, Pick a groove, Play the keys, Ask), when the first part lands after
// app.coach.expect(door). The stage asks app.coach.after(landing) what its primary on 'in' should be: the run's next
// part. The strip points at the controls it names (ui.point: the Drums header's instrument, Grooves' Use it).
//
// ui.state.coach = { run: 'start', step, done: [] } while a run is open, else null. Never persisted: a reload ends the
// run (the song is saved as always).
//
// app.coach = { expect(door), after(landing) -> { label, run(landed) } | null, dock(door, clips?), go(step), band(),
//   preview(i), keep() -> Promise, notThis(), end(), state() -> { run, door, step, done, words, rows, sel, line } | null }
// On a phone (640 px and under) it is the onboard phone strip's look (.ob-mini-row: the line, the primary, ×), the run
// sheet's words wrapping, and the style rows open as a bottom sheet up to 70% of the height.

import { h, css } from './dom.js';
import { STYLES, STYLE_IDS } from '../core/arrange.js';
import { songEnd } from '../core/project.js';
import { isDrumTrack } from '../input/recorder.js';

const RUNS = {
  beat: { words: ['beat', 'tune', 'band'], done: ['beat'] },
  hum: { words: ['beat', 'tune', 'band'], done: ['beat', 'tune'] },
  tune: { words: ['tune', 'beat', 'band'], done: ['tune'] },
  ask: { words: ['agent', 'band'], done: ['agent'] },
};
const DOOR = { tap: 'beat', draw: 'beat', groove: 'beat', hum: 'hum', free: 'tune', keys: 'tune', ask: 'ask' };
const plural = (n, w, ws = w + 's') => `${n} ${n === 1 ? w : ws}`;
const BYE_MS = 6000;

export default function (app) {
  const { store, ui } = app;
  css('coach-strip', CSS);
  const PHONE = window.matchMedia('(max-width: 640px)');
  ui.state.coach = null;
  // the run beyond ui.state.coach: the door, the words, the parts it's about, the rows
  let R = null, el = null, expecting = null, byeTimer = 0;
  const agentName = () => app.agent?.name || (app.agent?.provider === 'mock' ? 'the demo agent' : app.agent?.provider ? 'Claude' : null);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const bpbOf = () => { const m = store.get().meter || [4, 4]; return (m[0] * 4) / m[1]; };
  const live = (c) => (c?.clip && store.findClip(c.clip) ? c : null);

  /* ---------------------------------------------------------------- the run */
  function fresh(door) {
    const run = RUNS[DOOR[door]] || RUNS.beat;
    return { door, words: run.words.slice(), done: run.done.slice(), step: null, clips: { beat: null, tune: null }, rows: false, sel: -1, pv: null, pvSeq: 0, busy: false, line: null, waiting: null };
  }
  const nextStep = (r) => r.words.find((w) => !r.done.includes(w) && w !== 'agent') || 'end';
  const doorOf = (info) => (info.kind === 'tap' ? 'tap' : info.kind === 'keys' ? 'keys' : info.free ? 'free' : 'hum');
  // a take that went in on the stage, on a run (or the run it starts): which word it was, and the parts it's about
  function applyLanding(r, info) {
    const l = info.landed;
    if (!r) {
      r = fresh(doorOf(info));
      if (info.kind === 'tap') r.clips.beat = l;
      else { r.clips.tune = l; if (info.under) r.clips.beat = info.under; }
    } else if (info.kind === 'tap') {
      if (!r.done.includes('beat')) r.done.push('beat');
      r.clips.beat = info.over?.drums ? { track: info.over.track, clip: info.over.clip } : l;
    } else {
      if (!r.done.includes('tune')) r.done.push('tune');
      r.clips.tune = l;
    }
    r.step = nextStep(r);
    return r;
  }
  const copyRun = (r) => r && { ...r, words: r.words.slice(), done: r.done.slice(), clips: { ...r.clips }, pv: null };
  function sync() {
    ui.state.coach = R ? { run: 'start', step: R.step, done: R.done.slice() } : null;
    ui.emit('coach', ui.state.coach);
  }

  /* ---------------------------------------------------------------- the steps */
  const beatClip = () => live(R?.clips.beat) || firstClip((t) => isDrumTrack(t));
  const tuneClip = () => live(R?.clips.tune) || firstClip((t) => !isDrumTrack(t));
  function firstClip(test) {
    for (const t of store.get().tracks) { if (t.kind !== 'instrument' || !test(t)) continue; const c = t.clips.find((x) => x.kind === 'notes' && !x.mute && x.notes.length); if (c) return { track: t.id, clip: c.id }; }
    return null;
  }
  const overStage = (kind, c) => { if (!c) { ui.toast('That part isn’t in the song any more.'); return false; } return app.start?.open?.({ kind, over: c }); };
  // each step: its line, its primary and up to two words beside it
  function stepOf(step, r = R) {
    if (step === 'tune') return { line: 'Hum a tune over your beat. One bar of it counts you in.', go: ['Hum over it', () => overStage('hum', beatClip())], more: [['Tap more on the drums', () => overStage('tap', beatClip())], ['Play keys over it', () => overStage('keys', beatClip())]] };
    if (step === 'beat') return { line: `A beat under your tune, at its ${Math.round(store.get().tempo)} BPM.`, go: ['Put a beat under it', () => beatUnder()], more: [['Tap a beat over it', () => overStage('tap', tuneClip())]] };
    if (step === 'band') {
      if (r?.rows) return { line: 'Let a band play around your song: chords, bass and keys on new tracks. Hear each style before you keep it.', go: ['Keep the band', () => keep(), r.sel < 0 || r.busy], more: r.sel >= 0 ? [['Not this one', () => notThis()]] : [] };
      return { line: 'Let a band play around your song: chords, bass and keys on new tracks. Hear each style before you keep it.', go: ['Build a band around it', () => band()], more: [] };
    }
    if (step === 'end') {
      const p = store.get(), bars = Math.max(1, Math.ceil(songEnd(p) / bpbOf() - 1e-6));
      const longer = app.song?.longerPlan?.({ bars: 8 })?.ok;
      return { line: `Your song: ${plural(p.tracks.length, 'track')}, ${plural(bars, 'bar')} at ${Math.round(p.tempo)} BPM. Take one was yours.`,
        go: longer ? ['Make it longer', () => longer8()] : null, more: app.share?.copy ? [['Share', (b) => share(b)]] : [] };
    }
    if (step === 'bye') return { line: 'Done. Find (⌘K) gets you anywhere.', go: null, more: [] };
    return { line: '', go: null, more: [] };
  }
  // what the stage's primary on 'in' is for this landing: the step the run would move to
  function after(info) {
    if (!info?.landed) return null;
    const r = applyLanding(copyRun(R), info);
    const st = stepOf(r.step, r);
    if (!st.go || r.step === 'end') return null;
    return { label: st.go[0], run: () => { if (R && R.step === r.step) st.go[1](); else stepOf(r.step)?.go?.[1]?.(); } };
  }

  /* ---------------------------------------------------------------- docking */
  function dock(door, clips = null, { step = null } = {}) {
    clearTimeout(byeTimer);
    R = fresh(door);
    if (clips) Object.assign(R.clips, clips);
    R.step = step || nextStep(R);
    expecting = null;
    sync();
    paint();
    pointFor(R.step);
    return state();
  }
  function go(step) {
    if (!R || (step !== 'end' && !R.words.includes(step)) || step === 'agent') return false;
    stopPreview();
    R.rows = false; R.sel = -1; R.step = step; R.waiting = null;
    sync(); paint(); pointFor(step);
    return true;
  }
  // the controls a step talks about, pointed at for a moment (the Drums header's instrument: "{Sound} ↗ opens it big.")
  function pointFor(step) {
    if (step !== 'tune') return;
    requestAnimationFrame(() => {
      // (not through the stage: a next part that reopened it covers the header)
      if (!R || app.start?.step) return;
      const b = beatClip(), inst = b && document.querySelector(`[data-track="${b.track}"] .ar-hinst`);
      if (inst) ui.point?.(inst);
    });
  }
  const instName = () => { const b = beatClip(), t = b && store.track(b.track); return t ? app.devices?.getDevice?.(t.instrument?.device)?.name || null : null; };

  /* ---------------------------------------------------------------- Put a beat under it */
  function beatUnder() {
    const c = tuneClip(), f = c && store.findClip(c.clip);
    const bpb = bpbOf();
    R.waiting = 'grooves';
    try { ui.setOpen?.('bottom', true); ui.show?.('grooves'); } catch { /* ok */ }
    try { app.grooves?.fit?.({ bpm: Math.round(store.get().tempo), bar: f ? Math.floor(f.clip.start / bpb + 1e-6) + 1 : 1, bars: f ? Math.max(1, Math.ceil(f.clip.length / bpb - 1e-6)) : 4 }); } catch (e) { console.error('coach: grooves', e); }
    requestAnimationFrame(() => { const b = document.querySelector('.gv-put'); if (b && !app.start?.step) ui.point?.(b); });
    paint();
    return true;
  }

  /* ---------------------------------------------------------------- Build a band around it */
  const seedClip = () => live(R?.clips.tune) || live(R?.clips.beat) || tuneClip() || beatClip();
  const rowsN = () => STYLE_IDS.length + (agentName() ? 1 : 0);
  function band() {
    if (!R) return false;
    if (R.step !== 'band') { R.step = 'band'; sync(); }
    R.rows = true; R.sel = -1;
    paint();
    preview(0);
    return true;
  }
  function stopPreview() {
    if (!R) return;
    R.pvSeq++;
    const p = R.pv; R.pv = null;
    if (p) { try { p.release(); } catch (e) { console.error('coach: preview release', e); } }
  }
  // (a page going away gives the style being heard back first, before the autosave's flush: capture runs ahead of it,
  // so a closed tab never keeps a band nobody kept; a build still on its way is dropped by the token)
  window.addEventListener('pagehide', () => {
    if (!R || (!R.pv && R.sel < 0)) return;
    if (R.pv) { try { app.engine?.stop?.(); } catch { /* ok */ } }
    stopPreview(); R.sel = -1; R.line = null;
    try { paint(); } catch { /* ok */ }
  }, true);
  // ↓/↑: a style heard on the loop (a preview: nothing in History); the agent's row asks it instead
  async function preview(i) {
    if (!R?.rows || R.busy) return null;
    const n = rowsN();
    i = ((i % n) + n) % n;
    stopPreview();
    R.sel = i;
    paint();
    if (i >= STYLE_IDS.length) return null;
    const seed = seedClip();
    if (!seed || !app.band?.build) return null;
    const tok = R.pvSeq;
    let r = null;
    try { r = await app.band.build({ track: seed.track, clip: seed.clip, style: STYLE_IDS[i], by: 'overdub', preview: true }); } catch (e) { r = { error: e.message }; }
    if (!R || tok !== R.pvSeq || !R.rows) { try { r?.preview?.release(); } catch { /* ok */ } return null; }
    if (!r || r.error) { R.line = `That style didn’t fit: ${r?.error || 'no band'}.`; paint(); return null; }
    R.pv = r.preview;
    try { if (!app.engine.playing) app.engine.play(store.get().loop?.on ? store.get().loop.start : 0); } catch { /* silent engine */ }
    return STYLE_IDS[i];
  }
  // Keep the band: the style heard, measured and put in as one dispatch signed by the house
  async function keep() {
    if (!R?.rows || R.sel < 0 || R.busy) return null;
    if (R.sel >= STYLE_IDS.length) return askAgent();
    const seed = seedClip();
    if (!seed) return null;
    const style = STYLE_IDS[R.sel];
    stopPreview();
    R.busy = true; paint();
    let r = null;
    try { r = await app.band.build({ track: seed.track, clip: seed.clip, style, by: 'overdub' }); } catch (e) { r = { error: e.message }; }
    if (!R) return r;
    R.busy = false;
    if (!r || r.error) { R.line = `The band didn’t go in: ${r?.error || 'try again'}.`; paint(); return r; }
    if (!R.done.includes('band')) R.done.push('band');
    R.rows = false; R.sel = -1; R.line = null;
    R.step = 'end';
    sync(); paint();
    return r;
  }
  function notThis() { if (!R?.rows) return false; stopPreview(); R.sel = -1; R.line = null; paint(); focusRow(0); return true; }
  function askAgent() {
    const seed = seedClip(), t = seed && store.track(seed.track);
    stopPreview();
    R.rows = false; R.sel = -1; R.waiting = 'agent';
    try { ui.setOpen?.('right', true); } catch { /* ok */ }
    ui.emit('agent:compose', { text: `Build a band around ${t ? t.name : 'my part'} (arrange_around).`, send: true });
    paint();
    return true;
  }

  /* ---------------------------------------------------------------- the end */
  function longer8() {
    const r = app.song?.longer?.({ bars: 8, toast: false });
    if (r && r.ok === false) { R.line = r.error; paint(); return; }
    bye();
  }
  function share(b) { try { app.share.copy({ anchor: b || null }); } catch (e) { console.error('coach: share', e); } bye(); }
  function bye() {
    if (!R) return;
    stopPreview();
    R.step = 'bye'; R.rows = false; R.line = null;
    sync(); paint();
    clearTimeout(byeTimer);
    byeTimer = setTimeout(() => end(), BYE_MS);
  }
  // ×: the run ends at any step, the strip goes, and nothing in the song changes (a style being heard is let go)
  function end() {
    clearTimeout(byeTimer);
    stopPreview();
    R = null; expecting = null;
    sync();
    const had = el?.contains(document.activeElement);
    el?.remove(); el = null;
    if (had) { try { document.querySelector('.ar-canvas, .ew-region-center')?.focus?.({ preventScroll: true }); } catch { /* ok */ } }
    return true;
  }

  /* ---------------------------------------------------------------- drawing */
  function focusRow(i) { requestAnimationFrame(() => el?.querySelectorAll('.cs-style')[i]?.focus({ preventScroll: true })); }
  function word(w) {
    const done = R.done.includes(w), cur = R.step === w;
    const label = w === 'agent' ? cap(agentName() || 'your agent') : cap(w);
    return h('button.cs-word' + (cur ? '.cur' : done ? '.done' : '.later'), { type: 'button', dataset: { word: w }, 'aria-current': cur ? 'step' : null,
      'aria-label': `${label}${done ? ', done' : cur ? ', now' : ''}`, onclick: () => (w === 'agent' ? ui.setOpen?.('right', true) : go(w)) },
    label, done ? h('span.cs-tick', { 'aria-hidden': 'true' }, ' ✓') : null);
  }
  function paint() {
    if (!R) return;
    const dockEl = ui.dock;
    if (!dockEl) return;
    const had = el?.contains(document.activeElement) ? document.activeElement : null;
    const keepFocus = had?.dataset?.cs || null;
    const st = stepOf(R.step);
    const phone = PHONE.matches;
    const sheet = h('nav.cs-sheet', { 'aria-label': 'The run' }, R.words.flatMap((w, i) => (i ? [h('span.cs-dot', { 'aria-hidden': 'true' }, '·'), word(w)] : [word(w)])));
    const line = h('p.cs-line', { role: 'status', 'aria-live': 'polite' }, R.line || st.line,
      R.step === 'tune' && instName() && !phone ? h('span.cs-aside.t3', { onpointerenter: () => pointFor('tune') }, ` ${instName()} ↗ opens it big.`) : null,
      R.waiting === 'grooves' && R.step === 'beat' ? h('span.cs-aside.t3', ' Grooves’ Use it puts one in.') : null);
    const goB = st.go ? h('button.btn.btn-go.cs-go', { type: 'button', dataset: { cs: 'go' }, 'aria-disabled': st.go[2] ? 'true' : null, onclick: (e) => { if (!st.go[2]) st.go[1](e.currentTarget); } }, st.go[0]) : null;
    const more = (st.more || []).slice(0, 2).map(([label, run], i) => h('button.btn.btn-txt.cs-more', { type: 'button', dataset: { cs: `more${i}` }, onclick: (e) => run(e.currentTarget) }, label));
    const x = h('button.cs-x', { type: 'button', dataset: { cs: 'x' }, title: 'End the run (nothing in the song changes)', 'aria-label': 'End Start a song' }, '×');
    x.onclick = () => end();
    const acts = h('div.cs-acts.ob-mini-row', goB, ...more, x);
    let rows = null;
    if (R.step === 'band' && R.rows) {
      const name = agentName();
      const items = STYLE_IDS.map((id, i) => h('li.ledger-row.cs-style' + (i === R.sel ? '.sel' : ''), { role: 'option', tabindex: i === Math.max(0, R.sel) ? 0 : -1, 'aria-selected': String(i === R.sel), dataset: { style: id }, onclick: () => preview(i) },
        h('span.cs-sname', STYLES[id].label), h('span.cs-blurb', STYLES[id].blurb), h('span.t3.cs-hear', i === R.sel ? (R.busy ? 'putting it in' : 'hearing') : '')));
      if (name) items.push(h('li.ledger-row.cs-style.cs-agent' + (R.sel === STYLE_IDS.length ? '.sel' : ''), { role: 'option', tabindex: -1, 'aria-selected': String(R.sel === STYLE_IDS.length), onclick: () => { R.sel = STYLE_IDS.length; askAgent(); } },
        h('span.cs-sname', `Ask ${name} to build it`), h('span.cs-blurb', 'it builds one around your part, signed in History'), h('span.t3.cs-hear', '')));
      const list = h('ul.ledger.cs-rows', { role: 'listbox', 'aria-label': 'Band styles' }, items);
      // (a listbox owns its arrows: the shell leaves them to it)
      list.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); const i = e.key === 'ArrowDown' ? R.sel + 1 : R.sel < 0 ? rowsN() - 1 : R.sel - 1; preview(i); focusRow(((i % rowsN()) + rowsN()) % rowsN()); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); const i = [...list.children].indexOf(document.activeElement); if (i >= 0 && i !== R.sel) preview(i); else keep(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopPreview(); R.rows = false; R.sel = -1; R.line = null; paint(); }
      });
      // (a phone: the rows are a bottom sheet, the strip's buttons at its foot)
      rows = phone ? h('div.cs-sheetwrap', { role: 'dialog', 'aria-label': 'Build a band around it' }, h('p.cs-sheet-t.disp', 'Build a band around it'), list, acts) : list;
    }
    const kids = [h('div.cs-head', h('span.cs-run.disp', 'Start a song'), sheet), line];
    if (!(phone && rows)) kids.push(acts);
    if (rows) kids.push(rows);
    const next = h('section.cs' + (phone ? '.cs-phone' : '') + (rows ? '.cs-open' : ''), { role: 'region', 'aria-label': 'Start a song', dataset: { step: R.step } }, ...kids);
    if (el) el.replaceWith(next); else dockEl.append(next);
    el = next;
    if (had) {
      const back = keepFocus ? el.querySelector(`[data-cs="${keepFocus}"]`) : null;
      const sel = el.querySelector('.cs-style.sel');
      try { (sel && had.classList?.contains('cs-style') ? sel : back || el.querySelector('.cs-go') || el.querySelector('.cs-x'))?.focus({ preventScroll: true }); } catch { /* ok */ }
    }
  }
  PHONE.addEventListener?.('change', () => paint());

  /* ---------------------------------------------------------------- listening */
  // the stage folded away to the song after a landing: dock, or move the run on
  app.start?.on?.('close', (info) => {
    if (!info || info.to !== 'song' || !info.landed) { if (R) paint(); return; }
    clearTimeout(byeTimer);
    const was = R;
    R = applyLanding(R, info);
    if (was) { R.rows = false; R.sel = -1; R.waiting = null; R.line = null; }
    expecting = null;
    sync(); paint(); pointFor(R.step);
  });
  // Put a beat under it: Grooves' Use it (or any groove put in on this step) moves the run on
  ui.on('grooves:placed', (d) => {
    if (!R || R.step !== 'beat' || !d?.clip) return;
    if (!R.done.includes('beat')) R.done.push('beat');
    R.clips.beat = { track: d.track, clip: d.clip };
    R.waiting = null; R.step = nextStep(R);
    sync(); paint();
  });
  store.on('change', (e) => {
    if (e.kind === 'load') { if (R) end(); expecting = null; return; }
    if (e.kind !== 'do') return;
    // a door that doesn't use the stage: its first part in the song docks the run
    if (expecting && !R) {
      const p = store.get();
      if (!p.tracks.some((t) => t.clips.length)) return;
      if (expecting === 'ask' && e.by === 'you') return;
      const beat = firstClip((t) => isDrumTrack(t)), tune = firstClip((t) => !isDrumTrack(t));
      const door = expecting === 'keys' && !tune && beat ? 'tap' : expecting;
      dock(door, { beat, tune });
      return;
    }
    // the agent built the band it was asked for
    if (R && R.waiting === 'agent' && e.by !== 'you' && (e.ops || []).some((o) => o.type === 'track.add')) {
      if (!R.done.includes('band')) R.done.push('band');
      R.waiting = null; R.step = 'end';
      sync(); paint();
      return;
    }
    if (R && el && R.step === 'end') paint();
  });
  // ↓/↑ walk the style rows (each heard), Esc closes them; nothing while the stage is up
  const rowsOpen = () => !!R?.rows && !app.start?.step && !document.activeElement?.closest?.('input, textarea, [contenteditable="true"]');
  ui.keys.add({ key: 'ArrowDown', when: rowsOpen, run: () => { preview(R.sel + 1); focusRow((R.sel + 1) % rowsN()); }, label: 'Hear the next style (Start a song)', group: 'Start a song', first: true, hidden: true });
  ui.keys.add({ key: 'ArrowUp', when: rowsOpen, run: () => { const i = R.sel <= 0 ? rowsN() - 1 : R.sel - 1; preview(i); focusRow(i); }, label: 'Hear the style before (Start a song)', group: 'Start a song', first: true, hidden: true });
  ui.keys.add({ key: 'Escape', when: rowsOpen, run: () => { stopPreview(); R.rows = false; R.sel = -1; R.line = null; paint(); }, label: 'Close the band rows (Start a song)', group: 'Start a song', first: true, hidden: true });

  function state() {
    if (!R) return null;
    const st = stepOf(R.step);
    return { run: 'start', door: R.door, step: R.step, done: R.done.slice(), words: R.words.slice(), rows: R.rows, sel: R.sel, style: R.sel >= 0 ? STYLE_IDS[R.sel] || 'agent' : null, line: R.line || st.line, hearing: !!R.pv, clips: { ...R.clips } };
  }
  app.coach = {
    expect: (door) => { if (!R && DOOR[door]) expecting = door; return expecting; },
    after, dock, go, band, preview, keep, notThis, end, state,
    beatUnder: () => (R ? beatUnder() : false),
  };
  return app.coach;
}

// Liner notes: a ruled line, no box. The run sheet is words: the step now underlined in cream (2 px), done ones in
// --text-2 with a tick, later ones in --text-3. The style rows are a ledger (rows under rules, the one heard in reverse
// print). A phone: the onboard strip's one-line look, the words wrapping, the rows a bottom sheet.
const CSS = `
.cs { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 6px 22px; padding: 9px 16px 10px; border-top: var(--rule); border-bottom: var(--rule); background: var(--bg); color: var(--text); animation: cs-in .25s var(--ease, ease); }
/* (opacity only: a transform would hold the phone's bottom sheet inside the strip) */
@keyframes cs-in { from { opacity: 0; } }
.cs-head { display: flex; align-items: baseline; gap: 18px; min-width: 0; }
.cs-run { font-size: 15px; white-space: nowrap; color: var(--text); }
.cs-sheet { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 6px; }
.cs-dot { color: var(--text-3); }
.cs-word { padding: 2px 1px 3px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: none; font: 600 13.5px/1.3 var(--font-ui); cursor: pointer; }
.cs-word.cur { color: var(--text); border-bottom-color: var(--text); }
.cs-word.done { color: var(--text-2); }
.cs-word.later { color: var(--text-3); }
.cs-word:hover { color: var(--text); }
.cs-word:focus-visible, .cs-x:focus-visible, .cs-style:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.cs-line { margin: 0; min-width: 0; color: var(--text-2); font-size: 13px; line-height: 1.4; }
.cs-aside { white-space: nowrap; }
.cs-acts { justify-content: flex-end; gap: 6px 14px; flex-wrap: wrap; }
.cs-go { height: 34px; padding: 0 16px; font-size: 13.5px; white-space: nowrap; }
.cs-go[aria-disabled="true"] { opacity: .55; cursor: default; }
.cs-more { white-space: nowrap; }
.cs-x { width: 30px; height: 30px; padding: 0; border: 0; background: none; color: var(--text-2); font: 400 20px/1 var(--font-ui); cursor: pointer; }
.cs-x:hover { color: var(--text); }
.cs-rows { grid-column: 1 / -1; margin: 2px 0 0; border-top: var(--rule); }
.cs-rows .cs-style { --ledger-cols: 120px minmax(0, 1fr) 90px; padding: 8px 6px; cursor: pointer; }
.cs-sname { font-weight: 600; font-size: 13.5px; }
.cs-blurb { color: var(--text-2); font-size: 13px; }
.ledger-row.sel .cs-blurb { color: var(--bg); }
.cs-hear { justify-self: end; font-size: 12px; }
.cs-sheet-t { margin: 0 0 6px; font-size: 18px; }
@media (max-width: 640px) {
  .cs { grid-template-columns: minmax(0, 1fr); gap: 4px; padding: 6px 12px 6px; }
  .cs-head { flex-wrap: wrap; gap: 0 12px; }
  .cs-line { font-size: 13px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .cs-acts { justify-content: flex-start; gap: 0 14px; }
  .cs-acts .cs-go { order: 0; flex: 1 1 60%; height: 44px; font-size: 14px; }
  .cs-acts .cs-x { order: 1; width: 44px; height: 44px; }
  .cs-acts .cs-more { order: 2; height: 36px; padding: 0 2px; }
  .cs-sheetwrap { position: fixed; left: 0; right: 0; bottom: 0; z-index: 80; max-height: 70vh; max-height: 70dvh; overflow: auto; overscroll-behavior: contain; padding: 14px 16px calc(12px + env(safe-area-inset-bottom)); background: var(--bg); border-top: var(--rule-heavy); box-shadow: 0 -12px 30px -12px #000; }
  .cs-sheetwrap .cs-rows .cs-style { --ledger-cols: minmax(0, 1fr) auto; min-height: 48px; }
  .cs-sheetwrap .cs-blurb { grid-column: 1 / -1; grid-row: 2; font-size: 12.5px; }
  .cs-sheetwrap .cs-acts { position: sticky; bottom: calc(-12px - env(safe-area-inset-bottom)); padding: 10px 0 2px; background: var(--bg); }
}
@media (prefers-reduced-motion: reduce) { .cs { animation: none; } }
`;
