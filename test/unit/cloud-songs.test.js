// agent/cloud.js's song methods and agent/cloud-songs.js: the requests the studio makes for songs in an Overdub
// account, which song on screen is linked to which, and the saver that keeps a linked song saved there (5 s after a
// change, never over a newer save).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloud, CloudError } from '../../app/src/agent/cloud.js';
import {
  songLinks,
  songBases,
  docStamp,
  songAssets,
  savedAgo,
  jsonBytes,
  createSaver,
} from '../../app/src/agent/cloud-songs.js';

const API = 'https://api.example.com';

/** A service that answers each path from `routes` ({ 'GET /v1/songs': body | (req) => [status, body] }) and logs. */
function service(routes) {
  const log = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const req = {
      method: init.method,
      path: u.pathname,
      query: u.search,
      headers: init.headers || {},
      body: init.body ? JSON.parse(init.body) : undefined,
      credentials: init.credentials,
    };
    log.push(req);
    const r = routes[`${req.method} ${decodeURIComponent(req.path)}`];
    const [status, body] = typeof r === 'function' ? r(req) : Array.isArray(r) ? r : [200, r ?? {}];
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, log };
}
const row = (o = {}) => ({
  songId: 'sng_1',
  title: 'Night Ride',
  rev: 1,
  savedAt: 1000,
  createdAt: 1000,
  bytes: 10,
  tracks: 2,
  assets: [],
  pid: 'p_1',
  ...o,
});

/* ---------------------------------------------------------------- the client */
test('songs are on only when GET /v1/config names them, with their limits', async () => {
  for (const [config, want] of [
    [{}, null],
    [{ songs: { enabled: false, maxBytes: 1 } }, null],
    [{ songs: { enabled: true, maxBytes: 8000000, maxSongs: 200 } }, { maxBytes: 8000000, maxSongs: 200 }],
  ]) {
    const s = service({ 'GET /v1/config': config, 'GET /v1/me': [401, {}] });
    const c = createCloud({ api: API, fetch: s.fetch, win: {} });
    assert.equal(c.songs, null, 'nothing before the config is read');
    await c.load();
    assert.deepEqual(c.songs, want);
  }
});

test('listSongs, getSong, songRevs, createSong, saveSong, deleteSong: the contract, with the session cookie', async () => {
  const s = service({
    'GET /v1/songs': { songs: [row(), { nope: 1 }], canSave: true, max: 200 },
    'GET /v1/songs/sng 1': { song: row(), doc: { format: 'overdub/0', tracks: [] } },
    'GET /v1/songs/sng 1/revs': { revs: [{ rev: 1, savedAt: 1, bytes: 2 }] },
    'POST /v1/songs': [201, { song: row() }],
    'POST /v1/songs/sng 1': { song: row({ rev: 2 }) },
    'DELETE /v1/songs/sng 1': { deleted: true },
  });
  const c = createCloud({ api: API, fetch: s.fetch, win: {} });
  const doc = { id: 'p_1', format: 'overdub/0', title: 'Night Ride', tracks: [] };

  assert.deepEqual(
    await c.listSongs(),
    { songs: [row()], canSave: true, max: 200 },
    'rows without a songId are dropped',
  );
  assert.equal((await c.getSong('sng 1')).doc.format, 'overdub/0');
  await c.getSong('sng 1', 3);
  assert.deepEqual(await c.songRevs('sng 1'), [{ rev: 1, savedAt: 1, bytes: 2 }]);
  assert.deepEqual(await c.createSong(doc), row());
  assert.deepEqual(await c.saveSong('sng 1', doc, 1), row({ rev: 2 }));
  assert.deepEqual(await c.deleteSong('sng 1'), { deleted: true });

  const seen = s.log.map((r) => `${r.method} ${r.path}${r.query}`);
  assert.deepEqual(seen, [
    'GET /v1/songs',
    'GET /v1/songs/sng%201',
    'GET /v1/songs/sng%201?rev=3',
    'GET /v1/songs/sng%201/revs',
    'POST /v1/songs',
    'POST /v1/songs/sng%201',
    'DELETE /v1/songs/sng%201',
  ]);
  assert.ok(
    s.log.every((r) => r.credentials === 'include'),
    'every request carries the cookie',
  );
  const [create, save] = s.log.filter((r) => r.method === 'POST');
  assert.deepEqual(create.body, { doc });
  // (no Idempotency-Key: CORS lets no new header through, and the core reads only 64 KB of a body for it)
  assert.equal(create.headers['idempotency-key'], undefined, 'no Idempotency-Key header on a create');
  assert.deepEqual(save.body, { doc, baseRev: 1 });
  assert.equal(save.headers['idempotency-key'], undefined);
});

