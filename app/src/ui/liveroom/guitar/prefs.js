// @ts-check
// The guitar room's memory in this browser [ui; the guitar room's foundation, frozen]: localStorage overdub:guitar-room
// (the key is forever), the musician's own settings, never the song's. Read again on every call, so two tabs agree;
// with storage blocked, unreadable or full it works for the page load, in memory. Keys a newer studio writes are kept.
//
//   gprefs.get() -> { v: 1, countIn: true, gs: { done, step, skipped }, tuning: null, tunerStyle: 'needle', snap: true }
//     countIn     a metronome count-in into each take (AJ: on by default, can be off)            [takes, drummer]
//     gs          Getting started: done (finished or skipped: it isn't shown again by itself), step (where it was
//                 left), skipped ([step ids])                                                    [start]
//     tuning      the tuner's tuning (input/tuner.js TUNER_TUNINGS id), null for the song's      [start]
//     tunerStyle  'needle' | 'strobe'                                                            [start]
//     snap        the tape's handles snap to bar lines                                            [tape]
//   gprefs.set(patch) -> the same, after (a key it doesn't know is kept as given: a stream's own setting goes in
//                 under its own key)
//   gprefs.key   'overdub:guitar-room'

const KEY = 'overdub:guitar-room';
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const fresh = () => ({ v: 1, countIn: true, gs: { done: false, step: null, skipped: [] }, tuning: null, tunerStyle: 'needle', snap: true });

function clean(x) {
  const out = fresh();
  if (!isObj(x)) return out;
  for (const [k, v] of Object.entries(x)) if (k !== '__proto__' && !(k in out)) out[k] = v;
  if (typeof x.countIn === 'boolean') out.countIn = x.countIn;
  if (isObj(x.gs)) {
    out.gs.done = x.gs.done === true;
    if (typeof x.gs.step === 'string' && x.gs.step.length <= 16) out.gs.step = x.gs.step;
    if (Array.isArray(x.gs.skipped)) out.gs.skipped = x.gs.skipped.filter((s) => typeof s === 'string' && s.length <= 16).slice(0, 16);
  }
  if (typeof x.tuning === 'string' && /^[a-z0-9-]{1,32}$/.test(x.tuning)) out.tuning = x.tuning;
  if (x.tunerStyle === 'needle' || x.tunerStyle === 'strobe') out.tunerStyle = x.tunerStyle;
  if (typeof x.snap === 'boolean') out.snap = x.snap;
  return out;
}

let mem = null;
function read() {
  try { const s = localStorage.getItem(KEY); if (s != null) return clean(JSON.parse(s)); } catch { /* blocked or unreadable */ }
  return clean(mem);
}

export const gprefs = {
  key: KEY,
  get: () => read(),
  set(patch) {
    const next = clean({ ...read(), ...(isObj(patch) ? patch : {}), ...(isObj(patch?.gs) ? { gs: { ...read().gs, ...patch.gs } } : {}) });
    mem = next;
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* memory for the page */ }
    return clean(next);
  },
};
