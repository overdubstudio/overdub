// The stage's styles [ui; the guitar room's ROOM stream] (the second mock's room.css, design/mock/guitar-room-2/,
// carried into the app). The gear on the stage (the head on its cab, the mics, the input meter, the board, the
// pedals' slots and keycaps, the + pedal, the jack, the board's hang tags, Tuna Fork), the hotspots and their words,
// a knob's name and value large while your hand is on it, the head's panel, and the room's buttons in the header and
// the strip. Tokens are app/style/tokens.css's; the lamps are amber; red is the record light's alone (no red here: a
// knob's own red pointer is the face's, Claw'd-o-Matic's).
//
//   CSS   the stylesheet's text (./stage.js injects it once: ui/dom.js css('gr-room', CSS))

export const CSS = `
.gr { --lamp: #ffc85a; --lamp-hi: #ffe2a0; --brass: #e3d3a8; --brass-ink: #16130f; }
.gr .gr-pixels canvas.gr-r-bg, .gr .gr-pixels canvas.gr-r-kit, .gr .gr-pixels canvas.gr-r-tape { position: absolute; display: block; image-rendering: pixelated; pointer-events: none; }
.gr-gear > svg.gr-r-cables { position: absolute; overflow: visible; pointer-events: none; z-index: 1; }
.gr-r-head, .gr-r-cab, .gr-r-mic, .gr-r-jack, .gr-r-meter, .gr-r-slot, .gr-r-add, .gr-r-loop { position: absolute; z-index: 2; }
.gr-r-mic { z-index: 3; }

/* the hotspots: the kit, the tape machine, the door; words on hover or focus */
.gr-r-hot { position: absolute; z-index: 5; background: none; border: 0; padding: 0; cursor: pointer; }
.gr-r-hot:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.gr-r-hot::after { content: attr(data-say); position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%); white-space: nowrap; opacity: 0; transition: opacity .12s;
  font: 600 13px/1 var(--font-ui); color: var(--text); background: #0e0c10e8; border: 1px solid var(--line-2); padding: 6px 8px; pointer-events: none; }
.gr-r-hot:hover::after, .gr-r-hot:focus-visible::after { opacity: 1; }
.gr-r-hot.gr-r-below::after { bottom: auto; top: calc(100% + 8px); }
.gr:not([data-cam="stage"]) .gr-r-hot[data-hot="kit"] { pointer-events: none; }
.gr-r-mark { position: absolute; pointer-events: none !important; }
.gr[data-cam="stage"] .gr-r-head, .gr[data-cam="stage"] .gr-r-cab, .gr[data-cam="stage"] .gr-r-slot { cursor: zoom-in; }

/* a knob's name and value, large, while you hover, drag or focus it */
.gr-r-kntip { position: absolute; z-index: 6; pointer-events: none; display: grid; grid-template-columns: auto auto; column-gap: 10px; align-items: baseline; padding: 7px 12px 8px;
  background: #0e0c10f2; border: 1px solid #4a4250; box-shadow: 0 10px 24px #000b; opacity: 0; transition: opacity .12s; white-space: nowrap; color: var(--text); }
.gr-r-kntip.gr-on { opacity: 1; }
.gr-r-kntip small { grid-column: 1 / -1; font: 600 11px/1.2 var(--font-ui); color: var(--text-3); }
.gr-r-kntip span { font: 600 17px/1.1 var(--font-ui); color: var(--text-2); }
.gr-r-kntip b { font: 600 22px/1.1 var(--font-mono); color: var(--text); }
.gr-r-slot .kn-tip, .gr-r-head .kn-tip { display: none; }

/* the head, on its cab */
.gr-r-head .ewf-ampface.ewf-compact .amp .kn-l { font-size: 7.8px; letter-spacing: .06em; }
.gr-r-head.gr-r-fresh, .gr-r-slot.gr-r-fresh .gr-r-face { animation: gr-r-fresh 1.4s ease-out; }
@keyframes gr-r-fresh { 0% { filter: drop-shadow(0 0 0 #ffc85a) brightness(1.4); } 30% { filter: drop-shadow(0 0 14px #ffc85a) brightness(1.15); } 100% { filter: none; } }
.gr-r-cab { border-radius: 7px; background: radial-gradient(circle at 1px 1px, #ffffff0d .6px, transparent 1px) 0 0/3px 3px, linear-gradient(#1b1b1f, #0f0f12);
  box-shadow: inset 0 0 0 2px #2a2a30, inset 0 2px 0 3px #00000080, 0 18px 28px -10px #000c; }
.gr-r-grille { position: absolute; inset: 22px 20px 30px; border-radius: 3px; overflow: hidden; background: #0b0b0d; box-shadow: inset 0 0 0 2px #c9c4b4, inset 0 0 0 4px #000; }
.gr-r-cones { position: absolute; inset: 0; }
.gr-r-cone { position: absolute; border-radius: 50%; background: radial-gradient(circle, #3a3936 0 13%, #1a1918 14% 16%, #262523 17% 62%, #151413 64% 70%, #2c2b28 71% 86%, #0c0c0b 88%); box-shadow: 0 0 0 2px #111; }
.gr-r-cone::after { content: ''; position: absolute; inset: 32%; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #55534e, #2a2927 70%); }
.gr-r-cone.gr-on { box-shadow: 0 0 0 2px #111, 0 0 0 4px #ffc85a55; }
.gr-r-cloth { position: absolute; inset: 0; transition: opacity .5s; background: repeating-linear-gradient(90deg, #ffffff10 0 1px, transparent 1px 3px), repeating-linear-gradient(0deg, #00000066 0 1px, transparent 1px 3px), radial-gradient(ellipse at 50% 0%, #2a2a30, #121215 70%); }
.gr[data-cam="cab"] .gr-r-cloth { opacity: .08; }
.gr-r-cab-logo { position: absolute; left: 50%; top: 4px; transform: translateX(-50%); font: 800 11px/1 var(--font-ui); letter-spacing: .22em; color: #d8d2c0; padding: 3px 8px 2px; background: linear-gradient(#2c2c32, #18181c); border-radius: 2px; box-shadow: 0 0 0 1px #000; white-space: nowrap; }
.gr-r-cab-name { position: absolute; left: 30px; top: 6px; font: 600 11px/1 var(--font-ui); color: #8a8a96; letter-spacing: .06em; white-space: nowrap; }
.gr-r-corner { position: absolute; width: 22px; height: 22px; background: linear-gradient(135deg, #d0d0d8, #6a6a74); border-radius: 3px; box-shadow: inset 0 0 0 1px #00000060; }
.gr-r-tl { left: -2px; top: -2px; } .gr-r-tr { right: -2px; top: -2px; } .gr-r-bl { left: -2px; bottom: -2px; } .gr-r-br { right: -2px; bottom: -2px; }
.gr-r-caster { position: absolute; bottom: -10px; width: 18px; height: 12px; border-radius: 0 0 9px 9px; background: #222; }
.gr-r-cab.gr-r-odd-fridge { border-radius: 14px; background: linear-gradient(90deg, #d8d4c8, #f0ece2 40%, #c8c4b8); box-shadow: inset 0 0 0 2px #a8a498, 0 18px 28px -10px #000c; }
.gr-r-cab.gr-r-odd-fridge .gr-r-cab-logo { background: none; color: #6a6a74; box-shadow: none; font-style: italic; letter-spacing: .06em; }
.gr-r-cab.gr-r-odd-box { border-radius: 2px; background: linear-gradient(#b08a5a, #9a7448); box-shadow: inset 0 0 0 1px #6a4a28, 0 18px 28px -10px #000c; }
.gr-r-cab.gr-r-odd-box .gr-r-cab-logo { background: none; color: #4a3218; box-shadow: none; font-family: var(--font-mono); letter-spacing: .1em; }
.gr-r-cab.gr-r-odd-box .gr-r-grille { box-shadow: inset 0 0 0 2px #6a4a28; }
.gr-r-cab.gr-r-odd-phone { border-radius: 12px; background: linear-gradient(#2a2a2e, #141416); }
.gr-r-cab.gr-r-odd-horn { border-radius: 4px 4px 40px 40px; }

/* the mics in front of the grille (you move them when you're close: the cab) */
.gr-r-mic { width: 0; height: 0; transform-origin: 0 0; }
.gr-r-mic-stand { position: absolute; left: -1px; top: 0; width: 3px; background: linear-gradient(90deg, #555, #aaa, #555); }
.gr-r-mic-body { position: absolute; left: -15px; top: -15px; width: 30px; height: 30px; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #8a8a90, #2a2a2e 65%); box-shadow: 0 0 0 2px #0a0a0c, 0 4px 8px #000a; touch-action: none; }
.gr[data-cam="cab"] .gr-r-mic-body { cursor: grab; }
.gr-r-mic-body::after { content: ''; position: absolute; inset: 6px; border-radius: 50%; background: radial-gradient(circle, #0007 1px, transparent 1.5px) 0 0/4px 4px, radial-gradient(circle at 40% 35%, #c8c8cc, #5a5a60); }
.gr-r-mic.gr-r-t-ribbon .gr-r-mic-body { border-radius: 6px; left: -14px; top: -20px; width: 28px; height: 40px; background: linear-gradient(#a08a5a, #5a4a2a); }
.gr-r-mic.gr-r-t-ribbon .gr-r-mic-body::after { inset: 5px; border-radius: 3px; background: repeating-linear-gradient(0deg, #222 0 2px, #777 2px 3px); }
.gr-r-mic.gr-r-t-cond .gr-r-mic-body { left: -18px; top: -18px; width: 36px; height: 36px; background: radial-gradient(circle at 40% 35%, #f0f0f2, #8a8a92 70%); }
.gr-r-mic.gr-r-t-crystal .gr-r-mic-body { background: radial-gradient(circle at 40% 35%, #d8c088, #6a5420 70%); }
.gr-r-mic.gr-r-t-kick .gr-r-mic-body { left: -20px; top: -20px; width: 40px; height: 40px; background: radial-gradient(circle at 40% 35%, #5a6a8a, #1a2232 70%); }
.gr-r-mic.gr-r-m2 .gr-r-mic-body { box-shadow: 0 0 0 2px #0a0a0c, 0 0 0 4px #ffc85a88, 0 4px 8px #000a; }
.gr-r-mic-tag { position: absolute; left: 22px; top: -9px; white-space: nowrap; font: 600 11px/1 var(--font-ui); color: var(--text); background: #0e0c10d8; padding: 3px 5px; border: 1px solid var(--line-2); opacity: 0; transition: opacity .2s; pointer-events: none; }
.gr[data-cam="cab"] .gr-r-mic-tag { opacity: 1; }

/* the input meter on the head */
.gr-r-meter { display: flex; align-items: center; gap: 8px; padding: 5px 8px; background: linear-gradient(#34343a, #1c1c20); border-radius: 3px; box-shadow: inset 0 1px 0 #ffffff1a, 0 3px 6px #0009; font: 700 10px/1 var(--font-ui); letter-spacing: .14em; color: #bdbdc4; white-space: nowrap; }
.gr-r-leds { display: flex; gap: 2px; position: relative; }
.gr-r-leds i { width: 5px; height: 12px; background: #2a2f22; border-radius: 1px; }
.gr-r-leds i.gr-on { background: #8fdca0; box-shadow: 0 0 4px #8fdca080; }
.gr-r-leds i.gr-r-win { background: #3a3a22; }
.gr-r-leds i.gr-r-win.gr-on { background: var(--lamp); box-shadow: 0 0 5px #ffc85a99; }
.gr-r-leds i.gr-r-over { background: #3a3022; }
.gr-r-leds i.gr-r-over.gr-on { background: var(--lamp-hi); box-shadow: 0 0 6px var(--lamp-hi); }
.gr-r-winmark { position: absolute; top: -5px; height: 3px; background: var(--lamp); opacity: .7; }
.gr-r-db { font: 600 11px/1 var(--font-mono); letter-spacing: 0; color: var(--text-2); min-width: 64px; }
.gr-r-meter.gr-r-lit { box-shadow: inset 0 1px 0 #ffffff1a, 0 0 0 2px var(--lamp), 0 3px 6px #0009; }

/* the board */
.gr-r-board { position: absolute; border-radius: 4px; background: repeating-linear-gradient(0deg, #1b1b1f 0 14px, #0c0c0e 14px 20px), #141417; box-shadow: inset 0 0 0 2px #2c2c33, 0 14px 24px -8px #000d; }
.gr-r-rail { position: absolute; left: 0; right: 0; bottom: 0; height: 22px; background: linear-gradient(#3a3a42, #222227); border-radius: 0 0 4px 4px; box-shadow: inset 0 1px 0 #ffffff22; }
.gr-r-face { transform-origin: 0 0; }
.gr-r-slot.gr-r-off .ewf { filter: brightness(.86); }
.gr-r-slot.gr-r-drag { z-index: 4; cursor: grabbing; transition: none; }
.gr-r-slot.gr-r-drag .gr-r-face { filter: drop-shadow(0 16px 18px #000c); }
.gr-r-slot.gr-r-slide { transition: left .18s ease; }
.gr-r-slot.gr-r-focus .gr-r-face { filter: drop-shadow(0 0 10px #ffc85a); }
.gr-r-keycap { position: absolute; left: 50%; transform: translateX(-50%); font: 600 11px/1 var(--font-mono); color: #d8d2c0; background: #111; border: 1px solid #555; border-radius: 2px; padding: 2px 5px; white-space: nowrap; pointer-events: none; }
.gr-r-keycap b { font-weight: 600; color: #8fdca0; margin-left: 4px; } .gr-r-keycap.gr-r-k-off b { color: #8a8a96; }
.gr-r-rm { position: absolute; right: -8px; top: -8px; width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--line-2); background: #1a181c; color: var(--text-2); font: 600 13px/1 var(--font-ui); cursor: pointer; display: none; z-index: 4; padding: 0; }
.gr[data-cam="board"] .gr-r-rm { display: block; }
.gr-r-loop { top: 10px; bottom: 30px; width: 0; border-left: 2px dashed #3a3a44; pointer-events: none; }
.gr-r-loop span { position: absolute; top: -4px; left: 6px; font: 700 10px/1.2 var(--font-ui); letter-spacing: .12em; color: #6a6a76; white-space: nowrap; }
.gr-r-add { border: 2px dashed #3a3a44; border-radius: 6px; background: none; color: var(--text-3); font: 600 15px/1.3 var(--font-ui); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-align: center; padding: 8px; }
.gr-r-add b { font-weight: 600; color: var(--text-2); }
.gr-r-add small { font-size: 12px; font-weight: 400; }
.gr-r-add:hover, .gr-r-add:focus-visible { color: var(--text); border-color: var(--text-3); }
.gr-r-jack { width: 10px; height: 10px; border-radius: 50%; background: #222; box-shadow: 0 0 0 2px #777; pointer-events: none; }
.gr-r-jack.gr-on { background: var(--lamp); box-shadow: 0 0 0 2px #777, 0 0 10px 2px #ffc85acc; }
.gr-r-jack.gr-r-ring::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid var(--lamp); animation: gr-r-ring 1s ease-out 2; opacity: 0; }
@keyframes gr-r-ring { from { transform: scale(1); opacity: 1; } to { transform: scale(4); opacity: 0; } }
.gr-r-pick { font: 700 9px/1.1 var(--font-ui); letter-spacing: .04em; padding: 3px 5px; min-width: 40px; border: 1px solid #0006; border-radius: 2px; background: #111c; color: #e8e0cc; cursor: pointer; white-space: nowrap; }

/* the board's hang tags, up when you're close to the board */
.gr-r-tag { position: absolute; z-index: 5; width: 164px; padding: 7px 9px 8px; background: var(--paper); color: var(--ink); font: 400 11px/1.3 var(--font-ui); border-radius: 2px; box-shadow: 0 6px 14px #0008; opacity: 0; visibility: hidden; transition: opacity .3s, visibility 0s .3s; }
.gr[data-cam="board"] .gr-r-tag { opacity: 1; visibility: visible; transition: opacity .3s; }
.gr-r-tag b { display: block; font-size: 13px; }
.gr-r-tag small { display: block; color: var(--ink-3); font-size: 10.5px; font-weight: 600; letter-spacing: .04em; margin-bottom: 3px; }
.gr-r-tag .gr-r-nod { color: var(--ink-2); font-style: italic; margin-top: 3px; }
.gr-r-tag .gr-r-mv { display: flex; gap: 4px; margin-top: 6px; align-items: center; }
.gr-r-tag .gr-r-mv button { border: 1px solid var(--paper-rule); background: none; color: var(--ink-2); border-radius: 2px; font: 400 11px/1.3 var(--font-ui); padding: 2px 6px; cursor: pointer; white-space: nowrap; }
.gr-r-tag .gr-r-mv button:hover, .gr-r-tag .gr-r-mv button:focus-visible { color: var(--ink); border-color: var(--ink-3); }
.gr-r-tag .gr-r-fix { color: var(--ink-3); }

/* Tuna Fork, the room's tuner, first on the board */
.gr-r-tuner { position: relative; width: 120px; height: 182px; border-radius: 7px; background: linear-gradient(#2c3540, #1a2028); box-shadow: inset 0 0 0 1px #46525e, inset 0 2px 0 #ffffff14, 0 6px 10px #0009; font-family: var(--font-ui); color: #d8e4ee; }
.gr-r-tn-win { position: absolute; left: 9px; right: 9px; top: 12px; height: 62px; border-radius: 4px; background: #05080a; box-shadow: inset 0 0 0 2px #0f1418; overflow: hidden; }
.gr-r-tn-leds { position: absolute; left: 6px; right: 6px; top: 8px; display: flex; gap: 2px; justify-content: center; }
.gr-r-tn-leds i { flex: 1; height: 9px; border-radius: 1px; background: #16201a; }
.gr-r-tn-leds i.gr-r-mid { background: #1d2a20; }
.gr-r-tn-leds i.gr-on { background: var(--lamp); box-shadow: 0 0 4px #ffc85aaa; }
.gr-r-tn-leds i.gr-r-mid.gr-on { background: #8fdca0; box-shadow: 0 0 6px #8fdca0; }
.gr-r-tn-note { position: absolute; left: 0; right: 0; top: 22px; text-align: center; font: 700 30px/1 var(--font-mono); color: #1d2a20; }
.gr-r-tuner.gr-on .gr-r-tn-note { color: #d8f4e0; text-shadow: 0 0 8px #8fdca066; }
.gr-r-tuner.gr-on .gr-r-tn-note.gr-in { color: #8fdca0; }
.gr-r-tn-note sub { font-size: 11px; vertical-align: baseline; margin-left: 1px; }
.gr-r-tuner.gr-held .gr-r-tn-note { opacity: .55; }
.gr-r-tn-cents, .gr-r-tn-str { position: absolute; bottom: 3px; font: 600 8px/1 var(--font-mono); color: #4a6a54; }
.gr-r-tn-cents { right: 5px; } .gr-r-tn-str { left: 5px; }
.gr-r-tuner.gr-on .gr-r-tn-cents, .gr-r-tuner.gr-on .gr-r-tn-str { color: #8fdca0; }
.gr-r-tn-name { position: absolute; left: 0; right: 0; top: 84px; text-align: center; }
.gr-r-tn-name b { display: block; font: 800 italic 17px/1 var(--font-display); font-stretch: 125%; font-variation-settings: var(--font-display-vars); color: #e8f2fa; }
.gr-r-tn-name small { display: block; margin-top: 4px; font: 700 8px/1 var(--font-ui); letter-spacing: .16em; color: #8aa0b2; }
.gr-r-tn-mute { position: absolute; left: 12px; top: 120px; font: 700 8px/1 var(--font-ui); letter-spacing: .14em; color: #4a5866; display: flex; align-items: center; gap: 5px; }
.gr-r-tn-mute i { width: 7px; height: 7px; border-radius: 50%; background: #3a3022; }
.gr-r-tuner.gr-on .gr-r-tn-mute { color: #d8e4ee; } .gr-r-tuner.gr-on .gr-r-tn-mute i { background: var(--lamp); box-shadow: 0 0 6px var(--lamp); }
.gr-r-tn-sw { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); width: 40px; height: 40px; border-radius: 50%; border: 0; cursor: pointer; padding: 0;
  background: radial-gradient(circle at 40% 35%, #f4f4f6, #9a9aa2 60%, #5a5a62); box-shadow: 0 0 0 3px #222, 0 3px 4px #000a; }
.gr-r-tn-sw:active { transform: translateX(-50%) translateY(1px); }
.gr-r-tn-sw:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 3px; }

/* the head's panel, beside its zoom */
.gr-panel[data-target="head"] { width: 320px; }
.gr-r-panel .gr-r-kind { font-size: 12px; font-weight: 600; color: var(--text-3); letter-spacing: .04em; }
.gr-r-panel h2 { margin: 2px 0 4px; font-size: 30px; line-height: 1.05; }
.gr-r-panel p { margin: 8px 0; color: var(--text-2); }
.gr-r-panel .gr-r-nod { font-style: italic; color: var(--text-3); }
.gr-r-panel .gr-r-note { font-size: 12px; color: var(--text-3); }
.gr-r-panel h3 { font-size: 13px; font-weight: 600; color: var(--text); margin: 18px 0 6px; padding-top: 12px; border-top: var(--rule); }
.gr-r-panel .gr-r-row { display: flex; align-items: center; gap: 10px; margin: 6px 0; flex-wrap: wrap; }
.gr-r-b { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 36px; padding: 0 12px; border: 1px solid var(--line-2); border-radius: var(--r-press); background: none; color: var(--text); font: 600 13px/1 var(--font-ui); cursor: pointer; white-space: nowrap; }
.gr-r-b:hover, .gr-r-b:focus-visible { border-color: var(--text-3); }
.gr-r-b kbd, .gr-r-chip kbd, .gr-r-back kbd { font: 400 11px/1 var(--font-mono); color: inherit; border: 1px solid currentColor; border-radius: var(--r-press); padding: 2px 4px; opacity: .72; }

/* the room's own buttons: the way back in the header, and the strip's */
.gr-r-back { display: inline-flex; align-items: center; gap: 8px; padding: 5px 10px; border: 1px solid var(--line-2); border-radius: var(--r-press); background: none; color: var(--text); font: 600 13px/1 var(--font-ui); cursor: pointer; white-space: nowrap; }
.gr-r-back:hover, .gr-r-back:focus-visible { border-color: var(--text-3); }
.gr-r-who { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); font: 400 13px/1 var(--font-ui); white-space: nowrap; }
.gr-r-who[hidden] { display: none; }
.gr-r-who i { width: 8px; height: 8px; background: var(--agent); }
.gr-r-who b { font-weight: 600; }
.gr-r-chip { display: inline-flex; align-items: center; gap: 8px; font: 400 13px/1 var(--font-ui); color: var(--text-2); padding: 7px 10px; border: 1px solid var(--line); border-radius: var(--r-press); background: none; cursor: pointer; white-space: nowrap; }
.gr-r-chip:hover, .gr-r-chip:focus-visible { color: var(--text); border-color: var(--line-2); }
.gr-r-chip b { color: var(--text); font-weight: 600; }
.gr-r-chip .gr-r-dim { color: var(--text-3); }
@media (prefers-reduced-motion: reduce) { .gr-r-slot.gr-r-slide, .gr-r-cloth, .gr-r-tag, .gr-r-kntip { transition: none; } .gr-r-head.gr-r-fresh, .gr-r-slot.gr-r-fresh .gr-r-face { animation: none; } .gr-r-jack.gr-r-ring::after { animation: none; } }
`;
