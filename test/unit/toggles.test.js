// The feature toggles' registry (app/src/toggles.js): its shape, what turns a toggle on, and the scans that keep the
// rules (every on('…') names a registered toggle; no constant switches are left).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TOGGLES,
  MAX_TOGGLES,
  on,
  list,
  offLine,
  readToggles,
  applyToggles,
  auditToggles,
  deployDefaults,
  bootConfig,
} from '../../app/src/toggles.js';
import { loadSiteConfig } from '../../app/src/site-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NINE = [
  'relay',
  'accounts',
  'cloud.agent',
  'community',
  'community.try',
  'start.slice2',
  'device.rooms',
  'workflow.flip',
  'stems.local',
];
const onIds = (r) =>
  Object.entries(r.by)
    .filter(([, by]) => by !== 'off')
    .map(([id]) => id);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'vendor' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(m?js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p);
// the code (site/docs/ is built from docs/, and holds no code of ours)
const CODE = [
  ...walk(path.join(ROOT, 'app')),
  ...walk(path.join(ROOT, 'site')).filter((p) => !rel(p).startsWith('site/docs/')),
  ...walk(path.join(ROOT, 'server')),
];

describe('the registry', () => {
  test('every toggle has a dotted lowercase id, a name, a one-line about and an intent', () => {
    const ids = TOGGLES.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, 'ids are unique');
    for (const t of TOGGLES) {
      assert.match(t.id, /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/, t.id);
      assert.ok(typeof t.name === 'string' && t.name.trim(), `${t.id}: a name`);
      assert.ok(
        typeof t.about === 'string' && t.about.trim() && !/\n/.test(t.about) && t.about.length < 120,
        `${t.id}: a one-line about under 120 characters`,
      );
      assert.ok(t.intent === null || /^\d{4}$/.test(t.intent), `${t.id}: an intent number or null`);
      assert.ok(t.deploy === undefined || t.deploy === 'on', `${t.id}: deploy is 'on' or absent`);
    }
  });
  test('the first nine, in order', () => {
    assert.deepEqual(
      TOGGLES.slice(0, 9).map((t) => t.id),
      NINE,
    );
  });
  test(`at most ${MAX_TOGGLES}: toggles are temporary`, () => {
    assert.equal(MAX_TOGGLES, 15);
    assert.ok(TOGGLES.length <= MAX_TOGGLES, `${TOGGLES.length} toggles`);
  });
  test("exactly one entry is on by the deploy, and it's relay (a new one changes this test, on purpose)", () => {
    assert.deepEqual(
      TOGGLES.filter((t) => 'deploy' in t).map((t) => t.id),
      ['relay'],
    );
    assert.deepEqual(deployDefaults(), { relay: 'on' });
  });
  test('the registry is frozen', () => {
    assert.ok(Object.isFrozen(TOGGLES) && TOGGLES.every((t) => Object.isFrozen(t)));
  });
});

describe('on()', () => {
  test('a fresh module answers off for every toggle, before the config is read', async () => {
    const fresh = await import(`../../app/src/toggles.js?fresh=${Date.now()}`);
    for (const id of NINE) assert.equal(fresh.on(id), false, id);
    assert.ok(fresh.list().every((x) => x.on === false && x.by === 'off'));
  });
  test('an unknown id throws, so a typo fails loudly', () => {
    assert.throws(() => on('relays'), /no toggle "relays"/);
    assert.throws(() => offLine('nope'), /no toggle "nope"/);
  });
  test('offLine makes the sentence from the name', () => {
    assert.equal(offLine('workflow.flip'), "Flip a song isn't on in this studio.");
  });
  test('applyToggles sets what on() and list() answer', () => {
    const warn = console.warn;
    const said = [];
    console.warn = (m) => said.push(m);
    try {
      applyToggles(
        { toggles: { relay: 'on', accounts: 'off', nope: 'on' } },
        { search: '?on=workflow.flip', host: 'localhost' },
      );
    } finally {
      console.warn = warn;
    }
    assert.equal(on('relay'), true);
    assert.equal(on('accounts'), false);
    assert.equal(on('workflow.flip'), true);
    const l = list();
    assert.deepEqual(
      l.map((x) => x.id),
      TOGGLES.map((t) => t.id),
    );
    assert.deepEqual(
      l.find((x) => x.id === 'relay'),
      { id: 'relay', name: 'Connect to Claude', on: true, by: 'site' },
    );
    assert.deepEqual(
      l.find((x) => x.id === 'workflow.flip'),
      { id: 'workflow.flip', name: 'Flip a song', on: true, by: 'url' },
    );
    assert.deepEqual(
      l.find((x) => x.id === 'accounts'),
      { id: 'accounts', name: 'Sign in with Overdub', on: false, by: 'off' },
    );
    assert.equal(said.length, 1, 'one warning for the unknown id');
    applyToggles(null, {});
    assert.ok(NINE.every((id) => !on(id)));
  });
});

