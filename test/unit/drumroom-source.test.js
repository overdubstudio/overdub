// Studio A's window and the names a drum kit gives its notes, the part that reads source and needs no browser: the
// drawing's layout is the kernel's (devices/builtin/drumroom.js LAYOUT is what the mics are built from), the drawn
// cymbals are the kernel's sizes, Studio A names every note it plays, a song's device names are read as text, and
// drumName answers per kit (Studio A, Gobo Kit, a kit that names none). Moved from tools/drumroom-ui-test.js, whose
// window and phone checks stay in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import kitDef, { LAYOUT, PIECES, NOTE_MAP } from '../../app/src/devices/builtin/drumroom.js';
import { kitNotes, drumName, KIT_NOTES } from '../../app/src/core/music.js';

const ok = (cond, msg) => assert.ok(cond, msg);

test('the source: layout, cymbals, note names', async () => {
  const src = kitDef.kernel;
  const grab = (name) => {
    const m = new RegExp(`const ${name} = (\\[(?:\\[[^\\]]*\\],?)*\\]|\\[[^\\]]*\\])`).exec(src);
    return m ? JSON.parse(m[1]) : null;
  };
  const pos = grab('POS'),
    ohl = grab('OHL'),
    crm = grab('CRM');
  ok(
    JSON.stringify(pos) === JSON.stringify(PIECES.map((k) => LAYOUT.pieces[k])),
    `the kernel's piece positions are LAYOUT's, piece for piece (${pos?.length} pieces)`,
  );
  ok(
    JSON.stringify(ohl) === JSON.stringify(LAYOUT.overheads[0]) &&
      JSON.stringify(crm) === JSON.stringify(LAYOUT.crush) &&
      src.includes(`OHR = ${JSON.stringify(LAYOUT.overheads[1])}`) &&
      src.includes(`RML = ${JSON.stringify(LAYOUT.room[0])}`) &&
      src.includes(`RMR = ${JSON.stringify(LAYOUT.room[1])}`),
    'and so are its overheads, room pair and crush mic',
  );
  ok(!/__[A-Z]+__/.test(src), 'nothing in the kernel is left unfilled');
  const ed = await import('../../app/src/ui/editors/drumroom.js');
  const kernelCym = [
    ...src.matchAll(/cym: \[\[(\d+),[^\]]*\], \[(\d+),[^\]]*\], \[(\d+),[^\]]*\], \[(\d+),[^\]]*\], \[(\d+),/g),
  ].map((m) => m.slice(1, 6).map(Number));
  ok(
    kernelCym.length === 5 && kernelCym.every((c, k) => JSON.stringify(c) === JSON.stringify(ed.KIT_LOOKS[k].cym)),
    `the drawn cymbals are the kernel's sizes, kit by kit (${kernelCym.map((c) => c.join('/')).join(', ')})`,
  );
  ok(
    kitDef.editor === 'drumroom' && typeof ed.mount === 'function',
    'Studio A names its editor, and the editor keeps the contract (mount)',
  );
  const notes = kitNotes(kitDef);
  const unnamed = NOTE_MAP.filter(([p]) => !notes[p]).map(([p]) => p);
  ok(
    !unnamed.length && notes.other === 'Side stick',
    `Studio A names every note it plays, and what any other note plays (${Object.keys(notes).length - 1} notes${unnamed.length ? '; not ' + unnamed.join(', ') : ''})`,
  );
  ok(
    notes[40] === 'Rimshot' &&
      notes[31] === 'Flam' &&
      notes[24] === 'Hat 1/2 open' &&
      notes[53] === 'Ride bell' &&
      notes[59] === 'Ride edge',
    'its names are its articulations: 40 Rimshot, 31 Flam, 24 Hat 1/2 open, 53 Ride bell, 59 Ride edge',
  );
  const odd = kitNotes({
    id: 'x.kit',
    notes: {
      36: 'Kick',
      37: { toString: 'x' },
      38: '  Snare\u0007 ',
      200: 'Nope',
      abc: 'no',
      other: 'Rim',
      39: 'x'.repeat(90),
    },
  });
  ok(
    odd &&
      odd[36] === 'Kick' &&
      odd[37] === undefined &&
      odd[38] === 'Snare' &&
      odd[200] === undefined &&
      odd.abc === undefined &&
      odd.other === 'Rim' &&
      odd[39].length === 40,
    `a song's device names are read as text: strings only, MIDI notes only, trimmed and capped (${JSON.stringify(odd)})`,
  );
  const gobo = { id: 'core.drums' };
  ok(
    drumName(40, notes) === 'Rimshot' &&
      drumName(40, kitNotes(gobo)) === 'Snare (40)' &&
      drumName(40, null) === 'Snare 2',
    `40 is Rimshot on Studio A, Snare (40) on Gobo Kit, GM's Snare 2 on a kit that names none`,
  );
  ok(
    drumName(52, notes) === 'China' &&
      drumName(52, kitNotes(gobo)) === 'Crash (52)' &&
      drumName(60, notes) === 'Side stick (60)' &&
      drumName(60, kitNotes(gobo)) === 'Rim (60)' &&
      drumName(60, null) === 'Hi bongo',
    "and 52 is a China or Gobo's crash; an unnamed 60 is what the kit plays there (or GM's bongo)",
  );
  ok(
    !!KIT_NOTES['core.drums'] && Object.values(KIT_NOTES['core.drums']).every((x) => typeof x === 'string'),
    "Gobo Kit's names are there for what it plays",
  );
});
