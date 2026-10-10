// Production smoke check: the live site serves, the studio boots, the demo song renders through the real engine,
// and nothing errors. Not part of run-all (it needs the network): node tools/prod-check.js [base-url]
//
// It also holds what deploy/headers.sh and the community shelf promise (docs/COMMUNITY-SHELF.md, "Where it's on"):
// - always: /, /app/, /site/community/ and /community/ carry Content-Security-Policy: frame-ancestors 'none' and
//   X-Frame-Options: DENY; each page's <meta> CSP is the one in this checkout (the header adds to it, never replaces
//   it); /community/ is 200 and /community a 301 to it.
// - only while the live studio's app/src/ui/community.js says COMMUNITY_LIVE = true (else one line says it's skipped):
//   the live index's SHA-256 is deploy/community-pin.json's, its built.from is the pinned index's, no revoked hash is
//   listed in its devices, and a clip answers audio/mpeg. The pinned index is app/community/ when its hash is the pin's
//   (node tools/community-pull.js), else the pin's commit in the overdub-devices checkout (OVERDUB_DEVICES_DIR, else
//   ../overdub-devices).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openUrl, tally } from './pw.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'https://overdubstudio.com';
const t = tally('prod');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

for (const [route, type] of [['/', 'text/html'], ['/app/', 'text/html'], ['/app/src/main.js', 'text/javascript'], ['/llms.txt', 'text/plain'], ['/docs/AGENTS.md', 'text/markdown'], ['/app', null]]) {
  const r = await fetch(BASE + route, { redirect: 'manual' });
  if (type) t.ok(r.status === 200 && (r.headers.get('content-type') || '').startsWith(type), `${route} → ${r.status} ${r.headers.get('content-type')}`);
  else t.ok(r.status === 301 && r.headers.get('location') === '/app/', `${route} redirects to /app/ (${r.status} ${r.headers.get('location')})`);
}
const head = await fetch(BASE + '/', { method: 'HEAD' });
t.ok(/max-age=\d+/.test(head.headers.get('strict-transport-security') || ''), 'HSTS on');

