// The deploy's own switches: app/site-config.json, which is not in the repo (it's gitignored). It holds two things: the
// origin of the hosted agent's service ("Claude on Overdub credits"), off unless the file names one, and the community
// shelf's emergency off (docs/COMMUNITY-SHELF.md; ui/community.js and the gallery read it):
//
//   { "cloud": { "api": "https://api.example.com" }, "community": "off" }
//
// "community": "off" is the only value it takes; anything else (or no key) leaves the shelf as the code has it.
//
// No file (a fork, a self-hosted copy, the live site until it's switched on), an unreadable one or a bad origin means
// cloud off: no row in the Agent panel and no request to any cloud origin. The local server answers the file from
// OVERDUB_CLOUD_ORIGIN when there's no file (server/serve.js); deploy/deploy.sh ships deploy/site-config.json, or {}.
//
// ?cloud=<origin> points a local studio at a local service, for development and tests: only when the studio itself is
// on this machine and the origin is on this machine too, so a link can never send someone's song to another server.
//
//   loadSiteConfig({ fetch, search, host, url }) -> Promise<{ cloud: { api } | null, community: 'off' | null }>
//       fetched once per page load; url is 'site-config.json' (beside the studio's page) unless a page elsewhere names
//       /app/site-config.json. ?cloud= replaces the file's cloud origin, never its community key, so the file is read
//       either way.
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

let loaded = null;
export function loadSiteConfig({ fetch: f = globalThis.fetch, search, host, url = 'site-config.json', fresh = false } = {}) {
  if (loaded && !fresh) return loaded;
  loaded = (async () => {
    let j = null;
    try {
      const r = await f(url, { cache: 'no-store', credentials: 'same-origin' });
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) j = await r.json();
    } catch { j = null; }
    const api = cloudOverride(search, host) || cloudOrigin(j?.cloud?.api);
    return { cloud: api ? { api } : null, community: j?.community === 'off' ? 'off' : null };
  })();
  return loaded;
}
