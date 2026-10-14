// Analytics checks: counting, not tracking (app/src/analytics.js, site/assets/analytics.js).
//   1. the pieces: host and opt-out rules, the referrer host, the fixed event list, the GIFs
//   2. off production (localhost) nothing fires, whatever you do
//   3. on a faked production host (https://overdubstudio.com routed to the local server) exactly the right URLs
//      fire for the right actions, with no referrer and no cookie, and nothing else
//   4. Do Not Track, Global Privacy Control and automation (navigator.webdriver) send nothing
//   5. the two sites' deploys (both in the Overdub account, their AWS Terraform's: infra/live, infra/next): what
//      infra/live promises, read from its HCL (the cutover variable, the production-only role, the private buckets);
//      deploy/analytics/setup.sh and deploy/deploy.sh (live and --next) plan the right things with DRY_RUN=1 (a stub aws
//      on PATH, no credentials); a live deploy off GitHub Actions is refused, and the live site's config is the committed
//      deploy/live-config.json; the config the deploy writes puts up the Preview ribbon on the preview (desktop and
//      phone), and nothing is counted there; the live site has no ribbon
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { open, tally, OUTDIR } from './pw.js';
import { allowed, optedOut, referrerHost, beaconUrl, exportKind, EVENTS, HOST } from '../app/src/analytics.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const t = tally('analytics');
const PROD = 'https://' + HOST;
const GIF = fs.readFileSync(path.join(ROOT, 'app/e.gif'));

/* ---------------------------------------------------------------- 1. the pieces */
{
  for (const f of ['app/e.gif', 'site/e.gif']) {
    const b = fs.readFileSync(path.join(ROOT, f));
    t.ok(b.length === 43 && b.subarray(0, 6).toString() === 'GIF89a' && b[b.length - 1] === 0x3b, `${f} is a 43-byte GIF`);
  }
  const loc = (hostname, protocol = 'https:') => ({ hostname, protocol });
  t.ok(allowed(loc(HOST), {}, {}), 'allowed on https://overdubstudio.com');
  t.ok(!allowed(loc('localhost', 'http:'), {}, {}) && !allowed(loc('127.0.0.1', 'http:'), {}, {}), 'not on localhost');
  t.ok(!allowed(loc(HOST, 'http:'), {}, {}) && !allowed(loc('overdubstudio.com.evil.test'), {}, {}) && !allowed(loc('overdub.ajsmithhq.com'), {}, {}), 'not over http, nor on look-alike hosts');
  t.ok(!allowed(loc(HOST), { doNotTrack: '1' }, {}) && !allowed(loc(HOST), {}, { doNotTrack: '1' }) && !allowed(loc(HOST), { msDoNotTrack: '1' }, {}), 'Do Not Track: nothing');
  t.ok(!allowed(loc(HOST), { globalPrivacyControl: true }, {}), 'Global Privacy Control: nothing');
  t.ok(!allowed(loc(HOST), { webdriver: true }, {}), 'automation: nothing');
  t.ok(!optedOut({ doNotTrack: '0' }, {}) && !optedOut({ doNotTrack: null }, {}), 'DNT 0 or unset is not an opt-out');
  t.ok(referrerHost('https://www.google.com/search?q=my+secret+song') === 'google.com', 'referrer: host only, no www, no query');
  t.ok(referrerHost('https://news.ycombinator.com:8443/item?id=1') === 'news.ycombinator.com', 'referrer: no port, no path');
  t.ok(referrerHost('') === '' && referrerHost('not a url') === '' && referrerHost('file:///Users/aj/song.html') === '', 'referrer: nothing when none or odd');
  t.ok(beaconUrl('play') === '/app/e.gif?e=play', 'beacon: /app/e.gif?e=play');
  t.ok(beaconUrl('agent', 'claude.ai') === '/app/e.gif?e=agent&p=claude.ai', 'beacon: an enumerated field');
  t.ok(beaconUrl('agent', 'my-key-sk-ant') === null && beaconUrl('agent') === null, 'beacon: a field off the list is refused');
  t.ok(beaconUrl('title', 'x') === null && beaconUrl('toString') === null && beaconUrl('constructor') === null, 'beacon: an event off the list is refused');
  t.ok(beaconUrl('hum', 'loud') === '/app/e.gif?e=hum', 'beacon: an event without fields drops any field');
  t.ok(beaconUrl('device', 'you', { r: 'google.com' }) === '/app/e.gif?e=device&p=you', 'beacon: r only on opens');
  t.ok(beaconUrl('open', 'demo', { r: 'x.com/path?q' }) === '/app/e.gif?e=open&p=demo', 'beacon: a malformed r is dropped');
  t.ok(Object.keys(EVENTS).join() === 'open,play,agent,device,export,share,hum,keep', 'the event list is short and fixed');
  t.ok(Object.values(EVENTS).every((v) => !v || (v.length <= 8 && v.every((s) => /^[a-z.]{1,10}$/.test(s)))), 'every field is a short word from a list');
  t.ok(['Night Shift.wav', 'Night Shift stems.zip', 'Night Shift.mid', 'Night Shift.overdub.json', 'Night Shift attribution.json', 'velvet.overdub-device.json', 'a.webm', 'a.txt'].map(exportKind).join() === 'wav,stems,midi,song,log,device,video,other', 'exports: the file type, never the name');
}

