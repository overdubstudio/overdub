// The deploy's own configuration: app/site-config.json, which is not in the repo (it's gitignored). It holds the
// origin of the hosted agent's service ("Claude on Overdub credits"), the account service's ("Sign in with Overdub",
// agent/remote.js), where the stems runner's model and runtime live (spec 0014 R21; jobs/stems/runner.js) and, on the
// preview, which site this is (ui/preview.js reads env, preview and ref). It switches nothing a merge didn't ship: a
// dormant service is absent until the file names it.
//
//   { "cloud": { "api": "https://api.example.com" }, "accounts": { "api": "https://api.example.com" },
//     "stems": { "model": "vendor/models/htdemucs.onnx", "sha256": "<64 hex>", "runtime"?: "vendor/ort/ort.webgpu.min.mjs",
//                "id"?: "htdemucs", "bytes"?: 88700000 } }
//
// No file (a fork, a self-hosted copy), an unreadable one or a bad origin means cloud off: no row in the Agent panel
// and no request to any cloud origin; the same for accounts (no account mode in Connect). The same for stems: no entry,
// a bad URL or no pinned SHA-256 means the runner is off and nothing is fetched. The stems URLs resolve against this file, so a
// path is on this site; the runtime defaults to vendor/ort/ort.webgpu.min.mjs and must be on this site (the studio's
// CSP runs scripts from 'self' only: the runner refuses another origin, deploy.sh stages it there from runtimeFrom).
// The local server answers the deploy's defaults when there's no file (server/serve.js, with OVERDUB_CLOUD_ORIGIN and
// OVERDUB_STEMS_*); deploy/deploy.sh ships REF's deploy/live-config.json, or {}.
//
// ?cloud=<origin> points a local studio at a local service, for development and tests: only when the studio itself is
// on this machine and the origin is on this machine too, so a link can never send someone's song to another server.
//
//   loadSiteConfig({ fetch, search, host, url }) -> Promise<{ cloud: { api } | null, accounts: { api } | null,
//                                                              stems: {...} | null, raw, read }>
//       fetched once per page load (main.js starts it at the top of boot); url is app/site-config.json, resolved from
//       this module, so a page outside /app/ reads the same file. ?cloud= replaces the file's cloud origin, and the
//       file is read either way. accounts.api is held to cloudOrigin's rule too. raw is the whole parsed file, or null.
//       read is 'ok' (a JSON answer), 'absent' (a 404 or 410: there is no file) or 'failed' (the network, a 5xx, an
//       HTML error page, JSON that doesn't parse: there may well be a file, this load just couldn't see it).
//   cloudOrigin(value) -> origin | null       https:, or http: on a loopback name; anything else is refused
//   stemsConfig(value, base = CONFIG_URL) -> { model, runtime, sha256, id, bytes? } | null   both URLs resolved
//                                             against base (a path is on this site; runtime defaults to STEMS_RUNTIME),
//                                             then by cloudOrigin's rule; the hash 64 hex digits (lower-cased), id a
//                                             short name (default 'htdemucs'). Whether each is on the page's own origin
//                                             is the runner's check (jobs/stems/runner.js), where the page is known.
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
export const STEMS_RUNTIME = 'vendor/ort/ort.webgpu.min.mjs';

// a URL the stems entry may name, resolved against the config file: https:, or http: on this machine (or this site)
function allowedUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let u;
  try { u = new URL(value, base); } catch { return null; }
  if (!cloudOrigin(u.href)) return null;
  u.hash = '';
  return u.href;
}

export function stemsConfig(value, base = CONFIG_URL) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const model = allowedUrl(value.model, base), runtime = allowedUrl(value.runtime ?? STEMS_RUNTIME, base);
  const sha256 = typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(value.sha256) ? value.sha256.toLowerCase() : null;
  if (!model || !runtime || !sha256) return null;
  const id = typeof value.id === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value.id) ? value.id : 'htdemucs';
  const out = { model, runtime, sha256, id };
  if (Number.isFinite(value.bytes) && value.bytes > 0) out.bytes = Math.round(value.bytes);
  return out;
}

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
    const accounts = cloudOrigin(j?.accounts?.api);
    return { cloud: api ? { api } : null, accounts: accounts ? { api: accounts } : null, stems: stemsConfig(j?.stems, url), raw: j ?? null, read };

  })();
  return loaded;
}
