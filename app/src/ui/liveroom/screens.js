// @ts-check
// The room's screens [ui; stream C owns it after the foundation] (docs/research/LIVE-ROOM-MODE.md §3, §14.2): the
// registry every screen module adds itself to when it's imported (ui/liveroom/index.js imports them all). One screen is
// mounted at a time, in the overlay's body, and its frame runs from the room's panel in the shell's one loop.
//
// Frozen (§14.2):
//   screens.add({ id, mount(el, ctx) -> { frame(now), unmount(), press?(id) } }) -> remove()
//       el: the screen's element (empty, in the overlay); ctx: ui/liveroom/index.js's { app, ui, store, deck, view(),
//       say(lineId, vars), prefs, scene }. A screen declares its keys in mount with ctx.ui.keys.add({ ..., first: true,
//       when, group: 'Live room' }) and removes them in unmount, so they're tried before the room's held keys and never
//       held themselves. press(id), if it has one, is what app.liveRoom.press(id) asks first: { ok, error? }, or
//       false for an id it doesn't know.
//   screens.get(id), screens.has(id), screens.list() -> [ids]
// The ids are the room's: 'door', 'stage', 'shelf', 'send', 'kitchen' (ui.state.liveRoom.screen).

const registry = new Map();

export const screens = {
  add(def) {
    if (!def || typeof def.id !== 'string' || !def.id || typeof def.mount !== 'function') throw new Error('a screen is { id, mount(el, ctx) -> { frame(now), unmount() } }');
    if (registry.has(def.id)) console.warn(`overdub: the room's screen "${def.id}" was added twice; the later one stays`);
    registry.set(def.id, def);
    return () => { if (registry.get(def.id) === def) registry.delete(def.id); };
  },
  get: (id) => registry.get(id) || null,
  has: (id) => registry.has(id),
  list: () => [...registry.keys()],
};
