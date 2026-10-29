// The guitar room's checks: the riff library and the stack rack, on IndexedDB [guitar room] (docs/research/GUITAR-ROOM.md
// §2.4, §2.9, §4.3). Run by tools/liveroom-test.js (ONLY=library), whose header says what a checks module exports. What
// a riff and a stack are, and both stores' memory side, are test/unit/guitar-library.test.js's; this is the browser's.
//   1. in Node: the house's stacks put on a track and read back are the same chain (core/liveroom/stacks.js)
//   2. the library (muted Chromium, on a bare page of the studio's server): kept on disk with no note; a riff's audio
//      comes back sample for sample and its peaks as bytes; 2,000 riffs listed a page at a time, every filter and both
//      orders paged through with the token and equal to the pure reference (core/liveroom/riffs.js pageOf), a search
//      through all of them and the facets, each timed; a listing never opens the audio store; a song named retags its
//      riffs; rename, star, a confirmed key; remove and restore; a full disk keeps the riff in memory, says so, and the
//      listing merges it in order; into a song puts the audio in the page's asset store and the ops go in and undo
//      exactly; everything is still there after a reload
//   3. the rack: save, list, rename, load (ops for the song only: the rack as it was), remove and restore, kept across a
//      reload
//   4. IndexedDB refused (a private window): both stores keep the visit's in memory and say so; no page errors anywhere
import { open } from '../pw.js';
import { houseStacks, loadOps, stackOf } from '../../app/src/core/liveroom/stacks.js';
import { createStore } from '../../app/src/core/store.js';

export const name = 'library';
export const pages = true;

const N = 2000;

// (in the page) 2,000 riffs, deterministic: 40 songs (every 40th untitled), three tunings, tempos 90..169, every 25th
// starred, a second apart, named Riff 1 to Riff 2000 (every seventh a Chug, one Needle). Returns the rows add() gave
// back, and how long the writes took.
const FILL = async (n) => {
  const riffs = await import('/app/src/ui/liveroom/riffs-db.js');
  const tiny = { sr: 48000, channels: [new Float32Array(480)] };
  const rows = [];
  const t0 = performance.now();
  for (let i = 0; i < n; i += 50) {
    const batch = [];
    for (let j = i; j < Math.min(n, i + 50); j++) {
      batch.push(riffs.add({
        audio: tiny, tempo: 90 + (j % 80), beats: 4, name: j === 1234 ? 'Needle' : j % 7 ? 'Riff ' + (j + 1) : 'Chug ' + j,
        tuning: ['standard', 'drop-c', 'drop-b'][j % 3],
        song: { id: 'p_' + (j % 40), title: j % 40 ? 'Song ' + (j % 40) : 'Untitled' },
        starred: j % 25 === 0, at: 2e12 + j * 1000,
      }));
    }
    for (const r of await Promise.all(batch)) { if (!r.ok) throw new Error(r.error); rows.push(r.row); }
  }
  window.__rows = rows;
  return { n: rows.length, ms: performance.now() - t0, disk: rows.length && (await riffs.where()) };
};

