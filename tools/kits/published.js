// The pinned kits as the site already serves them. deploy/deploy.sh uploads every kit a device names to
// app/kits/<sha256>.odk, and a file named by its hash never changes, so a copy that hashes to the pin is that kit, byte
// for byte, whoever served it. tools/fetch-kits.js takes one from here when the download cache can't rebuild it, so a
// deploy needs our site and not the dozen upstream servers the kits were built from (one of which being down once
// stopped a live deploy). A kit no site has yet (a new one, before its first deploy) is still built from upstream.
//
//   await fetchPublished('sha256-<hex>', { from, fetch, log }) -> { bytes, url } | null
//   origins(env) -> KITS_FROM (comma or space separated; empty: none) or ORIGINS
import crypto from 'node:crypto';
import { dataFile } from '../../app/src/kernel/odk.js';

// the live site first (everything it serves was deployed by the approved workflow), then the preview (where a kit is
// first published, from main)
export const ORIGINS = ['https://overdubstudio.com', 'https://next.overdubstudio.com'];

export const origins = (env = process.env) =>
  env.KITS_FROM === undefined ? ORIGINS : env.KITS_FROM.split(/[\s,]+/).filter(Boolean);

// a whole kit (the biggest is a few hundred MB) on a slow line: long, but never forever
const TIMEOUT_MS = 10 * 60 * 1000;

export async function fetchPublished(pinned, { from = origins(), fetch = globalThis.fetch, log = () => {} } = {}) {
  const hex = /^sha256-([0-9a-f]{64})$/.exec(pinned)?.[1];
  if (!hex) throw new Error(`${pinned}: not a SHA-256 pin`);
  for (const origin of from) {
    const url = `${origin.replace(/\/+$/, '')}/app/${dataFile(pinned)}`;
    let bytes;
    try {
      // fetch undoes the gzip the site sends kits with (Content-Encoding)
      const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!r.ok) {
        log(`${url}: ${r.status} ${r.statusText}`.trim());
        continue;
      }
      bytes = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      log(`${url}: ${e.cause?.code || e.message}`);
      continue;
    }
    const got = crypto.createHash('sha256').update(bytes).digest('hex');
    if (got !== hex) {
      log(`${url}: SHA-256 ${got.slice(0, 12)}…, not the pinned kit`);
      continue;
    }
    return { bytes, url };
  }
  return null;
}
