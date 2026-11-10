// The community shelf's index reader (app/src/devices/community.js) and the shelf's brand rules, against the small fake
// index in tools/fixtures/community-fake/. The reader keeps what it knows and skips the rest (unknown fields, kinds,
// tiers, cats; reserved ids and handles; House from another origin; URLs outside policy; hostile params and looks; clip
// types; a newer major; caps); the URL policy; search by category words, never by the agent; revoked only from the
// bundled copy. Brand: no pills or coloured edges in the new CSS; none of the banned words in the new copy.
// The browser half of the shelf is tools/community-test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readIndex, filterEntries, resolveUrl, indexUrlAllowed, LIMITS } from '../../app/src/devices/community.js';

const T = { ok: (cond, msg) => (assert.ok(cond, msg), !!cond) };
const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../tools');
const FIX = path.join(HERE, 'fixtures/community-fake');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

test('reader', async () => {
  const base = 'http://localhost:9/tools/fixtures/community-fake/community-index.json';
  const r = readIndex(read('community-index.json'), { base });
  T.ok(
    !r.error && r.entries.length === 5 && r.refused === 1 && r.entries.every((e) => e.origin === base),
    `the fixture reads: ${r.entries.length} entries, the House one refused from a non-bundled index (${r.refused})`,
  );
  const b = readIndex(read('bundled-index.json'), {
    base: 'http://localhost:9/app/community/community-index.json',
    bundled: true,
  });
  T.ok(
    b.entries.length === 6 &&
      b.entries.some((e) => e.tier === 'house' && e.id === 'claude.house-hum') &&
      b.revoked.length === 1 &&
      b.entries.every((e) => e.origin === 'bundled'),
    `the bundled copy lists the House entry, carries its deny list and origin 'bundled'`,
  );
  const hostileBase = 'http://localhost:9/tools/fixtures/community-fake/hostile-index.json';
  const hz = readIndex(read('hostile-index.json'), { base: hostileBase });
  const json = JSON.stringify(hz);
  T.ok(!/surprise|mystery/.test(json), 'unknown fields at every level are left behind');
  T.ok(hz.revoked.length === 0, 'a deny list from another origin is ignored');
  const ids = hz.entries.map((e) => e.id);
  T.ok(
    ids.join(',') === 'tester.ok,tester.clip' && hz.skipped === 4 && hz.refused === 11,
    `unknown kind, tier, cat and a missing field are skipped (${hz.skipped}); reserved ids and handles, a borrowed handle, House from another origin and device URLs outside policy are refused (${hz.refused}); the rest stay (${ids.join(', ')})`,
  );
  const ok = hz.entries[0];
  T.ok(
    ok.name === 'Ok Name' && ok.request.length <= 500,
    `text is cleaned and capped ("${ok.name}", request ${ok.request.length} chars)`,
  );
  T.ok(
    ok.params.length === 1 && ok.params[0].key === 'ok' && ok.params.every((p) => typeof p.min === 'number'),
    'a param whose min is markup is dropped; the rest are numbers',
  );
  T.ok(
    !ok.look.color && !ok.look.shape && ok.look.ink === '#fff' && ok.look.knob === 'chrome',
    "a look colour that isn't hex and a shape the faces don't draw are dropped",
  );
  T.ok(
    ok.preview.wet.length === 1 && ok.preview.wet[0].type === 'audio/wav',
    "a clip of a type the studio doesn't play is dropped",
  );
  T.ok(ok.source.url === null, "a source URL that isn't https on an allowed host is no link");
  T.ok(hz.entries[1].preview.wet.length === 0, "clips outside the index's own clips/ are refused one by one");
  const v2 = readIndex({ format: 'overdub-community-index/2', devices: [{}] }, { base });
  T.ok(v2.newer && !v2.entries.length, 'a newer major lists nothing and says so');
  const big = readIndex('x'.repeat(LIMITS.jsonBytes + 1), { base });
  T.ok(big.error && !big.entries.length, 'past 2 MB of JSON nothing is read');
  const many = JSON.parse(read('community-index.json'));
  const one = many.devices[0];
  many.devices = Array.from({ length: LIMITS.entries + 5 }, (_, i) => ({ ...one, id: `tester.e${i}` }));
  const m = readIndex(many, { base });
  T.ok(
    m.entries.length === LIMITS.entries && m.skipped === 5,
    `past ${LIMITS.entries} entries the rest are skipped and counted (${m.skipped})`,
  );
  // search
  const names = (q) =>
    filterEntries(r.entries, { q })
      .map((e) => e.id)
      .join(',');
  T.ok(
    names('dirty') === 'tester.wrong-hash' &&
      names('echo').startsWith('tester.soft-echo') &&
      names('claude') === '' &&
      names('opus') === '',
    `search: a category word finds its category ("dirty": ${names('dirty')}); the agent is never searched ("claude": ${names('claude') || 'none'})`,
  );
  T.ok(
    filterEntries(r.entries, { kind: 'instrument' }).length === 1 &&
      filterEntries(r.entries, { cat: 'time' }).length === 1,
    'kind and cat filter',
  );
  // the URL policy
  T.ok(
    resolveUrl('clips/a.wav', base, { under: 'clips' }) &&
      !resolveUrl('https://example.com/clips/a.wav', base, { under: 'clips' }) &&
      !resolveUrl('data:audio/wav,x', base, { under: 'clips' }) &&
      !resolveUrl('javascript:alert(1)', base, { under: 'clips' }) &&
      !resolveUrl('../clips/a.wav', base, { under: 'clips' }),
    "clip URLs: the index's own clips/ only",
  );
  const page = 'http://localhost:5/app/';
  T.ok(
    indexUrlAllowed('/app/community/community-index.json', { page }) &&
      indexUrlAllowed('http://127.0.0.1:4000/i.json', { page }) &&
      !indexUrlAllowed('https://example.com/i.json', { page }) &&
      !indexUrlAllowed('data:application/json,{}', { page }) &&
      !indexUrlAllowed('javascript:1', { page }) &&
      !indexUrlAllowed('http://localhost:4000/i.json', { page: 'https://overdubstudio.com/app/' }),
    'index URLs: this site, or localhost from a local page only',
  );
});

test('brand', async () => {
  const src = ['app/src/ui/community.js', 'app/src/agent/community-tool.js', 'app/src/devices/community.js']
    .map((f) => fs.readFileSync(path.join(HERE, '..', f), 'utf8'))
    .join('\n');
  const cssPart = src.slice(src.indexOf('const SHELF_CSS = `'));
  T.ok(
    !/border-radius:\s*(99|50%)/.test(cssPart) &&
      !/border-left:[^;]*var\(--(human|agent|accent)/.test(cssPart) &&
      !/inset[^;]*box-shadow|box-shadow:[^;]*inset/.test(cssPart),
    'the new CSS has no pills, no coloured left edge and no inset stripe',
  );
  // the copy: quoted strings only (comments may name what isn't done)
  const strings = (src.match(/(['`])(?:(?!\1)[^\\\n]|\\.)*\1/g) || []).join(' ');
  const bad = strings.match(/\b(safe|secure|sandboxed|verified|marketplace|buy|price|prices|free trial)\b/gi);
  T.ok(
    !bad,
    `the new copy never says safe, secure, sandboxed, verified, marketplace, buy, price or free trial${bad ? ` (found: ${[...new Set(bad)].join(', ')})` : ''}`,
  );
});
