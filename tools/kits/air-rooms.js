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
// The build, step by step (spec "The build, step by step"): fetch the members and check every pin (1); read each ear's
// h_air and air_info.fs (2); the onset (3); measure the full IR per octave, 125 Hz to 8 kHz (4: Schroeder integration
// with the noise floor subtracted, T20, T30, EDT, C80; the mixing time; the noise floor; the ears' correlation); take
// the direct sound out and set the early cut (5); fit the tail with the kernel's own roomTail (6); window the early IR
// and score the hybrid, rendered through core.rooms' kernel (7, tools/kits/qa.js qaRoom); normalise, 16 bits, each
// room's level, the .odk (8). node tools/fetch-kits.js --only air-rooms runs it and writes
// tools/.out/library/rooms/qa.json; rooms-lib.js pins the bank's hash (ROOMS_HASH) and what its header says
// (ROOM_INFO, roomInfo below).
//
//   node tools/kits/air-rooms.js           fetch the twelve files (by range, into the download cache: KITS_CACHE, or
//                                          tools/.out/kits-cache) and print each room's measurements against the spec's
//   node tools/kits/air-rooms.js --offline the same from the cache alone
//   node tools/kits/air-rooms.js --build   build the bank in memory and print each room's fit and QA (writes nothing)
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openZipRanged } from './zip.js';
import { readMat } from '../mat.js';
import { dcos } from '../../app/src/devices/builtin/series.js';
import { roomTail, roomSvfSet, ROOMS } from '../../app/src/devices/builtin/rooms-lib.js';
import { encodeOdk, decodeOdk } from '../../app/src/kernel/odk.js';
import { diStrum } from '../../app/src/audio/testsignals.js';
import { qaRoom, ROOM_BAR } from './qa.js';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

export const RECIPE = {
  name: 'Echo Chamber rooms (aachen)',
  key: 'air-rooms',   // node tools/fetch-kits.js --only air-rooms
  kind: 'rooms',
  qaName: 'rooms',    // tools/.out/library/rooms/qa.json
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
export function measureRoom({ sr, L, R }, { on = onsetOf(L), curves = false } = {}) {
  const one = (chs) => {
    const { e, noise } = energy(chs, on), d = decayCurve(e, noise, sr);
    return { t20: decayTime(d.db, sr, -5, -25), t30: decayTime(d.db, sr, -5, -35), edt: decayTime(d.db, sr, 0, -10), c80: clarity(e, noise, d.cut, sr), floor: d.floorDb, cut: d.cut / sr, ...(curves ? { db: d.db, e, noise } : {}) };
  };
  const bands = OCTAVES.map((f) => ({ f, ...one([octave(L, f, sr), octave(R, f, sr)]) }));
  return { onset: on, length: L.length / sr, broadband: one([L, R]), bands, mix: mixingTime(L, on, sr), corr: correlation(L, R, on, sr) };
}

/* ------------------------------------------------------------------ the build (steps 5 to 8) */
// Step 5: the room from its direct sound's arrival (the onset - 0.5 ms), the direct sound itself (to 2.5 ms after
// the onset) faded out over 1 ms (R6: the dry path is the direct sound); the early cut tx (R7).
// Step 6: the tail (rooms-lib.js roomTail, the kernel's own code) fitted to the room: its three T60s from the octave
// T30s, 250 Hz to 8 kHz (the low band capped at 1.5x the 500 Hz T30, R14), the line scale from the mixing time, D so the
// tail has built up by tx, then g and the EQ by least squares on the octave energies over [tx, tx + 300 ms].
// Step 7: the early IR windowed so that early + tail has the measured envelope (R12); the hybrid rendered by the kernel
// and scored (R13, tools/kits/qa.js qaRoom). Step 8: peak-normalised to 16 bits, each room's level set so its wet
// signal has the DI strum's RMS (R20), the .odk.
//
// The numbers that reach the bytes (the window, the ramps) are built from the series (dcos), so the bank is the same
// on any engine; the measuring (octave filters, logs) uses Math, and every value it gives the header is rounded.

const FIT_OCT = [250, 500, 1000, 2000, 4000, 8000];
const TAIL_BASE = [1031, 1327, 1523, 1801, 2111, 2437, 2741, 3089];
const LATENCY = 128; // the convolver's (the head's block): the early part plays this late, and D includes it
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const sig = (x, n) => Number(x.toPrecision(n));

// Step 5
export function prepRoom(raw, room) {
  const { sr } = raw, full = measureRoom(raw);
  const on = full.onset, start = Math.max(0, on - Math.round(0.0005 * sr));
  const n = raw.L.length - start, z0 = on - start + Math.round(0.0025 * sr), RAMP = Math.round(0.001 * sr);
  const L = new Float64Array(n), R = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = i < z0 ? 0 : i >= z0 + RAMP ? 1 : 0.5 - 0.5 * dcos((Math.PI * (i - z0)) / RAMP);
    L[i] = raw.L[start + i] * w; R[i] = raw.R[start + i] * w;
  }
  const ref = measureRoom({ sr, L, R }, { on: 0, curves: true });
  return { sr, full, start, L, R, ref, tx: Math.round(room.tx * sr) };
}

