// @ts-check
// Getting started's plan and words [ui; the guitar room's START stream, pure] (docs/research/GUITAR-ROOM.md §2.1;
// design/mock/guitar-room-2/ shots 01a-01k). What ./start.js walks through, where the camera goes for each step and
// what the spotlight lands on, and everything the engineer says on the slate, the tuner's panel and the talkback. No
// DOM and no audio: test/unit/guitar-start.test.js checks it, and tools/liveroom/checks-start.js holds every word here
// to the room's copy rules (tools/liveroom/checks-copy.js NEVER, two sentences a line, a real minus).
//
//   STEPS                    [{ id: 'plug' | 'tune' | 'time' | 'sound' | 'tour', label }]
//   stepAfter(id) -> id | null   the step after (null after the tour)
//   TOUR                     the tour's stops: [{ id, title, text(vars), at: [rect names], frame: rect name | 'all',
//                            side: 'right' | 'left' | 'top', strip?: true }]; at names a drawn thing (the room's
//                            rect(name), ./stage.js), frame what the camera holds
//   shotOf(step, { rect, tour, close }) -> { R, side, at: [R] | 'strip' }   the camera's rect for a step (world units),
//                            which side the slate stands on, and the rects the spotlight pools on; rect(name) -> R is
//                            the room's (./stage.js rect), close: the plug-in's close-up on the jack
//   W                        the fixed words (the slate's, the tuner's, the talkback's)
//   tuningLabel(name)        'drop C' -> 'Drop C' (a tuning's name at the start of a sentence or on a chip)
//   tunerSays(reading, { n, of, tuning }) -> string   the tuner's line: the string and how far off it, or what to do
//   strumsWord(n, of)        'All six' | 'Four of six'
//   soundSays({ stack, amp, cab, pedals }) -> string  the club's stack (or yours) in one sentence
//   plugSays({ open, label, input, channels, error, monitoring }) -> string   what's plugged in ('Scarlett Solo USB,
//                            input 2. Monitoring on.'), or what to do; monitoring: true, false (M turns it on) or null
//                            (not said)

export const STEPS = Object.freeze([
  { id: 'plug', label: 'Plug in' },
  { id: 'tune', label: 'Tune' },
  { id: 'time', label: 'Timing' },
  { id: 'sound', label: 'Your sound' },
  { id: 'tour', label: 'Tour' },
]);
export const STEP_IDS = STEPS.map((s) => s.id);

/** @param {string | null | undefined} id */
export function stepAfter(id) {
  const i = STEP_IDS.indexOf(String(id));
  return i < 0 || i >= STEP_IDS.length - 1 ? null : STEP_IDS[i + 1];
}

