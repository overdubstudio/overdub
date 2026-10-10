// Echo Chamber's first room bank, `aachen` (core.rooms, intent 0006 "Real Rooms"): six rooms from the Aachen Impulse
// Response Database (AIR 1.4, RWTH Aachen University, Institute of Communication Systems; MIT). The recipe reads the
// twelve .mat files it needs (each room's left and right ear) out of the database's 202 MB zip by HTTP range
// (tools/kits/zip.js, openZipRanged) and checks every one against its SHA-256 below, and the licence before anything.
//
// Where it comes from (verified 2026-10-10): the database's page,
// https://www.iks.rwth-aachen.de/en/research/tools-downloads/databases/aachen-impulse-response-database/, links the
// zip below (Last-Modified 2020-09-28, 202,650,373 bytes, Accept-Ranges: bytes). Its AIR_1_4/license.txt is the MIT
// License, pinned by hash; the build refuses unless it matches and begins "MIT License" (checkLicence). The Aula
// Carolina is only in the .mat files (the WAV sub-zip doesn't have it), so the recipe reads MAT v5 (tools/mat.js).
//
// What is here so far (build package 1 of 5): the pins, the licence gate, reading each room (step 2) and measuring it
// (steps 3 and 4: the onset; per octave from 125 Hz to 8 kHz, Schroeder integration with the noise floor subtracted,
// T20, T30, EDT, C80; the mixing time; the noise floor; the ears' correlation). The early cut, the fitted tail, the
// window, the QA against the kernel and the .odk come next (steps 5 to 8).
//
//   node tools/kits/air-rooms.js           fetch the twelve files (by range, into the download cache: KITS_CACHE, or
//                                          tools/.out/kits-cache) and print each room's measurements against the spec's
//   node tools/kits/air-rooms.js --offline the same from the cache alone
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openZipRanged } from './zip.js';
import { readMat } from '../mat.js';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