describe('readToggles: what turns a toggle on', () => {
  const live = { host: 'overdubstudio.com', search: '' };
  test('no file, {}, no key, a non-object, null: all off', () => {
    for (const c of [
      null,
      undefined,
      {},
      { cloud: { api: 'https://x.example' } },
      'on',
      7,
      [],
      { toggles: null },
      { toggles: [] },
      { toggles: 'relay' },
      { toggles: ['relay'] },
    ]) {
      assert.deepEqual(onIds(readToggles(c, live)), [], JSON.stringify(c));
    }
  });
  test('only the exact string "on" counts', () => {
    const r = readToggles(
      {
        toggles: {
          relay: 'on',
          accounts: true,
          'cloud.agent': 'ON',
          community: 1,
          'community.try': 'off',
          'start.slice2': 'yes',
        },
      },
      live,
    );
    assert.deepEqual(onIds(r), ['relay']);
    assert.equal(r.by.relay, 'site');
  });
  test('an unknown id is ignored, with one warning', () => {
    const r = readToggles({ toggles: { nope: 'on', 'also.nope': 'on', relay: 'on' } }, live);
    assert.deepEqual(onIds(r), ['relay']);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /"nope", "also\.nope"/);
  });
  test('?on= does nothing on the live site', () => {
    assert.deepEqual(onIds(readToggles({}, { search: '?on=workflow.flip', host: 'overdubstudio.com' })), []);
    assert.deepEqual(onIds(readToggles({}, { search: '?on=all', host: 'next.overdubstudio.com' })), []);
    assert.deepEqual(onIds(readToggles({}, { search: '?on=accounts', host: 'overdub.example' })), []);
  });
  test('?on=a,b on a local studio turns those on for the load', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const r = readToggles({}, { search: '?on=workflow.flip', host });
      assert.deepEqual(onIds(r), ['workflow.flip'], host);
      assert.equal(r.by['workflow.flip'], 'url');
    }
    assert.deepEqual(onIds(readToggles({}, { search: '?on=workflow.flip,stems.local', host: 'localhost' })), [
      'workflow.flip',
      'stems.local',
    ]);
  });
  test('?on=all turns on every one; the site keeps its own "by"', () => {
    const r = readToggles({ toggles: { relay: 'on' } }, { search: '?on=all', host: 'localhost' });
    assert.deepEqual(
      onIds(r),
      TOGGLES.map((t) => t.id),
    );
    assert.equal(r.by.relay, 'site');
    assert.equal(r.by.accounts, 'url');
  });
  test('?on= with an unknown id ignores it, with a warning', () => {
    const r = readToggles({}, { search: '?on=nope,relay', host: 'localhost' });
    assert.deepEqual(onIds(r), ['relay']);
    assert.equal(r.warnings.length, 1);
  });
  test('the developer doors count as their toggle, locally only', () => {
    const relay = '?relay=' + encodeURIComponent('http://localhost:8790');
    const cloud = 'cloud=' + encodeURIComponent('http://localhost:8787');
    assert.deepEqual(onIds(readToggles({}, { search: relay, host: 'localhost' })), ['relay']);
    assert.deepEqual(onIds(readToggles({}, { search: `${relay}&${cloud}`, host: 'localhost' })), [
      'relay',
      'accounts',
      'cloud.agent',
    ]);
    assert.deepEqual(onIds(readToggles({}, { search: '?' + cloud, host: 'localhost' })), ['cloud.agent']);
    // a cloud door to another machine isn't one; nor is any door on the live site
    assert.deepEqual(
      onIds(readToggles({}, { search: '?cloud=' + encodeURIComponent('https://api.example.com'), host: 'localhost' })),
      [],
    );
    assert.deepEqual(onIds(readToggles({}, { search: `${relay}&${cloud}`, host: 'overdubstudio.com' })), []);
    assert.deepEqual(onIds(readToggles({}, { search: '?relay=not-a-url', host: 'localhost' })), []);
  });
});

