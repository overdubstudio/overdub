// @ts-check
// core.rooms: Echo Chamber (intent 0006, "Real Rooms"). Measured rooms: each plays the first 80-200 ms of a real
// space's impulse response (its early reflections, as recorded), then hands off to a tail fitted to that room's
// measured decay (rooms-lib.js, roomTail), so a church rings for its seconds without seconds of convolution. The rooms
// are kernel data, the `aachen` bank (tools/kits/air-rooms.js: six rooms from the Aachen Impulse Response Database,
// RWTH Aachen University, MIT). Without the bank (while it loads, or on a server without it) the input passes as it is.
//
// The flow: L + R summed to mono; PRE (a glided, linearly interpolated delay); then two branches from that one
// signal: the room's early IR through dsp.convolver (stereo taps, the ears; 128 frames late, which sits inside PRE and
// the room's own gap, so the device declares no latency and the dry path is exact), and the tail, its input D frames
// late (D includes those 128). The tail has its own EQ and gain (the fit); DAMP's one-pole low-pass (20 kHz at 0, 6
// kHz at 1) darkens the early part, and shortens the tail's top inside roomTail. Then each room's level (set by the
// build so that every room's wet signal has the DI strum's RMS), the low cut (an SVF high-pass), WIDTH as mid/side and
// MIX at equal power (Stairwell's law).
//
// Changing ROOM: the second wet path (a convolver and a tail, both allocated in create() at the bank's longest room)
// takes the new room, then the old one crossfades to it over 50 ms at equal power. A change during a crossfade waits
// for it to end. A render starts at its room, with no crossfade. Nothing allocates in process(): every number the
// kernel keeps between blocks is in a typed array.
//
// The same numbers on every engine: every coefficient comes from + - * /, Math.sqrt and the series (series.js: dsin,
// dcos, dexp), never Math.exp, pow, sin, cos, tan or log (tools/rooms-test.js greps the body: lib.js's LIB, which
// kernel() puts first, isn't used). With integers in, the output is the same doubles in Node and in every browser.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';
import { ROOM_TAIL, ROOMS, ROOM_LABELS, ROOMS_HASH, ROOMS_SAYS, ROOM_INFO, ROOMS_CREDIT } from './rooms-lib.js';

