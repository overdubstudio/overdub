// The community shelf the studio ships, pulled from overdub-devices at the commit deploy/community-pin.json names
// (docs/COMMUNITY-SHELF.md, "Where it's on"; the shelf-live spec, R2-R4). Plain Node and git, no dependencies.
//
//   node tools/community-pull.js                      fill app/community/ (gitignored) from the pinned commit
//   node tools/community-pull.js --pin <commit>       check that commit's index, write deploy/community-pin.json, print
//                                                     what's added, changed and taken down since the last pin (the pin
//                                                     PR's body: .github/PULL_REQUEST_TEMPLATE/community-pin.md), and
//                                                     fill app/community/ from it
//   --from <dir>       the overdub-devices checkout (default $OVERDUB_DEVICES_DIR, else ../overdub-devices)
//   --out <dir>        where the shelf goes (default app/community); replaced whole, and only once everything passed
//   --pin-file <file>  the pin to read or write (default deploy/community-pin.json; deploy.sh passes the one at REF)
//
// The pin: { "repo": "overdubstudio/overdub-devices", "commit": "<40 hex>", "index_sha256": "<64 hex>" }. Its keys are
// forever. The pull reads `git archive <commit> index/` (never the checkout's working tree) and refuses, writing
// nothing, when:
//   - the index's SHA-256 isn't the pin's;
//   - built.from says +dirty, isn't a commit in the checkout, or isn't the pin or an ancestor of it (the index is
//     committed after it's built, so built.from is the commit before; short SHAs compare by prefix);
//   - devices/, revoked.json or picks.json differ between built.from and the pin (the index would be stale);
//   - a device file is missing, or its kernel's SHA-256 (kernelHash, app/src/devices/trust.js) isn't its entry's;
//   - an entry's fingerprint is on the index's own revoked list;
//   - an MP3 clip the index names isn't in the commit.
// It warns, and goes on, when built.checks is null (no CI check report pinned) and when the index still carries DRAFT
// wording. It copies the index, the device files the entries name and the MP3 clips: no WAV, nothing else.
//
// Exit codes: 0 pulled; 1 refused (the shelf is wrong: deploy nothing); 2 usage; 3 unavailable (no checkout, or the
// pinned commit isn't in it: deploy.sh holds the shelf back while it wouldn't ship anyway).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { kernelHash } from '../app/src/devices/trust.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(HERE, '..');
export const REPO = 'overdubstudio/overdub-devices';
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class PullError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'refused' | 'unavailable' | 'usage'
  }
}
const refuse = (m) => {
  throw new PullError('refused', m);
};

// a path as typed in a log line: relative to here when that's shorter
const shown = (f) => {
  const r = path.relative(process.cwd(), f);
  return !r ? f : r.startsWith('..') ? f : r;
};
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function git(dir, args, { buffer = false, ok = [0] } = {}) {
  const r = spawnSync('git', ['-C', dir, ...args], { maxBuffer: 256 * 1024 * 1024, encoding: buffer ? null : 'utf8' });
  if (r.error) throw new PullError('unavailable', `git didn't run: ${r.error.message}`);
  return { status: r.status, out: r.stdout, err: String(r.stderr || '') };
}

// a commit (full, short or a ref) in the checkout, as its full SHA, or null
function resolveCommit(dir, ref) {
  if (typeof ref !== 'string' || !/^[0-9A-Za-z._/-]{1,200}$/.test(ref) || ref.startsWith('-')) return null;
  const r = git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return r.status === 0 ? r.out.trim() : null;
}

// the files of a tar (git archive's ustar, with pax headers for long names), as Map(path -> Buffer)
export function untar(buf) {
  const files = new Map();
  let off = 0, paxPath = null;
  const str = (a, b) => buf.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
  while (off + 512 <= buf.length) {
    const head = buf.subarray(off, off + 512);
    if (head.every((b) => b === 0)) break;
    const size = parseInt(str(off + 124, off + 136).trim() || '0', 8);
    const type = String.fromCharCode(head[156] || 48);
    const prefix = str(off + 345, off + 500);
    let name = (prefix ? prefix + '/' : '') + str(off, off + 100);
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      // pax records: "<len> key=value\n"
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      paxPath = m ? m[1] : null;
      continue;
    }
    if (type === 'g') continue;
    if (paxPath) { name = paxPath; paxPath = null; }
    if (type === '0' || type === '\0') files.set(name, Buffer.from(body));
  }
  return files;
}