// The tail's T60 at f for a fit (scale, t60 [lo, mid, hi]): the loop gains roomTail.set works out, per line, and the
// decay that gives, averaged over the lines (dB per second). The same sums as rooms-lib.js, for choosing the fit.
export function tailT60At(t60, scale, f, sr = 48000) {
  const tan = (x) => Math.tan((Math.PI * x) / sr), T500 = tan(500), T4K = tan(4000), O = [tan(63), tan(1414), tan(16000)], w = tan(f);
  const shelfLo = (A, W, x) => Math.sqrt((A * A * W * W + x * x) / (W * W + x * x));
  const shelfHi = (A, W, x) => Math.sqrt((W * W + A * A * x * x) / (W * W + x * x));
  let rate = 0;
  for (const b of TAIL_BASE) {
    const len = Math.round(b * scale * (sr / 48000)), loop = (t) => Math.pow(10, (-3 * len) / (t * sr));
    const t0 = loop(t60[0]), t1 = loop(t60[1]), t2 = loop(t60[2]);
    let gl = t0, gm = t1, gh = t2, al = 1, ah = 1, W1 = 1, W2 = 1;
    for (let it = 0; it < 4; it++) {
      al = gl / gm; ah = gh / gm; W1 = T500 / Math.sqrt(al); W2 = T4K * Math.sqrt(ah);
      const m = (x) => gm * shelfLo(al, W1, x) * shelfHi(ah, W2, x);
      gl *= t0 / m(O[0]); gm *= t1 / m(O[1]); gh *= t2 / m(O[2]);
    }
    al = gl / gm; ah = gh / gm; W1 = T500 / Math.sqrt(al); W2 = T4K * Math.sqrt(ah);
    rate += (20 * Math.log10(gm * shelfLo(al, W1, w) * shelfHi(ah, W2, w)) * sr) / len;
  }
  return -60 / (rate / TAIL_BASE.length);
}

// least squares by Gauss-Newton with a numerical Jacobian: x minimising sum(res(x)^2)
function gaussNewton(res, x0, { iters = 30, h = 1e-4, lo = -Infinity, hi = Infinity } = {}) {
  let x = x0.slice();
  for (let it = 0; it < iters; it++) {
    const r = res(x), n = x.length, m = r.length, J = [];
    for (let j = 0; j < n; j++) { const xp = x.slice(); xp[j] += h; const rp = res(xp); J.push(rp.map((v, i) => (v - r[i]) / h)); }
    // (J^T J + a little) dx = -J^T r
    const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => { let s = 0; for (let i = 0; i < m; i++) s += J[a][i] * J[b][i]; return s + (a === b ? 1e-9 : 0); }));
    const g = Array.from({ length: n }, (_, a) => { let s = 0; for (let i = 0; i < m; i++) s -= J[a][i] * r[i]; return s; });
    for (let c = 0; c < n; c++) { // Gaussian elimination, partial pivoting
      let p = c; for (let q = c + 1; q < n; q++) if (Math.abs(A[q][c]) > Math.abs(A[p][c])) p = q;
      [A[c], A[p]] = [A[p], A[c]]; [g[c], g[p]] = [g[p], g[c]];
      for (let q = c + 1; q < n; q++) { const f = A[q][c] / A[c][c]; for (let k = c; k < n; k++) A[q][k] -= f * A[c][k]; g[q] -= f * g[c]; }
    }
    const dx = new Array(n);
    for (let c = n - 1; c >= 0; c--) { let s = g[c]; for (let k = c + 1; k < n; k++) s -= A[c][k] * dx[k]; dx[c] = s / A[c][c]; }
    let step = 0;
    x = x.map((v, j) => { const nv = Math.min(hi, Math.max(lo, v + dx[j])); step = Math.max(step, Math.abs(nv - v)); return nv; });
    if (step < 1e-7) break;
  }
  return x;
}

