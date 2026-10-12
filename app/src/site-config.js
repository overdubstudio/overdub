// The deploy's own switches: app/site-config.json, which is not in the repo (it's gitignored). It holds the origin of
// the hosted agent's service ("Claude on Overdub credits"), the feature toggles (app/src/toggles.js reads them) and, on
// the preview, which site this is (ui/preview.js reads env, preview and ref):
//
//   { "cloud": { "api": "https://api.example.com" }, "toggles": { "relay": "on" } }
//
// No file (a fork, a self-hosted copy), an unreadable one or a bad origin means cloud off: no row in the Agent panel
// and no request to any cloud origin. The local server answers the deploy's defaults when there's no file (server/serve.js);
// deploy/deploy.sh ships deploy/site-config.json, or {}, plus the registry's deploy: 'on' toggles.
//
// ?cloud=<origin> points a local studio at a local service, for development and tests: only when the studio itself is
// on this machine and the origin is on this machine too, so a link can never send someone's song to another server.
//
//   loadSiteConfig({ fetch, search, host, url }) -> Promise<{ cloud: { api } | null, toggles, raw, read }>
//       fetched once per page load (main.js starts it at the top of boot); url is app/site-config.json, resolved from
//       this module, so a page outside /app/ reads the same file. ?cloud= replaces the file's cloud origin, and the
//       file is read either way. toggles is the file's raw "toggles" value (toggles.js judges it); raw is the whole
//       parsed file, or null. read is 'ok' (a JSON answer), 'absent' (a 404 or 410: there is no file, so the deploy
//       turns nothing on) or 'failed' (the network, a 5xx, an HTML error page, JSON that doesn't parse: there may well
//       be a file, this load just couldn't see it; toggles.js bootConfig gives the deploy's defaults then).
//   cloudOrigin(value) -> origin | null       https:, or http: on a loopback name; anything else is refused
//   cloudOverride(search, host) -> origin | null

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;

export function cloudOrigin(value) {
  if (typeof value !== 'string' || !value) return null;
  let u;
  try { u = new URL(value); } catch { return null; }
  if (u.username || u.password) return null;
  if (u.protocol === 'https:') return u.origin;
  if (u.protocol === 'http:' && LOOPBACK.test(u.hostname)) return u.origin;
  return null;
}

export function cloudOverride(search = globalThis.location?.search || '', host = globalThis.location?.hostname || '') {
  if (!LOOPBACK.test(host)) return null;
  const q = new URLSearchParams(search).get('cloud');
  const o = cloudOrigin(q);
  return o && LOOPBACK.test(new URL(o).hostname) ? o : null;
}

export const CONFIG_URL = new URL('../site-config.json', import.meta.url).href;

let loaded = null;
export function loadSiteConfig({ fetch: f = globalThis.fetch, search, host, url = CONFIG_URL, fresh = false } = {}) {
  if (loaded && !fresh) return loaded;
  loaded = (async () => {
    let j = null, read = 'failed';
    try {
      const r = await f(url, { cache: 'no-store', credentials: 'same-origin' });
      if (r.status === 404 || r.status === 410) read = 'absent';
      else if (r.ok && (r.headers.get('content-type') || '').includes('json')) { j = await r.json(); read = 'ok'; }
    } catch { j = null; read = 'failed'; }
    const api = cloudOverride(search, host) || cloudOrigin(j?.cloud?.api);
    return { cloud: api ? { api } : null, toggles: j?.toggles ?? null, raw: j ?? null, read };
  })();
  return loaded;
}