export const RECIPE = {
  name: 'Echo Chamber rooms (aachen)',
  kind: 'rooms',
  source: 'Aachen Impulse Response Database (AIR) 1.4, RWTH Aachen University, Institute of Communication Systems (IKS)',
  repo: 'iks.rwth-aachen.de',
  page: 'https://www.iks.rwth-aachen.de/en/research/tools-downloads/databases/aachen-impulse-response-database/',
  licence: 'MIT',
  credit: 'Rooms measured by RWTH Aachen University (AIR 1.4, MIT).',
  author: 'Marco Jeub et al., RWTH Aachen University (IKS)',
  sr: 48000,
  channels: 2,
  verified: '2026-10-10',
  zip: {
    url: 'https://www.iks.rwth-aachen.de/fileadmin/user_upload/downloads/forschung/tools-downloads/air_database_release_1_4.zip',
    sha256: 'd2fd52767505c402e8aed9299dcd046493c8254cfab2f769fcf480dc7c616a5f',
    size: 202650373,
    served: '2020-09-28',
  },
  licenceFile: { path: 'AIR_1_4/license.txt', sha256: '576e14bfd0215f50085d9980f8586f2cd3e69b0db43cbf1cb12aa49807406347' },
  // "This database is under the MIT license. For further details see license.txt"
  readme: { path: 'AIR_1_4/readme.txt', sha256: '4bbf73d029d4696654eed903ff75648b47c86241fd0c44f568974f71230f27f0' },
  // the six rooms, in the ROOM switch's order (an index is a room forever). AIR's names: air_binaural_<room>_<ear: 1
  // left, 0 right>_<dummy head: 1 with>_<position>[_<azimuth>]...; spec: the measured values the spec's table gives,
  // for the comparison this tool prints (T30 at 500 / 1k / 2k Hz, EDT, mixing time in ms, the ears' correlation).
  // tx, the early cut in seconds, is the spec's stated default per room (R7). R7's own rule, twice the mixing time
  // rounded up to 10 ms and clamped to 80-200 ms, gives less from these rooms' mixing times (Aula 120 ms, the rest
  // 80); the stated defaults are taken, as the spec's acceptance says, and the difference is AJ's to settle.
  rooms: [
    { index: 0, label: 'AULA', id: 'aachen.aula-3m', name: 'Aula Carolina', place: 'Aachen', what: 'a former church', distance: 3, tx: 0.15,
      left: ['AIR_1_4/air_binaural_aula_carolina_1_1_3_90_3.mat', 'df810543a76643e034641f03ed05c2c8140e78f75485d8bcb80d35199cb9f35f'],
      right: ['AIR_1_4/air_binaural_aula_carolina_0_1_3_90_3.mat', '4594a51a56554a08966b0081ef48feef8c47f246f3732cff29925b9e5f7f0e90'],
      spec: { t30: [4.19, 3.09, 2.62], edt: 0.59, mix: 58, corr: 0.18 } },
    { index: 1, label: 'AULA FAR', id: 'aachen.aula-10m', name: 'Aula Carolina', place: 'Aachen', what: 'a former church', distance: 10, tx: 0.15,
      left: ['AIR_1_4/air_binaural_aula_carolina_1_1_5_90_3.mat', 'ee9385b0a1329afb4bad3e4c305df8c990005b9589dcf39065c734350e441822'],
      right: ['AIR_1_4/air_binaural_aula_carolina_0_1_5_90_3.mat', '1f23c544d246a3fe746d686ba7336333f8aca401ea4af0460dde0ec6d01f3c78'],
      spec: { t30: [4.30, 3.18, 2.68], edt: 2.50, mix: 62, corr: 0.17 } },
    { index: 2, label: 'LECTURE', id: 'aachen.lecture-5m', name: 'Lecture room', place: 'Aachen', what: 'a lecture room', distance: 5.56, tx: 0.12,
      left: ['AIR_1_4/air_binaural_lecture_1_1_3.mat', 'a0ef8450e48669c0648ead2fb8db8f66db81d674a099e3c6f917b046172f7f72'],
      right: ['AIR_1_4/air_binaural_lecture_0_1_3.mat', 'd75169ce14b8b459d1d414d255959d73e39c37fcc9e22bb3cdcf8428858c62c6'],
      spec: { t30: [0.89, 0.88, 0.91], edt: 0.67, mix: 16, corr: 0.07 } },
    { index: 3, label: 'STAIRS', id: 'aachen.stairway-2m', name: 'Stairway', place: 'Aachen', what: 'a stairwell', distance: 2, tx: 0.1,
      left: ['AIR_1_4/air_binaural_stairway_1_1_2_90.mat', '38a6d70a507aba1b673a5e970f1a6ddf57c29ec54f71ac50bc4ec34eac3cd6f4'],
      right: ['AIR_1_4/air_binaural_stairway_0_1_2_90.mat', '4a43d6dc91a64199f996d0990f8170f1d7baf13a4807951391d8ae92683b481c'],
      spec: { t30: [1.20, 1.02, 0.94], edt: 0.38, mix: 32, corr: 0.03 } },
    { index: 4, label: 'OFFICE', id: 'aachen.office-2m', name: 'Office', place: 'Aachen', what: 'an office', distance: 2, tx: 0.08,
      left: ['AIR_1_4/air_binaural_office_1_1_2.mat', 'aee538f908e1221c517b440cc38ca59167accf15e8d998cf64a7b5849b898534'],
      right: ['AIR_1_4/air_binaural_office_0_1_2.mat', 'd0cddb679f2d65dfc6785258342c8de6c0dc901a5ee326009092537f4f93f379'],
      spec: { t30: [0.65, 0.47, 0.41], edt: 0.31, mix: 24, corr: 0.27 } },
    { index: 5, label: 'MEETING', id: 'aachen.meeting-2m', name: 'Meeting room', place: 'Aachen', what: 'a meeting room', distance: 1.9, tx: 0.08,
      left: ['AIR_1_4/air_binaural_meeting_1_1_3.mat', '7639cf1a6eca4952d34d7178deb042fdcb2865be54bb7f9b76023eda1ee36cad'],
      right: ['AIR_1_4/air_binaural_meeting_0_1_3.mat', '88741ce72a76656b91ca49835556c76df8ee367cebcb83078b1d5222d49315ed'],
      spec: { t30: [0.37, 0.33, 0.29], edt: 0.08, mix: 26, corr: 0.09 } },
  ],
};