test('createSong and saveSong carry their nonce in the body (createId, saveId), never in a header', async () => {
  const s = service({ 'POST /v1/songs': [201, { song: row() }], 'POST /v1/songs/sng_1': { song: row({ rev: 2 }) } });
  const c = createCloud({ api: API, fetch: s.fetch, win: {} });
  const doc = { id: 'p_1', format: 'overdub/0', tracks: [] };
  await c.createSong(doc, 'create_abc123');
  await c.saveSong('sng_1', doc, 1, 'save_abc123');
  const [create, save] = s.log;
  assert.deepEqual(create.body, { doc, createId: 'create_abc123' });
  assert.deepEqual(save.body, { doc, baseRev: 1, saveId: 'save_abc123' });
  for (const r of s.log)
    assert.deepEqual(Object.keys(r.headers), ['content-type'], 'only content-type: CORS allows no other');
});

test('a save over a newer one is a CloudError song_conflict carrying the newer row', async () => {
  const current = row({ rev: 4, title: 'Night Ride (laptop)' });
  const s = service({
    'POST /v1/songs/sng_1': [409, { error: { code: 'song_conflict', message: 'newer', current } }],
    'POST /v1/songs': [403, { error: { code: 'songs_need_plus', message: 'Cloud saves come with Plus.' } }],
  });
  const c = createCloud({ api: API, fetch: s.fetch, win: {} });
  await assert.rejects(c.saveSong('sng_1', { tracks: [] }, 2), (e) => {
    assert.ok(e instanceof CloudError);
    assert.equal(e.status, 409);
    assert.equal(e.code, 'song_conflict');
    assert.deepEqual(e.details.current, current);
    return true;
  });
  await assert.rejects(c.createSong({ tracks: [] }), { code: 'songs_need_plus', status: 403 });
});

/* ---------------------------------------------------------------- the link */
function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

test('the link: a project id to a song in the account, kept in overdub:cloud-song', () => {
  const st = memStorage();
  const links = songLinks(st);
  assert.equal(links.get('u1', 'p_1'), null);
  links.set('u1', 'p_1', { songId: 'sng_1', rev: 2, savedAt: 5 });
  links.set('u1', 'p_2', { songId: 'sng_1', rev: 1, savedAt: 6 });
  links.set('u1', 'p_3', { songId: 'sng_2', rev: 1, savedAt: 7 });
  assert.deepEqual(songLinks(st).get('u1', 'p_1'), { songId: 'sng_1', rev: 2, savedAt: 5 }, 'another reader sees it');
  assert.equal(links.dropSong('u1', 'sng_1'), 2, 'a deleted song unlinks every song here linked to it');
  assert.equal(links.get('u1', 'p_2'), null);
  links.drop('u1', 'p_3');
  assert.deepEqual(JSON.parse(st.map.get('overdub:cloud-song')), {});
});

