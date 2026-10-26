// The room's look [ui; stream C owns it after the foundation] (docs/research/LIVE-ROOM-MODE.md §3.18, docs/BRAND.md):
// the overlay over the studio, its header, the talkback strip and the screens' shared pieces. ui/liveroom/index.js
// injects it once (ui/dom.js css). The tokens are app/style/tokens.css's.
//
//   CSS   the stylesheet's text

export const CSS = `
.lr { position: fixed; inset: 0; z-index: 900; display: flex; flex-direction: column; background: var(--bg); color: var(--text); overflow: auto; outline: none;
  padding: 12px clamp(16px, 3vw, 40px) 18px; }
.lr[hidden] { display: none; }
.lr-top { display: flex; align-items: center; gap: 12px; min-height: 36px; }
.lr-brand { font-size: 18px; }
.lr-where { color: var(--text-3); font-size: 13px; }
.lr-gap { flex: 1; }
.lr-body { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 14px; padding-top: 18px; min-height: 0; }
.lr-screen { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.lr-h { margin: 0; font-size: clamp(28px, 4.2vw, 46px); text-align: center; }
.lr-sub { margin: 0; color: var(--text-2); font-size: 15px; text-align: center; max-width: 60ch; }
.lr-scene { width: min(100%, 1024px); height: auto; aspect-ratio: 16 / 9; image-rendering: pixelated; display: block; }
.lr-talkback { display: flex; align-items: baseline; gap: 10px; width: min(100%, 1024px); margin: 8px auto 0; min-height: 1.5em; }
.lr-tb-lamp { flex: none; width: 8px; height: 8px; background: var(--line-2); align-self: center; }
.lr-tb-lamp.lr-on { background: var(--accent); }
.lr-tb-text { margin: 0; font: 400 18px/1.4 var(--font-ui); max-width: 70ch; }
.ew-region-top > .ew-panel[data-panel="liveroom"] { flex: none; order: 8; display: flex; align-items: center; height: 40px; padding: 0 6px; }
.lr-key { height: 40px; padding: 0 14px; }
@media (max-width: 760px) { .lr-tb-text { font-size: 17px; } }
`;
