// The room's look [ui; stream C] (docs/research/LIVE-ROOM-MODE.md §3.16, §3.18, docs/BRAND.md): the overlay over the
// studio, its header, the talkback strip, the stage (the scene, the readout and the offered move, the setlist) and the
// screens' shared pieces. ui/liveroom/index.js injects it once (ui/dom.js css). The tokens are app/style/tokens.css's:
// one radius for what you press (--r-press, 2 px), square containers, no shadow but on what floats (the menu), no
// pills, and leader green for its two jobs only (the playhead and the one primary action).
//
//   CSS   the stylesheet's text

export const CSS = `
.lr { position: fixed; inset: 0; z-index: 890; display: flex; flex-direction: column; background: var(--bg); color: var(--text); overflow-x: hidden; overflow-y: auto; outline: none;
  padding: 0 clamp(16px, 2.4vw, 32px) 12px; }
.lr[hidden] { display: none; }
.lr-top { display: flex; align-items: center; gap: 12px; min-height: 48px; flex: none; }
.lr-brand { font-size: 18px; }
.lr-where { color: var(--text-3); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.lr-gap { flex: 1; }
.lr-top .btn { min-height: 36px; }
.lr-body { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 14px; padding-top: 8px; min-height: 0; }
.lr-screen { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 14px; min-width: 0; }
.lr-h { margin: 0; font-size: clamp(28px, 4.2vw, 46px); text-align: center; }
.lr-sub { margin: 0; color: var(--text-2); font-size: 15px; text-align: center; max-width: 60ch; }
.lr-scene { width: min(100%, 1024px); height: auto; aspect-ratio: 16 / 9; image-rendering: pixelated; display: block; }
.lr-talkback { display: flex; align-items: baseline; gap: 10px; width: min(100%, 1024px); margin: 8px auto 0; min-height: 1.5em; }
.lr-tb-lamp { flex: none; width: 8px; height: 8px; background: var(--line-2); align-self: center; }
.lr-tb-lamp.lr-on { background: var(--accent-2); }
.lr-tb-text { margin: 0; font: 400 18px/1.4 var(--font-ui); max-width: 70ch; }
.lr-tb-text .mono, .lr-tb-text kbd { font-family: var(--font-mono); }
.lr-tb-ask { flex: 1; display: flex; }
.lr-tb-field { flex: 1; font: 400 16px/1.4 var(--font-ui); background: var(--bg-2); color: var(--text); border: var(--rule-2); border-radius: var(--r-press); padding: 6px 10px; min-height: 40px; }
.ew-region-top > .ew-panel[data-panel="liveroom"] { flex: none; order: 8; display: flex; align-items: center; height: 40px; padding: 0 6px; }
.lr-key { height: 40px; min-height: 40px; padding: 0 14px; }
.lr-kbd { font: 400 12px/1 var(--font-mono); color: inherit; opacity: .7; border: var(--rule-2); border-radius: var(--r-press); padding: 3px 5px; margin-left: 10px; }
@media (hover: none) { .lr-kbd, .lr-hint { display: none; } }

/* the stage */
.lr-screen[data-screen="stage"] { align-items: stretch; }
.lr-stage { display: grid; grid-template-columns: auto minmax(240px, 360px); grid-template-areas: 'where where' 'scene side' 'tb tb' 'set set';
  column-gap: 24px; row-gap: 10px; justify-content: center; width: 100%; min-width: 0; }
.lr-stage-where { grid-area: where; }
.lr-stage .lr-stage-where .lr-h { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.lr-scenebox { grid-area: scene; min-width: 0; display: flex; justify-content: center; align-items: flex-start; }
.lr-stage .lr-scene { width: auto; aspect-ratio: auto; cursor: default; }
.lr-side { grid-area: side; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.lr-readout { display: flex; flex-direction: column; gap: 6px; }
.lr-ro { margin: 0; font: 400 16px/1.4 var(--font-ui); }
.lr-ro-tempo, .lr-counter { font-family: var(--font-mono); font-size: 16px; }
.lr-counter { color: var(--text); }
.lr-rig { display: flex; align-items: center; gap: 2px; color: var(--text-2); font-size: 15px; }
.lr-rig-step { min-width: 32px; min-height: 32px; padding: 0 6px; font-size: 18px; }
.lr-rig-name { padding: 0 4px; white-space: nowrap; }
.lr-lamps:empty { display: none; }
.lr-actions { display: flex; flex-direction: column; gap: 8px; }
.lr-actions > .lr-primary { width: 100%; }
.lr-primary { display: flex; align-items: center; justify-content: space-between; min-height: 52px; padding: 0 16px; font: 700 18px/1.2 var(--font-ui);
  background: var(--accent); color: var(--bg); border: 0; border-radius: var(--r-press); text-align: left; }
.lr-primary:hover { filter: brightness(1.05); }
.lr-primary .lr-kbd { border-color: currentColor; }
.lr-secs { display: flex; flex-wrap: wrap; gap: 8px; }
.lr-sec { display: inline-flex; align-items: center; min-height: 40px; padding: 0 12px; border-radius: var(--r-press); }
.lr-sec[hidden], .lr-primary[hidden], .lr-steppers[hidden], .lr-rig[hidden] { display: none; }
.lr-finishes { display: flex; flex-wrap: wrap; gap: 8px; }
.lr-finishes[hidden] { display: none; }
.lr-chip { min-height: 40px; padding: 0 12px; border-radius: var(--r-press); }
.lr-chip[aria-pressed="true"] { border-color: currentColor; }
.lr-steppers { display: flex; align-items: center; gap: 8px; }
.lr-step { min-width: 44px; min-height: 44px; font-size: 20px; border-radius: var(--r-press); }
.lr-step-val { min-width: 3.5ch; text-align: center; font-size: 18px; }
.lr-tbslot { grid-area: tb; min-width: 0; }
.lr-tbslot .lr-talkback { width: 100%; margin: 0; padding: 10px 0; border-top: var(--rule); border-bottom: var(--rule); }
.lr-stage[data-run="take"] .lr-readout .lr-ro > :not(.lr-counter):not(.lr-ro-tempo), .lr-stage[data-run="take"] .lr-rig, .lr-stage[data-run="take"] .lr-lamps,
.lr-stage[data-run="take"] .lr-secs, .lr-stage[data-run="take"] .lr-steppers, .lr-stage[data-run="take"] .lr-tbslot, .lr-stage[data-run="take"] .lr-setlist { opacity: .5; }
.lr-stage[data-run="take"] .lr-primary { background: var(--accent); }

/* the setlist: the cards on a strip of gaffer tape */
.lr-setlist { grid-area: set; min-width: 0; position: relative; }
.lr-cards { display: flex; gap: 10px; overflow-x: auto; overflow-y: hidden; padding: 10px 2px 12px; background: linear-gradient(transparent 46%, var(--bg-3) 46%, var(--bg-3) 70%, transparent 70%); scrollbar-width: thin; }
.lr-card { position: relative; flex: none; width: 168px; height: 96px; background: var(--bg-2); border: var(--rule-2); border-radius: var(--r-press); }
.lr-card.lr-empty { border-style: dashed; background: var(--bg); }
.lr-card.lr-sel { border-color: var(--text); }
.lr-card-main { all: unset; box-sizing: border-box; position: absolute; inset: 0; padding: 8px 30px 8px 10px; display: grid; grid-template-rows: auto auto auto 1fr; gap: 1px; cursor: pointer; color: var(--text); }
.lr-card-main:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.lr-card-name { font: 700 18px/1.15 var(--font-display); font-variation-settings: var(--font-display-vars); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lr-card-name .by { font: 400 13px/1 var(--font-ui); font-variation-settings: normal; }
.lr-card-meta { font: 400 13px/1.3 var(--font-mono); color: var(--text-2); }
.lr-card-feel { font: 400 13px/1.3 var(--font-ui); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lr-sides { position: absolute; right: 8px; bottom: 26px; pointer-events: none; display: flex; gap: 4px; }
.lr-sidelamp { font: 700 12px/1 var(--font-mono); font-style: normal; width: 16px; height: 16px; display: grid; place-items: center; border: 1px solid var(--line-2); color: var(--text-3); }
.lr-sidelamp.lr-on { color: var(--bg); background: var(--text-2); border-color: var(--text-2); }
.lr-env { position: absolute; left: 10px; bottom: 6px; width: 148px; height: 16px; color: var(--text-3); image-rendering: pixelated; }
.lr-card-more { position: absolute; top: 4px; right: 4px; width: 26px; height: 26px; padding: 0; background: none; border: 0; color: var(--text-2); font-size: 16px; cursor: pointer; border-radius: var(--r-press); }
.lr-card-more:hover, .lr-card-more:focus-visible { background: var(--bg-3); color: var(--text); }
.lr-card-head { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--accent); pointer-events: none; display: none; }
.lr-end { flex: none; align-self: center; height: 56px; padding: 0 14px; background: var(--bg); color: var(--text-2); border: var(--rule-2); border-radius: var(--r-press); font: 400 15px/1 var(--font-ui); cursor: pointer; }
.lr-end.lr-sel { border-color: var(--text); color: var(--text); }
.lr-next { flex: none; align-self: center; height: 56px; padding: 0 14px; background: none; color: var(--text-2); border: 1px dashed var(--line-2); border-radius: var(--r-press); font: 400 15px/1 var(--font-ui); cursor: pointer; }
.lr-namebox { position: absolute; left: 0; top: -48px; }
.lr-namefield { font: 400 16px/1.2 var(--font-ui); background: var(--bg-2); color: var(--text); border: var(--rule-2); border-radius: var(--r-press); padding: 8px 10px; min-height: 40px; width: 220px; }

/* a card's menu: it floats, so it casts the one shadow */
.lr-menu { position: fixed; z-index: 895; max-width: min(360px, calc(100vw - 16px)); max-height: calc(100vh - 16px); overflow: auto; background: var(--bg-3); border: var(--rule-2); box-shadow: var(--shadow-2);
  padding: 6px; display: flex; flex-direction: column; gap: 2px; outline: none; }
.lr-mi { all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; padding: 0 10px; border-radius: var(--r-press); color: var(--text); font: 400 15px/1.2 var(--font-ui); cursor: pointer; }
.lr-mi:hover, .lr-mi:focus-visible { background: var(--bg-2); outline: 1px solid var(--line-2); }
.lr-mi[disabled] { color: var(--text-3); cursor: default; }
.lr-mrow { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; padding: 2px 0; border-top: var(--rule); }
.lr-mrow .lr-mi { flex: none; }
.lr-mlabel { width: 100%; padding: 4px 10px 0; color: var(--text-3); font-size: 12px; }


@media (max-width: 760px) { .lr-tb-text { font-size: 17px; } }

/* the phone: one column, the scene a window at a whole scale, the setlist a list of 64 px rows */
.lr-stage.lr-phone { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'where' 'scene' 'tb' 'side' 'set'; row-gap: 8px; }
.lr-stage.lr-phone .lr-scenebox { margin: 0 -16px; }
.lr-stage.lr-phone .lr-tbslot .lr-talkback { padding: 6px 0; border: 0; }
.lr-stage.lr-phone .lr-primary { min-height: 56px; justify-content: center; }
.lr-stage.lr-phone[data-run="take"] .lr-primary { min-height: 40vh; }
.lr-stage.lr-phone .lr-secs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.lr-stage.lr-phone .lr-sec { min-height: 44px; justify-content: center; padding: 0 6px; }
.lr-stage.lr-phone .lr-sec .lr-kbd { display: none; }
.lr-stage.lr-phone .lr-chip { min-height: 44px; }
.lr-stage.lr-phone .lr-lamp, .lr-stage.lr-phone .lr-lamp-ask .btn, .lr-stage.lr-phone .lr-lamp-pick select { min-height: 44px; }
.lr-stage.lr-phone .lr-rig-step { min-width: 44px; min-height: 44px; }
.lr-stage.lr-phone .lr-cards { flex-direction: column; overflow: visible; background: none; padding: 0; gap: 0; }
.lr-stage.lr-phone .lr-card { width: 100%; height: 64px; border-width: 0 0 1px; border-radius: 0; background: none; }
.lr-stage.lr-phone .lr-card.lr-sel { background: var(--bg-2); }
.lr-stage.lr-phone .lr-card-main { grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto; column-gap: 12px; padding: 8px 100px 8px 4px; align-content: center; align-items: baseline; }
.lr-stage.lr-phone .lr-card-feel, .lr-stage.lr-phone .lr-env { display: none; }
.lr-stage.lr-phone .lr-sides { right: 52px; bottom: auto; top: 25px; }
.lr-stage.lr-phone .lr-card-more { top: 10px; width: 44px; height: 44px; }
.lr-stage.lr-phone .lr-end, .lr-stage.lr-phone .lr-next { width: 100%; height: 44px; margin-top: 6px; text-align: left; }
.lr-stage .lr-more[hidden], .lr-stage.lr-phone .lr-hear { display: none; }

@media (prefers-reduced-motion: reduce) { .lr * { transition: none !important; animation: none !important; scroll-behavior: auto !important; } }
`;
