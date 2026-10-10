// Echo Chamber (core.rooms, intent 0006 "Real Rooms"): the series, the room tail, the ranged zip, the `aachen` bank and
// the device. Not registered in builtin/index.js yet: this imports it, which defines it.
//
//   the series   series.js's dsin is convolve.js's, double for double; dexp is within 1e-15 of Math.exp; SERIES and
//                ROOM_TAIL are the functions' own text, and that text, run as a kernel would, gives the same samples
//                as the imported functions
//   the grep     ROOM_TAIL calls no Math.exp, pow, sin, cos, tan or log (R22)
//   the tail     an impulse through roomTail alone decays at each band's set T60 within 5% (R8, R10): the low band at
//                63 Hz, the mid at 1.4 kHz and the high at 16 kHz, with DECAY and DAMP applied as R10 says; nothing
//                allocates in process()
//   the zip      tools/kits/zip.js's ranged reader against a local server: members by Range, checked and cached by
//                their SHA-256, then read again offline; a server that ignores Range gets the whole zip, checked
//                against its own SHA-256; a member that isn't its pin is refused
//   the bank     (app/kits/: node tools/fetch-kits.js --only air-rooms) every R15 field and the meta; ROOM_INFO is the
//                header's; the direct sound out (R6); the spec's early cuts (R7); each IR ends at 0 (R12); under 50 KB
//                a room on the wire (R18); qa.json is this bank's, and each room passes R13 or names its waiver
//   the device   R19-R24: the def, the dataSays words, ROOM_TAIL verbatim and no Math.exp/pow/sin/cos/tan/log after
//                LIB, no bank = the input as it is, MIX 0 = dry, every room's wet RMS within 0.5 dB, other host
//                rates, a click-free room change, the device check at defaults
//   the cost     no garbage collection across room changes; the heaviest block of the cycle under 0.5 ms; a room
//                change's block reported (Q5); checkDevice's cpu against core.verb, at most 1.5x (R36)
//   the studio   (Chromium, QUIET; R25-R28) an empty chain offers Real room after Reverb; with the bank held back the
//                card says "Loading rooms…" beside the name, then the card's room line and the unsigned credit, every
//                number the header's, following ROOM; with the bank missing it says "No rooms here". The face: wide,
//                hammer, plate, its look. Screenshots: tools/.out/rooms-card*.png. ROOMS_BROWSER=0 skips it
//   node tools/rooms-test.js
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { PerformanceObserver } from 'node:perf_hooks';
import { tally, open } from './pw.js';
import { dsin as convolveSin, fft } from '../app/src/kernel/convolve.js';
import { dsin, dcos, dexp, SERIES } from '../app/src/devices/builtin/series.js';
import { roomTail, roomSvfSet, roomPole, roomGlide, ROOM_TAIL } from '../app/src/devices/builtin/rooms-lib.js';
import { openZipRanged } from './kits/zip.js';
import { fileURLToPath } from 'node:url';
import rooms, { ROOMS_BODY } from '../app/src/devices/builtin/rooms.js';
import verb from '../app/src/devices/builtin/verb.js';
import { ROOMS, ROOM_LABELS, ROOMS_HASH, ROOMS_SAYS, ROOM_INFO, ROOMS_CREDIT } from '../app/src/devices/builtin/rooms-lib.js';
import { cardLine, describe as describeRoom } from '../app/src/devices/builtin/rooms.js';
import { LIB } from '../app/src/devices/builtin/lib.js';
import { dataFor, dataPath } from '../app/src/engine/node/data.js';
import { encodeOdk } from '../app/src/kernel/odk.js';
import { packOdk } from '../app/src/kernel/odkz.js';
import { makeDsp } from '../app/src/kernel/dsp.js';
import { kernelSpecs } from '../app/src/kernel/host.js';
import { paramValues } from '../app/src/devices/registry.js';
import { diStrum } from '../app/src/audio/testsignals.js';
import { measure } from '../app/src/audio/measure.js';
import { checkDeviceNode } from '../app/src/engine/node/check.js';
import { summarize } from '../app/src/kernel/check.js';
import { roomInfo } from './kits/air-rooms.js';
import { run } from './amp-scenes.js';

const T = tally('rooms');
const ok = T.ok;
const SR = 48000;

/* ------------------------------------------------------------------ the series */
console.log('the series');
{
  let same = 0, n = 0;
  for (let i = -200000; i <= 200000; i++) { const x = i * 0.000731; n++; if (dsin(x) === convolveSin(x)) same++; }
  ok(same === n, `series.js's dsin is convolve.js's, double for double (${same} of ${n} points from -146 to 146)`);
  let worst = 0, wx = 0;
  for (let i = 0; i <= 400000; i++) {
    const x = -745 + (1454 * i) / 400000, a = dexp(x), b = Math.exp(x);
    if (b > 1e-300 && Number.isFinite(b)) { const e = Math.abs(a - b) / b; if (e > worst) { worst = e; wx = x; } }
  }
  ok(worst < 1e-15, `dexp is within 1e-15 of Math.exp from -745 to 709 (worst ${worst.toExponential(2)}, at ${wx.toFixed(2)})`);
  ok(dexp(0) === 1 && dexp(-800) === 0 && dexp(800) === Infinity && Number.isNaN(dexp(NaN)), 'dexp(0) is 1, it underflows to 0 and overflows to Infinity, NaN stays NaN');
  let cw = 0; for (let i = 0; i < 10000; i++) { const x = (i - 5000) * 0.01; cw = Math.max(cw, Math.abs(dcos(x) - Math.cos(x))); }
  ok(cw < 1e-14, `dcos is within 1e-14 of Math.cos from -50 to 50 (worst ${cw.toExponential(2)})`);
  ok(SERIES === [dsin, dcos, dexp].map(String).join('\n') && ROOM_TAIL.startsWith(SERIES) && [roomSvfSet, roomPole, roomGlide, roomTail].every((f) => ROOM_TAIL.includes(String(f))),
    'SERIES and ROOM_TAIL are the functions\' own text (one source for the kernel and the tool)');
  const banned = ROOM_TAIL.match(/Math\.(exp|pow|sin|cos|tan|log)\w*/g);
  ok(!banned, `ROOM_TAIL calls no Math.exp, pow, sin, cos, tan or log${banned ? ': ' + [...new Set(banned)].join(', ') : ''}`);
}

