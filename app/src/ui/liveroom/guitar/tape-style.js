// The tape stream's look [ui; the guitar room's TAPE stream] (docs/BRAND.md; design/mock/guitar-room-2/ room.css, the
// first mock's mock.css for the tray, the library and the talkback): the last minute's sheet, the riff tray in the
// drawer, the library over the view, and the talkback's field in the strip. Tokens are app/style/tokens.css's; red is
// the record light's alone; leader green is the primary action and the playhead (a riff's loop) only; grease pencil
// marks the selection on the tape.
//
//   CSS   injected once by ./tape.js (ui/dom.js css('gr-tape', CSS))

export const CSS = `
.gr-gap { flex: 1 1 auto; }
.gr-t3 { color: var(--text-3); }
:is(.gr-tp, .gr-lb, .gr-tks, .gr-tk, .gr-ty) .btn { height: 40px; padding: 0 14px; font-size: 14px; }
:is(.gr-tp, .gr-lb, .gr-tks, .gr-tk, .gr-ty) .btn kbd { margin-left: 8px; }
:is(.gr-tp, .gr-lb, .gr-tks, .gr-tk, .gr-ty) .btn-go kbd { color: inherit; border-color: currentColor; opacity: .75; }
:is(.gr-tp, .gr-lb, .gr-tks, .gr-tk, .gr-ty) .btn-txt { height: auto; min-height: 28px; padding: 0 2px; font-size: 13px; }

/* the last minute */
.gr-sheet.gr-tp { margin: 0 16px 16px; height: 344px; max-height: none; overflow: hidden; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 10px;
  padding: 14px 16px; background: #0e0c10f6; border: 1px solid #2a262d; }
.gr-tp-head { display: flex; align-items: baseline; gap: 14px; min-width: 0; }
.gr-tp-h2 { margin: 0; font: 800 24px/1.1 var(--font-display); font-style: italic; font-variation-settings: var(--font-display-vars); white-space: nowrap; }
.gr-tp-meta { font: 400 14px/1 var(--font-mono); color: var(--text-2); white-space: nowrap; }
.gr-tp-span { color: var(--text-3); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.gr-tp-wrap { position: relative; min-height: 0; background: #0b090d; border: var(--rule); user-select: none; touch-action: none; cursor: col-resize; }
.gr-tp-cv { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.gr-tp-h { position: absolute; top: 0; bottom: 0; width: 22px; margin-left: -11px; cursor: ew-resize; z-index: 2; outline: none; }
.gr-tp-h::before { content: ''; position: absolute; left: 10px; top: 0; bottom: 0; width: 2px; background: var(--accent-2); }
.gr-tp-h::after { content: ''; position: absolute; left: 4px; bottom: 0; width: 14px; height: 22px; background: var(--accent-2); border-radius: var(--r-press); }
.gr-tp-h:focus::after { outline: 2px solid var(--text); outline-offset: 2px; }
.gr-tp-h span { position: absolute; top: 24px; left: 15px; font: 400 11px/1 var(--font-mono); color: var(--text); background: #0b090d; padding: 2px 4px; white-space: nowrap; pointer-events: none; }
.gr-tp-out span { left: auto; right: 15px; }
.gr-tp-empty { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--text-3); font-size: 15px; pointer-events: none; }
.gr-tp-foot { display: flex; align-items: center; gap: 10px; color: var(--text-3); font-size: 13px; min-width: 0; }
.gr-tp-foot .btn { flex: none; }
.gr-tp-lamp { width: 8px; height: 8px; background: var(--line-2); flex: none; }
.gr-tp-snap[aria-pressed="true"] .gr-tp-lamp { background: var(--lr-lamp, #ffc85a); }
.gr-tp-note { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }

/* the drawer: the riffs beside the part line (its columns are the takes stream's, ./takes-style.js: one place) */
.gr-ty { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.gr-ty-tape { all: unset; cursor: pointer; display: flex; align-items: center; gap: 10px; height: 26px; color: var(--text-3); font-size: 12px; }
.gr-ty-tape:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.gr-ty-line { flex: 1 1 auto; height: 18px; min-width: 0; opacity: .55; }
.gr-ty-tape:hover .gr-ty-line { opacity: .9; }
.gr-ty-tape:hover { color: var(--text-2); }
.gr-ty-tl { white-space: nowrap; display: inline-flex; gap: 6px; align-items: center; }
.gr-ty-h { display: flex; align-items: baseline; gap: 10px; font-size: 13px; color: var(--text-3); min-height: 28px; }
.gr-ty-name { color: var(--text); font-weight: 600; font-size: 14px; }
.gr-ty-lane { display: flex; gap: 10px; overflow-x: auto; overflow-y: hidden; padding: 4px 2px 8px; min-height: 120px; align-items: stretch; scrollbar-width: thin; }
.gr-ty-card { position: relative; flex: none; width: 176px; height: 112px; box-sizing: border-box; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px;
  background: var(--bg-2); color: var(--text); border: var(--rule-2); border-radius: var(--r-press); cursor: grab; user-select: none; touch-action: none; }
.gr-ty-card:hover { border-color: var(--text-3); }
.gr-ty-card:focus-visible { outline: 2px solid var(--text); outline-offset: 1px; }
.gr-ty-card.gr-ty-on { border-color: var(--text); }
.gr-ty-cn { font: 700 18px/1.2 var(--font-display); font-style: italic; font-variation-settings: 'wdth' 112; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gr-ty-cm { font: 400 12px/1.3 var(--font-mono); color: var(--text-2); white-space: nowrap; }
.gr-ty-cs { font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gr-ty-wave { position: absolute; left: 10px; right: 10px; bottom: 10px; width: calc(100% - 20px); height: 28px; }
.gr-ty-loop { position: absolute; left: 10px; bottom: 5px; height: 2px; width: 0; background: var(--accent); display: none; }
.gr-ty-on .gr-ty-loop { display: block; }
.gr-ty-dragging { opacity: .35; }
.gr-ty-ghost { position: fixed; z-index: 2000; pointer-events: none; opacity: .94; box-shadow: var(--shadow-2); cursor: grabbing; }
.gr-ty-empty { margin: 0; align-self: center; max-width: 40ch; color: var(--text-3); font-size: 14px; line-height: 1.45; }

/* the library, over the view */
.gr-sheet.gr-lb { position: relative; z-index: 2; max-height: none; overflow: hidden; border-top: 0; padding: 14px clamp(16px, 2.4vw, 32px) 0; box-sizing: border-box;
  display: grid; grid-template-columns: 210px minmax(0, 1fr) 320px; grid-template-rows: auto auto minmax(0, 1fr); grid-template-areas: 'head head head' 'filters filters filters' 'songs list detail'; column-gap: 20px; }
.gr-lb-head { grid-area: head; display: flex; align-items: center; gap: 18px; padding-bottom: 8px; min-width: 0; }
.gr-lb-h2 { margin: 0; font: 800 34px/1 var(--font-display); font-style: italic; font-variation-settings: var(--font-display-vars); }
.gr-lb-count { color: var(--text-3); font-size: 14px; white-space: nowrap; }
.gr-lb-search { display: flex; align-items: center; gap: 8px; width: 340px; max-width: 36%; height: 40px; padding: 0 10px; box-sizing: border-box; background: var(--bg-2); border: var(--rule-2); border-radius: var(--r-press); }
.gr-lb-search:focus-within { outline: 2px solid var(--accent-2); }
.gr-lb-glass { color: var(--text-3); }
.gr-lb-q { all: unset; flex: 1 1 auto; min-width: 0; font: 400 15px/1.2 var(--font-ui); color: var(--text); }
.gr-lb-filters { grid-area: filters; display: flex; gap: 22px; flex-wrap: wrap; align-items: baseline; font-size: 13px; padding: 2px 0 10px; border-bottom: var(--rule); }
.gr-lb-f { display: inline-flex; gap: 8px; align-items: baseline; }
.gr-lb-f > span { color: var(--text-3); }
.gr-lb-chip[aria-pressed="true"] { color: var(--text); text-decoration-color: var(--text); text-decoration-thickness: 2px; }
.gr-lb-songs { grid-area: songs; overflow: auto; padding: 12px 12px 16px 0; border-right: var(--rule); min-height: 0; }
.gr-lb-songs h3, .gr-lb-detail h3 { margin: 0 0 8px; font: 600 13px/1.2 var(--font-ui); color: var(--text-3); }
.gr-lb-song { all: unset; cursor: pointer; box-sizing: border-box; width: 100%; display: flex; justify-content: space-between; gap: 8px; padding: 7px 8px; font-size: 14px; color: var(--text-2); }
.gr-lb-song > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gr-lb-song:hover { background: var(--bg-2); color: var(--text); }
.gr-lb-song:focus-visible { outline: 2px solid var(--text); outline-offset: -2px; }
.gr-lb-song[aria-pressed="true"] { background: var(--text); color: var(--bg); }
.gr-lb-n { font: 400 12px/1.4 var(--font-mono); opacity: .8; }
.gr-lb-mid { grid-area: list; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
.gr-lb-list { flex: 1 1 auto; overflow: auto; outline: none; padding-bottom: 16px; min-height: 0; }
.gr-lb-list:focus-visible { box-shadow: inset 0 0 0 1px var(--line-2); }
.gr-lb-row, .gr-lb-th { display: grid; grid-template-columns: 18px minmax(90px, 1.3fr) minmax(70px, 1fr) 96px 62px 40px 88px 70px minmax(70px, 1fr); align-items: center; column-gap: 10px;
  padding: 0 8px; height: 38px; border-bottom: var(--rule); font-size: 14px; white-space: nowrap; }
.gr-lb-row > span, .gr-lb-th > span { overflow: hidden; text-overflow: ellipsis; }
.gr-lb-th { position: sticky; top: 0; z-index: 1; height: 32px; background: var(--bg); font: 600 12px/1 var(--font-ui); color: var(--text-3); border-bottom: var(--rule-2); }
.gr-lb-row { cursor: pointer; }
.gr-lb-row:hover { background: var(--bg-2); }
.gr-lb-row[aria-selected="true"] { background: var(--text); color: var(--bg); }
.gr-lb-row[aria-selected="true"] .gr-t3 { color: var(--bg); opacity: .75; }
.gr-lb-nm { font-weight: 600; }
.gr-lb-num { font: 400 13px/1 var(--font-mono); }
.gr-lb-st { color: var(--lr-lamp, #ffc85a); }
.gr-lb-row[aria-selected="true"] .gr-lb-st { color: var(--bg); }
.gr-lb-wv { width: 96px; height: 20px; display: block; }
.gr-lb-grp { height: 30px; display: flex; align-items: flex-end; padding: 0 8px 6px; box-sizing: border-box; font: 600 12px/1 var(--font-ui); color: var(--text-3); border-bottom: var(--rule-2); }
.gr-lb-empty, .gr-lb-more { color: var(--text-3); padding: 18px 8px; margin: 0; font-size: 14px; }
.gr-lb-gone { display: flex; gap: 12px; align-items: center; padding: 6px 8px; margin: 8px 0; border: var(--rule-2); font-size: 14px; }
.gr-lb-detail { grid-area: detail; overflow: auto; min-height: 0; border-left: var(--rule); padding: 12px 0 16px 18px; display: flex; flex-direction: column; gap: 12px; }
.gr-lb-dn { margin: 0; font: 800 26px/1.1 var(--font-display); font-style: italic; font-variation-settings: 'wdth' 112; overflow-wrap: anywhere; }
.gr-lb-rename { font: 600 20px/1.2 var(--font-ui); background: var(--bg-2); color: var(--text); border: var(--rule-2); border-radius: var(--r-press); padding: 6px 8px; }
.gr-lb-big { width: 100%; height: 64px; display: block; }
.gr-lb-facts { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 14px; }
.gr-lb-facts dt { color: var(--text-3); }
.gr-lb-facts dd { margin: 0; }
.gr-lb-acts { display: flex; flex-direction: column; gap: 8px; }
.gr-lb-acts .btn { justify-content: space-between; }
.gr-lb-del { color: var(--text-3); }
.gr-lb-hint { margin: 0; font-size: 13px; color: var(--text-3); line-height: 1.5; }
@media (max-width: 1320px) {
  .gr-sheet.gr-lb { grid-template-columns: 180px minmax(0, 1fr) 280px; }
  .gr-lb-row, .gr-lb-th { grid-template-columns: 18px minmax(90px, 1.3fr) minmax(70px, 1fr) 62px 40px 88px 64px; }
  .gr-lb-wv, .gr-lb-th > span:nth-child(4), .gr-lb-stk, .gr-lb-th > span:nth-child(9) { display: none; }
}

/* Claude on the talkback: the field in the strip, what to ask above it */
.gr-strip-talk.gr-tk { position: relative; display: flex; align-items: center; gap: 12px; min-width: 0; }
.gr-tk .lr-talkback { flex: 1 1 auto; min-width: 0; align-items: center; }
.gr-tk .lr-tb-text { font-size: 15px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: none; }
.gr-tk.gr-tk-on .lr-talkback { display: none; }
.gr-tk-form { flex: 1 1 auto; display: flex; align-items: center; gap: 10px; min-width: 0; }
.gr-tk-lamp { flex: none; width: 8px; height: 8px; background: var(--agent); }
.gr-tk-field { flex: 1 1 auto; min-width: 0; min-height: 38px; padding: 6px 10px; box-sizing: border-box; font: 400 16px/1.4 var(--font-ui); background: var(--bg-2); color: var(--text); border: var(--rule-2); border-radius: var(--r-press); }
.gr-tk-field:focus { outline: 2px solid var(--agent); outline-offset: 0; }
.gr-tk .gr-tk-btn { flex: none; height: 36px; font-weight: 400; color: var(--text-2); border-color: var(--line); gap: 8px; }
.gr-tk .gr-tk-btn:hover { color: var(--text); }
.gr-tk-who { width: 7px; height: 7px; background: var(--line-2); flex: none; }
.gr-tk-here .gr-tk-who { background: var(--agent); }
.gr-tk-asked { position: absolute; left: 0; bottom: calc(100% + 8px); max-width: min(100%, 900px); box-sizing: border-box; padding: 5px 10px; font-size: 14px; color: var(--text-2);
  background: #0e0c10f2; border: var(--rule); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 3; }
.gr-tk-s { color: var(--text-3); }
.gr-sheet.gr-tks { position: relative; z-index: 2; max-height: none; margin: 0 16px 10px; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; background: #0e0c10f6; border: var(--rule-2); }
.gr-tks-who { margin: 0; font-size: 14px; color: var(--text-2); }
.gr-tks-last p { margin: 0 0 4px; font-size: 15px; line-height: 1.4; }
.gr-tks-ideas { display: flex; gap: 14px; flex-wrap: wrap; align-items: baseline; font-size: 13px; }
.gr-tks-keys { margin: 0; font-size: 12px; color: var(--text-3); }
@media (prefers-reduced-motion: reduce) { .gr-ty-ghost { transition: none; } }
`;
