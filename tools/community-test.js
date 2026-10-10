// The community shelf [community] (docs/COMMUNITY-SHELF.md): the index reader, the Browser's From the community
// section, previews, Try and its trust prompt, the agent's find_community_device and its card, and the shelf being off
// anywhere but a local host. Against the small fake index in tools/fixtures/community-fake/ (make.js builds it; no real
// community device is committed to the studio).
//   - node: the reader keeps what it knows and skips the rest (unknown fields, kinds, tiers, cats; reserved ids and
//     handles; House from another origin; URLs outside policy; hostile params and looks; clip types; a newer major;
//     caps); the URL policy; search by category words, never by the agent; revoked only from the bundled copy
//   - off-host: served under another name, ?community= draws nothing, More has no shelf words, the tool says it's off
//   - the section: community entries only, bylines in warm and cool ink, kind words, search, ▶ plays a blob: clip with
//     no device file fetched and nothing registered; a clip of the wrong type isn't played
//   - Try: the prompt (focus on Not now, Play it held 600 ms, no "read it" line for another origin), Not now changes
//     nothing; Play it unticked is one step by you (define + insert, credit) trusted for this page load only, held again
//     after a reload; ticked is stored; Undo; a file that doesn't match its hash and a kernel that fails the check
//     change nothing; an already-trusted hash asks nothing; Keep places nothing
//   - ?new&community-device=: Night Shift, the entry's detail open, no prompt
//   - the bundled copy: its deny list forgets a hash, and the held strip's lines come from it by hash only
//   - the tool: no code or author text by default, untrusted_text on detail, no `trusted` over MCP, put_on is a card
//     that changes nothing, one card per song, three No thanks and it stops, the card's Try lands signed by the agent
//     and kept by you; define_device refuses a shelf kernel (and one with a space changed); the demo agent's ask
//   - the catalog lists it with annotations under 2,048 characters; the Simple view's More finds the shelf
//   - forced live (tools/community-live.js: COMMUNITY_LIVE and TRY_ON read true, served as overdub.test): the shelf
//     reads the bundled index only, and ?community=http://localhost:… is refused, never fetched; a load with the Browser
//     never opened forgets a revoked hash; code allowed from now on and then revoked is held, and Try refuses it with
//     the reason; the prompt word for word (focus, the 600 ms hold, Esc, the box unticked, no "API key"); the emergency
//     off (a routed site-config.json, "community": "off"): no section, no shelf words, the tool off, the deny list kept
//   - the deploy, dry (a stub aws, a fixture overdub-devices repo: tools/fixtures/community-repo.js): the pinned shelf is
//     staged with the index and device files no-cache and the MP3s audio/mpeg no-cache, no WAV; a pin that doesn't
//     match deploys nothing; held back while COMMUNITY_LIVE is false at REF, and with no checkout then it goes on
//   - the frame headers: the local server sends frame-ancestors 'none', X-Frame-Options DENY and nosniff on /app/, the
//     gallery at both its paths and the rest; deploy/headers.sh's policy, dry (live and --next), and against a fake aws
//     (tools/fixtures/fake-aws.js): made, set on the distribution, a second run changes nothing, a hand edit is undone
//   - brand: no pills or coloured edges in the new CSS; no "safe", "secure", "sandboxed", "verified", "marketplace",
//     "buy", "price" or "free trial" in the new copy
//   node tools/community-test.js      (screenshots: tools/.out/community-*.png)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { open, tally } from './pw.js';
import { openLive, LIVE_HOST } from './community-live.js';
import { makeDevicesRepo } from './fixtures/community-repo.js';
import { readIndex, filterEntries, resolveUrl, indexUrlAllowed, LIMITS } from '../app/src/devices/community.js';

