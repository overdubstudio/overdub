// The stems runner's runtime (and, optionally, its model), staged at deploy time so the studio loads them from its own
// origin (spec 0014 R21, R29). The studio's CSP (app/index.html) runs scripts from 'self' only and fetches from 'self',
// so onnxruntime-web on a CDN can't load ("Failed to fetch dynamically imported module"), and a model on another origin
// can't be fetched. Nothing here is committed: deploy.sh runs this on the staged tree, so the files go to the bucket
// beside the studio and never into git (app/vendor/ort/ and app/vendor/models/ are gitignored too).
//
// The deploy's site-config.json may say, under "stems":
//   "runtimeFrom": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/"   a pinned https dist directory
//   "runtimeSha256": "<64 hex>"            the SHA-256 of the manifest (below), or { "<file>": "<64 hex>", ... } for
//                                          every file in RUNTIME_FILES
//   "modelFrom": "https://.../htdemucs.onnx"   optional: the model, checked against "sha256" (which the runner pins)
// Each file is fetched once (kept in deploy/.cache/, gitignored), checked, and written to <stage>/app/vendor/ort/<file>
// (the model to <stage>/app/vendor/models/<sha256>.onnx); the shipped config then names the same-origin paths
// ("runtime": "vendor/ort/ort.webgpu.min.mjs", "model": "vendor/models/<sha256>.onnx") and drops the *From and
// runtimeSha256 keys. A hash that doesn't match stops the deploy and prints what it got.
//
// The manifest is `shasum -a 256` of the files, one "<hex>  <file>" line each in RUNTIME_FILES' order:
//   (cd onnxruntime-web/dist && shasum -a 256 ort.webgpu.min.mjs ort-wasm-simd-threaded.{,asyncify.,jsep.,jspi.}{mjs,wasm})
// and runtimeSha256 is the SHA-256 of that text; `node deploy/stage-stems.js --manifest <dir>` prints both.
//
//   node deploy/stage-stems.js <stage>/app/site-config.json <stage> [cacheDir]   prints one line a staged thing
//   node deploy/stage-stems.js --manifest <dist dir>                              prints the manifest and its hash
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ort.webgpu.min.mjs imports the jsep build for WebGPU and the plain one for the WebAssembly fallback; the asyncify and
// jspi builds are the ones it picks where the browser has them. All four sit beside it (ort.env.wasm.wasmPaths).
export const RUNTIME_ENTRY = 'ort.webgpu.min.mjs';
export const RUNTIME_FILES = [RUNTIME_ENTRY, ...['', 'asyncify.', 'jsep.', 'jspi.'].flatMap((v) => [`ort-wasm-simd-threaded.${v}mjs`, `ort-wasm-simd-threaded.${v}wasm`])];
export const RUNTIME_PATH = `vendor/ort/${RUNTIME_ENTRY}`;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const HEX = /^[0-9a-f]{64}$/i;

export function manifestOf(hashes) {
  return RUNTIME_FILES.map((f) => `${hashes[f]}  ${f}\n`).join('');
}

// what the config asks for, checked; throws a sentence on a bad one. null: nothing to stage.
export function planStems(stems) {
  if (!stems || typeof stems !== 'object' || Array.isArray(stems)) return null;
  const { runtimeFrom, runtimeSha256, modelFrom } = stems;
  if (runtimeFrom == null && modelFrom == null) return null;
  const plan = { runtime: null, model: null };
  if (runtimeFrom != null) {
    let u;
    try { u = new URL(String(runtimeFrom)); } catch { throw new Error(`stems.runtimeFrom isn't a URL (${runtimeFrom})`); }
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error(`stems.runtimeFrom must be a plain https: URL of the onnxruntime-web dist directory (${runtimeFrom})`);
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    const pin = runtimeSha256;
    if (typeof pin === 'string' ? !HEX.test(pin) : !(pin && typeof pin === 'object' && RUNTIME_FILES.every((f) => typeof pin[f] === 'string' && HEX.test(pin[f])))) {
      throw new Error(`stems.runtimeFrom needs stems.runtimeSha256: the manifest's SHA-256, or one for each of ${RUNTIME_FILES.join(', ')}`);
    }
    plan.runtime = { from: u.href, pin: typeof pin === 'string' ? pin.toLowerCase() : Object.fromEntries(RUNTIME_FILES.map((f) => [f, pin[f].toLowerCase()])) };
  }
  if (modelFrom != null) {
    let u;
    try { u = new URL(String(modelFrom)); } catch { throw new Error(`stems.modelFrom isn't a URL (${modelFrom})`); }
    if (u.protocol !== 'https:' || u.username || u.password) throw new Error(`stems.modelFrom must be an https: URL (${modelFrom})`);
    if (typeof stems.sha256 !== 'string' || !HEX.test(stems.sha256)) throw new Error('stems.modelFrom needs stems.sha256, the model\'s pinned SHA-256');
    plan.model = { from: u.href, sha256: stems.sha256.toLowerCase() };
  }
  return plan;
}