// the tail alone, an impulse in, as the hybrid hears it (128 frames of the convolver's latency taken off the front):
// { L, R } of n frames
export function tailIr(fit, n, sr = 48000) {
  const tail = roomTail(sr).set(fit, 1, 0), N = n + LATENCY, x = new Float64Array(N), L = new Float64Array(N), R = new Float64Array(N);
  x[0] = 1;
  for (let a = 0; a < N; a += 128) { const m = Math.min(128, N - a); tail.process(x.subarray(a, a + m), L.subarray(a, a + m), R.subarray(a, a + m), m); }
  return { L: L.subarray(LATENCY), R: R.subarray(LATENCY) };
}
const energyOf = (L, R, a, b) => { let s = 0; for (let i = a; i < b && i < L.length; i++) s += L[i] * L[i] + R[i] * R[i]; return s; };
// the magnitude (dB) at f of the tail's output EQ for gains eq [lo, mid, hi] (roomSvfSet's coefficients, analysed)
const EQC = new Float64Array(21);
export function eqDb(eq, f, sr = 48000) {
  roomSvfSet(sr, 1, 250, 0.707, eq[0], EQC, 0); roomSvfSet(sr, 2, 1500, 0.7, eq[1], EQC, 7); roomSvfSet(sr, 3, 6000, 0.707, eq[2], EQC, 14);
  let db = 0;
  for (let o = 0; o < 21; o += 7) {
    const k = EQC[o], g = EQC[o + 2] / EQC[o + 1], m0 = EQC[o + 4], m1 = EQC[o + 5], m2 = EQC[o + 6];
    const s = Math.tan((Math.PI * f) / sr) / g; // s' = j s
    // H = (m0 (1 - s^2 + j k s) + j m1 s + m2) / (1 - s^2 + j k s)
    const dr = 1 - s * s, di = k * s, nr = m0 * dr + m2, ni = m0 * di + m1 * s;
    db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return db;
}

// Step 6: the fit, from the prepared room. Returns { fit, raw (the T60s uncapped), plateau (ms) }.
export function fitTail(p, mixMs, { adjust = [1, 1, 1, 1, 1, 1] } = {}) {
  const { sr, ref, tx } = p, at = (f) => ref.bands.find((b) => b.f === f);
  const T = (f) => at(f).t30 ?? at(f).t20;
  const target = FIT_OCT.map((f, i) => T(f) * adjust[i]);
  const scale = Math.min(1.6, Math.max(0.4, round((mixMs || 40) / 40, 2)));
  const lt = gaussNewton((x) => FIT_OCT.map((f, i) => Math.log(tailT60At([Math.exp(x[0]), Math.exp(x[1]), Math.exp(x[2])], scale, f, sr) / target[i])),
    [Math.log(target[0]), Math.log(target[2]), Math.log(target[5])], { lo: Math.log(0.05), hi: Math.log(30) });
  const raw = lt.map((v) => round(Math.exp(v), 3));
  const cap = 1.5 * T(500);
  const t60 = [Math.min(raw[0], round(cap, 3)), raw[1], raw[2]];
  // D: where the tail has built up: with D = 1, the 1 kHz octave's 10 ms energy, its decay taken out (the tail's own
  // T60 there), first within 1 dB of its plateau (the mean from 200 to 500 ms). D then moves that point to tx.
  const probe = { model: 'tail/1', D: 1, scale, t60, eq: [0, 0, 0], g: 1, mod: 0 };
  const ir = tailIr(probe, Math.round(0.6 * sr), sr), F = Math.round(0.01 * sr), H = Math.round(0.001 * sr);
  const oL = octave(ir.L, 1000, sr), oR = octave(ir.R, 1000, sr), t1k = tailT60At(t60, scale, 1000, sr);
  const lvl = (a) => energyOf(oL, oR, a, a + F) * Math.pow(10, (6 * (a + F / 2)) / (sr * t1k));
  let plat = 0, np = 0; for (let a = Math.round(0.2 * sr); a + F <= Math.round(0.5 * sr); a += H) { plat += lvl(a); np++; }
  plat /= np;
  // (in the hybrid's time: the probe's frame a is the tail's a + 127 frames after its input)
  let built = 0; for (let a = 0; a + F <= ir.L.length; a += H) if (lvl(a) >= plat * Math.pow(10, -0.1)) { built = a + F / 2; break; }
  const D = Math.max(1, Math.min(Math.round(0.24 * sr), 1 + tx - built));
  // g and the EQ: each octave's late energy, from tx on, in the measured room (noise taken out, to where its decay
  // curve was cut: its decay curve's value at tx) and in the tail, matched in dB by a gain and the three EQ gains; then
  // twice more against the tail rendered with that EQ (a band's edges hear more than its centre)
  const W0 = tx, at2 = (f) => ref.bands.find((b) => b.f === f);
  const refBand = FIT_OCT.map((f) => { const b = at2(f), end = Math.round(b.cut * sr); let s = 0; for (let i = W0; i < end; i++) s += Math.max(0, b.e[i] - b.noise); return s; });
  const N = p.L.length + sr;
  let fit = { model: 'tail/1', D, scale, t60, eq: [0, 0, 0], g: 1, mod: 0 };
  let offset = FIT_OCT.map(() => 0);
  for (let pass = 0; pass < 3; pass++) {
    const t = tailIr(fit, N, sr), have = FIT_OCT.map((f) => energyOf(octave(t.L, f, sr), octave(t.R, f, sr), W0, N));
    // what the bands still want, in dB, on top of what this fit gives
    const need = FIT_OCT.map((f, i) => 10 * Math.log10(refBand[i] / have[i]));
    if (pass > 0) offset = offset.map((o, i) => o + need[i]);
    const base = pass === 0 ? FIT_OCT.map(() => 0) : FIT_OCT.map((f) => 20 * Math.log10(fit.g) + eqDb(fit.eq, f, sr));
    const x = gaussNewton((v) => FIT_OCT.map((f, i) => v[0] + eqDb([v[1], v[2], v[3]], f, sr) - (base[i] + need[i])),
      [pass === 0 ? need.reduce((a, v) => a + v, 0) / need.length : 20 * Math.log10(fit.g), ...fit.eq], { iters: 20 });
    const eq = [1, 2, 3].map((j) => round(Math.min(24, Math.max(-24, x[j])), 2));
    fit = { ...fit, eq, g: sig(Math.pow(10, x[0] / 20), 5) };
  }
  return { fit, raw, built: round((1000 * (built + LATENCY - 1)) / sr, 1) };
}

// The hybrid as the kernel plays an impulse (the early IR and the tail, both as the convolver's latency leaves them),
// in doubles: what the fit iterates on (the bank's own render through the kernel is what's scored)
export function simHybrid(p, fit, early) {
  const n = p.L.length + p.sr, t = tailIr(fit, n, p.sr), L = Float64Array.from(t.L), R = Float64Array.from(t.R);
  for (let i = 0; i < early.eL.length; i++) { L[i] += early.eL[i]; R[i] += early.eR[i]; }
  return { sr: p.sr, L, R };
}
// how far a QA result is from the bar: each check's worst over its bar, summed
const BARS = [ROOM_BAR.time, ROOM_BAR.time, ROOM_BAR.time, ROOM_BAR.c80, ROOM_BAR.env, ROOM_BAR.edc, ROOM_BAR.edgeTime, ROOM_BAR.edgeEdc];
const distance = (q) => q.checks.reduce((s, c, i) => s + Math.min(10, c[2] / BARS[i]), 0);
// Steps 6 and 7 together: fit, window, measure the hybrid, and fit again with each octave's T60 target moved by how
// far the hybrid's decay (its curve from -5 to -30 dB, as a T60) missed the room's; the closest of six tries.
export function fitRoom(p, tries = 6) {
  let adjust = FIT_OCT.map(() => 1), best = null;
  for (let it = 0; it < tries; it++) {
    const f = fitTail(p, p.full.mix, { adjust }), early = windowEarly(p, f.fit);
    const hyb = measureRoom(simHybrid(p, f.fit, early), { on: 0, curves: true });
    const q = qaRoom(p.ref, hyb, { sr: p.sr, tx: p.tx }), d = distance(q);
    if (!best || d < best.d) best = { ...f, early, d, iters: it + 1 };
    adjust = adjust.map((a, i) => {
      const r = p.ref.bands.find((b) => b.f === FIT_OCT[i]), h = hyb.bands.find((b) => b.f === FIT_OCT[i]);
      const tr = decayTime(r.db, p.sr, -5, -30), th = decayTime(h.db, p.sr, -5, -30);
      return tr && th ? a * Math.min(1.5, Math.max(0.67, tr / th)) : a;
    });
  }
  return best;
}

// Step 7: the window (R12). Et and Em in 10 ms frames over [0, tx] (both ears), w = sqrt(max(0, 1 - Et / Em)) at each
// frame's centre, linear between them, then to 0 at tx over a 5 ms cosine. The early IR: the room times w, to tx.
export function windowEarly(p, fit) {
  const { sr, tx, L, R } = p, F = Math.round(0.01 * sr), t = tailIr(fit, tx, sr);
  const K = Math.ceil(tx / F), w = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const a = k * F, b = Math.min(tx, a + F), em = energyOf(L, R, a, b), et = energyOf(t.L, t.R, a, b);
    w[k] = em > 0 ? Math.sqrt(Math.max(0, 1 - et / em)) : 0;
  }
  const C = Math.round(0.005 * sr), eL = new Float64Array(tx), eR = new Float64Array(tx), win = new Float64Array(tx);
  for (let i = 0; i < tx; i++) {
    const x = (i - F / 2) / F, k = Math.floor(x), f = x - k;
    let v = k < 0 ? w[0] : k + 1 >= K ? w[K - 1] : w[k] + (w[k + 1] - w[k]) * f;
    if (i >= tx - C) v *= 0.5 + 0.5 * dcos((Math.PI * (i - (tx - C) + 1)) / C);
    win[i] = v; eL[i] = L[i] * v; eR[i] = R[i] * v;
  }
  return { eL, eR, win, frames: Array.from(w, (v) => round(v, 4)) };
}

