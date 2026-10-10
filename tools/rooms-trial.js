// Echo Chamber's listening-room trial (intent 0006, spec "The listening room trial", R37): the renders the shipped
// bank can't make. The trial kit itself (its clips, the blind page, the votes) lives outside the repo; this is what it
// imports from here, so that every version it plays is built by the bank's own steps (tools/kits/air-rooms.js) and
// played by core.rooms' own kernel (tools/amp-scenes.js run).
//
//   POSITIONS                 T4's positions: per room, every AIR position the trial compares, each ear pinned by
//                             SHA-256 (the shipped ones are the recipe's own pins)
//   openAirZip(cache)         the whole AIR zip from the download cache (openZip: refused unless it is the recipe's
//                             SHA-256), with the licence checked; read offline
//   readPosition(z, pos)      one position's two ears, each held to its pin: { sr, L, R }
//   buildEntry(raw, opts)     a bank entry built as tools/kits/air-rooms.js builds the shipped ones (steps 5 to 8:
//                             the direct sound out, the fit, the window, 16 bits) at early cut opts.tx (seconds), under
//                             the shipped room's id opts.id, so the kernel plays it as that ROOM: { entry, prep }
//   fullEntry(prep, id)       T2's hidden reference and the trial's anchor, "the room as measured": the whole IR from
//                             the direct sound's arrival (the direct sound out, as the bank's: R6), every second of it,
//                             as taps in doubles, with the tail silent (fit.g 0). The kernel's dsp.convolver plays it.
//   bankOf(entries, def)      a bank of those entries, each room's level set as the build sets it (R20: the wet
//                             signal, MIX 1, has the DI strum's RMS)
//   modulatedDef(def, lines)  core.rooms with the tail's read heads wandering on 0, 2 or 4 of its eight lines (T5: is
//                             Aula at DECAY 2 ringing?). Stairwell's motion: a slow sine per line (0.07 to 0.18 Hz), a
//                             cubic read, the depth from the room's line scale (3 to 12 samples at 48 kHz). With 0
//                             lines the source is the shipped kernel's, unchanged ({ copy: true } builds this file's
//                             copy at 0 lines instead: the trial's build holds it to the shipped kernel, bit for
//                             bit). Never shipped: the bank's tail model
//                             tail/1 has no modulation, and T5 decides whether a new model is wanted.
//   initialGap(prep)          the room's initial time gap, ms: from the direct sound to the first arrival within 20 dB
//                             of the early part's peak (T1 sets Stairwell's PRE to it)
import crypto from 'node:crypto';
import { openZip } from './kits/zip.js';
import { RECIPE, checkLicence, prepRoom, fitRoom, to16 } from './kits/air-rooms.js';
import { readMat } from './mat.js';
import { run } from './amp-scenes.js';
import { kernel } from '../app/src/devices/builtin/lib.js';
import { dsin, dcos, dexp } from '../app/src/devices/builtin/series.js';
import { roomTail, roomSvfSet, ROOMS } from '../app/src/devices/builtin/rooms-lib.js';
import { ROOMS_BODY } from '../app/src/devices/builtin/rooms.js';
import { diStrum } from '../app/src/audio/testsignals.js';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const pin = (name, sha) => [`AIR_1_4/air_binaural_${name}.mat`, sha];
const shipped = (i) => ({ left: RECIPE.rooms[i].left, right: RECIPE.rooms[i].right });

