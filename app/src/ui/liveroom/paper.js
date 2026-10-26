// The paper [ui] (docs/research/LIVE-ROOM-MODE.md §6.1): the kitchen table's sheet of words and chords, typed or
// pasted, edited a line at a time through the sheet.* ops (core/liveroom/sheet-ops.js), each line signed by whoever
// wrote it. Real text on the brand's paper: selectable, read by a screen reader, editable.
//
//   createPaper({ app, store, say }) -> { el, frame(now), editing(), markTake(), paste(text), unmount() }
//     el: the paper (mount it where the screen wants it); frame(now): from the screen's frame, follows the playhead
//     (the pencil tick) and redraws when the song changed; editing(): a line is being edited (the screen's keys stand
//     aside); markTake(): the words as a take used them, for the crossings-out until the next take; paste(text): a
//     ChordPro or chords-over-words text read onto the paper (one step by you); say(lineId, vars): the talkback
//
// Every edit is one store.dispatch by 'you': sheet.line.set (the words with each chord kept on its syllable),
// sheet.line.add, sheet.line.remove, sheet.section.add, sheet.set { capo }. The house's lines (by 'overdub') carry no
// byline; you carry none on your own paper either; anyone else's line ends with theirs, in the paper's inks.

import { h, css, byline } from '../dom.js';
import {
  parseSheet, pasteOps, lineParts, lineWords, chordsOf, setWords, isBars, readChord, chordRow, shapesKey, soundingKey,
  keyName, newVerse, describeSheet, transposeChord,
} from '../../core/liveroom/sheet.js';
import { roomOf, sheetOf } from '../../core/liveroom/model.js';
import { beatsPerBar } from '../../core/music.js';
import { LINES } from '../../core/liveroom/lines/kitchen.js';

const CSS = `
.pp { background: var(--paper); color: var(--ink); padding: 20px 24px 28px; min-height: 100%; box-sizing: border-box; overflow: auto;
  font: 400 18px/1.7 var(--font-ui); text-align: left; position: relative; }
.pp-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; margin-bottom: 6px; }
.pp-title { margin: 0; font: 800 26px/1.15 var(--font-display); font-variation-settings: var(--font-display-vars); flex: 1 1 auto; min-width: 8ch; }
.pp-title[contenteditable="true"]:focus { outline: 1px dashed var(--ink-3); outline-offset: 3px; }
.pp-slate { font: 600 12px/1.6 var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pp-slate button { font: 600 13px/1 var(--font-mono); color: var(--ink); background: none; border: 1px solid var(--ink-3); min-width: 26px; height: 26px; padding: 0 6px; cursor: pointer; }
.pp-slate button:focus-visible, .pp-flow button:focus-visible, .pp-tools button:focus-visible, .pp-row button:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }
.pp-flow { display: flex; flex-wrap: wrap; gap: 4px 8px; margin: 2px 0 12px; font: 600 13px/1.6 var(--font-mono); color: var(--ink-3); }
.pp-flow span.pp-now { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
.pp-sec { margin: 0 0 14px; }
.pp-sec h3 { margin: 0 0 2px; font: 600 13px/1.6 var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); }
.pp-line { position: relative; padding: 0 0 0 18px; cursor: text; min-height: 1.7em; white-space: pre-wrap; word-break: break-word; }
.pp-line.pp-has-chords { padding-top: 1.15em; }
.pp-seg { position: relative; display: inline; }
.pp-chord { position: absolute; left: 0; top: -1.2em; font: 700 15px/1 var(--font-mono); color: var(--ink); white-space: nowrap; }
.pp-chord.pp-unknown { text-decoration: underline dotted; text-underline-offset: 3px; color: var(--ink-3); }
.pp-bars { font: 700 15px/1.7 var(--font-mono); white-space: pre-wrap; }
.pp-bars .pp-unknown { text-decoration: underline dotted; text-underline-offset: 3px; color: var(--ink-3); }
.pp-hint { color: var(--ink-3); }
.pp-struck { display: block; color: var(--ink-3); text-decoration: line-through; font-size: 15px; line-height: 1.3; padding-left: 18px; }
.pp-line .by { font-size: inherit; margin-left: 0.5ch; }
.pp-tick::before { content: ''; position: absolute; left: 2px; bottom: 0.55em; width: 10px; height: 2px; background: var(--ink); transform: rotate(-20deg); }
.pp-edit { display: block; padding-left: 18px; }
.pp-edit input { width: 100%; box-sizing: border-box; font: 400 18px/1.5 var(--font-ui); color: var(--ink); background: transparent; border: 0; border-bottom: 1px solid var(--ink-3); padding: 2px 0; outline: none; }
.pp-row { display: flex; gap: 4px; overflow-x: auto; padding: 2px 0 4px 18px; }
.pp-row button { flex: none; font: 700 14px/1 var(--font-mono); color: var(--ink); background: none; border: 1px solid var(--ink-3); min-width: 44px; height: 32px; padding: 0 8px; cursor: pointer; }
.pp-tools { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.pp-tools button { font: 400 14px/1 var(--font-ui); color: var(--ink); background: none; border: 1px solid var(--ink-3); height: 32px; padding: 0 12px; cursor: pointer; }
.pp-paste { width: 100%; min-height: 12em; box-sizing: border-box; font: 400 15px/1.5 var(--font-mono); color: var(--ink); background: transparent; border: 1px solid var(--ink-3); padding: 8px; }
@media (max-width: 760px) { .pp { font-size: 14px; line-height: 17px; padding: 14px 16px 20px; } .pp-line { min-height: 2em; } .pp-edit input { font-size: 16px; } .pp-row button { height: 44px; } }
`;

