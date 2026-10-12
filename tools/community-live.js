// The studio as the live site would run it with the community shelf switched on, for the checks that need the flag on
// before it is (the shelf-live spec: "with the live flag"). The studio is served under another name (overdub.test, not a
// local host, so the shelf's local-only allowances are off), and app/src/ui/community.js and site/community/community.js
// are rewritten on the way through so COMMUNITY_LIVE (and, unless asked not to, TRY_ON) read true. Nothing on disk
// changes. A helper, not a suite: tools/community-test.js and the agent and relay checks use it.
//
//   const P = await openLive(path, { query, flags, bundled, siteConfig, width, height, routes })
//     path        '/app/' (default) or '/site/community/' …
//     query       the page's query string, or (local) => query, given the real server's origin
//     flags       { COMMUNITY_LIVE: true, TRY_ON: true } by default; pass TRY_ON: false to keep Try held back
//     bundled     a directory to serve /app/community/ from (community-index.json from bundled-index.json when the
//                 directory has one), read on every request, so a check can change it between loads; default:
//                 whatever the studio's own server has (app/community/, the pull's)
//     siteConfig  an object to serve as /app/site-config.json (the deploy's switches: { community: 'off' }), or a
//                 function returning one, asked on every request; default: the server's own answer
//     routes      async (page, { host, local }) => {}: more routes, set after these, so they win
//   P is pw.js's open() result, on http://overdub.test<path>?<query>, plus P.host, P.local (the real server's origin),
//   P.rewritten (the modules whose flags were rewritten) and P.requests (every URL the page asked for)
//
//   await liveRoutes(page, { origin, local, flags, bundled, siteConfig, errors, rewritten })
//     the same routes on any origin (the relay's check forces the flags on its own localhost tab with it)
import fs from 'node:fs';
import path from 'node:path';
import { open } from './pw.js';

export const LIVE_HOST = 'overdub.test';
const FLAGGED = ['/app/src/ui/community.js', '/site/community/community.js'];

// src with each named flag set; found: how many of the names it declares
export function forceFlags(src, flags) {
  let out = src, found = 0;
  for (const [name, value] of Object.entries(flags)) {
    const re = new RegExp(`^export const ${name} = (true|false);`, 'm');
    if (re.test(out)) { found++; out = out.replace(re, `export const ${name} = ${value ? 'true' : 'false'};`); }
  }
  return { out, found };
}

export async function liveRoutes(page, { origin, local, flags = { COMMUNITY_LIVE: true, TRY_ON: true }, bundled = null, siteConfig = null, errors = [], rewritten = [] }) {
  // (a predicate, not a glob: only this exact origin, never a server on another port of the same host, such as a relay)
  await page.route((u) => u.origin === origin, async (r) => {
    try {
      await handle(r);
    } catch (e) {
      // A request still in flight when the page or browser closes (a font, say, as a check ends) rejects its fetch or
      // fulfill; nobody is left to answer, so that one is dropped. Any other throw goes in the page's errors, where
      // the check sees it, never as an unhandled rejection that kills the suite.
      const gone = page.isClosed() || !page.context().browser()?.isConnected() || /has been closed|Target closed/i.test(String(e && e.message));
      if (!gone) errors.push(`community-live: ${r.request().url()}: ${(e && e.message) || e}`);
    }
  });
  async function handle(r) {
    const u = new URL(r.request().url());
    if (siteConfig && u.pathname === '/app/site-config.json') {
      const cfg = typeof siteConfig === 'function' ? siteConfig() : siteConfig;
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(cfg || {}) });
    }
    if (bundled && u.pathname.startsWith('/app/community/')) {
      let f = u.pathname.slice('/app/community/'.length);
      if (f === 'community-index.json' && fs.existsSync(path.join(bundled, 'bundled-index.json'))) f = 'bundled-index.json';
      const p = path.join(bundled, f);
      if (f.includes('..') || !fs.existsSync(p)) return r.fulfill({ status: 404, body: '' });
      const type = /\.json$/.test(p) ? 'application/json' : /\.mp3$/.test(p) ? 'audio/mpeg' : /\.wav$/.test(p) ? 'audio/wav' : 'application/octet-stream';
      return r.fulfill({ status: 200, contentType: type, body: fs.readFileSync(p) });
    }
    // on the real server's own origin, what isn't changed goes through untouched (an event stream among it)
    if (origin === local && !FLAGGED.includes(u.pathname)) return r.continue();
    const res = await r.fetch({ url: local + u.pathname + u.search });
    if (FLAGGED.includes(u.pathname)) {
      const src = await res.text();
      const { out, found } = forceFlags(src, flags);
      // (a route handler's throw never reaches the check, so it goes in the page's errors)
      if (!found) errors.push(`community-live: no flag to set in ${u.pathname}`);
      else if (!rewritten.includes(u.pathname)) rewritten.push(u.pathname);
      const headers = { ...res.headers(), 'content-type': 'text/javascript; charset=utf-8' };
      delete headers['content-length'];
      return r.fulfill({ status: res.status(), body: out, headers });
    }
    return r.fulfill({ response: res });
  }
}

export async function openLive(route = '/app/', { query = '', flags = { COMMUNITY_LIVE: true, TRY_ON: true }, bundled = null, siteConfig = null, width, height, routes = null } = {}) {
  const P = await open(route, { width, height });
  // routes still being answered when the check closes the page are let go first (Playwright's advice for routes in flight)
  const close = P.close;
  P.close = async () => { await P.page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await close(); };
  try {
    const local = new URL(P.url).origin;
    P.host = LIVE_HOST;
    P.local = local;
    P.rewritten = [];
    P.requests = [];
    P.page.on('request', (q) => P.requests.push(q.url()));
    await liveRoutes(P.page, { origin: `http://${LIVE_HOST}`, local, flags, bundled, siteConfig, errors: P.errors, rewritten: P.rewritten });
    if (routes) await routes(P.page, { host: LIVE_HOST, local });
    const q = typeof query === 'function' ? query(local) : query;
    P.url = `http://${LIVE_HOST}${route}${q ? `?${q}` : ''}`;
    // (only what the page under LIVE_HOST asks for: the local page is gone before the count starts)
    await P.page.goto('about:blank');
    P.requests.length = 0;
    await P.page.goto(P.url, { waitUntil: 'load' });
    return P;
  } catch (e) {
    await P.close();
    throw e;
  }
}
