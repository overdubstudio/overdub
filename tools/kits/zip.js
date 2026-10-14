// A pinned-zip source for tools/fetch-kits.js: sound files that come in a zip on their author's own site rather than
// in a git repository (Jester's cab IR packs, tools/kits/jester-cabs.js). Node built-ins only.
//
//   const z = await openZip({ url, sha256 }, { cache, offline })   the zip, downloaded once into `cache` (by SHA-256)
//                                                                    and refused unless it is that SHA-256
//   z.names                                                          every member's name
//   z.read(name, sha256)                                             one member, inflated (node:zlib.inflateRawSync, or
//                                                                    stored), refused unless it is that SHA-256
//
//   const z = await openZipRanged({ url, sha256, size }, { cache, offline, members: { name: sha256 } })
//                                                                    the same reader for a big zip of which a recipe
//                                                                    needs a few members (the Aachen rooms: 12 of a
//                                                                    202 MB zip, tools/kits/air-rooms.js): each member is
//                                                                    read by HTTP Range (the end of the file, then the
//                                                                    central directory, then the member) and cached by
//                                                                    its own SHA-256, so a rebuild is offline. A range
//                                                                    read can't hash the whole zip, so it holds the
//                                                                    server to the pinned size (Content-Range) and every
//                                                                    member to its pin. A server that ignores Range
//                                                                    gets the whole zip, checked against its SHA-256 and
//                                                                    kept in the cache, as openZip does. (A member
//                                                                    pinned to null is read unchecked and not cached:
//                                                                    for looking, never for a build)
//
// Only what the packs need is read: the central directory (no zip64, no encryption, no multi-disk), stored (0) or
// deflated (8) members. The local header is read for its own name and extra lengths, as the spec says to.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

export async function openZip({ url, sha256: want }, { cache, offline = false } = {}) {
  const file = cache ? path.join(cache, want + '.zip') : null;
  let b = null;
  if (file && fs.existsSync(file)) { const c = fs.readFileSync(file); if (sha256(c) === want) b = c; }
  if (!b) {
    if (offline) throw Object.assign(new Error(`${url} isn't in the download cache`), { code: 'NOCACHE' });
    let err = null;
    for (let attempt = 0; attempt < 3 && !b; attempt++) {
      try {
        const r = await fetch(url, { headers: { 'user-agent': 'overdub fetch-kits' } });
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        b = Buffer.from(await r.arrayBuffer());
      } catch (e) { err = e; }
    }
    if (!b) throw new Error(`could not download ${url}: ${err && err.message}`);
    const got = sha256(b);
    if (got !== want) throw new Error(`${url}: SHA-256 ${got}, pinned ${want} (the file changed upstream, or the download is bad)`);
    if (file) { fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(file, b); }
  }
  return readZip(b);
}

// The central directory's entries (b starts at the directory): name -> { method, csize, usize, local, flags }
function centralDirectory(b, count) {
  const members = new Map();
  let o = 0;
  for (let k = 0; k < count; k++) {
    if (o + 46 > b.length || b.readUInt32LE(o) !== 0x02014b50) throw new Error('zip: a bad central directory entry');
    const flags = b.readUInt16LE(o + 8), method = b.readUInt16LE(o + 10), csize = b.readUInt32LE(o + 20), usize = b.readUInt32LE(o + 24);
    const nlen = b.readUInt16LE(o + 28), xlen = b.readUInt16LE(o + 30), clen = b.readUInt16LE(o + 32), local = b.readUInt32LE(o + 42);
    const name = b.toString(flags & 0x800 ? 'utf8' : 'latin1', o + 46, o + 46 + nlen);
    members.set(name, { method, csize, usize, local, flags });
    o += 46 + nlen + xlen + clen;
  }
  return members;
}
// the end of central directory record: the last 'PK\x05\x06' within the final 64 KB + 22 bytes of b
function endRecord(b) {
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) return { count: b.readUInt16LE(i + 10), size: b.readUInt32LE(i + 12), start: b.readUInt32LE(i + 16) };
  }
  throw new Error('zip: no end of central directory');
}
// one member's bytes, from its local header on (b starts at the local header), inflated and checked
function inflateMember(name, m, b, want) {
  if (m.flags & 1) throw new Error(`zip: ${name} is encrypted`);
  if (b.readUInt32LE(0) !== 0x04034b50) throw new Error(`zip: ${name}'s local header is missing`);
  const at = 30 + b.readUInt16LE(26) + b.readUInt16LE(28);
  if (at + m.csize > b.length) throw new Error(`zip: ${name} runs past what was read`);
  const raw = b.subarray(at, at + m.csize);
  let out;
  if (m.method === 0) out = Buffer.from(raw);
  else if (m.method === 8) out = zlib.inflateRawSync(raw);
  else throw new Error(`zip: ${name} uses method ${m.method}`);
  if (out.length !== m.usize) throw new Error(`zip: ${name} inflated to ${out.length} bytes, the directory says ${m.usize}`);
  if (want) { const got = sha256(out); if (got !== want) throw new Error(`${name}: SHA-256 ${got}, pinned ${want}`); }
  return out;
}