test('the link is per account: another account neither sees nor drops it', () => {
  const links = songLinks(memStorage());
  links.set('u1', 'p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  assert.equal(links.get('u2', 'p_1'), null, 'account B: this song is not linked');
  assert.equal(links.get('', 'p_1'), null, 'nobody signed in: no link');
  links.set('u2', 'p_1', { songId: 'sng_9', rev: 1, savedAt: 2 });
  assert.equal(links.dropSong('u2', 'sng_1'), 0, "B can't drop A's song");
  links.drop('u2', 'p_1');
  assert.deepEqual(links.get('u1', 'p_1'), { songId: 'sng_1', rev: 1, savedAt: 1 }, "A's link stays");
});

test('bases: the save each copy of a song stands on, by account and by the copy as it is', () => {
  const st = memStorage();
  const bases = songBases(st);
  const a = { id: 'p_1', meta: { modified: '2026-10-18T10:00:00.000Z' } };
  const b = { id: 'p_1', meta: { modified: '2026-10-18T10:05:00.000Z' } };
  bases.set('u1', a, { songId: 'sng_1', rev: 1 }, { kept: true });
  bases.set('u1', b, { songId: 'sng_1', rev: 3 });
  assert.deepEqual(
    songBases(st).get('u1', a),
    { songId: 'sng_1', rev: 1 },
    'two copies of one project id keep their own',
  );
  assert.deepEqual(bases.get('u1', docStamp(b)), { songId: 'sng_1', rev: 3 });
  assert.equal(bases.get('u2', a), null, 'per account');
  assert.deepEqual(bases.forStamp(docStamp(a)), [['u1', { songId: 'sng_1', rev: 1 }]]);
  bases.unset('u1', docStamp(a));
  assert.ok(bases.get('u1', a), 'a copy put aside is never unset as a passing state');
  bases.dropSong('u1', 'sng_1');
  assert.equal(bases.get('u1', b), null);
});

test('the link survives unreadable or blocked storage', () => {
  const junk = songLinks(memStorage({ 'overdub:cloud-song': '{nope' }));
  assert.equal(junk.get('u1', 'p_1'), null);
  const bad = songLinks(memStorage({ 'overdub:cloud-song': JSON.stringify({ 'u1 p_1': { songId: 3 } }) }));
  assert.equal(bad.get('u1', 'p_1'), null, 'a malformed entry is no link');
  const blocked = songLinks({
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  });
  assert.doesNotThrow(() => blocked.set('u1', 'p_1', { songId: 'sng_1', rev: 1, savedAt: 1 }));
  assert.equal(songLinks(null).get('u1', 'p_1'), null);
});

/* ---------------------------------------------------------------- recordings and times */
test("songAssets: a song's recordings, from its clips, its asset table and its reference, once each", () => {
  const doc = {
    tracks: [
      {
        clips: [
          { kind: 'audio', asset: 'a1' },
          { kind: 'notes', notes: [] },
          { kind: 'audio', asset: 'a2' },
        ],
      },
      { clips: [{ kind: 'audio', asset: 'a1' }] },
    ],
    assets: { a2: {}, a3: {} },
    reference: { asset: 'r1' },
  };
  assert.deepEqual(songAssets(doc).sort(), ['a1', 'a2', 'a3', 'r1']);
  assert.deepEqual(songAssets({}), []);
  assert.deepEqual(songAssets({ tracks: 'x', assets: null }), []);
});

test('songAssets, as a property: every clip asset is listed, nothing else, no repeats (seeded)', () => {
  let seed = 0x5eed;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed % n;
  };
  for (let run = 0; run < 300; run++) {
    const pool = Array.from({ length: 1 + rnd(6) }, (_, i) => `a${i}`);
    const tracks = Array.from({ length: rnd(4) }, () => ({
      clips: Array.from({ length: rnd(4) }, () =>
        rnd(2) ? { kind: 'audio', asset: pool[rnd(pool.length)] } : { kind: 'notes', notes: [] },
      ),
    }));
    const assets = Object.fromEntries(pool.filter(() => rnd(2)).map((id) => [id, {}]));
    const doc = { tracks, assets };
    const out = songAssets(doc);
    const want = new Set([
      ...tracks.flatMap((t) => t.clips.map((c) => c.asset).filter(Boolean)),
      ...Object.keys(assets),
    ]);
    assert.equal(out.length, new Set(out).size, `no repeats (run ${run})`);
    assert.deepEqual(new Set(out), want, `exactly the song's recordings (run ${run})`);
  }
});

test('savedAgo and jsonBytes', () => {
  const now = 10 * 86400e3;
  assert.equal(savedAgo(now - 20e3, now), 'just now');
  assert.equal(savedAgo(now - 2 * 60e3, now), '2 min ago');
  assert.equal(savedAgo(now - 3 * 3600e3, now), '3 h ago');
  assert.equal(savedAgo(now - 4 * 86400e3, now), '4 d ago');
  assert.equal(savedAgo(now + 60e3, now), 'just now', 'a clock a little ahead is just now');
  assert.equal(jsonBytes({ t: 'é' }), 10);
});

