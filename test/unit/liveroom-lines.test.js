// The live room's copy (docs/research/LIVE-ROOM-MODE.md §10), moved from tools/liveroom/checks-copy.js, which keeps the
// rules themselves (other checks use them) and the talkback in muted Chromium: every line in core/liveroom/lines/*.js
// keeps them, each said two ways; every id the room's code says exists and every line defined is said; and what the
// agents are told of the room and the sheet. A failure names the file, the id, the rule and the text.
import { test } from 'node:test';
import { checks } from './helpers/check.js';
import { loadLines, renders, breaks, scanCode } from '../../tools/liveroom/checks-copy.js';

test('every line keeps the rules, its id defined once', async () => {
  const T = checks();
  const all = await loadLines();
  T.ok(
    all.length >= 150,
    `the room's lines are read from ${new Set(all.map((x) => x.file)).size} files in app/src/core/liveroom/lines (${all.length} lines)`,
  );

  // ids unique across the files
  const seen = new Map(),
    dup = [];
  for (const x of all) {
    if (seen.has(x.id)) dup.push(`${x.id} (${seen.get(x.id)} and ${x.file})`);
    else seen.set(x.id, x.file);
  }
  T.ok(!dup.length, `every line id is defined once across lines/*.js${dup.length ? `: ${dup.join('; ')}` : ''}`);

  // 1. the rules, line by line
  const unknown = new Set(),
    failures = [];
  const shapes = all.filter(
    (x) => typeof x.line?.text !== 'function' || ('once' in x.line && typeof x.line.once !== 'boolean'),
  );
  T.ok(
    !shapes.length,
    `every line is { text(vars), once? }${shapes.length ? `: ${shapes.map((x) => x.id).join(', ')}` : ''}`,
  );
  for (const x of all) {
    if (typeof x.line?.text !== 'function') continue;
    const rs = renders(x.line, unknown);
    const why = new Map();
    for (const r of rs) {
      if (r.error) {
        why.set(`throws ${r.how}`, `${r.how} vars: throws ${r.error}`);
        continue;
      }
      for (const b of breaks(x.id, r.text))
        if (!why.has(b.rule + b.why)) why.set(b.rule + b.why, `${b.rule}: ${b.why}: “${r.text}”`);
    }
    if (why.size) failures.push({ ...x, why: [...why.values()] });
  }
  for (const f of failures) T.ok(false, `${f.file} ${f.id}: ${f.why.join(' | ')}`);
  T.ok(
    !failures.length,
    `every line keeps §10.1 and §10.2 (${all.length - failures.length} of ${all.length}, each said two ways: sample vars and the other branches)`,
  );
  if (unknown.size) T.note(`vars no sample covers (said as "the verse"): ${[...unknown].sort().join(', ')}`);

  T.done();
});

test('every line said is defined, and every line defined is said', async () => {
  const T = checks();
  const all = await loadLines();
  const defined = new Set(all.map((x) => x.id));
  const { says, families, anywhere } = scanCode(defined);
  const missing = [...says].filter(([id]) => !defined.has(id));
  T.ok(
    says.size >= 60 && !missing.length,
    `every line id the room's code says exists (${says.size} said by id)${missing.length ? `: ${missing.map(([id, fs_]) => `${id} (${[...fs_].join(', ')})`).join('; ')}` : ''}`,
  );
  const fam = [...families.keys()];
  const badFam = fam.filter((p) => ![...defined].some((id) => id.startsWith(p + '.')));
  T.ok(
    !badFam.length,
    `every family a template names has lines (${fam.map((p) => p + '.*').join(', ') || 'none'})${badFam.length ? `: none for ${badFam.join(', ')}` : ''}`,
  );
  const said = (id) =>
    says.has(id) ||
    anywhere.has(id) ||
    fam.some((p) => id.startsWith(p + '.') && !id.slice(p.length + 1).includes('.'));
  const unsaid = all.filter((x) => !said(x.id));
  for (const x of unsaid) T.ok(false, `${x.file} ${x.id} is defined but nothing in the room says it`);
  T.ok(
    !unsaid.length,
    `every line defined is said somewhere in app/src/ui/liveroom or app/src/core/liveroom (${all.length - unsaid.length} of ${all.length})`,
  );

  T.done();
});

test('agents: the summary has the room and the sheet, and the catalog knows their ops', async () => {
  const T = checks();
  {
    const { summarize } = await import('../../app/src/core/project.js');
    const { createStore } = await import('../../app/src/core/store.js');
    const store = createStore(null);
    const made = store.dispatch(
      [
        { type: 'section.add', ref: 'v', section: { name: 'Verse', start: 0, length: 32 } },
        { type: 'room.set', patch: { place: 'metal', tuning: 'drop-c', finish: 'tight' } },
        { type: 'room.part.set', section: '$v', patch: { feel: 'chugs' } },
        { type: 'sheet.set', patch: { capo: 3, time: [3, 4] } },
        { type: 'sheet.section.add', section: { name: 'Verse 1', lines: [{ text: 'Somewhere a [G]paper [Em]moon' }] } },
      ],
      { by: 'claude' },
    );
    const text = made.ok === false ? '' : summarize(store.get());
    const room = (text.match(/^room: .*$/m) || [''])[0],
      sheet = (text.match(/^sheet: .*$/m) || [''])[0];
    T.ok(
      !!room && !!sheet && /metal club/.test(room) && /capo 3/.test(sheet),
      `get_project's summary has the room's and the sheet's lines ("${room.slice(0, 70)}" · "${sheet.slice(0, 60)}")`,
    );
    const tools = await import('../../app/src/agent/tools.js');
    const cat = await tools.catalogSchemas();
    const rm = cat.find((x) => x.name === 'render_and_measure'),
      ap = cat.find((x) => x.name === 'apply_ops'),
      say = cat.find((x) => x.name === 'say');
    const TEN = [
      'room.set',
      'room.part.set',
      'sheet.set',
      'sheet.section.add',
      'sheet.section.set',
      'sheet.section.remove',
      'sheet.line.add',
      'sheet.line.set',
      'sheet.line.remove',
      'section.move',
    ];
    const { ROOM_OPS } = await import('../../app/src/core/liveroom/room-ops.js');
    const { SHEET_OPS } = await import('../../app/src/core/liveroom/sheet-ops.js');
    const theirs = [...Object.keys(ROOM_OPS), ...Object.keys(SHEET_OPS), 'section.move'].sort();
    T.ok(
      cat.length === 40 &&
        JSON.stringify(theirs) === JSON.stringify([...TEN].sort()) &&
        /section\.move/.test(ap.description) &&
        /sheet\./.test(ap.description) &&
        /room\.\*/.test(ap.description) &&
        rm.input_schema.properties.targets.enum.includes('acoustic') &&
        /talkback/.test(say.description),
      `the agent tools stay 40 (${cat.length}); apply_ops names section.move, sheet.* and room.* (the ten ops: ${theirs.join(' ')}); render_and_measure takes the acoustic targets; say knows the talkback`,
    );
  }

  T.done();
});