/* ------------------------------------------------------------------ the tail's decay per band */
// T60 in a band around f (half: its half-width in octaves; want: the decay expected, which sets the frames): Hann
// frames (hop an eighth) through dsp.fft, the band's energy per frame,
// integrated backwards (Schroeder), and a line fitted from -5 to -25 dB, times 3
function bandT60(y, f, half, want) {
  // frames no longer than an eighth of the decay, but long enough for 3 bins across the band
  let N = 8192;
  while (N > 256 && N / SR > want / 8 && SR / (N / 2) <= (f * (Math.pow(2, half) - Math.pow(2, -half))) / 3) N /= 2;
  const H = N / 8, F = fft(N), w = new Float64Array(N), fr = new Float64Array(N), Xr = new Float64Array(N / 2 + 1), Xi = new Float64Array(N / 2 + 1);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const lo = Math.max(1, Math.floor((f / Math.pow(2, half) / SR) * N)), hi = Math.min(N / 2, Math.ceil((f * Math.pow(2, half) / SR) * N));
  const E = [];
  for (let a = 0; a + N <= y.length; a += H) {
    for (let i = 0; i < N; i++) fr[i] = y[a + i] * w[i];
    F.forward(fr, Xr, Xi);
    let e = 0; for (let k = lo; k <= hi; k++) e += Xr[k] * Xr[k] + Xi[k] * Xi[k];
    E.push(e);
  }
  const S = new Float64Array(E.length); let acc = 0;
  for (let i = E.length - 1; i >= 0; i--) { acc += E[i]; S[i] = acc; }
  const d = Array.from(S, (s) => 10 * Math.log10(s / S[0]));
  const pts = [];
  for (let i = 0; i < d.length; i++) if (d[i] <= -5 && d[i] >= -25) pts.push([(i * H) / SR, d[i]]);
  if (pts.length < 4) return NaN;
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const slope = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) * (p[0] - mx), 0);
  return -60 / slope;
}
// x high-passed at f: four first-order high-passes in a row (24 dB/oct), forward only
function highBand(x, f) {
  const a = Math.exp((-2 * Math.PI * f) / SR), y = Float64Array.from(x);
  for (let k = 0; k < 4; k++) { let px = 0, py = 0; for (let i = 0; i < y.length; i++) { const v = y[i]; py = a * (py + v - px); px = v; y[i] = py; } }
  return y;
}
const impulse = (tail, secs) => {
  const n = Math.round(secs * SR), x = new Float64Array(n), L = new Float64Array(n), R = new Float64Array(n);
  x[0] = 1;
  for (let a = 0; a < n; a += 128) tail.process(x.subarray(a, a + 128), L.subarray(a, a + 128), R.subarray(a, a + 128), Math.min(128, n - a));
  const m = new Float64Array(n); for (let i = 0; i < n; i++) m[i] = L[i] + R[i];
  return { L, R, m };
};

