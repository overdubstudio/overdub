// Getting started's look [ui; the guitar room's START stream] (docs/BRAND.md "The live room"; design/mock/guitar-room-2/
// room.css .callout, .spot). The engineer's slate on leader-tape paper beside what it's about (never over it), the
// spotlight that dims the rest of the stage, the ring round the jack, and the header's Getting started button. The
// tokens are app/style/tokens.css's; amber is the room's lamp; leader green only the slate's one primary action; no red.
//
//   CSS   the stylesheet's text (./start.js injects it once: css('gr-start', CSS))

export const CSS = `
.gr-callout.gr-co { width: 380px; max-width: calc(100% - 32px); max-height: calc(100% - 32px); overflow: auto; top: 16px; padding: 16px 18px 12px; box-sizing: border-box;
  background: var(--paper); color: var(--ink); border: 0; border-radius: 2px; box-shadow: 0 18px 40px #000c; font: 400 14px/1.45 var(--font-ui);
  --text: var(--ink); --text-2: var(--ink-2); --text-3: var(--ink-3); --line-2: var(--paper-rule); --bg-3: #e6dac2; --ok: #3a6a2a; --warn: #9a5a00; }
.gr-co[data-side="right"] { right: 16px; left: auto; transform: none; }
.gr-co[data-side="left"] { left: 16px; right: auto; transform: none; }
.gr-co[data-side="top"] { left: 50%; right: auto; transform: translateX(-50%); width: min(660px, calc(100% - 32px)); top: 12px; }
.gr-co-steps { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 0 0 8px; padding: 0; list-style: none; font: 700 11px/1.3 var(--font-ui); color: var(--ink-3); letter-spacing: .03em; }
.gr-co-steps li { display: inline-flex; align-items: center; gap: 4px; }
.gr-co-steps i { width: 7px; height: 7px; border-radius: 50%; background: var(--paper-rule); }
.gr-co-steps .done i { background: #6a8a5a; }
.gr-co-steps .now { color: var(--ink); }
.gr-co-steps .now i { background: #c98a10; box-shadow: 0 0 5px #c98a10; }
.gr-co h2 { margin: 0 0 6px; font: 800 italic 22px/1.1 var(--font-display); font-variation-settings: var(--font-display-vars); color: var(--ink); letter-spacing: -.01em; }
.gr-co p { margin: 6px 0; color: var(--ink-2); }
.gr-co .gr-co-v { color: var(--ink); font-weight: 600; }
.gr-co .gr-co-small { font-size: 12px; color: var(--ink-3); }
.gr-co .gr-co-from { font: 600 12px/1.3 var(--font-ui); color: var(--ink-3); margin: 2px 0 8px; }
.gr-co-acts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
.gr-co-acts .gr-co-skip { margin-left: auto; }
.gr-co-acts.one { flex-wrap: nowrap; gap: 6px; }
.gr-co-acts.one .gr-co-b { padding: 0 10px; }
.gr-co-b.go kbd { opacity: .9; }
.gr-co-b { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 36px; padding: 0 12px; border: 1px solid var(--paper-rule); border-radius: var(--r-press);
  background: none; color: var(--ink); font: 600 13px/1 var(--font-ui); cursor: pointer; white-space: nowrap; }
.gr-co-b:hover { border-color: var(--ink-3); }
.gr-co-b.go { background: var(--accent); border-color: #a8b84a; }
.gr-co-b:disabled { opacity: .45; cursor: default; }
.gr-co-b:focus-visible, .gr-co-chip:focus-visible { outline: 2px solid var(--ink-agent); outline-offset: 2px; }
.gr-co-tkey[hidden], .gr-co kbd[hidden] { display: none; }
.gr-co kbd { font: 400 11px/1 var(--font-mono); color: inherit; border: 1px solid currentColor; border-radius: var(--r-press); padding: 2px 4px; opacity: .72; white-space: nowrap; }
.gr-co-esc { margin: 10px 0 0 !important; font-size: 11.5px; color: var(--ink-3) !important; }
.gr-co-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.gr-co-chip { border: 1px solid var(--paper-rule); background: none; color: var(--ink-2); border-radius: 2px; padding: 5px 8px; min-height: 30px; font: 500 12.5px/1.1 var(--font-ui); cursor: pointer; text-align: left; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gr-co-chip[aria-pressed="true"] { color: var(--paper); background: var(--ink); border-color: var(--ink); }
.gr-co-gauge { margin: 10px 0 4px; }
.gr-co .gg-level .gg-lv-clip { color: var(--ink-3); }
.gr-co .gg-timing .gg-tm-acts .go { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.gr-co .gg-tm-line { height: 70px; }
.gr-co-strings { display: flex; gap: 6px; margin: 10px 0; }
.gr-co-strings span { flex: 1; text-align: center; padding: 6px 0 4px; border: 1px solid var(--paper-rule); border-radius: 2px; font: 700 14px/1 var(--font-mono); color: var(--ink-3); }
.gr-co-strings span small { display: block; font: 600 10px/1 var(--font-ui); margin-top: 4px; }
.gr-co-strings span.ok { color: #3a6a2a; border-color: #6a8a5a; }

.gr-spot .gr-gs-dim { position: absolute; left: -2400px; top: -1600px; width: 6240px; height: 4004px; pointer-events: none !important; background: #07060a; opacity: .66;
  mask-composite: intersect; -webkit-mask-composite: source-in; }
.gr-spot .gr-gs-dim[hidden], .gr-spot .gr-gs-pool[hidden] { display: none; }
.gr-spot .gr-gs-pool { position: absolute; border-radius: 50%; pointer-events: none !important;
  background: radial-gradient(closest-side, #ffc85a00 62%, #ffc85a1c 92%, #ffc85a00 100%); }
.gr-spot .gr-gs-ring { position: absolute; border-radius: 50%; border: 2px solid #ffc85a; box-shadow: 0 0 10px #ffc85a88; pointer-events: none !important; }
.gr-spot .gr-gs-ring[hidden] { display: none; }
.gr-spot .gr-gs-ring.gr-pulse { animation: gr-gs-ring 1s ease-out 2; }
@keyframes gr-gs-ring { from { transform: scale(.6); opacity: 1; } to { transform: scale(1.6); opacity: .25; } }
.gr-strip.gr-gs-lit { box-shadow: inset 0 2px 0 #ffc85a, 0 -8px 24px #ffc85a2a; }

.lr-tools .gr-gs-btn { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font: 600 13px/1 var(--font-ui); color: var(--text-2); white-space: nowrap; padding: 6px 2px; }
.lr-tools .gr-gs-btn:hover, .lr-tools .gr-gs-btn[aria-expanded="true"] { color: var(--text); }
.lr-tools .gr-gs-btn:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .gr-spot .gr-gs-ring.gr-pulse { animation: none; } }
@media (max-width: 720px) { .gr-co[data-side] { left: 8px; right: 8px; width: auto; transform: none; top: 8px; } }
`;
