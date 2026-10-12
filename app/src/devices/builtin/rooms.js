// @ts-check
// core.rooms: Echo Chamber (intent 0006, "Real Rooms"). Measured rooms: each plays its real impulse response for as
// long as the room was measured above its noise (a small room) or for its first seconds (the church, whose decay runs
// past ten), then hands off to a tail fitted to that room's measured decay (rooms-lib.js, roomTail), far below where
// the measurement can be heard against it. The rooms are kernel data, the `aachen` bank (tools/kits/air-rooms.js: six
// rooms from the Aachen Impulse Response Database, RWTH Aachen University, MIT). Without the bank (while it loads, or on
// a server without it) the input passes as it is.
//
// The flow: L + R summed to mono; PRE (a glided, linearly interpolated delay); then three branches from that one signal:
// the room's first 8192 taps through dsp.convolver (stereo taps, the ears; 128 frames late, which sits inside PRE and
// the room's own gap, so the device declares no latency and the dry path is exact), the rest of its taps through
// roomLate (4096-frame partitions, the work spread across each block's quanta, landing in step with the first), and the
// tail, its input D frames late (D includes those 128). The tail has its own EQ and gain (the fit); DAMP's one-pole
// low-pass (20 kHz at 0, 6 kHz at 1) darkens the measured part, and shortens the tail's top inside roomTail. Then each
// room's level (set by the build so that every room's wet signal has the DI strum's RMS), the low cut (an SVF
// high-pass), WIDTH as mid/side and MIX at equal power (Stairwell's law).
//
// DECAY: at 1 the room as measured. Otherwise roomGen splits the measured taps in three bands and bends each band's
// decay to its measured T30 times DECAY (the tail's T60s are scaled the same way, and lifted to where the bent room
// hands it over), so a new DECAY is a new set of taps: it is planned like a new room.
//
// Changing ROOM or DECAY, live: the second wet path (a convolver, a late part and a tail, all allocated in create() for
// the bank's longest room) takes the new room or DECAY: its first taps are planned in the change's quantum, the late
// partitions one a quantum after it (each long before the input reaches it). The input then moves from the old path to
// the new over 50 ms (a linear crossfade of the input, so the two add up to it exactly), and the old path rings out
// what it was given, in the room it was given it, then fades away (50 ms) and goes quiet. A change that comes while
// the other path still rings fades that path first; one that comes during a handoff waits for it to end. A render
// starts at its room, with no handoff. Nothing allocates in process(): every number the kernel keeps between quanta is
// in a typed array, and the work is done on the quanta of the device's own clock, whatever frames the host passes.
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
  create({ sr, dsp, data, params }) {
    const bank = data && data.aachen;
    const rate = bank && bank.samples && bank.sr > 0 ? bank.sr : 0;
    // no bank (it's loading, or isn't on this server): the input passes as it is
    if (!rate) return { process() {} };
    // (the taps are x / 2^(bits - 1) * 10^(gain / 20): a 24-bit bank's x are Int32Array, a 16-bit one's Int16Array)
    const NR = ROOMS.length, k = sr / rate, LN10 = 2.302585092994046, FULL = bank.bits === 24 ? 8388608 : 32768;
    const dbl = (db) => dexp(db * LN10 / 20);
    // B: the late part's block; E: the taps dsp.convolver plays (its 128-frame head and one level of 1024-frame blocks)
    const B = 4096, E = 2 * B;
    // each room the bank has: its entry, its length at this rate, its fit (D at this rate), its T30 at 125 Hz to 8 kHz
    // (DECAY's envelope) and its early cut in seconds. A room whose entry is missing, or whose tail model this kernel
    // doesn't know, plays dry. (A T30 the header lacks: its T20, else 1 s.)
    const OCT = [125, 250, 500, 1000, 2000, 4000, 8000];
    const t30 = (s, f) => {
      const m = s.measured, i = m && m.octaves ? m.octaves.indexOf(f) : -1;
      const v = i < 0 ? 0 : +(m.t30[i] || m.t20[i] || 0);
      return v > 0.05 ? v : 1;
    };
    const rooms = [];
    let cap = 128, maxD = Math.ceil(0.25 * sr);
    for (let r = 0; r < NR; r++) {
      let s = null;
      for (let j = 0; j < bank.samples.length; j++) if (bank.samples[j].id === ROOMS[r][2]) { s = bank.samples[j]; break; }
      const f = s && s.fit;
      if (!s || !f || f.model !== 'tail/1' || !s.ch || s.ch.length < 2 || !(s.frames > 0)) { rooms.push(null); continue; }
      const frames = rate === sr ? s.frames : Math.ceil(s.frames * k);
      rooms.push({ s, frames, gain: dbl(+s.gain || 0) / FULL, level: dbl(+s.level || 0), tx: +s.tx || frames / sr,
        T: Float64Array.from(OCT, (o) => t30(s, o)),
        fit: { scale: +f.scale, t60: [+f.t60[0], +f.t60[1], +f.t60[2]], eq: [+f.eq[0], +f.eq[1], +f.eq[2]], g: +f.g, D: +f.D * k },
        over: f.over && f.over.length === 3 ? Float64Array.from(f.over, (v) => +v || 0) : null });
      // (the tail's bands bend by the room's T30 at 125 Hz (capped at 1.5 times 500 Hz's, as the fit's low band is),
      // 1 kHz and 8 kHz)
      const Rm = rooms[rooms.length - 1];
      Rm.tref = Float64Array.of(Rm.T[0] < 1.5 * Rm.T[2] ? Rm.T[0] : 1.5 * Rm.T[2], Rm.T[3], Rm.T[6]);
      if (frames > cap) cap = frames;
      if (Math.ceil(f.D * k) + 4 > maxD) maxD = Math.ceil(f.D * k) + 4;
    }
    const maxP = cap > E ? Math.ceil((cap - E) / B) : 0;
    const F = dsp.fft(2 * B), F1 = dsp.fft(1024), frame = new Float64Array(2 * B);
    // (the first taps are made and planned over the quanta before a change's handoff: C taps of an ear a quantum, then
    // the convolver's plan)
    const C = 2048;
    // the two wet paths, each: the first taps (a view per room, so a room plans only its own length) and their
    // convolver, the late part, the taps' generator, the tail, a quantum's buffers. st: 0 and 1 the measured part's
    // low-pass state (left, right), 2 the room's level, 3 its DECAY, 4 its T60 at 1 kHz for the ring-out; lift: the
    // tail's (roomGen.lift). M: 0 the mode (0 quiet, 1 taking input, 2 ringing out, 3 fading away, 4 being prepared),
    // 1 the room, 2 the next plan step, 3 the plan's steps, 4 the frames the convolvers still have to give, 5 the frames
    // left to ring, 6 left to fade, 7 the room is there, 8 the next preparing step, 9 the preparing steps
    const path = () => {
      const el = new Float64Array(E), er = new Float64Array(E);
      return { el, er, views: rooms.map((r) => (r ? [el.subarray(0, r.frames < E ? r.frames : E), er.subarray(0, r.frames < E ? r.frames : E)] : null)),
        conv: dsp.convolver([el, er]), late: roomLate(F, B, maxP, E), gen: roomGen(sr, F1), tail: roomTail(sr, { maxD }),
        x: new Float64Array(128), eL: new Float64Array(128), eR: new Float64Array(128), tL: new Float64Array(128), tR: new Float64Array(128),
        st: new Float64Array(5), lift: new Float64Array(4), M: new Int32Array(10) };
    };
    const paths = [path(), path()];
    // a room at a DECAY into a path: the generator started, the late part emptied, the tail set to its fit (lifted
    // where the bent room hands it over) and silent; then its preparing steps (prep(), one a quantum): its first taps,
    // C of an ear a step, and the convolver's plan of them. After them the late part's plan (plan(), a partition's ear
    // a quantum, long before the input reaches each one).
    const begin = (p, r, decay, damp) => {
      const R = rooms[r], M = p.M;
      M[1] = r; M[2] = 0; M[3] = 0; M[7] = R ? 1 : 0; M[8] = 0;
      p.st[0] = 0; p.st[1] = 0; p.st[3] = decay;
      if (!R) { M[9] = 0; return; }
      genStart(p.gen, R.s.ch[0], R.s.ch[1], R.s.frames, R.gain, rate / sr, R.T, decay);
      const lp = R.frames > E ? Math.ceil((R.frames - E) / B) : 0;
      lateBegin(p.late, R.frames - E); M[3] = 2 * (lp < maxP ? lp : maxP);
      genLift(p.gen, R.tx, R.over, p.lift);
      p.tail.reset(); p.tail.set(R.fit, decay, damp, p.lift, R.tref);
      p.st[2] = R.level; p.st[4] = R.fit.t60[1];
      M[9] = 2 * Math.ceil((R.frames < E ? R.frames : E) / C) + 1;
    };
    const prep = (p) => {
      const M = p.M, j = M[8], R = rooms[M[1]], n = R.frames < E ? R.frames : E, h = M[9] >> 1;
      if (j < M[9] - 1) {
        const c = j < h ? 0 : 1, a = (c ? j - h : j) * C, m = n - a < C ? n - a : C;
        genFill(p.gen, c, c ? p.er : p.el, a, m);
      } else { p.conv.reset(); p.conv.set(p.views[M[1]]); }
      M[8] = j + 1;
    };
    // one step of a path's late plan: the next partition's ear, made from its generator (each ear in order) and
    // transformed
    const planStep = (p) => {
      const M = p.M, j = M[2], c = j & 1;
      genFill(p.gen, c, frame, 0, B);
      for (let i = B; i < 2 * B; i++) frame[i] = 0;
      latePlan(p.late, c, j >> 1, frame);
      M[2] = j + 1;
    };
    // a path's quantum: its input (x, already weighted) through the convolvers (while they still have something to
    // give) and the tail
    const run = (p, m) => {
      const M = p.M;
      if (!M[7]) { for (let i = 0; i < m; i++) { p.eL[i] = 0; p.eR[i] = 0; p.tL[i] = 0; p.tR[i] = 0; } return; }
      if (M[0] === 1 || M[4] > 0) {
        p.conv.process(p.x, p.eL, p.eR, m);
        lateProcess(p.late, p.x, p.eL, p.eR, m);
        if (M[0] !== 1) M[4] = M[4] > m ? M[4] - m : 0;
      } else for (let i = 0; i < m; i++) { p.eL[i] = 0; p.eR[i] = 0; }
      p.tail.process(p.x, p.tL, p.tR, m);
    };
    // a path stops taking input: the convolvers give out after its length and the late part's two blocks; the tail
    // after its delay and its own 60 dB (at its DECAY), at most 12 s, the device's tail
    const ringOut = (p) => {
      const R = rooms[p.M[1]], M = p.M;
      M[0] = 2;
      if (!R) { M[4] = 0; M[5] = 0; return; }
      M[4] = R.frames + 2 * B + 256;
      const t = R.fit.D + p.st[4] * p.st[3] * sr, n = t > M[4] ? t : M[4];
      M[5] = n < 12 * sr ? Math.ceil(n) : 12 * sr;
    };
    // PRE: a ring of 200 ms and a bit
    let PN = 1; while (PN < Math.ceil(0.21 * sr) + 4) PN <<= 1;
    const PM = PN - 1, pre = new Float64Array(PN), xb = new Float64Array(128);
    const FADE = Math.round(0.05 * sr), HALF_PI = Math.PI / 2, LN_03 = -1.2039728043259361; // ln 0.3: 20 kHz to 6 kHz
    const pA = roomGlide(60, sr), wA = roomGlide(30, sr), mA = roomGlide(30, sr);
    // the low cut's coefficients (roomSvfSet: k, a1, a2, a3, ...) and every running number: S[0..3] the low cut's
    // state (left ic1 ic2, right ic1 ic2), 4 the pre-delay's glide, 5 width's, 6 mix's, 7 the measured part's low-pass
    // coefficient, 8 dry, 9 wet, 10 the mix they were worked out for, 11 the device's clock (frames)
    const hc = new Float64Array(7), S = new Float64Array(12);
    // 0 started, 1 the path taking input, 2 frames left in the input's handoff, 3 the pre ring's write head
    const I = new Int32Array(4);
    // (the last values seen: doubles, kept in the closure, written only when a knob moves)
    let lastDamp = NaN, lastCut = NaN, poleDamp = NaN;
    // the quantum's decisions, on the device's clock: a change of room or DECAY, DAMP, one plan step
    const quantum = (P) => {
      let room = P.room | 0;
      room = room < 0 ? 0 : room >= NR ? NR - 1 : room;
      const decay = P.decay > 0 ? P.decay : 1, damp = P.damp < 0 ? 0 : P.damp > 1 ? 1 : P.damp;
      if (!I[0]) {
        // (a render starts at its room: prepared here, all at once)
        I[0] = 1; lastDamp = damp;
        const p = paths[0];
        begin(p, room, decay, damp);
        while (p.M[8] < p.M[9]) prep(p);
        p.M[0] = 1; I[1] = 0;
        S[4] = P.predelay * sr / 1000; S[5] = P.width; S[6] = P.mix; S[10] = NaN;
        return;
      }
      if (damp !== lastDamp) {
        lastDamp = damp;
        for (let j = 0; j < 2; j++) { const p = paths[j]; if (p.M[0] && p.M[7]) { const R = rooms[p.M[1]]; p.tail.set(R.fit, p.st[3], damp, p.lift, R.tref); } }
      }
      const a = paths[I[1]], b = paths[1 - I[1]];
      // a path being prepared takes this quantum's step; when it's ready, the input moves to it
      if (b.M[0] === 4) {
        prep(b);
        if (b.M[8] >= b.M[9]) { b.M[0] = 1; I[1] = 1 - I[1]; I[2] = FADE; }
        return;
      }
      if (I[2] === 0 && (room !== a.M[1] || decay !== a.st[3])) {
        if (b.M[0] === 0) { begin(b, room, decay, damp); b.M[0] = 4; return; }
        if (b.M[0] === 2) { b.M[0] = 3; b.M[6] = FADE; }
      }
      // one plan step a quantum: the path taking input first, then the other (it may still be planning as it rings).
      // (a call site per path, so each always reaches the same plan())
      const p0 = paths[0], p1 = paths[1], m0 = p0.M, m1 = p1.M, w0 = m0[0] && m0[0] < 4 && m0[2] < m0[3], w1 = m1[0] && m1[0] < 4 && m1[2] < m1[3];
      const go0 = w0 && (I[1] === 0 || !w1);
      if (go0) planStep(p0);
      if (w1 && !go0) planStep(p1);
    };
    const api = {
      process(L, R, n, P) {
        const damp = P.damp < 0 ? 0 : P.damp > 1 ? 1 : P.damp;
        if (damp !== poleDamp) { poleDamp = damp; S[7] = roomPole(sr, 20000 * dexp(damp * LN_03)); }
        if (P.lowcut !== lastCut) { lastCut = P.lowcut; roomSvfSet(sr, 0, P.lowcut, 0.6, 0, hc, 0); }
        const preT = P.predelay * sr / 1000, widT = P.width, mixT = P.mix;
        const hk = hc[0], h1 = hc[1], h2 = hc[2], h3 = hc[3];
        for (let o = 0; o < n; ) {
          // up to the next quantum of the device's own clock, whose first frame takes the quantum's decisions
          const clock = S[11], ph = clock & 127, m = n - o < 128 - ph ? n - o : 128 - ph;
          if (ph === 0) quantum(P);
          const dA = S[7];
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
          // the paths: the one taking input (during a handoff, the input moves to it from the other over FADE frames,
          // linearly, so the two always add up to it), and one ringing out or fading away
          const live = I[1], ho = I[2];
          for (let j = 0; j < 2; j++) {
            const p = paths[j], x = p.x, md = p.M[0];
            if (!md || md === 4) continue;
            if (md !== 1) for (let i = 0; i < m; i++) x[i] = 0;
            else if (!ho) for (let i = 0; i < m; i++) x[i] = xb[i];
            else for (let i = 0; i < m; i++) { const u = ho - i > 0 ? (FADE - (ho - i)) / FADE : 1; x[i] = xb[i] * (j === live ? u : 1 - u); }
            run(p, m);
          }
          if (ho) { const left = ho > m ? ho - m : 0; I[2] = left; if (!left) ringOut(paths[1 - live]); }
          const a = paths[0], b = paths[1], am = a.M[0] & 3, bm = b.M[0] & 3;
          let a0 = a.st[0], a1 = a.st[1], b0 = b.st[0], b1 = b.st[1];
          const ga = a.st[2], gb = b.st[2], fa = am === 3 ? a.M[6] : -1, fb = bm === 3 ? b.M[6] : -1;
          let l1 = S[0], l2 = S[1], r1 = S[2], r2 = S[3], wY = S[5], mY = S[6], dry = S[8], wet = S[9], lastMx = S[10];
          for (let i = 0; i < m; i++) {
            let wl = 0, wr = 0;
            // each path: DAMP's low pass on the measured part, the tail, the room's level (and a fading path's fade)
            if (am) {
              a0 = a.eL[i] + (a0 - a.eL[i]) * dA; a1 = a.eR[i] + (a1 - a.eR[i]) * dA;
              const g = fa < 0 ? ga : fa - i > 0 ? ga * (fa - i) / FADE : 0;
              wl += (a0 + a.tL[i]) * g; wr += (a1 + a.tR[i]) * g;
            }
            if (bm) {
              b0 = b.eL[i] + (b0 - b.eL[i]) * dA; b1 = b.eR[i] + (b1 - b.eR[i]) * dA;
              const g = fb < 0 ? gb : fb - i > 0 ? gb * (fb - i) / FADE : 0;
              wl += (b0 + b.tL[i]) * g; wr += (b1 + b.tR[i]) * g;
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
          a.st[0] = a0; a.st[1] = a1; b.st[0] = b0; b.st[1] = b1;
          // a ringing path rings out, then fades; a fading one goes quiet
          for (let j = 0; j < 2; j++) {
            const M = paths[j].M;
            if (M[0] === 3) { M[6] = M[6] > m ? M[6] - m : 0; if (!M[6]) M[0] = 0; }
            else if (M[0] === 2) { M[5] = M[5] > m ? M[5] - m : 0; if (!M[5]) { M[0] = 3; M[6] = FADE; } }
          }
          S[11] = clock + m; o += m;
        }
      },
    };
    // Warm-up, here in create(), where allocating is allowed, so that a change on the audio thread finds its code
    // compiled: cold, the engine keeps every double on the heap (the device's whole process() runs that way after a
    // deoptimisation), and the first room or DECAY change in the studio would collect garbage. A load is rare, so its
    // arithmetic (the tail's set, the generator's start, lift and transform) runs a hundred-odd times on both paths;
    // then a load on each and their plans in turn (both paths' tails and convolvers are closures of their own, and code
    // compiled after seeing one path's would be thrown away when the other came by); then process() through every
    // branch it has. Then every number goes back to where a new instance starts. It costs create() some 40 to 100 ms
    // (Node, loaded machine), once, against a garbage collection on a change.
    {
      // (the first room the bank has, and its shortest, whose late part runs out of partitions before its blocks do)
      let r0 = -1, r1 = -1;
      for (let r = 0; r < NR; r++) if (rooms[r]) { if (r0 < 0) r0 = r; if (r1 < 0 || rooms[r].frames < rooms[r1].frames) r1 = r; }
      if (r0 >= 0) {
        for (let k = 0; k < 120; k++) {
          const p = paths[k & 1], R = rooms[k & 2 ? r1 : r0], d = k & 4 ? 0.7 : k & 8 ? 1.5 : 1;
          genStart(p.gen, R.s.ch[0], R.s.ch[1], R.s.frames, R.gain, rate / sr, R.T, d);
          genLift(p.gen, R.tx, R.over, p.lift);
          p.tail.set(R.fit, d, (k & 16) / 32, p.lift, R.tref);
        }
        // (the tail's set alone, a few hundred times more: enough for the engine's top compiler, whose code keeps the
        // set's doubles off the heap; the tier below boxes every Math.sqrt it calls)
        const DW = [1, 0.7, 1.3, 2, 0.5, 1.1, 1, 0.9];
        for (let k = 0; k < 600; k++) { const p = paths[k & 1], R = rooms[k & 2 ? r1 : r0]; p.tail.set(R.fit, DW[(k >> 2) & 7], (k & 16) / 32, p.lift, R.tref); }
        // (the generator's transform, at a DECAY other than 1: called rarely, it would only have its loops compiled, and
        // run the rest in the interpreter at every call; a few hundred short calls on both paths, and its flat copy)
        for (let j = 0; j < 2; j++) {
          const p = paths[j], R = rooms[r1];
          for (const d of [0.7, 1]) {
            genStart(p.gen, R.s.ch[0], R.s.ch[1], R.s.frames, R.gain, rate / sr, R.T, d);
            for (let k = 0; k < 80; k++) genFill(p.gen, k & 1, frame, 0, 256);
          }
        }
        const load = (p, r, d) => { begin(p, r, d, 0); while (p.M[8] < p.M[9]) prep(p); };
        for (let j = 0; j < 2; j++) { load(paths[j], j ? r1 : r0, j ? 0.7 : 1); paths[j].M[0] = 1; }
        for (let k = 0; k < 8; k++) for (let j = 0; j < 2; j++) { const p = paths[j]; if (p.M[2] < p.M[3]) planStep(p); p.x.fill(0); run(p, 128); }
        for (let j = 0; j < 2; j++) ringOut(paths[j]);
        for (let j = 0; j < 2; j++) { const p = paths[j]; p.M.fill(0); p.conv.reset(); lateBegin(p.late, 0); p.tail.reset(); }
        // then process() through every branch it has, in the shortest room (little to plan): a change of DECAY (its
        // preparing, a handoff, two paths in the mix), the old path's ring-out (cut short here so it ends by itself)
        // and its fade; then DAMP, LOW CUT and MIX, and a change while the other path still rings (a fade forced). The
        // params as every host makes them: an empty object, then the keys in the def's order (so the engine sees the
        // one shape it will see in the studio and the renderer)
        const specs = params && params.length ? params : [{ key: 'room', def: 0 }, { key: 'predelay', def: 0 }, { key: 'decay', def: 1 }, { key: 'damp', def: 0 }, { key: 'lowcut', def: 120 }, { key: 'width', def: 1 }, { key: 'mix', def: 0.22 }];
        const mk = (o) => { const v = {}; for (let j = 0; j < specs.length; j++) { const k = specs[j].key; v[k] = o[k] != null ? o[k] : specs[j].def; } return v; };
        const seq = [mk({ room: r1 }), mk({ room: r1, decay: 0.7 }), mk({ room: r1, decay: 1, damp: 0.5, lowcut: 200, mix: 0.4 }), mk({ room: r1, decay: 1.3 })];
        const WL = new Float32Array(128), WR = new Float32Array(128);
        for (let k = 0; k < 100; k++) {
          for (let i = 0; i < 128; i++) { WL[i] = (i & 31) ? 0 : 0.25; WR[i] = WL[i]; }
          api.process(WL, WR, 128, seq[k < 4 ? 0 : k < 52 ? 1 : k < 76 ? 2 : 3]);
          if (k < 52) for (let j = 0; j < 2; j++) { const M = paths[j].M; if (M[0] === 2 && M[5] > 256) { M[5] = 256; if (M[4] > 128) M[4] = 128; } }
        }
      }
      for (let j = 0; j < 2; j++) {
        const p = paths[j];
        p.M.fill(0); p.st.fill(0); p.lift.fill(0); p.conv.reset(); lateBegin(p.late, 0); p.tail.reset();
      }
      I.fill(0); S.fill(0); pre.fill(0); hc.fill(0);
      lastDamp = NaN; lastCut = NaN; poleDamp = NaN;
    }
    return api;
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
    + 'each is its impulse response as recorded, until every octave has decayed 40 dB, then a tail fitted to its decay. T30 in seconds at 500 Hz, 1 kHz and 2 kHz, EDT at 1 kHz, the measured length (tx) in seconds',
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
