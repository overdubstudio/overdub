// The door [ui; stream F] (docs/research/LIVE-ROOM-MODE.md §2.1, §3.1, §3.2): Where are we playing? Four places, each
// a still crop of its room (ui/liveroom/pixels drawCrop) with its kick head, a slate and a line; 1-4 to pick, Enter on
// the focused card, or a tap. Under them the quiet ways out: the control room's own door (a blank song, ui/start.js
// doorOf draws it there) and a song the house made (Boiler Room, playing, in the control room). It adds the 'door'
// screen to the registry (ui/liveroom/screens.js) when it's imported.
//
// Picking a place is one step by you (core/liveroom/plans.js planPlace: the tempo, the role tracks, the finish,
// room.set), then the stage (the kitchen table's own screen for the kitchen). Until then the door leaves nothing in
// History: after a first gesture, a card you hover or focus plays one bar of its band, rendered offline from a song of
// its own (engine/render.js renderProject, never the store), measured (audio/measure.js lufs) and played at about
// −18 LUFS, released when you leave the card. On a phone the kitchen table comes first (a phone is a mic), and the
// electric cards say they need an interface until one shows up.
//
//   previewSong(place) -> a project: one bar of the place's band (exported for the checks, which render and measure it)
//   PREVIEW_LUFS        −18

import { h, css } from '../dom.js';
import { screens } from './screens.js';
import { drawCrop } from './pixels/index.js';
import { planPlace } from '../../core/liveroom/plans.js';
import { setupOf, placeOf, PLACES } from '../../core/liveroom/places.js';
import { bandFor } from '../../core/liveroom/band.js';
import { NAMES } from '../../core/liveroom/model.js';
import { LINES } from '../../core/liveroom/lines/door.js';
import { createProject, cleanProject } from '../../core/project.js';
import { lufs } from '../../audio/measure.js';
import { prefetchKit } from '../kitload.js';

export const PREVIEW_LUFS = -18;
const say = (id, vars) => LINES[id].text(vars || {});
const ORDER = ['metal', 'basement', 'bluesbar', 'kitchen'];
const ELECTRIC = new Set(['metal', 'basement', 'bluesbar']);
const KICK = { metal: 'VOID', basement: 'SUMP PUMP', bluesbar: 'LAST CALL', kitchen: 'COOLER' };
const CROP = { w: 128, h: 72 };
const HOUSE = { id: 'boiler-room', title: 'Boiler Room' };
const phone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
const title = (place) => { const n = NAMES.place[place] || place; return n[0].toUpperCase() + n.slice(1); };
const tempoOf = (place) => { try { return Math.round(setupOf(place).tempo) || placeOf(place).prefer; } catch { return placeOf(place).prefer; } };