console.log('the tail');
{
  const flat = { model: 'tail/1', D: 128, eq: [0, 0, 0], g: 1, mod: 0 };
  const cases = [
    { what: 'a hall', fit: { ...flat, scale: 1.6, t60: [6.3, 3.1, 2.6] }, decay: 1, damp: 0 },
    { what: 'a lecture room', fit: { ...flat, scale: 1, t60: [1.3, 0.9, 0.6] }, decay: 1, damp: 0 },
    { what: 'an office, DECAY 1.5, DAMP 0.5', fit: { ...flat, scale: 0.5, t60: [0.97, 0.65, 0.41] }, decay: 1.5, damp: 0.5 },
    { what: 'a meeting room', fit: { ...flat, scale: 0.4, t60: [0.5, 0.37, 0.29] }, decay: 1, damp: 0 },
    // (the extreme: under about 0.15 s a band's decay is a handful of loop passes, and is reported, not held)
    { what: 'a meeting room, DECAY 0.8, DAMP 1', fit: { ...flat, scale: 0.4, t60: [0.5, 0.37, 0.29] }, decay: 0.8, damp: 1, report: true },
  ];
  for (const c of cases) {
    const want = [c.fit.t60[0] * c.decay, c.fit.t60[1] * c.decay * (1 - 0.25 * c.damp), c.fit.t60[2] * c.decay * (1 - 0.65 * c.damp)];
    const tail = roomTail(SR).set(c.fit, c.decay, c.damp);
    const { m } = impulse(tail, Math.max(...want) * 0.75 + 0.6);
    // (the low band over an octave, where the modes are sparse; the others over a third, since the T60 between the
    // bands' own frequencies slopes from one to the next by design)
    const got = [bandT60(m, 63, 1 / 2, want[0]), bandT60(m, 1414, 1 / 6, want[1]), bandT60(m, 16000, 1 / 6, want[2])];
    const err = got.map((g, i) => Math.abs(g / want[i] - 1));
    const line = `${c.what}: T60 ${got.map((g) => g.toFixed(2)).join(' / ')} s at 63 Hz / 1.4 kHz / 16 kHz against ${want.map((g) => g.toFixed(2)).join(' / ')} set (octave, third, third) (worst ${(100 * Math.max(...err)).toFixed(1)}%)`;
    if (c.report) T.note(line); else ok(err.every((e) => e < 0.05), line);
  }
  // the input delay: nothing comes out before D frames
  {
    const tail = roomTail(SR).set({ ...flat, scale: 1, t60: [1, 1, 1], D: 3000 }, 1, 0);
    const { m } = impulse(tail, 0.2);
    let first = -1; for (let i = 0; i < m.length; i++) if (Math.abs(m[i]) > 1e-12) { first = i; break; }
    ok(first >= 3000, `the tail's input waits D frames (D 3000: the first sound at frame ${first})`);
  }
  // the text, run as a kernel would run it, plays the same samples as the imported functions
  {
    const fit = { ...flat, scale: 0.8, t60: [1.4, 1.1, 0.7], eq: [2, -1.5, -3], g: 0.6 };
    const fromText = new Function(ROOM_TAIL + '\nreturn roomTail;')();
    const a = impulse(roomTail(SR).set(fit, 1.2, 0.3), 0.5), b = impulse(fromText(SR).set(fit, 1.2, 0.3), 0.5);
    let same = true; for (let i = 0; i < a.L.length; i++) if (a.L[i] !== b.L[i] || a.R[i] !== b.R[i]) { same = false; break; }
    ok(same, 'ROOM_TAIL run as kernel text gives the imported roomTail\'s samples, bit for bit (with the EQ and g)');
  }
  // the two sides of the late field are nearly uncorrelated, as a binaural room's are (AIR: 0.03 to 0.27)
  {
    const { L, R } = impulse(roomTail(SR).set({ ...flat, scale: 1, t60: [1, 1, 1] }, 1, 0), 1);
    let xy = 0, xx = 0, yy = 0; for (let i = Math.round(0.08 * SR); i < Math.round(0.5 * SR); i++) { xy += L[i] * R[i]; xx += L[i] * L[i]; yy += R[i] * R[i]; }
    const r = xy / Math.sqrt(xx * yy);
    ok(Math.abs(r) < 0.3, `the tail's sides correlate ${r.toFixed(2)} over 80-500 ms`);
  }
}

/* ------------------------------------------------------------------ no allocation */
{
  const fit = { model: 'tail/1', D: 2000, scale: 1.2, t60: [2, 1.5, 1], eq: [1, 1, -2], g: 0.5, mod: 0 };
  const tail = roomTail(SR).set(fit, 1, 0.2);
  const x = new Float64Array(128), L = new Float64Array(128), R = new Float64Array(128);
  for (let i = 0; i < 128; i++) x[i] = Math.sin(i);
  for (let b = 0; b < 2000; b++) tail.process(x, L, R, 128);
  { let junk = 0; for (let i = 0; i < 256; i++) junk += new Float64Array(1 << 15).length; if (!junk) throw new Error('unreachable'); }
  await new Promise((r) => setTimeout(r, 50));
  let gcs = 0;
  const obs = new PerformanceObserver((list) => { gcs += list.getEntries().length; });
  obs.observe({ entryTypes: ['gc'] });
  const blocks = Math.round((SR * 10) / 128);
  const t0 = performance.now();
  for (let b = 0; b < blocks; b++) tail.process(x, L, R, 128);
  const ms = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 50));
  obs.disconnect();
  ok(gcs === 0, `the tail's process() allocates nothing: no garbage collection over 10 s of audio (${gcs})`);
  T.note(`the tail alone costs ${(ms / 10).toFixed(2)} ms per second of audio`);
}