describe('boot: a config this load could not see keeps the deploy defaults', () => {
  const LIVE = { search: '', host: 'overdubstudio.com' };
  const json =
    (body, status = 200) =>
    async () =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const html = (status) => async () =>
    new Response('<html>Service Unavailable</html>', { status, headers: { 'content-type': 'text/html' } });
  const boot = async (fetch) => {
    const cfg = await loadSiteConfig({ fetch, fresh: true, search: '', host: 'overdubstudio.com' });
    applyToggles(bootConfig(cfg), LIVE);
    return {
      read: cfg.read,
      on: list()
        .filter((t) => t.on)
        .map((t) => t.id),
    };
  };
  const cases = [
    [
      'a network error',
      async () => {
        throw new TypeError('Failed to fetch');
      },
      'failed',
      ['relay'],
    ],
    ['a 503 HTML page (CloudFront)', html(503), 'failed', ['relay']],
    ['a 200 HTML page', html(200), 'failed', ['relay']],
    [
      'JSON that does not parse',
      async () => new Response('{"toggles": {', { headers: { 'content-type': 'application/json' } }),
      'failed',
      ['relay'],
    ],
    ['a 404: no file', html(404), 'absent', []],
    ['a 410', json({}, 410), 'absent', []],
    ['{}', json({}), 'ok', []],
    ['a file that turns relay off', json({ toggles: { relay: 'off' } }), 'ok', []],
    ['the live file', json({ toggles: { relay: 'on', accounts: 'on' } }), 'ok', ['relay', 'accounts']],
  ];
  for (const [name, fetch, read, want] of cases) {
    test(`${name}: read ${read}, on ${JSON.stringify(want)}`, async () => {
      const r = await boot(fetch);
      assert.equal(r.read, read);
      assert.deepEqual(r.on, want);
    });
  }
  test("past main.js's cap ('late') or a read that threw (null): the deploy defaults, and nothing else", () => {
    for (const cfg of ['late', null, undefined]) {
      applyToggles(bootConfig(cfg), LIVE);
      assert.deepEqual(
        list()
          .filter((t) => t.on)
          .map((t) => t.id),
        Object.keys(deployDefaults()),
      );
    }
    assert.deepEqual(Object.keys(deployDefaults()), ['relay']);
    applyToggles(null, {});
  });
});