const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const cap = (/** @type {string} */ s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** @param {string} name */
export const tuningLabel = (name) => cap(String(name || ''));

/** @param {number} n @param {number} of */
export function strumsWord(n, of) {
  if (n >= of) return `All ${NUM[of] || of}`;
  return `${cap(NUM[n] || String(n))} of ${NUM[of] || of}`;
}

// The tour, in the order you'd look round the stage: the gear, the drummer, the tape, the door, the strip
/** @typedef {{ id: string, title: string, text: (v: any) => string, at: string[], frame: string, side: 'right' | 'left' | 'top', strip?: boolean }} Stop */
/** @type {readonly Stop[]} */
export const TOUR = Object.freeze([
  { id: 'head', title: 'Your amp', at: ['head'], frame: 'head', side: 'right',
    text: (v) => `${v.amp || 'The amp'}, sitting on your cab. Every knob turns right here; H takes you close.` },
  { id: 'cab', title: 'Your cab', at: ['cab'], frame: 'cab', side: 'right',
    text: () => 'Click it, or C, and you’re at the grille: which cab, the mics on the cones, a second mic.' },
  { id: 'board', title: 'Your board', at: ['board'], frame: 'board', side: 'top',
    text: () => 'In signal order, left to right, the tuner first. 1 to 8 stomp the pedals, U the tuner, and + Pedal brings one in from the shop.' },
  { id: 'drummer', title: 'The drummer', at: ['kit', 'riser'], frame: 'kit', side: 'right',
    text: () => 'Space starts and stops a simple guide beat; ← → set the tempo and T taps it. The cards on the riser are your beats, and K opens the book with every groove.' },
  { id: 'tape', title: 'The tape', at: ['tape'], frame: 'tape', side: 'left',
    text: () => 'Always rolling, quietly. When something was the one, G opens the last minute and keeps it as a riff.' },
  { id: 'door', title: 'The shop', at: ['door'], frame: 'door', side: 'left',
    text: () => 'Every amp on the wall and every pedal in the case, through that door. Click it, or S.' },
  { id: 'strip', title: 'Riffs and the part line', at: [], frame: 'all', side: 'top', strip: true,
    text: () => 'L brings up your riffs and the part line, and R records a part. The talkback runs along the bottom: / talks through the glass, to Claude when Claude’s here.' },
]);

/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */
const pad = (/** @type {Rect} */ r, /** @type {number} */ l, /** @type {number} */ t, /** @type {number} */ rr, /** @type {number} */ b) => ({ x: r.x - l, y: r.y - t, w: r.w + l + rr, h: r.h + t + b });
const union = (/** @type {Rect[]} */ rs) => {
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};
const ALL = { x: 0, y: 0, w: 1440, h: 804 };

/**
 * @param {string} step
 * @param {{ rect: (name: string) => Rect | null, tour?: number, close?: boolean }} o
 * @returns {{ R: Rect, side: 'right' | 'left' | 'top', at: Rect[] | 'strip' }}
 */
export function shotOf(step, { rect, tour = 0, close = false }) {
  const r = (/** @type {string} */ n) => rect(n) || null;
  const some = (/** @type {(Rect | null)[]} */ xs) => /** @type {Rect[]} */ (xs.filter(Boolean));
  if (step === 'plug') {
    const jack = r('jack'), tuner = r('tuner'), meter = r('meter');
    if (close && jack && tuner) return { R: pad(union([jack, tuner]), 90, 40, 90, 30), side: 'right', at: some([pad(jack, 10, 14, 6, 14), tuner]) };
    return { R: { x: -30, y: 0, w: 680, h: 804 }, side: 'right', at: some([jack && tuner ? union([pad(jack, 10, 10, 0, 10), tuner]) : tuner, meter && pad(meter, 6, 6, 6, 6)]) };
  }
  if (step === 'tune') {
    const t = r('tuner');
    return t ? { R: pad(t, 150, 170, 280, 40), side: 'right', at: [pad(t, 6, 6, 6, 6)] } : { R: ALL, side: 'right', at: [] };
  }
  if (step === 'time') {
    const k = r('kit');
    return k ? { R: pad(k, 10, 10, 10, 30), side: 'right', at: [pad(k, -20, -10, -40, -30)] } : { R: ALL, side: 'right', at: [] };
  }
  if (step === 'sound') {
    const head = r('head'), cab = r('cab'), door = r('door');
    // (the head on its cab is one stack: one pool)
    const stack = some([head, cab]);
    return { R: ALL, side: 'right', at: some([stack.length ? pad(union(stack), 6, 30, 6, 6) : null, door && pad(door, 4, 60, 4, 4)]) };
  }
  if (step === 'tour') {
    const s = TOUR[Math.max(0, Math.min(TOUR.length - 1, tour))];
    if (s.strip) return { R: ALL, side: 'top', at: 'strip' };
    const at = some(s.at.map((n) => r(n)));
    const f = s.frame === 'all' ? ALL : r(s.frame);
    let R = f || ALL;
    if (f && s.id === 'head') R = pad(f, 40, 60, 40, 200);
    else if (f && s.id === 'cab') R = pad(f, 50, 40, 50, 30);
    else if (f && s.id === 'board') R = { x: 0, y: f.y - 180, w: 1440, h: 804 - (f.y - 180) };
    else if (f && s.id === 'drummer') R = at.length ? pad(union(at), 16, 16, 16, 16) : f;
    else if (f && s.id === 'tape') R = pad(f, 70, 60, 70, 40);
    else if (f && s.id === 'door') R = pad(f, 100, 130, 40, 20);
    // (the kit and its riser are one thing: one pool)
    const lit = s.id === 'drummer' && at.length > 1 ? [union(at)] : at;
    return { R, side: s.side, at: s.id === 'door' ? lit.map((x) => pad(x, 4, 60, 4, 4)) : lit.map((x) => pad(x, 4, 4, 4, 4)) };
  }
  return { R: ALL, side: 'right', at: [] };
}

// The fixed words. A line on the slate is two sentences at most; the talkback's are its own (calm, quick, a little dry)
export const W = Object.freeze({
  esc: 'pauses this; the Getting started button carries on.',
  plugAsk: 'Your guitar into the interface, the interface into the computer. On the stage, the cable goes into the first pedal on your board: the tuner.',
  plugIn: 'The cable’s in the tuner’s jack. Strum hard and watch the meter: the window is −12 to −6 dBFS.',
  plugKnob: 'The gain knob on your interface sets this, not anything in here.',
  plugOther: 'Another input',
  tuneAsk: (/** @type {string} */ t) => `Stomp the tuner, first on your board (or U). It mutes you while it’s on and reads one string at a time; you’re set for ${t}.`,
  tuneOn: 'Play each open string on its own and let it ring; each lights when it’s in. Stomp it off when they’re all lit.',
  tuneDone: (/** @type {string} */ n, /** @type {string} */ t) => `${n} in tune for ${t}.`,
  tuneNone: (/** @type {string} */ t) => `Tuned for ${t}, or near enough. Stomp it again any time: U.`,
  tunerHead: 'Tuner · first on your board',
  tunerOn: 'It’s on, so you’re muted. Play each open string on its own and let it ring.',
  tunerOff: 'Off. Stomp it (U) and it mutes you while it reads.',
  tunerClosed: 'Plug in first: the tuner reads your input.',
  tunerTunings: 'Tuning',
  tunerLook: 'The look',
  tunerWhich: (/** @type {string} */ note, /** @type {string} */ a, /** @type {string} */ b) => `That low string is ${note}: ${a}${b ? ` or ${b}` : ''}?`,
  timeAsk: 'Your interface and the browser add a little delay. Eight clicks: mute the strings and strum once on each, and takes land right on the beat.',
  timeClosed: 'Plug in first: the strums come in through your input.',
  soundMore: 'Anything else is in the shop, through that door: amps on the wall by sound, pedals in the case by type.',
  // the talkback
  sayPlugged: (/** @type {string} */ where) => `${where}: the cable’s in. Strum.`,
  sayInput: (/** @type {number} */ ch) => `Input ${ch} is the one moving: that’s your guitar.`,
  sayTunerOn: 'Tuner’s on: you’re muted. Play each string on its own and let it ring.',
  sayTunerOff: 'Tuner’s off. You’re back on.',
  sayTunerOffQuiet: 'Tuner’s off.',
  sayTunerWaits: 'The tuner waits for the take.',
  sayTuned: (/** @type {string} */ t) => `Tuned to ${t}.`,
  sayDone: 'You’re set up. Space starts the drummer; the tape’s already rolling.',
  sayPaused: 'Getting started is paused. The button up top picks it up where you left off.',
  sayWaits: 'Getting started waits for the take.',
  sayReview: 'Keep or toss the take first.',
});

/**
 * The tuner's line, from a reading (input/tuner.js): the string and how far off, or what to do
 * @param {any} r @param {{ n?: number, of?: number, tuning?: string }} [o]
 */
export function tunerSays(r, { n = 0, of = 6, tuning = '' } = {}) {
  if (!r || !r.p) return n >= of && of ? W.tuneDone(strumsWord(n, of), tuning) : W.tunerOn;
  const s = r.string;
  const where = s ? `${s.name} string (${s.number})` : `${r.note}${r.octave}`;
  if (r.held) return `${where}: let it ring, or play the next.`;
  if (r.shown == null) return `${where}.`;
  // (in tune is in tune to the string's own note: a reading's inTune is to the nearest note, and C♯ dead on is a
  // semitone sharp of a C string)
  const offString = !!s && ((s.open != null && r.p !== s.open) || Math.abs(s.cents) > 50);
  if (r.inTune && !offString) return n >= of && of ? W.tuneDone(strumsWord(n, of), tuning) : `${where} is in tune.`;
  const c = offString ? Math.round(s.cents) : r.shown;
  const off = Math.abs(c);
  if (offString) return `${where}: tune ${c < 0 ? 'up' : 'down'} to ${s.name.replace(/^(Low|High) /, '')}, ${off} cents ${c < 0 ? 'flat' : 'sharp'}.`;
  return `${where}: ${off} ${off === 1 ? 'cent' : 'cents'} ${c < 0 ? 'flat' : 'sharp'}.`;
}

/** @param {{ stack?: string, amp?: string, cab?: string, pedals?: string[] }} v */
export function soundSays({ stack = '', amp = '', cab = '', pedals = [] } = {}) {
  const ps = pedals.filter(Boolean);
  const list = ps.length <= 1 ? ps.join('') : `${ps.slice(0, -1).join(', ')} and ${ps.at(-1)}`;
  const what = `${amp || 'the amp'}${cab ? ` on a ${cab}` : ''}${list ? `, ${list} in front` : ''}`;
  return `That’s ${stack || 'your stack'}: ${what}. Play through it.`;
}

/** @param {{ open?: boolean, label?: string, input?: number | null, channels?: number, error?: string, monitoring?: boolean | null }} v */
export function plugSays({ open = false, label = '', input = null, channels = 0, error = '', monitoring = null } = {}) {
  if (error) return error;
  if (!open) return W.plugAsk;
  const mon = monitoring === true ? ' Monitoring on: you’re through the rig.' : monitoring === false ? ' Monitoring off: M puts you through the rig.' : '';
  return `${label || 'Your input'}${channels >= 2 && input ? `, input ${input}` : ''}.${mon}`;
}

// every word above, for the copy check (the templates said with sample values)
export function allWords() {
  const out = [];
  for (const [k, v] of Object.entries(W)) {
    if (typeof v === 'string') out.push({ id: `W.${k}`, text: v });
    else out.push({ id: `W.${k}`, text: /** @type {any} */ (v)('drop C', 'C standard', 'B standard') });
  }
  out.push({ id: 'W.sayInput', text: W.sayInput(2) });
  for (const s of TOUR) out.push({ id: `TOUR.${s.id}`, text: s.text({ amp: 'Kraken' }) }, { id: `TOUR.${s.id}.plain`, text: s.text({}) });
  const reading = (x) => ({ p: 36, note: 'C', octave: 2, live: true, held: false, shown: -9, inTune: false, string: { name: 'Low C', number: 6, cents: -9 }, ...x });
  out.push({ id: 'tunerSays.flat', text: tunerSays(reading({})) }, { id: 'tunerSays.in', text: tunerSays(reading({ inTune: true, shown: 0 })) },
    { id: 'tunerSays.far', text: tunerSays(reading({ string: { name: 'Low C', number: 6, cents: 140 }, shown: 40 })) },
    { id: 'tunerSays.held', text: tunerSays(reading({ live: false, held: true })) }, { id: 'tunerSays.all', text: tunerSays(null, { n: 6, of: 6, tuning: 'drop C' }) });
  out.push({ id: 'soundSays', text: soundSays({ stack: 'the club’s stack', amp: 'Kraken', cab: '4x12 Modern', pedals: ['a noise gate', 'a treble booster'] }) });
  out.push({ id: 'plugSays', text: plugSays({ open: true, label: 'Scarlett Solo USB', input: 2, channels: 2 }) });
  out.push({ id: 'plugSays.on', text: plugSays({ open: true, label: 'Scarlett Solo USB', input: 2, channels: 2, monitoring: true }) });
  out.push({ id: 'plugSays.off', text: plugSays({ open: true, label: 'Scarlett Solo USB', input: 2, channels: 2, monitoring: false }) });
  return out;
}