// every member the recipe reads: name -> SHA-256
export const members = (recipe = RECIPE) => Object.fromEntries([[recipe.licenceFile.path, recipe.licenceFile.sha256], [recipe.readme.path, recipe.readme.sha256], ...recipe.rooms.flatMap((r) => [r.left, r.right])]);

// The licence gate (R17): the pinned license.txt, and it begins "MIT License"; the pinned readme.txt, and it still
// says the database is under it. Each throws otherwise; checkLicence returns the licence's text.
export function checkLicence(bytes, want = RECIPE.licenceFile.sha256) {
  const got = sha256(bytes);
  if (got !== want) throw new Error(`license.txt: SHA-256 ${got}, pinned ${want} (the licence changed upstream: read it before building)`);
  const text = Buffer.from(bytes).toString('utf8');
  if (!text.startsWith('MIT License')) throw new Error(`license.txt doesn't begin "MIT License" (it begins "${text.slice(0, 40).replace(/\s+/g, ' ')}")`);
  return text;
}
export function checkReadme(bytes, want = RECIPE.readme.sha256) {
  const got = sha256(bytes);
  if (got !== want) throw new Error(`readme.txt: SHA-256 ${got}, pinned ${want} (it changed upstream: read it before building)`);
  if (!/This database is under the MIT license/.test(Buffer.from(bytes).toString('utf8'))) throw new Error('readme.txt no longer says the database is under the MIT license');
}

export async function openAir({ cache, offline = false, recipe = RECIPE } = {}) {
  const z = await openZipRanged(recipe.zip, { cache, offline, members: members(recipe) });
  const licence = checkLicence(z.read(recipe.licenceFile.path), recipe.licenceFile.sha256);
  checkReadme(z.read(recipe.readme.path), recipe.readme.sha256);
  return { z, licence, how: z.how };
}

// Step 2: one room's two ears, from their .mat files: { sr, L, R } (Float64Array)
export function readRoom(z, room) {
  const ear = ([file, sha]) => {
    const m = readMat(z.read(file, sha));
    if (!m.h_air || !m.air_info) throw new Error(`${file}: no h_air or air_info`);
    const fs = m.air_info.fs && m.air_info.fs[0];
    if (fs !== 48000) throw new Error(`${file}: air_info.fs is ${fs}, not 48000`);
    return { sr: fs, h: m.h_air, info: m.air_info };
  };
  const l = ear(room.left), r = ear(room.right);
  const n = Math.min(l.h.length, r.h.length);
  return { sr: l.sr, L: l.h.subarray(0, n), R: r.h.subarray(0, n), info: l.info };
}

/* ------------------------------------------------------------------ measuring (steps 3 and 4) */
// These numbers choose and describe; the kernel never sees them computed, so Math.* is fine here (and every value
// that reaches a bank's header is rounded).
export const OCTAVES = [125, 250, 500, 1000, 2000, 4000, 8000];

// a biquad (RBJ), run forward over x into a new array
function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i], o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o; }
  return y;
}
function rbj(x, type, f, q, sr) {
  const w = (2 * Math.PI * f) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  if (type === 'lp') return biquad(x, (1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
  return biquad(x, (1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
}
// the octave band at fc: 4th-order Butterworth high pass at fc / sqrt 2 and low pass at fc sqrt 2 (8th order in all),
// run over the time-reversed IR and reversed back, so the filter's own ringing falls before the sound rather than
// into its decay (the usual cure for short decays in narrow bands)
export function octave(x, fc, sr) {
  let y = Float64Array.from(x).reverse();
  for (const q of [0.5412, 1.3066]) y = rbj(y, 'hp', fc / Math.SQRT2, q, sr);
  if (fc * Math.SQRT2 < sr * 0.45) for (const q of [0.5412, 1.3066]) y = rbj(y, 'lp', fc * Math.SQRT2, q, sr);
  return y.reverse();
}

// Step 3: the onset, the first sample within 20 dB of the left ear's peak (applied to both ears)
export function onsetOf(L) {
  let pk = 0;
  for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]));
  for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) >= pk / 10) return i;
  return 0;
}