const flowWord = (name, n) => {
  const base = String(name || '').replace(/\s+\d+$/, '');
  if (/^verse/i.test(base)) return `V${n}`;
  if (/^chorus/i.test(base)) return 'C';
  if (/^bridge/i.test(base)) return 'B';
  if (/^pre/i.test(base)) return 'P';
  if (/^intro/i.test(base)) return 'Intro';
  if (/^outro|^end/i.test(base)) return 'End';
  return base.slice(0, 6);
};
const flat = (s) => String(s).replace(/b(?=\d|m|$|\/|s|a|d|M)/g, '♭').replace(/#/g, '♯');

export function createPaper({ app, store, say = () => {} }) {
  css('lr-paper', CSS);
  const el = h('section.pp.paper', { 'aria-label': 'The paper' });
  let printed = '', editing = null, ticked = null, takeWords = new Map(), pasting = false;

  const sheet = () => sheetOf(store.get());
  const dispatch = (ops, label) => {
    const r = store.dispatch(ops, { by: 'you', label });
    if (!r.ok && r.error) console.warn('overdub paper:', r.error);
    return r;
  };
  // a song with no paper yet gets a blank one: a title line, capo none, one [VERSE] (§6.1 "Blank"); the house's
  function ensure() {
    const p = store.get();
    if (sheetOf(p)) return;
    store.dispatch([{ type: 'sheet.set', patch: { capo: 0 } }, { type: 'sheet.section.add', section: { name: 'Verse', lines: [{ text: '' }] } }], { by: 'overdub', label: 'A blank paper' });
  }

  function chordSpan(sym, key) {
    const ok = !!readChord(sym, key);
    return h(`span.pp-chord${ok ? '' : '.pp-unknown'}`, { title: ok ? null : LINES['k.unknown'].text() }, flat(sym));
  }
  function lineEl(sec, line, key) {
    const text = line.text;
    const kids = [];
    if (isBars(text)) {
      const bars = h('span.pp-bars');
      for (const part of text.split(/(\s+)/)) {
        if (!part.trim() || part === '|' || part === '%' || part === '/') bars.append(part);
        else bars.append(readChord(part, key) ? flat(part) : h('span.pp-unknown', { title: LINES['k.unknown'].text() }, part));
      }
      kids.push(bars);
    } else if (!text.trim()) {
      kids.push(h('span.pp-hint', sheet()?.sections.length === 1 && sec.lines.length === 1 ? LINES['k.paper.blank'].text() : ' '));
    } else {
      for (const part of lineParts(text)) {
        const seg = h('span.pp-seg', part.chord != null ? chordSpan(part.chord, key) : null, part.text || (part.chord != null ? ' ' : ''));
        kids.push(seg);
      }
    }
    if (line.by && line.by !== 'you' && line.by !== 'overdub') { const b = byline(line.by, { app }); if (b) kids.push(' · ', b); }
    const was = takeWords.get(line.id);
    const struck = was != null && was !== lineWords(text) && was.trim() ? h('span.pp-struck', { 'aria-label': 'the words in the take' }, was) : null;
    const row = h(`div.pp-line${chordsOf(text).length && !isBars(text) ? '.pp-has-chords' : ''}`, { dataset: { line: line.id, section: sec.id }, tabIndex: 0, role: 'button', 'aria-label': `${lineWords(text) || text || 'empty line'}: edit` }, ...kids);
    row.addEventListener('click', () => edit(sec.id, line.id));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); edit(sec.id, line.id); } });
    return struck ? h('div', struck, row) : row;
  }

  function draw() {
    const p = store.get(), sh = sheetOf(p);
    printed = JSON.stringify([sh, p.title, p.sections, p.tempo, p.meter, roomOf(p)?.parts]);
    if (pasting) return;
    el.replaceChildren();
    // the header: the title, the slates (capo, the key it sounds in, the meter, the time once there's a take)
    const title = h('h2.pp-title', { contentEditable: 'true', spellcheck: 'false', 'aria-label': 'Title' }, p.title && p.title !== 'Untitled' ? p.title : 'Untitled');
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } e.stopPropagation(); });
    title.addEventListener('blur', () => { const t = title.textContent.trim().slice(0, 200); if (t && t !== p.title) dispatch([{ type: 'project.set', patch: { title: t } }], 'The title'); });
    const capo = sh?.capo || 0;
    const sk = sh ? soundingKey(sh, p) : null;
    const room = roomOf(p);
    const slate = h('div.pp-slate',
      h('button', { 'aria-label': 'Capo down', onclick: () => setCapo(capo - 1), disabled: capo <= 0 }, '−'),
      h('span', capo ? `Capo ${capo}` : 'Capo —'),
      h('button', { 'aria-label': 'Capo up', onclick: () => setCapo(capo + 1), disabled: capo >= 11 }, '+'),
      sk ? h('span', `· Sounds in ${flat(sk.root)}${sk.scale === 'minor' ? ' minor' : ''}`) : null,
      Array.isArray(sh?.time) || (p.meter && beatsPerBar(p.meter) !== 4) ? h('span', `· ${(sh?.time || p.meter).join('/')}`) : null,
      room?.master ? h('span', `· ~${Math.round(p.tempo)} BPM`) : null);
    el.append(h('div.pp-head', title, slate));
    // the flow: the song's parts in order, a run of one part as ×2
    const secs = (p.sections || []).slice().sort((a, b) => a.start - b.start);
    if (secs.length) {
      const flow = h('div.pp-flow', { 'aria-label': 'The song in order' });
      let verse = 0, prev = null;
      const words = [];
      for (const s of secs) {
        const ss = room?.parts?.[s.id]?.sheet || s.name;
        if (/^verse/i.test(s.name) && ss !== prev) verse++;
        if (ss === prev && words.length) { words[words.length - 1].n++; words[words.length - 1].ids.push(s.id); continue; }
        words.push({ w: flowWord(s.name, verse), n: 1, ids: [s.id] });
        prev = ss;
      }
      words.forEach((x, i) => { if (i) flow.append('·'); flow.append(h('span', { dataset: { sections: x.ids.join(' ') } }, x.n > 1 ? `${x.w} ×${x.n}` : x.w)); });
      el.append(flow);
    }
    if (!sh) return;
    const key = shapesKey(sh, p);
    for (const sec of sh.sections) {
      const box = h('div.pp-sec', { dataset: { section: sec.id } }, h('h3', `[${sec.name}]`));
      for (const line of sec.lines) box.append(editing && editing.line === line.id ? editorEl(sec, line, key) : lineEl(sec, line, key));
      el.append(box);
    }
    el.append(h('div.pp-tools',
      h('button', { onclick: addVerse }, 'New verse'),
      h('button', { onclick: () => addSection('Chorus') }, 'Chorus'),
      h('button', { onclick: () => addSection('Bridge') }, 'Bridge'),
      h('button', { onclick: openPaste }, 'Paste a song')));
    if (editing) queueMicrotask(() => { const i = el.querySelector('.pp-edit input'); if (i && document.activeElement !== i) { i.focus(); const at = editing.at ?? i.value.length; i.setSelectionRange(at, at); } });
  }

  // a line being edited: its inline form ("Somewhere a [G]paper [Em]moon"), the chord row above it
  function editorEl(sec, line, key) {
    const input = h('input', { type: 'text', value: line.text, maxLength: 200, 'aria-label': `${sec.name}: a line`, spellcheck: 'true', dataset: { line: line.id } });
    const row = h('div.pp-row', { role: 'toolbar', 'aria-label': 'Chords' }, ...chordRow(sheet(), store.get()).map((sym) => h('button', {
      onmousedown: (e) => e.preventDefault(),
      onclick: () => { const a = input.selectionStart ?? input.value.length; input.value = input.value.slice(0, a) + `[${sym}]` + input.value.slice(input.selectionEnd ?? a); const at = a + sym.length + 2; input.focus(); input.setSelectionRange(at, at); },
    }, flat(sym))));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(sec.id, line.id, input.value, { next: true, at: input.selectionStart }); }
      else if (e.key === 'Escape') { e.preventDefault(); editing = null; draw(); }
      else if (e.key === 'Backspace' && !input.value) { e.preventDefault(); removeLine(sec.id, line.id); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); move(sec.id, line.id, input.value, e.key === 'ArrowUp' ? -1 : 1); }
    });
    input.addEventListener('blur', () => setTimeout(() => { if (editing && editing.line === line.id && !el.contains(document.activeElement)) commit(sec.id, line.id, input.value, {}); }, 0));
    return h('div.pp-edit', row, input);
  }

  function edit(section, line, at = null) { editing = { section, line, at }; draw(); }
  function find(section, line) { const sh = sheet(); const s = sh?.sections.find((x) => x.id === section); return { sh, s, l: s?.lines.find((x) => x.id === line) }; }
  // the line's new text: when only its words changed, its chords stay on their syllables (setWords)
  function textFor(old, typed) {
    if (typed.includes('[') || isBars(typed) || isBars(old)) return typed;
    return chordsOf(old).length ? setWords(old, typed) : typed;
  }
  function commit(section, line, typed, { next = false, at = null }) {
    const { s, l } = find(section, line);
    if (!s || !l) { editing = null; draw(); return; }
    const text = textFor(l.text, String(typed).slice(0, 200));
    const ops = [];
    if (text !== l.text) ops.push({ type: 'sheet.line.set', section, line, patch: { text } });
    let nextId = null;
    if (next) {
      const idx = s.lines.indexOf(l);
      // Enter in the middle of the words splits the line there (the chords go with their words)
      ops.push({ type: 'sheet.line.add', section, line: { text: '' }, index: idx + 1, ref: 'nl' });
    }
    editing = null;
    if (ops.length) {
      const r = dispatch(ops, next ? 'A new line' : 'A line');
      nextId = r.ok && r.created ? r.created.nl : null;
    }
    if (nextId) edit(section, nextId); else draw();
  }
  function removeLine(section, line) {
    const { s } = find(section, line);
    if (!s) return;
    const idx = s.lines.findIndex((x) => x.id === line);
    const prev = s.lines[idx - 1];
    editing = null;
    if (s.lines.length > 1) dispatch([{ type: 'sheet.line.remove', section, line }], 'A line out');
    if (prev) edit(section, prev.id); else draw();
  }
  function move(section, line, typed, dir) {
    const sh = sheet();
    const all = sh.sections.flatMap((s) => s.lines.map((l) => ({ s: s.id, l: l.id })));
    const i = all.findIndex((x) => x.l === line);
    const to = all[i + dir];
    const { l } = find(section, line);
    const text = l ? textFor(l.text, typed) : typed;
    if (l && text !== l.text) dispatch([{ type: 'sheet.line.set', section, line, patch: { text } }], 'A line');
    if (to) edit(to.s, to.l); else { editing = null; draw(); }
  }
  function setCapo(c) {
    const sh = sheet();
    if (!sh || c < 0 || c > 11) return;
    dispatch([{ type: 'sheet.set', patch: { capo: c } }], c ? `Capo ${c}` : 'No capo');
    // the takes made at another capo: as a fact, once
    const room = roomOf(store.get());
    const off = Object.entries(room?.takes || {}).filter(([, t]) => (t.capo || 0) !== c);
    if (off.length) {
      const p = store.get();
      const nums = off.map(([id]) => { for (const t of p.tracks) { const k = t.clips.find((x) => x.id === id); if (k) { const m = /take (\d+)/.exec(k.name || ''); return m ? +m[1] : null; } } return null; }).filter((x) => x != null);
      if (nums.length) say('k.capo.after', { takes: nums, capo: off[0][1].capo || 0 });
    }
  }
  function addVerse() {
    const v = newVerse(sheet());
    const r = dispatch([{ type: 'sheet.section.add', section: v, ref: 'nv' }], v.name);
    const s = r.ok && sheet().sections.find((x) => x.id === r.created?.nv);
    if (s) edit(s.id, s.lines[0].id);
  }
  function addSection(name) {
    const have = sheet().sections.filter((s) => s.name.replace(/\s+\d+$/, '') === name).length;
    const r = dispatch([{ type: 'sheet.section.add', section: { name: have ? `${name} ${have + 1}` : name, lines: [{ text: '' }] }, ref: 'ns' }], name);
    const s = r.ok && sheet().sections.find((x) => x.id === r.created?.ns);
    if (s) edit(s.id, s.lines[0].id);
  }
  function openPaste() {
    pasting = true;
    const ta = h('textarea.pp-paste', { 'aria-label': 'Paste a song: ChordPro, or chords over words', placeholder: '[Verse]\nG         Em\nSomewhere a paper moon…' });
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { pasting = false; draw(); } });
    el.replaceChildren(h('div.pp-head', h('h2.pp-title', 'Paste a song')), ta, h('div.pp-tools',
      h('button', { onclick: () => { pasting = false; paste(ta.value); } }, 'Put it on the paper'),
      h('button', { onclick: () => { pasting = false; draw(); } }, 'Cancel')));
    ta.focus();
  }
  // a song's text onto the paper, in one step by you: "Read 3 sections, 14 lines, 5 chords: G, C, D, Em, Am. Capo 2."
  function paste(text) {
    const parsed = parseSheet(text);
    if (!parsed.sections.length) return { ok: false };
    const { ops } = pasteOps(store.get(), parsed);
    const r = dispatch(ops, 'The paper');
    if (r.ok) {
      const d = describeSheet(parsed);
      say('k.paper.read', { sections: d.sections, lines: d.lines, count: d.chords.length, chords: d.chords.map(flat).slice(0, 8), capo: parsed.capo || 0 });
    }
    draw();
    return r;
  }

  // the pencil tick: the line under the playhead, the page following it
  function follow() {
    const engine = app?.engine;
    const p = store.get(), sh = sheetOf(p);
    let id = null;
    if (engine?.playing && sh && Number.isFinite(engine.beat)) {
      const b = engine.beat;
      const s = (p.sections || []).find((x) => b >= x.start && b < x.start + x.length);
      const ss = s && roomOf(p)?.parts?.[s.id]?.sheet;
      const sec = ss ? sh.sections.find((x) => x.id === ss) : s ? sh.sections.find((x) => x.name === s.name) : null;
      if (sec && sec.lines.length) id = sec.lines[Math.min(sec.lines.length - 1, Math.floor(((b - s.start) / s.length) * sec.lines.length))].id;
      for (const f of el.querySelectorAll('.pp-flow span')) f.classList.toggle('pp-now', !!s && f.dataset.sections.split(' ').includes(s.id));
    }
    if (id === ticked) return;
    el.querySelector('.pp-tick')?.classList.remove('pp-tick');
    ticked = id;
    const row = id ? el.querySelector(`.pp-line[data-line="${id}"]`) : null;
    if (row) {
      row.classList.add('pp-tick');
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      row.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }
  }

  ensure();
  draw();
  const off = store.on('change', () => {
    const p = store.get();
    const now = JSON.stringify([sheetOf(p), p.title, p.sections, p.tempo, p.meter, roomOf(p)?.parts]);
    if (now !== printed && !editing) draw();
  });
  return {
    el,
    frame() { if (!editing && !pasting) follow(); },
    editing: () => !!editing || pasting,
    markTake() { takeWords = new Map(); for (const s of sheet()?.sections || []) for (const l of s.lines) takeWords.set(l.id, lineWords(l.text)); },
    paste,
    redraw: draw,
    unmount() { try { off?.(); } catch { /* gone */ } el.remove(); },
  };
}

export { keyName, transposeChord };