describe('auditToggles: what deploy.sh and prod-check refuse', () => {
  test('a good config: what it turns on, no errors', () => {
    assert.deepEqual(auditToggles({ toggles: { relay: 'on', 'workflow.flip': 'off' } }), {
      on: ['relay'],
      errors: [],
      deployOff: [],
    });
  });
  test('no toggles: none on, and relay is off because the file leaves it out', () => {
    assert.deepEqual(auditToggles({}), {
      on: [],
      errors: [],
      deployOff: [{ id: 'relay', why: 'the file leaves it out' }],
    });
    assert.deepEqual(auditToggles(null).deployOff, [{ id: 'relay', why: 'the file leaves it out' }]);
  });
  test('an explicit off is not an error, but says so', () => {
    assert.deepEqual(auditToggles({ toggles: { relay: 'off' } }), {
      on: [],
      errors: [],
      deployOff: [{ id: 'relay', why: 'the file says "off"' }],
    });
  });
  test('an unknown id, a bad value, a non-object toggles: errors', () => {
    assert.deepEqual(
      auditToggles({ toggles: { relay: 'on', nope: 'on' } }, TOGGLES, { registryName: 'abc1234' }).errors,
      [`names toggle "nope", which abc1234 doesn't register`],
    );
    assert.deepEqual(auditToggles({ toggles: { relay: 'on', accounts: true } }).errors, [
      'toggle "accounts" is true, not "on" or "off"',
    ]);
    assert.deepEqual(auditToggles({ toggles: ['relay'] }).errors, ['"toggles" is an array, not an object']);
    assert.deepEqual(auditToggles({ toggles: 'relay' }).errors, ['"toggles" is string, not an object']);
  });
  test('against another registry (an older or newer ref)', () => {
    const reg = [{ id: 'relay', deploy: 'on' }, { id: 'x' }];
    assert.deepEqual(auditToggles({ toggles: { x: 'on', relay: 'on' } }, reg), {
      on: ['x', 'relay'],
      errors: [],
      deployOff: [],
    });
    assert.equal(auditToggles({ toggles: { 'workflow.flip': 'on' } }, reg).errors.length, 1);
  });
});

describe('the source scans', () => {
  test("every on('…') literal names a registered toggle", () => {
    const ids = new Set(TOGGLES.map((t) => t.id));
    const bad = [],
      seen = [];
    for (const f of CODE) {
      const src = fs.readFileSync(f, 'utf8');
      // what a file calls on(): the names it imports it as from toggles.js, and any toggles.on(…) / app.toggles.on(…)
      const names = [];
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*\/toggles\.js['"]/g)) {
        for (const part of m[1].split(',')) {
          const [a, b] = part.trim().split(/\s+as\s+/);
          if (a === 'on') names.push(b || a);
        }
      }
      for (const m of src.matchAll(/import\s*\*\s*as\s+(\w+)\s+from\s*['"][^'"]*\/toggles\.js['"]/g))
        names.push(`${m[1]}\\.on`);
      names.push('toggleOn');
      const re = new RegExp(`(?:(?<![\\w$.])(?:${names.join('|')})|\\btoggles\\.on)\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
      for (const m of src.matchAll(re)) {
        seen.push(m[1]);
        if (!ids.has(m[1])) bad.push(`${rel(f)}: on('${m[1]}')`);
      }
    }
    assert.deepEqual(bad, []);
  });
  test('a toggle never changes how a song sounds: no toggles.js under core/, audio/, kernel/ or the device registry', () => {
    const where = CODE.filter(
      (f) => /^app\/src\/(core|audio|kernel)\//.test(rel(f)) || rel(f) === 'app/src/devices/registry.js',
    );
    assert.ok(where.length > 20);
    assert.deepEqual(where.filter((f) => /toggles\.js['"]/.test(fs.readFileSync(f, 'utf8'))).map(rel), []);
  });
  test('no constant switches are left: every feature reads on()', () => {
    // relay, accounts, cloud.agent, community and community.try all read on() now; a new one goes in the registry
    const ALLOWED = [];
    const found = [];
    for (const f of CODE)
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/export const ([A-Z_]+_(?:LIVE|ON)) = (?:true|false)/g))
        found.push(`${rel(f)}: ${m[1]}`);
    assert.deepEqual(found.sort(), ALLOWED.slice().sort());
  });
  test('the retired switches are gone from the code, the docs and the deploy: RELAY_LIVE, ACCOUNT_LIVE, relayPreview', () => {
    const text = (dir, out = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) text(p, out);
        else if (/\.(m?js|html|md|sh|json|css|txt|conf|ya?ml)$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const files = ['app', 'docs', 'site/docs', 'deploy'].flatMap((d) => text(path.join(ROOT, d)));
    assert.ok(files.length > 50);
    const hits = [];
    for (const f of files)
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/\b(RELAY_LIVE|ACCOUNT_LIVE|relayPreview)\b/g))
        hits.push(`${rel(f)}: ${m[1]}`);
    assert.deepEqual(hits, []);
  });
});