/* ------------------------------------------------------------------ the ranged zip */
console.log('the ranged zip');
{
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  // a zip of three members, one stored and two deflated, with 300 KB of padding before the directory
  const files = [['a/license.txt', Buffer.from('MIT License\n\nthe text'), 0], ['a/one.bin', crypto.createHash('sha512').update('one').digest(), 8], ['a/big.bin', Buffer.alloc(200000, 7), 8]];
  const parts = [], dir = [];
  let at = 0;
  for (const [name, data, method] of files) {
    const body = method ? zlib.deflateRawSync(data) : data, nm = Buffer.from(name), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26); lh.writeUInt16LE(4, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(at, 42);
    // (the local header carries a 4-byte extra field the directory doesn't: the reader must use the local lengths)
    parts.push(lh, nm, Buffer.alloc(4), body); dir.push(ch, nm);
    at += 30 + nm.length + 4 + body.length;
  }
  parts.push(Buffer.alloc(300000));
  const cd = Buffer.concat(dir), start = at + 300000, end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(start, 16);
  const zip = Buffer.concat([...parts, cd, end]);
  const pins = Object.fromEntries(files.map(([n, d]) => [n, sha(d)]));
  let ranges = 0, wholes = 0, honour = true;
  const server = http.createServer((req, res) => {
    const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    if (m && honour) {
      ranges++;
      const a = +m[1], b = Math.min(zip.length - 1, +m[2]);
      res.writeHead(206, { 'content-range': `bytes ${a}-${b}/${zip.length}`, 'content-length': b - a + 1 });
      res.end(zip.subarray(a, b + 1));
    } else { wholes++; res.writeHead(200, { 'content-length': zip.length }); res.end(zip); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/air.zip`, src = { url, sha256: sha(zip), size: zip.length };
  const dirs = [];
  const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-zip-')); dirs.push(d); return d; };
  const cache = tmp();
  try {
    const z = await openZipRanged(src, { cache, members: pins });
    const same = files.every(([n, d]) => z.read(n).equals(d));
    ok(z.how === 'range' && same && wholes === 0, `members by Range: ${ranges} requests for ${(zip.length / 1000).toFixed(0)} KB, every member its pin (${z.how}, ${wholes} whole downloads)`);
    ok(files.every(([n]) => fs.existsSync(path.join(cache, pins[n] + path.extname(n)))), 'each member is cached by its own SHA-256');
    ranges = 0;
    const z2 = await openZipRanged(src, { cache, offline: true, members: pins });
    ok(z2.how === 'cache' && ranges === 0 && files.every(([n, d]) => z2.read(n).equals(d)), 'read again offline, from the cache alone');
    const bad = { ...pins, 'a/one.bin': sha(Buffer.from('not it')) };
    let msg = '';
    try { await openZipRanged(src, { cache: tmp(), members: bad }); } catch (e) { msg = e.message; }
    ok(/a\/one\.bin: SHA-256 .* pinned/.test(msg), `a member that isn't its pin is refused ("${msg.slice(0, 60)}...")`);
    msg = '';
    try { await openZipRanged({ ...src, size: zip.length + 1 }, { cache: tmp(), members: pins }); } catch (e) { msg = e.message; }
    ok(/pinned/.test(msg), 'a zip whose size isn\'t the pinned one is refused');
    honour = false; wholes = 0;
    const c3 = tmp();
    const z3 = await openZipRanged(src, { cache: c3, members: pins });
    ok(z3.how === 'zip' && wholes >= 1 && files.every(([n, d]) => z3.read(n).equals(d)) && fs.existsSync(path.join(c3, src.sha256 + '.zip')), 'a server that ignores Range: the whole zip, checked by its SHA-256 and cached');
    let wrong = '';
    try { await openZipRanged({ ...src, sha256: sha(Buffer.from('x')) }, { cache: tmp(), members: pins }); } catch (e) { wrong = e.message; }
    ok(/SHA-256 .* pinned/.test(wrong), 'and the whole zip must be its pin');
  } finally {
    server.close();
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ the bank */
// (what follows needs the `aachen` bank: node tools/fetch-kits.js --only air-rooms builds it into app/kits/)
const bank = dataFor(rooms.data).aachen;
const wantTx = { 'aachen.aula-3m': 150, 'aachen.aula-10m': 150, 'aachen.lecture-5m': 120, 'aachen.stairway-2m': 100, 'aachen.office-2m': 80, 'aachen.meeting-2m': 80 };
const QA = path.join(path.dirname(fileURLToPath(import.meta.url)), '.out', 'library', 'rooms', 'qa.json');
console.log('the bank');
if (!bank) {
  ok(false, `the aachen bank (${ROOMS_HASH.slice(0, 19)}...) is here (node tools/fetch-kits.js --only air-rooms builds it)`);
} else {
  ok(bank.bits === 16 && bank.channels === 2 && bank.sr === 48000 && bank.samples.length === ROOMS.length, `the aachen bank: ${bank.samples.length} rooms, ${bank.bits}-bit, ${bank.channels} channels, ${bank.sr} Hz`);
  const m = bank.meta;
  ok(m.kind === 'rooms' && m.licence === 'MIT' && /^MIT License/.test(m.notice) && /Permission is hereby granted, free of charge/.test(m.notice) && /THE SOFTWARE IS PROVIDED "AS IS"/.test(m.notice)
    && m.credit === ROOMS_CREDIT && /^https:\/\/www\.iks\.rwth-aachen\.de\//.test(m.url),
    `its meta: kind rooms, licence MIT, the full MIT notice (${m.notice.length} characters), the credit and the source URL`);
  const FIELDS = ['id', 'name', 'place', 'what', 'distance', 'measured', 'tx', 'fit', 'gain', 'level'];
  const fitOk = (f) => f && f.model === 'tail/1' && Number.isInteger(f.D) && f.D > 0 && f.scale >= 0.4 && f.scale <= 1.6 && f.t60.length === 3 && f.t60.every((t) => t > 0.05)
    && f.eq.length === 3 && f.eq.every((e) => Math.abs(e) <= 24) && f.g > 0 && f.mod === 0 && f.t60raw.length === 3;
  const meas = (s) => s.measured && ['t30', 'edt', 'c80'].every((k) => s.measured[k].length === s.measured.octaves.length) && s.measured.mix > 0 && s.measured.floor < -30;
  ok(bank.samples.every((s, i) => FIELDS.every((k) => s[k] != null) && s.id === ROOMS[i][2] && s.label === ROOMS[i][0] && fitOk(s.fit) && meas(s)),
    `every room, in the switch's order, carries ${FIELDS.join(', ')} (the fit tail/1 with D, scale, t60 [lo, mid, hi] and the uncapped t60raw, eq, g, mod; the measured T30, EDT and C80 per octave, the mixing time, the noise floor)`);
  ok(JSON.stringify(roomInfo(bank)) === JSON.stringify(ROOM_INFO), `ROOM_INFO (rooms-lib.js, what the card and the agents read) is the header's, field by field (${ROOM_INFO.map((r) => `${r.label} ${r.t30[1]} s at 1 kHz`).join(', ')})`);
  ok(bank.samples.every((s) => Math.round(s.tx * 1000) === wantTx[s.id] && s.frames === Math.round(s.tx * 48000)),
    `the early cuts are the spec's: ${bank.samples.map((s) => `${s.label} ${Math.round(s.tx * 1000)} ms`).join(', ')}`);
  // R6: the direct sound is out: the stored IR's first 2.5 ms under -40 dB re its peak
  const heads = bank.samples.map((s) => {
    let pk = 0, h = 0; const n = Math.round(0.0025 * 48000);
    for (const c of s.ch) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > pk) pk = a; if (i < n && a > h) h = a; }
    return h > 0 ? 20 * Math.log10(h / pk) : -200;
  });
  ok(heads.every((d) => d < -40), `the direct sound is out: each IR's first 2.5 ms peak at ${heads.map((d) => (d <= -200 ? 'silence' : d.toFixed(0) + ' dB')).join(', ')} re its peak (under -40)`);
  // R12: the window reaches 0 at tx (the last stored frame is silent)
  ok(bank.samples.every((s) => s.ch.every((c) => c[c.length - 1] === 0)), 'each early IR ends at 0 at its cut (the window\'s 5 ms cosine)');
  // R18: the sizes on the wire, a room at a time (its own .odk, packed, gzipped)
  const wire = bank.samples.map((s) => zlib.gzipSync(packOdk(encodeOdk({ name: 'one', sr: 48000, bits: 16, channels: 2, meta: {}, samples: [{ id: s.id, ch: s.ch }] })), { level: 9 }).length);
  const whole = zlib.gzipSync(packOdk(fs.readFileSync(dataPath(ROOMS_HASH))), { level: 9 }).length;
  ok(wire.every((b) => b < 50000), `each room is under 50 KB on the wire: ${wire.map((b) => (b / 1000).toFixed(1)).join(', ')} KB (the bank ${(fs.statSync(dataPath(ROOMS_HASH)).size / 1000).toFixed(1)} KB as .odk, ${(whole / 1000).toFixed(1)} KB packed and gzipped)`);
  // R13: the fit's report
  let qa = null;
  try { qa = JSON.parse(fs.readFileSync(QA, 'utf8')); } catch { /* not built here */ }
  if (!qa || qa.hash !== ROOMS_HASH) ok(false, `tools/.out/library/rooms/qa.json is this bank's (node tools/fetch-kits.js --only air-rooms --rebuild writes it)`);
  else {
    ok(qa.rows.length === ROOMS.length && qa.rows.every((r) => r.pass || /waiver pending AJ/.test(r.waiver || '')),
      `qa.json: every room passes the R13 bar or names its waiver (${qa.rows.map((r) => `${r.label} ${r.pass ? 'passes' : 'waiver pending: ' + r.checks.filter((c) => !c.pass).length + ' of ' + r.checks.length + ' checks miss'}`).join('; ')})`);
    for (const r of qa.rows) T.note(`${r.label}: ${r.checks.map((c) => `${c.pass ? '' : 'MISS '}${c.name} ${c.detail}`).join('; ')}`);
    ok(qa.rows.every((r) => r.built > 0 && r.fit.D + 0 === bank.samples.find((s) => s.id === r.id).fit.D), `the tail has built up by tx: D puts its plateau there (built ${qa.rows.map((r) => r.built + ' ms').join(', ')} after its input)`);
    T.note(`R7's rule (twice the mixing time, to the next 10 ms, 80-200 ms) would give ${qa.rows.map((r) => `${r.label} ${r.txRule}`).join(', ')} ms; the spec's listed values ship`);
  }
}

/* ------------------------------------------------------------------ Echo Chamber */
console.log('Echo Chamber');
{
  const d = rooms;
  ok(d.id === 'core.rooms' && d.name === 'Echo Chamber' && d.kind === 'effect' && d.cat === 'ambient' && d.by === 'overdub' && d.trails === true && d.tail === 12 && d.latency == null && d.data.aachen === ROOMS_HASH,
    'core.rooms is Echo Chamber: an ambient effect, trails, tail 12 s, no declared latency, data { aachen }');
  ok(JSON.stringify(d.params.map((p) => p.key)) === JSON.stringify(['room', 'predelay', 'decay', 'damp', 'lowcut', 'width', 'mix']) && JSON.stringify(d.params[0].opts) === JSON.stringify(ROOM_LABELS) && d.params[0].auto === false,
    `its params, keys forever: ${d.params.map((p) => p.key).join(', ')}; ROOM a switch of ${ROOM_LABELS.join(', ')}, never automated`);
  ok(JSON.stringify(d.dataSays) === JSON.stringify(ROOMS_SAYS) && ROOMS_SAYS.loading[0] === 'Loading rooms…' && ROOMS_SAYS.missing[0] === 'No rooms here', `it says "${ROOMS_SAYS.loading[0]}" while the bank loads and "${ROOMS_SAYS.missing[0]}" without it`);
  // R8 and R22: ROOM_TAIL verbatim in the kernel; nothing after LIB calls Math.exp, pow, sin, cos, tan or log
  ok(d.kernel.includes(ROOM_TAIL) && d.kernel.includes(ROOMS_BODY) && d.kernel.indexOf(ROOMS_BODY) > d.kernel.indexOf(LIB) + LIB.length - 1, 'the kernel carries ROOM_TAIL verbatim, after lib.js\'s LIB');
  const banned = ROOMS_BODY.match(/Math\.(exp|pow|sin|cos|tan|log)\w*/g);
  ok(!banned, `the kernel's own text (${ROOMS_BODY.length} characters after LIB) calls no Math.exp, pow, sin, cos, tan or log${banned ? ': ' + [...new Set(banned)].join(', ') : ''}`);
  // R24: no bank, the input as it is
  const strum = diStrum(4, SR), st = [Float32Array.from(strum, (v) => v * 0.7), Float32Array.from(strum, (v, i) => v * 0.5 + 0.1 * Math.sin(i * 0.01))];
  const [nl, nr] = run(d, {}, st[0], st[1], { data: null });
  let same = true; for (let i = 0; i < nl.length; i++) if (nl[i] !== st[0][i] || nr[i] !== st[1][i]) { same = false; break; }
  ok(same, 'with no bank (loading, or not on this server) the input passes through, sample for sample');
  if (bank) {
    const [dl] = run(d, { mix: 0 }, st[0], st[1]);
    let dry = true; for (let i = 0; i < dl.length; i++) if (dl[i] !== st[0][i]) { dry = false; break; }
    ok(dry, 'MIX 0 is the dry signal, sample for sample (the dry path has no latency)');
    // R20: every room's wet signal at the DI strum's RMS
    const pad = new Float32Array(SR * 12); pad.set(diStrum(8, SR));
    const wet = ROOMS.map((_, r) => { const [l, rr] = run(d, { room: r, mix: 1 }, pad); return measure({ sr: SR, channels: [l, rr] }).rms; });
    const spread = Math.max(...wet) - Math.min(...wet);
    ok(spread < 0.5, `switching rooms moves the wet RMS on the DI strum by ${spread.toFixed(2)} dB at most (${wet.map((x) => x.toFixed(2)).join(', ')} dBFS; under 0.5)`);
    // at another host rate the rooms are resampled (linearly) and the fit's D moves with the rate: about the same level
    // (the bank, the fit and the bit-exact renders are 48 kHz's; elsewhere the linear resampling's top-octave loss and
    // the tail's own rate dependence move it by a dB or two, measured here and held within 3 dB)
    const atRate = (sr) => { const x = new Float32Array(sr * 12); x.set(diStrum(8, sr)); const [l, rr] = run(d, { room: 0, mix: 1 }, x, x, { sr }); return measure({ sr, channels: [l, rr] }).rms; };
    const rates = [44100, 96000].map((r) => [r, atRate(r) - wet[0]]);
    ok(rates.every(([, dd]) => Math.abs(dd) < 3), `at ${rates.map(([r, dd]) => `${r / 1000} kHz the wet RMS is ${dd >= 0 ? '+' : ''}${dd.toFixed(2)} dB`).join(' and ')} from 48 kHz's (AULA)`);
    // R23: a live room change, no click: a 440 Hz sine in, AULA to LECTURE at 1 s; the difference from staying in AULA,
    // above 4 kHz (where a sine's room has nothing), stays under -60 dBFS
    const sine = new Float32Array(SR * 2); for (let i = 0; i < sine.length; i++) sine[i] = 0.25 * Math.sin((2 * Math.PI * 440 * i) / SR);
    const sw = run(d, { mix: 0.5 }, sine, sine, { sched: (t) => (t >= 1 && t < 1 + 128 / SR ? { mix: 0.5, room: 2 } : null) })[0], stay = run(d, { mix: 0.5 }, sine)[0];
    const diff = Float64Array.from(sw, (v, i) => v - stay[i]), hp = highBand(diff, 4000);
    let before = 0, at = 0;
    for (let i = SR / 2; i < SR; i++) before = Math.max(before, Math.abs(hp[i]));
    for (let i = SR; i < SR + Math.round(0.1 * SR); i++) at = Math.max(at, Math.abs(hp[i]));
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : -200);
    ok(db(at) < -60, `a room change mid-signal (AULA to LECTURE on a sine) has no click: the difference's band above 4 kHz peaks at ${db(at).toFixed(0)} dBFS over the 50 ms crossfade and after (${db(before).toFixed(0)} before it)`);
    let moved = 0; for (let i = SR + Math.round(0.06 * SR); i < SR + Math.round(0.2 * SR); i++) moved = Math.max(moved, Math.abs(diff[i]));
    ok(db(moved) > -40, `and the room did change (the difference after the crossfade: ${db(moved).toFixed(0)} dBFS)`);
    // R21: the device check at defaults
    const nc = await checkDeviceNode(d);
    ok(nc.ok && nc.deterministic && !nc.nan && Math.abs(nc.level.deltaLU) <= 3 && nc.truePeak < -1, `the device check at defaults: ${summarize(nc)} (${nc.level.deltaLU} LU against the input, ${nc.truePeak} dBTP${nc.warnings.length ? '; ' + nc.warnings.join('; ') : ''})`);
  }
}

/* ------------------------------------------------------------------ the room switch, timed, and the CPU */
if (bank) {
  console.log('the cost');
  const K = new Function('return ' + rooms.kernel)(), dsp = makeDsp(SR);
  const P = paramValues(rooms, {});
  const inst = K.create({ sr: SR, seed: 1, dsp, params: kernelSpecs(rooms), data: { aachen: bank } });
  const L = new Float32Array(128), R = new Float32Array(128), x = diStrum(2, SR);
  let blk = 0;
  const step = (p) => { for (let i = 0; i < 128; i++) { L[i] = x[(blk * 128 + i) % x.length]; R[i] = L[i]; } blk++; inst.process(L, R, 128, p); };
  for (let i = 0; i < 400; i++) step(P);
  // every room to every other, a few times over, timing the block that takes the change (the plan, the resets and the
  // block) and the blocks of each crossfade. A wall-clock maximum is mostly this machine's scheduling (Stairwell's own
  // worst block here runs to milliseconds when other work is running), so a block's cost is the median of its phase in
  // the convolver's 8-block cycle, counted from the change (the new path starts its cycle there; the body's FFT lands on
  // one phase), and the worst phase is held to 0.5 ms.
  const switchMs = [], fadePh = Array.from({ length: 8 }, () => []), plainPh = Array.from({ length: 8 }, () => []);
  const order = [0, 1, 2, 3, 4, 5, 0, 2, 4, 1, 3, 5, 0, 3, 1, 4, 2, 5, 0, 1, 2, 3, 4, 5, 0, 4, 2, 1, 5, 3, 0];
  const Ps = ROOMS.map((_, r) => ({ ...P, room: r }));
  { let junk = 0; for (let i = 0; i < 256; i++) junk += new Float64Array(1 << 15).length; if (!junk) throw new Error('unreachable'); }
  await new Promise((r) => setTimeout(r, 50));
  let gcs = 0;
  const obs = new PerformanceObserver((list) => { gcs += list.getEntries().length; });
  obs.observe({ entryTypes: ['gc'] });
  for (const r of order) {
    const t0 = performance.now(); step(Ps[r]); switchMs.push(performance.now() - t0);
    for (let i = 0; i < 48; i++) { const ph = (i + 1) % 8, t1 = performance.now(); step(Ps[r]); (i < 18 ? fadePh : plainPh)[ph].push(performance.now() - t1); }
  }
  await new Promise((r) => setTimeout(r, 50));
  obs.disconnect();
  ok(gcs === 0, `${order.length} room changes and their crossfades allocate nothing: no garbage collection (${gcs})`);
  const median = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  const sw = switchMs.slice(1), worstPhase = (ph) => Math.max(...ph.map(median));
  // (Q5: a change's block over 0.5 ms is reported for AJ, not cut by a new planning API)
  T.note(`a room change's block (the room's taps, planning its partitions, resetting the tail, then the block): median ${median(sw).toFixed(3)} ms, worst ${Math.max(...sw).toFixed(3)} ms${median(sw) > 0.5 ? ' (OVER 0.5 ms: reported to AJ, R23/Q5)' : ''}`);
  ok(worstPhase(plainPh) < 0.5 && worstPhase(fadePh) < 0.5, `the heaviest block of the cycle takes ${worstPhase(plainPh).toFixed(3)} ms, ${worstPhase(fadePh).toFixed(3)} ms during a crossfade (two paths) (under 0.5 ms; the quantum is 2.67 ms)`);
  // R36: checkDevice's cpu, Echo Chamber at its heaviest room (AULA, the longest early cut, its default) against
  // Stairwell at its defaults, the median of 5 each, in one process
  const cv = [], cr = [];
  for (let i = 0; i < 5; i++) { cv.push((await checkDeviceNode(verb)).cpu.ms); cr.push((await checkDeviceNode(rooms)).cpu.ms); }
  const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1], ratio = med(cr) / med(cv);
  ok(ratio <= 1.5, `CPU: Echo Chamber (AULA, the heaviest room) ${med(cr)} ms for the device check's 4 s render against Stairwell's ${med(cv)} ms: ${ratio.toFixed(2)}x (at most 1.5x; median of 5)`);
}

