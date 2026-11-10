// The guitar room's takes, what needs no room (docs/research/GUITAR-ROOM.md §2.5-§2.8), moved from
// tools/liveroom/checks-takes.js, which keeps them in muted Chromium: the lines keep to the room's copy rules
// (tools/liveroom/checks-copy.js breaks, rendered with every kind of value), and the part line's plans each apply as one
// step and undo exactly. test/unit/guitar-takes.test.js holds the detail.
import { test } from 'node:test';
import { checks } from './helpers/check.js';
import { breaks, renders } from '../../tools/liveroom/checks-copy.js';
import { LINES, lineOf } from '../../app/src/ui/liveroom/guitar/takes-lines.js';
import * as PP from '../../app/src/ui/liveroom/guitar/parts-plans.js';
import { createProject } from '../../app/src/core/project.js';
import { createStore } from '../../app/src/core/store.js';
import { planGuitarRoom } from '../../app/src/core/liveroom/guitar/setup.js';
import '../../app/src/devices/builtin/index.js';

test("the takes' lines and the part line's plans", async () => {
  const T = checks();
  /* ---------------------------------------------------------------------------------------- Node */
  {
    const V = [
      {
        part: 'Chorus',
        take: 2,
        bars: 4,
        ring: 1.5,
        next: 'Bridge',
        stopped: 3,
        n: 2,
        side: 'L',
        where: 'before the chorus',
        tape: true,
      },
      { part: 'Verse', take: 1, bars: 1, ring: 0, next: null, stopped: 1, n: 1, side: 'R', where: '', tape: false },
      // (the other side's verdicts, measurePair's)
      ...['tight', 'fine', 'bar', 'loose'].map((verdict, i) => ({
        part: 'Rdn Intro',
        take: 1,
        bars: 4,
        ring: 0,
        next: null,
        stopped: 4,
        n: 1,
        side: 'R',
        where: '',
        tape: false,
        verdict,
        ms: [4, -12.6, 58, 31][i],
        bar: i + 1,
        dir: i % 2 ? 'late' : 'early',
      })),
    ];
    const bad = [];
    for (const id of Object.keys(LINES)) {
      for (const v of V) {
        const t = lineOf(id, v);
        for (const b of breaks(id, t)) bad.push(`${id} "${t}": ${b.why}`);
      }
      for (const r of renders(LINES[id])) {
        if (r.error) bad.push(`${id} (${r.how}): ${r.error}`);
        else for (const b of breaks(id, r.text)) bad.push(`${id} "${r.text}": ${b.why}`);
      }
    }
    T.ok(
      !bad.length,
      `the takes' ${Object.keys(LINES).length} lines keep to the room's copy rules, every way they render${bad.length ? ': ' + bad.slice(0, 4).join('; ') : ''}`,
    );
    const store = createStore(createProject());
    const g = planGuitarRoom(store.get(), {});
    store.dispatch(g.ops, { by: 'you' });
    const strip = (p) => JSON.stringify({ ...p, meta: null });
    const s0 = strip(store.get());
    const plans = [
      ['a part at the end', () => PP.planNewPart(store.get(), {})],
      ['an intro before it', () => PP.planNewPart(store.get(), { at: 0, name: 'Intro', bars: 2 })],
      ['a move', () => PP.planMovePart(store.get(), { section: PP.partLine(store.get()).parts[0].id, to: 2 })],
      ['a delete', () => PP.planRemovePart(store.get(), { section: PP.partLine(store.get()).parts[0].id })],
    ];
    const res = [];
    for (const [what, mk] of plans) {
      const before = strip(store.get()),
        pl = mk();
      const d = store.dispatch(pl.ops, { by: 'you', label: pl.label });
      const u = store.undo();
      const back = strip(store.get()) === before;
      store.redo();
      res.push([what, d.ok && u.ok && back]);
    }
    T.ok(
      res.every((r) => r[1]) && strip(store.get()) !== s0,
      `the part line's plans: each one step, undone exactly (${res.map(([w, ok]) => `${w}${ok ? '' : ' NOT'}`).join(', ')})`,
    );
  }

  T.done();
});