// T4. AIR's names: <room>_<ear: 1 left, 0 right>_<dummy head: 1 with, 0 without>_<position>[_<azimuth>_3]. slot: the
// ROOM index the position stands in for. The pins of the positions the bank doesn't ship were taken from the whole
// zip, itself checked against the recipe's SHA-256, on 2026-10-10.
export const POSITIONS = {
  aula: { slot: 0, tx: 0.15, name: 'Aula Carolina', what: 'distance from the source', list: [
    { key: 'aula-2m', label: '2 m', distance: 2, head: true, left: pin('aula_carolina_1_1_2_90_3', '9d500fe45409e7ab77899ff8f98f753119c009f2d3ee0c498381873c628c43b8'), right: pin('aula_carolina_0_1_2_90_3', '92bb52864d9c586dc422af1f62340770af6e32049efef1b7c7abd37b2f8c7026') },
    { key: 'aula-3m', label: '3 m (AULA, shipped)', distance: 3, head: true, shipped: 0, ...shipped(0) },
    { key: 'aula-5m', label: '5 m', distance: 5, head: true, left: pin('aula_carolina_1_1_4_90_3', 'b5f64fed80a0f98ec684994055a8428fdc62e3d5d8fb7a97410d0e0ba661d691'), right: pin('aula_carolina_0_1_4_90_3', '9d87cb944841cb9e203148b62700b7a3efb0d99de5cac0383ffb0e273faea77a') },
    { key: 'aula-10m', label: '10 m (AULA FAR, shipped)', distance: 10, head: true, shipped: 1, ...shipped(1) },
  ] },
  lecture: { slot: 2, tx: 0.12, name: 'Lecture room', what: 'distance from the source', list: [
    { key: 'lecture-2m', label: '2.25 m', distance: 2.25, head: true, left: pin('lecture_1_1_1', '1c3e1de92b1ef052c5f98c78799b6f6d77297418a9dbfad0dacab5f9f394e304'), right: pin('lecture_0_1_1', '4fb85b2f5b93a3930486b723d31e2cbc754dd4d158ec0d64b7027374db7161db') },
    { key: 'lecture-5m', label: '5.56 m (LECTURE, shipped)', distance: 5.56, head: true, shipped: 2, ...shipped(2) },
    { key: 'lecture-10m', label: '10.2 m', distance: 10.2, head: true, left: pin('lecture_1_1_6', '8033fe63aedaf25e5d76dd4111ff4e2005404a06932d270b19b2a83bdfdc6940'), right: pin('lecture_0_1_6', 'e06d82f8183ed002212a7d3b16d784bfaa8eb575a0f358b30a9dc7ef721495b4') },
  ] },
  office: { slot: 4, tx: 0.08, name: 'Office', what: 'with or without the dummy head', list: [
    { key: 'office-head', label: 'with the dummy head (OFFICE, shipped)', distance: 2, head: true, shipped: 4, ...shipped(4) },
    { key: 'office-nohead', label: 'without the dummy head', distance: 2, head: false, left: pin('office_1_0_2', 'd4b4735b3869b926dad9aaeb09a562f2047977e6074e3597146d8dd486166935'), right: pin('office_0_0_2', '1ce33a76189c226901094ea1ce3f7a09b8167e3167aad8fe409fa0623e028598') },
  ] },
  meeting: { slot: 5, tx: 0.08, name: 'Meeting room', what: 'with or without the dummy head', list: [
    { key: 'meeting-head', label: 'with the dummy head (MEETING, shipped)', distance: 1.9, head: true, shipped: 5, ...shipped(5) },
    { key: 'meeting-nohead', label: 'without the dummy head', distance: 1.9, head: false, left: pin('meeting_1_0_3', '6b8a43722074647d626282ba267d080e97880829548319c007ee23053bc10a58'), right: pin('meeting_0_0_3', '05a4330e61a730ab3aa55b79a5b420f8be9feecebc59914f8a5c17e9ece90d95') },
  ] },
};

export async function openAirZip(cache) {
  const z = await openZip(RECIPE.zip, { cache, offline: true });
  checkLicence(z.read(RECIPE.licenceFile.path, RECIPE.licenceFile.sha256), RECIPE.licenceFile.sha256);
  return z;
}

export function readPosition(z, pos) {
  const ear = ([file, want]) => {
    const b = z.read(file, want);
    if (sha256(b) !== want) throw new Error(`${file}: not its pin`);
    const m = readMat(b);
    if (!m.h_air || !m.air_info || m.air_info.fs[0] !== 48000) throw new Error(`${file}: no 48 kHz h_air`);
    return m.h_air;
  };
  const l = ear(pos.left), r = ear(pos.right), n = Math.min(l.length, r.length);
  return { sr: 48000, L: l.subarray(0, n), R: r.subarray(0, n) };
}

export function buildEntry(raw, { id, tx }) {
  const prep = prepRoom(raw, { tx });
  const best = fitRoom(prep), s16 = to16(best.early.eL, best.early.eR);
  return { prep, entry: { id, fit: { ...best.fit, t60raw: best.raw }, gain: s16.gain, level: 0, ch: s16.ch, frames: prep.tx, tx } };
}

const FULL_GAIN = 20 * Math.log10(32768); // the kernel's taps are x / 32768 * 10^(gain / 20): these are x itself
export function fullEntry(prep, id) {
  return { id, fit: { model: 'tail/1', D: 1, scale: 1, t60: [1, 1, 1], eq: [0, 0, 0], g: 0, mod: 0 }, gain: FULL_GAIN, level: 0,
    ch: [Float64Array.from(prep.L), Float64Array.from(prep.R)], frames: prep.L.length, full: true };
}