// bytes [a, b) of url by HTTP Range: a Buffer, or null when the server sends the whole file instead (no 206)
async function range(url, a, b, size) {
  let err = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'overdub fetch-kits', range: `bytes=${a}-${b - 1}` } });
      if (r.status === 200) { await r.body?.cancel(); return null; }
      if (r.status !== 206) throw new Error(`${r.status} ${r.statusText}`);
      const total = +String(r.headers.get('content-range') || '').replace(/^.*\//, '');
      if (total !== size) throw new Error(`the server says the zip is ${total} bytes, pinned ${size} (the file changed upstream)`);
      const out = Buffer.from(await r.arrayBuffer());
      if (out.length !== b - a) throw new Error(`asked for ${b - a} bytes, got ${out.length}`);
      return out;
    } catch (e) { err = e; if (/pinned/.test(e.message)) throw e; }
  }
  throw new Error(`could not read ${url} by range: ${err && err.message}`);
}

export async function openZipRanged({ url, sha256: zipSha, size }, { cache, offline = false, members = {} } = {}) {
  const ext = (name) => path.extname(name) || '.bin';
  const cached = (name) => {
    const want = members[name];
    const file = cache && want ? path.join(cache, want + ext(name)) : null;
    if (!file || !fs.existsSync(file)) return null;
    const b = fs.readFileSync(file);
    return sha256(b) === want ? b : null;
  };
  const keep = (name, b) => { if (cache && members[name]) { fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(path.join(cache, members[name] + ext(name)), b); } };
  const whole = cache && fs.existsSync(path.join(cache, zipSha + '.zip'));
  const reader = (get) => ({
    names: Object.keys(members),
    read(name, want = members[name]) {
      if (!(name in members)) throw new Error(`zip: ${name} isn't one of the members asked for`);
      const b = get(name);
      if (want && sha256(b) !== want) throw new Error(`${name}: SHA-256 ${sha256(b)}, pinned ${want}`);
      return b;
    },
  });
  // every member cached, or the whole zip: no network
  if (!whole && Object.keys(members).every((n) => cached(n))) return { ...reader(cached), how: 'cache' };
  if (whole || offline) {
    const z = await openZip({ url, sha256: zipSha }, { cache, offline });
    return { ...reader((n) => z.read(n, members[n])), how: 'zip' };
  }
  // by range: the end record, the directory, then each member not yet cached
  const tailLen = Math.min(size, 65557);
  const tail = await range(url, size - tailLen, size, size);
  if (!tail) {
    const z = await openZip({ url, sha256: zipSha }, { cache });
    return { ...reader((n) => z.read(n, members[n])), how: 'zip' };
  }
  const end = endRecord(tail);
  if (end.start + end.size > size) throw new Error('zip: the central directory runs past the end');
  const base = size - tailLen;
  const dir = end.start >= base ? tail.subarray(end.start - base) : await range(url, end.start, end.start + end.size, size);
  if (!dir) throw new Error(`${url} answered one Range request and then ignored the next`);
  const entries = centralDirectory(dir, end.count);
  const got = new Map();
  for (const name of Object.keys(members)) {
    const c = cached(name);
    if (c) { got.set(name, c); continue; }
    const m = entries.get(name);
    if (!m) throw new Error(`zip: no member ${name}`);
    // the local header's own name and extra lengths can differ from the directory's: read up to 128 KB past it
    const b = await range(url, m.local, Math.min(size, m.local + 30 + 2 * 65535 + m.csize), size);
    if (!b) throw new Error(`${url} answered one Range request and then ignored the next`);
    const out = inflateMember(name, m, b, members[name]);
    keep(name, out);
    got.set(name, out);
  }
  return { ...reader((n) => got.get(n)), how: 'range' };
}

// the members of a zip held in memory: { names, read(name, sha256) }
export function readZip(b) {
  const end = endRecord(b);
  if (end.start + end.size > b.length) throw new Error('zip: the central directory runs past the end');
  const members = centralDirectory(b.subarray(end.start, end.start + end.size), end.count);
  return {
    names: [...members.keys()],
    read(name, want) {
      const m = members.get(name);
      if (!m) throw new Error(`zip: no member ${name}`);
      return inflateMember(name, m, b.subarray(m.local), want);
    },
  };
}
