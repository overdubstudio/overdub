// The live room's checks: the shelf and the tape box [stream F] (docs/research/LIVE-ROOM-MODE.md §2.6, §3.13, §9.6,
// §11.8). Run by tools/liveroom-test.js (ONLY=shelf), whose header says what a checks module exports.
//   1. the tape box in Node: its label and its note from the song, and the same three titles from the dice for the same
//      song (the unit test, test/unit/liveroom-door.test.js, holds the rest)
//   2. the shelf (muted Chromium): a room song's record is written on its autosave (IndexedDB overdub-shelf); two room
//      songs and two Recent songs show as boxes, newest first; the backup is offered once per browser; a box opens its
//      song in the room, with where you left it; Take it off the shelf asks first and deletes only the recordings no
//      other song here uses; a room song whose recordings aren't in this browser says so; navigator.storage.persist()
//      is asked once, at the first kept take; an estimate past 80% gives the space line (both stubbed); the dice name
//      an untitled song in one step by you
import { openRoom, history } from './harness.js';
import { riffDI } from './fake.js';
import { state, until, loadSong } from './checks-door.js';
import { labelOf, titleDice } from '../../app/src/core/liveroom/label.js';
import { createProject } from '../../app/src/core/project.js';

export const name = 'shelf';
export const pages = true;

// A room song at the metal club: the verse doubled (two recordings), the chorus on the left (a third), each recording
// named by id (`shared` is a recording another song uses too)
function roomSong({ id, title = 'Untitled', takes = ['a_' + id + '_1', 'a_' + id + '_2', 'a_' + id + '_3'] }) {
  const p = createProject({ id, title, tempo: 132, key: { root: 'C', scale: 'minor' } });
  const audio = (cid, asset, start, length) => ({ id: cid, kind: 'audio', asset, start, length, offset: 0, gain: 0, by: 'you' });
  p.sections = [{ id: 's_v', name: 'Verse', start: 0, length: 16 }, { id: 's_c', name: 'Chorus', start: 16, length: 16 }, { id: 's_b', name: 'Breakdown', start: 32, length: 16 }];
  p.tracks = [
    { id: 't_gl', name: 'Guitar L', kind: 'audio', instrument: null, inserts: [], clips: [audio('c1', takes[0], 0, 16), audio('c3', takes[2], 16, 16)], gain: 0, pan: -0.8, mute: false, solo: false, arm: false, by: 'you' },
    { id: 't_gr', name: 'Guitar R', kind: 'audio', instrument: null, inserts: [], clips: [audio('c2', takes[1], 0, 16)], gain: 0, pan: 0.8, mute: false, solo: false, arm: false, by: 'you' },
  ];
  p.room = { v: 1, place: 'metal', rig: 'modern', tuning: 'drop-c', finish: 'tight', tracks: { guitarL: 't_gl', guitarR: 't_gr' } };
  return p;
}
const riff = { bpm: 132, beats: 4, chord: true, notes: [[0, 40], [0.5, 40], [1, 43, 0.5], [2, 40], [3, 45, 0.5]] };
const take = (seed) => riffDI(riff, { passes: 2, bpm: 132, seed, peak: -12 }).buf;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the shelf's records as the page's store has them
const records = (s) => s.E(async () => { const db = await import('/app/src/ui/liveroom/shelf-db.js'); return (await db.list()).map((r) => ({ id: r.id, title: r.title, place: r.place, bytes: r.bytes, finished: r.finished, at: r.at })); });
const boxes = (s) => s.E(() => [...document.querySelectorAll('.lrsh-box')].map((b) => ({ id: b.dataset.id || null, recent: b.dataset.recent ?? null, title: b.querySelector('.lrsh-title')?.textContent, slate: b.querySelector('.lrsh-slate')?.textContent || '', parts: b.querySelector('.lrsh-parts')?.textContent || '', note: b.querySelector('.lrsh-note')?.textContent || '', meta: b.querySelector('.lrsh-meta')?.textContent || '', here: !!b.querySelector('.lrsh-here'), dice: [...b.querySelectorAll('.lrsh-name')].map((x) => x.textContent) })));
// (until the shelf's store has, or hasn't, that record: polled from here, since the page's answer is a promise)
async function onShelf(s, id, want = true, ms = 6000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(100)) if ((await records(s)).some((r) => r.id === id) === want) return true;
  return false;
}
const openShelf = async (s) => { await s.E(() => { const lr = window.overdub.liveRoom; if (lr.isOpen() && window.overdub.ui.state.liveRoom.screen === 'shelf') lr.open({ screen: 'stage' }); lr.open({ screen: 'shelf' }); }); await until(s, () => document.querySelectorAll('.lrsh-box').length > 0 || !!document.querySelector('.lrsh-empty')); await sleep(150); };