/* ------------------------------------------------------------------------------------------------ the preview */
// A track of the place's setup by its role (core/liveroom/places.js setupOf: B's), read loosely: an instrument as
// { device, params }, its chain as inserts. Until the setup has tracks, the prototype's kit and bass.
function setupTrack(setup, role) {
  const t = (Array.isArray(setup?.tracks) ? setup.tracks : []).find((x) => x && (x.role === role || x.id === role));
  if (!t) return null;
  const instrument = t.instrument && t.instrument.device ? t.instrument : t.device ? { device: t.device, params: t.params || {} } : null;
  if (!instrument) return null;
  const inserts = (Array.isArray(t.inserts) ? t.inserts : Array.isArray(t.chain) ? t.chain : []).filter((x) => x && x.device);
  return { instrument, inserts, gain: Number.isFinite(t.gain) ? t.gain : 0, pan: Number.isFinite(t.pan) ? t.pan : 0 };
}
const fx = (list) => list.map((x, i) => ({ id: `fx_door_${i}`, device: x.device, params: { ...(x.params || {}) }, on: x.on !== false, by: 'overdub' }));
const track = (id, name, t, notes, length) => ({
  id, name, kind: 'instrument', instrument: { device: t.instrument.device, params: { ...(t.instrument.params || {}) } }, inserts: fx(t.inserts || []),
  clips: [{ id: `c_${id}`, kind: 'notes', start: 0, length, name, by: 'overdub', notes: notes.map((n, i) => ({ id: `n_${id}_${i}`, t: n.t, d: n.d, p: n.p, v: n.v ?? 0.8, by: 'overdub' })) }],
  gain: t.gain || 0, pan: t.pan || 0, mute: false, solo: false, arm: false, by: 'overdub',
});
// One bar of the place's band, as a song of its own (the door never touches the one you're on).
export function previewSong(place) {
  const bpb = 4;
  if (place === 'kitchen') {
    const tempo = 84;
    const notes = [{ t: 0, p: 36, d: 0.25, v: 0.9 }, { t: 1, p: 38, d: 0.25, v: 0.75 }, { t: 2, p: 36, d: 0.25, v: 0.85 }, { t: 2.5, p: 36, d: 0.25, v: 0.6 }, { t: 3, p: 38, d: 0.25, v: 0.78 }];
    for (let e = 0; e < bpb; e += 0.5) notes.push({ t: e, p: 82, d: 0.2, v: e % 1 ? 0.45 : 0.6 });
    const p = createProject({ id: 'p_door_kitchen', title: 'The kitchen table', tempo, meter: [4, 4] });
    p.tracks = [track('t_door_hands', 'Hand Crate', { instrument: { device: 'core.handkit', params: {} }, inserts: [], gain: 0 }, notes.sort((a, b) => a.t - b.t), bpb)];
    return cleanProject(p);
  }
  const P = PLACES[place] || placeOf(place);
  let setup = null;
  try { setup = setupOf(place); } catch { setup = null; }
  const tempo = Math.round(setup?.tempo || P.prefer);
  // a riff of eighth-note chugs on the place's root, so the drummer has something to lock to and the bass plays
  const root = place === 'metal' ? 0 : 4;
  const riff = { n: bpb, bpm: tempo, root, notes: Array.from({ length: 8 }, (_, i) => ({ t: i / 2, p: 36 + root, d: 0.4 })) };
  const band = bandFor(place, riff, { from: 0, length: bpb, seed: 7 });
  const drums = setupTrack(setup, 'drums') || { instrument: { device: P.drums.kit.device, params: { ...P.drums.kit.params } }, inserts: [], gain: P.gain?.drums ?? 0 };
  const bass = setupTrack(setup, 'bass') || { instrument: { device: 'core.bassguitar', params: { ...(P.bass?.params || {}) } }, inserts: [], gain: P.gain?.bass ?? 0 };
  const p = createProject({ id: `p_door_${place}`, title: title(place), tempo, meter: [4, 4] });
  p.tracks = [track('t_door_drums', 'Drums', drums, band.drums, bpb)];
  if (band.bass.length) p.tracks.push(track('t_door_bass', 'Bass', bass, band.bass, bpb));
  const master = Array.isArray(setup?.master) ? setup.master.filter((x) => x && x.device) : [];
  if (master.length) p.master = { gain: 0, inserts: fx(master) };
  return cleanProject(p);
}