/* ---------------------------------------------------------------- 1b. what the copy says about it */
// The counts exist, so nothing public (or about to be) may say there are none, and the privacy answers name every
// event the studio can send.
{
  // The deck and the launch drafts live in a private repo beside this one; they're checked when it's there.
  const PRIV = process.env.OVERDUB_PRIVATE || path.resolve(ROOT, '..', 'overdub-private');
  const HAS_PRIV = fs.existsSync(path.join(PRIV, 'docs/launch'));
  const at = (f) => (fs.existsSync(path.join(ROOT, f)) ? path.join(ROOT, f) : path.join(PRIV, f));
  const read = (f) => fs.readFileSync(at(f), 'utf8');
  const COPY = ['site/index.html', 'site/press/index.html', 'README.md', 'docs/AGENTS.md', ...(HAS_PRIV ? ['deck/index.html',
    ...fs.readdirSync(path.join(PRIV, 'docs/launch')).filter((f) => f.endsWith('.md')).map((f) => 'docs/launch/' + f)] : [])];
  const denials = COPY.flatMap((f) => (read(f).match(/[^.\n]*\b(no analytics|there(?:'|’)s no analytics|none in the studio)\b[^.\n]*/gi) || []).map((m) => `${f}: "${m.trim()}"`));
  t.ok(!denials.length, `no copy says the studio has no analytics${denials.length ? ':\n       ' + denials.join('\n       ') : ''}`);
  const word = { open: 'opens', play: 'plays', agent: 'agent messages', device: 'devices', export: 'exports', share: 'shares', hum: 'hums', keep: 'keeps' };
  const faq6 = HAS_PRIV && (read('docs/launch/faq.md').match(/\*\*6\.[\s\S]*?(?=\n\*\*7\.)/) || [''])[0];
  const pressMd = HAS_PRIV && (read('docs/launch/press-kit.md').match(/\| \*\*Privacy\*\* \|[^\n]*/) || [''])[0];
  const pressHtml = (read('site/press/index.html').match(/<dt>Privacy<\/dt><dd>[\s\S]*?<\/dd>/) || [''])[0];
  for (const [name, text] of [...(HAS_PRIV ? [['faq.md 6', faq6], ['press-kit.md privacy row', pressMd]] : []), ['press page privacy row', pressHtml]]) {
    const missing = Object.keys(EVENTS).filter((e) => !(word[e] && text.includes(word[e])));
    t.ok(text && !missing.length && /Do Not Track|DNT/.test(text), `${name} names every counted event and the opt-out${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}`);
  }
}

/* ---------------------------------------------------------------- helpers */
const BEACON = /\/e\.gif(\?|$)/;
// Route the production origin to the local server; record (and answer) every count.
async function fakeProd(context, base, { webdriver = false, dnt = false, gpc = false } = {}) {
  const beacons = [];
  await context.addInitScript(({ webdriver, dnt, gpc }) => {
    if (!webdriver) Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
    if (dnt) Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1', configurable: true });
    if (gpc) Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true });
  }, { webdriver, dnt, gpc });
  await context.route((u) => u.origin === PROD, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (BEACON.test(u.pathname)) {
      const h = await req.allHeaders();
      beacons.push({ url: u.pathname + u.search, referer: h.referer || '', cookie: h.cookie || '', method: req.method() });
      return route.fulfill({ status: 200, contentType: 'image/gif', body: GIF });
    }
    return passThrough(route, base + u.pathname + u.search);
  });
  return beacons;
}
// Answer a routed request from the local server. A failed fetch (ECONNRESET under load, or the page already gone) is
// retried, then the request is aborted: an error thrown in a route handler escapes every try/catch and kills the run.
async function passThrough(route, url) {
  for (let i = 0; i < 3; i++) {
    try { return await route.fulfill({ response: await route.fetch({ url }) }); } catch { /* retry */ }
  }
  return route.abort().catch(() => {});
}
const settle = (page, ms = 400) => page.waitForTimeout(ms);
const ready = (page) => page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });

