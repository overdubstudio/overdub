// The shelf [ui; stream F] (docs/research/LIVE-ROOM-MODE.md §2.6, §3.13, §9.6): the room's songs as tape boxes, newest
// first (ui/liveroom/shelf-db.js, the label written from the song by core/liveroom/label.js, its cover drawn by
// ui/liveroom/pixels drawCover), then the control room's Recent songs as plain boxes. It adds the 'shelf' screen to
// the registry (ui/liveroom/screens.js) when it's imported.
//
//   installShelf(app) -> { keep(song) }   main.js, once the modules are in: keep is called on every autosave, beside
//       overdub:project, and writes a room song's record (a song with no room isn't the shelf's). At the first kept
//       take it asks the browser to keep this site's storage (navigator.storage.persist(), silently, once per browser).
//       A load that came back to the room (app.door: side 'room', song 'saved') says where you left it, and when the
//       song's recordings aren't in this browser, says so (§2.6)
//   comeBack(app) -> Promise of the lines said      the same, for a room song opened from the shelf, a file, a zip or
//                                                   the account (ui event 'song:opened', with the room over it)
//   inUse(app, { except }) -> Promise of Set        every recording another song in this browser names
//   spaceLine() -> Promise of the space line or ''  the line at 80% of navigator.storage.estimate()
//
// A box: the title (the display face, or the house's "Untitled · 132 · drop C"), the slate, the parts as words, the day,
// the size of its takes, the engineer's note, the cover; a die on an untitled box offers three titles (a press names
// the song, a step by you); a press opens it in the room, and Send opens the send screen on it. Take it off the shelf asks first, plainly, and deletes only
// the recordings no other song here uses (the song on the stage can't be taken off: it's the one you're on).

import { h, css } from '../dom.js';
import { screens } from './screens.js';
import * as db from './shelf-db.js';
import { prefs } from './prefs.js';
import { drawCover } from './pixels/index.js';
import { labelOf, titleDice } from '../../core/liveroom/label.js';
import { LINES } from '../../core/liveroom/lines/shelf.js';
import { songAssets } from '../export.js';