const FRAME = 0.01;
// the energy (both ears, squared and summed) from the onset, and its noise floor: the mean power of the last tenth
function energy(chs, on) {
  const n = chs[0].length - on, e = new Float64Array(n);
  for (const c of chs) for (let i = 0; i < n; i++) e[i] += c[on + i] * c[on + i];
  let nz = 0; const a = Math.floor(n * 0.9);
  for (let i = a; i < n; i++) nz += e[i];
  return { e, noise: nz / (n - a) };
}
// Schroeder's backward integral with the noise floor subtracted, truncated where the 10 ms level first falls to the
// floor + 5 dB after its peak: the decay curve in dB (0 at the onset), per sample, and where it was cut
export function decayCurve(e, noise, sr) {
  const F = Math.round(FRAME * sr), frames = Math.floor(e.length / F), lv = new Float64Array(frames);
  for (let k = 0; k < frames; k++) { let s = 0; for (let i = k * F; i < (k + 1) * F; i++) s += e[i]; lv[k] = s / F; }
  let pk = 0; for (let k = 1; k < frames; k++) if (lv[k] > lv[pk]) pk = k;
  let cut = frames;
  for (let k = pk; k < frames; k++) if (lv[k] <= noise * Math.pow(10, 0.5)) { cut = k; break; }
  const end = cut * F, edc = new Float64Array(end);
  let acc = 0;
  for (let i = end - 1; i >= 0; i--) { acc += Math.max(0, e[i] - noise); edc[i] = acc; }
  const db = new Float64Array(end);
  for (let i = 0; i < end; i++) db[i] = 10 * Math.log10(Math.max(edc[i], 1e-300) / edc[0]);
  return { db, cut: end, floorDb: 10 * Math.log10(noise / lv[pk]) };
}
// the time a line fitted to the decay curve between a and b dB takes to fall 60 dB (null if the curve doesn't reach b)
export function decayTime(db, sr, a, b) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, reached = false;
  for (let i = 0; i < db.length; i++) {
    const y = db[i];
    if (y < b) { reached = true; break; }
    if (y <= a) { const x = i / sr; n++; sx += x; sy += y; sxx += x * x; sxy += x * y; }
  }
  if (!reached || n < 8) return null;
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return -60 / slope;
}
// C80: the energy in the first 80 ms against the rest (noise subtracted), dB
function clarity(e, noise, cut, sr) {
  const k = Math.round(0.08 * sr);
  let early = 0, late = 0;
  for (let i = 0; i < Math.min(k, cut); i++) early += e[i];
  for (let i = k; i < cut; i++) late += Math.max(0, e[i] - noise);
  return 10 * Math.log10(early / late);
}
// the mixing time (Abel and Huang's normalized echo density): a 20 ms Hann window slid in 1 ms steps from the onset;
// the share of its samples beyond one standard deviation, over erfc(1 / sqrt 2); the first time (the window's centre
// after the onset, ms) it reaches 0.9
export function mixingTime(x, on, sr) {
  const W = Math.round(0.02 * sr), w = new Float64Array(W);
  let ws = 0; for (let i = 0; i < W; i++) { w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / W); ws += w[i]; }
  for (let i = 0; i < W; i++) w[i] /= ws;
  const ERFC = 0.31731050786291415, step = Math.round(0.001 * sr);
  for (let a = on; a + W <= x.length && a - on < sr; a += step) {
    let s2 = 0; for (let i = 0; i < W; i++) s2 += w[i] * x[a + i] * x[a + i];
    const sd = Math.sqrt(s2);
    let c = 0; for (let i = 0; i < W; i++) if (Math.abs(x[a + i]) > sd) c += w[i];
    if (c / ERFC >= 0.9) return Math.round(((a - on + W / 2) / sr) * 1000);
  }
  return null;
}
// the ears' correlation over a span after the onset (seconds)
function correlation(L, R, on, sr, a = 0.08, b = 0.5) {
  let xy = 0, xx = 0, yy = 0;
  for (let i = on + Math.round(a * sr); i < Math.min(L.length, on + Math.round(b * sr)); i++) { xy += L[i] * R[i]; xx += L[i] * L[i]; yy += R[i] * R[i]; }
  return xy / Math.sqrt(xx * yy);
}

