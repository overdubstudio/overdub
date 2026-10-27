// The shop's styles [ui; the guitar room's SHOP stream] (docs/BRAND.md "The live room"; the second mock's room.css, its
// shop and cab parts): pixel walls behind, the real gear crisp in front, brass name plates, amber lamps, the studio's
// tokens (app/style/tokens.css). Red is the record light's alone: nothing here is red. Injected once by ./shop.js
// (ui/dom.js css('gr-shop', CSS)); every rule is under .gr, the guitar room's screen.
//
//   CSS   the stylesheet's text

export const CSS = `
.gr { --lamp: #ffc85a; --lamp-hi: #ffe2a0; --brass: #e3d3a8; --brass-ink: #16130f; --brass-edge: #a8946a; }
.gr .grs-layer { position: absolute; inset: 0; }
/* the layers lie over each other: only the things in them take a pointer */
.gr .grs, .gr .grs > div[role=listbox]:not(.grs-rack) { pointer-events: none; }
.gr .grs-bar, .gr .grs-door, .gr .grs-amp, .gr .grs-ped, .gr .grs-cats, .gr .grs-stackplate, .gr .grs-head, .gr .grs-nohead, .gr .grs-cab, .gr .grs-slot, .gr .grs-add, .gr .grs-rack, .gr .grs-sheet { pointer-events: auto; }
.gr .grs-layer[hidden] { display: none; }
.gr .grs-disp { font-family: var(--font-display); font-style: italic; font-weight: 800; font-stretch: 125%; font-variation-settings: 'wdth' 125; letter-spacing: -.01em; }
.gr .grs kbd, .gr .grs-panel kbd { font: 400 11px/1 var(--font-mono); color: inherit; border: 1px solid currentColor; border-radius: var(--r-press); padding: 2px 4px; opacity: .72; white-space: nowrap; }
.gr .grs button { font: inherit; color: inherit; }

/* the bar along the shop's ceiling: the way back, the wall, the case, the rack */
.gr .grs-bar { position: absolute; display: flex; gap: 8px; align-items: center; }
.gr .grs-bar button { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; border: 1px solid #3a3238; border-radius: var(--r-press); background: #0e0c10e0; color: var(--text-2); font: 600 13px/1 var(--font-ui); cursor: pointer; white-space: nowrap; }
.gr .grs-bar button:hover { color: var(--text); border-color: var(--text-3); }
.gr .grs-bar button[aria-pressed="true"] { background: var(--paper); color: var(--ink); border-color: var(--paper); }

/* the door back to the stage */
.gr .grs-door { position: absolute; background: none; border: 0; padding: 0; cursor: pointer; }
.gr .grs-door::after { content: attr(data-say); position: absolute; left: 50%; top: calc(100% + 8px); transform: translateX(-50%); white-space: nowrap; font: 600 12px/1 var(--font-ui); color: var(--text); background: #0e0c10ee; border: 1px solid var(--line-2); padding: 5px 8px; opacity: 0; transition: opacity .15s; pointer-events: none; }
.gr .grs-door:hover::after, .gr .grs-door:focus-visible::after { opacity: 1; }

/* the amp wall: each amp a little amp on its shelf with its brass name plate */
.gr .grs-amp { position: absolute; border: 0; background: none; padding: 0; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--text); }
.gr .grs-amp .ampbox { height: 62px; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
.gr .grs-amp .ewf { display: block; transform-origin: 50% 100%; pointer-events: none; }
.gr .grs-amp .am { transition: transform .16s cubic-bezier(.2, .8, .3, 1.3); }
.gr .grs-amp:hover .am, .gr .grs-amp:focus-visible .am, .gr .grs-amp.look .am { transform: translateY(-5px) scale(1.06); }
.gr .grs-plate { font: 700 13.5px/1 var(--font-ui); color: var(--brass-ink); background: linear-gradient(#efe3c0, #cdb98a); padding: 4px 7px 3px; border-radius: 2px; box-shadow: 0 1px 0 #00000080, inset 0 1px 0 #fff8; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.gr .grs-amp.taken .am { visibility: hidden; }
.gr .grs-amp.taken::before { content: 'On your stack'; position: absolute; top: 12px; left: 50%; transform: translateX(-50%); font: 600 11.5px/1.2 var(--font-ui); color: var(--text-2); border: 1px dashed var(--line-2); padding: 14px 6px; white-space: nowrap; }
.gr .grs-amp.trying .am { transform: translateY(-5px) scale(1.06); filter: drop-shadow(0 0 10px #ffc85a88); }
.gr .grs-amp:focus-visible, .gr .grs-ped:focus-visible, .gr .grs-unit:focus-visible { outline: 2px solid var(--lamp); outline-offset: 3px; }

/* the case: drawer plates down the left, one drawer's pedals on the shelves beside them */
.gr .grs-cats { position: absolute; display: flex; flex-direction: column; gap: 4px; }
.gr .grs-cat { display: flex; align-items: center; justify-content: space-between; gap: 6px; height: 38px; padding: 0 10px; border: 0; border-radius: 2px; cursor: pointer;
  background: linear-gradient(#3a2e22, #2a2018); color: #d8cfb8; font: 700 14px/1 var(--font-ui); box-shadow: inset 0 1px 0 #ffffff14, 0 2px 0 #0008; text-align: left; transition: transform .12s; }
.gr .grs-cat small { font: 600 12px/1 var(--font-mono); color: #9a8f7c; }
.gr .grs-cat:hover { color: #fff3dc; }
.gr .grs-cat[aria-selected="true"] { background: linear-gradient(#efe3c0, #cdb98a); color: var(--brass-ink); box-shadow: inset 0 1px 0 #fff8, 0 0 0 2px #ffc85a66, 0 2px 0 #0008; transform: translateX(6px); }
.gr .grs-cat[aria-selected="true"] small { color: #6e6352; }
.gr .grs-case-head { position: absolute; display: flex; align-items: baseline; gap: 14px; color: var(--text-2); font-size: 14px; line-height: 1.3; }
.gr .grs-case-head span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gr .grs-case-head h3 { margin: 0; font-size: 30px; color: #f1ece4; white-space: nowrap; }
.gr .grs-ped { position: absolute; border: 0; background: none; padding: 0; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 3px; color: var(--text); }
.gr .grs-ped .pbox { display: flex; align-items: flex-end; justify-content: center; width: 100%; }
.gr .grs-ped .face { display: block; position: relative; transform-origin: 50% 100%; transition: transform .14s cubic-bezier(.2, .8, .3, 1.3); }
.gr .grs-ped .ewf { pointer-events: none; }
.gr .grs-ped:hover .face, .gr .grs-ped:focus-visible .face, .gr .grs-ped.look .face, .gr .grs-ped.trying .face { transform: translateY(-4px) scale(1.06); }
.gr .grs-ped.trying .face { filter: drop-shadow(0 0 10px #ffc85a88); }
.gr .grs-ped .pname { margin-top: 6px; font: 700 13px/1.1 var(--font-ui); color: var(--brass-ink); background: linear-gradient(#efe3c0, #cdb98a); padding: 3px 6px 2px; border-radius: 2px; box-shadow: 0 1px 0 #00000080; max-width: 100%; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gr .grs-ped .ptype { font: 500 11.5px/1.2 var(--font-ui); color: #b9b1a6; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.gr .grs-ped.taken .face { opacity: .45; }
.gr .grs-ped.taken .face::after { content: '✓'; position: absolute; top: -8px; right: -8px; width: 20px; height: 20px; border-radius: 50%; background: var(--lamp); color: #16130f; font: 700 13px/20px var(--font-ui); text-align: center; box-shadow: 0 1px 3px #000a; }

/* the identity card: brass-edged for an amp, a hang tag for a pedal, a spec sheet for a stack */
.gr .grs-card { position: absolute; z-index: 6; width: 300px; pointer-events: none !important; opacity: 0; transform: translateY(4px); transition: opacity .14s, transform .14s; }
.gr .grs-card.on { opacity: 1; transform: none; }
.gr .grs-card .in { background: #17141a; border: 1px solid #4a4250; box-shadow: 0 16px 34px #000c; padding: 14px 16px 12px; }
.gr .grs-card .sec { display: inline-block; font: 700 10.5px/1 var(--font-ui); letter-spacing: .1em; color: var(--brass-ink); background: var(--brass); padding: 3px 6px 2px; border-radius: 1px; }
.gr .grs-card h3 { margin: 8px 0 4px; font-size: 26px; line-height: 1.05; color: var(--text); }
.gr .grs-card p { margin: 4px 0; color: var(--text-2); font-size: 14px; line-height: 1.4; }
.gr .grs-card .nod { color: var(--text-3); font-style: italic; font-size: 13px; }
.gr .grs-card .do { margin-top: 10px; display: block; line-height: 1.6; font-size: 12.5px; font-weight: 600; color: var(--text); }
.gr .grs-card .do kbd { opacity: 1; }
.gr .grs-card .hear { display: block; margin-top: 6px; font-size: 12.5px; color: var(--lamp); }
.gr .grs-card.tag .in { background: var(--paper); color: var(--ink); border: 0; border-radius: 3px 3px 3px 14px; position: relative; padding-left: 26px; }
.gr .grs-card.tag .in::before { content: ''; position: absolute; left: 9px; top: 16px; width: 8px; height: 8px; border-radius: 50%; background: #0b090d; box-shadow: 0 0 0 2px #cbbfa8; }
.gr .grs-card.tag h3 { color: var(--ink); font-size: 23px; }
.gr .grs-card.tag p { color: var(--ink-2); }
.gr .grs-card.tag .nod { color: var(--ink-3); }
.gr .grs-card.tag .sec { background: #16130f; color: var(--paper); }
.gr .grs-card.tag .do { color: var(--ink); }
.gr .grs-card.tag .hear { color: #8a5a00; }
.grs-ghost { position: fixed; z-index: 40; pointer-events: none; transition: transform .55s cubic-bezier(.3, .7, .2, 1), opacity .55s; transform-origin: 0 0; margin: 0; }

/* the try-out corner: your stack, its plate, the head on its cab, the mics */
.gr .grs-stackplate { position: absolute; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px 12px; padding: 10px 12px; background: #0e0c10e8; border: 1px solid #2e2833; }
.gr .grs-stackplate small { grid-column: 1; font: 600 11px/1 var(--font-ui); letter-spacing: .1em; color: var(--text-3); text-transform: uppercase; }
.gr .grs-stackplate b { grid-column: 1; font-size: 19px; line-height: 1.1; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gr .grs-stackplate span { grid-column: 1; font-size: 12.5px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gr .grs-stackplate .acts { grid-column: 2; grid-row: 1 / span 3; display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
.gr .grs-b { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 34px; padding: 0 12px; border: 1px solid var(--line-2); border-radius: var(--r-press); background: none; color: var(--text); font: 600 13px/1 var(--font-ui); cursor: pointer; white-space: nowrap; }
.gr .grs-b:hover { border-color: var(--text-3); }
.gr .grs-b:disabled { opacity: .45; cursor: default; }
.gr .grs-b.go { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.gr .grs-b.go:hover { filter: brightness(1.05); }
.gr .grs-name { display: flex; gap: 6px; align-items: center; grid-column: 1 / -1; }
.gr .grs-name input { flex: 1; min-width: 0; height: 32px; font: 400 14px/1 var(--font-ui); background: var(--bg-2); border: 1px solid var(--line-2); color: var(--text); padding: 0 8px; border-radius: var(--r-press); }
.gr .grs-head { position: absolute; cursor: zoom-in; }
.gr [data-cam="tryout-head"] .grs-head { cursor: default; }
.gr .grs-head .ewf-ampface.ewf-compact .amp .kn-l { font-size: 7.8px; letter-spacing: .06em; }
.gr .grs-nohead { position: absolute; display: grid; place-items: center; border: 2px dashed #3a3a44; border-radius: 6px; color: var(--text-3); font: 600 14px/1.3 var(--font-ui); text-align: center; padding: 10px; background: none; cursor: pointer; }
.gr .grs-fresh { animation: grs-fresh 1.4s ease-out; }
@keyframes grs-fresh { 0% { filter: drop-shadow(0 0 0 #ffc85a) brightness(1.4); } 30% { filter: drop-shadow(0 0 14px #ffc85a) brightness(1.15); } 100% { filter: none; } }

/* a cab, drawn from its speakers; the mics in front of its grille */
.gr .grs-cab { position: absolute; border-radius: 7px; cursor: zoom-in; background:
    radial-gradient(circle at 1px 1px, #ffffff0d .6px, transparent 1px) 0 0/3px 3px,
    linear-gradient(#1b1b1f, #0f0f12);
  box-shadow: inset 0 0 0 2px #2a2a30, inset 0 2px 0 3px #00000080, 0 18px 28px -10px #000c; }
.gr .grs-cab.open, .gr .grs-cab.mini { cursor: default; }
.gr .grs-cab .cab-gr { position: absolute; inset: 22px 20px 30px; border-radius: 3px; overflow: hidden; background: #0b0b0d; box-shadow: inset 0 0 0 2px #c9c4b4, inset 0 0 0 4px #000; }
.gr .grs-cab .cab-cones { position: absolute; inset: 0; }
.gr .grs-cab .cone { position: absolute; border-radius: 50%; background:
    radial-gradient(circle, #3a3936 0 13%, #1a1918 14% 16%, #262523 17% 62%, #151413 64% 70%, #2c2b28 71% 86%, #0c0c0b 88%); box-shadow: 0 0 0 2px #111; }
.gr .grs-cab .cone::after { content: ''; position: absolute; inset: 32%; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #55534e, #2a2927 70%); }
.gr .grs-cab .cone.hot { box-shadow: 0 0 0 2px #111, 0 0 0 4px #ffc85a55; }
.gr .grs-cab .cab-cloth { position: absolute; inset: 0; transition: opacity .5s; background:
    repeating-linear-gradient(90deg, #ffffff10 0 1px, transparent 1px 3px),
    repeating-linear-gradient(0deg, #00000066 0 1px, transparent 1px 3px),
    radial-gradient(ellipse at 50% 0%, #2a2a30, #121215 70%); }
.gr .grs-cab.open .cab-cloth, .gr .grs-cab.mini .cab-cloth { opacity: .08; }
.gr .grs-cab .cab-logo { position: absolute; left: 50%; top: 4px; transform: translateX(-50%); font: 800 11px/1 var(--font-ui); letter-spacing: .22em; color: #d8d2c0; padding: 3px 8px 2px; background: linear-gradient(#2c2c32, #18181c); border-radius: 2px; box-shadow: 0 0 0 1px #000; white-space: nowrap; }
.gr .grs-cab .cab-name { position: absolute; left: 30px; bottom: 9px; font: 600 11px/1 var(--font-ui); color: #8a8a96; letter-spacing: .06em; white-space: nowrap; }
.gr .grs-cab .cab-corner { position: absolute; width: 22px; height: 22px; background: linear-gradient(135deg, #d0d0d8, #6a6a74); border-radius: 3px; box-shadow: inset 0 0 0 1px #00000060; }
.gr .grs-cab .cab-corner.tl { left: -2px; top: -2px; } .gr .grs-cab .cab-corner.tr { right: -2px; top: -2px; } .gr .grs-cab .cab-corner.bl { left: -2px; bottom: -2px; } .gr .grs-cab .cab-corner.br { right: -2px; bottom: -2px; }
.gr .grs-cab .cab-caster { position: absolute; bottom: -10px; width: 18px; height: 12px; border-radius: 0 0 9px 9px; background: #222; }
.gr .grs-cab.odd-fridge { border-radius: 14px; background: linear-gradient(90deg, #d8d4c8, #f0ece2 40%, #c8c4b8); box-shadow: inset 0 0 0 2px #a8a498, 0 18px 28px -10px #000c; }
.gr .grs-cab.odd-fridge .cab-logo { background: none; color: #6a6a74; box-shadow: none; font-style: italic; letter-spacing: .06em; }
.gr .grs-cab.odd-box { border-radius: 2px; background: linear-gradient(#b08a5a, #9a7448); box-shadow: inset 0 0 0 1px #6a4a28, 0 18px 28px -10px #000c; }
.gr .grs-cab.odd-box .cab-logo { background: none; color: #4a3218; box-shadow: none; font-family: var(--font-mono); letter-spacing: .1em; }
.gr .grs-cab.odd-box .cab-gr { box-shadow: inset 0 0 0 2px #6a4a28; }
.gr .grs-cab.odd-phone { border-radius: 12px; background: linear-gradient(#2a2a2e, #141416); }
.gr .grs-cab.odd-horn { border-radius: 4px 4px 40px 40px; }
.gr .grs-cab.ir .cab-name::after { content: ' · measured'; color: #6a6a74; }
.gr .grs-mic { position: absolute; width: 0; height: 0; z-index: 3; }
.gr .grs-mic .mic-stand { position: absolute; left: -1.5px; top: 0; width: 3px; background: linear-gradient(90deg, #555, #aaa, #555); pointer-events: none; }
.gr .grs-mic .mic-body { position: absolute; left: -15px; top: -15px; width: 30px; height: 30px; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #8a8a90, #2a2a2e 65%); box-shadow: 0 0 0 2px #0a0a0c, 0 4px 8px #000a; touch-action: none; }
.gr .grs-cab.open .grs-mic .mic-body, .gr .grs-cab.mini .grs-mic .mic-body { cursor: grab; }
.gr .grs-mic .mic-body::after { content: ''; position: absolute; inset: 6px; border-radius: 50%; background: radial-gradient(circle, #0007 1px, transparent 1.5px) 0 0/4px 4px, radial-gradient(circle at 40% 35%, #c8c8cc, #5a5a60); }
.gr .grs-mic.t-ribbon .mic-body { border-radius: 6px; left: -14px; top: -20px; width: 28px; height: 40px; background: linear-gradient(#a08a5a, #5a4a2a); }
.gr .grs-mic.t-ribbon .mic-body::after { inset: 5px 5px; border-radius: 3px; background: repeating-linear-gradient(0deg, #222 0 2px, #777 2px 3px); }
.gr .grs-mic.t-cond .mic-body { left: -18px; top: -18px; width: 36px; height: 36px; background: radial-gradient(circle at 40% 35%, #f0f0f2, #8a8a92 70%); }
.gr .grs-mic.t-crystal .mic-body { background: radial-gradient(circle at 40% 35%, #d8c088, #6a5420 70%); }
.gr .grs-mic.t-kick .mic-body { left: -20px; top: -20px; width: 40px; height: 40px; background: radial-gradient(circle at 40% 35%, #5a6a8a, #1a2232 70%); }
.gr .grs-mic .mic-tag { position: absolute; left: 24px; top: -11px; white-space: nowrap; font: 600 13px/1 var(--font-ui); color: var(--text); background: #0e0c10e0; padding: 4px 6px; border: 1px solid var(--line-2); opacity: 0; transition: opacity .2s; pointer-events: none; }
.gr .grs-cab.open .grs-mic .mic-tag, .gr .grs-cab.mini .grs-mic .mic-tag { opacity: 1; }
.gr .grs-mic.m2 .mic-body { box-shadow: 0 0 0 2px #0a0a0c, 0 0 0 4px #ffc85a88, 0 4px 8px #000a; }
.gr .grs-mic.dragging .mic-body { cursor: grabbing; }
.gr .grs-mic .mic-body:focus-visible { outline: 2px solid var(--lamp); outline-offset: 3px; }

/* the board along the shop's front */
.gr .grs-board { position: absolute; border-radius: 4px; background: repeating-linear-gradient(0deg, #1b1b1f 0 14px, #0c0c0e 14px 20px), #141417; box-shadow: inset 0 0 0 2px #2c2c33, 0 14px 24px -8px #000d; }
.gr .grs-board .rail { position: absolute; left: 0; right: 0; bottom: 0; height: 22px; background: linear-gradient(#3a3a42, #222227); border-radius: 0 0 4px 4px; box-shadow: inset 0 1px 0 #ffffff22; }
.gr .grs-slot { position: absolute; touch-action: none; }
.gr .grs-slot .face { transform-origin: 0 0; }
.gr .grs-slot.off .ewf { filter: brightness(.86); }
.gr .grs-slot.dragging { z-index: 8; opacity: .9; filter: drop-shadow(0 12px 18px #000c); }
.gr .grs-slot .keycap { position: absolute; left: 50%; transform: translateX(-50%); font: 600 11px/1 var(--font-mono); color: #d8d2c0; background: #111; border: 1px solid #555; border-radius: 2px; padding: 2px 5px; white-space: nowrap; }
.gr .grs-slot .keycap b { font-weight: 600; color: #8fdca0; margin-left: 4px; } .gr .grs-slot.off .keycap b { color: #8a8a96; }
.gr .grs-slot .rm { position: absolute; right: -9px; top: -9px; width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--line-2); background: #1a181c; color: var(--text-2); font: 600 14px/1 var(--font-ui); cursor: pointer; opacity: 0; z-index: 4; }
.gr .grs-slot:hover .rm, .gr .grs-slot:focus-within .rm { opacity: 1; }
.gr .grs-drop { position: absolute; width: 4px; background: var(--lamp); border-radius: 2px; box-shadow: 0 0 10px #ffc85aaa; pointer-events: none; }
.gr .grs-loop { position: absolute; width: 0; border-left: 2px dashed #3a3a44; pointer-events: none; }
.gr .grs-loop span { position: absolute; top: 0; left: 6px; background: #141417; padding: 1px 3px; font: 700 10px/1.2 var(--font-ui); letter-spacing: .12em; color: #6a6a76; white-space: nowrap; }
.gr .grs-add { position: absolute; border: 2px dashed #3a3a44; border-radius: 6px; background: none; color: var(--text-3); font: 600 15px/1.3 var(--font-ui); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-align: center; padding: 8px; }
.gr .grs-add b { font-weight: 600; color: var(--text-2); }
.gr .grs-add small { font-size: 12px; font-weight: 400; }
.gr .grs-add:hover { color: var(--text); border-color: var(--text-3); }
.gr svg.grs-cables { position: absolute; overflow: visible; pointer-events: none; }

/* the rack: your stacks and the house's, each a unit with a label-maker strip */
.gr .grs-rack { position: absolute; display: flex; flex-direction: column; gap: 6px; padding: 14px 18px; overflow: auto; scrollbar-width: thin;
  background: linear-gradient(90deg, #26262c 0 14px, #121216 14px calc(100% - 14px), #26262c calc(100% - 14px));
  box-shadow: inset 0 0 0 2px #34343c, 0 16px 30px -10px #000c; }
.gr .grs-rack h4 { margin: 6px 0 2px; font: 700 11px/1 var(--font-ui); letter-spacing: .12em; color: #7a7a86; text-transform: uppercase; }
.gr .grs-unit { position: relative; flex: none; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; height: 50px; padding: 0 12px 0 22px; border: 0; border-radius: 2px; cursor: pointer; text-align: left;
  background: linear-gradient(#3a3a42, #24242a); box-shadow: inset 0 1px 0 #ffffff1a, 0 2px 0 #000a; color: var(--text); }
.gr .grs-unit::before, .gr .grs-unit::after { content: ''; position: absolute; left: 6px; width: 6px; height: 6px; border-radius: 50%; background: #6a6a74; box-shadow: inset 0 1px 1px #000; }
.gr .grs-unit::before { top: 8px; } .gr .grs-unit::after { bottom: 8px; }
.gr .grs-unit .led { width: 8px; height: 8px; border-radius: 50%; background: #3a3022; }
.gr .grs-unit.live .led { background: var(--lamp); box-shadow: 0 0 6px #ffc85a; }
.gr .grs-unit .tape { font: 700 13px/1 var(--font-mono); letter-spacing: .02em; color: #0e0e10; background: #e8e4d8; padding: 5px 8px 4px; border-radius: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; justify-self: start; max-width: 100%; }
.gr .grs-unit.house .tape { background: var(--brass); }
.gr .grs-unit small { font: 600 11px/1.1 var(--font-ui); color: #a8a8b4; white-space: nowrap; text-align: right; }
.gr .grs-unit[aria-selected="true"] { box-shadow: inset 0 1px 0 #ffffff1a, 0 0 0 2px var(--lamp), 0 2px 0 #000a; }
.gr .grs-sheet { position: absolute; padding: 18px 20px; background: var(--paper); color: var(--ink); border-radius: 2px; box-shadow: 0 16px 34px #000c; overflow: auto; }
.gr .grs-sheet .kind { font: 600 12px/1 var(--font-ui); letter-spacing: .04em; color: var(--ink-3); }
.gr .grs-sheet h3 { margin: 6px 0 6px; font-size: 30px; line-height: 1.05; color: var(--ink); }
.gr .grs-sheet p { margin: 6px 0; color: var(--ink-2); font-size: 14px; line-height: 1.45; }
.gr .grs-sheet ol { margin: 10px 0; padding: 0 0 0 22px; color: var(--ink); font-size: 14px; line-height: 1.6; }
.gr .grs-sheet ol li.off { color: var(--ink-3); }
.gr .grs-sheet ol small { color: var(--ink-3); }
.gr .grs-sheet .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.gr .grs-sheet .grs-b { color: var(--ink); border-color: var(--paper-rule); }
.gr .grs-sheet .grs-b.go { color: var(--ink); background: var(--accent); border-color: #a8b84a; }
.gr .grs-sheet .grs-name input { background: #fffdf6; color: var(--ink); border-color: var(--paper-rule); }
.gr .grs-sheet .note { font-size: 12.5px; color: var(--ink-3); }

/* the panels beside a zoom: the head's, the cab builder */
.gr .grs-panel h2 { margin: 0 0 2px; font-size: 30px; line-height: 1.05; }
.gr .grs-panel .kind { font-size: 12px; font-weight: 600; color: var(--text-3); letter-spacing: .04em; }
.gr .grs-panel p { margin: 8px 0; color: var(--text-2); font-size: 14px; line-height: 1.45; }
.gr .grs-panel .nod { font-style: italic; color: var(--text-3); }
.gr .grs-panel .note { font-size: 12.5px; color: var(--text-3); }
.gr .grs-panel h3 { font-size: 13px; font-weight: 600; color: var(--text); margin: 18px 0 8px; padding-top: 12px; border-top: 1px solid var(--line); }
.gr .grs-panel .row { display: flex; align-items: center; gap: 10px; margin: 8px 0; }
.gr .grs-panel .row > label, .gr .grs-panel .row > .lab { width: 78px; color: var(--text-3); font-size: 13px; flex: none; }
.gr .grs-panel .row output { font: 500 13px/1 var(--font-mono); width: 60px; text-align: right; color: var(--text); flex: none; }
.gr .grs-panel .grs-b { margin: 2px 0; }
.gr .grs-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.gr .grs-chip { border: 1px solid var(--line-2); background: none; color: var(--text-2); border-radius: 2px; padding: 6px 8px; font: 500 12.5px/1.2 var(--font-ui); cursor: pointer; text-align: left; }
.gr .grs-chip:hover { color: var(--text); border-color: var(--text-3); }
.gr .grs-chip[aria-checked="true"] { color: var(--bg); background: var(--text); border-color: var(--text); }
.gr .grs-cablist { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.gr .grs-cablist .grs-chip { display: block; }
.gr .grs-front { position: relative; margin: 6px 0 4px; }
.gr .grs-side { display: block; width: 100%; aspect-ratio: 744 / 300; background: #0b090d; border: 1px solid var(--line); margin-top: 6px; cursor: ew-resize; touch-action: none; }
/* a fader: an ARIA slider (the room draws no range input) */
.gr .grs-fader { position: relative; flex: 1 1 auto; height: 26px; cursor: pointer; touch-action: none; outline: none; }
.gr .grs-fader::before { content: ''; position: absolute; left: 0; right: 0; top: 11px; height: 4px; border-radius: 2px; background: var(--line-2); }
.gr .grs-fader i { position: absolute; top: 11px; left: 0; height: 4px; border-radius: 2px; background: var(--accent-2); }
.gr .grs-fader b { position: absolute; top: 4px; width: 18px; height: 18px; margin-left: -9px; border-radius: 50%; background: #e8e4d8; box-shadow: 0 1px 3px #000a, inset 0 -2px 0 #0003; }
.gr .grs-fader:focus-visible b { box-shadow: 0 0 0 3px var(--lamp), 0 1px 3px #000a; }
.gr .grs-fader.m2 i { background: var(--lamp); }
`;