const T = tally('community');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures/community-fake');
const FIXURL = '/tools/fixtures/community-fake/';
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const ignorable = (e) => /favicon|AudioContext was not allowed|fonts\.g|getUserMedia|NotAllowedError|NotFoundError/i.test(e);
const section = async (name, fn) => { try { await fn(); } catch (e) { T.ok(false, `${name}: ran to the end (${String(e && e.stack || e).split('\n').slice(0, 3).join(' ')})`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ======================================================================== node: the reader */
await section('reader', async () => {
  const base = 'http://localhost:9/tools/fixtures/community-fake/community-index.json';
  const r = readIndex(read('community-index.json'), { base });
  T.ok(!r.error && r.entries.length === 5 && r.refused === 1 && r.entries.every((e) => e.origin === base), `the fixture reads: ${r.entries.length} entries, the House one refused from a non-bundled index (${r.refused})`);
  const b = readIndex(read('bundled-index.json'), { base: 'http://localhost:9/app/community/community-index.json', bundled: true });
  T.ok(b.entries.length === 6 && b.entries.some((e) => e.tier === 'house' && e.id === 'claude.house-hum') && b.revoked.length === 1 && b.entries.every((e) => e.origin === 'bundled'), `the bundled copy lists the House entry, carries its deny list and origin 'bundled'`);
  const hostileBase = 'http://localhost:9/tools/fixtures/community-fake/hostile-index.json';
  const hz = readIndex(read('hostile-index.json'), { base: hostileBase });
  const json = JSON.stringify(hz);
  T.ok(!/surprise|mystery/.test(json), 'unknown fields at every level are left behind');
  T.ok(hz.revoked.length === 0, 'a deny list from another origin is ignored');
  const ids = hz.entries.map((e) => e.id);
  T.ok(ids.join(',') === 'tester.ok,tester.clip' && hz.skipped === 4 && hz.refused === 11, `unknown kind, tier, cat and a missing field are skipped (${hz.skipped}); reserved ids and handles, a borrowed handle, House from another origin and device URLs outside policy are refused (${hz.refused}); the rest stay (${ids.join(', ')})`);
  const ok = hz.entries[0];
  T.ok(ok.name === 'Ok Name' && ok.request.length <= 500, `text is cleaned and capped ("${ok.name}", request ${ok.request.length} chars)`);
  T.ok(ok.params.length === 1 && ok.params[0].key === 'ok' && ok.params.every((p) => typeof p.min === 'number'), 'a param whose min is markup is dropped; the rest are numbers');
  T.ok(!ok.look.color && !ok.look.shape && ok.look.ink === '#fff' && ok.look.knob === 'chrome', 'a look colour that isn\'t hex and a shape the faces don\'t draw are dropped');
  T.ok(ok.preview.wet.length === 1 && ok.preview.wet[0].type === 'audio/wav', 'a clip of a type the studio doesn\'t play is dropped');
  T.ok(ok.source.url === null, 'a source URL that isn\'t https on an allowed host is no link');
  T.ok(hz.entries[1].preview.wet.length === 0, 'clips outside the index\'s own clips/ are refused one by one');
  const v2 = readIndex({ format: 'overdub-community-index/2', devices: [{}] }, { base });
  T.ok(v2.newer && !v2.entries.length, 'a newer major lists nothing and says so');
  const big = readIndex('x'.repeat(LIMITS.jsonBytes + 1), { base });
  T.ok(big.error && !big.entries.length, 'past 2 MB of JSON nothing is read');
  const many = JSON.parse(read('community-index.json'));
  const one = many.devices[0];
  many.devices = Array.from({ length: LIMITS.entries + 5 }, (_, i) => ({ ...one, id: `tester.e${i}` }));
  const m = readIndex(many, { base });
  T.ok(m.entries.length === LIMITS.entries && m.skipped === 5, `past ${LIMITS.entries} entries the rest are skipped and counted (${m.skipped})`);
  // search
  const names = (q) => filterEntries(r.entries, { q }).map((e) => e.id).join(',');
  T.ok(names('dirty') === 'tester.wrong-hash' && names('echo').startsWith('tester.soft-echo') && names('claude') === '' && names('opus') === '', `search: a category word finds its category ("dirty": ${names('dirty')}); the agent is never searched ("claude": ${names('claude') || 'none'})`);
  T.ok(filterEntries(r.entries, { kind: 'instrument' }).length === 1 && filterEntries(r.entries, { cat: 'time' }).length === 1, 'kind and cat filter');
  // the URL policy
  T.ok(resolveUrl('clips/a.wav', base, { under: 'clips' }) && !resolveUrl('https://example.com/clips/a.wav', base, { under: 'clips' }) && !resolveUrl('data:audio/wav,x', base, { under: 'clips' }) && !resolveUrl('javascript:alert(1)', base, { under: 'clips' }) && !resolveUrl('../clips/a.wav', base, { under: 'clips' }), 'clip URLs: the index\'s own clips/ only');
  const page = 'http://localhost:5/app/';
  T.ok(indexUrlAllowed('/app/community/community-index.json', { page }) && indexUrlAllowed('http://127.0.0.1:4000/i.json', { page }) && !indexUrlAllowed('https://example.com/i.json', { page }) && !indexUrlAllowed('data:application/json,{}', { page }) && !indexUrlAllowed('javascript:1', { page }) && !indexUrlAllowed('http://localhost:4000/i.json', { page: 'https://overdubstudio.com/app/' }), 'index URLs: this site, or localhost from a local page only');
});

/* ======================================================================== brand */
await section('brand', async () => {
  const src = ['app/src/ui/community.js', 'app/src/agent/community-tool.js', 'app/src/devices/community.js'].map((f) => fs.readFileSync(path.join(HERE, '..', f), 'utf8')).join('\n');
  const cssPart = src.slice(src.indexOf('const SHELF_CSS = `'));
  T.ok(!/border-radius:\s*(99|50%)/.test(cssPart) && !/border-left:[^;]*var\(--(human|agent|accent)/.test(cssPart) && !/inset[^;]*box-shadow|box-shadow:[^;]*inset/.test(cssPart), 'the new CSS has no pills, no coloured left edge and no inset stripe');
  // the copy: quoted strings only (comments may name what isn't done)
  const strings = (src.match(/(['`])(?:(?!\1)[^\\\n]|\\.)*\1/g) || []).join(' ');
  const bad = strings.match(/\b(safe|secure|sandboxed|verified|marketplace|buy|price|prices|free trial)\b/gi);
  T.ok(!bad, `the new copy never says safe, secure, sandboxed, verified, marketplace, buy, price or free trial${bad ? ` (found: ${[...new Set(bad)].join(', ')})` : ''}`);
});

/* ======================================================================== the browser */
const errorsOf = (P) => P.errors.filter((e) => !ignorable(e));
async function studio(query, { tryOn = true, width = 1440, height = 900, init = null, routes = null } = {}) {
  const P = await open('/app/', { width, height, query });
  try {
    if (routes) await routes(P.page);
    if (tryOn || init || routes) {
      await P.page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 45000 });
      await P.page.evaluate(({ tryOn, init }) => { localStorage.clear(); if (tryOn) localStorage.setItem('overdub:community-try', '1'); if (init) for (const [k, v] of Object.entries(init)) localStorage.setItem(k, v); }, { tryOn, init });
      await P.page.goto(P.url, { waitUntil: 'load' });
    }
    await P.page.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.overdub?.community && window.overdub.community.state().status !== 'loading', null, { timeout: 45000 });
    return P;
  } catch (e) { await P.close(); throw e; }
}
const E = (P, fn, arg) => P.page.evaluate(fn, arg);
const FIXQ = `community=${FIXURL}community-index.json`;

// off anywhere but a local host
await section('off-host', async () => {
  const P = await open('/app/');
  try {
    const local = new URL(P.url).origin;
    await P.page.route('http://overdub.test/**', async (route) => {
      const u = new URL(route.request().url());
      const res = await route.fetch({ url: local + u.pathname + u.search });
      await route.fulfill({ response: res });
    });
    await P.page.goto(`http://overdub.test/app/?${FIXQ}&community-device=tester.soft-echo`, { waitUntil: 'load' });
    await P.page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 45000 });
    await P.page.waitForTimeout(400);
    const r = await E(P, async () => {
      const app = window.overdub;
      app.ui.show('browser');
      const f = app.ui.workspace?.FEATURES?.find((x) => x.id === 'browser');
      const tool = await app.tools.run('find_community_device', { query: 'echo' }, { by: 'claude' });
      return { on: app.community.on(), section: !!document.querySelector('.cs-group'), words: f ? f.aliases.filter((a) => /shelf|community/.test(a)) : [], tool, url: location.search };
    });
    T.ok(!r.on && !r.section && !r.words.length, `off-host: no section, no shelf words in More (${r.words.join(', ') || 'none'})`);
    T.ok(/isn't on in this studio/.test(r.tool.error || '') && !r.tool.results.length, `off-host: the tool says the shelf isn't on: "${r.tool.error}"`);
    T.ok(!/community/.test(r.url), `off-host: the shelf's parameters leave the address (${r.url || 'none'})`);
  } finally { await P.close(); }
});

// (the fixture's Soft Echo file says other words than its entry, and its requester is a note; Tiny Keys' is a name:
// make.js)
// the section, previews, Try
await section('shelf', async () => {
  const P = await studio(FIXQ);
  const deviceReqs = [];
  P.page.on('request', (q) => { if (/overdub-device\.json/.test(q.url())) deviceReqs.push(q.url()); });
  try {
    await E(P, () => { window.overdub.ui.show('browser'); window.overdub.ui.setOpen('left', true); window.overdub.browser.render(); });
    await P.page.waitForSelector('.cs-group .cs-row');
    const s = await E(P, () => ({
      rows: [...document.querySelectorAll('.cs-row')].map((r) => r.dataset.community),
      human: [...document.querySelectorAll('.cs-row .by-human')].map((x) => x.textContent),
      agent: [...document.querySelectorAll('.cs-row .by-agent')].map((x) => x.textContent),
      kinds: [...document.querySelectorAll('.cs-kind')].map((x) => x.textContent),
      head: document.querySelector('.cs-sec')?.textContent, target: document.querySelector('.cs-target')?.textContent, line: document.querySelector('.cs-line')?.textContent,
    }));
    T.ok(s.rows.length === 5 && !s.rows.includes('claude.house-hum') && /From the community5/.test(s.head), `the section lists the community entries only (${s.rows.length}), with its count in the head`);
    T.ok(s.human.length === 5 && s.human.every((x) => x === 'tester') && s.agent.every((x) => /Claude Opus 5\.5/.test(x)), 'each row signs its author in warm ink and its agent in cool');
    T.ok(s.kinds.join('|') === 'All5|Instruments1|Effects4' && s.target === 'A row here adds nothing: ▶ plays a recording, and Try asks before any code runs.', `kind words with their counts (${s.kinds.join(' · ')}) and the target line: "${s.target}"`);
    T.ok(/^From localhost:\d+: 5 devices, built 5 Oct\./.test(s.line || '') && /Back to the studio’s copy/.test(s.line), `the shelf line names where it came from: "${s.line}"`);
    // kind words and search
    await P.page.click('.cs-kind:nth-child(2)');
    const inst = await E(P, () => [...document.querySelectorAll('.cs-row')].map((r) => r.dataset.community));
    await P.page.click('.cs-kind:nth-child(1)');
    await P.page.fill('.br-q', 'dirty');
    const found = await E(P, () => [...document.querySelectorAll('.cs-row')].map((r) => r.dataset.community));
    await P.page.fill('.br-q', '');
    await P.page.dispatchEvent('.br-q', 'input');
    T.ok(inst.join() === 'tester.tiny-keys' && found.join() === 'tester.wrong-hash', `Instruments shows the one instrument; a search for "dirty" finds the drive (${found.join()})`);
    // ▶ plays the clip from a blob: URL; nothing of the device is fetched or registered
    await P.page.click('.cs-item:has(.cs-row[data-community="tester.soft-echo"]) .cs-play-row');
    await P.page.waitForFunction(() => window.overdub.community.nowPlaying()?.time > 0.05, null, { timeout: 8000 });
    const pl = await E(P, () => ({ ...window.overdub.community.nowPlaying(), reg: window.overdub.devices.listDevices().some((d) => /^tester\./.test(d.id)), stop: document.querySelector('.cs-play-row.on')?.getAttribute('aria-label') }));
    T.ok(pl.id === 'tester.soft-echo' && /^blob:/.test(pl.src) && !pl.paused && pl.volume <= 0.5 && /^Stop/.test(pl.stop || ''), `▶ plays the clip from a blob: URL at half volume or less (${pl.volume}), and says Stop`);
    T.ok(!deviceReqs.length && !pl.reg, `hearing it fetched no device file (${deviceReqs.length}) and registered nothing`);
    // the row opens while it plays: the Browser draws again, and every button for it still says Stop, with the stop glyph
    await P.page.click('.cs-row[data-community="tester.soft-echo"]');
    await P.page.waitForSelector('.cs-detail[data-community="tester.soft-echo"] .cs-play');
    const kept = await E(P, () => [...document.querySelectorAll('[data-cs-play="tester.soft-echo"]:not([data-cs-dry])')].map((b) => ({ on: b.classList.contains('on'), label: b.getAttribute('aria-label'), stop: !!b.querySelector('svg rect') })));
    T.ok(kept.length === 2 && kept.every((b) => b.on && /^Stop /.test(b.label) && b.stop), `after the row opens, the row's and the detail's buttons both still say Stop (${JSON.stringify(kept)})`);
    const det0 = await E(P, () => document.querySelector('.cs-detail').textContent);
    T.ok(!/Asked for by/.test(det0) && !/DRAFT/.test(det0), 'a requester that is a note, not a name, isn\'t drawn as "Asked for by"');
    await P.page.click('.cs-row[data-community="tester.soft-echo"]');
    await E(P, () => window.overdub.community.stop());
    // a clip served as something else isn't played
    await P.page.route('**/clips/tester.tiny-keys.wav', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<b>not audio</b>' }));
    await P.page.click('.cs-item:has(.cs-row[data-community="tester.tiny-keys"]) .cs-play-row');
    await P.page.waitForTimeout(500);
    const wrong = await E(P, () => ({ now: window.overdub.community.nowPlaying(), toast: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | ') }));
    T.ok(!wrong.now && /wasn’t played/.test(wrong.toast), `a clip served with the wrong type isn't played: "${wrong.toast.slice(0, 90)}"`);

    // the detail, and Try's prompt
    await P.page.click('.cs-row[data-community="tester.soft-echo"]');
    await P.page.waitForSelector('.cs-detail[data-community="tester.soft-echo"] .cs-try');
    const d = await E(P, () => { const el = document.querySelector('.cs-detail'); return { text: el.textContent, try: el.querySelector('.cs-try').textContent }; });
    T.ok(/^Try on /.test(d.try) && /The shelf says:/.test(d.text) && !/A person read it/.test(d.text) && /Something that sits back/.test(d.text), `the detail: "${d.try}", the request quoted, and another origin's numbers under "The shelf says:"`);
    const h0 = await E(P, () => ({ hist: window.overdub.store.history.length, trust: window.overdub.trust.size() }));
    await P.page.click('.cs-detail .cs-try');
    await P.page.waitForSelector('.cs-prompt');
    const pr = await E(P, () => ({ focus: document.activeElement?.textContent, go: document.querySelector('.cs-prompt .cs-go').disabled, text: document.querySelector('.cs-prompt').textContent }));
    T.ok(pr.focus === 'Not now' && pr.go, 'the prompt opens with focus on Not now and Play it held');
    T.ok(/can’t confirm that/.test(pr.text) && !/A person read it/.test(pr.text) && /catches mistakes, not malice/.test(pr.text) && /a recording, not a promise/.test(pr.text) && /Fingerprint/.test(pr.text), 'for another origin it says the studio can\'t confirm who asked, and drops "read it"');
    await P.shot('community-prompt');
    await sleep(700);
    T.ok(await E(P, () => !document.querySelector('.cs-prompt .cs-go').disabled), 'Play it is pressable after 600 ms');
    await P.page.keyboard.press('Escape');
    await P.page.waitForTimeout(200);
    const after = await E(P, () => ({ prompt: !!document.querySelector('.cs-prompt'), hist: window.overdub.store.history.length, trust: window.overdub.trust.size(), dev: !!window.overdub.store.get().devices['tester.soft-echo'] }));
    T.ok(!after.prompt && after.hist === h0.hist && after.trust === h0.trust && !after.dev, 'Esc is Not now: nothing changed, nothing trusted');
    T.ok(deviceReqs.length === 1, `Try fetched the device file once (${deviceReqs.length})`);

    // Play it, unticked: this page load only (with the preview playing, which Try stops)
    await P.page.click('.cs-detail .cs-d-hear .cs-play');
    await P.page.waitForFunction(() => window.overdub.community.nowPlaying()?.id === 'tester.soft-echo', null, { timeout: 8000 });
    await P.page.click('.cs-detail .cs-try');
    await P.page.waitForSelector('.cs-prompt');
    await sleep(700);
    await P.page.click('.cs-prompt .cs-go');
    await P.page.waitForFunction(() => !!window.overdub.store.get().devices['tester.soft-echo'], null, { timeout: 30000 });
    const t1 = await E(P, () => {
      const app = window.overdub, last = app.store.history[app.store.history.length - 1];
      const dev = app.store.get().devices['tester.soft-echo'];
      return { label: last.label, name: dev.name, blurb: dev.blurb, request: dev.request, playing: app.community.nowPlaying(), by: last.by, ops: (last.ops || last.forward || []).map((o) => o.type), credit: dev.credit, devBy: dev.by, trust: app.trust.size(), forNow: app.trust.forNow(dev.kernel), held: app.devices.heldDevices().map((x) => x.id), on: app.store.get().tracks.some((t) => t.inserts.some((i) => i.device === 'tester.soft-echo')), toast: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '), hist: app.store.history.length };
    });
    T.ok(t1.by === 'you' && t1.hist === h0.hist + 1 && t1.on && t1.devBy === 'you', `Play it: one step by you (${t1.ops.join(', ') || 'ops'}), the device on the track`);
    T.ok(t1.credit && t1.credit.author === 'tester' && t1.credit.license === 'MIT-0' && /^[0-9a-f]{64}$/.test(t1.credit.sha256), 'the song carries its credit (author, licence, hash)');
    T.ok(t1.name === 'Soft Echo' && /Soft Echo/.test(t1.label || '') && !/House Hum/.test(t1.label || '') && !/Not what/.test(t1.blurb || '') && /Something that sits back/.test(t1.request || '') && !/FILE REQUEST/.test(t1.request || ''), `the song (and History: "${t1.label}") gets the entry's name, blurb and request, not the file's ("${t1.name}", "${(t1.request || '').slice(0, 40)}")`);
    T.ok(!t1.playing, 'Try stops the preview: what plays next is the song');
    T.ok(t1.trust === h0.trust && t1.forNow && !t1.held.length, `unticked, it runs for this page load only (stored set ${h0.trust} → ${t1.trust})`);
    T.ok(/Soft Echo is on .+\./.test(t1.toast) && /Undo/.test(t1.toast), `the toast: "${t1.toast.slice(0, 100)}"`);
    await P.shot('community-tried');
    // Undo takes both ops out; trust stays as chosen
    await E(P, () => window.overdub.store.undo());
    const u = await E(P, () => ({ dev: !!window.overdub.store.get().devices['tester.soft-echo'], on: window.overdub.store.get().tracks.some((t) => t.inserts.some((i) => i.device === 'tester.soft-echo')), forNow: window.overdub.trust.forNow(window.overdub.store.history.length >= 0 ? '' : '') }));
    T.ok(!u.dev && !u.on, 'Undo takes the device and its placement out in one step');
    await E(P, () => window.overdub.store.redo());
    // a reload: the song keeps the device, held (its code was allowed for that page load only)
    await sleep(800);
    await P.page.reload({ waitUntil: 'load' });
    await P.page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 45000 });
    await E(P, () => window.overdub.community.ready());
    const rl = await E(P, () => window.overdub.devices.heldDevices().map((x) => x.id));
    T.ok(rl.includes('tester.soft-echo'), `after a reload it's held again (${rl.join(', ')})`);
    // on the track already: the detail says so, and a second Try doesn't stack a second copy
    const echoes = () => E(P, () => window.overdub.store.get().tracks.reduce((n, t) => n + t.inserts.filter((i) => i.device === 'tester.soft-echo').length, 0));
    const on = await E(P, () => { const app = window.overdub, t = app.store.get().tracks.find((x) => x.inserts.some((i) => i.device === 'tester.soft-echo')); app.ui.select({ track: t.id, clip: null, insert: null }); app.ui.show('browser'); app.ui.setOpen('left', true); return t.name; });
    await E(P, () => window.overdub.community.reach('tester.soft-echo', 'you'));
    await P.page.waitForSelector('.cs-detail[data-community="tester.soft-echo"] .cs-try');
    const st0 = await E(P, () => ({ hist: window.overdub.store.history.length, btn: document.querySelector('.cs-detail .cs-try').textContent, dis: document.querySelector('.cs-detail .cs-try').getAttribute('aria-disabled') }));
    const n0 = await echoes();
    const again = await E(P, async () => { const app = window.overdub; return app.community.tryEntry(app.community.state().entries.find((e) => e.id === 'tester.soft-echo')); });
    const n1 = await echoes();
    T.ok(st0.btn === `On ${on} already` && st0.dis === 'true' && again.already && n1 === n0 && await E(P, () => window.overdub.store.history.length) === st0.hist && await E(P, () => !document.querySelector('.cs-prompt')), `a second Try on ${on} stacks nothing: "${st0.btn}", ${n0} → ${n1} copies`);
    // ticked: stored (on a track it isn't on yet); then Try again asks nothing
    await E(P, () => { const app = window.overdub, t = app.store.get().tracks.find((x) => x.kind === 'instrument' && !x.inserts.some((i) => i.device === 'tester.soft-echo')); app.ui.select({ track: t.id, clip: null, insert: null }); });
    await P.page.waitForSelector('.cs-detail[data-community="tester.soft-echo"] .cs-try:not([aria-disabled])');
    const tr0 = await E(P, () => window.overdub.trust.size());
    await P.page.click('.cs-detail .cs-try');
    await P.page.waitForSelector('.cs-prompt');
    await sleep(700);
    await P.page.check('#cs-remember');
    await P.page.click('.cs-prompt .cs-go');
    await P.page.waitForFunction((n) => window.overdub.trust.size() > n, tr0, { timeout: 30000 }).catch(() => {});
    await P.page.waitForTimeout(300);
    const tr1 = await E(P, () => window.overdub.trust.size());
    T.ok(tr1 === tr0 + 1, `ticked, the hash is stored (${tr0} → ${tr1})`);
    // a new track: asks nothing (trusted now), and comes with a part to hear it on, not an empty track
    const nt = await E(P, async () => {
      const app = window.overdub, n0 = app.store.get().tracks.length;
      const r = await app.community.tryEntry(app.community.state().entries.find((e) => e.id === 'tester.soft-echo'), { track: 'new' });
      const t = app.store.get().tracks.find((x) => x.id === r.track);
      return { r, n: app.store.get().tracks.length - n0, prompt: !!document.querySelector('.cs-prompt'), inst: t?.instrument?.device, inserts: t?.inserts.map((i) => i.device), clips: t?.clips.map((c) => c.notes.length), toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() };
    });
    T.ok(nt.r.ok && nt.n === 1 && !nt.prompt, 'Try on a hash this browser already trusts asks nothing');
    T.ok(nt.inst === 'core.keys' && nt.inserts?.join() === 'tester.soft-echo' && nt.clips?.length === 1 && nt.clips[0] > 0 && /two-bar strum going through it/.test(nt.toast || ''), `an effect tried on a new track gets two bars of strum to play through it (${JSON.stringify({ inst: nt.inst, clips: nt.clips })}): "${(nt.toast || '').slice(0, 110)}"`);

    // refusals
    const refuse = async (id) => {
      await E(P, () => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
      const before = await E(P, () => ({ hist: window.overdub.store.history.length, trust: window.overdub.trust.size() }));
      await E(P, (i) => window.overdub.community.reach(i, 'you'), id);
      await P.page.waitForSelector(`.cs-detail[data-community="${id}"] .cs-try`);
      await P.page.click('.cs-detail .cs-try');
      // (the prompt only for code that gets that far)
      try { await P.page.waitForSelector('.cs-prompt', { timeout: 2500 }); await sleep(700); await P.page.click('.cs-prompt .cs-go'); } catch { /* refused before asking */ }
      await P.page.waitForFunction(() => [...document.querySelectorAll('.ew-toast')].some((t) => /Refused|failed it|isn’t on the song/.test(t.textContent)), null, { timeout: 30000 });
      const r = await E(P, () => ({ hist: window.overdub.store.history.length, trust: window.overdub.trust.size(), toast: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).filter((x) => /Refused|failed it/.test(x)).pop() }));
      return { before, r };
    };
    const wh = await refuse('tester.wrong-hash');
    T.ok(wh.r.hist === wh.before.hist && wh.r.trust === wh.before.trust && /doesn’t match the shelf’s fingerprint/.test(wh.r.toast || ''), `a file that doesn't match its hash is refused, nothing changed (${JSON.stringify([wh.before, wh.r.hist, wh.r.trust])}): "${wh.r.toast}"`);
    const fc = await refuse('tester.fails-check');
    T.ok(fc.r.hist === fc.before.hist && fc.r.trust === fc.before.trust && /ran in the check and failed it/.test(fc.r.toast || '') && !(await E(P, () => window.overdub.trust.forNow('x'))), `a kernel that fails the check: nothing stored or dispatched: "${(fc.r.toast || '').slice(0, 110)}"`);
    // Keep: defines, places nothing
    await E(P, () => window.overdub.community.reach('tester.tiny-keys', 'you'));
    await P.page.waitForSelector('.cs-detail[data-community="tester.tiny-keys"] .cs-keep');
    const k0 = await E(P, () => JSON.stringify(window.overdub.store.get().tracks.map((t) => [t.instrument?.device, t.inserts.map((i) => i.device)])));
    await P.page.click('.cs-detail .cs-keep');
    await P.page.waitForSelector('.cs-prompt');
    await sleep(700);
    await P.page.click('.cs-prompt .cs-go');
    await P.page.waitForFunction(() => !!window.overdub.store.get().devices['tester.tiny-keys'], null, { timeout: 30000 });
    const k1 = await E(P, () => JSON.stringify(window.overdub.store.get().tracks.map((t) => [t.instrument?.device, t.inserts.map((i) => i.device)])));
    T.ok(k0 === k1, 'Keep it in this song, on no track, defines the device and places nothing');
    T.ok(/Asked for by a friend at the pub/.test(await E(P, () => document.querySelector('.cs-detail[data-community="tester.tiny-keys"]')?.textContent || '')), 'a requester that is a name is drawn as "Asked for by"');
    // Read the code shows text, runs nothing
    await E(P, () => window.overdub.community.reach('tester.spinner', 'you'));
    await P.page.waitForSelector('.cs-detail[data-community="tester.spinner"] .cs-read');
    await P.page.click('.cs-detail .cs-read');
    await P.page.waitForFunction(() => !document.querySelector('.cs-detail .cs-code')?.hidden);
    const code = await E(P, () => ({ text: document.querySelector('.cs-detail .cs-code').textContent, reg: !!window.overdub.devices.getDevice('tester.spinner') }));
    T.ok(/fingerprint [0-9a-f]{12}/.test(code.text) && /for \(;;\)/.test(code.text) && !code.reg, 'Read the code shows the kernel as text under its fingerprint, and registers nothing');
    T.ok(!errorsOf(P).length, `no page errors (${errorsOf(P).slice(0, 2).join(' | ')})`);
  } finally { await P.close(); }
});

// a link from the site
await section('link', async () => {
  const P = await studio(`new&${FIXQ}&community-device=tester.soft-echo`);
  try {
    await P.page.waitForSelector('.cs-detail[data-community="tester.soft-echo"]', { timeout: 15000 });
    const r = await E(P, () => {
      const app = window.overdub, sel = app.ui.state.selection.track;
      return { title: app.store.get().title, track: app.store.get().tracks.find((t) => t.id === sel)?.name, prompt: !!document.querySelector('.cs-prompt'), url: location.search, try: document.querySelector('.cs-detail .cs-try').textContent };
    });
    T.ok(r.title === 'Night Shift' && r.track === 'Hook' && r.try === 'Try on Hook' && !r.prompt, `?new&community-device= opens Night Shift with the detail open, aimed at the Hook ("${r.try}"), and no prompt`);
    T.ok(!/community-device/.test(r.url), 'the parameter leaves the address');
    await P.shot('community-link');
  } finally { await P.close(); }
});

// held back (TRY_ON off, no developer flag): no Try or Keep to press, a plain line instead; hearing and reading stay
await section('held-back', async () => {
  const P = await studio(FIXQ, { tryOn: false, init: { 'overdub:community-try': '0' } });
  try {
    await E(P, () => window.overdub.community.reach('tester.soft-echo', 'you'));
    await P.page.waitForSelector('.cs-detail[data-community="tester.soft-echo"]');
    const d = await E(P, () => { const el = document.querySelector('.cs-detail'); return { tryBtn: !!el.querySelector('.cs-try'), keep: !!el.querySelector('.cs-keep'), read: !!el.querySelector('.cs-read'), play: !!el.querySelector('.cs-play'), held: el.querySelector('.cs-held')?.textContent || '' }; });
    T.ok(!d.tryBtn && !d.keep && d.read && d.play && /isn’t open yet/.test(d.held) && !/SECURITY|audio thread/.test(d.held), `held back: no Try or Keep, ▶ and Read the code stay, and the line says so plainly ("${d.held}")`);
  } finally { await P.close(); }
});

// the studio's own copy: deny list, held lines, vouched
await section('bundled', async () => {
  const P = await open('/app/');
  try {
    await P.page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 45000 });
    await P.page.route('**/app/community/**', async (route) => {
      const u = new URL(route.request().url());
      const f = u.pathname.replace(/^\/app\/community\//, '');
      const file = f === 'community-index.json' ? 'bundled-index.json' : f;
      const p = path.join(FIX, file);
      if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: '' });
      // (one entry in the studio's own copy whose own numbers say it didn't pass)
      let body = fs.readFileSync(p);
      if (file === 'bundled-index.json') { const j = JSON.parse(body); j.devices.find((d) => d.id === 'tester.fails-check').measured.ok = false; body = JSON.stringify(j); }
      await route.fulfill({ status: 200, contentType: /\.wav$/.test(p) ? 'audio/wav' : 'application/json', body });
    });
    const revoked = read('revoked-kernel.txt');
    await P.page.evaluate((k) => { localStorage.clear(); localStorage.setItem('overdub:community-try', '1'); const app = window.overdub; app.trust.allow([k]); }, revoked);
    const stored = await E(P, (k) => window.overdub.trust.trusts(k), revoked);
    await P.page.reload({ waitUntil: 'load' });
    await P.page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 45000 });
    await E(P, () => window.overdub.community.ready());
    const r = await E(P, async (k) => {
      const app = window.overdub;
      const echo = app.community.state().entries.find((e) => e.id === 'tester.soft-echo');
      const lines = app.community.heldLines([{ name: 'Gone', hash: await (async () => { const { kernelHash } = await import('/app/src/devices/trust.js'); return kernelHash(k); })() }, { name: 'Soft Echo', hash: echo.sha256 }, { name: 'Lookalike', hash: '0'.repeat(64) }]);
      app.ui.show('browser'); app.ui.setOpen('left', true); app.browser.render();
      return { trusted: app.trust.trusts(k), lines, bundled: app.community.state().bundled, n: app.community.state().entries.length };
    }, revoked);
    T.ok(stored && !r.trusted, 'a hash on the bundled deny list is forgotten here');
    T.ok(r.lines.length === 2 && /Gone was taken off the shelf: It was taken down/.test(r.lines[0]) && /Soft Echo is on the community shelf, by tester with Claude Opus 5\.5/.test(r.lines[1]), `the held strip's lines come from the studio's copy, by hash: ${r.lines.join(' / ')}`);
    T.ok(r.bundled && r.n === 5, 'the bundled copy lists its community entries (the House one stays under Instruments and Effects)');
    await E(P, () => window.overdub.community.reach('tester.soft-echo', 'you'));
    await P.page.waitForSelector('.cs-detail .cs-try');
    const d = await E(P, () => document.querySelector('.cs-detail').textContent);
    T.ok(/A person read it before it went on the shelf\. It passed the studio check\./.test(d) && !/The shelf says:/.test(d), 'the studio\'s own copy is taken at its word in the detail');
    await P.page.click('.cs-detail .cs-try');
    await P.page.waitForSelector('.cs-prompt');
    const pt = await E(P, () => document.querySelector('.cs-prompt').textContent);
    T.ok(/tester asked for it, Claude Opus 5\.5 \(Claude Code\) wrote it\. A person read it/.test(pt) && /in this browser tab/.test(pt), `the prompt for the studio's copy: "${pt.slice(0, 120)}…"`);
    await P.page.keyboard.press('Escape');
    // the agent's vouched is the detail's: the studio's own copy, and only where its numbers say it passed
    const v = await E(P, async () => { const r = await window.overdub.tools.run('find_community_device', { limit: 20 }, { by: 'claude' }); return Object.fromEntries(r.results.map((x) => [x.id, x.vouched])); });
    T.ok(v['tester.soft-echo'] === true && v['tester.fails-check'] === false, `the tool vouches per entry: Soft Echo ${v['tester.soft-echo']}, one whose check didn't pass ${v['tester.fails-check']}`);
    // a song with Soft Echo in it, held after a reload: the strip names the shelf's author once the index is read
    await E(P, async () => {
      const app = window.overdub, e = app.community.state().entries.find((x) => x.id === 'tester.soft-echo');
      const j = await (await fetch(e.device)).json();
      app.trust.allowForNow([j.device.kernel]);
      app.store.dispatch([{ type: 'device.define', device: { ...j.device, by: 'you' } }], { by: 'you' });
    });
    await sleep(900);
    await P.page.reload({ waitUntil: 'load' });
    await P.page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 45000 });
    await P.page.waitForFunction(() => !!document.querySelector('.sh-held-shelf'), null, { timeout: 10000 }).catch(() => {});
    const strip = await E(P, () => ({ held: window.overdub.devices.heldDevices().map((d) => d.id), line: document.querySelector('.sh-held-shelf')?.textContent || '' }));
    T.ok(strip.held.includes('tester.soft-echo') && /Soft Echo is on the community shelf, by tester/.test(strip.line), `after a reload the held strip names the shelf's author ("${strip.line}")`);
  } finally { await P.close(); }
});