/* ---------------------------------------------------------------- the saver */
// timers the test moves by hand
function clock() {
  let now = 0,
    seq = 0;
  const due = new Map();
  return {
    setTimeout: (fn, ms) => {
      due.set(++seq, { fn, at: now + ms });
      return seq;
    },
    clearTimeout: (id) => due.delete(id),
    async tick(ms) {
      now += ms;
      for (const [id, t] of [...due]) if (t.at <= now) due.delete(id), t.fn();
      await new Promise((r) => setImmediate(r));
    },
    pending: () => due.size,
  };
}
function setup({ answer = null, storage = memStorage(), uid = 'u1', remote = { rev: 1 } } = {}) {
  const t = clock();
  const links = songLinks(storage);
  const bases = songBases(storage);
  let tick = 0;
  const stamped = (d) => ({ ...d, meta: { modified: `t${++tick}` } }); // (the store moves meta.modified on every change)
  let doc = stamped({ id: 'p_1', format: 'overdub/0', title: 'Night Ride', tracks: [] });
  const calls = [];
  const ids = [];
  let who = uid;
  const cloud = {
    async saveSong(id, d, baseRev, saveId) {
      calls.push({ id, title: d.title, baseRev });
      ids.push(saveId);
      if (answer) return answer(id, d, baseRev, saveId);
      if (baseRev !== remote.rev)
        throw Object.assign(new Error('newer'), {
          code: 'song_conflict',
          status: 409,
          details: { current: { rev: remote.rev } },
        });
      remote.rev++;
      return { songId: id, rev: remote.rev, savedAt: 1000 + remote.rev };
    },
  };
  const states = [];
  const saver = createSaver({
    cloud,
    links,
    bases,
    getDoc: () => doc,
    user: () => who,
    delay: 5000,
    maxBytes: () => 1000,
    timers: t,
    onState: (x) => states.push(x.status),
  });
  saver.loaded(doc);
  return {
    t,
    links,
    bases,
    saver,
    calls,
    ids,
    states,
    // Save to cloud, or Open: the song on screen is linked to that song in the account, at that save
    link: (pid, l) => {
      links.set(who, pid, l);
      saver.based(who, saver.mark(), l);
    },
    edit: (title) => {
      doc = stamped({ ...doc, title });
      saver.changed();
    },
    // a song comes on screen (Open, Undo, Recent songs, a reload): the copy as it was stored
    load: (d) => {
      doc = d;
      saver.loaded(d);
    },
    get doc() {
      return doc;
    },
    set doc(d) {
      doc = d;
    },
    set user(u) {
      who = u;
    },
    get rev() {
      return remote.rev;
    },
    bump: () => remote.rev++,
  };
}

test('an unlinked song is never sent', async () => {
  const s = setup();
  s.edit('x');
  await s.t.tick(10000);
  assert.equal(s.calls.length, 0);
  assert.equal(s.t.pending(), 0);
});