// 16 bits, peak-normalised: { ch, gain (dB: the taps are x / 32768 * 10^(gain / 20)) }
export function to16(eL, eR) {
  let pk = 0; for (let i = 0; i < eL.length; i++) pk = Math.max(pk, Math.abs(eL[i]), Math.abs(eR[i]));
  const s = 32767 / pk, a = new Int16Array(eL.length), b = new Int16Array(eR.length);
  for (let i = 0; i < eL.length; i++) { a[i] = Math.round(eL[i] * s); b[i] = Math.round(eR[i] * s); }
  return { ch: [a, b], gain: round(20 * Math.log10((pk * 32768) / 32767), 4) };
}

const rms = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); };
const OCT_LABELS = OCTAVES;
// the header's record of the room as measured (the full IR, direct sound and all)
function measuredOf(full) {
  const t = (x) => (x == null ? null : round(x, 3));
  return { octaves: OCT_LABELS, t20: full.bands.map((b) => t(b.t20)), t30: full.bands.map((b) => t(b.t30)), edt: full.bands.map((b) => t(b.edt)),
    c80: full.bands.map((b) => round(b.c80, 2)), mix: full.mix, floor: round(full.broadband.floor, 1), corr: round(full.corr, 2) };
}

// The bank. getRoom(room) -> { sr, L, R } (Float64Array). render(def, params, inL, inR, { data }) -> [L, R]: the
// kernel's own render (tools/amp-scenes.js run); notice: license.txt's text (the bank's meta carries it whole). Returns { bytes, rows, qa, count, inFrames, outFrames }.
export async function buildRooms(recipe, getRoom, { render, def, notice }) {
  const sr = recipe.sr, entries = [], preps = [];
  for (const room of recipe.rooms) {
    if (ROOMS[room.index][2] !== room.id || ROOMS[room.index][0] !== room.label) throw new Error(`${room.id}: the recipe's room ${room.index} isn't the kernel's ${ROOMS[room.index].join(' ')}`);
    const raw = getRoom(room);
    if (raw.sr !== sr) throw new Error(`${room.id}: ${raw.sr} Hz, the bank is ${sr} Hz`);
    const p = prepRoom(raw, room);
    const { fit, raw: t60raw, built, early, iters } = fitRoom(p);
    const s16 = to16(early.eL, early.eR);
    preps.push({ p, early, built, t60raw, fit, iters });
    entries.push({ id: room.id, label: room.label, name: room.name, place: room.place, what: room.what, distance: room.distance,
      src: [room.left[0], room.right[0]], onset: p.full.onset, start: p.start, measured: measuredOf(p.full), tx: round(room.tx, 3),
      fit: { ...fit, t60raw }, gain: s16.gain, level: 0, ch: s16.ch });
  }
  const meta = (notice) => ({ kind: 'rooms', source: recipe.source, url: recipe.page, zip: recipe.zip.url, licence: recipe.licence, notice, credit: recipe.credit,
    author: recipe.author, verified: recipe.verified,
    model: 'each room: its measured IR from the direct sound\'s arrival (onset - 0.5 ms) to tx, the direct sound faded out (to 2.5 ms after the onset, a 1 ms ramp), windowed so that it and the fitted tail (rooms-lib.js roomTail, fit.model tail/1) add up to the measured envelope; taps = x / 32768 * 10^(gain / 20); the wet signal times 10^(level / 20)' });
  const encode = (notice) => encodeOdk({ name: recipe.name, sr, bits: 16, channels: 2, meta: meta(notice), samples: entries });
  // R20: each room's level, so that its wet signal (MIX 1, the rest at defaults) has the DI strum's RMS
  const strum = diStrum(8, sr), pad = new Float32Array(strum.length + 4 * sr); pad.set(strum);
  let bank = decodeOdk(encode(notice));
  for (const [i, e] of entries.entries()) {
    const [l, r] = render(def, { room: i, mix: 1 }, pad, pad, { data: { aachen: bank } });
    const wet = Math.sqrt((rms(l) ** 2 + rms(r) ** 2) / 2);
    e.level = round(20 * Math.log10(rms(pad) / wet), 2);
  }
  const bytes = encode(notice);
  bank = decodeOdk(bytes);
  // Step 7's score: the hybrid through the kernel, against the measured room (direct removed), R13
  const rows = [];
  for (const [i, e] of entries.entries()) {
    const { p, early, built, t60raw } = preps[i];
    const n = p.L.length + sr, imp = new Float32Array(n + LATENCY); imp[0] = 1;
    const [l, r] = render(def, { room: i, mix: 1, lowcut: 20, predelay: 0, decay: 1, damp: 0, width: 1 }, imp, imp, { data: { aachen: bank } });
    const lv = Math.pow(10, -e.level / 20), hL = new Float64Array(n), hR = new Float64Array(n);
    for (let k = 0; k < n; k++) { hL[k] = l[k + LATENCY] * lv; hR[k] = r[k + LATENCY] * lv; }
    const hyb = measureRoom({ sr, L: hL, R: hR }, { on: 0, curves: true });
    const q = qaRoom(p.ref, hyb, { sr, tx: p.tx });
    const room = recipe.rooms[i];
    rows.push({ id: e.id, label: e.label, tries: preps[i].iters, tx: e.tx, txRule: txRule(p.full.mix), mix: p.full.mix, built, fit: e.fit, t60raw, gain: e.gain, level: e.level,
      frames: p.tx, window: early.frames, pass: q.pass, waiver: q.pass ? null : 'waiver pending AJ (spec R13: a room that misses ships only with a written waiver after the listening room\'s verdict)',
      checks: q.checks.map(([name, ok, worst, detail]) => ({ name, pass: ok, worst: worst === Infinity ? null : round(worst, 4), detail })),
      bands: q.bands.map((b) => ({ f: b.f, t20: b.t20.map((x) => (x == null ? null : round(x, 3))), t30: b.t30.map((x) => (x == null ? null : round(x, 3))),
        edt: b.edt.map((x) => (x == null ? null : round(x, 3))), c80: b.c80.map((x) => round(x, 2)), edc: round(b.err.edc, 2) })),
      envelope: q.env.map((x) => round(x, 2)), spec: room.spec, measured: e.measured });
  }
  return { bytes, rows, count: entries.length, inFrames: preps.reduce((s, x) => s + x.p.L.length, 0), outFrames: preps.reduce((s, x) => s + x.p.tx, 0) };
}
// R7's rule, for the record (the spec's listed values are what ship: Q2): twice the mixing time, up to the next 10 ms,
// clamped to 80-200 ms
export const txRule = (mixMs) => Math.min(200, Math.max(80, Math.ceil((2 * mixMs) / 10) * 10));

