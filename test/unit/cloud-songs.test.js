// agent/cloud.js's song methods and agent/cloud-songs.js: the requests the studio makes for songs in an Overdub
// account, which song on screen is linked to which, and the saver that keeps a linked song saved there (5 s after a
// change, never over a newer save).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloud, CloudError } from '../../app/src/agent/cloud.js';
import { songLinks, songAssets, savedAgo, jsonBytes, createSaver } from '../../app/src/agent/cloud-songs.js';

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
  for (const r of s.log) assert.deepEqual(Object.keys(r.headers), ['content-type'], 'only content-type: CORS allows no other');
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
  assert.equal(links.get('p_1'), null);
  links.set('p_1', { songId: 'sng_1', rev: 2, savedAt: 5 });
  links.set('p_2', { songId: 'sng_1', rev: 1, savedAt: 6 });
  links.set('p_3', { songId: 'sng_2', rev: 1, savedAt: 7 });
  assert.deepEqual(songLinks(st).get('p_1'), { songId: 'sng_1', rev: 2, savedAt: 5 }, 'another reader sees it');
  assert.equal(links.dropSong('sng_1'), 2, 'a deleted song unlinks every song here linked to it');
  assert.equal(links.get('p_2'), null);
  links.drop('p_3');
  assert.deepEqual(JSON.parse(st.map.get('overdub:cloud-song')), {});
});

test('the link survives unreadable or blocked storage', () => {
  const junk = songLinks(memStorage({ 'overdub:cloud-song': '{nope' }));
  assert.equal(junk.get('p_1'), null);
  const bad = songLinks(memStorage({ 'overdub:cloud-song': JSON.stringify({ p_1: { songId: 3 } }) }));
  assert.equal(bad.get('p_1'), null, 'a malformed entry is no link');
  const blocked = songLinks({
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  });
  assert.doesNotThrow(() => blocked.set('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 }));
  assert.equal(songLinks(null).get('p_1'), null);
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
function setup({ answer = null } = {}) {
  const t = clock();
  const links = songLinks(memStorage());
  let doc = { id: 'p_1', format: 'overdub/0', title: 'Night Ride', tracks: [] };
  const calls = [];
  let rev = 1;
  const cloud = {
    async saveSong(id, d, baseRev) {
      calls.push({ id, title: d.title, baseRev });
      if (answer) return answer(id, d, baseRev);
      if (baseRev !== rev)
        throw Object.assign(new Error('newer'), { code: 'song_conflict', status: 409, details: { current: { rev } } });
      rev++;
      return { songId: id, rev, savedAt: 1000 + rev };
    },
  };
  const states = [];
  const saver = createSaver({
    cloud,
    links,
    getDoc: () => doc,
    delay: 5000,
    maxBytes: () => 1000,
    timers: t,
    onState: (s) => states.push(s.status),
  });
  return {
    t,
    links,
    saver,
    calls,
    states,
    edit: (title) => {
      doc = { ...doc, title };
      saver.changed();
    },
    set doc(d) {
      doc = d;
    },
    bump: () => rev++,
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
  s.links.set('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  s.edit('a');
  await s.t.tick(3000);
  s.edit('b');
  await s.t.tick(4000);
  assert.equal(s.calls.length, 0, 'each change starts the 5 s again');
  await s.t.tick(1000);
  assert.deepEqual(s.calls, [{ id: 'sng_1', title: 'b', baseRev: 1 }]);
  assert.deepEqual(s.links.get('p_1'), { songId: 'sng_1', rev: 2, savedAt: 1002 });
  assert.equal(s.saver.state.status, 'saved');
  s.edit('c');
  await s.t.tick(5000);
  assert.deepEqual(s.calls.at(-1), { id: 'sng_1', title: 'c', baseRev: 2 });
});

test('flush sends what is waiting at once, and only that', async () => {
  const s = setup();
  s.links.set('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
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
  s.links.set('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
  s.bump(); // another browser saved rev 2
  s.edit('mine');
  await s.t.tick(5000);
  assert.equal(s.saver.state.status, 'conflict');
  assert.deepEqual(s.saver.state.current, { rev: 2 });
  assert.equal(s.links.get('p_1').rev, 1, 'the link stays where it was');
  s.edit('mine again');
  await s.t.tick(10000);
  assert.equal(s.calls.length, 1, 'no retry over it');
  // settled (the newer one opened: the link moves to its rev), saves go on
  s.links.set('p_1', { songId: 'sng_1', rev: 2, savedAt: 2 });
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
    s.links.set('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
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
  s.links.set('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
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
  s.links.set('p_1', { songId: 'sng_1', rev: 1, savedAt: 1 });
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
  assert.equal(s.links.get('p_1').rev, 3);
});
