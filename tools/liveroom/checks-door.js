// The live room's checks: the door and sending [stream F] (docs/research/LIVE-ROOM-MODE.md §2.1, §3.1, §3.14, §11.8).
// Run by tools/liveroom-test.js (ONLY=door), whose header says what a checks module exports.
//   1. the door's previews in Node: one bar of each place's band renders through the canonical renderer to a level the
//      door can bring to about −18 LUFS (needs B for the real band: until places.js setupOf has tracks, it's the
//      prototype's kit and bass)
//   2. the front door (muted Chromium, navigator.webdriver read as false, as a visitor's browser has it): a first visit
//      to bare /app/ shows the door and #studio is never visible before the room mounts; the four cards, their crops,
//      slates and lines; a preview only after a gesture, and nothing in History from it; 1-4 picks a place (one step by
//      you) and the stage comes up; coming back after the room opens the room, with where you left it; after the
//      control room, the control room; ?studio, ?demo and a share link open the control room; the control room's New
//      song opens the door; No guitar? and Hear one the house made go through the glass; a phone puts the kitchen
//      first and says what the electric cards need
//   3. under navigator.webdriver, bare /app/ and ?new open today's first screens, and ?room still opens the room
//   4. Send a mix: a 16-bit 48 kHz WAV from the first sound to the end of the tail, muted tracks out, within 0.1 LU of
//      the canonical render; the share sheet when navigator.canShare says yes (stubbed), else a download
//   5. Send the song: the zip holds the song and its recordings as 32-bit float WAVs; opened with ⌘O in a fresh browser
//      context it puts every recording back bit for bit and opens the room
// The stage, its planPlace and the pixels are other streams' (C, E): where a check needs planPlace to make a room, a
// stand-in plans.js is served in its place for that page (STAND_IN_PLANS, below), never by editing C's file.
import crypto from 'node:crypto';
import { openRoom, history } from './harness.js';
import { riffDI, SR } from './fake.js';
import { previewSong, PREVIEW_LUFS } from '../../app/src/ui/liveroom/door.js';
import '../../app/src/devices/builtin/index.js';
import { renderSong } from '../../app/src/engine/node/render.js';
import { lufs } from '../../app/src/audio/measure.js';
import { releaseTrim, unzip, SONG_ZIP } from '../../app/src/ui/export.js';
import { encodeShare } from '../../app/src/core/share.js';
import { createProject } from '../../app/src/core/project.js';

export const name = 'door';
export const pages = true;