// Step 4: a room's full measurement. Per octave (both ears' energy) and broadband: T20, T30, EDT, C80, the noise
// floor (dB re the peak 10 ms) and where the decay curve was cut; the mixing time (left ear) and the correlation.
export function measureRoom({ sr, L, R }) {
  const on = onsetOf(L);
  const one = (chs) => {
    const { e, noise } = energy(chs, on), d = decayCurve(e, noise, sr);
    return { t20: decayTime(d.db, sr, -5, -25), t30: decayTime(d.db, sr, -5, -35), edt: decayTime(d.db, sr, 0, -10), c80: clarity(e, noise, d.cut, sr), floor: d.floorDb, cut: d.cut / sr };
  };
  const bands = OCTAVES.map((f) => ({ f, ...one([octave(L, f, sr), octave(R, f, sr)]) }));
  return { onset: on, length: L.length / sr, broadband: one([L, R]), bands, mix: mixingTime(L, on, sr), corr: correlation(L, R, on, sr) };
}

/* ------------------------------------------------------------------ the command line */
async function main() {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const cache = process.env.KITS_CACHE || path.join(HERE, '..', '.out', 'kits-cache');
  const offline = process.argv.includes('--offline');
  const { z, licence, how } = await openAir({ cache, offline });
  console.log(`${RECIPE.name}: ${RECIPE.zip.url.replace(/^.*\//, '')} (${how === 'range' ? 'read by range' : how === 'cache' ? 'from the cache' : 'the whole zip'}, ${cache})`);
  console.log(`  licence ok: ${licence.split('\n')[0].trim()} / ${licence.split('\n').find((l) => /Copyright/.test(l)).trim()}`);
  const f2 = (x) => (x == null ? '  -  ' : x.toFixed(2));
  for (const room of RECIPE.rooms) {
    const m = measureRoom(readRoom(z, room));
    const at = (f) => m.bands.find((b) => b.f === f);
    const t30 = [500, 1000, 2000].map((f) => at(f).t30);
    const dev = t30.map((t, i) => (t == null ? NaN : (100 * (t - room.spec.t30[i])) / room.spec.t30[i]));
    console.log(`\n${room.label} (${room.id}): ${m.length.toFixed(2)} s, onset at ${m.onset} frames (${((m.onset / 48000) * 1000).toFixed(1)} ms)`);
    console.log(`  T30 500/1k/2k ${t30.map(f2).join(' / ')} s (spec ${room.spec.t30.join(' / ')}; ${dev.map((d) => (d >= 0 ? '+' : '') + d.toFixed(1) + '%').join(' / ')})`);
    console.log(`  EDT broadband ${f2(m.broadband.edt)} s, 1 kHz ${f2(at(1000).edt)} s (spec ${room.spec.edt}); mixing time ${m.mix} ms (spec ${room.spec.mix}); correlation ${m.corr.toFixed(2)} (spec ${room.spec.corr})`);
    console.log('  octave   T20    T30    EDT    C80   floor  cut');
    for (const b of [...m.bands, { f: 'bb', ...m.broadband }]) console.log(`  ${String(b.f).padStart(5)}  ${f2(b.t20)}  ${f2(b.t30)}  ${f2(b.edt)}  ${b.c80.toFixed(1).padStart(5)}  ${b.floor.toFixed(0).padStart(4)}  ${b.cut.toFixed(2)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error('air-rooms: ' + e.message); process.exitCode = 1; });