/* ------------------------------------------------- the card names the room that plays, whatever ROOM holds */
// The kernel reads ROOM as `P.room | 0`; a label becomes the index only through apply_ops. A song that stores the
// label, a string index or a fraction must not show one room on the card and play another: render the fx:core.rooms
// golden scene with each and hold the card line to the render (same line exactly when the same sound)
if (!bank) T.note("the card against the render: skipped (no aachen bank)");
else {
  const { scenes } = await import('./golden-scenes.js');
  const { renderSong } = await import('../app/src/engine/node/render.js');
  const base = scenes().find((s) => s.name.startsWith('fx:core.rooms#'));
  const sum = (room) => {
    const project = JSON.parse(JSON.stringify(base.project));
    project.tracks[0].inserts[0].params = room === undefined ? {} : { room };
    const ch = renderSong(project, { ...base.opts, assets: base.assets }).channels;
    let x = 0;
    for (const c of ch) for (let i = 0; i < c.length; i++) x = (Math.imul(x, 31) + Math.round(c[i] * 1e7)) | 0;
    return x;
  };
  const vals = [undefined, 0, 4, 'OFFICE', '4', 4.6, 99], got = vals.map((v) => ({ v, sum: sum(v), line: cardLine({ room: v })[0], desc: describeRoom({ room: v }) }));
  const bad = [];
  for (const a of got) for (const b of got) if ((a.sum === b.sum) !== (a.line === b.line && a.desc === b.desc)) bad.push(`${JSON.stringify(a.v)} vs ${JSON.stringify(b.v)}`);
  ok(base && !bad.length && got[1].sum !== got[2].sum,
    `the card and get_project name the room that plays for ROOM ${vals.map((v) => JSON.stringify(v) ?? 'unset').join(', ')}${bad.length ? `: they disagree for ${bad.slice(0, 3).join('; ')}` : ' (a stored label plays AULA and reads AULA)'}`);
}

