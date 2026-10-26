// The deck [ui; stream A fills it in] (docs/research/LIVE-ROOM-MODE.md §3.3-§3.6, §9.4): the room's one door to the
// input, the count-in, the recorder and the soundcheck. Every musical decision is made on the audio clock when the key
// is pressed (the start and stop beats passed to the engine and the recorder with `at`), never in a frame callback.
//
// Frozen (§14.2):
//   createDeck(app) -> { state, on(evt, fn) -> off, countIn({ from, bars, voice, hits, at }), take({ track, from, punch,
//       tail }), stop({ at: 'bar' | 'now', keep: 'song' | 'capture' }), keepAfterAll(), level(), tuner(), latency }
//       state: what the stage paints from ({ run: 'idle' | 'count' | 'take', ... }); the actions are Promises of
//       { ok, ... }; level() and tuner() read the input now (null when it's closed); latency: the measured round trip, s
//
// Until stream A lands, the deck does nothing: every action says so.

const NOT_YET = 'The deck isn’t in this build yet.';

export function createDeck(app) {
  const listeners = new Map();
  const nothing = async () => ({ ok: false, error: NOT_YET });
  return {
    state: { run: 'idle' },
    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(fn);
      return () => listeners.get(evt)?.delete(fn);
    },
    countIn: nothing, take: nothing, stop: nothing, keepAfterAll: nothing,
    level: () => null,
    tuner: () => null,
    get latency() { try { return app?.input?.audio?.latency?.get?.() || 0; } catch { return 0; } },
  };
}