// renders cached per place for the page: { buf, gain } (gain linear, to PREVIEW_LUFS)
const rendered = new Map();
async function renderPreview(app, place) {
  const p = previewSong(place);
  const { renderProject } = await import('../../engine/render.js');
  // (a sampled kit waits for its samples: the metal club's is big, so it's fetched as the render asks for it)
  for (const t of p.tracks) { const def = app.devices?.getDevice?.(t.instrument?.device); if (def) prefetchKit(def).catch(() => {}); }
  const buf = await renderProject(p, { from: 0, to: 4, sr: app.engine.ctx?.sampleRate || 48000, tail: 1.2, assets: app.engine.assets });
  const L = lufs(buf);
  const gainDb = Number.isFinite(L) && L > -70 ? Math.max(-30, Math.min(12, PREVIEW_LUFS - L)) : -120;
  return { buf, gain: Math.pow(10, gainDb / 20), lufs: L };
}
function createPreviews(app) {
  let cur = null, want = null;
  const heard = () => !!app.engine?.ctx && app.engine.ctx.state === 'running' && !app.engine.silent;
  function stop() {
    want = null;
    const c = cur;
    cur = null;
    if (!c) return;
    try { const t = c.ctx.currentTime; c.g.gain.cancelScheduledValues(t); c.g.gain.setValueAtTime(c.g.gain.value, t); c.g.gain.linearRampToValueAtTime(0, t + 0.04); c.src.stop(t + 0.06); } catch { /* gone */ }
  }
  async function play(place) {
    if (!heard() || (cur && cur.place === place) || want === place) return;
    stop();
    want = place;
    let r = rendered.get(place);
    if (!r) { r = renderPreview(app, place).catch((e) => { console.warn('overdub: the door’s preview', place, e); rendered.delete(place); return null; }); rendered.set(place, r); }
    const got = await r;
    if (!got || want !== place || !heard()) return;
    const ctx = app.engine.ctx;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = got.buf;
    g.gain.value = got.gain;
    // (into the speakers' feed the killswitch holds, as everything the studio plays)
    src.connect(g).connect(app.engine._monitor || ctx.destination);
    src.onended = () => { try { g.disconnect(); } catch { /* ok */ } if (cur && cur.src === src) cur = null; };
    src.start();
    cur = { place, ctx, src, g, at: performance.now(), gain: got.gain, lufs: got.lufs };
    app.ui?.emit?.('liveroom:preview', { place, lufs: got.lufs, gain: got.gain });
  }
  const off = app.engine?.on?.('silence', stop);
  return { play, stop, get playing() { return cur ? cur.place : null; }, dispose() { stop(); if (typeof off === 'function') off(); } };
}

/* ------------------------------------------------------------------------------------------------ the screen */
const CSS = `
.lrd { width: min(100%, 1180px); display: flex; flex-direction: column; align-items: center; gap: 18px; }
.lrd-top { width: 100%; display: flex; justify-content: flex-end; min-height: 40px; }
.lrd-cards { width: 100%; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.lrd-card { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 12px; min-width: 0; text-align: left; cursor: pointer;
  background: var(--bg-2); color: var(--text); border: 1px solid var(--line); border-radius: var(--r-press, 2px); font: inherit; }
.lrd-card:hover, .lrd-card:focus-visible { border-color: var(--text-3); background: var(--bg-3); outline: none; }
.lrd-card:focus-visible { box-shadow: 0 0 0 2px var(--accent-2); }
.lrd-crop { width: 256px; max-width: 100%; height: auto; aspect-ratio: 16 / 9; image-rendering: pixelated; display: block; align-self: center; }
.lrd-kick { font: 600 12px/1 var(--font-mono); letter-spacing: .08em; color: var(--text-3); }
.lrd-name { font-size: 22px; line-height: 1.1; }
.lrd-slate { font: 12px/1.35 var(--font-mono); letter-spacing: .04em; color: var(--text-2); }
.lrd-line { font-size: 14px; line-height: 1.4; color: var(--text-2); }
.lrd-iface { font-size: 13px; color: var(--text-3); }
.lrd-num { font: 12px var(--font-mono); color: var(--text-3); }
.lrd-quiet { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.lrd-link { background: none; border: 0; padding: 10px 6px; min-height: 44px; color: var(--text-2); font: inherit; font-size: 15px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--line-2); }
.lrd-link:hover, .lrd-link:focus-visible { color: var(--text); outline: none; text-decoration-color: currentColor; }
.lrd-small { margin: 0; font-size: 13px; color: var(--text-3); }
@media (max-width: 1100px) { .lrd-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .lrd-cards { grid-template-columns: 1fr; } .lrd-num { display: none; } .lrd-card { padding: 12px; } }
`;

