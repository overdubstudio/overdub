// The guitar room's frame [ui; the guitar room's foundation] (docs/BRAND.md; design/mock/guitar-room-2/): the screen
// full-bleed under the room's header, the camera's viewport, the two worlds and their layers, the slots each stream
// fills (panels, sheets, the drawer, the recording view, the callout) and the bottom strip. Only the frame: what's drawn
// in a slot is styled by the stream that draws it (its own css('gr-<stream>', ...)). Tokens are app/style/tokens.css's;
// red is the record light's alone.
//
//   CSS   the stylesheet's text (./index.js injects it once: ui/dom.js css('gr', CSS))

export const CSS = `
.lr[data-screen="guitar"] { overflow: hidden; padding-bottom: 0; }
.lr[data-screen="guitar"] .lr-body { flex: 1 1 auto; padding-top: 0; gap: 0; align-items: stretch; min-height: 0; }
.lr-screen[data-screen="guitar"] { flex: 1 1 auto; align-items: stretch; gap: 0; min-height: 0; }
.lr-tools { display: inline-flex; align-items: center; gap: 8px; }
.lr-tools:empty { display: none; }
.gr { position: relative; flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; margin: 0 calc(-1 * clamp(16px, 2.4vw, 32px)); }
.gr-view { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; background: #0d0c0b; contain: strict; }
.gr-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.gr-layer { position: absolute; inset: 0; }
/* (the stage's layers paint back to front in their order, whatever z-index a stream gives inside one: the amp's loop
   cables run down past the cab behind the drummer's plate and cards, never across their buttons) */
.gr-world[data-world="stage"] > .gr-layer { isolation: isolate; }
.gr-layer.gr-pixels canvas { image-rendering: pixelated; width: 100%; height: 100%; display: block; }
.gr-hot, .gr-spot { pointer-events: none; }
.gr-hot > *, .gr-spot > * { pointer-events: auto; }
.gr-panels { position: absolute; inset: 0; pointer-events: none; }
.gr-panel { position: absolute; top: 12px; right: 12px; bottom: 12px; width: min(420px, 42%); overflow: auto; pointer-events: auto;
  background: var(--bg); color: var(--text); border: var(--rule-2); padding: 14px 16px; }
.gr-sheets { position: absolute; left: 0; right: 0; bottom: 0; pointer-events: none; }
.gr-sheet { pointer-events: auto; background: var(--bg); color: var(--text); border-top: var(--rule-2); max-height: 62vh; overflow: auto; padding: 12px 16px; }
.gr-drawer { position: absolute; left: 0; right: 0; bottom: 0; background: var(--bg); border-top: var(--rule-2); display: grid; grid-template-rows: auto auto; }
.gr-tray:empty, .gr-parts:empty { display: none; }
/* (the riff library is the whole view: the drawer waits under it, and is back as it was when the library goes) */
.gr[data-overlay="library"] .gr-drawer { display: none; }
.gr-over { position: absolute; inset: 0; background: var(--bg); color: var(--text); z-index: 3; }
.gr-callout { position: absolute; z-index: 2; max-width: 360px; background: var(--bg); color: var(--text); border: var(--rule-2); padding: 12px 14px; }
.gr-fade { position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; transition: opacity 280ms ease; z-index: 4; }
.gr-fade.gr-on { opacity: 1; }
.gr-strip { flex: none; display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 clamp(16px, 2.4vw, 32px); border-top: var(--rule); background: var(--bg); }
.gr-strip-talk { flex: 1 1 auto; min-width: 0; }
.gr-strip-talk .lr-talkback { width: 100%; margin: 0; }
.gr-strip-tools { flex: none; display: flex; align-items: center; gap: 8px; }
@media (prefers-reduced-motion: reduce) { .gr-fade { transition: none; } .gr-world { transition: none !important; } }
`;
