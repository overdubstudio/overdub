// The deploy's own switches: app/site-config.json, which is not in the repo (it's gitignored). It holds two things, each
// off unless the file names it: the origin of the hosted agent's service ("Claude on Overdub credits"), and where the
// stems runner's model and runtime live (spec 0014 R21; jobs/stems/runner.js):
//
//   { "cloud": { "api": "https://api.example.com" },
//     "stems": { "model": "https://cdn.example.com/htdemucs.onnx", "sha256": "<64 hex>",
//                "runtime": "https://cdn.example.com/ort/ort.webgpu.min.mjs", "id"?: "htdemucs", "bytes"?: 88700000 } }
//
// No file (a fork, a self-hosted copy, the live site until it's switched on), an unreadable one or a bad origin means
// cloud off: no row in the Agent panel and no request to any cloud origin. The same for stems: no entry, a bad URL or
// no pinned SHA-256 means the runner is off and nothing is fetched. Both take the same origin rule: https:, or http: on
// this machine. The local server answers the file from OVERDUB_CLOUD_ORIGIN and OVERDUB_STEMS_* when there's no file
// (server/serve.js); deploy/deploy.sh ships deploy/site-config.json, or {}.
//
// ?cloud=<origin> points a local studio at a local service, for development and tests: only when the studio itself is
// on this machine and the origin is on this machine too, so a link can never send someone's song to another server.
//
//   loadSiteConfig({ fetch, search, host }) -> Promise<{ cloud: { api } | null, stems: {...} | null }>   once a load
//   cloudOrigin(value) -> origin | null       https:, or http: on a loopback name; anything else is refused
//   stemsConfig(value) -> { model, runtime, sha256, id, bytes? } | null   both URLs by cloudOrigin's rule, the hash
//                                             64 hex digits (lower-cased), id a short name (default 'htdemucs')
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

function allowedUrl(value) {
  if (!cloudOrigin(value)) return null;
  const u = new URL(value);
  u.hash = '';
  return u.href;
}

export function stemsConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const model = allowedUrl(value.model), runtime = allowedUrl(value.runtime);
  const sha256 = typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(value.sha256) ? value.sha256.toLowerCase() : null;
  if (!model || !runtime || !sha256) return null;
  const id = typeof value.id === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value.id) ? value.id : 'htdemucs';
  const out = { model, runtime, sha256, id };
  if (Number.isFinite(value.bytes) && value.bytes > 0) out.bytes = Math.round(value.bytes);
  return out;
}

let loaded = null;
export function loadSiteConfig({ fetch: f = globalThis.fetch, search, host, fresh = false } = {}) {
  if (loaded && !fresh) return loaded;
  loaded = (async () => {
    const override = cloudOverride(search, host);
    let j = null;
    try {
      const r = await f('site-config.json', { cache: 'no-store', credentials: 'same-origin' });
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) j = await r.json();
    } catch { j = null; }
    const api = override || cloudOrigin(j?.cloud?.api);
    return { cloud: api ? { api } : null, stems: stemsConfig(j?.stems) };
  })();
  return loaded;
}