// the index/ tree at a commit, as Map('community-index.json' | 'devices/…' | 'clips/…' -> Buffer)
function archiveIndex(dir, commit) {
  const r = git(dir, ['archive', '--format=tar', commit, 'index/'], { buffer: true });
  if (r.status !== 0) refuse(`git archive ${commit.slice(0, 12)} index/ failed: ${r.err.trim() || 'no index/ at that commit'}`);
  const out = new Map();
  for (const [name, body] of untar(r.out)) {
    if (!name.startsWith('index/')) continue;
    const rel = name.slice('index/'.length);
    if (rel.split('/').some((p) => p === '..' || p === '.' || p === '')) refuse(`a path in the archive isn't plain: ${name}`);
    out.set(rel, body);
  }
  return out;
}

const mp3s = (clips) => (Array.isArray(clips) ? clips : []).filter((c) => c && c.type === 'audio/mpeg' && typeof c.src === 'string');

/**
 * Check the shelf at `commit` in the overdub-devices checkout `from`. With `indexSha`, the index must hash to it.
 * Returns { commit, short, indexSha, index, files: Map(rel -> Buffer), warnings, devices, clips } or throws PullError.
 */
export function verify(from, commit, { indexSha = null } = {}) {
  if (!from || !fs.existsSync(path.join(from, '.git'))) throw new PullError('unavailable', `no overdub-devices checkout at ${from || '(none)'} (set OVERDUB_DEVICES_DIR or pass --from)`);
  const full = resolveCommit(from, commit);
  if (!full) throw new PullError('unavailable', `${commit} isn't a commit in ${from} (git fetch there first)`);
  const tree = archiveIndex(from, full);
  const raw = tree.get('community-index.json');
  if (!raw) refuse(`no index/community-index.json at ${full.slice(0, 12)}`);
  const got = sha256(raw);
  if (indexSha && got !== indexSha) refuse(`the index at ${full.slice(0, 12)} hashes to ${got}, not the pin's ${indexSha}`);
  let index;
  try { index = JSON.parse(raw.toString('utf8')); } catch (e) { refuse(`the index isn't JSON: ${e.message}`); }
  if (!index || index.format !== 'overdub-community-index/1' || !Array.isArray(index.devices)) refuse(`the index's format is ${index && index.format}, not overdub-community-index/1`);

  // built.from: clean, a commit here, the pin or an ancestor of it, with the shelf's inputs unchanged since
  const m = /^overdub-devices@([0-9a-f]{7,40})(\+dirty)?$/.exec(String(index.built && index.built.from || ''));
  if (!m) refuse(`built.from is ${JSON.stringify(index.built && index.built.from)}: not overdub-devices@<commit>`);
  if (m[2]) refuse(`built.from is ${m[0]}: the index was built from uncommitted edits`);
  const fromFull = resolveCommit(from, m[1]);
  if (!fromFull || !fromFull.startsWith(m[1])) refuse(`built.from's commit ${m[1]} isn't in ${from}`);
  if (fromFull !== full && git(from, ['merge-base', '--is-ancestor', fromFull, full]).status !== 0) refuse(`built.from (${m[1]}) isn't ${full.slice(0, 12)} or an ancestor of it`);
  const diff = git(from, ['diff', '--name-only', fromFull, full, '--', 'devices', 'revoked.json', 'picks.json']);
  if (diff.status !== 0) refuse(`git diff ${m[1]} ${full.slice(0, 12)} failed: ${diff.err.trim()}`);
  if (diff.out.trim()) refuse(`devices/, revoked.json or picks.json changed between built.from (${m[1]}) and ${full.slice(0, 12)}, so the index is stale: ${diff.out.trim().split('\n').slice(0, 5).join(', ')}`);

  // each entry's device file, by its kernel's hash; nothing revoked listed; the MP3s it names
  const revoked = new Set((Array.isArray(index.revoked) ? index.revoked : []).map((r) => r && r.sha256));
  const files = new Map([['community-index.json', raw]]);
  const ids = new Set();
  for (const e of index.devices) {
    const id = e && e.id;
    if (typeof id !== 'string' || ids.has(id)) refuse(`an entry has no id, or a repeated one (${id})`);
    ids.add(id);
    if (!HEX64.test(String(e.sha256))) refuse(`${id}: its fingerprint isn't 64 hex characters`);
    if (revoked.has(e.sha256)) refuse(`${id} is listed, but its fingerprint ${e.sha256.slice(0, 12)} is on the revoked list`);
    const rel = String(e.device || '');
    const dm = /^devices\/([^/]+)$/.exec(rel);
    if (!dm || !SAFE_FILE.test(dm[1]) || !/\.json$/.test(dm[1])) refuse(`${id}: its device file ${JSON.stringify(rel)} isn't under devices/`);
    const body = tree.get(rel);
    if (!body) refuse(`${id}: ${rel} isn't in the commit`);
    let kernel;
    try { kernel = JSON.parse(body.toString('utf8')).device.kernel; } catch { kernel = null; }
    const h = kernelHash(kernel);
    if (h !== e.sha256) refuse(`${id}: the kernel in ${rel} hashes to ${h ? h.slice(0, 12) : 'nothing'}, not its entry's ${e.sha256.slice(0, 12)}`);
    files.set(rel, body);
  }
  const clipLists = [];
  for (const inp of Object.values(index.inputs || {})) clipLists.push(['an input', inp && inp.clips]);
  for (const e of index.devices) clipLists.push([e.id, e.preview && e.preview.wet && e.preview.wet.clips], [e.id, e.preview && e.preview.dry && e.preview.dry.clips]);
  let clips = 0;
  for (const [who, list] of clipLists) {
    for (const c of mp3s(list)) {
      const cm = /^clips\/(?:_inputs\/)?([^/]+)$/.exec(c.src);
      if (!cm || !SAFE_FILE.test(cm[1]) || !/\.mp3$/.test(cm[1])) refuse(`${who}: the clip ${JSON.stringify(c.src)} isn't an MP3 under clips/`);
      const body = tree.get(c.src);
      if (!body) refuse(`${who}: ${c.src} isn't in the commit`);
      if (Number.isFinite(c.bytes) && body.length !== c.bytes) refuse(`${who}: ${c.src} is ${body.length} bytes, and the index says ${c.bytes}`);
      if (!files.has(c.src)) clips++;
      files.set(c.src, body);
    }
  }

  const warnings = [];
  if (!index.built.checks) warnings.push('built.checks is null: the index carries no CI check report (node tools/index.js --checks <report>)');
  const drafts = index.devices.filter((e) => /\bDRAFT\b/.test(String(e.requester || '') + String(e.request || ''))).length;
  if (drafts) warnings.push(`${drafts} entr${drafts === 1 ? 'y still says DRAFT in its' : 'ies still say DRAFT in their'} requester or request`);
  return { commit: full, short: full.slice(0, 7), indexSha: got, index, files, warnings, devices: index.devices.length, clips };
}

