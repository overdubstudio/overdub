// @ts-check
// The input's level, for setting the interface's gain (docs/research/GUITAR-ROOM.md §2.1, Getting started's Plug in).
// Pure (no DOM, no audio graph): it takes each frame's samples, or their peak, and says where the hardest strum lands
// against the window a guitar wants, −12 to −6 dBFS, and what to do with the gain knob about it. ui/gauges/level.js
// draws it; Node checks it (test/unit/level.test.js, tools/input-test.js). Claw'd-o-Matic's Getting started meter
// (web/plug/onboard.js) is the guide; the words are Overdub's.
//
//   createLevel({ lo, hi, holdMs, clipMs, judgeMs, settleMs, fall, device }) -> meter
//     meter.push(x, now) -> state     x: this frame's samples (Float32Array), or { peak } (linear, 0..1) or a peak
//                                     number; now: ms (performance.now()), rising
//     meter.state                     the last state
//     meter.reset()                   forget the strums (a new input, or the gain was moved: listen again)
//     meter.clearClip()               the clip lamp off (it holds clipMs by itself)
//   state: {
//     db        the bar: the peak with a meter's fall (fall dB a second), dBFS
//     peak      this frame's peak, dBFS
//     hold      the peak hold: the highest in the last holdMs, then it falls with the bar (the tick over the bar)
//     clip      a sample reached full scale in the last clipMs (the lamp); clips: how many times since reset
//     strum     the hardest peak in the last judgeMs (what the advice is about), dBFS
//     verdict   'none' (nothing coming in) | 'quiet' (under −24) | 'low' (−24 to −12) | 'ok' (−12 to −6) |
//               'hot' (−6 to full scale) | 'clip', once it has held settleMs (it doesn't flicker as you play)
//     advice    { id: 'level.<verdict>', text, turn: 'up' | 'down' | null, by (dB, rounded to 3: how far to turn) }
//     inWindow  strum inside lo..hi; good: the ms it's been in the window, held (Getting started's Next lights at 1500)
//     at(db) -> 0..1                  where a level sits on the bar (−60 to 0 dBFS)
//   }
//   levelAdvice(verdict, strumDb, { lo, hi, device, quietFor }) -> state.advice   the words, alone
//   meterPos(db, floor = -60) -> 0..1
//   WINDOW = { lo: -12, hi: -6 }
//
// The gain is the interface's: nothing in the browser turns an input up (echo cancellation and gain control are off,
// input/audioin.js). So the advice names the knob on the interface, and on a Focusrite (AJ plays a Scarlett Solo) the
// ring round it, which glows green, then amber near the top, and red when it clips.

export const WINDOW = Object.freeze({ lo: -12, hi: -6 });
export const meterPos = (/** @type {number} */ db, floor = -60) => (Number.isFinite(db) ? Math.max(0, Math.min(1, (db - floor) / -floor)) : 0);
const dbOf = (/** @type {number} */ x) => 20 * Math.log10(Math.max(1e-9, x));
const CLIP = 0.989; // −0.1 dBFS: an interface that clips flattens at full scale

/** @param {string} verdict @param {number} db @param {{ lo?: number, hi?: number, device?: string, quietFor?: number }} [o] */
export function levelAdvice(verdict, db, { lo = WINDOW.lo, hi = WINDOW.hi, device = '', quietFor = 0 } = {}) {
  const n = Math.round(db), mid = (lo + hi) / 2, by = Math.max(3, Math.round(Math.abs(mid - db) / 3) * 3);
  const ring = /scarlett|focusrite|clarett|vocaster/i.test(device || '');
  const num = `${n < 0 ? '−' : ''}${Math.abs(n)} dBFS`;
  switch (verdict) {
    case 'none':
      return { id: 'level.none', text: 'Nothing coming in yet. Strum a chord, hard. Still nothing? Check the cable, and that the input is on the channel your guitar is in.', turn: null, by: 0 };
    case 'quiet':
      return { id: 'level.quiet', text: `Quiet: your hardest strum peaks at ${num}. Turn the gain knob on your interface up, about ${by} dB.${quietFor > 8000 ? ' If it’s already up, set that input to instrument (INST or Hi-Z): a guitar wants it.' : ''}`, turn: 'up', by };
    case 'low':
      return { id: 'level.low', text: `A little low: ${num}. Nudge the interface’s gain up${by > 3 ? `, about ${by} dB` : ''}.`, turn: 'up', by };
    case 'ok':
      return { id: 'level.ok', text: `Right in the window: ${num} on your hardest strum. Leave the gain there.${ring ? ' The ring round the knob stays green.' : ''}`, turn: null, by: 0 };
    case 'hot':
      return { id: 'level.hot', text: `Hot: ${num}. It plays, but there’s little room left. Turn the gain down a touch${by > 3 ? `, about ${by} dB` : ''}.${ring ? ' The ring round the knob should be green, amber at most.' : ''}`, turn: 'down', by };
    case 'clip':
      return { id: 'level.clip', text: `That clipped: your strum hit full scale. Turn the gain on your interface down about ${Math.max(6, by)} dB, then strum hard again.${ring ? ' The ring round the knob went red.' : ''}`, turn: 'down', by: Math.max(6, by) };
    default:
      return { id: '', text: '', turn: null, by: 0 };
  }
}