// navigator.storage as the check wants it: persist() counted, the estimate set by the check
const STORAGE = () => {
  const st = navigator.storage || {};
  window.__lrStore = { persist: 0, usage: 1e6, quota: 1e9 };
  try {
    Object.defineProperty(st, 'persist', { configurable: true, value: async () => { window.__lrStore.persist++; return true; } });
    Object.defineProperty(st, 'persisted', { configurable: true, value: async () => false });
    Object.defineProperty(st, 'estimate', { configurable: true, value: async () => ({ usage: window.__lrStore.usage, quota: window.__lrStore.quota }) });
  } catch { /* fine */ }
};

export async function run(T, ctx) {
  // 1. the tape box, in Node
  const a = roomSong({ id: 'p_box', title: 'Untitled' });
  const L = labelOf(a);
  T.ok(L.title === 'Untitled · 132 · drop C' && L.slate === 'METAL CLUB · DROP C · 132 · C MINOR' && L.parts.join(', ') === 'Verse, Chorus, Breakdown', `the tape box’s label from the song: “${L.title}”, “${L.slate}”, ${L.parts.join(', ')}`);
  T.ok(L.note === 'Verse doubled. Chorus wants its other side. The breakdown’s still empty.', `…and its note from the song: “${L.note}”`);
  const d1 = titleDice(a), d2 = titleDice(roomSong({ id: 'p_box', title: 'Untitled' }));
  T.ok(d1.length === 3 && d1.join() === d2.join(), `the dice give the same three titles for the same song: ${d1.join(' · ')}`);
  if (!ctx.pages) return;

  const s = await openRoom('/app/?room', { name: 'shelf', webdriver: false, init: STORAGE });
  try {
    // a room song with no takes yet: kept, and no storage asked for
    const bare = roomSong({ id: 'p_bare', title: 'Bare Song' });
    bare.tracks.forEach((t) => { t.clips = []; });
    await loadSong(s, { song: bare, assets: {} });
    await onShelf(s, 'p_bare');
    let recs = await records(s);
    T.ok(recs.some((r) => r.id === 'p_bare' && r.place === 'metal' && r.title === 'Bare Song'), `a room song’s record is written on its autosave (${recs.map((r) => r.id).join(', ')})`);
    T.ok((await s.E(() => window.__lrStore.persist)) === 0, 'no storage is asked for before a take is kept');

    // two room songs (one sharing a recording with the other), two Recent songs from the control room
    const A = roomSong({ id: 'p_a', title: 'Void Weather', takes: ['a_shared', 'a_onlyA', 'a_onlyA2'] });
    const B = roomSong({ id: 'p_b', title: 'Untitled', takes: ['a_shared', 'a_onlyB', 'a_onlyB2'] });
    await s.E((songs) => { for (const p of songs) window.overdub.exporter.putAside(p, `${p.title} put aside`); }, [createProject({ id: 'p_c1', title: 'Control One' }), createProject({ id: 'p_c2', title: 'Control Two' })].map((p) => ({ ...p, tracks: [{ id: 't1', name: 'Keys', kind: 'instrument', instrument: { device: 'core.keys', params: {} }, inserts: [], clips: [{ id: 'k1', kind: 'notes', start: 0, length: 4, notes: [{ t: 0, d: 1, p: 60, v: 0.8 }] }], gain: 0, pan: 0 }] })));
    const takes = { a_shared: take(31), a_onlyA: take(32), a_onlyA2: take(33) };
    await loadSong(s, { song: A, assets: takes });
    await onShelf(s, 'p_a');
    T.ok((await s.E(() => window.__lrStore.persist)) === 1, 'navigator.storage.persist() is asked at the first kept take');
    await sleep(50);
    await loadSong(s, { song: B, assets: { a_onlyB: take(34), a_onlyB2: take(35) } });
    await onShelf(s, 'p_b');
    await s.E(() => window.overdub.store.dispatch({ type: 'project.set', patch: { tempo: 133 } }, { by: 'you', label: 'tempo' }));
    await sleep(800);
    T.ok((await s.E(() => window.__lrStore.persist)) === 1, '…and only once');
    recs = await records(s);
    const ra = recs.find((r) => r.id === 'p_a');
    T.ok(ra && ra.bytes === 3 * take(31).length * 4 && !ra.finished, `the record keeps the size of its takes (${ra ? Math.round(ra.bytes / 1e6 * 10) / 10 : '?'} MB) and that it isn’t finished`);

    await openShelf(s);
    const bx = await boxes(s);
    const order = bx.map((b) => b.id || `recent:${b.title}`);
    T.ok(order.join() === 'p_b,p_a,p_bare,recent:Control Two,recent:Control One', `the room songs and two Recent songs show as boxes, newest first (${order.join(', ')})`);
    const boxA = bx.find((b) => b.id === 'p_a'), boxB = bx.find((b) => b.id === 'p_b');
    T.ok(boxA.title === 'Void Weather' && boxA.slate === 'METAL CLUB · DROP C · 132 · C MINOR' && boxA.parts === 'Verse, Chorus, Breakdown' && boxA.note === labelOf(A).note && new RegExp(`^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \\d\\d:\\d\\d · ${Math.round((3 * take(31).length * 4) / 1e6)} MB of takes$`).test(boxA.meta), `a tape box: “${boxA.title}”, ${boxA.slate}, ${boxA.parts}, “${boxA.meta}”, “${boxA.note}”`);
    T.ok(boxB.title === 'Untitled · 133 · drop C' && boxB.here && boxB.dice.join() === titleDice(B).join(), `the untitled box on the stage says so and offers the dice’s three titles (${boxB.dice.join(' · ')})`);
    const plainBox = bx.find((b) => b.recent != null);
    T.ok(plainBox && plainBox.parts === 'made in the control room', `a Recent song is a plain box, made in the control room (“${plainBox?.title}”)`);
    const backup1 = await s.E(() => document.querySelector('.lrsh-backup')?.textContent || '');
    T.ok(/^Kept in this browser\. Back it up as one file, with your recordings\?/.test(backup1), `the first time the shelf opens: “${backup1.slice(0, 64)}…”`);
    await s.shot('liveroom-shelf');

    // the dice name the song on the stage, one step by you
    const before = (await history(s.page)).length;
    await s.page.click('.lrsh-box[data-id="p_b"] .lrsh-die');
    await s.page.click('.lrsh-box[data-id="p_b"] .lrsh-name');
    await until(s, () => window.overdub.store.get().title !== 'Untitled');
    const hst = await history(s.page), named = (await state(s)).title;
    T.ok(named === titleDice(B)[0] && hst.length === before + 1 && hst[hst.length - 1].by === 'you', `a title from the dice names the song, one step by you (“${named}”)`);

    // a box opens its song in the room, with where you left it
    await s.E(() => { window.__lrBack = []; window.overdub.ui.on('liveroom:back', (e) => window.__lrBack.push(e.lines)); });
    await s.page.click('.lrsh-box[data-id="p_a"] .lrsh-open');
    await until(s, () => window.overdub.store.get().id === 'p_a' && window.overdub.ui.state.liveRoom.screen === 'stage' && window.__lrBack.length > 0);
    const st = await state(s);
    const back = await s.E(() => window.__lrBack[0] || []);
    T.ok(st.open && st.screen === 'stage' && st.title === 'Void Weather', `a box opens its song in the room (${st.screen}, “${st.title}”)`);
    T.ok(back[0] === 'Void Weather, where you left it: verse doubled; chorus wants its other side; the breakdown’s still empty.' && back.length === 1, `…and says where you left it: “${back[0]}”`);

    // the second time the shelf opens: no offer, a quiet link
    await openShelf(s);
    const again = await s.E(() => ({ offer: !!document.querySelector('.lrsh-backup'), corner: !!document.querySelector('.lrsh-corner') && getComputedStyle(document.querySelector('.lrsh-corner')).display !== 'none' }));
    T.ok(!again.offer && again.corner, 'the backup is offered once per browser; afterwards a quiet link in the corner');

    // take B off the shelf: its own recordings go, the one A shares stays
    await s.page.click('.lrsh-box[data-id="p_b"] .lrsh-off');
    await until(s, () => !!document.querySelector('.lrsh-ask'));
    const asked = await s.E(() => document.querySelector('.lrsh-ask span')?.textContent || '');
    T.ok(new RegExp(`^Take ${named} off the shelf\\? Its 2 MB of takes go with it, and that can’t be undone\\.$`).test(asked), `Take it off the shelf asks first, plainly: “${asked}”`);
    await s.page.click('.lrsh-off-yes');
    await onShelf(s, 'p_b', false);
    const left = await s.E(async () => { const a = window.overdub.engine.assets; const o = {}; for (const id of ['a_shared', 'a_onlyA', 'a_onlyB', 'a_onlyB2']) o[id] = !!(await a.get(id)); return o; });
    const done = await s.E(() => document.querySelector('.lr-tb-line')?.textContent || '');
    T.ok(left.a_shared && left.a_onlyA && !left.a_onlyB && !left.a_onlyB2, `…and deletes only the recordings no other song here uses (${Object.entries(left).map(([k, v]) => `${k} ${v ? 'kept' : 'gone'}`).join(', ')})`);
    T.ok(/is off the shelf\. 1 recording stays: another song here uses it\.$/.test(done), `…and says so: “${done}”`);
    // (B was in Recent songs too, put there when A replaced it: off the shelf, it doesn't come back as a plain box)
    await until(s, () => !document.querySelector('.lrsh-ask'));
    const after = (await boxes(s)).map((b) => b.id || `recent:${b.title}`);
    const inRecent = await s.E((t) => window.overdub.exporter.recent().some((e) => e.id === 'p_b' || e.title === t), named);
    T.ok(!after.includes('p_b') && !after.some((x) => x === `recent:${named}`) && !inRecent, `…and it’s gone from the shelf and from Recent songs (${after.join(', ')})`);

    // a room song whose recordings aren't in this browser
    const away = roomSong({ id: 'p_away', title: 'Night Haul', takes: ['a_away1', 'a_away2', 'a_away3'] });
    await s.E(async (p) => { const db = await import('/app/src/ui/liveroom/shelf-db.js'); await db.put({ id: p.id, song: p, at: Date.now() + 5000, title: p.title, place: 'metal', finished: false, bytes: 0 }); }, away);
    await openShelf(s);
    await s.E(() => { window.__lrBack = []; });
    await s.page.click('.lrsh-box[data-id="p_away"] .lrsh-open');
    await until(s, () => window.overdub.store.get().id === 'p_away' && window.__lrBack.length > 0 && window.__lrBack[0].length > 1);
    const awayLines = await s.E(() => window.__lrBack[0] || []);
    T.ok(awayLines[1] === 'This song’s recordings are in another browser. The band’s here; your guitar isn’t.', `a room song whose recordings aren’t here says so: “${awayLines[1]}”`);

    // the space line: nothing under 80% of the estimate, the minutes left past it
    await openShelf(s);
    const under = await s.E(() => document.querySelector('.lrsh-space')?.textContent || '');
    await s.E(() => { window.__lrStore.usage = 0.9e9; window.__lrStore.quota = 1e9; });
    await openShelf(s);
    const over = await s.E(() => document.querySelector('.lrsh-space')?.textContent || '');
    T.ok(!under && over === 'This browser has room for about 8 more minutes of takes.', `past 80% of the estimate the shelf says how much is left: “${over}” (under it: “${under}”)`);
    // Send, from the shelf: the box's song, and the send screen on it
    await s.page.click('.lrsh-box[data-id="p_a"] .lrsh-send');
    const sentFrom = await until(s, () => window.overdub.store.get().id === 'p_a' && window.overdub.ui.state.liveRoom.screen === 'send');
    T.ok(sentFrom, `Send on a tape box opens the send screen on its song (${(await state(s)).screen}, “${(await state(s)).title}”)`);
    // the room songs the shelf switched between are in Recent songs too, and give way there first: four more control
    // room songs put aside, and none of the six falls off for them
    const roomInRecent = await s.E(() => JSON.parse(localStorage.getItem('overdub:recent') || '[]').filter((e) => e.song?.room).length);
    await s.E((songs) => { for (const p of songs) window.overdub.exporter.putAside(p, `${p.title} put aside`); }, [3, 4, 5, 6].map((i) => ({ ...createProject({ id: `p_c${i}`, title: `Control ${i}` }), tracks: [{ id: 't1', name: 'Keys', kind: 'instrument', instrument: { device: 'core.keys', params: {} }, inserts: [], clips: [{ id: 'k1', kind: 'notes', start: 0, length: 4, notes: [{ t: 0, d: 1, p: 60, v: 0.8 }] }], gain: 0, pan: 0 }] })));
    const kept = await s.E(() => window.overdub.exporter.recent().map((e) => e.title));
    const control = ['One', 'Two', '3', '4', '5', '6'].map((x) => `Control ${x}`);
    T.ok(roomInRecent > 0 && control.every((t) => kept.includes(t)), `room songs in Recent give way to the control room’s (${roomInRecent} room songs were there; now ${kept.join(', ')})`);
    T.ok(!s.errors.length, `no page errors on the shelf${s.errors.length ? ': ' + s.errors.slice(0, 2).join(' | ') : ''}`);
  } finally { await s.close(); }
}
