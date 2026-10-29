// The drummer's look [ui; the guitar room's DRUMMER stream] (design/mock/guitar-room-2/room.css, the riser and the
// drummer's book; docs/BRAND.md "The live room"): the riser's plate (brushed steel, an amber lamp while the drummer
// plays, the bar counter in leader green: the playhead's), the beat cards (cream, the one playing lit amber), the
// book's ribbon, and the book itself (two cream pages, ink, a spine). Red is the record light's alone: none here.
//
//   CSS   the stylesheet's text (drummer.js injects it once: ui/dom.js css('gr-drummer', CSS))

export const CSS = `
.gr-layer.gr-riser { pointer-events: none; }
.gr-riser > * { pointer-events: auto; }
.gr-riser .grd-kit { position: absolute; image-rendering: pixelated; pointer-events: none; }
.gr-riser kbd, .grd-book kbd { font: 400 10.5px/1 var(--font-mono); color: inherit; border: 1px solid currentColor; border-radius: var(--r-press); padding: 2px 4px; opacity: .72; white-space: nowrap; }
@media (hover: none) { .gr-riser kbd { display: none; } }

/* the plate: the drummer's own transport */
.grd-plate { position: absolute; box-sizing: border-box; padding: 7px 9px 6px; border-radius: 3px; background: linear-gradient(160deg, #d8d8de, #9a9aa4 55%, #c4c4cc); color: #16130f;
  box-shadow: inset 0 1px 0 #fff8, 0 3px 6px #000a; display: flex; flex-direction: column; gap: 5px; }
.grd-plate button { font: inherit; color: inherit; }
.grd-go { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; font: 800 12px/1 var(--font-ui); letter-spacing: .1em; }
.grd-go:focus-visible, .grd-plate button:focus-visible { outline: 2px solid #16130f; outline-offset: 2px; }
.grd-go i { width: 10px; height: 10px; border-radius: 50%; background: #4a4a52; box-shadow: inset 0 0 0 1px #0006; flex: none; }
.grd-plate[data-on="1"] .grd-go i { background: #ffc85a; box-shadow: 0 0 8px #ffc85a; }
.grd-plate[data-count="1"] .grd-go i { background: #ffe2a0; box-shadow: 0 0 10px #ffc85a; }
.grd-go kbd { margin-left: auto; }
.grd-tempo { display: flex; align-items: center; gap: 4px; font: 700 20px/1 var(--font-mono); }
.grd-tempo b { min-width: 38px; text-align: center; font-variant-numeric: tabular-nums; }
.grd-tempo button { all: unset; cursor: pointer; font: 600 14px/1 var(--font-ui); width: 20px; height: 20px; display: grid; place-items: center; border: 1px solid #16130f55; border-radius: 2px; }
.grd-tempo button:hover { background: #ffffff40; }
.grd-tempo small { font: 700 9px/1 var(--font-ui); letter-spacing: .1em; margin-left: 1px; }
.grd-bar { margin-left: auto; font: 600 12px/1 var(--font-mono); color: #4a5228; background: #0f1410; padding: 4px 5px; border-radius: 2px; text-align: center; min-width: 50px; white-space: nowrap; }
.grd-plate[data-on="1"] .grd-bar, .grd-plate[data-count="1"] .grd-bar { color: var(--accent); }
.grd-low { display: flex; align-items: center; gap: 6px; min-width: 0; }
.grd-beat { flex: 1 1 auto; min-width: 0; font: 600 11px/1.2 var(--font-ui); color: #2a2620; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.grd-tap { all: unset; cursor: pointer; flex: none; font: 700 9.5px/1 var(--font-ui); letter-spacing: .08em; padding: 3px 5px; border: 1px solid #16130f55; border-radius: 2px; display: inline-flex; gap: 4px; align-items: center; }
.grd-tap:hover { background: #ffffff40; }
.grd-tap[data-hit="1"] { background: #fff3c8; }
.grd-tap kbd { font-size: 9px; padding: 1px 3px; }

/* the beat cards, screwed to the riser's front */
.grd-card { position: absolute; box-sizing: border-box; padding: 6px 5px 5px; border-radius: 3px; border: 0; cursor: pointer; background: #e9e1cc; color: #16130f; box-shadow: 0 3px 5px #000a;
  text-align: left; display: flex; flex-direction: column; gap: 5px; font: inherit; }
.grd-card:hover { background: #f4ead6; }
.grd-card:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.grd-mini { display: grid; grid-template-columns: repeat(16, 1fr); gap: 1px; }
.grd-mini i { height: 4px; background: #16130f14; }
.grd-mini i.h1 { background: #16130f88; } .grd-mini i.h2 { background: #16130f; }
.grd-card b { font: 700 12px/1.1 var(--font-ui); overflow-wrap: anywhere; }
.grd-card small { font: 600 9.5px/1 var(--font-ui); color: #6e6352; }
.grd-card[aria-pressed="true"] { background: #fff3c8; box-shadow: 0 0 0 2px #ffc85a, 0 3px 5px #000a; }
.grd-card[aria-pressed="true"]::after { content: ''; position: absolute; right: 5px; top: 5px; width: 6px; height: 6px; border-radius: 50%; background: #ffc85a; box-shadow: 0 0 5px #ffc85a; }
.grd-card[data-next="1"] { box-shadow: 0 0 0 2px #ffc85a88, 0 3px 5px #000a; }
.grd-card .grd-n { position: absolute; left: 5px; bottom: 4px; font: 400 9px/1 var(--font-mono); color: #6e6352; }
.grd-card small + .grd-n { display: none; }
.grd-empty { position: absolute; box-sizing: border-box; border: 1px dashed #6e6a62; border-radius: 3px; background: none; color: #9a8f7c; font: 600 11px/1.25 var(--font-ui); cursor: pointer; display: grid; place-items: center; text-align: center; padding: 6px; }
.grd-empty:hover { color: var(--text); border-color: var(--text-3); }
.grd-ribbon { position: absolute; border: 0; cursor: pointer; padding: 4px 6px; background: #3a2a1e; color: #e8dcc0; font: 600 11px/1.2 var(--font-ui); border-radius: 2px; box-shadow: 0 3px 5px #000a; display: inline-flex; gap: 6px; align-items: center; }
.grd-ribbon:hover { background: #4a3626; }

/* the drummer's book: the kit's zoom */
.gr-panel[data-target="kit"] { top: 14px; right: 14px; bottom: 14px; width: var(--bw, 780px); padding: 0; border: 0; overflow: hidden; background: var(--paper); color: var(--ink); border-radius: 3px 6px 6px 3px;
  box-shadow: 0 20px 50px #000c, inset 14px 0 18px -12px #0003; }
.gr-panel[data-target="kit"]:not([hidden]) { animation: grd-open .38s cubic-bezier(.2,.7,.2,1); }
@keyframes grd-open { from { transform: translateX(30px) rotate(.4deg); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .gr-panel[data-target="kit"]:not([hidden]) { animation: none; } }
.grd-book { position: absolute; inset: 0; display: grid; grid-template-columns: 1fr 1fr; }
.grd-book::before { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 26px; transform: translateX(-50%); background: linear-gradient(90deg, #0000, #00000022 45%, #00000033 50%, #00000022 55%, #0000); pointer-events: none; }
.grd-page { padding: 20px 24px; overflow: auto; min-height: 0; overscroll-behavior: contain; }
.grd-page h2 { margin: 0; font: 800 italic 26px/1.1 var(--font-display); font-variation-settings: var(--font-display-vars); letter-spacing: -.01em; color: var(--ink); }
.grd-page .grd-sub { margin: 4px 0 12px; color: var(--ink-3); font-size: 13px; line-height: 1.4; }
.grd-page h3 { margin: 16px 0 6px; font-size: 12px; font-weight: 700; color: var(--ink-2); letter-spacing: .04em; border-bottom: 1px solid var(--paper-rule); padding-bottom: 4px; }
.grd-book button { font: inherit; }
.grd-acts { display: flex; gap: 4px; align-items: start; flex-wrap: wrap; justify-content: flex-end; }
.grd-acts button, .grd-count button { border: 1px solid var(--paper-rule); background: none; color: var(--ink-2); border-radius: 2px; font-size: 12px; padding: 3px 7px; cursor: pointer; white-space: nowrap; }
.grd-acts button:hover, .grd-count button:hover { color: var(--ink); border-color: var(--ink-3); }
.grd-acts button:disabled { opacity: .55; cursor: default; }
.grd-book :focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }
.grd-count { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-2); margin: -4px 0 6px; }
.grd-count button[aria-pressed="true"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.grd-count kbd { color: var(--ink-3); }
.grd-pin { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; padding: 9px 0 11px; border-bottom: 1px solid var(--paper-rule); }
.grd-nm { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
.grd-nm .grd-name { display: flex; align-items: center; gap: 6px; }
.grd-pin input.grd-short { font: 700 15px/1.2 var(--font-ui); color: var(--ink); background: none; border: 0; border-bottom: 1px dashed var(--paper-rule); width: 120px; padding: 0; }
.grd-pin input.grd-short:focus { outline: none; border-bottom-color: var(--ink-2); }
.grd-from { font-size: 12px; color: var(--ink-3); }
.grd-pin[data-playing="1"] .grd-name::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #c98a10; flex: none; }
.grd-grid { grid-column: 1 / -1; display: grid; grid-template-columns: 50px repeat(16, 1fr); gap: 2px; align-items: center; }
.grd-grid span { font-size: 10.5px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.grd-grid button { height: 15px; border: 0; padding: 0; border-radius: 1px; cursor: pointer; background: #16130f12; min-width: 0; }
.grd-grid button.grd-q { box-shadow: inset 1px 0 0 #16130f30; }
.grd-grid button.h1 { background: #16130f80; } .grd-grid button.h2 { background: #16130f; }
.grd-grid button:hover { outline: 1px solid var(--ink-3); }
.grd-grid button[data-now="1"] { box-shadow: inset 0 -2px 0 #c98a10; }
.grd-tabs { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 10px; }
.grd-tabs button { border: 1px solid var(--paper-rule); background: #efe3c9; color: var(--ink-2); border-radius: 2px 2px 0 0; font-size: 12px; padding: 3px 7px; cursor: pointer; }
.grd-tabs button[aria-pressed="true"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.grd-gv { display: grid; grid-template-columns: 1fr auto; gap: 3px 10px; padding: 7px 0 9px; border-bottom: 1px dotted var(--paper-rule); }
.grd-gv .grd-gn { font-weight: 700; font-size: 13.5px; color: var(--ink); }
.grd-gv .grd-gn small { font-weight: 400; color: var(--ink-3); margin-left: 6px; font-size: 12px; }
.grd-gv .grd-vmini { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(16, 1fr); gap: 1px; max-width: 300px; }
.grd-gv .grd-vmini i { height: 4px; background: #16130f12; } .grd-gv .grd-vmini i.h1 { background: #16130f80; } .grd-gv .grd-vmini i.h2 { background: #16130f; }
.grd-gv[data-playing="1"] .grd-gn::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #c98a10; margin-right: 6px; vertical-align: 1px; }
`;