/* ------------------------------------------------------------------ the studio: the card, its words and the face */
console.log('the studio');
if (process.env.ROOMS_BROWSER === '0') T.note('the studio: skipped (ROOMS_BROWSER=0)');
else {
  const hex = ROOMS_HASH.slice(7);
  // the card line in Node first: R26's sentence, every number from ROOM_INFO (the header's)
  const want = ROOM_INFO.map((r) => `${r.name}, ${r.place}: ${r.what}, ${+r.distance.toFixed(1)} m from the source. ${+r.t30[1].toFixed(1)} s at 1 kHz.`);
  ok(ROOM_INFO.every((r, i) => cardLine({ room: i }).join('|') === want[i] + '|' + ROOMS_CREDIT) && cardLine({ room: '3' })[0] === want[3]
    && cardLine({})[0] === 'Aula Carolina, Aachen: a former church, 3 m from the source. 3.2 s at 1 kHz.',
  `the card line follows ROOM, from the header ("${cardLine({})[0]}"), then the credit, unsigned`);
  ok(describeRoom({}) === 'Aula Carolina (a former church, 3 m), pre 0 ms, decay ×1.0, mix 0.22', `describe at defaults: "${describeRoom({})}"`);
  ok(rooms.look && rooms.look.shape === 'wide' && rooms.look.finish === 'hammer' && rooms.look.knob === 'cream' && rooms.look.label === 'plate'
    && rooms.look.color === '#cfc6b3' && rooms.look.ink === '#1d1a16' && rooms.look.led === '#ffb347', 'the face: wide, hammer, cream knobs, a plate, #cfc6b3 with #1d1a16 ink and a #ffb347 lamp (R25)');
  for (const mode of ['slow', 'missing']) {
    const o = await open('/app/', { query: 'new' });
    try {
      let release = null;
      const held = new Promise((r) => { release = r; });
      await o.page.route(`**/kits/${hex}.*`, async (route) => {
        if (mode === 'missing') return route.fulfill({ status: 404, body: 'not found' });
        await held;
        return route.continue();
      });
      await o.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
      const tid = await o.page.evaluate(async () => {
        const a = window.overdub;
        await a.engine.start();   // (the bank is asked for when the engine builds the insert)
        const r = a.store.dispatch({ type: 'track.add', track: { kind: 'instrument', name: 'Vox', instrument: { device: 'core.bass', params: {} } } }, { by: 'you' });
        const id = r.created.track;
        a.ui.select({ track: id, insert: null });
        a.ui.show('rack');
        return id;
      });
      if (mode === 'slow') {
        const chips = await o.page.waitForFunction(() => { const x = document.querySelector('.rk-hint'); return x && [...x.querySelectorAll('.rk-chip')].map((b) => b.textContent.trim()); }, null, { timeout: 10000 }).then((h) => h.jsonValue(), () => []);
        ok(chips[0] === 'Reverb' && chips[1] === 'Real room', `an empty chain offers ${chips.join(', ')}: Real room after Reverb (R28)`);
        await o.page.evaluate(() => [...document.querySelectorAll('.rk-hint .rk-chip')].find((b) => b.textContent.trim() === 'Real room').click());
      } else {
        await o.page.evaluate((id) => window.overdub.store.dispatch({ type: 'insert.add', track: id, insert: { device: 'core.rooms' } }, { by: 'you' }), tid);
      }
      const say = mode === 'slow' ? ROOMS_SAYS.loading : ROOMS_SAYS.missing;
      const saw = await o.page.waitForFunction((t) => [...document.querySelectorAll('.rk-card[data-device="core.rooms"] .rk-data')].some((el) => !el.hidden && el.textContent === t[0] && el.title === t[1]), say, { timeout: 10000 }).then(() => true, () => false);
      await o.shot('rooms-card-' + mode);
      ok(saw, `${mode === 'slow' ? 'while the bank loads' : 'with the bank missing'}, the card says "${say[0]}" beside the name ("${say[1]}") (R27)`);
      if (mode === 'slow') {
        release();
        const gone = await o.page.waitForFunction(() => [...document.querySelectorAll('.rk-card[data-device="core.rooms"] .rk-data')].every((el) => el.hidden), null, { timeout: 20000 }).then(() => true, () => false);
        const read = () => o.page.evaluate(() => {
          const c = document.querySelector('.rk-card[data-device="core.rooms"]'), f = c?.querySelector('.rk-face'), l = c?.querySelector('.rk-line');
          const cr = c?.getBoundingClientRect(), lr = l?.getBoundingClientRect(), fr = f?.getBoundingClientRect();
          return { lines: l ? [...l.children].map((x) => x.textContent) : [], face: !!f?.firstElementChild, wider: lr && fr ? Math.round(lr.width - cr.width) : null };
        });
        const r0 = await read();
        await o.page.evaluate((id) => { const a = window.overdub, t = a.store.track(id), fx = t.inserts.find((x) => x.device === 'core.rooms'); a.store.dispatch({ type: 'insert.set', track: id, insert: fx.id, patch: { params: { room: 2 } } }, { by: 'you' }); }, tid);
        const r2 = await o.page.waitForFunction((w) => { const l = document.querySelector('.rk-card[data-device="core.rooms"] .rk-line'); return l && l.firstElementChild?.textContent === w; }, want[2], { timeout: 5000 }).then(() => read(), () => read());
        await o.shot('rooms-card');
        ok(gone && r0.face && r0.lines[0] === want[0] && r0.lines[1] === ROOMS_CREDIT && r0.wider != null && r0.wider <= 0,
          `once the bank is in, the card draws its face, the room line and the credit, inside the card's width: "${r0.lines.join(' / ')}" (R26)`);
        ok(r2.lines[0] === want[2], `the line follows ROOM: 2 (LECTURE) gives "${r2.lines[0]}"`);
      }
      const errs = o.errors.filter((e) => !/404|Failed to load resource/.test(e));
      ok(!errs.length, `${mode}: no page errors${errs.length ? ' (' + errs.slice(0, 2).join(' | ') + ')' : ''}`);
    } finally { await o.close(); }
  }
}

T.done();