// the runtime's files against its pin: null when they match, else a sentence (with the manifest to pin)
export function checkRuntime(files, pin) {
  const hashes = Object.fromEntries(RUNTIME_FILES.map((f) => [f, sha(files[f])]));
  const manifest = manifestOf(hashes), got = sha(manifest);
  if (typeof pin === 'string') return got === pin ? null : `the runtime's manifest SHA-256 is ${got}, not the pinned ${pin}:\n${manifest}`;
  const bad = RUNTIME_FILES.filter((f) => hashes[f] !== pin[f]);
  return bad.length ? `${bad.map((f) => `${f} is ${hashes[f]}, not ${pin[f]}`).join('; ')}` : null;
}

async function fetchCached(url, file, fetchImpl) {
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf;
}

// stage what the config asks for into <stage>/app/vendor/, and rewrite the config. Returns the lines to print.
export async function stageStems({ configFile, stage, cacheDir, fetch: f = globalThis.fetch }) {
  const c = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const plan = planStems(c && c.stems);
  if (!plan) return [c && c.stems ? 'stems: nothing to stage (the config names its own runtime and model)' : 'stems: off (no stems entry)'];
  const out = [];
  const copy = (buf, rel, srcFile) => {
    const dst = path.join(stage, 'app', rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, buf);
    const st = fs.statSync(srcFile);
    fs.utimesSync(dst, st.atime, st.mtime);   // the cached file's time, so aws s3 sync doesn't send it again
  };
  if (plan.runtime) {
    const dir = path.join(cacheDir, 'ort', sha(plan.runtime.from).slice(0, 16));
    const files = {};
    for (const name of RUNTIME_FILES) files[name] = await fetchCached(new URL(name, plan.runtime.from).href, path.join(dir, name), f);
    const bad = checkRuntime(files, plan.runtime.pin);
    if (bad) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error(`stems: ${bad}`); }
    let bytes = 0;
    for (const name of RUNTIME_FILES) { copy(files[name], `vendor/ort/${name}`, path.join(dir, name)); bytes += files[name].length; }
    c.stems.runtime = RUNTIME_PATH;
    delete c.stems.runtimeFrom; delete c.stems.runtimeSha256;
    out.push(`stems: runtime from ${plan.runtime.from}, ${RUNTIME_FILES.length} files (${Math.round(bytes / 1e6)} MB), checked, staged at app/vendor/ort/`);
  }
  if (plan.model) {
    const file = path.join(cacheDir, 'models', `${plan.model.sha256}.onnx`);
    const buf = await fetchCached(plan.model.from, file, f);
    const got = sha(buf);
    if (got !== plan.model.sha256) { fs.rmSync(file, { force: true }); throw new Error(`stems: the model from ${plan.model.from} is ${got}, not the pinned ${plan.model.sha256}`); }
    const rel = `vendor/models/${plan.model.sha256}.onnx`;
    copy(buf, rel, file);
    c.stems.model = rel;
    if (!c.stems.bytes) c.stems.bytes = buf.length;
    delete c.stems.modelFrom;
    out.push(`stems: model from ${plan.model.from} (${Math.round(buf.length / 1e6)} MB), checked, staged at app/${rel}`);
  }
  fs.writeFileSync(configFile, JSON.stringify(c, null, 2) + '\n');
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--manifest') {
      const files = Object.fromEntries(RUNTIME_FILES.map((n) => [n, fs.readFileSync(path.join(args[1], n))]));
      const manifest = manifestOf(Object.fromEntries(RUNTIME_FILES.map((n) => [n, sha(files[n])])));
      process.stdout.write(manifest + `runtimeSha256: ${sha(manifest)}\n`);
    } else {
      const [configFile, stage, cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache')] = args;
      for (const l of await stageStems({ configFile, stage, cacheDir })) console.log(l);
    }
  } catch (e) {
    console.log(`not deploying: ${e.message}`);
    process.exit(1);
  }
}
