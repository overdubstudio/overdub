// The studio as the live site would run it, for the shelf's checks. The studio is served under another name
// (overdub.test, not a local host, so the shelf's local-only allowances are off), with the studio's own shelf copy and
// /app/site-config.json answered on the way through when asked. Nothing on disk changes. A helper, not a suite:
// tools/community-test.js and the agent and relay checks use it.
//
//   const P = await openLive(path, { query, bundled, siteConfig, width, height, routes })
//     path        '/app/' (default) or '/site/community/' …
//     query       the page's query string, or (local) => query, given the real server's origin
//     bundled     a directory to serve /app/community/ from (community-index.json from bundled-index.json when the
//                 directory has one), read on every request, so a check can change it between loads; default:
//                 whatever the studio's own server has (app/community/, the pull's)
//     siteConfig  an object to serve as /app/site-config.json, or a function returning one, asked on every request;
//                 default: the server's own answer
//     routes      async (page, { host, local }) => {}: more routes, set after these, so they win
//   P is pw.js's open() result, on http://overdub.test<path>?<query>, plus P.host, P.local (the real server's origin),
//   P.configs (each site config the page was answered, parsed) and P.requests (every URL the page asked for)
//
//   await liveRoutes(page, { origin, local, bundled, siteConfig, errors, configs })
//     the same routes on any origin (the relay's check serves the fixture shelf on its own localhost tab with it)
import fs from 'node:fs';
import path from 'node:path';
import { open } from './pw.js';

export const LIVE_HOST = 'overdub.test';
export async function liveRoutes(page, { origin, local, bundled = null, siteConfig = null, errors = [], configs = [] }) {
  // (a predicate, not a glob: only this exact origin, never a server on another port of the same host, such as a relay)
  await page.route((u) => u.origin === origin, async (r) => {
    try {
      await handle(r);
    } catch (e) {
      // A request still in flight when the page or browser closes (a font, say, as a check ends), or one the page
      // cancelled while its answer was being fetched ("Route is already handled"), rejects its fetch or fulfill;
      // nobody is left to answer, so that one is dropped. Any other throw goes in the page's errors, where the check
      // sees it, never as an unhandled rejection that kills the suite.
      const gone = page.isClosed() || !page.context().browser()?.isConnected() || /has been closed|Target closed|Route is already handled/i.test(String(e && e.message));
      if (!gone) errors.push(`community-live: ${r.request().url()}: ${(e && e.message) || e}`);
    }
  });
  async function handle(r) {
    const u = new URL(r.request().url());
    if (u.pathname === '/app/site-config.json') {
      let base;
      if (siteConfig) base = typeof siteConfig === 'function' ? siteConfig() : siteConfig;
      else { const res = await r.fetch({ url: local + u.pathname }); base = res.ok() ? await res.json().catch(() => ({})) : {}; }
      const cfg = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
      configs.push(cfg);
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(cfg) });
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
    if (origin === local) return r.continue();
    const res = await r.fetch({ url: local + u.pathname + u.search });
    return r.fulfill({ response: res });
  }
}

export async function openLive(route = '/app/', { query = '', bundled = null, siteConfig = null, width, height, routes = null } = {}) {
  const P = await open(route, { width, height });
  // routes still being answered when the check closes the page are let go first (Playwright's advice for routes in flight)
  const close = P.close;
  P.close = async () => { await P.page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await close(); };
  try {
    const local = new URL(P.url).origin;
    P.host = LIVE_HOST;
    P.local = local;
    P.configs = [];
    P.requests = [];
    P.page.on('request', (q) => P.requests.push(q.url()));
    await liveRoutes(P.page, { origin: `http://${LIVE_HOST}`, local, bundled, siteConfig, errors: P.errors, configs: P.configs });
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