// What the card and the agents read from the bank's header (rooms-lib.js ROOM_INFO pins it: rooms-test holds them
// equal): per room its label, id, name, place, what, distance, T30 at 500 / 1k / 2k, the EDT (1 kHz), the early cut
export function roomInfo(bank) {
  const at = (s, key, f) => s.measured[key][s.measured.octaves.indexOf(f)];
  return bank.samples.map((s) => ({ label: s.label, id: s.id, name: s.name, place: s.place, what: s.what, distance: s.distance,
    t30: [at(s, 't30', 500), at(s, 't30', 1000), at(s, 't30', 2000)], edt: at(s, 'edt', 1000), tx: s.tx }));
}

// fetch-kits' builder: the twelve files by range (or from the download cache), the licence first, then the bank,
// rendered and scored through core.rooms' own kernel. -> { bytes, rows, ... } and qa ({ verdicts, rows }: the report)
export function roomBuilder({ cache, offline }) {
  return async (recipe) => {
    const { z, licence } = await openAir({ cache, offline: offline(), recipe });
    // (loaded here, not at the top: the device and the renderer are only needed to build)
    const [{ default: def }, { run }] = await Promise.all([import('../../app/src/devices/builtin/rooms.js'), import('../amp-scenes.js')]);
    const r = await buildRooms(recipe, (room) => readRoom(z, room), { render: run, def, notice: licence });
    const verdicts = r.rows.map((x) => [x.label, x.pass ? 'pass' : 'waiver', x.pass ? 'every check within the bar' : x.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; ')]);
    return { ...r, qa: { verdicts, rows: r.rows } };
  };
}

/* ------------------------------------------------------------------ the command line */
async function main() {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const cache = process.env.KITS_CACHE || path.join(HERE, '..', '.out', 'kits-cache');
  const offline = process.argv.includes('--offline');
  if (process.argv.includes('--build')) {
    const r = await roomBuilder({ cache, offline: () => offline })(RECIPE);
    for (const x of r.rows) {
      console.log(`\n${x.label}: tx ${x.tx * 1000} ms (the rule gives ${x.txRule}), built ${x.built} ms, D ${x.fit.D}, scale ${x.fit.scale}, t60 ${x.fit.t60.join(' / ')} (uncapped ${x.t60raw.join(' / ')}), eq ${x.fit.eq.join(' / ')} dB, g ${x.fit.g}, gain ${x.gain} dB, level ${x.level} dB: ${x.pass ? 'PASS' : 'MISS'}`);
      for (const c of x.checks) console.log(`  ${c.pass ? 'ok  ' : 'MISS'} ${c.name}: ${c.detail}`);
      console.log('  octave  T20 ref/hyb   T30 ref/hyb   EDT ref/hyb   C80 ref/hyb   EDC gap');
      for (const b of x.bands) console.log(`  ${String(b.f).padStart(5)}  ${b.t20.join('/').padEnd(12)}  ${b.t30.join('/').padEnd(12)}  ${b.edt.join('/').padEnd(12)}  ${b.c80.join('/').padEnd(12)}  ${b.edc}`);
      console.log(`  envelope at the seam (dB): ${x.envelope.join(' ')}`);
    }
    console.log(`\n${r.bytes.length} bytes, sha256-${sha256(r.bytes)}`);
    return;
  }
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error('air-rooms: ' + (process.env.DEBUG ? e.stack : e.message)); process.exitCode = 1; });