// The kernel's own text, after LIB: what tools/rooms-test.js greps (R22)
export const ROOMS_BODY = String.raw`
${ROOM_TAIL}
// the ROOM switch: [label, bank, the room's id in it] (rooms-lib.js ROOMS: append-only)
const ROOMS = ${JSON.stringify(ROOMS)};
return {
  create({ sr, dsp, data }) {
    const bank = data && data.aachen;
    const rate = bank && bank.samples && bank.sr > 0 ? bank.sr : 0;
    // no bank (it's loading, or isn't on this server): the input passes as it is
    if (!rate) return { process() {} };
    const NR = ROOMS.length, k = sr / rate, LN10 = 2.302585092994046;
    const dbl = (db) => dexp(db * LN10 / 20);
    // each room the bank has: its entry, its length at this rate, its fit (D at this rate). A room whose entry is
    // missing, or whose tail model this kernel doesn't know, plays dry.
    const rooms = [];
    let cap = 128;
    for (let r = 0; r < NR; r++) {
      let s = null;
      for (let j = 0; j < bank.samples.length; j++) if (bank.samples[j].id === ROOMS[r][2]) { s = bank.samples[j]; break; }
      const f = s && s.fit;
      if (!s || !f || f.model !== 'tail/1' || !s.ch || s.ch.length < 2 || !(s.frames > 0)) { rooms.push(null); continue; }
      const frames = rate === sr ? s.frames : Math.ceil(s.frames * k);
      rooms.push({ s, frames, gain: dbl(+s.gain || 0) / 32768, level: dbl(+s.level || 0),
        fit: { scale: +f.scale, t60: [+f.t60[0], +f.t60[1], +f.t60[2]], eq: [+f.eq[0], +f.eq[1], +f.eq[2]], g: +f.g, D: +f.D * k } });
      if (frames > cap) cap = frames;
    }
    // the two wet paths: taps (with a view per room, so a room plans only its own length), a convolver, a tail, and
    // the early part's low-pass state
    const path = () => {
      const tl = new Float64Array(cap), tr = new Float64Array(cap);
      return { tl, tr, views: rooms.map((r) => (r ? [tl.subarray(0, r.frames), tr.subarray(0, r.frames)] : null)),
        conv: dsp.convolver([tl, tr]), tail: roomTail(sr), room: -1, ok: false,
        eL: new Float64Array(128), eR: new Float64Array(128), tL: new Float64Array(128), tR: new Float64Array(128), st: new Float64Array(3) };
    };
    const paths = [path(), path()];
    // a room into a path: its taps (x / 32768 * its gain; at another host rate, resampled linearly), planned; the tail
    // set to its fit; silence in both. st: the low-pass state, left and right, and the room's level.
    const load = (p, r, decay, damp) => {
      const R = rooms[r];
      p.room = r; p.ok = !!R;
      p.st[0] = 0; p.st[1] = 0; p.st[2] = 0;
      if (!R) return;
      const a = R.s.ch[0], b = R.s.ch[1], g = R.gain, n = R.s.frames;
      if (rate === sr) for (let i = 0; i < R.frames; i++) { p.tl[i] = a[i] * g; p.tr[i] = b[i] * g; }
      else {
        const st = rate / sr, gs = g * st;
        for (let i = 0; i < R.frames; i++) {
          const x = i * st, q = Math.floor(x), f = x - q, a0 = q < n ? a[q] : 0, a1 = q + 1 < n ? a[q + 1] : 0, b0 = q < n ? b[q] : 0, b1 = q + 1 < n ? b[q + 1] : 0;
          p.tl[i] = (a0 + (a1 - a0) * f) * gs; p.tr[i] = (b0 + (b1 - b0) * f) * gs;
        }
      }
      p.conv.reset(); p.conv.set(p.views[r]);
      p.tail.reset(); p.tail.set(R.fit, decay, damp);
      p.st[2] = R.level;
    };
    const run = (p, x, m) => {
      if (!p.ok) { for (let i = 0; i < m; i++) { p.eL[i] = 0; p.eR[i] = 0; p.tL[i] = 0; p.tR[i] = 0; } return; }
      p.conv.process(x, p.eL, p.eR, m);
      p.tail.process(x, p.tL, p.tR, m);
    };
    // PRE: a ring of 200 ms and a bit
    let PN = 1; while (PN < Math.ceil(0.21 * sr) + 4) PN <<= 1;
    const PM = PN - 1, pre = new Float64Array(PN), xb = new Float64Array(128);
    const FADE = Math.round(0.05 * sr), HALF_PI = Math.PI / 2, LN_03 = -1.2039728043259361; // ln 0.3: 20 kHz to 6 kHz
    const pA = roomGlide(60, sr), wA = roomGlide(30, sr), mA = roomGlide(30, sr);
    // the low cut's coefficients (roomSvfSet: k, a1, a2, a3, ...) and every running number: S[0..3] the low cut's
    // state (left ic1 ic2, right ic1 ic2), 4 the pre-delay's glide, 5 width's, 6 mix's, 7 the early low-pass's
    // coefficient, 8 dry, 9 wet, 10 the mix they were worked out for
    const hc = new Float64Array(7), S = new Float64Array(11);
    const I = new Int32Array(4); // 0 started, 1 the playing path, 2 frames left in the crossfade, 3 the pre ring's write head
    // (the last values seen: doubles, kept in the closure, written only when a knob moves)
    let lastDecay = NaN, lastDamp = NaN, lastCut = NaN, poleDamp = NaN;
    return {
      process(L, R, n, P) {
        let room = P.room | 0;
        room = room < 0 ? 0 : room >= NR ? NR - 1 : room;
        const decay = P.decay, damp = P.damp < 0 ? 0 : P.damp > 1 ? 1 : P.damp;
        if (!I[0]) {
          I[0] = 1; lastDecay = decay; lastDamp = damp;
          load(paths[0], room, decay, damp); I[1] = 0;
          S[4] = P.predelay * sr / 1000; S[5] = P.width; S[6] = P.mix; S[10] = NaN;
        } else {
          if (decay !== lastDecay || damp !== lastDamp) {
            lastDecay = decay; lastDamp = damp;
            for (let j = 0; j < 2; j++) { const p = paths[j]; if (p.ok) p.tail.set(rooms[p.room].fit, decay, damp); }
          }
          if (I[2] === 0 && room !== paths[I[1]].room) { const nx = 1 - I[1]; load(paths[nx], room, decay, damp); I[1] = nx; I[2] = FADE; }
        }
        if (damp !== poleDamp) { poleDamp = damp; S[7] = roomPole(sr, 20000 * dexp(damp * LN_03)); }
        if (P.lowcut !== lastCut) { lastCut = P.lowcut; roomSvfSet(sr, 0, P.lowcut, 0.6, 0, hc, 0); }
        const preT = P.predelay * sr / 1000, widT = P.width, mixT = P.mix;
        const hk = hc[0], h1 = hc[1], h2 = hc[2], h3 = hc[3], dA = S[7];
        for (let o = 0; o < n; o += 128) {
          const m = n - o < 128 ? n - o : 128;
          // mono, then PRE
          let pY = S[4], pw = I[3];
          for (let i = 0; i < m; i++) {
            const v = (L[o + i] + R[o + i]) * 0.5;
            pY = preT + (pY - preT) * pA;
            let y = v;
            if (pY > 1) { const r = pw - pY, q = Math.floor(r), f = r - q, a = pre[q & PM]; y = a + (pre[(q + 1) & PM] - a) * f; }
            pre[pw] = v; pw = (pw + 1) & PM;
            xb[i] = y;
          }
          S[4] = pY; I[3] = pw;
          // the wet paths: the playing one, and the one fading out
          const a = paths[I[1]], b = paths[1 - I[1]], fading = I[2] > 0;
          run(a, xb, m);
          if (fading) run(b, xb, m);
          let l1 = S[0], l2 = S[1], r1 = S[2], r2 = S[3], wY = S[5], mY = S[6], dry = S[8], wet = S[9], lastMx = S[10];
          let ae0 = a.st[0], ae1 = a.st[1], be0 = b.st[0], be1 = b.st[1], fd = I[2];
          const ga = a.st[2], gb = b.st[2];
          for (let i = 0; i < m; i++) {
            ae0 = a.eL[i] + (ae0 - a.eL[i]) * dA; ae1 = a.eR[i] + (ae1 - a.eR[i]) * dA;
            let wl = (ae0 + a.tL[i]) * ga, wr = (ae1 + a.tR[i]) * ga;
            if (fading) {
              be0 = b.eL[i] + (be0 - b.eL[i]) * dA; be1 = b.eR[i] + (be1 - b.eR[i]) * dA;
              const u = fd > 0 ? (FADE - fd) / FADE : 1, gi = dsin(u * HALF_PI), go = dcos(u * HALF_PI);
              if (fd > 0) fd--;
              wl = wl * gi + (be0 + b.tL[i]) * gb * go; wr = wr * gi + (be1 + b.tR[i]) * gb * go;
            }
            // the low cut (the SVF's high-pass)
            let v3 = wl - l2, v1 = h1 * l1 + h2 * v3, v2 = l2 + h2 * l1 + h3 * v3;
            l1 = 2 * v1 - l1; l2 = 2 * v2 - l2;
            wl = wl - hk * v1 - v2;
            v3 = wr - r2; v1 = h1 * r1 + h2 * v3; v2 = r2 + h2 * r1 + h3 * v3;
            r1 = 2 * v1 - r1; r2 = 2 * v2 - r2;
            wr = wr - hk * v1 - v2;
            // WIDTH, then MIX
            wY = widT + (wY - widT) * wA;
            const mid = 0.5 * (wl + wr), side = 0.5 * (wl - wr) * wY;
            mY = mixT + (mY - mixT) * mA;
            if (mY !== lastMx) { lastMx = mY; dry = dcos(mY * HALF_PI); wet = dsin(mY * HALF_PI); }
            // (an output under 1e-30, -600 dB, is 0: as the tail dies float32 would hold it as a denormal, which
            // Chromium's audio thread flushes to zero and Node keeps. Here, not in the tail's lines: 8 tests a sample
            // there cost 18% of the device in Node, and a line's denormal reaches only an output this flushes)
            const yl = L[o + i] * dry + (mid + side) * wet, yr = R[o + i] * dry + (mid - side) * wet;
            L[o + i] = yl > 1e-30 || yl < -1e-30 ? yl : 0;
            R[o + i] = yr > 1e-30 || yr < -1e-30 ? yr : 0;
          }
          S[0] = l1; S[1] = l2; S[2] = r1; S[3] = r2; S[5] = wY; S[6] = mY; S[8] = dry; S[9] = wet; S[10] = lastMx;
          a.st[0] = ae0; a.st[1] = ae1; b.st[0] = be0; b.st[1] = be1; I[2] = fd;
        }
      },
    };
  },
};
`;

