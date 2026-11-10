// Counting, not tracking (app/src/analytics.js): the rules and the URLs are pure, and the copy is text in the repo, so
// neither needs a browser. What a real page sends, and doesn't, is tools/analytics-test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowed, optedOut, referrerHost, beaconUrl, exportKind, EVENTS, HOST } from '../../app/src/analytics.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const loc = (hostname, protocol = 'https:') => ({ hostname, protocol });

for (const f of ['app/e.gif', 'site/e.gif']) {
  test(`${f} is a 43-byte GIF`, () => {
    const b = fs.readFileSync(path.join(ROOT, f));
    assert.ok(b.length === 43 && b.subarray(0, 6).toString() === 'GIF89a' && b[b.length - 1] === 0x3b);
  });
}

test('allowed on https://overdubstudio.com', () => {
  assert.ok(allowed(loc(HOST), {}, {}));
});
test('not on localhost', () => {
  assert.ok(!allowed(loc('localhost', 'http:'), {}, {}) && !allowed(loc('127.0.0.1', 'http:'), {}, {}));
});
test('not over http, nor on look-alike hosts', () => {
  assert.ok(
    !allowed(loc(HOST, 'http:'), {}, {}) &&
      !allowed(loc('overdubstudio.com.evil.test'), {}, {}) &&
      !allowed(loc('overdub.ajsmithhq.com'), {}, {}),
  );
});
test('not on next.overdubstudio.com', () => {
  assert.ok(!allowed({ hostname: 'next.overdubstudio.com', protocol: 'https:' }, {}, {}));
});
test('Do Not Track: nothing', () => {
  assert.ok(
    !allowed(loc(HOST), { doNotTrack: '1' }, {}) &&
      !allowed(loc(HOST), {}, { doNotTrack: '1' }) &&
      !allowed(loc(HOST), { msDoNotTrack: '1' }, {}),
  );
});
test('Global Privacy Control: nothing', () => {
  assert.ok(!allowed(loc(HOST), { globalPrivacyControl: true }, {}));
});
test('automation: nothing', () => {
  assert.ok(!allowed(loc(HOST), { webdriver: true }, {}));
});
test('DNT 0 or unset is not an opt-out', () => {
  assert.ok(!optedOut({ doNotTrack: '0' }, {}) && !optedOut({ doNotTrack: null }, {}));
});

test('referrer: host only, no www, no query', () => {
  assert.ok(referrerHost('https://www.google.com/search?q=my+secret+song') === 'google.com');
});
test('referrer: no port, no path', () => {
  assert.ok(referrerHost('https://news.ycombinator.com:8443/item?id=1') === 'news.ycombinator.com');
});
test('referrer: nothing when none or odd', () => {
  assert.ok(
    referrerHost('') === '' && referrerHost('not a url') === '' && referrerHost('file:///Users/aj/song.html') === '',
  );
});

test('beacon: /app/e.gif?e=play', () => {
  assert.ok(beaconUrl('play') === '/app/e.gif?e=play');
});
test('beacon: an enumerated field', () => {
  assert.ok(beaconUrl('agent', 'claude.ai') === '/app/e.gif?e=agent&p=claude.ai');
});
test('beacon: a field off the list is refused', () => {
  assert.ok(beaconUrl('agent', 'my-key-sk-ant') === null && beaconUrl('agent') === null);
});
test('beacon: an event off the list is refused', () => {
  assert.ok(beaconUrl('title', 'x') === null && beaconUrl('toString') === null && beaconUrl('constructor') === null);
});
test('beacon: an event without fields drops any field', () => {
  assert.ok(beaconUrl('hum', 'loud') === '/app/e.gif?e=hum');
});
test('beacon: r only on opens', () => {
  assert.ok(beaconUrl('device', 'you', { r: 'google.com' }) === '/app/e.gif?e=device&p=you');
});
test('beacon: a malformed r is dropped', () => {
  assert.ok(beaconUrl('open', 'demo', { r: 'x.com/path?q' }) === '/app/e.gif?e=open&p=demo');
});

test('the event list is short and fixed', () => {
  assert.ok(Object.keys(EVENTS).join() === 'open,play,agent,device,export,share,hum,keep');
});
test('every field is a short word from a list', () => {
  assert.ok(Object.values(EVENTS).every((v) => !v || (v.length <= 8 && v.every((s) => /^[a-z.]{1,10}$/.test(s)))));
});
test('exports: the file type, never the name', () => {
  const names = [
    'Night Shift.wav',
    'Night Shift stems.zip',
    'Night Shift.mid',
    'Night Shift.overdub.json',
    'Night Shift attribution.json',
    'velvet.overdub-device.json',
    'a.webm',
    'a.txt',
  ];
  assert.ok(names.map(exportKind).join() === 'wav,stems,midi,song,log,device,video,other');
});

// What the copy says about it. The counts exist, so nothing public (or about to be) may say there are none, and the
// privacy answers name every event the studio can send. The deck and the launch drafts live in a private repo beside
// this one; they're checked when it's there.
const PRIV = process.env.OVERDUB_PRIVATE || path.resolve(ROOT, '..', 'overdub-private');
const HAS_PRIV = fs.existsSync(path.join(PRIV, 'docs/launch'));
const at = (f) => (fs.existsSync(path.join(ROOT, f)) ? path.join(ROOT, f) : path.join(PRIV, f));
const read = (f) => fs.readFileSync(at(f), 'utf8');

test('no copy says the studio has no analytics', () => {
  const launch = () =>
    fs
      .readdirSync(path.join(PRIV, 'docs/launch'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => 'docs/launch/' + f);
  const copy = [
    'site/index.html',
    'site/press/index.html',
    'README.md',
    'docs/AGENTS.md',
    ...(HAS_PRIV ? ['deck/index.html', ...launch()] : []),
  ];
  const denials = copy.flatMap((f) =>
    (read(f).match(/[^.\n]*\b(no analytics|there(?:'|’)s no analytics|none in the studio)\b[^.\n]*/gi) || []).map(
      (m) => `${f}: "${m.trim()}"`,
    ),
  );
  assert.ok(!denials.length, denials.join('\n'));
});

const WORD = {
  open: 'opens',
  play: 'plays',
  agent: 'agent messages',
  device: 'devices',
  export: 'exports',
  share: 'shares',
  hum: 'hums',
  keep: 'keeps',
};
const privacyAnswers = () => [
  ...(HAS_PRIV
    ? [
        ['faq.md 6', (read('docs/launch/faq.md').match(/\*\*6\.[\s\S]*?(?=\n\*\*7\.)/) || [''])[0]],
        [
          'press-kit.md privacy row',
          (read('docs/launch/press-kit.md').match(/\| \*\*Privacy\*\* \|[^\n]*/) || [''])[0],
        ],
      ]
    : []),
  ['press page privacy row', (read('site/press/index.html').match(/<dt>Privacy<\/dt><dd>[\s\S]*?<\/dd>/) || [''])[0]],
];
for (const [name, text] of privacyAnswers()) {
  test(`${name} names every counted event and the opt-out`, () => {
    const missing = Object.keys(EVENTS).filter((e) => !(WORD[e] && text.includes(WORD[e])));
    assert.ok(text && !missing.length && /Do Not Track|DNT/.test(text), `missing: ${missing.join(', ')}`);
  });
}
