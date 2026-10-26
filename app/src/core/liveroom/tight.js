// @ts-check
// Measuring the pair [core; stream B fills it in] (docs/research/LIVE-ROOM-MODE.md §4.7): how tightly the right side
// was played to the left, bar by bar, from the two DIs, so the room can say which bar to play again.
//
// Frozen (§14.2):
//   measurePair(left, right, { sr, tempo, start, bars, grid }) -> { perBar, median, drift, unmatched, verdict }
//       left, right: Float32Array DIs (mono, the same rate and start)
//       perBar: [{ bar, ms (right minus left, median), matched }]   median: ms over the part   drift: ms per bar
//       unmatched: the share of attacks with no partner   verdict: 'tight' | 'loose' | 'bar' (one bar to play again),
//       or null when there's too little to measure
// Its thresholds (20 ms, a quarter of a sixteenth, 30% unmatched) are constants here, printed by the bench.
//
// Until stream B lands, nothing is measured.

export function measurePair(left, right, { sr = 48000, tempo = 120, start = 0, bars = 0, grid = 4 } = {}) {
  return { perBar: [], median: null, drift: null, unmatched: 0, verdict: null };
}