/* ------------------------------------------------------------------------------------------------ shared with checks-shelf */
// A stand-in for stream C's planPlace (core/liveroom/plans.js), served in its place: the tempo, two guitar tracks and
// room.set, one step. needs C: the real one makes the place's whole setup.
export const STAND_IN_PLANS = `
const none = () => ({ ops: [], label: '', reason: '' });
const TEMPO = { metal: 132, basement: 172, bluesbar: 96, kitchen: 84 };
export function planPlace(p, { place = 'metal' } = {}) {
  return { label: 'Into ' + place, reason: 'room:place:' + place, ops: [
    { type: 'project.set', patch: { tempo: TEMPO[place] || 120 } },
    { type: 'track.add', ref: 'gl', track: { name: 'Guitar L', kind: 'audio' } },
    { type: 'track.add', ref: 'gr', track: { name: 'Guitar R', kind: 'audio' } },
    { type: 'room.set', patch: { place, tracks: { guitarL: '$gl', guitarR: '$gr' } } },
  ] };
}
export function takeOps() { return none(); }
export function planLayout() { return none(); }
export function planTwice() { return none(); }
export function planMove() { return none(); }
export function planShorter() { return none(); }
export function planRemove() { return none(); }
export function planEnd() { return none(); }
`;
export async function standIn(context) {
  await context.route('**/src/core/liveroom/plans.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: STAND_IN_PLANS }));
}
// this origin's storage emptied, as a browser that has never been here (the page then navigates)
export async function forget(s) {
  await s.E(async () => {
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* fine */ }
    for (const n of ['overdub-shelf', 'overdub-assets', 'overdub-capture']) await new Promise((r) => { try { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = () => r(); } catch { r(); } });
  });
}
export async function go(s, route) {
  await s.page.goto(s.base + route, { waitUntil: 'load' });
  await s.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await s.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
export const state = (s) => s.E(() => {
  const o = window.overdub, st = document.getElementById('studio');
  return { open: !!o.liveRoom?.isOpen?.(), screen: o.ui.state.liveRoom?.screen || null, opened: o.opened, door: o.door, title: o.store.get().title, room: o.store.get().room || null,
    tracks: o.store.get().tracks.length, studioVisible: !!st && getComputedStyle(st).visibility !== 'hidden', dataRoom: 'room' in document.documentElement.dataset, talk: document.querySelector('.lr-tb-line')?.textContent || '' };
});
export const until = async (s, fn, arg, ms = 15000) => { try { await s.page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };

// A song to send: drums and bass on kernels (so the canonical renderer plays every device), a loud keys track muted
// (it must not be in the mix), and two guitar takes (fake.js riffDI, a DI riff as an interface brings it in), with a
// room at the metal club. -> { song, assets: { id: Float32Array } }
export function sendSong() {
  const riff = { bpm: 120, beats: 4, chord: true, notes: [[0, 40], [0.5, 40], [1, 43, 0.5], [2, 40], [2.5, 40], [3, 45, 0.5]] };
  const take1 = riffDI(riff, { passes: 4, bpm: 120, seed: 21, peak: -12 }).buf;
  const take2 = riffDI(riff, { passes: 4, bpm: 120, seed: 22, peak: -12 }).buf;
  const n = (t, p, d = 0.25, v = 0.8) => ({ t, p, d, v });
  const drums = [], bass = [], keys = [];
  for (let b = 0; b < 32; b += 1) { drums.push(n(b, b % 2 ? 38 : 36, 0.25, 0.9)); drums.push(n(b + 0.5, 42, 0.2, 0.6)); }
  for (let b = 0; b < 32; b += 0.5) bass.push(n(b, b < 16 ? 40 : 45, 0.45, 0.85));
  for (let b = 0; b < 32; b += 2) for (const p of [60, 64, 67, 71]) keys.push(n(b, p, 1.9, 1));
  const clip = (id, start, length, notes) => ({ id, kind: 'notes', start, length, notes, by: 'overdub' });
  const audio = (id, asset, start, length) => ({ id, kind: 'audio', asset, start, length, offset: 0, gain: 0, by: 'you' });
  const p = createProject({ id: 'p_send', title: 'Void Weather', tempo: 120, key: { root: 'C', scale: 'minor' } });
  p.sections = [{ id: 's_v', name: 'Verse', start: 0, length: 16 }, { id: 's_c', name: 'Chorus', start: 16, length: 16 }];
  p.tracks = [
    { id: 't_drums', name: 'Drums', kind: 'instrument', instrument: { device: 'core.drums', params: { kit: 0 } }, inserts: [], clips: [clip('c_d', 0, 32, drums)], gain: -6, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' },
    { id: 't_bass', name: 'Bass', kind: 'instrument', instrument: { device: 'core.bass', params: {} }, inserts: [], clips: [clip('c_b', 0, 32, bass)], gain: -8, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' },
    { id: 't_keys', name: 'Keys', kind: 'instrument', instrument: { device: 'core.keys', params: {} }, inserts: [], clips: [clip('c_k', 0, 32, keys)], gain: 6, pan: 0, mute: true, solo: false, arm: false, by: 'overdub' },
    { id: 't_gl', name: 'Guitar L', kind: 'audio', instrument: null, inserts: [], clips: [audio('c_gl', 'a_send1', 0, 16)], gain: 0, pan: -0.8, mute: false, solo: false, arm: false, by: 'you' },
    { id: 't_gr', name: 'Guitar R', kind: 'audio', instrument: null, inserts: [], clips: [audio('c_gr', 'a_send2', 0, 16)], gain: 0, pan: 0.8, mute: false, solo: false, arm: false, by: 'you' },
  ];
  p.assets = { a_send1: { kind: 'audio', name: 'Take 1', sr: SR, channels: 1, duration: take1.length / SR }, a_send2: { kind: 'audio', name: 'Take 2', sr: SR, channels: 1, duration: take2.length / SR } };
  p.room = { v: 1, place: 'metal', rig: 'modern', tuning: 'drop-c', finish: 'tight', tracks: { guitarL: 't_gl', guitarR: 't_gr', drums: 't_drums', bass: 't_bass' } };
  return { song: p, assets: { a_send1: take1, a_send2: take2 } };
}
const b64 = (f32) => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString('base64');
const sha = (f32) => crypto.createHash('sha256').update(Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength)).digest('hex');
// the song and its recordings into the page: the samples into the asset store, then the song loaded (by you)
export async function loadSong(s, { song, assets }) {
  return s.E(async ({ song, assets }) => {
    const o = window.overdub;
    for (const [id, data] of Object.entries(assets)) {
      const bin = atob(data), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      await o.engine.assets.put(id, { sr: 48000, channels: [new Float32Array(u8.buffer)] });
    }
    o.store.load(song, { by: 'you' });
    return o.store.get().id;
  }, { song, assets: Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, b64(v)])) });
}
// what the page saves as a file: every Blob handed to URL.createObjectURL, read back as base64 (newest last)
export async function catchFiles(s) {
  await s.E(() => {
    if (window.__lrFiles) return;
    window.__lrFiles = [];
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { if (b instanceof Blob) window.__lrFiles.push(b); return make(b); };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__lrNames = window.__lrNames || []; window.__lrNames.push(this.download); return; } return click.call(this); };
  });
}
export async function lastFile(s) {
  const r = await s.E(async () => {
    const b = window.__lrFiles?.[window.__lrFiles.length - 1];
    if (!b) return null;
    const u8 = new Uint8Array(await b.arrayBuffer());
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return { type: b.type, b64: btoa(bin), name: (window.__lrNames || []).slice(-1)[0] || null, n: window.__lrFiles.length };
  });
  return r ? { ...r, bytes: new Uint8Array(Buffer.from(r.b64, 'base64')) } : null;
}
// a WAV's header and samples (PCM 16/24, float 32)
export function readWavBytes(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), tag = (o) => String.fromCharCode(...u8.subarray(o, o + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let fmt = null, data = null;
  for (let o = 12; o + 8 <= u8.length;) {
    const id = tag(o), size = dv.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { format: dv.getUint16(o + 8, true), nch: dv.getUint16(o + 10, true), sr: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true) };
    if (id === 'data') data = { at: o + 8, size };
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) return null;
  const bps = fmt.bits / 8, len = Math.floor(data.size / (bps * fmt.nch)), channels = Array.from({ length: fmt.nch }, () => new Float32Array(len));
  for (let i = 0, o = data.at; i < len; i++) for (let c = 0; c < fmt.nch; c++, o += bps) {
    if (fmt.format === 3) channels[c][i] = dv.getFloat32(o, true);
    else if (fmt.bits === 16) { const v = dv.getInt16(o, true); channels[c][i] = v < 0 ? v / 32768 : v / 32767; }
  }
  return { ...fmt, sampleRate: fmt.sr, channels, length: len };
}

