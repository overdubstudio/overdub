// The soundcheck's lamps [ui; stream A fills it in] (docs/research/LIVE-ROOM-MODE.md §3.3): plugged in, the level, the
// tuning and the line-up, lit on the stage as you play.
//
// Frozen (§14.2):
//   mountLamps(el, ctx) -> { frame(now), unmount() }   ctx: ui/liveroom/index.js's
//   lampsState() -> { plug, level, tune, lineup }      each lamp's state (null: dark)
//
// Until stream A lands, the lamps are dark.

export function mountLamps(el, ctx) {
  return { frame() {}, unmount() { el.replaceChildren(); } };
}
export function lampsState() {
  return { plug: null, level: null, tune: null, lineup: null };
}