const rms = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); };
export function bankOf(entries, def) {
  const bank = { format: 'trial', sr: 48000, bits: 16, channels: 2, samples: entries };
  const strum = diStrum(8, 48000), pad = new Float32Array(strum.length + 4 * 48000);
  pad.set(strum);
  for (const e of entries) {
    const slot = ROOMS.findIndex((r) => r[2] === e.id);
    const [l, r] = run(def, { room: slot, mix: 1 }, pad, pad, { data: { aachen: { ...bank, samples: [e] } } });
    e.level = Math.round(100 * 20 * Math.log10(rms(pad) / Math.sqrt((rms(l) ** 2 + rms(r) ** 2) / 2))) / 100;
  }
  return bank;
}

export function initialGap(prep) {
  const { sr, L, R, tx } = prep, z = Math.round(0.0005 * sr);
  let pk = 0;
  for (let i = 0; i < tx; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  for (let i = 0; i < tx; i++) if (Math.abs(L[i]) >= pk / 10 || Math.abs(R[i]) >= pk / 10) return Math.round(((i - z) / sr) * 10000) / 10;
  return 0;
}

// T5's tail: roomTail with MODN of its lines read through a wandering, cubic-interpolated head. Kernel text (it runs
// inside core.rooms' kernel, after SERIES and roomSvfSet); MODN is set by modulatedDef.
const MODN = 0;
const roomTailModulated = function roomTail(sr, opts) {
  const N = 8, BASE = [1031, 1327, 1523, 1801, 2111, 2437, 2741, 3089];
  const o = opts || {}, k = sr / 48000;
  const maxScale = o.maxScale || 1.6, maxD = o.maxD || Math.ceil(0.25 * sr);
  const pow2 = (x) => { let n = 1; while (n < x) n <<= 1; return n; };
  const LN = pow2(Math.ceil(BASE[N - 1] * maxScale * k) + 32), LM = LN - 1, lines = new Float32Array(N * LN);
  const DN = pow2(maxD + 4), DM = DN - 1, din = new Float32Array(DN);
  const len = new Int32Array(N), gm = new Float64Array(N), lsA = new Float64Array(N), lsG = new Float64Array(N), hsA = new Float64Array(N), hsG = new Float64Array(N);
  const ls = new Float64Array(N), hs = new Float64Array(N), x = new Float64Array(N);
  // which lines wander (2: two opposite lines, 4: every other), their phase and its step a sample, the depth
  const mon = new Int32Array(N), mph = new Float64Array(N), mdt = new Float64Array(N);
  for (let i = 0; i < N; i++) { mon[i] = MODN >= 8 || (MODN === 4 && i % 2 === 0) || (MODN === 2 && i % 4 === 0) ? 1 : 0; mdt[i] = (0.07 + (0.11 * i) / N) / sr; }
  let depth = 0;
  const ec = new Float64Array(21), es = new Float64Array(12);
  let w = 0, dw = 0, D = 1, g = 0;
  const tanOf = (fc) => { const a = Math.PI * fc / sr; return dsin(a) / dcos(a); };
  const loop = (frames, t60) => dexp(-3 * Math.LN10 * frames / (t60 * sr));
  const shelfLo = (A, W, w) => Math.sqrt((A * A * W * W + w * w) / (W * W + w * w));
  const shelfHi = (A, W, w) => Math.sqrt((W * W + A * A * w * w) / (W * W + w * w));
  const T500 = tanOf(500), T4K = tanOf(4000), O = [tanOf(63), tanOf(1414), tanOf(sr > 40000 ? 16000 : 0.4 * sr)];
  const tail = {
    set(fit, decay, damp) {
      const dc = decay > 0 ? decay : 1, dm = damp < 0 ? 0 : damp > 1 ? 1 : damp;
      const sc = fit.scale < 0.4 ? 0.4 : fit.scale > maxScale ? maxScale : fit.scale;
      depth = (3 + 9 * ((sc - 0.4) / 1.2)) * k;
      const tl = fit.t60[0] * dc, tm = fit.t60[1] * dc * (1 - 0.25 * dm), th = fit.t60[2] * dc * (1 - 0.65 * dm);
      for (let i = 0; i < N; i++) {
        const L = Math.round(BASE[i] * sc * k);
        len[i] = L;
        const t0 = loop(L, tl), t1 = loop(L, tm), t2 = loop(L, th);
        let gl = t0, gmid = t1, gh = t2, al = 1, ah = 1, W1 = 1, W2 = 1;
        for (let it = 0; it < 4; it++) {
          al = gl / gmid; ah = gh / gmid; W1 = T500 / Math.sqrt(al); W2 = T4K * Math.sqrt(ah);
          const m0 = gmid * shelfLo(al, W1, O[0]) * shelfHi(ah, W2, O[0]);
          const m1 = gmid * shelfLo(al, W1, O[1]) * shelfHi(ah, W2, O[1]);
          const m2 = gmid * shelfLo(al, W1, O[2]) * shelfHi(ah, W2, O[2]);
          gl *= t0 / m0; gmid *= t1 / m1; gh *= t2 / m2;
        }
        al = gl / gmid; ah = gh / gmid; W1 = T500 / Math.sqrt(al); W2 = T4K * Math.sqrt(ah);
        gm[i] = gmid;
        lsA[i] = al - 1; lsG[i] = W1 / (1 + W1);
        hsA[i] = ah - 1; hsG[i] = W2 / (1 + W2);
      }
      D = fit.D < 1 ? 1 : fit.D > maxD ? maxD : Math.round(fit.D);
      g = fit.g;
      roomSvfSet(sr, 1, 250, 0.707, fit.eq[0], ec, 0);
      roomSvfSet(sr, 2, 1500, 0.7, fit.eq[1], ec, 7);
      roomSvfSet(sr, 3, 6000, 0.707, fit.eq[2], ec, 14);
      return tail;
    },
    process(inp, outL, outR, n) {
      for (let i = 0; i < n; i++) {
        din[dw] = inp[i];
        const v = din[(dw - D) & DM] * 0.5;
        dw = (dw + 1) & DM;
        let sum = 0;
        for (let li = 0; li < N; li++) {
          let y;
          if (mon[li]) {
            let p = mph[li] + mdt[li]; if (p >= 1) p -= 1; mph[li] = p;
            const r = w - (len[li] + depth * (1 + dsin(6.283185307179586 * p))), q = Math.floor(r), f = r - q, b = li * LN;
            const y0 = lines[b + ((q - 1) & LM)], y1 = lines[b + (q & LM)], y2 = lines[b + ((q + 1) & LM)], y3 = lines[b + ((q + 2) & LM)];
            const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
            y = (((c3 * f + c2) * f + c1) * f + y1) * gm[li];
          } else y = lines[li * LN + ((w - len[li]) & LM)] * gm[li];
          let u = (y - ls[li]) * lsG[li], lp = u + ls[li]; ls[li] = lp + u;
          y += lsA[li] * lp;
          u = (y - hs[li]) * hsG[li]; lp = u + hs[li]; hs[li] = lp + u;
          y += hsA[li] * (y - lp);
          x[li] = y; sum += y;
        }
        sum *= 2 / N;
        for (let li = 0; li < N; li++) lines[li * LN + w] = x[li] - sum + ((li & 1) ? -v : v);
        w = (w + 1) & LM;
        const nl = x[0] - x[2] + x[4] - x[6] + 0.5 * (x[1] - x[5]);
        const nr = x[1] - x[3] + x[5] - x[7] + 0.5 * (x[2] - x[6]);
        let yl = nl, yr = nr;
        for (let f = 0; f < 3; f++) {
          const o = 7 * f, a1 = ec[o + 1], a2 = ec[o + 2], a3 = ec[o + 3], m0 = ec[o + 4], m1 = ec[o + 5], m2 = ec[o + 6];
          let p = 2 * f, s1 = es[p], s2 = es[p + 1], v3 = yl - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
          es[p] = 2 * v1 - s1; es[p + 1] = 2 * v2 - s2; yl = m0 * yl + m1 * v1 + m2 * v2;
          p += 6; s1 = es[p]; s2 = es[p + 1]; v3 = yr - s2; v1 = a1 * s1 + a2 * v3; v2 = s2 + a2 * s1 + a3 * v3;
          es[p] = 2 * v1 - s1; es[p + 1] = 2 * v2 - s2; yr = m0 * yr + m1 * v1 + m2 * v2;
        }
        outL[i] = yl * g;
        outR[i] = yr * g;
      }
    },
    reset() {
      lines.fill(0); din.fill(0); ls.fill(0); hs.fill(0); es.fill(0);
      for (let i = 0; i < N; i++) mph[i] = (i + 0.5) / N;
      return tail;
    },
  };
  tail.reset();
  return tail;
};

export function modulatedDef(def, lines, { copy = false } = {}) {
  if (![0, 2, 4, 8].includes(lines)) throw new Error('modulatedDef: 0, 2, 4 or 8 lines');
  if (!lines && !copy) return def;
  const src = String(roomTail);
  if (!ROOMS_BODY.includes(src)) throw new Error("core.rooms' kernel no longer carries roomTail's text");
  const mod = String(roomTailModulated).replace(/MODN/g, String(lines));
  return { ...def, id: `${def.id}~mod${lines}`, kernel: kernel(ROOMS_BODY.replace(src, () => mod)) };
}
