// The drummer at work [ui; the guitar room's DRUMMER stream] (docs/research/GUITAR-ROOM.md §2.2, §2.6): the drums
// heard where the song has none. Whenever the drummer is on (a jam: Space on the stage; a take: the count-in into a
// part), the bars ahead of the playhead that hold no drums in the song are filled, a bar at a time, two bars ahead,
// with the beat's bar (core/liveroom/guitar/beats.js jamOps) through store.preview: in the song while they're heard,
// never kept, never in History, each released a bar after it's played and all of them when the drummer stops. The
// song's own drums (a part's) play where they are; the drummer fills the rest. A new beat comes in at the next bar
// line far enough ahead to be heard on time.
//
//   createJam({ store, engine, bpb }) -> jam
//     jam.start({ from, beat, kind, play }) -> { ok, error? }   the drummer from beat `from` (the jam's 1): kind 'jam'
//         (the transport started here: play) or 'take' (the deck's count already started it: the drummer follows)
//     jam.swap(beat) -> bar | null    the beat from the next bar on (null: it's in now, nothing was playing)
//     jam.stop({ transport, drop }) -> was  every bar released; transport: also stop the engine (the jam's own
//                                     transport); drop: forgotten, not released (a song loaded over them)
//     jam.tick()                      from the frame: fill what's ahead, release what's behind, notice the transport
//                                     stopping by itself (then everything's released)
//     jam.state = { on, kind, start, beat, bar, held }   bar: the bar heard now (1 the jam's first; null off)
//     jam.beatAt(bar) -> beat          the beat a bar plays (the swaps in order)
//     jam.isFilled(bar) -> bool        that bar's drums are the drummer's (a preview), not the song's

import { jamOps } from '../../../core/liveroom/guitar/beats.js';
import { roomOf } from '../../../core/liveroom/model.js';

const EPS = 1e-6;
const AHEAD = 2;      // bars filled ahead of the one heard
const LEAD = 0.25;    // s: a swap comes in at the first bar line at least this far ahead (the engine's lookahead is less)

export function createJam({ store, engine, bpb = () => 4 }) {
  const eng = () => (typeof engine === 'function' ? engine() : engine);
  const state = { on: false, kind: null, start: 0, beat: null, bar: null, held: 0 };
  let swaps = [];            // [{ k (bar index from 0), beat }], in order
  const held = new Map();    // bar index -> { release }
  let idle = 0;              // frames the transport's been stopped while the drummer's on
  let seen = false;          // the transport has played since the drummer started (a take's count may wait on the kit)
  let starting = 0;          // the jam's own play, still waking the engine (its generation; 0: not waiting)
  let gen = 0;

  const beatAt = (k) => { let b = state.beat; for (const s of swaps) if (s.k <= k) b = s.beat; return b; };
  const B = () => bpb() || 4;
  // a bar of the song's own drums: any clip on the drums track there that isn't the drummer's
  function songHas(k) {
    const p = store.get(), id = roomOf(p)?.tracks?.drums, t = id ? p.tracks.find((x) => x.id === id) : null;
    if (!t) return false;
    const a = state.start + k * B(), e = a + B();
    return t.clips.some((c) => !(c.name === 'Jam' && c.by === 'overdub') && !c.mute && Math.min(c.start + c.length, e) - Math.max(c.start, a) > 0.05);
  }
  function fill(k) {
    if (held.has(k) || k < 0 || songHas(k)) return;
    const pl = jamOps(store.get(), { beat: beatAt(k), from: state.start + k * B(), bars: 1, start: state.start });
    if (!pl.ops.length) { held.set(k, { release() {} }); return; }
    const r = store.preview(pl.ops, { by: 'overdub' });
    held.set(k, r.ok ? r : { release() {} });
  }
  function release(k) { const r = held.get(k); held.delete(k); try { r?.release?.(); } catch (e) { console.error('drummer: a bar back out', e); } }
  function releaseAll() { for (const k of [...held.keys()].sort((a, b) => b - a)) release(k); }
  const barNow = () => {
    const e = eng();
    if (!e?.playing) return null;
    return Math.floor((Math.max(state.start, e.beat) - state.start) / B() + EPS);
  };

  const jam = {
    state,
    beatAt,
    isFilled: (bar) => held.has(bar - 1),
    start({ from = 0, beat, kind = 'jam', play = true } = {}) {
      if (state.on) jam.stop({ transport: state.kind === 'jam' && kind === 'jam' });
      const e = eng();
      if (!e) return { ok: false, error: 'No engine here.' };
      Object.assign(state, { on: true, kind, start: Math.max(0, +from || 0), beat, bar: 1, held: 0 });
      swaps = [];
      idle = 0;
      seen = false;
      for (let k = 0; k <= AHEAD; k++) fill(k);
      if (play) {
        // (the engine's play is async: the audio context waking, the worklets coming in. Until it's playing, the
        // drummer waits for it, however long that takes; a stop before then cancels it, the engine's own rule)
        const my = (starting = ++gen);
        const done = () => { if (starting === my) starting = 0; };
        try {
          Promise.resolve(e.play(state.start)).then(done, (err) => { done(); console.error('drummer: the transport didn’t start', err); if (gen === my) jam.stop(); });
        } catch (err) { done(); jam.stop(); return { ok: false, error: String(err?.message || err) }; }
      }
      state.held = held.size;
      return { ok: true };
    },
    swap(beat) {
      if (!state.on) { state.beat = beat; return null; }
      const e = eng(), spb = 60 / (+store.get().tempo || 120);
      // the first bar line far enough ahead (in the count, the jam's 1)
      const now = e?.playing ? e.beat : state.start;
      let k = Math.max(0, Math.ceil((now - state.start) / B() - EPS));
      while (state.start + k * B() - now < LEAD / spb) k++;
      swaps = swaps.filter((s) => s.k < k);
      swaps.push({ k, beat });
      for (const j of [...held.keys()]) if (j >= k) release(j);
      jam.tick();
      return k + 1;
    },
    stop({ transport = false, drop = false } = {}) {
      const was = state.on;
      starting = 0;
      gen++;
      // (drop: another song came in, and the bars went with the one they were in: nothing to take back out)
      if (drop) held.clear();
      else releaseAll();
      if (was && transport) { try { eng()?.stop?.(); } catch { /* fine */ } }
      Object.assign(state, { on: false, kind: null, bar: null, held: 0 });
      swaps = [];
      return was;
    },
    tick() {
      if (!state.on) return;
      const e = eng();
      // (the transport stopped by itself, or by someone else: the drummer lets go; a take's drummer waits for the deck's
      // count to start it, however long the kit takes to come in)
      if (!e?.playing) { if (!starting && (seen || state.kind === 'jam') && ++idle > 20) jam.stop(); return; }
      idle = 0;
      seen = true;
      const k = barNow() ?? 0;
      state.bar = k + 1;
      for (let j = k; j <= k + AHEAD; j++) fill(j);
      for (const j of [...held.keys()]) if (j < k - 1) release(j);
      if (swaps.length && swaps[0].k <= k) { state.beat = beatAt(k); swaps = swaps.filter((s) => s.k > k); }
      state.held = held.size;
    },
  };
  return jam;
}