// Everything a person (and their agents) might do in one sitting. Returns what each step should count.
async function doThings(page) {
  return page.evaluate(async () => {
    const app = window.overdub;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const steps = [];
    const step = async (name, fn) => { await fn(); await wait(250); steps.push(name); };
    await step('play', async () => { await app.engine.start(); app.engine.play(0); await wait(200); app.engine.stop(); app.engine.play(0); await wait(100); app.engine.stop(); });
    await step('agent:demo', async () => { app.agent.useMock(true); app.agent.send('hello'); await wait(30); app.agent.stop(); });
    await step('agent:mcp', async () => { await app.tools.run('get_project', {}, { by: 'mcp:test' }); await app.tools.run('get_selection', {}, { by: 'mcp:test' }); await app.tools.run('get_project', {}, { by: 'mcp:other' }); });
    await step('agent:claude.ai', async () => { await app.tools.run('get_project', {}, { by: 'claude.ai' }); await app.tools.run('get_project', {}, { by: 'claude' }); });
    const KERNEL = '({ create({ sr, dsp }) { return { process(L, R, n, p) { for (let i = 0; i < n; i++) { L[i] *= p.level; R[i] *= p.level; } } }; } })';
    const dev = (id) => ({ id, name: 'Quiet ' + id.slice(-1), kind: 'effect', cat: 'utility', blurb: 'a level', params: [{ key: 'level', label: 'LEVEL', min: 0, max: 1, def: 0.8, role: 'level' }], kernel: KERNEL });
    await step('device:you', async () => { app.store.dispatch({ type: 'device.define', device: { ...dev('you.quiet-a'), by: 'you', version: 1, created: Date.now() } }, { by: 'you', label: 'a device' }); });
    // (the device.define an agent's define_device dispatches: under the faked production host below, the device check
    // can't load the kernel worklet, whose module fetch a Playwright route never sees, so the op is dispatched as the
    // tool would; the count is what this suite checks)
    await step('device:agent', async () => { app.store.dispatch({ type: 'device.define', device: { ...dev('test.quiet-b'), by: 'mcp:test', version: 1, created: Date.now() } }, { by: 'mcp:test', label: 'a device' }); });
    await step('undo+redo', async () => { app.store.undo(); app.store.redo(); app.store.load(JSON.parse(JSON.stringify(app.store.get())), { by: 'you' }); });
    await step('export', async () => { app.exporter.exportMidi(); app.exporter.saveProject(); app.exporter.exportLog(); });
    let link = null;
    await step('share', async () => {
      const r = app.share?.copy ? await app.share.copy({ anchor: null }) : null; // the Song menu's Share
      link = r && r.url;
      await app.tools.run('share_link', {}, { by: 'mcp:test' });                  // an agent makes one
      app.ui.emit('share', { kind: 'embed' });
      app.ui.emit('share', { kind: 'a song called <secret>' });
    });
    let hum = null;
    await step('hum', async () => {
      hum = app.input.capture.add({ src: 'hum', kind: 'notes', notes: [{ p: 60, t: 0, d: 1, v: 0.8 }, { p: 64, t: 1, d: 1, v: 0.8 }], tempo: 120 });
      app.input.capture.add({ src: 'tap', kind: 'drums', notes: [{ p: 36, t: 0, d: 0.25, v: 0.8 }], tempo: 120 });
    });
    await step('keep:idea', async () => { const r = app.input.capture.keep(hum.id, { newTrack: { name: 'Hum' } }); if (!r.ok) throw new Error('keep: ' + r.error); });
    await step('keep:take', async () => {
      const vars = (n) => [{ label: 'slower', ops: [{ type: 'project.set', patch: { tempo: 90 + n } }] }, { label: 'faster', ops: [{ type: 'project.set', patch: { tempo: 130 + n } }] }];
      const a = await app.tools.run('propose_variations', { variations: vars(0), wait_seconds: 0 }, { by: 'mcp:test' });
      const ra = app.tools.requests.get(a.id);
      app.tools.answer(a.id, ra.cards.find((c) => !c.original).index);
      const b = await app.tools.run('propose_variations', { variations: vars(1), wait_seconds: 0 }, { by: 'mcp:test' });
      const rb = app.tools.requests.get(b.id);
      app.tools.answer(b.id, rb.cards.find((c) => c.original).index); // "as it was": not a keep
    });
    window.__link = link;
    return steps;
  });
}
const EXPECTED = [
  '/app/e.gif?e=play',
  '/app/e.gif?e=agent&p=demo',
  '/app/e.gif?e=agent&p=mcp',
  '/app/e.gif?e=agent&p=claude.ai',
  '/app/e.gif?e=device&p=you',
  '/app/e.gif?e=device&p=agent',
  '/app/e.gif?e=export&p=midi', '/app/e.gif?e=export&p=song', '/app/e.gif?e=export&p=log',
  '/app/e.gif?e=share&p=link', '/app/e.gif?e=share&p=agent', '/app/e.gif?e=share&p=embed', '/app/e.gif?e=share&p=other',
  '/app/e.gif?e=hum',
  '/app/e.gif?e=keep&p=idea',
  '/app/e.gif?e=keep&p=take',
];