// ---- the frame headers (deploy/headers.sh) on every page a person can land on, and the meta CSPs left as they are
const metaCsp = (html) => /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html)?.[1] ?? null;
for (const [route, file] of [['/', 'site/index.html'], ['/app/', 'app/index.html'], ['/site/community/', 'site/community/index.html'], ['/community/', 'site/community/index.html']]) {
  const r = await fetch(BASE + route, { redirect: 'manual' });
  const csp = r.headers.get('content-security-policy') || '', xfo = r.headers.get('x-frame-options') || '';
  t.ok(r.status === 200 && /(^|;)\s*frame-ancestors 'none'\s*(;|$)/.test(csp) && xfo.toUpperCase() === 'DENY',
    `${route}: Content-Security-Policy frame-ancestors 'none' and X-Frame-Options DENY (${r.status}; csp ${JSON.stringify(csp)}, x-frame-options ${JSON.stringify(xfo)})`);
  const live = metaCsp(await r.text()), here = metaCsp(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  t.ok(live === here, `${route}: its <meta> CSP is ${file}'s, unchanged${here == null ? ' (none)' : ''}${live === here ? '' : ` (live: ${JSON.stringify(live)})`}`);
}
{
  const r = await fetch(BASE + '/community', { redirect: 'manual' });
  t.ok(r.status === 301 && r.headers.get('location') === '/community/', `/community is a 301 to /community/ (${r.status} ${r.headers.get('location')})`);
}

// ---- the community shelf, once it's switched on
{
  const src = await (await fetch(BASE + '/app/src/ui/community.js')).text();
  const live = /export const COMMUNITY_LIVE = (true|false)/.exec(src)?.[1];
  if (live !== 'true') t.note(`the community shelf checks are skipped: the live app/src/ui/community.js says COMMUNITY_LIVE = ${live ?? '(not found)'}`);
  else {
    const pin = JSON.parse(fs.readFileSync(path.join(ROOT, 'deploy/community-pin.json'), 'utf8'));
    const r = await fetch(BASE + '/app/community/community-index.json', { cache: 'no-store' });
    const raw = Buffer.from(await r.arrayBuffer());
    const got = sha256(raw);
    t.ok(r.status === 200 && got === pin.index_sha256, `the live index's SHA-256 is the pin's (${r.status}; ${got.slice(0, 12)}, pin ${pin.index_sha256.slice(0, 12)} at overdub-devices ${pin.commit.slice(0, 7)})`);
    let index = null;
    try { index = JSON.parse(raw.toString('utf8')); } catch { /* the check below fails */ }
    // the pinned index: the pulled copy when it's the pin's, else the pin's commit in the overdub-devices checkout
    let pinned = null, where = '';
    const local = path.join(ROOT, 'app/community/community-index.json');
    if (fs.existsSync(local) && sha256(fs.readFileSync(local)) === pin.index_sha256) { pinned = JSON.parse(fs.readFileSync(local, 'utf8')); where = 'app/community/'; }
    else {
      try {
        const { verify } = await import('./community-pull.js');
        const from = process.env.OVERDUB_DEVICES_DIR || path.join(ROOT, '..', 'overdub-devices');
        pinned = verify(from, pin.commit, { indexSha: pin.index_sha256 }).index;
        where = `${from} at ${pin.commit.slice(0, 7)}`;
      } catch (e) { where = `not found (${e.message}; run node tools/community-pull.js)`; }
    }
    const bf = index?.built?.from, pf = pinned?.built?.from;
    t.ok(!!bf && bf === pf, `the live index's built.from is the pinned index's (${bf}; pinned ${pf ?? '-'}, read from ${where})`);
    const listed = new Set((index?.devices || []).map((e) => e && e.sha256));
    const revoked = (Array.isArray(index?.revoked) ? index.revoked : []).map((x) => x && x.sha256);
    const still = revoked.filter((h) => listed.has(h));
    t.ok(!!index && !still.length, `no revoked fingerprint is listed in the live index's devices (${revoked.length} revoked, ${listed.size} listed${still.length ? '; still listed: ' + still.map((h) => String(h).slice(0, 12)).join(', ') : ''})`);
    const clip = (index?.devices || []).flatMap((e) => e?.preview?.wet?.clips || []).find((c) => c && c.type === 'audio/mpeg');
    if (!clip) t.ok(false, 'a clip answers audio/mpeg (the live index names no MP3 clip)');
    else {
      const c = await fetch(new URL(clip.src, BASE + '/app/community/'), { method: 'HEAD' });
      t.ok(c.status === 200 && (c.headers.get('content-type') || '').startsWith('audio/mpeg'), `a clip answers audio/mpeg (${clip.src}: ${c.status} ${c.headers.get('content-type')})`);
    }
  }
}

{
  const { page, errors, close } = await openUrl(BASE + '/');
  await page.waitForTimeout(1500);
  const title = await page.title();
  t.ok(/overdub/i.test(title), `landing title: ${title}`);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  t.ok(sw <= 0, `landing: no horizontal scroll (${sw})`);
  t.ok(!errors.length, 'landing: no console errors ' + errors.slice(0, 3).join(' | '));
  await close();
}
{
  const { page, errors, close } = await openUrl(BASE + '/app/?demo&autostart');
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const app = window.overdub;
    const M = await import('./src/audio/measure.js');
    const buf = await app.engine.render({ from: 0, to: 32 });
    const m = M.measure(buf);
    const missing = [];
    for (const tr of app.store.get().tracks) {
      if (tr.instrument && !app.devices.getDevice(tr.instrument.device)) missing.push(tr.instrument.device);
      for (const fx of tr.inserts) if (!app.devices.getDevice(fx.device)) missing.push(fx.device);
    }
    return { lufs: +m.lufs.toFixed(1), tp: +m.truePeak.toFixed(1), missing, devices: app.devices.listDevices().length };
  });
  t.ok(r.missing.length === 0 && r.devices > 140, `studio: ${r.devices} devices, every device in the demo resolves ${r.missing.join(' ')}`);
  t.ok(r.lufs > -13 && r.lufs < -8 && r.tp <= -1, `studio: the demo renders at ${r.lufs} LUFS, ${r.tp} dBTP`);
  const real = errors.filter((e) => !/\/bridge\//.test(e));
  t.ok(!real.length, 'studio: no console errors (the local-only MCP bridge excepted) ' + real.slice(0, 3).join(' | '));
  await close();
}
t.done();