test('a linked song saves 5 s after its last change, from the rev it knows, and moves the link on', async () => {
  const s = setup();
  s.link('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  s.edit('a');
  await s.t.tick(3000);
  s.edit('b');
  await s.t.tick(4000);
  assert.equal(s.calls.length, 0, 'each change starts the 5 s again');
  await s.t.tick(1000);
  assert.deepEqual(s.calls, [{ id: 'sng_1', title: 'b', baseRev: 1 }]);
  assert.deepEqual(s.links.get('u1', 'p_1'), { songId: 'sng_1', rev: 2, savedAt: 1002 });
  assert.equal(s.saver.state.status, 'saved');
  s.edit('c');
  await s.t.tick(5000);
  assert.deepEqual(s.calls.at(-1), { id: 'sng_1', title: 'c', baseRev: 2 });
});

test('flush sends what is waiting at once, and only that', async () => {
  const s = setup();
  s.link('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  await s.saver.flush();
  assert.equal(s.calls.length, 0, 'nothing waiting: nothing sent');
  s.edit('a');
  await s.saver.flush();
  assert.equal(s.calls.length, 1);
  assert.equal(s.t.pending(), 0, 'the timer is gone');
  // a song being replaced: its own state is what goes, not the next one's
  s.edit('b');
  s.doc = { id: 'p_9', title: 'Other', tracks: [] };
  await s.saver.flush({ id: 'p_1', title: 'b', tracks: [] });
  assert.deepEqual(s.calls.at(-1), { id: 'sng_1', title: 'b', baseRev: 2 });
});

test('a newer save in the account: nothing is saved over it, and nothing more until it is settled', async () => {
  const s = setup();
  s.link('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  s.bump(); // another browser saved rev 2
  s.edit('mine');
  await s.t.tick(5000);
  assert.equal(s.saver.state.status, 'conflict');
  assert.deepEqual(s.saver.state.current, { rev: 2 });
  assert.equal(s.links.get('u1', 'p_1').rev, 1, 'the link stays where it was');
  s.edit('mine again');
  await s.t.tick(10000);
  assert.equal(s.calls.length, 1, 'no retry over it');
  // settled (the newer one opened: the link moves to its rev), saves go on
  s.link('p_1', { songId: 'sng_1', rev: 2, savedAt: 2 });
  s.saver.clear('p_1');
  s.edit('after');
  await s.t.tick(5000);
  assert.deepEqual(s.calls.at(-1), { id: 'sng_1', title: 'after', baseRev: 2 });
  assert.equal(s.saver.state.status, 'saved');
});

test('no Plus and signed out block saving; a network error tries again on the next change', async () => {
  for (const [err, status] of [
    [{ code: 'songs_need_plus', status: 403 }, 'blocked'],
    [{ code: 'not_signed_in', status: 401 }, 'blocked'],
    [{ code: 'unreachable', status: 0 }, 'error'],
  ]) {
    const s = setup({
      answer: () => {
        throw Object.assign(new Error('no'), err);
      },
    });
    s.link('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
    s.edit('a');
    await s.t.tick(5000);
    assert.equal(s.saver.state.status, status, err.code);
    s.edit('b');
    await s.t.tick(5000);
    assert.equal(s.calls.length, status === 'error' ? 2 : 1, `${err.code}: tried again only after an error`);
  }
});

test('a song past maxBytes is not sent, and says how big it is', async () => {
  const s = setup();
  s.link('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  s.doc = { id: 'p_1', title: 'Big', tracks: [], blob: 'x'.repeat(2000) };
  s.saver.changed();
  await s.t.tick(5000);
  assert.equal(s.calls.length, 0);
  assert.equal(s.saver.state.status, 'blocked');
  assert.equal(s.saver.state.error.code, 'song_too_large');
  assert.match(s.saver.state.error.message, /^Too big for a cloud save: [\d.]+ MB of [\d.]+ MB\.$/);
});

test('one save at a time: a change while one is out goes after it, from the new rev', async () => {
  let release;
  const s = setup({
    answer: (id, d, baseRev) =>
      new Promise((r) => {
        release = () => r({ songId: id, rev: baseRev + 1, savedAt: 5 });
      }),
  });
  s.link('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  s.edit('a');
  await s.t.tick(5000);
  assert.equal(s.saver.state.status, 'saving');
  s.edit('b');
  await s.t.tick(5000);
  assert.equal(s.calls.length, 1, 'the second waits for the first');
  release();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(s.calls[1], { id: 'sng_1', title: 'b', baseRev: 2 });
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(s.links.get('u1', 'p_1').rev, 3);
});

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
};
const copy = (d) => JSON.parse(JSON.stringify(d));

/* ---------------------------------------------------------------- each copy keeps its own base */
test('Undo after "Open the newer one": your copy saves from its own base, and is a conflict, not a silent overwrite', async () => {
  const s = setup();
  s.link('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  s.bump(); // another browser saved rev 2
  s.edit('mine');
  await s.t.tick(5000);
  assert.equal(s.saver.state.status, 'conflict');
  // Open the newer one: yours is put aside (Recent songs, Undo), the newer one comes on screen at rev 2
  const mine = copy(s.doc);
  s.saver.replacing(mine);
  s.load({ id: 'p_1', format: 'overdub/0', title: 'Newer', tracks: [], meta: { modified: 'n1' } });
  s.link('p_1', { songId: 'sng_1', rev: 2, savedAt: 2 });
  s.saver.clear('p_1');
  // Undo: yours comes back, and is edited
  s.saver.replacing(copy(s.doc));
  s.load(copy(mine));
  s.edit('mine, edited');
  await s.t.tick(5000);
  assert.deepEqual(s.calls.at(-1), { id: 'sng_1', title: 'mine, edited', baseRev: 1 }, 'from the base your copy had');
  assert.equal(s.saver.state.status, 'conflict', 'a 409: the person picks');
  assert.equal(s.rev, 2, 'the newer save is untouched');
});

test('two tabs on one song: the second save is a conflict, never over the first', async () => {
  const storage = memStorage();
  const remote = { rev: 1 };
  const a = setup({ storage, remote });
  const b = setup({ storage, remote });
  a.link('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  b.load(copy(a.doc)); // the other tab opened the same copy (the autosave)
  a.edit('tab A');
  await a.t.tick(5000);
  assert.equal(remote.rev, 2);
  b.edit('tab B');
  await b.t.tick(5000);
  assert.deepEqual(
    b.calls.at(-1),
    { id: 'sng_1', title: 'tab B', baseRev: 1 },
    "not tab A's newer rev from shared storage",
  );
  assert.equal(b.saver.state.status, 'conflict');
  assert.equal(remote.rev, 2);
});

test('a reload picks up the base recorded with the autosaved copy; a copy with no known base sends nothing and is a conflict', async () => {
  const storage = memStorage();
  const a = setup({ storage });
  a.link('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  a.edit('one');
  await a.t.tick(5000);
  a.edit('two'); // not saved yet: the autosave holds this state
  const autosaved = copy(a.doc);
  const b = setup({ storage, remote: { rev: 2 } });
  b.load(copy(autosaved));
  b.edit('three');
  await b.t.tick(5000);
  assert.deepEqual(b.calls, [{ id: 'sng_1', title: 'three', baseRev: 2 }], 'the reload saves from rev 2');
  assert.equal(b.saver.state.status, 'saved');
  // a copy from before (Recent songs) whose base was never recorded
  b.load({ id: 'p_1', format: 'overdub/0', title: 'old', tracks: [], meta: { modified: 'old' } });
  b.edit('old, edited');
  await b.t.tick(5000);
  assert.equal(b.calls.length, 1, 'nothing sent');
  assert.equal(b.saver.state.status, 'conflict');
  assert.equal(b.saver.state.current, null);
  assert.equal(b.saver.state.doc.title, 'old, edited', 'the conflict carries the copy');
});

/* ---------------------------------------------------------------- one queue entry per song */
function held() {
  const out = [];
  return {
    out,
    answer: (id, d, baseRev) =>
      new Promise((r) => {
        out.push(() => r({ songId: id, rev: baseRev + 1, savedAt: 5 }));
      }),
    release: async () => {
      while (out.length) {
        out.shift()();
        await settle();
      }
    },
  };
}

test("a replaced song's save and the next song's save both go (the copy queued first)", async () => {
  const h = held();
  const s = setup({ answer: h.answer });
  s.link('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  s.edit('A 1');
  await s.t.tick(5000); // A's first save is out
  s.edit('A 2');
  const a2 = copy(s.doc);
  s.saver.replacing(a2); // A goes, waiting: its copy is queued
  s.load({ id: 'p_2', format: 'overdub/0', title: 'B', tracks: [], meta: { modified: 'b0' } });
  s.link('p_2', { songId: 'sng_2', rev: 7, savedAt: 1 });
  s.edit('B 1');
  await s.t.tick(5000); // B's save is queued behind
  await h.release();
  assert.deepEqual(s.calls, [
    { id: 'sng_1', title: 'A 1', baseRev: 1 },
    { id: 'sng_1', title: 'A 2', baseRev: 2 },
    { id: 'sng_2', title: 'B 1', baseRev: 7 },
  ]);
});

test("a save of the song on screen waiting when it's replaced goes as its copy, and the next song's save goes too", async () => {
  const h = held();
  const s = setup({ answer: h.answer });
  s.link('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  s.edit('A 1');
  await s.t.tick(5000); // A's first save is out
  s.edit('A 2');
  await s.t.tick(5000); // A's next save is queued (the song on screen)
  const a2 = copy(s.doc);
  s.saver.replacing(a2); // then A goes: what was queued for it is its copy now
  s.load({ id: 'p_2', format: 'overdub/0', title: 'B', tracks: [], meta: { modified: 'b0' } });
  s.link('p_2', { songId: 'sng_2', rev: 7, savedAt: 1 });
  s.edit('B 1');
  await s.t.tick(5000);
  await h.release();
  assert.deepEqual(s.calls, [
    { id: 'sng_1', title: 'A 1', baseRev: 1 },
    { id: 'sng_1', title: 'A 2', baseRev: 2 },
    { id: 'sng_2', title: 'B 1', baseRev: 7 },
  ]);
});

test("a conflict on a replaced song's copy carries that copy, not the song on screen; a save says which song it saved", async () => {
  const s = setup();
  s.link('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  s.edit('A saved');
  await s.t.tick(5000);
  assert.equal(s.saver.state.doc.title, 'A saved');
  assert.equal(s.saver.state.song.songId, 'sng_1');
  s.bump(); // a newer save elsewhere
  s.edit('A mine');
  const mine = copy(s.doc);
  const flushed = s.saver.replacing(mine);
  s.load({ id: 'p_2', format: 'overdub/0', title: 'B on screen', tracks: [], meta: { modified: 'b0' } });
  await flushed;
  assert.equal(s.saver.state.status, 'conflict');
  assert.equal(s.saver.state.doc.title, 'A mine');
  assert.equal(s.saver.state.songId, 'sng_1');
  assert.equal(s.saver.held('p_2'), null, 'the song on screen is not held by it');
});

/* ---------------------------------------------------------------- accounts */
test("an account switch: the other account's link is never used, and a 404 doesn't drop it", async () => {
  let release;
  const s = setup({
    answer: () =>
      new Promise((_, no) => {
        release = () => no(Object.assign(new Error('gone'), { code: 'song_not_found', status: 404 }));
      }),
  });
  s.link('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  s.edit('a');
  await s.t.tick(5000); // a save for account u1 is out...
  s.user = 'u2'; // ...and the person signs in as someone else before it's answered (with u2's cookie: 404)
  release();
  await settle();
  assert.deepEqual(s.links.get('u1', 'p_1'), { songId: 'sng_1', rev: 1, savedAt: 1 }, "u1's link stays");
  assert.ok(s.bases.get('u1', s.doc), "and so does u1's base");
  s.edit('b');
  await s.t.tick(5000);
  assert.equal(s.calls.length, 1, 'u2 has no link for this song: nothing sent');
  // in its own account, a 404 is the song gone: the link goes
  s.user = 'u1';
  s.edit('c');
  await s.t.tick(5000);
  release();
  await settle();
  assert.equal(s.links.get('u1', 'p_1'), null);
});

/* ---------------------------------------------------------------- saveId */
test('a save whose answer was lost goes again as the same save (same saveId, same song), then the newer state', async () => {
  const remote = { rev: 1 };
  let lose = true;
  let lastSaveId = null;
  const sent = [];
  const s = setup({
    remote,
    answer: async (id, d, baseRev, saveId) => {
      sent.push({ title: d.title, baseRev, saveId });
      if (baseRev !== remote.rev) {
        if (saveId === lastSaveId) return { songId: id, rev: remote.rev, savedAt: 9 }; // a repeat: nothing written
        throw Object.assign(new Error('newer'), {
          code: 'song_conflict',
          status: 409,
          details: { current: { rev: remote.rev } },
        });
      }
      remote.rev++;
      lastSaveId = saveId;
      if (lose) {
        lose = false;
        throw Object.assign(new Error('The service didn’t answer.'), { code: '', status: 0 });
      }
      return { songId: id, rev: remote.rev, savedAt: 9 };
    },
  });
  s.link('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  s.edit('one');
  await s.t.tick(5000);
  assert.equal(s.saver.state.status, 'error');
  assert.equal(remote.rev, 2, 'it landed; only the answer was lost');
  s.edit('two');
  await s.t.tick(5000);
  await settle();
  assert.deepEqual(
    sent.map((x) => [x.title, x.baseRev]),
    [
      ['one', 1],
      ['one', 1],
      ['two', 2],
    ],
  );
  assert.equal(sent[1].saveId, sent[0].saveId, 'the retry is the same save');
  assert.notEqual(sent[2].saveId, sent[0].saveId, 'the next save is a new one');
  assert.match(sent[0].saveId, /^[A-Za-z0-9_-]{8,64}$/);
  assert.equal(s.saver.state.status, 'saved');
  assert.equal(remote.rev, 3, 'no conflict with itself, nothing lost');
});