export async function run(T, ctx) {
  // 1. in Node
  {
    const store = createStore();
    const r = store.dispatch([{ type: 'track.add', ref: 'g', track: { name: 'Guitar L', kind: 'audio' } }, { type: 'insert.add', track: '$g', insert: { device: 'core.eq8' } }]);
    const h = houseStacks('metal')[0];
    store.dispatch(loadOps(store.track(r.created.g), h).ops, { by: 'you' });
    const back = stackOf(store.track(r.created.g));
    T.ok(back && JSON.stringify(back.chain) === JSON.stringify(h.chain), `a house stack put on a track reads back as the same chain (${h.name}, ${h.chain.length} piece${h.chain.length === 1 ? '' : 's'}, before the guitar's EQ)`);
  }
  if (!ctx.pages) return;

  // 2. the library, on disk
  let s = await open('/');
  try {
    const E = (fn, arg) => s.page.evaluate(fn, arg);
    const start = await E(async () => {
      const riffs = await import('/app/src/ui/liveroom/riffs-db.js');
      const sr = 48000, x = new Float32Array(sr * 2);
      for (let i = 0; i < x.length; i++) x[i] = 0.6 * Math.sin((2 * Math.PI * 82.41 * i) / sr) * Math.exp(-i / x.length);
      const chain = [{ device: 'pedal.gate', params: { thresh: -50 }, on: true }, { device: 'core.stack', params: { gain: 6.5, boost: 'ON' }, on: true }];
      const r = await riffs.add({ audio: { sr, channels: [x] }, tempo: 132, beats: 4, tuning: 'drop-c', key: { root: 'C', scale: 'minor' }, stack: { name: 'Floor', chain }, song: { id: 'p_mine', title: 'Untitled' }, name: 'First' });
      const a = await riffs.audio(r.id);
      let same = a.channels[0].length === x.length;
      for (let i = 0; same && i < x.length; i++) if (a.channels[0][i] !== x[i]) same = false;
      const g = await riffs.get(r.id);
      const b = await riffs.buffer(r.id);
      same = same && b.length === x.length && b.sampleRate === sr && b.getChannelData(0)[1000] === x[1000];
      window.__first = r.id;
      return { where: await riffs.where(), note: riffs.note(), ok: r.ok, rw: r.where, same, peaks: g.peaks instanceof Int8Array && g.peaks.length === 512, chain: g.chain && g.chain.length, key: g.key, title: g.songTitle };
    });
    T.ok(start.where === 'disk' && start.note === null && start.ok && start.rw === 'disk', `riffs are kept on disk (IndexedDB overdub-riffs), with nothing to say about it (${start.where}, ${start.note})`);
    T.ok(start.same && start.peaks, 'a riff’s audio comes back sample for sample (and as an AudioBuffer for a preview), its peaks as 512 bytes');
    T.ok(start.chain === 2 && start.key && start.key.sure === false && start.title === null, `it keeps the chain it went through, its key unconfirmed, and no song title while the song is untitled (${JSON.stringify(start.key)})`);

    const fill = await E(FILL, N);
    T.ok(fill.n === N && fill.disk === 'disk', `${N.toLocaleString('en')} riffs kept (${(fill.ms / 1000).toFixed(1)} s, 50 at a time)`);

    // a listing never opens the audio store: every objectStore() call counted by name while the listings run
    const timed = await E(async () => {
      const riffs = await import('/app/src/ui/liveroom/riffs-db.js');
      const touched = new Set();
      const orig = IDBTransaction.prototype.objectStore;
      IDBTransaction.prototype.objectStore = function (n) { touched.add(n); return orig.call(this, n); };
      const time = async (f) => { const t0 = performance.now(); const out = await f(); return [out, performance.now() - t0]; };
      try {
        const [page, tPage] = await time(() => riffs.list({ limit: 50 }));
        const [hit, tSearch] = await time(() => riffs.list({ q: 'needle' }));
        const [miss, tMiss] = await time(() => riffs.list({ q: 'nothing like this' }));
        const [f, tFacets] = await time(() => riffs.facets());
        const [song, tSong] = await time(() => riffs.list({ song: 'p_7', limit: 50 }));
        const [u, tUsage] = await time(() => riffs.usage());
        return { page: page.rows.length, next: !!page.next, first: page.rows[0] && page.rows[0].name, hit: hit.rows.map((r) => r.name), miss: miss.rows.length, total: f.total, songs: f.songs.length, tunings: f.tunings.map((t) => t.id + ':' + t.count), starred: f.starred, untitled: f.songs[f.songs.length - 1], song: song.rows.length, usage: u, t: { tPage, tSearch, tMiss, tFacets, tSong, tUsage }, touched: [...touched].sort() };
      } finally { IDBTransaction.prototype.objectStore = orig; }
    });
    const ms = (x) => x.toFixed(0) + ' ms';
    T.ok(timed.page === 50 && timed.next && timed.first === 'Riff 2000', `the first page: 50 riffs, the newest first (“${timed.first}”), and a token for the next, in ${ms(timed.t.tPage)}`);
    T.ok(timed.t.tPage < 250, `…under 250 ms with ${N.toLocaleString('en')} riffs kept (${ms(timed.t.tPage)})`);
    T.ok(timed.hit.join() === 'Needle' && timed.miss === 0, `a search reads through all of them: “needle” finds one in ${ms(timed.t.tSearch)}, a search for nothing ends in ${ms(timed.t.tMiss)}`);
    T.ok(timed.t.tMiss < 1500, `…a search through every riff under 1.5 s (${ms(timed.t.tMiss)})`);
    T.ok(timed.total === N + 1 && timed.songs === 41 && timed.tunings.length === 3 && timed.starred === 80 && timed.untitled && timed.untitled.title === null, `the facets: ${timed.total} riffs, ${timed.songs} songs (the untitled last), tunings ${timed.tunings.join(' ')}, ${timed.starred} starred, in ${ms(timed.t.tFacets)}`);
    T.ok(timed.t.tFacets < 1500, `…under 1.5 s (${ms(timed.t.tFacets)})`);
    T.ok(timed.song === 50 && timed.t.tSong < 250, `a song’s riffs through its index, a page in ${ms(timed.t.tSong)}`);
    T.ok(timed.usage.count === N + 1 && timed.usage.bytes === N * 480 * 4 + 2 * 48000 * 4, `usage counted from the index alone: ${timed.usage.count} riffs, ${(timed.usage.bytes / 1e6).toFixed(2)} MB (${ms(timed.t.tUsage)})`);
    T.ok(!timed.touched.includes('audio') && !timed.touched.includes('details'), `listing, searching, the facets and usage read only the rows (stores opened: ${timed.touched.join(', ')})`);

    // every filter, both orders, paged through with the token, equal to the pure reference over the same rows
    const cmp = await E(async () => {
      const riffs = await import('/app/src/ui/liveroom/riffs-db.js');
      const { pageOf } = await import('/app/src/core/liveroom/riffs.js');
      const first = await riffs.get(window.__first);
      const all = [...window.__rows, first];
      const FILTERS = [
        {}, { order: 'old' }, { song: 'p_7' }, { song: 'p_7', order: 'old' }, { starred: true }, { tuning: 'drop-b' },
        { tempo: [100, 110] }, { q: 'chug' }, { q: 'song 3' }, { from: 2e12 + 500e3, to: 2e12 + 900e3 },
        { song: 'p_3', tuning: 'standard', tempo: [90, 130], from: 2e12, to: 2e12 + 1500e3 }, { starred: true, order: 'old', q: 'song' },
        { song: '' },
      ];
      const out = [];
      for (const f of FILTERS) {
        const got = [];
        let next = null, pages = 0;
        do { const p = await riffs.list({ ...f, limit: 37, after: next }); got.push(...p.rows.map((r) => r.id)); next = p.next; pages++; } while (next && pages < 200);
        const want = pageOf(all, { ...f, limit: 500 }).rows.map((r) => r.id);
        const want2 = want.length === 500 ? pageOf(all, { ...f, limit: 500, after: JSON.stringify([all.find((r) => r.id === want[499]).rat, want[499]]) }) : null;
        const wantAll = want2 ? want.concat(want2.rows.map((r) => r.id)) : want;
        // (pageOf caps a page at 500; the reference reads it to the end)
        let rest = want2 && want2.next, guard = 0;
        while (rest && guard++ < 10) { const p = pageOf(all, { ...f, limit: 500, after: rest }); wantAll.push(...p.rows.map((r) => r.id)); rest = p.next; }
        out.push({ f: JSON.stringify(f), n: got.length, same: got.length === wantAll.length && got.every((id, i) => id === wantAll[i]), pages });
      }
      return out;
    });
    const bad = cmp.filter((c) => !c.same);
    T.ok(!bad.length, `${cmp.length} filters and orders, paged 37 at a time, give exactly the pure reference’s riffs in its order (${cmp.map((c) => c.n).join(', ')})${bad.length ? ': ' + bad.map((c) => `${c.f} (${c.n})`).join('; ') : ''}`);

    // changes
    const ch = await E(async () => {
      const riffs = await import('/app/src/ui/liveroom/riffs-db.js');
      const id = window.__first;
      const tagged = await riffs.tagSong('p_mine', 'Grave Pull');
      const found = (await riffs.list({ q: 'grave pull' })).rows.map((r) => r.id);
      const ren = await riffs.rename(id, 'Gallop');
      const st = await riffs.star(id);
      const key = await riffs.update(id, { key: { root: 'C', scale: 'phrygian' }, notes: 'for the bridge' });
      const bad = await riffs.update(id, { tempo: 1 });
      const starred = (await riffs.list({ starred: true, order: 'old', limit: 1 })).rows[0];
      const whole = await riffs.remove(id);
      const gone = await riffs.get(id);
      const back = await riffs.restore(whole);
      const again = await riffs.get(id);
      const au = await riffs.audio(id);
      return { tagged, found: found.length === 1 && found[0] === id, ren: ren.ok && ren.row.name, st: st.row.starred, key: key.row.key, notes: key.row.notes, bad: bad.ok, starred: starred && starred.id === id, removed: !!whole && !!whole.audio, gone, back: back.ok, again: again && again.name, at: again && again.at === whole.row.at, au: au && au.channels[0].length };
    });
    T.ok(ch.tagged === 1 && ch.found, `a song that gets a name retags its riffs (${ch.tagged}), and a search finds them by it`);
    T.ok(ch.ren === 'Gallop' && ch.st === 1 && ch.key.sure === true && ch.key.scale === 'phrygian' && ch.notes === 'for the bridge' && ch.bad === false && ch.starred, 'rename, star, notes and a confirmed key; a change to anything else is refused; the starred index has it (the oldest starred)');
    T.ok(ch.removed && ch.gone === null && ch.back && ch.again === 'Gallop' && ch.at && ch.au === 96000, 'remove gives the whole riff back (audio and all), and restore puts it back as it was, time and all');

    // a full disk: the riff stays in memory, says so, and the listing merges it in its place
    const fullDisk = await E(async () => {
      const riffs = await import('/app/src/ui/liveroom/riffs-db.js');
      const orig = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...a) { if (this.name === 'audio') throw new DOMException('full', 'QuotaExceededError'); return orig.apply(this, a); };
      let r;
      try { r = await riffs.add({ audio: { sr: 48000, channels: [new Float32Array(4800)] }, tempo: 120, beats: 1, name: 'Overflow', at: 2e12 + 1500.5 * 1000 }); } finally { IDBObjectStore.prototype.put = orig; }
      const page = await riffs.list({ limit: 1000, from: 2e12 + 1499e3, to: 2e12 + 1502e3 });
      const total = await riffs.count();
      // (nothing of it reached the disk: the row never lands without its audio)
      const db = await new Promise((res) => { const q = indexedDB.open('overdub-riffs'); q.onsuccess = () => res(q.result); });
      const onDisk = await new Promise((res) => { const q = db.transaction('riffs').objectStore('riffs').get(r.id); q.onsuccess = () => res(!!q.result); });
      db.close();
      return { ok: r.ok, where: r.where, note: r.note, names: page.rows.map((x) => x.name), total, onDisk, audio: !!(await riffs.audio(r.id)) };
    });
    T.ok(fullDisk.ok && fullDisk.where === 'memory' && /disk here is full/.test(fullDisk.note || '') && !fullDisk.onDisk && fullDisk.audio, `a full disk: the riff stays in memory, nothing half-written, and add says so (“${fullDisk.note}”)`);
    T.ok(fullDisk.names.join() === 'Riff 1503,Riff 1502,Overflow,Riff 1501,Riff 1500' && fullDisk.total === N + 2, `…and the listing merges it in its place (${fullDisk.names.join(', ')})`);

    // into a song: the page's asset store, and the ops through a store
    const into = await E(async () => {
      const riffs = await import('/app/src/ui/liveroom/riffs-db.js');
      const { createStore } = await import('/app/src/core/store.js');
      const { assets } = await import('/app/src/engine/assets.js');
      const store = createStore();
      store.dispatch({ type: 'project.set', patch: { tempo: 132 } });
      const t = store.dispatch({ type: 'track.add', ref: 'g', track: { name: 'Guitar L', kind: 'audio' } }).created.g;
      const before = JSON.stringify(store.get().tracks) + JSON.stringify(store.get().assets);
      const r = await riffs.intoSong(window.__first, { project: store.get(), track: t, start: 16 });
      const d = store.dispatch(r.ops, { by: 'you', label: 'Gallop into the bridge' });
      const clip = store.get().tracks[0].clips[0];
      const buf = await assets.get(r.asset.id);
      store.undo();
      const after = JSON.stringify(store.get().tracks) + JSON.stringify(store.get().assets);
      return { ok: r.ok && d.ok, ops: r.ops.map((o) => o.type), clip: clip && [clip.asset === r.asset.id, clip.start, clip.length], buf: buf && buf.length, fits: r.fits, chain: r.chain && r.chain.length, undone: before === after };
    });
    T.ok(into.ok && into.ops.join() === 'asset.add,clip.add' && into.clip && into.clip.join() === 'true,16,4' && into.fits && into.chain === 2, `into a song: asset.add and clip.add (bar 5, 4 beats at the riff’s tempo), with the chain it went through (${into.ops.join(', ')})`);
    T.ok(into.buf === 96000 && into.undone, 'the audio is in the page’s asset store, sample count and all, and undo takes the part out exactly');

    // the rack
    const rk = await E(async () => {
      const rack = await import('/app/src/ui/liveroom/rack-db.js');
      const chain = [{ device: 'pedal.gate', params: { thresh: -50 }, on: true }, { device: 'core.stack', params: { gain: 6.5 }, on: true }];
      const a = await rack.save({ name: 'Modern wall', chain }, { song: { id: 'p_mine', title: 'Grave Pull' } });
      const b = await rack.save({ name: 'Thrash floor', chain: [chain[1]] });
      const ren = await rack.rename(a.id, 'Wall');
      const track = { id: 't_g', inserts: [{ id: 'fx_1', device: 'amp.plexi', on: true, params: {} }, { id: 'fx_2', device: 'core.eq8', on: true, params: {} }] };
      const L = await rack.load(a.id, track);
      L.ops[1].insert.params.thresh = -10; // (the song's copy, edited: the rack's is its own)
      const still = await rack.get(a.id);
      const gone = await rack.remove(b.id);
      const back = await rack.restore(gone);
      window.__rack = [a.id, b.id];
      return { where: await rack.where(), note: rack.note(), ok: a.ok && b.ok && ren.ok, list: (await rack.list()).map((x) => x.name), ops: L.ops.map((o) => o.type + (o.index != null ? '@' + o.index : '')), by: L.by, thresh: still.chain[0].params.thresh, back: back.ok };
    });
    T.ok(rk.where === 'disk' && rk.note === null && rk.ok && rk.list.join() === 'Wall,Thrash floor' && rk.back, `the rack keeps stacks on disk (IndexedDB overdub-rack): save, rename, list (the last changed first: ${rk.list.join(', ')}), remove and restore`);
    T.ok(rk.ops.join() === 'insert.remove,insert.add@0,insert.add@1' && rk.by === 'you' && rk.thresh === -50, `load gives the song’s ops by you, in place of the old amp (${rk.ops.join(', ')}), and the rack’s stack is as it was saved`);

    // a change the disk wouldn't take, then a delete: the stack is gone, the old one doesn't come back; and a song's
    // title in the filter menu is its newest riff's (before tagSong reaches the older ones)
    const edge = await E(async () => {
      const rack = await import('/app/src/ui/liveroom/rack-db.js');
      const riffs = await import('/app/src/ui/liveroom/riffs-db.js');
      const s = await rack.save([{ device: 'core.stack', params: { gain: 4 }, on: true }], { name: 'Spare' });
      const orig = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () { throw new DOMException('full', 'QuotaExceededError'); };
      let ren;
      try { ren = await rack.rename(s.id, 'Spare 2'); } finally { IDBObjectStore.prototype.put = orig; }
      const named = (await rack.get(s.id)).name;
      await rack.remove(s.id);
      const left = (await rack.list()).map((x) => x.id).includes(s.id);
      const tiny = { sr: 48000, channels: [new Float32Array(480)] };
      await riffs.add({ id: 'rf_aaaaa1', audio: tiny, tempo: 120, song: { id: 'p_late', title: 'Untitled' }, at: 2e12 + 5000e3 });
      await riffs.add({ id: 'rf_zzzzz1', audio: tiny, tempo: 120, song: { id: 'p_late', title: 'Late Song' }, at: 2e12 + 5001e3 });
      const title = (await riffs.facets()).songs.find((x) => x.id === 'p_late');
      await riffs.remove('rf_aaaaa1'); await riffs.remove('rf_zzzzz1');
      return { ren: ren.ok, named, left, title: title && title.title };
    });
    T.ok(edge.ren && edge.named === 'Spare 2' && !edge.left, `a rename the disk wouldn't take, then a delete: the stack is gone and its old self doesn't come back (${edge.left ? 'it came back' : 'gone'})`);
    T.ok(edge.title === 'Late Song', `a song's title in the filter menu is its newest riff's (“${edge.title}”)`);

    // a reload: all of it is still there
    await s.page.reload({ waitUntil: 'load' });
    const kept = await E(async () => {
      const riffs = await import('/app/src/ui/liveroom/riffs-db.js');
      const rack = await import('/app/src/ui/liveroom/rack-db.js');
      return { count: await riffs.count(), first: (await riffs.list({ q: 'gallop' })).rows.map((r) => r.name), rack: (await rack.list()).length };
    });
    T.ok(kept.count === N + 1 && kept.first.join() === 'Gallop' && kept.rack === 2, `after a reload: ${kept.count} riffs (the full disk’s one was the visit’s), Gallop among them, and the rack’s ${kept.rack} stacks`);
    T.ok(!s.errors.length, `no page errors${s.errors.length ? ': ' + s.errors.slice(0, 3).join(' | ') : ''}`);
  } finally { await s.close(); }

  // 4. IndexedDB refused
  s = await open('/', { init: () => { try { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); } catch { /* fine */ } } });
  try {
    const refused = await s.page.evaluate(async () => {
      const riffs = await import('/app/src/ui/liveroom/riffs-db.js');
      const rack = await import('/app/src/ui/liveroom/rack-db.js');
      const r = await riffs.add({ audio: { sr: 48000, channels: [new Float32Array(4800)] }, tempo: 120, beats: 1 });
      const k = await rack.save([{ device: 'core.stack', params: {}, on: true }]);
      return { rw: await riffs.where(), rn: riffs.note(), ok: r.ok, at: r.where, listed: (await riffs.list()).rows.length, kw: await rack.where(), kn: rack.note(), kok: k.ok, kl: (await rack.list()).length };
    });
    T.ok(refused.rw === 'memory' && refused.ok && refused.at === 'memory' && refused.listed === 1 && /won’t keep riffs/.test(refused.rn), `IndexedDB refused: riffs are the visit’s, and the library says so (“${refused.rn}”)`);
    T.ok(refused.kw === 'memory' && refused.kok && refused.kl === 1 && /won’t keep the rack/.test(refused.kn), `…and the rack too (“${refused.kn}”)`);
    T.ok(!s.errors.length, `no page errors${s.errors.length ? ': ' + s.errors.slice(0, 3).join(' | ') : ''}`);
  } finally { await s.close(); }
}
