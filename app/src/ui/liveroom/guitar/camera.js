// @ts-check
// The guitar room's camera [ui; the guitar room's foundation, frozen] (docs/research/GUITAR-ROOM.md §2.2; AJ on the
// second mock: "a camera-style zoom into the head, the cab and the kit"; Esc steps back, never a trap). Going closer is
// the camera dollying in on the world, a CSS transform on the world's element (translate, then scale), gliding over
// GLIDE ms (a cut under reduced motion). Nothing is drawn here: the streams draw into the worlds, and register the
// targets the camera can go to.
//
//   createCamera({ view, worlds, state, reduced }) -> cam
//     view     the viewport element (the camera reads its size, and refits when it changes: a ResizeObserver)
//     worlds   { [id]: { el, w, h } }: the stage and the shop (each an element sized w x h world units, origin top-left,
//              transform-origin 0 0); one is shown at a time
//     state    ui.state.liveRoom.gr: the camera keeps world, cam and trail there (never in the DOM)
//   cam.target(id, { world, rect: () => R, right?, left?, top?, bottom?, pad?, maxS?, ax?, ay?, home? }) -> off
//       a place the camera can go: rect() is read each time it goes (so a target that moves, a pedal added, is framed
//       where it is now); right/left/top/bottom: room kept clear for a panel or a sheet; home: true for the world's
//       overview (the stage's and the shop's, registered here: 'stage' and 'shop'). A stream re-registering an id
//       replaces it (the room stream gives the drawn gear's own boxes). Off puts back what was there before.
//   cam.zoomTo(id, { glide = true, push = true }) -> bool
//       go there (false: no such target). A target in the other world goes through the door: a fade, the world
//       swapped, then the camera on the target (the shop's door; the walk takes WALK ms). push: the target goes on the
//       trail, so back() returns to where you were
//   cam.back() -> bool          one step back along the trail (false at a world's home with nothing behind: the caller
//                               then leaves, e.g. the shop's back is the stage)
//   cam.home({ glide })         the world's overview, the trail cleared
//   cam.at() -> id              where it is ('stage' at first)
//   cam.world() -> id           which world is up ('stage' | 'shop')
//   cam.now() -> { s, x, y }    the transform now (where it's going, if it's gliding)
//   cam.toView(R) -> R          a world rect in the view's coordinates, as the camera has it now
//   cam.toWorld(pt) -> { x, y } a point in the view (clientX/Y less the view's box) in world units
//   cam.refit()                 frame the current target again (the view changed size)
//   cam.on('move', fn({ to, from, world })) -> off      after each zoomTo, back, home and world change
//   cam.dispose()
//   GLIDE = 660, WALK = 600, REDUCED_MS = 30

import { fit, frame } from './layout.js';

export const GLIDE = 660;
export const WALK = 600;
export const REDUCED_MS = 30;

export function createCamera({ view, worlds, state, reduced = null }) {
  const isReduced = () => (typeof reduced === 'function' ? reduced() : typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const targets = new Map();
  const fns = new Set();
  const emit = (d) => { for (const fn of fns) { try { fn(d); } catch (e) { console.error('camera listener', e); } } };
  let cur = { s: 1, x: 0, y: 0 };
  if (!state.world) state.world = 'stage';
  if (!state.cam) state.cam = state.world;
  if (!Array.isArray(state.trail)) state.trail = [];

  const size = () => ({ w: view.clientWidth || 1, h: view.clientHeight || 1 });
  function place(c, glide) {
    const w = worlds[state.world];
    if (!w?.el) return;
    const ms = glide ? (isReduced() ? REDUCED_MS : GLIDE) : 0;
    w.el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2,.7,.2,1)` : 'none';
    w.el.style.transformOrigin = '0 0';
    w.el.style.transform = `translate(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px) scale(${c.s.toFixed(4)})`;
    cur = { ...c };
  }
  function framing(id) {
    const t = targets.get(id);
    const w = worlds[t?.world || state.world];
    if (!t || !w) return null;
    if (t.home) return fit(size(), w);
    let r;
    try { r = t.rect(); } catch (e) { console.error('camera target', id, e); r = null; }
    if (!r || !(r.w > 0) || !(r.h > 0)) return fit(size(), w);
    return frame(size(), r, t);
  }
  function show(world) {
    for (const [id, w] of Object.entries(worlds)) if (w?.el) w.el.hidden = id !== world;
    state.world = world;
  }
  const fade = (() => {
    const el = view.querySelector?.('.gr-fade') || null;
    return (on) => { if (el) el.classList.toggle('gr-on', !!on); };
  })();

  // the stage's and the shop's overviews
  for (const [id, w] of Object.entries(worlds)) if (w) targets.set(id, { world: id, home: true, rect: () => ({ x: 0, y: 0, w: w.w, h: w.h }) });

  let walking = null;
  function go(id, glide) {
    const t = targets.get(id);
    if (!t) return false;
    const from = state.cam;
    if (t.world && t.world !== state.world) {
      // through the door: fade, swap the world, then the camera on the target
      const ms = isReduced() ? REDUCED_MS : WALK;
      clearTimeout(walking);
      fade(true);
      walking = setTimeout(() => {
        show(t.world);
        state.cam = id;
        const c = framing(id);
        if (c) place(c, false);
        fade(false);
        emit({ to: id, from, world: state.world });
      }, ms);
      return true;
    }
    state.cam = id;
    const c = framing(id);
    if (c) place(c, glide);
    emit({ to: id, from, world: state.world });
    return true;
  }

  const cam = {
    target(id, spec) {
      const was = targets.get(id) || null;
      targets.set(id, { world: spec.world || 'stage', ...spec });
      if (state.cam === id) cam.refit();
      return () => { if (was) targets.set(id, was); else targets.delete(id); };
    },
    zoomTo(id, { glide = true, push = true } = {}) {
      if (!targets.has(id)) return false;
      if (id === state.cam) { cam.refit(); return true; }
      const t = targets.get(id);
      if (push && !(t.home && t.world === state.world)) state.trail.push(state.cam);
      if (t.home && t.world === state.world) state.trail = [];
      return go(id, glide);
    },
    back() {
      while (state.trail.length) {
        const id = state.trail.pop();
        if (targets.has(id)) return go(id, true);
      }
      const home = state.world;
      if (state.cam !== home && targets.has(home)) return go(home, true);
      return false;
    },
    home({ glide = true } = {}) { state.trail = []; return go(state.world, glide); },
    at: () => state.cam,
    world: () => state.world,
    now: () => ({ ...cur }),
    toView: (r) => ({ x: cur.x + r.x * cur.s, y: cur.y + r.y * cur.s, w: r.w * cur.s, h: r.h * cur.s }),
    toWorld: (pt) => ({ x: (pt.x - cur.x) / cur.s, y: (pt.y - cur.y) / cur.s }),
    refit() { const c = framing(state.cam); if (c) place(c, false); },
    on(evt, fn) { if (evt !== 'move') return () => {}; fns.add(fn); return () => fns.delete(fn); },
    dispose() { clearTimeout(walking); ro?.disconnect(); fns.clear(); },
  };

  show(state.world);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => cam.refit()) : null;
  ro?.observe(view);
  cam.refit();
  return cam;
}
