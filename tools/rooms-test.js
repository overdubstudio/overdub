// Echo Chamber (core.rooms, intent 0006 "Real Rooms"): the room tail and the series it is built from. The device, its
// bank and its fit join this suite as they land.
//
//   the series   series.js's dsin is convolve.js's, double for double; dexp is within 1e-15 of Math.exp; SERIES and
//                ROOM_TAIL are the functions' own text, and that text, run as a kernel would, gives the same samples
//                as the imported functions
//   the grep     ROOM_TAIL calls no Math.exp, pow, sin, cos, tan or log (R22)
//   the tail     an impulse through roomTail alone decays at each band's set T60 within 5% (R8, R10): the low band at
//                63 Hz, the mid at 1.4 kHz and the high at 16 kHz, with DECAY and DAMP applied as R10 says; nothing
//                allocates in process()
//   the zip     tools/kits/zip.js's ranged reader against a local server: members by Range, checked and cached by
//                their SHA-256, then read again offline; a server that ignores Range gets the whole zip, checked
//                against its own SHA-256; a member that isn't its pin is refused
//   node tools/rooms-test.js
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { PerformanceObserver } from 'node:perf_hooks';
import { tally } from './pw.js';
import { dsin as convolveSin, fft } from '../app/src/kernel/convolve.js';
import { dsin, dcos, dexp, SERIES } from '../app/src/devices/builtin/series.js';
import { roomTail, roomSvfSet, roomPole, roomGlide, ROOM_TAIL } from '../app/src/devices/builtin/rooms-lib.js';
import { openZipRanged } from './kits/zip.js';

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

T.done();
