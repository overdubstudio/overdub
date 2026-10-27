// The takes' stylesheet [ui; the guitar room's TAKES stream] (docs/BRAND.md "The live room"; design/mock/guitar-room/
// mock.css's .rec, .sheet, .card and .lane; design/mock/guitar-room-2/room.css's .drawer). The recording view over the
// room (R.el.over), the take's review sheet (R.sheet('review')), the part line in the drawer (R.el.drawer.parts) and the
// drawer's two columns (the riff tray's and the part line's, as the second mock has them). The studio's tokens
// (app/style/tokens.css): square containers, one 2 px radius for what you press, leader green for the playhead and the
// one primary action (Keep), amber for a lamp, red for the record light alone.
//
//   CSS   the text (./takes.js injects it once: ui/dom.js css('gr-takes', CSS))

export const CSS = `
.gr { --grt-lamp: #ffc85a; --grt-lamp-ink: #16130f; }
.gr kbd.grt-k { font: 400 12px/1 var(--font-mono); color: inherit; border: var(--rule-2); border-radius: var(--r-press); padding: 3px 5px; opacity: .85; white-space: nowrap; }

/* the drawer: the riff tray on the left, the part line beside it (the second mock's) */
.gr-drawer { grid-template-columns: minmax(0, 340px) minmax(0, 1fr); grid-template-rows: auto; gap: 24px; padding: 12px 16px 14px;
  background: rgba(14, 12, 16, .965); border-top: 1px solid #262229; z-index: 2; }
.gr-drawer:has(> .gr-tray:empty) { grid-template-columns: minmax(0, 1fr); }
.gr-drawer > .gr-parts { grid-column: -2 / -1; min-width: 0; }

/* the part line */
.grt-parts { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.grt-row { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--text-3); min-height: 24px; flex-wrap: wrap; }
.grt-row .grt-name { color: var(--text); font-weight: 600; font-size: 14px; }
.grt-row .grt-gap { flex: 1; }
.grt-row .grt-help { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.grt-txt { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); font-weight: 600;
  text-decoration: underline; text-decoration-color: var(--line-2); text-underline-offset: 3px; white-space: nowrap; }
.grt-txt:hover { color: var(--text); }
.grt-txt:focus-visible, .grt-card:focus-visible, .grt-add:focus-visible, .grt-b:focus-visible, .grt-h:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.grt-lane { position: relative; display: flex; align-items: center; gap: 0; overflow-x: auto; overflow-y: hidden; padding: 8px 2px 10px; min-height: 150px;
  scrollbar-width: thin; background: linear-gradient(transparent 44%, var(--bg-3) 44%, var(--bg-3) 70%, transparent 70%); outline: none; }
.grt-lane:has(> .grt-empty) { background: none; }
.grt-lane:focus-visible { box-shadow: inset 0 0 0 1px var(--accent-2); }
.grt-card { position: relative; flex: none; width: 200px; height: 128px; background: var(--bg-2); border: var(--rule-2); border-radius: var(--r-press);
  cursor: grab; user-select: none; touch-action: none; box-sizing: border-box; }
.grt-card[aria-selected="true"] { border-color: var(--text); box-shadow: 0 0 0 1px var(--text); }
.grt-card.grt-dragging { opacity: .35; }
.grt-card .grt-in { position: absolute; inset: 0; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
.grt-card .grt-cn { font: 800 18px/1.2 var(--font-display); font-style: italic; font-variation-settings: 'wdth' 112; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; padding-right: 64px; }
.grt-card .grt-cm { font: 400 12px/1.3 var(--font-mono); color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.grt-card .grt-cs { font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.grt-card .grt-cs .by { font-weight: 600; }
.grt-card canvas { position: absolute; left: 10px; bottom: 9px; width: calc(100% - 20px); height: 30px; }
.grt-card .grt-x { all: unset; cursor: pointer; position: absolute; top: 5px; right: 6px; width: 22px; height: 22px; display: grid; place-items: center; color: var(--text-3);
  font-size: 16px; border-radius: var(--r-press); }
.grt-card .grt-x:hover { color: var(--text); background: var(--bg-3); }
.grt-card .grt-sides { position: absolute; right: 34px; top: 10px; display: flex; gap: 3px; }
.grt-card .grt-sides i { font: 700 11px/1 var(--font-mono); font-style: normal; width: 16px; height: 16px; display: grid; place-items: center; border: 1px solid var(--line-2);
  color: var(--text-3); box-sizing: border-box; }
.grt-card .grt-sides i.grt-on { background: var(--grt-lamp); border-color: var(--grt-lamp); color: var(--grt-lamp-ink); }
.grt-card .grt-head { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--accent); pointer-events: none; }
.grt-card input.grt-rename { position: absolute; left: 8px; right: 60px; top: 6px; font: 800 17px/1.2 var(--font-display); font-style: italic; background: var(--bg);
  color: var(--text); border: var(--rule-2); border-radius: var(--r-press); padding: 1px 4px; }
.grt-gap { flex: none; width: 10px; align-self: stretch; position: relative; transition: width .12s var(--ease); }
.grt-gap.grt-hot { width: 84px; }
.grt-gap.grt-hot::after { content: 'Here'; position: absolute; inset: 14px 4px; border: 1px dashed var(--text-2); border-radius: var(--r-press); display: grid; place-items: center;
  color: var(--text); font-size: 13px; font-weight: 600; }
.grt-add { all: unset; cursor: pointer; flex: none; box-sizing: border-box; height: 56px; padding: 0 14px; margin-left: 4px; display: inline-flex; align-items: center; gap: 8px;
  border: 1px dashed var(--line-2); border-radius: var(--r-press); color: var(--text-2); font-size: 13px; font-weight: 600; background: var(--bg); }
.grt-add:hover { color: var(--text); border-color: var(--text-3); }
.grt-add[aria-selected="true"] { border-style: solid; border-color: var(--text); color: var(--text); }
.grt-empty { flex: 1; align-self: stretch; margin: 6px 0; border: 1px dashed var(--line-2); border-radius: var(--r-press); display: flex; align-items: center; padding: 0 18px;
  background: var(--bg); color: var(--text-2); font-size: 14px; cursor: pointer; }
.grt-empty.grt-hot { border-color: var(--text); color: var(--text); }
.grt-empty b { color: var(--text); }
.grt-ghost { position: fixed; z-index: 60; pointer-events: none; opacity: .92; box-shadow: var(--shadow-2); transform: rotate(-1.5deg); }

/* the recording view: the room dimmed, big words you read from where you stand */
.gr-over.grt-rec { background: rgba(16, 14, 12, .86); backdrop-filter: blur(1.5px); display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: clamp(14px, 3vh, 26px); padding: 24px; text-align: center; }
.grt-rec-top { display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--text-2); }
.grt-lampx { width: 14px; height: 14px; display: inline-block; background: var(--grt-lamp); }
.grt-lampx.grt-recl { background: var(--rec); }
.grt-rec-part { margin: 0; font: 800 clamp(48px, 9vh, 88px)/1 var(--font-display); font-style: italic; font-variation-settings: var(--font-display-vars); color: var(--text);
  max-width: 92%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grt-rec-count { font: 800 clamp(96px, 20vh, 180px)/1 var(--font-display); font-style: italic; font-variation-settings: var(--font-display-vars); color: var(--text); min-height: 1em; }
.grt-rec-bar { font: 400 clamp(28px, 5vh, 40px)/1 var(--font-mono); color: var(--text); }
.grt-rec-bar .grt-of { color: var(--text-3); }
.grt-rec-bar .grt-past { color: var(--grt-lamp); }
.grt-rec-strip { position: relative; width: min(1000px, 86%); height: 64px; }
.grt-rec-strip canvas { width: 100%; height: 100%; display: block; }
.grt-rec-keys { display: flex; gap: clamp(20px, 4vw, 44px); align-items: center; flex-wrap: wrap; justify-content: center; }
.grt-rk { all: unset; cursor: pointer; display: flex; align-items: center; gap: 14px; font-size: clamp(20px, 3vh, 26px); font-weight: 600; color: var(--text); }
.grt-rk kbd { font: 400 20px/1 var(--font-mono); padding: 10px 14px; border: 2px solid var(--text-2); border-radius: var(--r-press); min-width: 56px; text-align: center; box-sizing: border-box; }
.grt-rk.grt-dim { color: var(--text-3); }
.grt-rk.grt-dim kbd { border-color: var(--line-2); }
.grt-rec-note { color: var(--text-3); font-size: 15px; max-width: 64ch; margin: 0; }

/* the take's review: the bar grid, the handles, Keep / Toss / Again */
.gr-sheet[data-sheet="review"] { margin: 0 16px 12px; border: var(--rule-2); background: var(--bg); box-shadow: var(--shadow-2); padding: 14px 18px; display: flex; flex-direction: column;
  gap: 12px; max-height: none; overflow: visible; }
.grt-rv-h { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
.grt-rv-h h2 { margin: 0; font: 800 24px/1.1 var(--font-display); font-style: italic; font-variation-settings: var(--font-display-vars); color: var(--text); white-space: nowrap; }
.grt-rv-h .grt-meta { font: 400 13px/1.3 var(--font-mono); color: var(--text-2); flex: 1 1 280px; min-width: 0; }
.grt-rv-h .grt-hearing { color: var(--text-3); font-size: 13px; white-space: nowrap; }
.grt-tl { position: relative; height: 172px; background: var(--bg); border: var(--rule); user-select: none; touch-action: none; }
.grt-tl.grt-two { height: 208px; }
.grt-tl canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.grt-h { position: absolute; top: 0; bottom: 0; width: 22px; margin-left: -11px; cursor: ew-resize; z-index: 2; outline: none; }
.grt-h::before { content: ''; position: absolute; left: 10px; top: 0; bottom: 0; width: 2px; background: var(--text); }
.grt-h::after { content: ''; position: absolute; left: 5px; top: -1px; width: 12px; height: 18px; background: var(--text); border-radius: var(--r-press); }
.grt-h span { position: absolute; top: 20px; left: 15px; font: 400 11px/1 var(--font-mono); color: var(--text); white-space: nowrap; background: var(--bg); padding: 2px 4px; pointer-events: none; }
.grt-h.grt-out span { left: auto; right: 15px; }
/* (the part's end sits on the out handle whenever a take stops just past a bar line: it's grabbed by its lower half, where
   its knob is, and the in and out handles by the rest, so neither hides the other) */
.grt-h.grt-pe { top: 58%; z-index: 3; }
.grt-h.grt-pe::before { background: var(--grt-lamp); width: 2px; }
.grt-h.grt-pe::after { top: auto; bottom: -1px; background: var(--grt-lamp); }
.grt-h.grt-pe span { top: auto; bottom: 20px; color: var(--grt-lamp); }
.grt-rv-f { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.grt-rv-f .grt-gap { flex: 1; }
.grt-rv-f .grt-note { color: var(--text-3); font-size: 13px; }
.grt-rv-f .grt-list { font-size: 13px; color: var(--text-3); }
.grt-rv-f .grt-list b { color: var(--text); }
.grt-b { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 40px; padding: 0 14px;
  border: var(--rule-2); border-radius: var(--r-press); color: var(--text); font-weight: 600; }
.grt-b:hover { border-color: var(--text-3); }
.grt-b.grt-go { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.grt-b.grt-go kbd { border-color: currentColor; }
@media (prefers-reduced-motion: reduce) { .grt-gap { transition: none; } }
`;