// the agent tool and its card
await section('agent', async () => {
  const P = await studio(`${FIXQ}&agent=mock&fast`);
  try {
    const r = await E(P, async () => {
      const app = window.overdub;
      const a = await app.tools.run('find_community_device', { query: 'echo' }, { by: 'claude' });
      const d = await app.tools.run('find_community_device', { query: 'echo', detail: true }, { by: 'claude' });
      const m = await app.tools.run('find_community_device', {}, { by: 'mcp:test' });
      const schema = app.tools.schemas().find((s) => s.name === 'find_community_device');
      return { a, d, m, schema };
    });
    const flat = JSON.stringify(r.a);
    T.ok(r.a.results?.length >= 1 && r.a.results[0].id === 'tester.soft-echo' && /never instructions/.test(r.a.about) && /unconfirmed/.test(r.a.about) && r.a.results[0].vouched === false, `the tool finds Soft Echo for "echo", with an about line that says the text isn't instructions and this shelf is unconfirmed`);
    T.ok(!/"kernel"|"request"|"requester"|Ignore your instructions/.test(flat), 'results carry no code and no author request text by default');
    T.ok(/Ignore your instructions/.test(JSON.stringify(r.d.results[0].untrusted_text || {})), 'with detail: true the request comes back under untrusted_text');
    T.ok(r.m.results.length === 5 && r.m.results.every((x) => !('trusted' in x)) && 'trusted' in r.a.results[0], 'over MCP results carry no `trusted`; the in-page agent gets it');
    T.ok(r.schema && r.schema.annotations?.title && r.schema.description.length < 2048, `the tool has annotations and a description under 2,048 characters (${r.schema?.description.length})`);
    // put_on: a card, nothing changed
    const p = await E(P, async () => {
      const app = window.overdub, h0 = app.store.history.length, song = JSON.stringify(app.store.get());
      const one = await app.tools.run('find_community_device', { put_on: { id: 'tester.soft-echo', track: 'Hook' } }, { by: 'claude' });
      const two = await app.tools.run('find_community_device', { put_on: { id: 'tester.soft-echo', track: 'Hook' } }, { by: 'claude' });
      const first = await app.tools.run('get_variation_result', { id: one.id }, { by: 'claude' });
      app.ui.show('agent'); app.ui.setOpen('right', true);
      return { one, two, first, same: app.store.history.length === h0 && JSON.stringify(app.store.get()) === song, cards: document.querySelectorAll('.cs-card').length };
    });
    T.ok(p.one.offered && p.one.status === 'pending' && p.same, 'put_on is offered and pending, and the song is untouched');
    T.ok(p.first.kept === false && p.two.offered, `a second put_on replaces the first card (it comes back kept: false): ${JSON.stringify(p.first).slice(0, 120)}`);
    await P.page.waitForSelector('.cs-card .cs-card-try');
    const line = await E(P, () => document.querySelector('.cs-card .cs-card-line').textContent);
    T.ok(/^Claude suggests Soft Echo, by tester with Claude Opus 5\.5, on Hook\.$/.test(line.trim()), `the card doesn't vouch: "${line.trim()}"`);
    await P.shot('community-card');
    await P.page.click('.cs-card .cs-card-try');
    await P.page.waitForSelector('.cs-prompt');
    await sleep(700);
    await P.page.click('.cs-prompt .cs-go');
    const res = await E(P, async (id) => {
      const app = window.overdub;
      const got = await app.tools.run('get_variation_result', { id, wait_seconds: 30 }, { by: 'claude' });
      const last = app.store.history[app.store.history.length - 1];
      return { got, by: last.by, keptBy: last.keptBy, devBy: app.store.get().devices['tester.soft-echo']?.by };
    }, p.two.id);
    T.ok(res.got.kept === true && res.by === 'claude' && res.keptBy === 'you' && res.devBy === 'you', `the card's Try lands signed by the agent and kept by you; the device is yours (${JSON.stringify({ kept: res.got.kept, by: res.by, device: res.devBy })})`);
    // the demo agent
    await E(P, () => { const app = window.overdub; for (const r of app.tools.requests.values()) if (r.kind === 'shelf' && r.status === 'pending') r.status = 'done'; });
    const before = await E(P, () => window.overdub.store.history.length);
    await E(P, () => window.overdub.agent.send('find me a delay someone made'));
    await P.page.waitForFunction(() => [...window.overdub.tools.requests.values()].some((r) => r.kind === 'shelf' && r.status === 'pending'), null, { timeout: 20000 }).catch(() => {});
    const demo = await E(P, () => ({ card: [...window.overdub.tools.requests.values()].find((r) => r.kind === 'shelf' && r.status === 'pending')?.entry?.id, steps: window.overdub.store.history.length }));
    T.ok(demo.card === 'tester.soft-echo' && demo.steps === before, `the demo agent: "find me a delay someone made" raises a shelf card (${demo.card}), not a new device`);
    // three No thanks and the tool stops raising cards
    const nos = [];
    for (let i = 0; i < 3; i++) {
      await E(P, () => window.overdub.tools.run('find_community_device', { put_on: { id: 'tester.tiny-keys' } }, { by: 'claude' }));
      await P.page.waitForSelector('.cs-card .cs-card-no');
      await P.page.click('.cs-card .cs-card-no');
      nos.push(i);
    }
    const fourth = await E(P, () => window.overdub.tools.run('find_community_device', { put_on: { id: 'tester.tiny-keys' } }, { by: 'claude' }));
    T.ok(!fourth.offered && /said no to these/.test(fourth.error || ''), `after three No thanks it raises no card: "${fourth.error}"`);
    // no tool reaches trust
    const src = fs.readFileSync(path.join(HERE, '../app/src/agent/community-tool.js'), 'utf8');
    T.ok(!/trust\.(allow|allowForNow|play)\b|trust\?\.(allow|allowForNow|play)\b/.test(src), 'the tool never calls trust.allow, allowForNow or play');
    // the side door
    const sd = await E(P, async () => {
      const app = window.overdub;
      const st = app.community.state().entries.find((e) => e.id === 'tester.fails-check');
      const txt = await (await fetch(st.device)).text();
      const k = JSON.parse(txt).device.kernel;
      const a = await app.tools.run('define_device', { device: { id: 'copy-a', name: 'Copy', kind: 'effect', params: [{ key: 'mix', label: 'MIX', min: 0, max: 100, def: 50 }], kernel: k } }, { by: 'claude' });
      const b = await app.tools.run('define_device', { device: { id: 'copy-b', name: 'Copy', kind: 'effect', params: [{ key: 'mix', label: 'MIX', min: 0, max: 100, def: 50 }], kernel: k.replace('return {', 'return  {').replace(/\bL\b/g, 'Left') } }, { by: 'claude' });
      return { a, b, defined: Object.keys(app.store.get().devices).filter((x) => /copy/.test(x)) };
    });
    T.ok(sd.a.refused && /from the community shelf/.test(sd.a.error) && sd.b.refused && !sd.defined.length, `define_device refuses a shelf kernel, as it is and with its spacing and names changed ("${sd.a.error}")`);
    T.ok(!errorsOf(P).length, `no page errors (${errorsOf(P).slice(0, 2).join(' | ')})`);
  } finally { await P.close(); }
});