let session;
try {
  /* ---------------------------------------------------------------- 2. off production */
  session = await open('/app/', { query: 'demo' });
  {
    const { page, context, errors } = session;
    const seen = [];
    context.on('request', (r) => { if (BEACON.test(new URL(r.url()).pathname)) seen.push(r.url()); });
    await ready(page);
    t.ok(await page.evaluate(() => window.overdub.analytics && window.overdub.analytics.enabled === false), 'localhost: analytics installed, switched off');
    const steps = await doThings(page);
    await settle(page);
    t.ok(steps.length === 12, `localhost: did ${steps.length} things (play, agents, devices, exports, a share, a hum, keeps)`);
    t.ok(seen.length === 0 && (await page.evaluate(() => window.overdub.analytics.sent.length)) === 0, `localhost: nothing fired (${seen.length})`);
    await page.goto(session.base + '/', { waitUntil: 'load' });
    await settle(page);
    t.ok(seen.length === 0, 'localhost landing page: nothing fired');
    t.ok(!errors.length, 'localhost: no page errors ' + errors.slice(0, 3).join(' | '));
  }

  /* ---------------------------------------------------------------- 3. faked production */
  {
    const { browser, base } = session;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
    const beacons = await fakeProd(context, base);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.stack || e)));

    await page.goto(PROD + '/', { waitUntil: 'load', referer: 'https://www.google.com/search?q=my+song+title' });
    await settle(page, 800);
    t.ok(beacons.length === 1 && beacons[0].url === '/site/e.gif?e=view&r=google.com', 'landing: one view, with the referring host only: ' + beacons.map((b) => b.url).join(' '));
    t.ok(/Counted, not tracked/.test(await page.textContent('footer')), 'landing footer says what is counted');

    beacons.length = 0;
    await page.goto(PROD + '/app/?demo', { waitUntil: 'load' });
    await ready(page);
    await settle(page);
    t.ok(beacons.map((b) => b.url).join(' ') === '/app/e.gif?e=open&p=demo', 'studio: one open (p=demo, no referrer): ' + beacons.map((b) => b.url).join(' '));
    t.ok(await page.evaluate(() => window.overdub.analytics.enabled === true), 'studio: analytics on');
    t.ok(await page.evaluate(async () => { const s = await window.overdub.site.ready; return s.env === 'production' && !s.preview && !document.querySelector('.preview-slip') && !document.title.startsWith('Preview'); }),
      'production: the committed site config, and no Preview ribbon');

    beacons.length = 0;
    await doThings(page);
    await settle(page, 600);
    const got = beacons.map((b) => b.url);
    t.ok(got.join(' ') === EXPECTED.join(' '), `studio: exactly the expected ${EXPECTED.length} counts, in order`);
    if (got.join(' ') !== EXPECTED.join(' ')) t.note('got: ' + got.join(' '));
    t.ok(beacons.every((b) => b.method === 'GET' && !b.referer && !b.cookie), 'every count is a GET with no referrer and no cookie');
    t.ok(beacons.every((b) => [...new URL(b.url, PROD).searchParams.keys()].every((k) => k === 'e' || k === 'p')), 'only e and p after the open');
    t.ok(!got.some((u) => /secret|night|quiet|slower|faster/i.test(decodeURIComponent(u))), 'no song content, names or text in any count');

    // a share link: opening it, then making it yours
    const link = await page.evaluate(() => window.__link);
    t.ok(typeof link === 'string' && link.startsWith(PROD + '/app/#'), 'the share link points at production (its song rides in the hash)');
    beacons.length = 0;
    await page.goto('about:blank');
    await page.goto(link, { waitUntil: 'load', referer: 'https://app.slack.com/client/T0/C0' });
    await ready(page);
    await settle(page);
    await page.evaluate(() => window.overdub.share.fork());
    await settle(page);
    t.ok(beacons.map((b) => b.url).join(' ') === '/app/e.gif?e=open&p=link&r=app.slack.com /app/e.gif?e=share&p=fork', 'a share link: open p=link, then share p=fork: ' + beacons.map((b) => b.url).join(' '));
    t.ok(beacons.every((b) => !b.referer && !/#|s=/.test(b.url)), 'the link\'s song never reaches a count');

    // a saved song, opened from a link elsewhere; then ?new
    beacons.length = 0;
    await page.waitForTimeout(700); // autosave
    await page.goto(PROD + '/app/', { waitUntil: 'load', referer: 'https://news.ycombinator.com/item?id=4242' });
    await ready(page);
    await settle(page);
    t.ok(beacons.map((b) => b.url).join(' ') === '/app/e.gif?e=open&p=saved&r=news.ycombinator.com', 'reopened: p=saved with the referring host: ' + beacons.map((b) => b.url).join(' '));
    beacons.length = 0;
    await page.goto(PROD + '/app/?new', { waitUntil: 'load' });
    await ready(page);
    await settle(page);
    t.ok(beacons.map((b) => b.url).join(' ') === '/app/e.gif?e=open&p=new', '?new: p=new');
    t.ok(!errors.length, 'production: no page errors ' + errors.slice(0, 3).join(' | '));
    await context.close();
  }

  /* ---------------------------------------------------------------- 4. DNT, GPC, automation */
  for (const [label, opts] of [['Do Not Track', { dnt: true }], ['Global Privacy Control', { gpc: true }], ['automation (navigator.webdriver)', { webdriver: true }]]) {
    const { browser, base } = session;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
    const beacons = await fakeProd(context, base, opts);
    const page = await context.newPage();
    await page.goto(PROD + '/', { waitUntil: 'load', referer: 'https://www.google.com/' });
    await page.goto(PROD + '/app/?demo', { waitUntil: 'load' });
    await ready(page);
    const off = await page.evaluate(() => window.overdub.analytics.enabled === false);
    await doThings(page);
    await settle(page);
    t.ok(off && beacons.length === 0, `${label}: nothing sent (${beacons.length})`);
    await context.close();
  }

  /* ---------------------------------------------------------------- 5. the two sites' deploys */
  {
    // the scripts, dry: a stub aws comes first on PATH and there are no credentials, so nothing here reaches AWS
    const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'next-dry-'));
    fs.writeFileSync(path.join(stub, 'aws'), '#!/bin/sh\necho "aws was called: $*" >&2\nexit 97\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${stub}${path.delimiter}${process.env.PATH}`, DRY_RUN: '1', AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/dev/null', DEPLOY_ENV: '/dev/null', SITE_CONFIG: '/dev/null', COMMUNITY_PIN: '/dev/null' };
    // DEPLOY_ENV=/dev/null: the scripts would otherwise read deploy/.env;
    // SITE_CONFIG=/dev/null: deploy.sh would otherwise start the site config from REF's deploy/live-config.json;
    // COMMUNITY_PIN=/dev/null (dry runs only): no shelf, so no overdub-devices checkout is needed (tools/community-test.js
    // checks the shelf's part)
    for (const k of ['AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'NEXT_ZONE', 'NEXT_OAC', 'NEXT_CERT', 'OAC', 'ZONE', 'CERT', 'REF',
      'LIVE_DISTRIBUTION', 'LOCAL_LIVE_DEPLOY', 'GITHUB_ACTIONS']) delete env[k];
    const run = (script, ...args) => { const extra = typeof args[0] === 'object' ? args.shift() : {}; const r = spawnSync('bash', [path.join(ROOT, script), ...args], { cwd: ROOT, env: { ...env, ...extra }, encoding: 'utf8', timeout: 120000 }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
    const clean = (r) => r.status === 0 && !/aws was called/.test(r.out);

    // Both sites' AWS is Terraform's (infra/live, infra/next): what the live site's directory promises, read from its HCL
    // (tools/check.sh validates it; the plan itself needs credentials)
    const hcl = (f) => fs.readFileSync(path.join(ROOT, 'infra/live', f), 'utf8');
    const cdn = hcl('cdn.tf'), dns = hcl('dns.tf'), gh = hcl('github.tf'), bucket = hcl('bucket.tf'), vars = hcl('variables.tf');
    t.ok(/variable "serve_names"[\s\S]*?default\s*=\s*false/.test(vars) && /aliases\s*=\s*var\.serve_names \? \[var\.domain, "www\.\$\{var\.domain\}"\] : \[\]/.test(cdn)
      && /cloudfront_default_certificate = !var\.serve_names/.test(cdn) && /site_target = var\.serve_names \?/.test(dns) && /var\.old_distribution_domain/.test(dns),
      'infra/live: the cutover is one variable: serve_names (false) gives the distribution no names and the default certificate, and keeps the apex and www records on the old distribution');
    t.ok(/"var CLOUDFRONT_NAME = \$\{var\.serve_names \? "false" : "true"\};"/.test(cdn) && /path-rewrite\.js/.test(cdn) && /name\s*=\s*"overdub-path-rewrite"/.test(cdn),
      'infra/live: until the cutover the path-rewrite function also serves the distribution\'s cloudfront.net name (CLOUDFRONT_NAME)');
    t.ok(/data "aws_iam_openid_connect_provider" "github"/.test(gh) && !/resource "aws_iam_openid_connect_provider"/.test(gh)
      && /"token\.actions\.githubusercontent\.com:sub" = "\$\{var\.github_sub_claim_prefix\}:environment:\$\{var\.deploy_environment\}"/.test(gh) && !/StringLike/.test(gh)
      && /variable "deploy_environment"[\s\S]*?default\s*=\s*"production"/.test(vars),
      'infra/live: the deploy role reuses infra/next\'s OIDC provider and trusts one subject, <prefix>:environment:production');
    t.ok(/site\s*=\s*var\.domain/.test(bucket) && /models = "overdub-models-\$\{local\.account_id\}"/.test(bucket) && /block_public_policy\s*=\s*true/.test(bucket)
      && /"AWS:SourceArn" = aws_cloudfront_distribution\.live\.arn/.test(bucket),
      'infra/live: private buckets for the site (read only by its distribution) and the stems model');
    t.ok(/s3:\/\/overdub-models-800849967977\//.test(fs.readFileSync(path.join(ROOT, 'deploy/live-config.json'), 'utf8')) && /account_id = "800849967977"/.test(bucket),
      'deploy/live-config.json takes the model from infra/live\'s models bucket');
    // the Athena half of the counts, dry; and it refuses AJ's personal account (a stub that answers sts with it)
    const logs = run('deploy/analytics/setup.sh');
    t.ok(clean(logs) && /CREATE DATABASE IF NOT EXISTS overdub/.test(logs.out) && /CREATE OR REPLACE VIEW overdub\.events/.test(logs.out),
      `deploy/analytics/setup.sh, dry: the Athena database, table and view (exit ${logs.status})`);
    const personal = path.join(stub, 'personal');
    fs.mkdirSync(personal);
    fs.writeFileSync(path.join(personal, 'aws'), '#!/bin/sh\ncase "$*" in "sts get-caller-identity"*) echo 165604225334; exit 0;; esac\necho "aws was called: $*" >&2\nexit 97\n', { mode: 0o755 });
    const own = run('deploy/analytics/setup.sh', { DRY_RUN: '', PATH: `${personal}${path.delimiter}${process.env.PATH}` });
    t.ok(own.status === 1 && /refusing: these credentials are AJ's personal account/.test(own.out) && !/aws was called/.test(own.out),
      `deploy/analytics/setup.sh refuses AJ's personal account before anything else (exit ${own.status})`);

    const ref = spawnSync('git', ['rev-parse', '--short', 'HEAD~1'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
    const next = run('deploy/deploy.sh', '--skip-tests', '--next', 'HEAD~1');
    const live = run('deploy/deploy.sh', '--skip-tests');
    t.ok(clean(next) && clean(live), `deploy/deploy.sh with DRY_RUN=1, live and --next HEAD~1, runs without calling AWS (exit ${live.status}, ${next.status})`);
    t.ok(new RegExp(`^next: ${ref} \\(HEAD~1\\)`, 'm').test(next.out) && /\+ aws s3 sync \S+ s3:\/\/next\.overdubstudio\.com --only-show-errors --delete/.test(next.out)
      && /\+ aws cloudfront create-invalidation --distribution-id \S+ --paths \/\*/.test(next.out) && !/s3:\/\/overdubstudio\.com/.test(next.out),
      `deploy --next ships the named ref (${ref}) to the preview bucket only, and invalidates`);
    t.ok(/\+ aws s3 sync \S+ s3:\/\/overdubstudio\.com --only-show-errors --delete/.test(live.out) && !/next\.overdubstudio\.com/.test(live.out) && !/ajsmithhq/.test(live.out),
      'deploy without --next ships to the live bucket, s3://overdubstudio.com, only');
    // the live site from GitHub Actions only (deploy-live.yml); LOCAL_LIVE_DEPLOY=1 is the hatch, a dry run needs neither
    const refused = run('deploy/deploy.sh', { DRY_RUN: '' }, '--skip-tests');
    t.ok(refused.status === 1 && /not deploying: the live site deploys from GitHub Actions/.test(refused.out) && !/aws was called/.test(refused.out) && !/\+ aws/.test(refused.out),
      `a live deploy off GitHub Actions, without LOCAL_LIVE_DEPLOY=1, is refused before anything is staged or called (exit ${refused.status})`);
    const hatch = run('deploy/deploy.sh', { DRY_RUN: '', LOCAL_LIVE_DEPLOY: '1', LIVE_DISTRIBUTION: 'ELIVE', COMMUNITY_PIN: '', OVERDUB_DEVICES_DIR: path.join(stub, 'no-devices') }, '--skip-tests');
    t.ok((/^live: .* -> s3:\/\/overdubstudio\.com, distribution ELIVE$/m.test(hatch.out) || /^not deploying: no checkout with the pinned shelf/m.test(hatch.out))
      && !/not deploying: the live site deploys from GitHub Actions/.test(hatch.out),
      `with LOCAL_LIVE_DEPLOY=1 it goes on past that check (here to the next stop, no overdub-devices checkout or the stub aws: exit ${hatch.status})`);
    const liveRef = run('deploy/deploy.sh', '--skip-tests', 'HEAD~1');
    t.ok(clean(liveRef) && new RegExp(`^live: ${ref} \\(HEAD~1\\)`, 'm').test(liveRef.out), `the live deploy ships a named REF too (deploy/deploy.sh --skip-tests <ref>, as deploy-live.yml runs it): ${(/^live: .*$/m.exec(liveRef.out) || [''])[0].slice(0, 80)}`);
    // the live config is committed: with no SITE_CONFIG the deploy starts from REF's deploy/live-config.json (a dry run
    // fetches no model or runtime it hasn't cached: deploy/stage-stems.js stages stand-ins and says so)
    const noBase = { ...env };
    delete noBase.SITE_CONFIG;
    const committed = spawnSync('bash', [path.join(ROOT, 'deploy/deploy.sh'), '--skip-tests'], { cwd: ROOT, env: noBase, encoding: 'utf8', timeout: 300000 });
    const comOut = (committed.stdout || '') + (committed.stderr || '');
    const liveJson = JSON.parse(spawnSync('git', ['show', 'HEAD:deploy/live-config.json'], { cwd: ROOT, encoding: 'utf8' }).stdout || 'null');
    const comCfg = (() => { try { return JSON.parse((/^app\/site-config\.json: (.*)$/m.exec(comOut) || [])[1]); } catch { return null; } })();
    t.ok(committed.status === 0 && !/aws was called/.test(comOut) && liveJson?.stems?.modelFrom?.startsWith('s3://overdub-models-') && comCfg?.stems?.sha256 === liveJson.stems.sha256
      && comCfg.stems.model === `vendor/models/${liveJson.stems.sha256}.onnx` && !('modelFrom' in comCfg.stems) && /^stems: (dry run: )?(the )?model from s3:\/\/overdub-models-/m.test(comOut),
      `with no SITE_CONFIG the live deploy ships the committed deploy/live-config.json, its model from the private bucket (exit ${committed.status}: ${(/^stems: .*model.*$/m.exec(comOut) || ['no stems line'])[0].slice(0, 120)})`);
    const cfgOf = (out) => { try { return JSON.parse((/^app\/site-config\.json: (.*)$/m.exec(out) || [])[1]); } catch { return null; } };
    const nextCfg = cfgOf(next.out), liveCfg = cfgOf(live.out);
    const tracked = spawnSync('git', ['ls-files', 'app/site-config.json', 'deploy/site-config.json'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
    const ignored = spawnSync('git', ['check-ignore', 'app/site-config.json', 'deploy/site-config.json'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().split('\n').length === 2;
    t.ok(!tracked && ignored, `the site config is never committed: deploy.sh writes it (${tracked || 'untracked'}, ${ignored ? 'ignored' : 'not ignored'})`);
    // no base: the live deploy ships {}, and the preview its own three keys
    t.ok(liveCfg && JSON.stringify(liveCfg) === '{}', `with no base the live deploy ships {} (${JSON.stringify(liveCfg)})`);
    t.ok(nextCfg && nextCfg.preview === true && nextCfg.env === 'preview' && nextCfg.ref === ref && Object.keys(nextCfg).length === 3,
      `the preview deploy adds its own keys (${JSON.stringify(nextCfg)})`);
    // one base for both sites: a key in the base (SITE_CONFIG here) reaches both, and the preview keeps it
    const base = path.join(stub, 'site-config.json');
    fs.writeFileSync(base, JSON.stringify({ other: { api: 'https://switch.example' } }));
    const nextB = cfgOf(run('deploy/deploy.sh', { SITE_CONFIG: base }, '--skip-tests', '--next', 'HEAD~1').out);
    const liveB = cfgOf(run('deploy/deploy.sh', { SITE_CONFIG: base }, '--skip-tests').out);
    t.ok(liveB && JSON.stringify(liveB) === JSON.stringify({ other: { api: 'https://switch.example' } }) && !('preview' in liveB)
      && nextB && nextB.other && nextB.other.api === 'https://switch.example' && nextB.preview === true && nextB.ref === ref,
      `the base config reaches both sites; the preview adds to it and drops nothing (${JSON.stringify(liveB)}, ${JSON.stringify(nextB)})`);
    // the feature toggles are retired (merged means shipped): a "toggles" left in the base is dropped, with a line
    fs.writeFileSync(base, JSON.stringify({ toggles: { relay: 'on' }, other: 1 }));
    const oldR = run('deploy/deploy.sh', { SITE_CONFIG: base }, '--skip-tests'), old = cfgOf(oldR.out);
    t.ok(clean(oldR) && old && !('toggles' in old) && old.other === 1 && /dropped .*"toggles"/.test(oldR.out), `a base with "toggles" ships without it, and says so (${JSON.stringify(old)})`);
    // a base that isn't a JSON object stops a live deploy before anything is planned
    fs.writeFileSync(base, '[1]');
    const badLive = run('deploy/deploy.sh', { SITE_CONFIG: base }, '--skip-tests');
    t.ok(badLive.status !== 0 && /not deploying: .* is not a JSON object/.test(badLive.out) && !/aws (s3|cloudfront)/.test(badLive.out), `a base that isn't a JSON object stops a live deploy (exit ${badLive.status})`);
    t.ok(!allowed({ hostname: 'next.overdubstudio.com', protocol: 'https:' }, {}, {}), 'analytics: not on next.overdubstudio.com');
    fs.rmSync(stub, { recursive: true, force: true });

    // the studio on the preview host, served the config the deploy wrote
    const NEXT = 'https://next.overdubstudio.com';
    for (const [label, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
      const { browser, base } = session;
      const { width, height, ...more } = vp;
      const context = await browser.newContext({ viewport: { width, height }, ...more, permissions: ['microphone'] });
      await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true }));
      const counted = [];
      await context.route((u) => u.origin === NEXT, async (route) => {
        const u = new URL(route.request().url());
        if (BEACON.test(u.pathname)) { counted.push(u.pathname + u.search); return route.fulfill({ status: 200, contentType: 'image/gif', body: GIF }); }
        if (u.pathname === '/app/site-config.json') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nextCfg || {}) });
        return passThrough(route, base + u.pathname + u.search);
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.stack || e)));
      await page.goto(NEXT + '/app/?demo', { waitUntil: 'load' });
      await ready(page);
      await page.waitForSelector('.preview-slip', { timeout: 10000 }).catch(() => null);
      const slip = await page.evaluate(() => {
        const el = document.querySelector('.preview-slip');
        if (!el) return null;
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        return { text: el.textContent, shown: el.innerText.replace(/\s+/g, ' ').trim().toLowerCase(), label: el.getAttribute('aria-label'), title: document.title, pe: cs.pointerEvents, left: r.left, right: r.right, top: r.top, h: r.height, vw: innerWidth, site: { ...window.overdub.site, ready: undefined } };
      });
      t.ok(slip && slip.text === `Preview · ${ref}` && slip.title.startsWith('Preview · ') && /stay on this site/.test(slip.label) && slip.site.preview === true,
        `${label}: the preview wears the ribbon ("${slip && slip.text}") and its tab says Preview`);
      const shows = label === 'phone' ? 'preview' : `preview · ${ref}`.toLowerCase();
      t.ok(slip && slip.shown === shows, `${label}: the slip shows "${shows}" on screen ("${slip && slip.shown}")`);
      t.ok(slip && slip.pe === 'none' && slip.top === 0 && slip.left >= 0 && slip.right <= slip.vw && slip.h <= 16 && slip.left === 0,
        `${label}: the ribbon sits in the top-left corner, inside the screen, and takes no clicks (${slip ? `${Math.round(slip.left)}-${Math.round(slip.right)} of ${slip.vw}, ${Math.round(slip.h)} px` : 'none'})`);
      await page.screenshot({ path: path.join(OUTDIR, `preview-${label}.png`) });
      await doThings(page);
      await settle(page);
      t.ok(!counted.length && await page.evaluate(() => window.overdub.analytics.enabled === false), `${label}: nothing counted on the preview (${counted.length})`);
      t.ok(!errors.length, `${label}: no page errors on the preview ` + errors.slice(0, 3).join(' | '));
      await context.close();
    }
  }
} catch (e) {
  t.ok(false, 'analytics test crashed: ' + (e && e.stack || e));
} finally {
  if (session) await session.close();
}
t.done();