/* ------------------------------------------------------------------------------------- what it says about a room */
// Every number here is the bank header's (ROOM_INFO, pinned beside ROOMS_HASH and held to the header by rooms-test)
const one = (x) => +(+x).toFixed(1);
// a stored ROOM is its index, read the way the kernel host reads a switch (worklet.js fit: a number, else the
// default; clamped; rounded), so the card and get_project name the room that plays. A label ("LECTURE") becomes the
// index only at the agent's door (apply_ops, tools.js switchNumber); a song that stores one as text plays AULA, the
// default, so it reads as AULA here too
export function roomOf(params = {}) {
  const n = ROOM_INFO.length - 1, v = params.room == null ? 0 : +params.room;
  const i = !Number.isFinite(v) ? 0 : Math.round(v < 0 ? 0 : v > n ? n : v);
  return ROOM_INFO[i];
}
// The card's room line, then the credit: "Aula Carolina, Aachen: a former church, 3 m from the source. 3.2 s at 1 kHz."
export function cardLine(params = {}) {
  const r = roomOf(params);
  return [`${r.name}, ${r.place}: ${r.what}, ${one(r.distance)} m from the source. ${one(r.t30[1])} s at 1 kHz.`, ROOMS_CREDIT];
}
// get_project's one line: "Aula Carolina (a former church, 3 m), pre 0 ms, decay ×1.0, mix 0.22"
export function describe(params = {}) {
  const r = roomOf(params), n = (k, d) => (Number.isFinite(Number(params[k])) ? Number(params[k]) : d);
  return `${r.name} (${r.what}, ${one(r.distance)} m), pre ${Math.round(n('predelay', 0))} ms, decay ×${n('decay', 1).toFixed(2).replace(/0$/, '')}, mix ${+n('mix', 0.22).toFixed(2)}`;
}
// get_device { library: '' }: the rooms, each with what the header says of it and the params that pick it
export const LIBRARY = {
  about: `${ROOM_INFO.length} rooms measured by RWTH Aachen University (the Aachen Impulse Response Database, AIR 1.4, MIT): `
    + 'each is its first reflections as recorded, then a tail fitted to its measured decay. T30 in seconds at 500 Hz, 1 kHz and 2 kHz, EDT at 1 kHz, the early cut (tx) in seconds',
  groups: [{ name: 'Aachen', table: 'AIR 1.4', count: ROOM_INFO.length }],
  items: ROOM_INFO.map((r) => ({
    label: r.label, id: r.id, name: r.name, group: 'Aachen', place: r.place, what: r.what,
    distance: r.distance, t30: { '500': r.t30[0], '1k': r.t30[1], '2k': r.t30[2] }, edt: r.edt, tx: r.tx, credit: ROOMS_CREDIT, params: { room: r.label },
  })),
};

