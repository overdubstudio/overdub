// @ts-check
// What the shop says on the talkback [ui; the guitar room's SHOP stream]: the engineer behind the glass (CLAUDE.md
// "Copy"; docs/BRAND.md): what was done, then what changed, then the number. House lines, unsigned. Each is a function
// of its vars; tools/liveroom/checks-shop.js holds every one to the talkback's rules (checks-copy.js: no never-says
// word, two sentences at most, nothing broken) with SAMPLE's vars.
//
//   SAY.<id>(vars) -> string        SAMPLE.<id>: vars to check it with

const n = (k, one, many = one + 's') => `${k} ${k === 1 ? one : many}`;

export const SAY = {
  enter: () => 'The shop: whatever you take off the wall or out of the case goes onto your stack in the corner. A for amps, P for pedals.',
  leave: ({ amp, pedals, changed }) => `Back on stage with ${amp} and ${n(pedals, 'pedal')} on the board.${changed ? ' This song’s copy: Save to rack keeps it.' : ''}`,
  ampOn: ({ name, cab, was, sec }) => `${name} is on ${cab}: you’re playing through it.${was ? ` ${was} is back on the wall, under ${sec}.` : ''}`,
  ampAlready: ({ name }) => `${name} is already on your stack.`,
  pedalOn: ({ name, nth, loop }) => `${name} is on your board, ${nth}${loop ? ', in the amp’s loop' : ', before the amp'}. You’re playing through it.`,
  pedalOff: ({ name, cat }) => `${name} is back in the case, under ${cat}.`,
  boardFull: () => 'Eight pedals is a full board. Put one back in the case first.',
  stackUp: ({ name, said }) => `${name} is up: ${said}. You’re playing through it.`,
  saved: ({ name }) => `Saved to the rack as ${name}. Any song can load it.`,
  savedOver: ({ name }) => `${name} on the rack has your stack now. Every song that loads it gets this one.`,
  renamed: ({ name }) => `On the rack it’s ${name} now.`,
  removed: ({ name }) => `${name} is off the rack. Put it back, on the rack’s sheet, undoes that until you leave the shop.`,
  restored: ({ name }) => `${name} is back on the rack.`,
  cab: ({ cab, amp, blurb }) => `${cab} under ${amp}.${blurb ? ` ${blurb}.` : ''}`,
  mic: ({ mic, blurb }) => `The ${mic.toLowerCase()} is up on the cab now: ${blurb}.`,
  micMoved: ({ mic, where, dist, tone }) => `${mic} ${where}, ${dist} back: ${tone}.`,
  micAngle: ({ mic, ang, tone }) => `${mic} ${ang}° off axis: ${tone}.`,
  mic2On: ({ mic }) => `A ${mic.toLowerCase()} on the next cone, blended half and half. Drag it where you like.`,
  mic2Off: () => 'Mic 2 is off the cab: one mic, as before.',
  blend: ({ blend, tone }) => `Blend ${blend}: ${tone}.`,
  flip: ({ on }) => (on ? 'Mic 2’s phase flipped: listen for the low end thinning or filling.' : 'Mic 2’s phase is back to normal.'),
  noAmp: () => 'There’s no amp on your stack. The wall is through the door.',
  stackCab: ({ cab }) => `The Half Stack’s cab is ${cab} now. Its mics are where the engineer left them.`,
};

export const SAMPLE = {
  leave: { amp: 'Kraken on a 4x12 Modern', pedals: 3, changed: true },
  ampOn: { name: 'Megalodon', cab: 'your 4x12 Modern', was: 'Kraken', sec: 'high gain' },
  ampAlready: { name: 'Kraken' },
  pedalOn: { name: 'Clam Shut', nth: 'second', loop: false },
  pedalOff: { name: 'Clam Shut', cat: 'Dynamics' },
  stackUp: { name: 'The club’s stack', said: 'Kraken on a 4x12 Modern, a noise gate and a treble booster in front' },
  saved: { name: 'Kraken wall' },
  savedOver: { name: 'Kraken wall' },
  renamed: { name: 'Doom wall' },
  removed: { name: 'Doom wall' },
  restored: { name: 'Doom wall' },
  cab: { cab: '4x12 British Vintage', amp: 'Kraken', blurb: 'Closed British 4x12: warm, woody mids, soft top' },
  mic: { mic: 'Ribbon', blurb: 'a ribbon: dark, smooth, big low end' },
  micMoved: { mic: 'Dynamic', where: 'on the cap edge', dist: '1″', tone: 'brighter' },
  micAngle: { mic: 'Dynamic', ang: 30, tone: 'darker' },
  mic2On: { mic: 'Ribbon' },
  blend: { blend: '5.0', tone: 'even' },
  flip: { on: true },
  stackCab: { cab: 'Modern bright' },
};