// replace `out` with exactly `files`, built beside it first, so a failure leaves the old shelf as it was
export function writeOut(out, files) {
  const tmp = `${out.replace(/\/+$/, '')}.pull-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [rel, body] of files) {
    const f = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.renameSync(tmp, out);
}

export function readPin(file) {
  let p;
  try { p = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new PullError('usage', `can't read the pin ${file}: ${e.message}`); }
  if (!p || !HEX40.test(String(p.commit)) || !HEX64.test(String(p.index_sha256))) throw new PullError('usage', `${file} isn't a pin: { "repo", "commit": <40 hex>, "index_sha256": <64 hex> }`);
  return p;
}

const label = (e) => `${e.name || e.id} (\`${e.id}\`${e.tier === 'house' ? ', House' : ''}, ${String(e.sha256 || '').slice(0, 12)})`;

/** What moved between two indexes: { added, changed, down } as lines for the pin PR. */
export function summarize(before, after) {
  const was = new Map((before && Array.isArray(before.devices) ? before.devices : []).map((e) => [e.id, e]));
  const now = new Map((Array.isArray(after.devices) ? after.devices : []).map((e) => [e.id, e]));
  const revokedNow = new Map((Array.isArray(after.revoked) ? after.revoked : []).map((r) => [r.sha256, r]));
  const revokedWas = new Set((before && Array.isArray(before.revoked) ? before.revoked : []).map((r) => r.sha256));
  const added = [], changed = [], down = [];
  for (const [id, e] of now) {
    const o = was.get(id);
    if (!o) added.push(label(e));
    else if (o.sha256 !== e.sha256) changed.push(`${label(e)}: new code, was ${String(o.sha256).slice(0, 12)}`);
    else if (JSON.stringify(o) !== JSON.stringify(e)) changed.push(`${label(e)}: the listing only (same code)`);
  }
  const named = new Set();
  for (const [id, o] of was) {
    if (now.has(id)) continue;
    const r = revokedNow.get(o.sha256);
    named.add(o.sha256);
    down.push(r ? `${label(o)}: revoked, "${r.reason}"` : `${label(o)}: unlisted`);
  }
  for (const [h, r] of revokedNow) if (!revokedWas.has(h) && !named.has(h)) down.push(`fingerprint ${h.slice(0, 12)}: revoked, "${r.reason}"`);
  return { added, changed, down };
}