/* ------------------------------------------------------------------------------------------------ the checks */
export async function run(T, ctx) {
  // 1. the previews, by the canonical renderer
  if (ctx.levels) {
    for (const place of ['metal', 'basement', 'bluesbar', 'kitchen']) {
      const p = previewSong(place);
      let L = -Infinity, err = '';
      try { const r = renderSong(p, { from: 0, to: 4, sr: SR, tail: 1.2 }); L = lufs({ sampleRate: r.sr, channels: r.channels }); } catch (e) { err = e.message; }
      const gain = PREVIEW_LUFS - L;
      // needs B: the band of setupOf's tracks (until then the prototype's kit and bass)
      T.ok(Number.isFinite(L) && L > -60 && gain >= -30 && gain <= 12, `the door’s preview of ${place}: one bar renders at ${Number.isFinite(L) ? L.toFixed(1) : err || 'silence'} LUFS, brought to ${PREVIEW_LUFS} by ${gain.toFixed(1)} dB`);
    }
  }
  if (!ctx.pages) return;
  await frontDoor(T, ctx);
  await webdriverDoors(T);
  await sending(T, ctx);
}

// a visitor's browser: frames watched from the first one, so a studio painted before the room is caught
const WATCH = () => {
  const log = (window.__lrFlash = { roomUp: null, bad: 0, frames: 0 });
  const tick = () => {
    const st = document.getElementById('studio');
    const room = document.querySelector('section.lr:not([hidden]) .lr-screen');
    if (room && log.roomUp == null) log.roomUp = performance.now();
    if (log.roomUp == null && st && st.childElementCount && getComputedStyle(st).visibility !== 'hidden' && st.getBoundingClientRect().height > 0) log.bad++;
    if (++log.frames < 3000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function frontDoor(T, ctx) {
  const s = await openRoom('/app/', { webdriver: false, init: WATCH, name: 'door' });
  try {
    // a first visit
    let st = await state(s);
    const flash = await s.E(() => window.__lrFlash);
    T.ok(st.open && st.screen === 'door' && st.door.side === 'room' && st.door.song === 'new' && st.opened === 'new', `a first visit to bare /app/ opens the door on a new song (${st.screen}, ${JSON.stringify(st.door)})`);
    T.ok(flash.roomUp != null && flash.bad === 0, `#studio is never visible before the room mounts (${flash.bad} frames with the studio showing first, ${flash.frames} watched)`);
    T.ok(!st.dataRoom, 'the room cleared data-room once its screen was up');
    const cards = await s.E(() => [...document.querySelectorAll('.lrd-card')].map((c) => {
      const cv = c.querySelector('canvas'), g = cv.getContext('2d'), px = g.getImageData(0, 0, cv.width, cv.height).data;
      let lit = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i]) lit++;
      return { place: c.dataset.place, name: c.querySelector('.lrd-name')?.textContent, slate: c.querySelector('.lrd-slate')?.textContent, line: c.querySelector('.lrd-line')?.textContent, kick: c.querySelector('.lrd-kick')?.textContent, lit, w: cv.width, h: cv.height };
    }));
    T.ok(cards.map((c) => c.place).join() === 'metal,basement,bluesbar,kitchen', `four places, in order: ${cards.map((c) => c.place).join(', ')}`);
    T.ok(cards.every((c) => c.lit > c.w * c.h * 0.5), `each card draws its room’s crop (${cards.map((c) => `${c.place} ${c.lit}/${c.w * c.h}`).join(', ')})`); // needs E for the kitchen's own room
    T.ok(cards[0].slate === 'ELECTRIC · 132 · TWO STACKS AND A BIG KIT' && cards[0].kick === 'VOID' && /kick locks to your chugs/.test(cards[0].line) && cards[3].slate === 'ACOUSTIC AND VOICE · YOUR TEMPO', `the cards’ slates, kick heads and lines (“${cards[0].slate}”, ${cards.map((c) => c.kick).join(', ')})`);
    const quiet = await s.E(() => [...document.querySelectorAll('.lrd-quiet button, .lrd-quiet p')].map((x) => x.textContent));
    T.ok(quiet.join(' | ') === 'No guitar? Hum, tap or play keys in the control room. | Hear one the house made: Boiler Room. | Your takes stay in this browser.', `the quiet links under the cards: ${quiet.join(' | ')}`);
    await s.shot('liveroom-door');

    // previews: nothing before a gesture; after one, a bar of the band, and nothing in History
    await s.E(() => { window.__lrPrev = []; window.overdub.ui.on('liveroom:preview', (e) => window.__lrPrev.push(e)); });
    await s.page.hover('.lrd-card[data-place="basement"]');
    await new Promise((r) => setTimeout(r, 400));
    T.ok((await s.E(() => window.__lrPrev.length)) === 0, 'before a gesture, hovering a card plays nothing');
    await s.page.mouse.click(700, 830);
    await until(s, () => window.overdub.engine.ctx?.state === 'running');
    await s.page.hover('.lrd-card[data-place="bluesbar"]');
    await s.page.hover('.lrd-card[data-place="basement"]');
    const heard = await until(s, () => window.__lrPrev.some((e) => e.place === 'basement'), null, 30000);
    const prev = await s.E(() => window.__lrPrev.find((e) => e.place === 'basement'));
    T.ok(heard && Number.isFinite(prev.lufs) && Math.abs(prev.lufs + 20 * Math.log10(prev.gain) - (-18)) < 0.05, `after a gesture, hovering the basement plays a bar of its band, measured at ${prev ? prev.lufs.toFixed(1) : '?'} LUFS and played at about −18`);
    await s.page.mouse.move(700, 880);
    T.ok((await history(s.page)).length === 0, 'the door’s previews leave nothing in History');

    // 1-4 picks (planPlace stood in: needs C)
    await standIn(s.context);
    await forget(s);
    await go(s, '/app/');
    await s.page.keyboard.press('Digit1');
    await until(s, () => window.overdub.ui.state.liveRoom.screen === 'stage');
    st = await state(s);
    const hist = await history(s.page);
    T.ok(st.screen === 'stage' && st.room?.place === 'metal' && hist.length === 1 && hist[0].by === 'you' && /metal/.test(hist[0].label), `1 picks the metal club: one step by you (“${hist[0]?.label}”), and the stage comes up`);
    // coming back after the room: the room, with where you left it
    await new Promise((r) => setTimeout(r, 900));
    await go(s, '/app/');
    await until(s, () => /where you left it/.test(document.querySelector('.lr-tb-line')?.textContent || ''), null, 8000);
    st = await state(s);
    T.ok(st.open && st.screen === 'stage' && st.door.side === 'room' && st.door.song === 'saved' && st.room?.place === 'metal', `coming back after the room opens the room on the saved song (${JSON.stringify(st.door)})`);
    T.ok(/^Untitled · 132, where you left it: nothing on tape yet\.$/.test(st.talk), `…and says where you left it: “${st.talk}”`);
    // after the control room: the control room
    await s.E(() => window.overdub.liveRoom.close());
    await go(s, '/app/');
    st = await state(s);
    T.ok(!st.open && st.studioVisible && st.door.side === 'control' && st.door.song === 'saved' && st.room?.place === 'metal', `coming back after the control room opens the control room (${JSON.stringify(st.door)})`);
    // a reload at the door (no place picked yet) comes back to the door
    await forget(s);
    await go(s, '/app/');
    await s.E(() => window.overdub.store.dispatch({ type: 'project.set', patch: { tempo: 121 } }, { by: 'you', label: 'tempo' }));
    await new Promise((r) => setTimeout(r, 900));
    await go(s, '/app/');
    st = await state(s);
    T.ok(st.open && st.screen === 'door', `a reload at the door, before a place is picked, comes back to the door (${st.screen})`);

    // ?studio, ?demo, a share link: the control room
    await go(s, '/app/?studio');
    st = await state(s);
    T.ok(!st.open && st.opened === 'new' && st.door.side === 'control' && st.studioVisible, `?studio opens a new song in the control room (${JSON.stringify(st.door)})`);
    await go(s, '/app/?demo=lido');
    st = await state(s);
    T.ok(!st.open && st.door.side === 'control' && st.door.song === 'demo' && st.tracks > 0, `?demo opens the demo in the control room (“${st.title}”)`);
    const enc = await encodeShare(createProject({ id: 'p_link', title: 'Their Song', tempo: 100 }));
    await go(s, '/app/?studio#s=x');
    await go(s, '/app/' + enc.hash);
    st = await state(s);
    T.ok(enc.ok && !st.open && st.door.song === 'shared' && st.title === 'Their Song', `a share link opens the control room’s listener, never the room (“${st.title}”)`);

    // the control room's New song: the door, on a blank song already made
    await go(s, '/app/?studio');
    await s.E(() => window.overdub.store.dispatch({ type: 'project.set', patch: { title: 'Kept Song' } }, { by: 'you', label: 'name' }));
    await s.page.click('.sm-btn');
    await s.page.click('.sm-new');
    await s.page.click('.sm-confirm .ew-btn-primary');
    await until(s, () => window.overdub.ui.state.liveRoom.screen === 'door' && window.overdub.liveRoom.isOpen());
    st = await state(s);
    T.ok(st.open && st.screen === 'door' && st.title === 'Untitled' && st.tracks === 0, `the control room’s New song opens the door on a blank song (${st.screen}, “${st.title}”)`);
    // No guitar? the control room's own door
    await s.page.click('.lrd-nogtr');
    await until(s, () => !window.overdub.liveRoom.isOpen());
    st = await state(s);
    const startDoor = await s.E(() => !!document.querySelector('.st-door'));
    T.ok(!st.open && st.tracks === 0 && startDoor, `No guitar? goes through the glass to the control room’s own door on the blank song (start door: ${startDoor})`);
    // Hear one the house made: Boiler Room, playing, in the control room
    await s.E(() => window.overdub.liveRoom.open({ screen: 'door' }));
    await s.page.click('.lrd-house');
    await until(s, () => window.overdub.store.get().title === 'Boiler Room' && window.overdub.engine.playing && !window.overdub.liveRoom.isOpen(), null, 20000);
    st = await state(s);
    const playing = await s.E(() => { const p = window.overdub.engine.playing; window.overdub.engine.stop(); return p; });
    T.ok(!st.open && st.title === 'Boiler Room' && playing, `Hear one the house made opens Boiler Room in the control room, playing (“${st.title}”)`);

    // a phone: the kitchen first, and the electric cards say what they need
    await s.page.setViewportSize({ width: 390, height: 844 });
    await s.E(() => window.overdub.liveRoom.open({ screen: 'door' }));
    await until(s, () => !!document.querySelector('.lrd-card'));
    const ph = await s.E(() => ({ order: [...document.querySelectorAll('.lrd-card')].map((c) => c.dataset.place), iface: [...document.querySelectorAll('.lrd-iface')].filter((x) => !x.hidden).length, wide: document.documentElement.scrollWidth - innerWidth, small: [...document.querySelectorAll('.lr *')].filter((x) => x.childElementCount === 0 && x.textContent.trim() && x.checkVisibility?.() && parseFloat(getComputedStyle(x).fontSize) < 12).length }));
    T.ok(ph.order[0] === 'kitchen' && ph.iface === 3, `on a phone the kitchen table comes first (${ph.order.join(', ')}) and the electric cards say they need an interface (${ph.iface})`);
    T.ok(ph.wide <= 0 && ph.small === 0, `the door on a phone: no sideways scroll (${ph.wide} px over), no text under 12 px (${ph.small})`);
    await s.shot('liveroom-door-phone');
    T.ok(!s.errors.length, `no page errors at the door${s.errors.length ? ': ' + s.errors.slice(0, 2).join(' | ') : ''}`);
  } finally { await s.close(); }
}

// navigator.webdriver: every other suite's first screens, and ?room the room's own door
async function webdriverDoors(T) {
  const s = await openRoom('/app/', { name: 'door-wd' });
  try {
    let st = await state(s);
    T.ok(!st.open && st.studioVisible && st.door.side === 'control' && st.opened === 'demo', `under navigator.webdriver, bare /app/ opens today’s first screen (the demo, “${st.title}”)`);
    await go(s, '/app/?new');
    st = await state(s);
    T.ok(!st.open && st.opened === 'new' && st.door.side === 'control', `under navigator.webdriver, ?new opens a new song in the control room (${JSON.stringify(st.door)})`);
    await go(s, '/app/?room');
    st = await state(s);
    T.ok(st.open && st.screen === 'door', `under navigator.webdriver, ?room still opens the room (${st.screen})`);
    T.ok(!s.errors.length, `no page errors under navigator.webdriver${s.errors.length ? ': ' + s.errors.slice(0, 2).join(' | ') : ''}`);
  } finally { await s.close(); }
}

async function sending(T, ctx) {
  const fixture = sendSong();
  const s = await openRoom('/app/?room', { name: 'send' });
  let zip = null;
  try {
    await loadSong(s, fixture);
    await catchFiles(s);
    // Send a mix, saved (no share sheet)
    await s.E(() => { window.__lrShared = null; navigator.canShare = () => false; });
    const mix = await s.E(async () => { const m = await import('/app/src/ui/liveroom/send.js'); return m.sendMix(window.overdub); });
    const f = await lastFile(s);
    const wav = f && readWavBytes(f.bytes);
    T.ok(mix.ok && mix.via === 'download' && f && f.type === 'audio/wav' && f.name === 'Void Weather.wav', `Send a mix with no share sheet saves “${f?.name}” (${mix.via})`);
    T.ok(wav && wav.format === 1 && wav.bits === 16 && wav.sr === 48000 && wav.nch === 2, `…a 16-bit 48 kHz stereo WAV (${wav ? `${wav.bits}-bit, ${wav.sr} Hz, ${wav.nch} ch` : 'unreadable'})`);
    // the canonical render: the same song, its recordings, from the first sound to the tail
    if (wav && ctx.levels) {
      const r = renderSong(fixture.song, { sr: 48000, tail: 6, assets: Object.fromEntries(Object.entries(fixture.assets).map(([k, v]) => [k, { sr: SR, channels: [v] }])) });
      const cut = releaseTrim({ sampleRate: r.sr, channels: r.channels });
      const Lnode = lufs(cut), Lmix = lufs(wav);
      const withKeys = renderSong({ ...fixture.song, tracks: fixture.song.tracks.map((t) => ({ ...t, mute: false })) }, { sr: 48000, tail: 6, assets: Object.fromEntries(Object.entries(fixture.assets).map(([k, v]) => [k, { sr: SR, channels: [v] }])) });
      const Lkeys = lufs(releaseTrim({ sampleRate: withKeys.sr, channels: withKeys.channels }));
      const dLen = Math.abs(wav.length - cut.channels[0].length) / 48000;
      T.ok(Math.abs(Lmix - Lnode) <= 0.1, `…within 0.1 LU of the canonical render (${Lmix.toFixed(2)} against ${Lnode.toFixed(2)} LUFS)`);
      T.ok(dLen < 0.05 && Lkeys - Lnode > 1, `…from the first sound to the end of the tail (${(wav.length / 48000).toFixed(2)} s against ${(cut.channels[0].length / 48000).toFixed(2)} s), the muted keys left out (with them ${Lkeys.toFixed(1)} LUFS)`);
    }
    // Send a mix through the share sheet
    await s.E(() => { navigator.canShare = (d) => !!(d && d.files && d.files.length); navigator.share = async (d) => { window.__lrShared = { n: d.files.length, name: d.files[0].name, type: d.files[0].type, size: d.files[0].size }; }; });
    const shared = await s.E(async () => { const m = await import('/app/src/ui/liveroom/send.js'); const r = await m.sendMix(window.overdub); return { r, sh: window.__lrShared, files: window.__lrFiles.length }; });
    T.ok(shared.r.ok && shared.r.via === 'share' && shared.sh?.name === 'Void Weather.wav' && shared.sh.type === 'audio/wav' && shared.files === 1, `where navigator.canShare takes the file, Send a mix goes through the share sheet (${shared.sh?.name}, ${shared.sh?.size} bytes) and saves nothing`);
    const said = await s.E(() => document.querySelector('.lr-tb-line')?.textContent || '');
    T.ok(/^Sent “Void Weather\.wav”: 0:\d\d, \d+ MB\. It’s the mix; the takes stay in this browser\.$/.test(said), `…and says what it sent: “${said}”`);

    // Send the song: the song and its recordings, 32-bit float
    const sent = await s.E(async () => { const m = await import('/app/src/ui/liveroom/send.js'); return m.sendSong(window.overdub); });
    const z = await lastFile(s);
    zip = z?.bytes || null;
    let files = [];
    try { files = zip ? await unzip(zip) : []; } catch (e) { T.note('unzip: ' + e.message); }
    const song = files.find((x) => x.name === SONG_ZIP.song);
    const recs = files.filter((x) => x.name.startsWith(SONG_ZIP.dir));
    const back = recs.map((x) => ({ id: decodeURIComponent(x.name.slice(SONG_ZIP.dir.length, -4)), w: readWavBytes(x.data) }));
    const exact = back.length === 2 && back.every(({ id, w }) => w && w.format === 3 && w.bits === 32 && w.sr === SR && sha(w.channels[0]) === sha(fixture.assets[id]));
    T.ok(sent.ok && z?.name === 'Void Weather.overdub.zip' && song && JSON.parse(new TextDecoder().decode(song.data)).id === 'p_send', `Send the song saves “${z?.name}” with the song in it (${files.map((x) => x.name).join(', ')})`);
    T.ok(exact, `…and its recordings as 32-bit float WAVs, sample for sample (${back.map(({ id, w }) => `${id} ${w ? `${w.bits}-bit format ${w.format}` : '?'}`).join(', ')})`);
    T.ok(!s.errors.length, `no page errors sending${s.errors.length ? ': ' + s.errors.slice(0, 2).join(' | ') : ''}`);
  } finally { await s.close(); }

  // ⌘O of the zip in a fresh browser context (a visitor's: the door first), every recording back and the room open
  if (!zip) { T.ok(false, 'Send the song made a zip to open'); return; }
  const t = await openRoom('/app/', { webdriver: false, name: 'send-open' });
  try {
    const before = await state(t);
    const chooser = t.page.waitForEvent('filechooser', { timeout: 10000 });
    await t.page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyO' : 'Control+KeyO');
    const fc = await chooser;
    await fc.setFiles({ name: 'Void Weather.overdub.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
    await until(t, () => window.overdub.store.get().id === 'p_send' && window.overdub.ui.state.liveRoom.screen === 'stage', null, 20000);
    const st = await state(t);
    const got = await t.E(async () => {
      const out = {};
      for (const id of ['a_send1', 'a_send2']) {
        const b = await window.overdub.engine.assets.get(id);
        if (!b) { out[id] = null; continue; }
        const d = b.getChannelData(0);
        const h = await crypto.subtle.digest('SHA-256', new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice());
        out[id] = [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
      }
      return out;
    });
    T.ok(before.screen === 'door' && st.open && st.screen === 'stage' && st.room?.place === 'metal', `⌘O of the zip in a fresh browser opens the song in the room (${before.screen} → ${st.screen})`);
    T.ok(got.a_send1 === sha(fixture.assets.a_send1) && got.a_send2 === sha(fixture.assets.a_send2), `…with every recording back in this browser, bit for bit (${Object.entries(got).map(([k, v]) => `${k} ${v ? v.slice(0, 8) : 'missing'}`).join(', ')})`);
    T.ok(!t.errors.length, `no page errors opening the zip${t.errors.length ? ': ' + t.errors.slice(0, 2).join(' | ') : ''}`);
  } finally { await t.close(); }
}
