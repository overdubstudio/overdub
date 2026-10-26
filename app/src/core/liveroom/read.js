// @ts-check
// Reading a take [core; stream B fills it in] (docs/research/LIVE-ROOM-MODE.md §4.2): the DI of a pass (before the
// amp, which is an insert on its track) read for what the band needs: its notes on the place's grid, the chugs the
// kick goes on, the roots the bass plays, the key, and two readings for the room's own lines. The tempo and the 1 are
// given (you played to the count): nothing about a period or a downbeat is guessed. Pure and deterministic; it never
// moves your take, changes the tempo or decides anything about the song's shape.
//
// Frozen (§14.2):
//   readTake(samples, sr, { tempo, start, bars, grid, latency, place })
//       -> { notes, chugs, roots, key, lean, cents, thin }
//       samples: Float32Array (mono), sr: its rate; start: the take's beat 1 in seconds into samples
//       notes: [{ t (beats from the part's 1), p (MIDI, null unpitched), d }]   chugs: the notes the kick follows
//       roots: [pitch class per beat]   key: { root, scale } | null (the first part only)
//       lean: the median offset of chug attacks from the grid, ms   cents: the median of sustained notes' tuning
//       thin: too little on the grid to follow (the band keeps the groove's own kick, the bass waits)
//   readInWorker(samples, sr, opts) -> Promise of the same, off the main thread (core/liveroom/read-worker.js; an idle
//       callback where there's no Worker)
//
// Until stream B lands, every take reads thin.

export function readTake(samples, sr, { tempo = 120, start = 0, bars = 0, grid = 4, latency = 0, place = null } = {}) {
  return { notes: [], chugs: [], roots: [], key: null, lean: null, cents: null, thin: true };
}

export function readInWorker(samples, sr, opts = {}) {
  return Promise.resolve(readTake(samples, sr, opts));
}
