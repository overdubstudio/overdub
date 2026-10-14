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
//   "modelFrom": "https://.../htdemucs.onnx"   optional: the model, checked against "sha256" (which the runner pins);
//                                          or "s3://<bucket>/<key>", copied with `aws s3 cp` under the deploy's own
//                                          credentials (the live site's model sits in a private bucket,
//                                          deploy/live-config.json), and checked the same way
// Each file is fetched once (kept in deploy/.cache/, gitignored), checked, and written to <stage>/app/vendor/ort/<file>
// (the model to <stage>/app/vendor/models/<sha256>.onnx); the shipped config then names the same-origin paths
// ("runtime": "vendor/ort/ort.webgpu.min.mjs", "model": "vendor/models/<sha256>.onnx") and drops the *From and
// runtimeSha256 keys. A hash that doesn't match stops the deploy and prints what it got. With DRY_RUN set (deploy.sh's
// dry run) nothing is fetched: what is cached is checked and staged as usual, and what isn't is staged as an empty
// stand-in, with a line saying a real deploy would fetch and check it.
//
// The manifest is `shasum -a 256` of the files, one "<hex>  <file>" line each in RUNTIME_FILES' order:
//   (cd onnxruntime-web/dist && shasum -a 256 ort.webgpu.min.mjs ort-wasm-simd-threaded.{,asyncify.,jsep.,jspi.}{mjs,wasm})
// and runtimeSha256 is the SHA-256 of that text; `node deploy/stage-stems.js --manifest <dir>` prints both.
//
//   node deploy/stage-stems.js <stage>/app/site-config.json <stage> [cacheDir] [--warn]   prints one line a staged
//                                                    thing. --warn (the preview, deploy.sh --next): what can't be
//                                                    staged is a warning, and the shipped config drops its stems entry
//                                                    (stems off there), where a live deploy stops
//   node deploy/stage-stems.js --manifest <dist dir>                              prints the manifest and its hash
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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
    const s3ok = u.protocol === 's3:' && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(u.hostname) && u.pathname.length > 1 && !u.search && !u.hash;
    if ((u.protocol !== 'https:' && !s3ok) || u.username || u.password) throw new Error(`stems.modelFrom must be an https: URL or s3://<bucket>/<key> (${modelFrom})`);
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

// `aws s3 cp <s3://...> <file>`: the deploy's credentials (a GitHub Actions role, or a profile) read the private bucket
export function awsS3Copy(url, file) {
  execFileSync('aws', ['s3', 'cp', url, file, '--only-show-errors'], { stdio: ['ignore', 'ignore', 'pipe'] });
}

async function fetchCached(url, file, fetchImpl, s3Impl = awsS3Copy) {
  if (fs.existsSync(file)) return fs.readFileSync(file);
  if (url.startsWith('s3://')) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const part = `${file}.part`;
    try { await s3Impl(url, part); } catch (e) {
      fs.rmSync(part, { force: true });
      throw new Error(`${url}: aws s3 cp failed (${String(e.stderr || e.message).trim().split('\n').pop()})`);
    }
    fs.renameSync(part, file);
    return fs.readFileSync(file);
  }
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf;
}

// stage what the config asks for into <stage>/app/vendor/, and rewrite the config. Returns the lines to print.
export async function stageStems({ configFile, stage, cacheDir, fetch: f = globalThis.fetch, s3 = awsS3Copy, dry = false }) {
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
  // a dry run's stand-in: an empty file where a deploy would put the fetched one
  const standIn = (rel) => { const dst = path.join(stage, 'app', rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, ''); };
  if (plan.runtime) {
    const dir = path.join(cacheDir, 'ort', sha(plan.runtime.from).slice(0, 16));
    if (dry && !RUNTIME_FILES.every((name) => fs.existsSync(path.join(dir, name)))) {
      for (const name of RUNTIME_FILES) standIn(`vendor/ort/${name}`);
      out.push(`stems: dry run: the runtime from ${plan.runtime.from} isn't cached, so nothing is fetched; a deploy fetches and checks it (empty stand-ins at app/vendor/ort/)`);
    } else {
      const files = {};
      for (const name of RUNTIME_FILES) files[name] = await fetchCached(new URL(name, plan.runtime.from).href, path.join(dir, name), f);
      const bad = checkRuntime(files, plan.runtime.pin);
      if (bad) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error(`stems: ${bad}`); }
      let bytes = 0;
      for (const name of RUNTIME_FILES) { copy(files[name], `vendor/ort/${name}`, path.join(dir, name)); bytes += files[name].length; }
      out.push(`stems: runtime from ${plan.runtime.from}, ${RUNTIME_FILES.length} files (${Math.round(bytes / 1e6)} MB), checked, staged at app/vendor/ort/`);
    }
    c.stems.runtime = RUNTIME_PATH;
    delete c.stems.runtimeFrom; delete c.stems.runtimeSha256;
  }
  if (plan.model) {
    const file = path.join(cacheDir, 'models', `${plan.model.sha256}.onnx`);
    const rel = `vendor/models/${plan.model.sha256}.onnx`;
    if (dry && !fs.existsSync(file)) {
      standIn(rel);
      out.push(`stems: dry run: the model from ${plan.model.from} isn't cached, so nothing is fetched; a deploy ${plan.model.from.startsWith('s3:') ? 'copies it (aws s3 cp)' : 'fetches it'} and checks it against ${plan.model.sha256.slice(0, 12)}… (an empty stand-in at app/${rel})`);
    } else {
      const buf = await fetchCached(plan.model.from, file, f, s3);
      const got = sha(buf);
      if (got !== plan.model.sha256) { fs.rmSync(file, { force: true }); throw new Error(`stems: the model from ${plan.model.from} is ${got}, not the pinned ${plan.model.sha256}`); }
      copy(buf, rel, file);
      if (!c.stems.bytes) c.stems.bytes = buf.length;
      out.push(`stems: model from ${plan.model.from} (${Math.round(buf.length / 1e6)} MB), checked, staged at app/${rel}`);
    }
    c.stems.model = rel;
    delete c.stems.modelFrom;
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
      const warn = args.includes('--warn');
      const [configFile, stage, cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache')] = args.filter((a) => a !== '--warn');
      try {
        for (const l of await stageStems({ configFile, stage, cacheDir, dry: !!process.env.DRY_RUN })) console.log(l);
      } catch (e) {
        if (!warn) throw e;
        const c = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        delete c.stems;
        fs.writeFileSync(configFile, JSON.stringify(c, null, 2) + '\n');
        fs.rmSync(path.join(stage, 'app', 'vendor', 'ort'), { recursive: true, force: true });
        fs.rmSync(path.join(stage, 'app', 'vendor', 'models'), { recursive: true, force: true });
        console.log(`warning: ${e.message} (a live deploy would stop); stems: off on this site (the shipped config has no stems entry)`);
      }
    }
  } catch (e) {
    console.log(`not deploying: ${e.message}`);
    process.exit(1);
  }
}