// the catalog, and Find
await section('catalog', async () => {
  const { catalogSchemas } = await import('../app/src/agent/tools.js');
  const cat = await catalogSchemas();
  const s = cat.find((x) => x.name === 'find_community_device');
  T.ok(s && s.annotations && s.annotations.readOnlyHint === false && s.annotations.destructiveHint === false, `the catalog lists find_community_device with its annotations (${cat.length} tools)`);
});
await section('find', async () => {
  const P = await studio(FIXQ, { width: 390, height: 664 });
  try {
    const r = await E(P, async () => {
      const app = window.overdub;
      const { rank } = await import('/app/src/ui/workspace.js');
      const f = app.ui.workspace.FEATURES.find((x) => x.id === 'browser');
      return { shelf: rank(f, 'shelf'), community: rank(f, 'community'), view: app.ui.workspace.view() };
    });
    T.ok(r.view === 'full' && r.shelf != null && r.community != null, `in the studio (one view), Find finds Instruments and effects by "shelf" and "community"`);
    // Find, "community", Go to: the Browser opens with the shelf in view, and Find gets out of the way
    await E(P, () => window.overdub.ui.workspace.openFind({ query: 'community' }));
    await P.page.waitForSelector('.ws-more .ws-row[data-ws="browser"]');
    const purpose = await E(P, () => document.querySelector('.ws-more .ws-row[data-ws="browser"] .ws-row-w')?.textContent || '');
    await P.page.click('.ws-more .ws-row[data-ws="browser"]');
    await P.page.waitForFunction(() => { const g = document.querySelector('.cs-group'); if (!g) return false; const r = g.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight - 80; }, null, { timeout: 8000 }).catch(() => {});
    const m = await E(P, () => { const g = document.querySelector('.cs-group'); const r = g?.getBoundingClientRect(); return { top: r ? Math.round(r.top) : null, h: innerHeight, more: !!document.querySelector('.ws-more') }; });
    T.ok(/community shelf/.test(purpose) && m.top != null && m.top >= 0 && m.top < m.h - 80 && !m.more, `Find, "community", Go to: the shelf's head is on screen (top ${m.top} of ${m.h}), Find closed, and its row says the shelf is in there ("${purpose}")`);
    await P.shot('community-more-add');
    // on a phone, the row's ▶ is a 40 px target
    await E(P, () => window.overdub.community.reach(null, 'you'));
    await P.page.waitForSelector('.cs-play-row');
    const sz = await E(P, () => [...document.querySelectorAll('.cs-play-row')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    T.ok(sz.length === 5 && sz.every(([w, h]) => w >= 40 && h >= 40), `at 390 px each row's ▶ is at least 40 × 40 (${sz.map((x) => x.join('×')).join(', ')})`);
    await P.shot('community-phone');
  } finally { await P.close(); }
});

// forced live (R1): the flag on, a host that isn't local; the only index read is the studio's own
await section('forced-live', async () => {
  const P = await openLive('/app/', { query: (local) => `community=${encodeURIComponent(`http://localhost:${new URL(local).port}${FIXURL}community-index.json`)}`, bundled: FIX });
  try {
    await P.page.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.overdub?.community && window.overdub.community.state().status !== 'loading', null, { timeout: 45000 });
    await E(P, () => window.overdub.community.ready());
    const r = await E(P, () => { const s = window.overdub.community.state(); return { on: window.overdub.community.on(), bundled: s.bundled, source: s.source, n: s.entries.length, host: location.host }; });
    const indexes = P.requests.filter((u) => new URL(u).pathname.endsWith('community-index.json'));
    T.ok(P.rewritten.includes('/app/src/ui/community.js') && r.on && r.host === LIVE_HOST, `forced live: COMMUNITY_LIVE reads true on ${r.host} (rewritten: ${P.rewritten.join(', ')})`);
    T.ok(r.bundled && r.source === 'bundled' && r.n === 5, `forced live: ?community=http://localhost:… is refused and the shelf is the studio's own copy (${r.source}, ${r.n} entries)`);
    T.ok(indexes.length >= 1 && indexes.every((u) => u === `http://${LIVE_HOST}/app/community/community-index.json`), `forced live: the only index fetched is /app/community/ (${[...new Set(indexes)].join(', ')})`);
    T.ok(!errorsOf(P).length, `forced live: no page errors (${errorsOf(P).slice(0, 2).join(' | ')})`);
  } finally { await P.close(); }
});

// on the live site (forced live), the shelf read on every load with the Browser never opened (R12); a device trusted
// from now on, then revoked: held, and Try refuses with the reason (R11); the prompt as it ships (R18). The bundled
// copy is a copy of the fixture's, in a temp directory, so the revoke can land between two loads.
await section('live-revoke', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-live-'));
  fs.cpSync(FIX, dir, { recursive: true });
  const REASON = 'It hid a second effect in its code.';
  const P = await openLive('/app/', { bundled: dir });
  const loaded = () => P.page.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.overdub?.community && window.overdub.community.state().status !== 'loading', null, { timeout: 45000 });
  try {
    await loaded();
    await E(P, () => window.overdub.community.ready());
    const gone = read('revoked-kernel.txt');
    // a song with Soft Echo in it, its code allowed from now on, and the deny list's kernel allowed from now on too
    const before = await E(P, async (k) => {
      const app = window.overdub, e = app.community.state().entries.find((x) => x.id === 'tester.soft-echo');
      const j = await (await fetch(e.device)).json();
      app.trust.allow([j.device.kernel, k]);
      app.store.dispatch([{ type: 'device.define', device: { ...j.device, by: 'you' } }], { by: 'you' });
      return { kernel: j.device.kernel, name: j.device.name, sha: e.sha256, trusted: app.trust.trusts(j.device.kernel) && app.trust.trusts(k), gone: app.trust.trusts(k) };
    }, gone);
    await sleep(900);
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'bundled-index.json'), 'utf8'));
    j.revoked.push({ sha256: before.sha, reason: REASON, at: '2026-10-10' });
    fs.writeFileSync(path.join(dir, 'bundled-index.json'), JSON.stringify(j, null, 2));
    P.requests.length = 0;
    await P.page.reload({ waitUntil: 'load' });
    await loaded();
    await E(P, () => window.overdub.community.ready());
    // nothing here opens the Browser: the load alone reads the index and applies its deny list
    const r = await E(P, async ({ kernel, gone }) => {
      const app = window.overdub;
      return { on: app.community.on(), echo: app.trust.trusts(kernel), gone: app.trust.trusts(gone), held: app.devices.heldDevices().map((d) => d.id), listed: app.community.state().entries.some((e) => e.id === 'tester.soft-echo'), reached: !!document.querySelector('.cs-detail') };
    }, { kernel: before.kernel, gone });
    const indexes = P.requests.filter((u) => /community-index\.json$/.test(u)), files = P.requests.filter((u) => /overdub-device\.json/.test(u));
    T.ok(before.trusted && r.on && !r.gone && indexes.length >= 1 && !files.length && !r.reached, `R12: on a load with the Browser never opened, the bundled index is read (${indexes.length} request${indexes.length === 1 ? '' : 's'}, no device file) and a revoked hash is forgotten`);
    await P.page.waitForFunction(() => /taken off the shelf/.test(document.querySelector('.sh-held-shelf')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
    const line = await E(P, () => document.querySelector('.sh-held-shelf')?.textContent || '');
    T.ok(!r.echo && r.held.includes('tester.soft-echo') && !r.listed && line.includes(`${before.name} was taken off the shelf: ${REASON}`), `R11: code allowed from now on and then revoked is forgotten, held in the song and off the list; the held strip says "${line.trim()}" (the song's name for it: the revoke carries none)`);
    const tr = await E(P, async ({ text, reason }) => {
      const app = window.overdub;
      const { readIndex } = await import('/app/src/devices/community.js');
      // the entry as an earlier load (or an agent's card) had it
      const e = readIndex(text, { base: new URL('/app/community/community-index.json', location.href).href, bundled: true }).entries.find((x) => x.id === 'tester.soft-echo');
      const h0 = app.store.history.length;
      const out = await app.community.tryEntry(e);
      const toast = [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | ');
      return { out, prompt: !!document.querySelector('.cs-prompt'), same: app.store.history.length === h0, trusted: app.trust.trusts((await (await fetch(e.device)).json()).device.kernel), toast, want: `Soft Echo was taken off the shelf: ${reason}` };
    }, { text: read('bundled-index.json'), reason: REASON });
    T.ok(!tr.out.ok && tr.out.error === tr.want && !tr.prompt && tr.same && !tr.trusted && tr.toast.includes(tr.want), `R11: Try refuses a revoked device, asks nothing and changes nothing: "${tr.out.error}"`);

    // R18: the prompt for the studio's own copy, word for word
    await E(P, () => window.overdub.community.reach('tester.spinner', 'you'));
    await P.page.waitForSelector('.cs-detail[data-community="tester.spinner"] .cs-try');
    const e = await E(P, () => { const app = window.overdub, x = app.community.state().entries.find((y) => y.id === 'tester.spinner'); return { sha: x.sha256, on: app.community.targetFor(x).name, agent: x.agent }; });
    await P.page.click('.cs-detail .cs-try');
    await P.page.waitForSelector('.cs-prompt');
    const q = () => E(P, () => { const el = document.querySelector('.cs-prompt'); const t = (s) => el.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim(); return { p1: t('.cs-p1'), p2: t('.cs-p2'), fp: t('.cs-fp'), box: t('.cs-remember'), ticked: el.querySelector('#cs-remember').checked, go: t('.cs-go'), no: t('.cs-no'), alt: !!el.querySelector('.cs-alt'), focus: document.activeElement?.textContent, held: el.querySelector('.cs-go').disabled, all: el.textContent }; });
    const p0 = await q();
    await sleep(300);
    const p300 = await q();
    T.ok(p0.p1 === `Spinner is code. tester asked for it, ${e.agent} wrote it. A person read it before it went on the shelf.`, `R18: "${p0.p1}"`);
    T.ok(p0.p2 === 'It runs on the studio’s audio thread, in this browser tab, beside your songs. It can’t reach the network or your files from there, but it can change how other devices sound. The check catches mistakes, not malice. The clip is a recording, not a promise.', `R18: "${p0.p2}"`);
    T.ok(p0.fp === `Fingerprint ${e.sha.slice(0, 12)} · Read the code` && p0.box === 'Run it in any song from now on' && !p0.ticked && p0.go === `Play it on ${e.on}` && p0.no === 'Not now' && !p0.alt, `R18: "${p0.fp}", "${p0.box}" unticked, [${p0.go}] ${p0.no}`);
    T.ok(p0.focus === 'Not now' && p0.held && p300.held && p300.focus === 'Not now', 'R18: focus on Not now, and Play it is still held 300 ms in');
    await sleep(400);
    T.ok(await E(P, () => !document.querySelector('.cs-prompt .cs-go').disabled), 'R18: Play it is pressable after 600 ms');
    await P.shot('community-prompt-live');
    const h1 = await E(P, () => ({ hist: window.overdub.store.history.length, trust: window.overdub.trust.size() }));
    await P.page.keyboard.press('Escape');
    await P.page.waitForTimeout(200);
    const h2 = await E(P, () => ({ prompt: !!document.querySelector('.cs-prompt'), hist: window.overdub.store.history.length, trust: window.overdub.trust.size() }));
    T.ok(!h2.prompt && h2.hist === h1.hist && h2.trust === h1.trust, 'R18: Esc is Not now: nothing changed, nothing trusted');
    const src = fs.readFileSync(path.join(HERE, '../app/src/ui/community.js'), 'utf8');
    T.ok(!/api.?key/i.test(p0.all) && !/api.?key|keyHere/i.test(src), 'R18: no "API key" in the prompt or in ui/community.js');
    T.ok(!errorsOf(P).length, `live-revoke: no page errors (${errorsOf(P).slice(0, 2).join(' | ')})`);
  } finally { await P.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// the emergency off (R14): app/site-config.json says "community": "off" on the live site: no section, no shelf words,
// ?community= and ?community-device= ignored, the tool off, and the bundled index's deny list still applied
await section('live-off', async () => {
  const gone = read('revoked-kernel.txt');
  const P = await openLive('/app/', { bundled: FIX, siteConfig: { community: 'off' }, query: (local) => `community=${encodeURIComponent(`http://localhost:${new URL(local).port}${FIXURL}community-index.json`)}&community-device=tester.soft-echo` });
  const loaded = () => P.page.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.overdub?.community && window.overdub.community.state().status !== 'loading', null, { timeout: 45000 });
  try {
    await loaded();
    await E(P, (k) => { window.overdub.trust.allow([k]); }, gone);
    const was = await E(P, (k) => window.overdub.trust.trusts(k), gone);
    P.requests.length = 0;
    await P.page.reload({ waitUntil: 'load' });
    await loaded();
    await E(P, () => window.overdub.community.ready());
    await P.page.waitForTimeout(400);
    const r = await E(P, async (k) => {
      const app = window.overdub;
      app.ui.show('browser'); app.ui.setOpen('left', true); app.browser.render();
      const f = app.ui.workspace?.FEATURES?.find((x) => x.id === 'browser');
      const tool = await app.tools.run('find_community_device', { query: 'echo' }, { by: 'claude' });
      const put = await app.tools.run('find_community_device', { put_on: { id: 'tester.soft-echo' } }, { by: 'claude' });
      return { on: app.community.on(), status: app.community.state().status, n: app.community.state().entries.length, section: !!document.querySelector('.cs-group'), words: f ? f.aliases.filter((a) => /shelf|community/.test(a)) : [], tool, put, gone: app.trust.trusts(k), url: location.search, detail: !!document.querySelector('.cs-detail'), toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | ') };
    }, gone);
    const asked = P.requests.filter((u) => /community-index\.json/.test(u));
    T.ok(P.rewritten.includes('/app/src/ui/community.js') && !r.on && r.status === 'off' && !r.n && !r.section && !r.words.length, `R14: with "community": "off" there's no section and no shelf words in Find, though COMMUNITY_LIVE reads true (${r.status})`);
    T.ok(/isn't on in this studio/.test(r.tool.error || '') && !r.tool.results.length && /isn't on in this studio/.test(r.put.error || '') && !r.put.offered, `R14: the tool answers "${r.tool.error}", for a search and for put_on`);
    T.ok(was && !r.gone, 'R14: the bundled deny list still applies: a revoked hash is forgotten with the shelf off');
    T.ok(asked.length >= 1 && asked.every((u) => u === `http://${LIVE_HOST}/app/community/community-index.json`) && !/community/.test(r.url) && !r.detail && !/has no device/.test(r.toast), `R14: ?community= is ignored (only the bundled index is read: ${[...new Set(asked)].join(', ')}), and ?community-device= opens nothing and leaves the address (${r.url || 'none'})`);
    T.ok(!errorsOf(P).length, `live-off: no page errors (${errorsOf(P).slice(0, 2).join(' | ')})`);
  } finally { await P.close(); }
});

// the deploy, dry (R3): the pinned shelf in the stage, with a stub aws first on PATH and no credentials
await section('deploy', async () => {
  const ROOT = path.join(HERE, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'community-deploy-'));
  try {
    const repo = makeDevicesRepo(path.join(tmp, 'overdub-devices'));
    const stub = path.join(tmp, 'bin');
    fs.mkdirSync(stub);
    fs.writeFileSync(path.join(stub, 'aws'), '#!/bin/sh\necho "aws was called: $*" >&2\nexit 97\n', { mode: 0o755 });
    const pin = (name, sha) => { const f = path.join(tmp, `${name}.json`); fs.writeFileSync(f, JSON.stringify({ repo: 'overdubstudio/overdub-devices', commit: repo.c2, index_sha256: sha })); return f; };
    const good = pin('good', repo.sha('index/community-index.json'));
    const run = (env) => {
      const r = spawnSync(path.join(ROOT, 'deploy/deploy.sh'), ['--skip-tests'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PATH: `${stub}${path.delimiter}${process.env.PATH}`, DRY_RUN: '1', AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/dev/null', SITE_CONFIG: '/dev/null', OVERDUB_DEVICES_DIR: repo.dir, COMMUNITY_SHIP: '', ...env } });
      return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
    };
    const ship = run({ COMMUNITY_PIN: good, COMMUNITY_SHIP: '1' });
    const lines = ship.out.split('\n');
    T.ok(ship.status === 0 && !/aws was called/.test(ship.out), `deploy, dry, shelf shipped: runs without calling AWS (exit ${ship.status})${ship.status ? ': ' + ship.out.slice(-300) : ''}`);
    T.ok(lines.some((l) => /^ {2}app\/community\/community-index\.json {2}application\/json; charset=utf-8 {2}no-cache$/.test(l)) && lines.some((l) => /^ {2}app\/community\/devices\/tester\.echo\.overdub-device\.json .* no-cache$/.test(l)), 'deploy: the plan lists app/community/community-index.json and the device files as no-cache');
    T.ok(lines.filter((l) => /^ {2}app\/community\/clips\/.*\.mp3 {2}audio\/mpeg {2}no-cache$/.test(l)).length === 3 && !/app\/community\/\S*\.(wav|txt)/.test(ship.out), 'deploy: the MP3 clips go up as audio/mpeg, no-cache, and no WAV or other file is staged');
    T.ok(/\+ aws s3 sync \S+ s3:\/\/\S+ --only-show-errors --exclude \* --include app\/community\/\*\.mp3 --content-type audio\/mpeg --cache-control no-cache/.test(ship.out), 'deploy: the upload rule for the clips');
    const bad = run({ COMMUNITY_PIN: pin('bad', '0'.repeat(64)), COMMUNITY_SHIP: '1' });
    T.ok(bad.status !== 0 && /not deploying: tools\/community-pull\.js/.test(bad.out) && !/\+ aws s3/.test(bad.out), `deploy: a pin whose index doesn't match deploys nothing (exit ${bad.status})`);
    const badHeld = run({ COMMUNITY_PIN: pin('bad2', '0'.repeat(64)) });
    T.ok(badHeld.status !== 0 && !/\+ aws s3/.test(badHeld.out), `deploy: it refuses even while the shelf is held back (exit ${badHeld.status})`);
    // held back while COMMUNITY_LIVE is false at REF (HEAD); the switch commit ships it
    const live = /^export const COMMUNITY_LIVE = true;/m.test(spawnSync('git', ['show', 'HEAD:app/src/ui/community.js'], { cwd: ROOT, encoding: 'utf8' }).stdout);
    const held = run({ COMMUNITY_PIN: good });
    if (!live) {
      T.ok(held.status === 0 && /app\/community: held back \(COMMUNITY_LIVE is false at HEAD\); the pinned shelf checks out/.test(held.out) && !/^ {2}app\/community\//m.test(held.out), 'deploy: with COMMUNITY_LIVE false at HEAD the shelf is checked, then held back');
      const none = run({ COMMUNITY_PIN: good, OVERDUB_DEVICES_DIR: path.join(tmp, 'nowhere') });
      T.ok(none.status === 0 && /held back .* not checked: no checkout/.test(none.out), 'deploy: held back with no overdub-devices checkout, it goes on and says so');
      const noneShip = run({ COMMUNITY_PIN: good, OVERDUB_DEVICES_DIR: path.join(tmp, 'nowhere'), COMMUNITY_SHIP: '1' });
      T.ok(noneShip.status !== 0 && !/\+ aws s3/.test(noneShip.out), `deploy: shipping with no checkout deploys nothing (exit ${noneShip.status})`);
    } else {
      T.ok(held.status === 0 && /^ {2}app\/community\/community-index\.json/m.test(held.out), 'deploy: with COMMUNITY_LIVE true at HEAD the shelf ships');
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// the frame headers (R9, R10): the local server sends them on every path; deploy/headers.sh plans the CloudFront
// policy dry, and against a fake aws (tools/fixtures/fake-aws.js) makes it, sets it on the distribution, and on a second
// run changes nothing
await section('headers', async () => {
  const ROOT = path.join(HERE, '..');
  const { startServer } = await import('../server/serve.js');
  const srv = await startServer({ port: 0, quiet: true });
  try {
    const want = { 'content-security-policy': "frame-ancestors 'none'", 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff' };
    for (const u of ['/app/', '/site/community/', '/community/', '/', '/app/src/main.js', '/nowhere.txt']) {
      const r = await fetch(srv.url + u);
      const got = Object.keys(want).filter((k) => r.headers.get(k) !== want[k]);
      T.ok(!got.length, `local ${u} (${r.status}): frame-ancestors 'none', X-Frame-Options DENY and nosniff${got.length ? ' (wrong: ' + got.map((k) => `${k}=${r.headers.get(k)}`).join(', ') + ')' : ''}`);
    }
  } finally { await srv.close(); }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'community-headers-'));
  try {
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    const base = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/dev/null' };
    for (const k of ['AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'DIST', 'DRY_RUN']) delete base[k];
    const run = (args, env) => { const r = spawnSync('bash', [path.join(ROOT, 'deploy/headers.sh'), ...args], { cwd: ROOT, encoding: 'utf8', env: { ...base, ...env } }); return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' }; };
    // dry: a stub that fails if called
    fs.writeFileSync(path.join(bin, 'aws'), '#!/bin/sh\necho "aws was called: $*" >&2\nexit 97\n', { mode: 0o755 });
    const live = run([], { DRY_RUN: '1' }), next = run(['--next'], { DRY_RUN: '1' }), only = run(['--policy-only'], { DRY_RUN: '1' });
    const policyOf = (out) => { const m = /\n((?: {4}.*\n)+)/.exec(out); try { return JSON.parse(m[1]); } catch { return null; } };
    const lp = policyOf(live.out), np = policyOf(next.out);
    const clean = (r) => r.status === 0 && !/aws was called/.test(r.out);
    T.ok(clean(live) && clean(next) && clean(only), `headers.sh, dry: live, --next and --policy-only run without calling AWS (exit ${live.status}, ${next.status}, ${only.status})`);
    const sec = lp && lp.SecurityHeadersConfig;
    T.ok(lp && lp.Name === 'overdub-headers' && sec.StrictTransportSecurity.AccessControlMaxAgeSec === 31536000 && sec.ContentTypeOptions.Override === true
      && sec.ReferrerPolicy.ReferrerPolicy === 'strict-origin-when-cross-origin' && sec.XSSProtection.Protection && sec.XSSProtection.ModeBlock,
      'headers.sh: the live policy keeps the managed set (HSTS a year, nosniff, strict-origin-when-cross-origin, XSS protection with mode block)');
    T.ok(lp && sec.FrameOptions.FrameOption === 'DENY' && sec.FrameOptions.Override === true && sec.ContentSecurityPolicy.ContentSecurityPolicy === "frame-ancestors 'none'" && sec.ContentSecurityPolicy.Override === true && lp.CustomHeadersConfig.Quantity === 0,
      'headers.sh: X-Frame-Options DENY and CSP frame-ancestors \'none\', both with override, and no custom header on the live site');
    T.ok(np && np.Name === 'overdub-next-headers' && JSON.stringify(np.SecurityHeadersConfig) === JSON.stringify(sec) && np.CustomHeadersConfig.Items.some((h) => h.Header === 'X-Robots-Tag' && h.Value === 'noindex, nofollow'),
      'headers.sh --next: the same security headers, plus X-Robots-Tag: noindex, nofollow');
    T.ok(only.stdout.trim() === 'RHPDRYRUN' && /update-distribution --id EDRYRUN/.test(live.out) && !/update-distribution/.test(only.out), `headers.sh --policy-only prints only the policy id and touches no distribution (${only.stdout.trim()})`);

    // against a fake aws: the distribution on the managed policy, one more behaviour on it and one on its own policy
    const MANAGED = '67f7725c-6f97-4210-82d7-5512b31e9d03';
    fs.writeFileSync(path.join(bin, 'aws'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(HERE, 'fixtures/fake-aws.js')}" "$@"\n`, { mode: 0o755 });
    const state = path.join(tmp, 'state.json'), log = path.join(tmp, 'log');
    fs.writeFileSync(state, JSON.stringify({ dists: { E1: { etag: 'D0', config: { Comment: 'live', DefaultCacheBehavior: { TargetOriginId: 's3', ResponseHeadersPolicyId: MANAGED },
      CacheBehaviors: { Quantity: 2, Items: [{ PathPattern: '/relay/*', ResponseHeadersPolicyId: MANAGED }, { PathPattern: '/api/*', ResponseHeadersPolicyId: 'CORSPOLICY' }] } } } } }));
    const fake = (args) => { fs.writeFileSync(log, ''); const r = run(args, { DIST: 'E1', FAKE_AWS_STATE: state, FAKE_AWS_LOG: log }); return { ...r, calls: fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)[1]) }; };
    const first = fake([]);
    const st1 = JSON.parse(fs.readFileSync(state, 'utf8'));
    const d1 = st1.dists.E1.config;
    T.ok(first.status === 0 && first.calls.includes('create-response-headers-policy') && first.calls.includes('update-distribution') && st1.policies.RHP1?.config.Name === 'overdub-headers',
      `headers.sh, first run: makes overdub-headers and updates the distribution (exit ${first.status}; ${first.calls.join(', ')})${first.status ? ': ' + first.out.slice(-300) : ''}`);
    T.ok(d1.DefaultCacheBehavior.ResponseHeadersPolicyId === 'RHP1' && d1.CacheBehaviors.Items[0].ResponseHeadersPolicyId === 'RHP1' && d1.CacheBehaviors.Items[1].ResponseHeadersPolicyId === 'CORSPOLICY' && d1.Comment === 'live' && d1.DefaultCacheBehavior.TargetOriginId === 's3',
      'headers.sh: the default behaviour and any on the managed policy move to it; a behaviour with its own policy and the rest of the config are kept');
    const second = fake([]);
    T.ok(second.status === 0 && !second.calls.some((c) => /^(create|update)-/.test(c)) && /up to date/.test(second.out) && /already sends/.test(second.out),
      `headers.sh, second run: changes nothing (${second.calls.join(', ')})`);
    st1.policies.RHP1.config.SecurityHeadersConfig.FrameOptions.FrameOption = 'SAMEORIGIN';
    fs.writeFileSync(state, JSON.stringify(st1));
    const drift = fake([]);
    const st2 = JSON.parse(fs.readFileSync(state, 'utf8'));
    T.ok(drift.status === 0 && drift.calls.includes('update-response-headers-policy') && !drift.calls.includes('update-distribution') && st2.policies.RHP1.config.SecurityHeadersConfig.FrameOptions.FrameOption === 'DENY',
      `headers.sh: a policy changed by hand is put back with If-Match, and the distribution left alone (${drift.calls.join(', ')})`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

T.done();