/** @param {{ lo?: number, hi?: number, holdMs?: number, clipMs?: number, judgeMs?: number, settleMs?: number, fall?: number, device?: string }} [o] */
export function createLevel({ lo = WINDOW.lo, hi = WINDOW.hi, holdMs = 1500, clipMs = 3000, judgeMs = 3000, settleMs = 600, fall = 24, device = '' } = {}) {
  /** @type {any} */
  let S;
  const fresh = () => ({ last: -1, bar: -120, hold: -120, holdAt: -1e9, clipAt: -1e9, clips: 0, peaks: /** @type {{ t: number, db: number }[]} */ ([]), verdict: 'none', cand: 'none', candAt: 0, goodAt: -1, quietAt: -1, said: /** @type {number | null} */ (null), saidAt: 0, state: null });
  S = fresh();
  const at = (/** @type {number} */ db) => meterPos(db);
  const api = {
    get state() { return S.state; },
    device,
    reset() { const d = api.device; S = fresh(); api.device = d; },
    clearClip() { S.clipAt = -1e9; if (S.state) S.state = { ...S.state, clip: false }; },
    /** @param {Float32Array | number[] | { peak: number } | number} x @param {number} now */
    push(x, now) {
      let pk = 0;
      if (typeof x === 'number') pk = Math.abs(x);
      else if (x && typeof x === 'object' && 'peak' in x) pk = Math.abs(+x.peak || 0);
      else if (x && typeof x === 'object' && 'length' in x) { const a = /** @type {ArrayLike<number>} */ (x); for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > pk) pk = v; } }
      const dt = S.last < 0 ? 0 : Math.max(0, Math.min(1000, now - S.last));
      S.last = now;
      const p = dbOf(pk);
      // the bar: up at once, down at `fall` dB a second
      S.bar = Math.max(p, S.bar - (fall * dt) / 1000);
      // the hold: the top of the last holdMs, then falling with the bar
      if (p >= S.hold || now - S.holdAt > holdMs) { if (p >= S.hold) { S.hold = p; S.holdAt = now; } else S.hold = Math.max(S.bar, S.hold - (fall * dt) / 1000); }
      if (pk >= CLIP) { if (now - S.clipAt > 250) S.clips++; S.clipAt = now; }
      S.peaks.push({ t: now, db: p });
      while (S.peaks.length && S.peaks[0].t < now - judgeMs) S.peaks.shift();
      const strum = Math.max(...S.peaks.map((q) => q.db));
      const clip = now - S.clipAt < clipMs;
      const r = Math.round(strum);
      const v = clip ? 'clip' : strum < -50 ? 'none' : r < -24 ? 'quiet' : r < lo ? 'low' : r <= hi ? 'ok' : 'hot';
      // the verdict once it has held (a clip at once: it's the one that matters right away)
      if (v !== S.cand) { S.cand = v; S.candAt = now; }
      // (once in the window, playing softer or resting doesn't take it out: only louder trouble, or a long quiet)
      const softer = (S.verdict === 'ok' || S.verdict === 'hot') && (v === 'low' || v === 'quiet' || v === 'none');
      if (v === 'clip' || (now - S.candAt >= settleMs && !(softer && now - S.candAt < 8000))) S.verdict = v;
      if (S.verdict === 'ok') { if (S.goodAt < 0) S.goodAt = now; } else S.goodAt = -1;
      if (S.verdict === 'quiet') { if (S.quietAt < 0) S.quietAt = now; } else S.quietAt = -1;
      // the number in the words: the strum's, while it agrees with the verdict; else the one the verdict was made on
      // (playing softer in the window doesn't make "Right in the window: −20 dBFS")
      // (in the window or over it, the hardest of the last judgeMs while it agreed)
      if (S.said == null || (v === S.verdict && (!(S.verdict === 'ok' || S.verdict === 'hot') || strum >= S.said || now - S.saidAt > judgeMs))) { S.said = strum; S.saidAt = now; }
      const shown = S.said;
      return (S.state = {
        db: S.bar, peak: p, hold: S.hold, clip, clips: S.clips, strum, verdict: S.verdict,
        advice: levelAdvice(S.verdict, shown, { lo, hi, device: api.device, quietFor: S.quietAt < 0 ? 0 : now - S.quietAt }),
        inWindow: r >= lo && r <= hi, good: S.goodAt < 0 ? 0 : now - S.goodAt, lo, hi, at,
      });
    },
  };
  return api;
}