export function summaryText(s, { from = null, to }) {
  const list = (xs) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- none');
  return [`Shelf: ${from ? `overdub-devices@${from.slice(0, 7)}` : 'no previous pin'} → overdub-devices@${to.slice(0, 7)}`, '', '**Added**', list(s.added), '', '**Changed**', list(s.changed), '', '**Taken down**', list(s.down)].join('\n');
}

// the previously pinned index, read from the checkout (null when there was no pin, or its commit isn't here)
function previousIndex(from, pinFile) {
  if (!fs.existsSync(pinFile)) return { commit: null, index: null };
  let p;
  try { p = readPin(pinFile); } catch { return { commit: null, index: null }; }
  const r = git(from, ['show', `${p.commit}:index/community-index.json`]);
  if (r.status !== 0) return { commit: p.commit, index: null };
  try { return { commit: p.commit, index: JSON.parse(r.out) }; } catch { return { commit: p.commit, index: null }; }
}

function parseArgs(argv) {
  const o = { from: process.env.OVERDUB_DEVICES_DIR || path.join(ROOT, '..', 'overdub-devices'), out: path.join(ROOT, 'app/community'), pinFile: path.join(ROOT, 'deploy/community-pin.json'), pin: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => {
      if (i + 1 >= argv.length) throw new PullError('usage', `${a} needs a value`);
      return argv[++i];
    };
    if (a === '--from') o.from = path.resolve(v());
    else if (a === '--out') o.out = path.resolve(v());
    else if (a === '--pin-file') o.pinFile = path.resolve(v());
    else if (a === '--pin') o.pin = v();
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new PullError('usage', `unknown argument ${a}`);
  }
  return o;
}

export function main(argv, log = console.log, warn = console.error) {
  const o = parseArgs(argv);
  if (o.help) {
    log('usage: node tools/community-pull.js [--pin <commit>] [--from <overdub-devices>] [--out <dir>] [--pin-file <file>]');
    return 0;
  }
  if (o.pin) {
    const prev = previousIndex(o.from, o.pinFile);
    const v = verify(o.from, o.pin);
    for (const w of v.warnings) warn(`community-pull: warning: ${w}`);
    writeOut(o.out, v.files);
    fs.mkdirSync(path.dirname(o.pinFile), { recursive: true });
    fs.writeFileSync(o.pinFile, JSON.stringify({ repo: REPO, commit: v.commit, index_sha256: v.indexSha }, null, 2) + '\n');
    log(`community-pull: pinned overdub-devices@${v.short} (index ${v.indexSha.slice(0, 12)}): ${v.devices} devices, ${v.clips} MP3 clips; ${shown(o.pinFile)} written, ${shown(o.out)} filled`);
    if (prev.commit && !prev.index) warn(`community-pull: warning: the previous pin's commit ${prev.commit.slice(0, 7)} isn't in ${o.from}; the summary lists everything as added`);
    log('');
    log(summaryText(summarize(prev.index, v.index), { from: prev.commit, to: v.commit }));
    return 0;
  }
  const p = readPin(o.pinFile);
  const v = verify(o.from, p.commit, { indexSha: p.index_sha256 });
  for (const w of v.warnings) warn(`community-pull: warning: ${w}`);
  writeOut(o.out, v.files);
  log(`community-pull: overdub-devices@${v.short} (index ${v.indexSha.slice(0, 12)}, as pinned): ${v.devices} devices, ${v.clips} MP3 clips -> ${shown(o.out)}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof PullError)) throw e;
    console.error(`community-pull: ${e.code === 'refused' ? 'refused' : e.code === 'unavailable' ? 'unavailable' : 'usage'}: ${e.message}`);
    process.exitCode = e.code === 'refused' ? 1 : e.code === 'unavailable' ? 3 : 2;
  }
}
