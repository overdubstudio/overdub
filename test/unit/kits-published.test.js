// The published kits (tools/kits/published.js): a deploy takes a pinned kit the site already serves, held to the
// SHA-256 the device pins, instead of rebuilding it from a dozen upstream servers that any one of can be down. Against
// a real HTTP server on this machine: the pinned bytes are taken, gzip on the wire is undone, and a wrong, missing or
// unreachable copy moves on to the next origin, then to nothing.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fetchPublished, origins, ORIGINS } from '../../tools/kits/published.js';

const kit = Buffer.from('ODK1 the pinned kit bytes');
const hex = crypto.createHash('sha256').update(kit).digest('hex');
const pinned = `sha256-${hex}`;

// path -> how to answer; every request is logged
const routes = new Map();
const asked = [];
let server, base, closed;

before(async () => {
  server = http.createServer((req, res) => {
    asked.push(req.url);
    const r = routes.get(req.url);
    if (!r) return res.writeHead(404).end('no');
    res.writeHead(200, r.headers || {}).end(r.body);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
  // a port nobody listens on: bound, read and closed again
  const s = http.createServer();
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  closed = `http://127.0.0.1:${s.address().port}`;
  await new Promise((ok) => s.close(ok));
});
after(() => server.close());

const at = (name, body, headers) => routes.set(`/${name}/app/kits/${hex}.odk`, { body, headers });

describe('fetchPublished', () => {
  test('takes the pinned kit from the first origin that has it', async () => {
    at('a', kit);
    const got = await fetchPublished(pinned, { from: [`${base}/a`] });
    assert.ok(got);
    assert.deepEqual(got.bytes, kit);
    assert.equal(got.url, `${base}/a/app/kits/${hex}.odk`);
  });

  test('undoes gzip on the wire, as the site sends every kit', async () => {
    at('gz', zlib.gzipSync(kit), { 'content-encoding': 'gzip' });
    const got = await fetchPublished(pinned, { from: [`${base}/gz`] });
    assert.deepEqual(got.bytes, kit);
  });

  test('refuses a copy that is not the pinned bytes, and takes the next origin', async () => {
    at('bad', Buffer.from('ODK1 something else'));
    at('good', kit);
    const notes = [];
    const got = await fetchPublished(pinned, { from: [`${base}/bad`, `${base}/good`], log: (m) => notes.push(m) });
    assert.equal(got.url, `${base}/good/app/kits/${hex}.odk`);
    assert.match(notes.join('\n'), /not the pinned kit/);
  });

  test('a missing copy or an origin that does not answer moves on, and none at all is null', async () => {
    const notes = [];
    const got = await fetchPublished(pinned, { from: [`${base}/none`, closed], log: (m) => notes.push(m) });
    assert.equal(got, null);
    assert.equal(notes.length, 2);
    assert.match(notes[0], /404/);
  });

  test('asks for the file the device names, under app/, and nothing else', async () => {
    asked.length = 0;
    at('path', kit);
    await fetchPublished(pinned, { from: [`${base}/path/`] });
    assert.deepEqual(asked, [`/path/app/kits/${hex}.odk`]);
  });

  test('refuses a pin that is not a SHA-256', async () => {
    await assert.rejects(() => fetchPublished('sha256-xyz', { from: [`${base}/a`] }), /SHA-256/);
  });
});

describe('origins', () => {
  test('the live site, then the preview, by default', () => {
    assert.deepEqual(origins({}), ORIGINS);
    assert.deepEqual(ORIGINS, ['https://overdubstudio.com', 'https://next.overdubstudio.com']);
  });

  test('KITS_FROM names others, and empty names none (build from upstream only)', () => {
    assert.deepEqual(origins({ KITS_FROM: 'http://a, http://b' }), ['http://a', 'http://b']);
    assert.deepEqual(origins({ KITS_FROM: '' }), []);
  });
});