const line = (id, vars) => LINES[id].text(vars || {});
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const roomy = (p) => isObj(p?.room);
// the screen a room song plays on: the kitchen table's own, else the stage
const stageOf = (p) => (p?.room?.place === 'kitchen' ? 'kitchen' : 'stage');
const MB = (b) => Math.round(b / 1e6);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayOf = (at) => { const d = new Date(at); return `${DAYS[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const COVER = { w: 128, h: 80 };
// once per browser, in overdub:room beside its own fields (prefs keeps a newer studio's keys): the backup offered,
// persist() asked. (Not in said, which keeps the last 50 songs' lines and would let the offer come back.)
const OFFERED = 'backupOffered';
const PERSIST = 'persistAsked';
const SPACE_AT = 0.8;
// a minute of a take as the asset store keeps it: mono 32-bit float at 48 kHz
const TAKE_MINUTE = 48000 * 4 * 60;

/* ------------------------------------------------------------------------------------------------ sizes and use */
// the bytes of a song's recordings, as the asset store keeps them (32-bit float): what's loaded, else what the song says
function bytesOf(app, p) {
  let n = 0;
  for (const id of songAssets(p)) {
    const b = app.engine?.assets?.peek?.(id);
    if (b) { n += b.length * b.numberOfChannels * 4; continue; }
    const m = p.assets?.[id];
    if (m && m.duration > 0) n += Math.round((m.sr || 48000) * m.duration * (m.channels || 1) * 4);
  }
  return n;
}
const hasTake = (p) => (p?.tracks || []).some((t) => (t.clips || []).some((c) => c.kind === 'audio' && c.asset));
// every song this browser keeps besides the shelf's: the one saved, the previous one, the one before Make it yours,
// Recent songs
function keptSongs() {
  const out = [];
  const one = (k) => { try { const s = localStorage.getItem(k); if (s) out.push(JSON.parse(s)); } catch { /* none */ } };
  one('overdub:project'); one('overdub:previous'); one('overdub:before-fork');
  try { const r = JSON.parse(localStorage.getItem('overdub:recent') || '[]'); if (Array.isArray(r)) for (const e of r) if (e && e.song) out.push(e.song); } catch { /* none */ }
  return out;
}
// The recordings in use by anything here but the song `except` (an id): every other song on the shelf, the songs the
// browser keeps, the song on screen (unless it's that one), and the passes Capture keeps (Takes).
export async function inUse(app, { except = null } = {}) {
  const ids = new Set();
  const add = (p) => { if (p && p.id !== except) for (const id of songAssets(p)) ids.add(id); };
  for (const r of await db.list()) add(r.song);
  for (const p of keptSongs()) add(p);
  add(app.store?.get?.());
  try { for (const ph of app.input?.capture?.list?.({ all: true }) || []) if (typeof ph?.audio === 'string') ids.add(ph.audio); } catch { /* no capture */ }
  return ids;
}

export async function spaceLine() {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || !(e.quota > 0) || !(e.usage >= 0) || e.usage / e.quota < SPACE_AT) return '';
    return line('shelf.space', { minutes: Math.max(0, Math.floor((e.quota - e.usage) / TAKE_MINUTE)) });
  } catch { return ''; }
}
const safari = () => typeof navigator !== 'undefined' && /^((?!chrome|chromium|crios|fxios|android|edg).)*safari/i.test(navigator.userAgent || '');

/* ------------------------------------------------------------------------------------------------ coming back */
// The room on a song you come back to (§2.6): one line written from the song, and when its recordings aren't in this
// browser (a song from the cloud, or another computer), the line that says so. -> the lines said
export async function comeBack(app) {
  const p = app.store.get();
  if (!roomy(p)) return [];
  const L = labelOf(p), said = [];
  const text = line('note.back', { title: L.title, note: L.where });
  app.liveRoom?.say?.(text);
  said.push(text);
  const ids = songAssets(p);
  if (ids.length) {
    const have = await Promise.all(ids.map((id) => Promise.resolve(app.engine?.assets?.get?.(id)).then((b) => !!b).catch(() => false)));
    if (have.some((x) => !x) && app.store.get().id === p.id) {
      const t = line('note.assets');
      app.liveRoom?.say?.(t);
      said.push(t);
    }
  }
  app.ui?.emit?.('liveroom:back', { lines: said });
  return said;
}

export function installShelf(app) {
  let persistAsked = false;
  try { persistAsked = !!prefs.get()[PERSIST]; } catch { /* storage: ask this visit */ }
  let spaceSaid = false;
  async function askPersist() {
    if (persistAsked) return;
    persistAsked = true;
    try { prefs.set({ [PERSIST]: true }); } catch { /* fine */ }
    try {
      if (!navigator.storage?.persist) return;
      if (await navigator.storage.persisted?.()) return;
      await navigator.storage.persist();
    } catch { /* the browser decides */ }
  }
  const last = new Map();
  function keep(song) {
    if (!roomy(song) || typeof song.id !== 'string') return;
    const L = labelOf(song);
    const rec = { id: song.id, song, at: Date.now(), title: L.title, place: song.room.place || null, finished: !!L.finished, bytes: bytesOf(app, song) };
    // (the same song with nothing changed but the time isn't written again)
    const sig = JSON.stringify(song);
    if (last.get(song.id) === sig) return;
    last.set(song.id, sig);
    db.put(rec).then(() => app.ui?.emit?.('liveroom:shelf', { id: rec.id }));
    if (hasTake(song)) {
      askPersist();
      if (!spaceSaid) spaceLine().then((t) => { if (t && !spaceSaid && app.liveRoom?.isOpen?.()) { spaceSaid = true; app.liveRoom.say(t); } });
    }
  }
  // A song replaced before its autosave ran (a box opened right after an edit, a file, New song): kept as it was, so the
  // shelf has its last change. (The store loads a new song object; the old one stays as it was.)
  let was = app.store.get();
  app.store.on('change', (e) => {
    const now = app.store.get();
    if (e?.kind === 'load' && was && was !== now && was.id !== now.id && roomy(was)) { try { keep(was); } catch (err) { console.error('overdub: the shelf', err); } }
    was = now;
  });
  // a load that came back to the room: where you left it, once the room is up
  if (app.door?.side === 'room' && app.door?.song === 'saved' && app.liveRoom?.on) {
    const off = app.liveRoom.on('open', () => { off(); comeBack(app); });
  }
  // a room song opened from outside (a file, a Send the song zip, the account, the shelf): the same, once the room is
  // over it (ui/export.js opens the room just after it says the song is open)
  app.ui?.on?.('song:opened', () => setTimeout(() => { if (app.liveRoom?.isOpen?.() && roomy(app.store.get())) comeBack(app); }, 0));
  return { keep };
}

/* ------------------------------------------------------------------------------------------------ the screen */
const CSS = `
.lrsh { width: min(100%, 1180px); display: flex; flex-direction: column; gap: 16px; }
.lrsh-top { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.lrsh-top .lr-h { text-align: left; }
.lrsh-said { margin: 0; font-size: 15px; color: var(--text-2); max-width: 70ch; }
.lrsh-said button { margin-left: 8px; }
.lrsh-corner { margin-left: auto; }
.lrsh-boxes { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.lrsh-box { display: flex; flex-direction: column; gap: 6px; padding: 12px; background: var(--bg-2); border: 1px solid var(--line); min-width: 0; }
.lrsh-open { display: flex; flex-direction: column; gap: 6px; padding: 0; text-align: left; background: none; border: 0; color: var(--text); font: inherit; cursor: pointer; min-width: 0; }
.lrsh-open:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 4px; }
.lrsh-cover { width: 256px; max-width: 100%; height: auto; aspect-ratio: 128 / 80; image-rendering: pixelated; display: block; }
.lrsh-title { font-size: 20px; line-height: 1.15; overflow-wrap: anywhere; }
.lrsh-slate { font: 12px/1.35 var(--font-mono); letter-spacing: .04em; color: var(--text-2); }
.lrsh-meta { font: 12px/1.35 var(--font-mono); color: var(--text-3); }
.lrsh-parts { font-size: 14px; color: var(--text-2); }
.lrsh-note { font-size: 14px; line-height: 1.4; color: var(--text); }
.lrsh-acts { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
.lrsh-act { background: none; border: 0; padding: 8px 2px; min-height: 40px; color: var(--text-2); font: inherit; font-size: 13px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--line-2); }
.lrsh-act:hover, .lrsh-act:focus-visible { color: var(--text); outline: none; text-decoration-color: currentColor; }
.lrsh-dice { display: flex; flex-wrap: wrap; gap: 6px; }
.lrsh-ask { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid var(--line); font-size: 14px; }
.lrsh-ask div { display: flex; gap: 8px; }
.lrsh-plain .lrsh-title { font-size: 17px; }
.lrsh-here { font-size: 13px; color: var(--text-3); }
@media (max-width: 640px) { .lrsh-boxes { grid-template-columns: 1fr; } }
`;

screens.add({
  id: 'shelf',
  mount(el, ctx) {
    const { app, ui, store } = ctx;
    css('liveroom-shelf', CSS);
    let gone = false, records = [], plain = [], space = '', asking = null;
    const back = () => app.liveRoom.open({ screen: roomy(store.get()) ? stageOf(store.get()) : 'door' });
    const said = h('div.lrsh-said-box');
    const corner = h('button.btn.btn-txt.lrsh-corner', { type: 'button', hidden: true, style: { display: 'none' }, onclick: () => backup() }, 'Back it up');
    const showCorner = (yes) => { corner.hidden = !yes; corner.style.display = yes ? '' : 'none'; };
    const boxes = h('div.lrsh-boxes', { role: 'list', 'aria-label': 'Songs on the shelf' });
    el.append(h('div.lrsh',
      h('div.lrsh-top', h('h1.lr-h.disp', 'The shelf'), corner, h('button.btn.btn-txt.lrsh-back', { type: 'button', onclick: back }, !roomy(store.get()) ? 'Back to the door' : stageOf(store.get()) === 'kitchen' ? 'Back to the table' : 'Back to the stage')),
      said, boxes));

    async function backup() {
      const { sendSong } = await import('./send.js');
      return sendSong(app);
    }
    function sayTop() {
      const xs = [];
      let offered = false;
      try { offered = !!prefs.get()[OFFERED]; } catch { /* storage: prefs remembers it for the visit */ }
      if (!offered && (records.length || plain.length)) {
        try { prefs.set({ [OFFERED]: true }); } catch { /* fine */ }
        xs.push(h('p.lrsh-said.lrsh-backup', line('shelf.backup'), h('button.btn.btn-small', { type: 'button', onclick: () => backup() }, 'Back it up'), safari() ? ` ${line('shelf.safari')}` : null));
        showCorner(false);
      } else showCorner(!!(records.length || plain.length));
      if (space) xs.push(h('p.lrsh-said.lrsh-space', space));
      if (!records.length && !plain.length) xs.push(h('p.lrsh-said.lrsh-empty', line('shelf.empty')));
      said.replaceChildren(...xs);
    }

    async function open(rec) {
      const cur = store.get();
      if (rec.id === cur.id) { app.liveRoom.open({ screen: stageOf(cur) }); return true; }
      const ok = await app.exporter.openSong(rec.song, { from: 'shelf', name: rec.title, said: `Back to “${rec.title}”.` });
      if (!ok) return false;
      // (openSong opens the room on a song with one, and installShelf's listener says where you left it)
      if (roomy(store.get())) app.liveRoom.open({ screen: stageOf(store.get()) });
      return true;
    }
    // Send, from the shelf (§3.14): the box's song on the stage, then the send screen
    async function send(rec) {
      if (rec.id !== store.get().id && !(await open(rec))) return false;
      app.liveRoom.open({ screen: 'send' });
      return true;
    }
    function openPlain(i) {
      if (!app.exporter?.openRecent?.(i)) return false;
      if (roomy(store.get())) app.liveRoom.open({ screen: stageOf(store.get()) });
      else app.liveRoom.close();
      return true;
    }
    async function name(rec, title) {
      if (rec.id !== store.get().id && !(await open(rec))) return false;
      const r = store.dispatch({ type: 'project.set', patch: { title } }, { by: 'you', label: `Name it “${title}”`, reason: 'room:name' });
      if (!r.ok) { app.liveRoom.say(r.error); return false; }
      return true;
    }
    async function takeOff(rec) {
      if (rec.id === store.get().id) return { ok: false, error: line('shelf.here') };
      const used = await inUse(app, { except: rec.id });
      const mine = songAssets(rec.song);
      let kept = 0;
      for (const id of mine) {
        if (used.has(id)) { kept++; continue; }
        try { await app.engine?.assets?.remove?.(id); } catch { /* gone already */ }
      }
      await db.remove(rec.id);
      // (and from Recent songs, where a song the studio replaced is kept: off the shelf is off the shelf)
      try { app.exporter?.forgetRecent?.(rec.id); } catch { /* storage */ }
      app.liveRoom.say(line('shelf.done', { title: rec.title, kept }));
      asking = null;
      await load();
      return { ok: true, kept, removed: mine.length - kept };
    }

    // the question names what goes: the megabytes of takes no other song here uses
    async function ask(rec) {
      const used = await inUse(app, { except: rec.id });
      let bytes = 0;
      for (const id of songAssets(rec.song)) {
        if (used.has(id)) continue;
        let b = app.engine?.assets?.peek?.(id) || null;
        if (!b) { try { b = await app.engine?.assets?.get?.(id); } catch { b = null; } }
        if (b) bytes += b.length * b.numberOfChannels * 4;
      }
      asking = { id: rec.id, mb: MB(bytes) };
      draw();
      boxes.querySelector('.lrsh-off-yes')?.focus();
    }
    function box(rec) {
      const L = labelOf(rec.song);
      const cover = h('canvas.lrsh-cover', { width: COVER.w, height: COVER.h, 'aria-hidden': 'true' });
      try { const g = cover.getContext('2d'); if (g) { g.imageSmoothingEnabled = false; drawCover(g, L.cover, COVER); } } catch (e) { console.warn('overdub: a tape box’s cover', e); }
      const here = rec.id === store.get().id;
      const mb = MB(rec.bytes || bytesOf(app, rec.song));
      const meta = [dayOf(rec.at), mb ? `${mb} MB of takes` : 'no takes yet'].join(' · ');
      const dice = !L.named ? h('div.lrsh-dice', { hidden: true }, titleDice(rec.song).map((t) => h('button.btn.btn-small.lrsh-name', { type: 'button', onclick: () => name(rec, t) }, t))) : null;
      const asked = asking?.id === rec.id ? h('div.lrsh-ask', { role: 'group', 'aria-label': 'Take it off the shelf?' },
        h('span', line('shelf.remove.ask', { title: L.title, mb: asking.mb })),
        h('div', h('button.btn.btn-small.lrsh-off-yes', { type: 'button', onclick: () => takeOff(rec) }, 'Take it off'), h('button.btn.btn-small.lrsh-off-no', { type: 'button', onclick: () => { asking = null; draw(); } }, 'Keep it'))) : null;
      return h('article.lrsh-box', { role: 'listitem', dataset: { id: rec.id } },
        h('button.lrsh-open', { type: 'button', onclick: () => open(rec), 'aria-label': `${L.title}. ${L.slate}. ${L.note}` },
          cover,
          h('span.lrsh-title.disp', L.title),
          L.slate ? h('span.lrsh-slate', L.slate) : null,
          L.parts.length ? h('span.lrsh-parts', L.parts.join(', ')) : null,
          h('span.lrsh-meta', meta),
          h('span.lrsh-note', L.note)),
        h('div.lrsh-acts',
          h('button.lrsh-act.lrsh-send', { type: 'button', onclick: () => send(rec) }, 'Send'),
          dice ? h('button.lrsh-act.lrsh-die', { type: 'button', 'aria-expanded': 'false', onclick: (e) => { dice.hidden = !dice.hidden; e.currentTarget.setAttribute('aria-expanded', String(!dice.hidden)); } }, 'Name it') : null,
          here ? h('span.lrsh-here', line('shelf.here')) : h('button.lrsh-act.lrsh-off', { type: 'button', onclick: () => ask(rec) }, 'Take it off the shelf')),
        dice, asked);
    }
    function plainBox(e, i) {
      return h('article.lrsh-box.lrsh-plain', { role: 'listitem', dataset: { recent: String(i) } },
        h('button.lrsh-open', { type: 'button', onclick: () => openPlain(i) },
          h('span.lrsh-title.disp', e.title || 'Untitled'),
          h('span.lrsh-meta', `${dayOf(e.at)} · ${e.tracks} track${e.tracks === 1 ? '' : 's'}`),
          h('span.lrsh-parts', line('shelf.control'))));
    }
    function draw() {
      if (gone) return;
      sayTop();
      boxes.replaceChildren(...records.map(box), ...plain.map(({ e, i }) => plainBox(e, i)));
    }
    async function load() {
      const recs = await db.list();
      const ids = new Set(recs.map((r) => r.id));
      const recent = app.exporter?.recent?.() || [];
      if (gone) return;
      records = recs;
      plain = recent.map((e, i) => ({ e, i })).filter(({ e }) => !ids.has(e.id));
      space = await spaceLine();
      draw();
    }
    load();
    const offShelf = ui.on?.('liveroom:shelf', () => { if (!asking) load(); });
    const open_ = () => !gone && app.liveRoom?.isOpen?.();
    const offs = [ui.keys.add({ key: 'Escape', first: true, when: open_, group: 'Live room', label: 'Back', run: () => { if (asking) { asking = null; draw(); } else back(); } })];
    return {
      frame() {},
      press(id) {
        if (id === 'back') { back(); return { ok: true }; }
        if (id === 'backup') { backup(); return { ok: true }; }
        return false;
      },
      // (for the checks: what the shelf shows, and its actions by record id)
      get records() { return records; },
      unmount() { gone = true; for (const off of offs) off(); if (typeof offShelf === 'function') offShelf(); el.replaceChildren(); },
    };
  },
});