// an audio input that isn't the phone's own: a USB interface
async function hasInterface() {
  try {
    const ds = (await navigator.mediaDevices?.enumerateDevices?.()) || [];
    const ins = ds.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
    // (by its name: a phone's own mics and a headset's don't count, and without a name nothing is promised)
    return ins.some((d) => /usb|interface|scarlett|focusrite|irig|audient|motu|presonus|steinberg|behringer|line 6|zoom|apogee|universal audio/i.test(d.label || ''));
  } catch { return false; }
}

screens.add({
  id: 'door',
  mount(el, ctx) {
    const { app, ui, store } = ctx;
    css('liveroom-door', CSS);
    const previews = createPreviews(app);
    const order = phone() ? ['kitchen', 'metal', 'basement', 'bluesbar'] : ORDER;
    let picking = false, gone = false;

    function pick(place) {
      if (picking || gone) return false;
      picking = true;
      previews.stop();
      const p = store.get();
      let plan = null;
      try { plan = planPlace(p, { place, tuning: null }); } catch (e) { console.error('overdub: planPlace', place, e); plan = null; }
      if (plan && Array.isArray(plan.ops) && plan.ops.length) {
        const r = store.dispatch(plan.ops, { by: 'you', label: plan.label || `Into ${NAMES.place[place]}`, reason: plan.reason || `room:place:${place}` });
        if (!r.ok) { picking = false; app.liveRoom?.say?.(`${title(place)} didn’t open: ${r.error}`); return false; }
      }
      try { ctx.prefs.set({ place }); } catch { /* storage: fine */ }
      // (Rusty Sticks is 24 MB: it starts coming now, while you plug in)
      try {
        const setup = place === 'kitchen' ? null : setupOf(place);
        for (const t of setup?.tracks || []) { const id = t?.instrument?.device || t?.device; const def = id && app.devices?.getDevice?.(id); if (def) prefetchKit(def).catch(() => {}); }
      } catch { /* the stage loads it */ }
      app.liveRoom.open({ screen: place === 'kitchen' ? 'kitchen' : 'stage' });
      return true;
    }
    // the control room's own door: a blank song there (the arranger draws ui/start.js doorOf on it)
    async function control() {
      previews.stop();
      const blank = store.get().tracks.every((t) => !(t.clips || []).length);
      if (!blank && app.exporter?.newSong) await app.exporter.newSong();
      app.liveRoom.close();
    }
    // a song the house made, playing in the control room
    async function house() {
      previews.stop();
      if (!app.exporter?.openDemo) return;
      await app.exporter.openDemo(HOUSE.id);
      app.liveRoom.close();
      try { await app.engine.start?.(); await app.engine.play(0); } catch (e) { console.warn('overdub: playing the house’s song', e); }
    }

    const shelfKey = h('button.btn.btn-txt.lrd-shelf', { type: 'button', hidden: true, style: { display: 'none' }, onclick: () => app.liveRoom.open({ screen: 'shelf' }) }, 'Shelf');
    const cards = order.map((place, i) => {
      const crop = h('canvas.lrd-crop', { width: CROP.w, height: CROP.h, 'aria-hidden': 'true' });
      try { const g = crop.getContext('2d'); if (g) { g.imageSmoothingEnabled = false; drawCrop(g, place, CROP); } } catch (e) { console.warn('overdub: the door’s crop', place, e); }
      const iface = ELECTRIC.has(place) && phone() ? h('span.lrd-iface', say('door.phone.iface')) : null;
      const slate = say(`door.slate.${place}`, { bpm: tempoOf(place) });
      const card = h('button.lrd-card', {
        type: 'button', dataset: { place },
        'aria-label': `${title(place)}. ${slate}. ${say(`door.card.${place}`)}`,
        onclick: () => pick(place),
        onpointerenter: () => previews.play(place), onpointerleave: () => previews.stop(),
        onfocus: () => previews.play(place), onblur: () => previews.stop(),
      },
      crop,
      h('span.lrd-kick', { 'aria-hidden': 'true' }, KICK[place]),
      h('span.lrd-name.disp', title(place)),
      h('span.lrd-slate', slate),
      h('span.lrd-line', say(`door.card.${place}`)),
      iface,
      h('kbd.lrd-num', { 'aria-hidden': 'true' }, String(i + 1)));
      card._iface = iface;
      return card;
    });
    const root = h('div.lrd',
      h('div.lrd-top', shelfKey),
      h('h1.lr-h.disp', say('door.ask')),
      h('div.lrd-cards', { role: 'group', 'aria-label': say('door.ask') }, cards),
      h('div.lrd-quiet',
        h('button.lrd-link.lrd-nogtr', { type: 'button', onclick: control }, say('door.nogtr')),
        h('button.lrd-link.lrd-house', { type: 'button', onclick: house }, say('door.house', { title: HOUSE.title })),
        h('p.lrd-small', say('door.local'))));
    el.append(root);

    // the shelf key, once there's a song on it (the room's, or the control room's Recent songs)
    (async () => {
      let n = 0;
      try { const db = await import('./shelf-db.js'); n = (await db.list()).length; } catch { n = 0; }
      if (!n) n = app.exporter?.recent?.().length || 0;
      if (!gone) { shelfKey.hidden = !n; shelfKey.style.display = n ? '' : 'none'; }
    })();
    // on a phone: the electric cards' line goes once an interface shows up
    let offDev = null;
    if (phone() && navigator.mediaDevices?.addEventListener) {
      const check = async () => { const yes = await hasInterface(); for (const c of cards) if (c._iface) c._iface.hidden = yes; };
      check();
      navigator.mediaDevices.addEventListener('devicechange', check);
      offDev = () => navigator.mediaDevices.removeEventListener('devicechange', check);
    }

    // 1-4 pick the cards in the order they're shown
    const offs = [];
    const open = () => !gone && app.liveRoom?.isOpen?.();
    for (let i = 0; i < order.length; i++) {
      for (const key of [`Digit${i + 1}`, `Numpad${i + 1}`]) {
        offs.push(ui.keys.add({ key, first: true, when: open, group: 'Live room', label: `Play ${NAMES.place[order[i]]}`, hidden: key.startsWith('Numpad'), run: () => pick(order[i]) }));
      }
    }
    // (focus on the first card, so Enter picks it and arrows move along)
    setTimeout(() => { if (!gone && open() && !el.contains(document.activeElement)) cards[0].focus({ preventScroll: true }); }, 0);
    root.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const i = cards.indexOf(/** @type {any} */ (document.activeElement));
      if (i < 0) return;
      e.preventDefault();
      const j = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? cards.length - 1 : 1)) % cards.length;
      cards[j].focus();
    });

    return {
      frame() {},
      press(id) {
        const pl = typeof id === 'string' && id.startsWith('place:') ? id.slice(6) : id;
        if (ORDER.includes(pl)) return pick(pl) ? { ok: true } : { ok: false, error: `${title(pl)} didn’t open.` };
        if (pl !== id) return { ok: false, error: `There’s no place called ${pl}.` };
        if (id === 'shelf') { app.liveRoom.open({ screen: 'shelf' }); return { ok: true }; }
        if (id === 'house') { house(); return { ok: true }; }
        if (id === 'nogtr') { control(); return { ok: true }; }
        return false;
      },
      unmount() {
        gone = true;
        previews.dispose();
        for (const off of offs) off();
        offDev?.();
        el.replaceChildren();
      },
    };
  },
});