export default defineDevice({
  id: 'core.rooms', name: 'Echo Chamber', kind: 'effect', cat: 'ambient', by: 'overdub',
  blurb: 'Real rooms, measured: a church down to an office',
  // (the plate's kind and the nod are also the words Find and list_devices know it by, R28: reverb, room, church,
  // hall, convolution; "ROOM REVERB" puts it among the first rooms Find shows for "room")
  kindLabel: 'ROOM REVERB',
  nod: 'a convolution reverb loaded with measured rooms, from a church hall to an office',
  look: { shape: 'wide', finish: 'hammer', knob: 'cream', label: 'plate', color: '#cfc6b3', ink: '#1d1a16', led: '#ffb347' },
  params: [
    { key: 'room', label: 'ROOM', opts: ROOM_LABELS, def: 0, auto: false, desc: 'which space: a church, a lecture room, stairs, an office' },
    { key: 'predelay', label: 'PRE', min: 0, max: 200, def: 0, unit: 'ms', role: 'time', desc: 'a gap before the room answers, on top of its own' },
    { key: 'decay', label: 'DECAY', min: 0.5, max: 2, def: 1, curve: 'log', unit: 'x', role: 'decay', desc: 'the tail against the room\'s own: 1 is as measured' },
    { key: 'damp', label: 'DAMP', min: 0, max: 1, def: 0, role: 'tone', desc: 'as measured (0) to a darker, shorter top (1)' },
    { key: 'lowcut', label: 'LOW CUT', min: 20, max: 1000, def: 120, curve: 'log', unit: 'Hz', role: 'tone', desc: 'keeps the room out of the bass' },
    { key: 'width', label: 'WIDTH', min: 0, max: 1, def: 1, role: 'width', desc: 'mono to as measured' },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 0.22, role: 'mix', desc: 'dry to all room' },
  ],
  data: { aachen: ROOMS_HASH }, dataSays: ROOMS_SAYS,
  trails: true, tail: 12,
  library: LIBRARY, describe, cardLine,
  kernel: kernel(ROOMS_BODY),
});
