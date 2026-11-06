// The agents' groove tools (find_grooves, use_groove, drum_track: agent/grooves-tool.js) through the tool boundary in
// Node, on the demo song with a fake app: no page, no browser. Moved from tools/grooves-test.js, which keeps the Grooves
// tab, hearing a groove, tap-to-find, Build drums and the demo agent's grooves in a real studio.
import { test } from 'node:test';
import { installGrooveTools } from '../../app/src/agent/grooves-tool.js';
import * as G from '../../app/src/core/grooves.js';
import { demoProject } from '../../app/src/core/demo.js';
import '../../app/src/devices/builtin/index.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { checks } from './helpers/check.js';
import { fakeApp } from './helpers/fake-app.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const L = G.library();

test("the agents' groove tools: results, errors, and what they leave in History", async () => {
  const t = checks();
  const app = fakeApp({ getDevice, project: demoProject() });
  installGrooveTools(app);
  const tools = await (async () => {
    const o = app,
      run = (n, i, by = 'claude') => o.tools.run(n, i, { by });
    const funk = await run('find_grooves', { style: 'funk', part: 'verse' });
    const any = await run('find_grooves', {});
    const feel = await run('find_grooves', { feel: 'laid back', limit: 20 });
    const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5]
      .flatMap((b) => [[b, 'hat']])
      .concat([
        [0, 'kick'],
        [2, 'kick'],
        [2.5, 'kick'],
        [4, 'kick'],
        [6, 'kick'],
        [6.5, 'kick'],
        [1, 'snare'],
        [3, 'snare'],
        [5, 'snare'],
        [7, 'snare'],
      ])
      .sort((a, b) => a[0] - b[0]);
    const rhythm = await run('find_grooves', {
      rhythm: { onsets: beats.map((x) => (x[0] * 60) / 110), voices: beats.map((x) => x[1]) },
    });
    const grid = await run('find_grooves', {
      rhythm: {
        steps: 16,
        step: 0.25,
        rows: {
          kick: '....X.......X...'.replace(/./g, (c, i) => (i % 4 === 0 ? 'X' : '.')),
          clap: '....X.......X...',
          open: '..x...x...x...x.',
        },
      },
    });
    const badStyle = await run('find_grooves', { style: 'polka' });
    const badRhythm = await run('find_grooves', { rhythm: { onsets: [0, 0.1] } });
    const hd = o.store.history.length;
    const dry = await run('use_groove', { groove: 'rock/straight-eighths', bar: 9, bars: 2, dry_run: true });
    const dryKept = o.store.history.length === hd;
    const h0 = o.store.history.length;
    const use = await run('use_groove', {
      groove: 'rock/straight-eighths',
      bar: 9,
      bars: 2,
      reason: 'a straight backbeat under the new part',
    });
    const clip = o.store.findClip(use.clip);
    const again = await run('use_groove', { groove: 'rock/straight-eighths', bar: 9, bars: 2 });
    const noGroove = await run('use_groove', { groove: 'rock/does-not-exist' });
    const notDrums = await run('use_groove', { groove: 'rock/straight-eighths', track: 'Bass', bar: 9 });
    const hp = o.store.history.length;
    const planOnly = await run('drum_track', { style: 'disco', dry_run: true });
    const planKept = o.store.history.length === hp;
    const h1 = o.store.history.length;
    const drum = await run(
      'drum_track',
      { style: 'disco', reason: 'a four on the floor to try under it' },
      'mcp:Claude Code',
    );
    const dt = o.store.get().tracks.find((t) => t.id === drum.track?.id);
    const badDrum = await run('drum_track', { style: 'polka' });
    return {
      funk: funk.grooves?.map((g) => g.id),
      funkGrid: funk.grooves?.[0]?.grid,
      styles: any.styles?.length,
      feel: feel.grooves?.map((g) => g.style),
      rhythm: rhythm.grooves?.map((g) => `${g.id} ${g.score}`),
      tapped: rhythm.rhythm?.tapped_bpm,
      grid: grid.grooves?.slice(0, 3).map((g) => g.id),
      badStyle,
      badRhythm,
      dry: { ok: dry.ok, dry: dry.dry_run, summary: dry.summary, hist: dryKept },
      use: {
        ok: use.ok,
        summary: use.summary,
        by: clip?.clip.by,
        track: clip?.track.name,
        start: clip?.clip.start,
        hist: h0 + 1 === hp,
      },
      again,
      noGroove,
      notDrums,
      planOnly: {
        ok: planOnly.ok,
        dry: planOnly.dry_run,
        summary: planOnly.summary,
        sections: planOnly.plan?.sections?.length,
        unchanged: planKept,
      },
      drum: {
        ok: drum.ok,
        by: dt?.by,
        clips: dt?.clips.length,
        clipsBy: dt?.clips.every((c) => c.by === 'mcp:Claude Code'),
        name: dt?.name,
        hist: o.store.history.length === h1 + 1,
      },
      badDrum,
    };
  })();
  t.ok(
    tools.funk?.length >= 2 &&
      tools.funk.every((id) => id.startsWith('funk/')) &&
      /hat\s+xxxx/.test(tools.funkGrid || '') &&
      tools.styles === L.styles.length,
    `find_grooves by style and part: ${tools.funk?.join(', ')}, each with its grid; with no style it lists the ${tools.styles} styles`,
  );
  t.ok(
    tools.feel?.length >= 3 && tools.feel.every((s) => ['Neo-soul', 'Lo-fi', 'Reggae'].includes(s)),
    `find_grooves by feel ("laid back"): ${[...new Set(tools.feel)].join(', ')}`,
  );
  t.ok(
    tools.rhythm?.length === 5 && /^(rock|pop|indie)\//.test(tools.rhythm[0]) && near(tools.tapped, 110, 2),
    `find_grooves from a rhythm given as onsets: ${tools.rhythm?.slice(0, 3).join('; ')} (tapped at ${tools.tapped} BPM)`,
  );
  t.ok(
    tools.grid?.length === 3 && tools.grid.some((id) => /^(house|disco)\//.test(id)),
    `and from a drum grid (four on the floor, claps, open hats): ${tools.grid?.join(', ')}`,
  );
  t.ok(
    /no style "polka"/.test(tools.badStyle.error) &&
      /rock/.test(tools.badStyle.hint) &&
      /at least three onsets/.test(tools.badRhythm.error),
    `its errors say what would work ("${tools.badStyle.error}"; "${tools.badRhythm.error}")`,
  );
  t.ok(
    tools.dry.ok &&
      tools.dry.dry &&
      tools.dry.hist &&
      /Rock, Straight eighths on Drums, bars 9–10/.test(tools.dry.summary),
    `use_groove dry_run plans and changes nothing ("${tools.dry.summary}")`,
  );
  t.ok(
    tools.use.ok &&
      tools.use.by === 'claude' &&
      tools.use.track === 'Drums' &&
      tools.use.start === 32 &&
      tools.use.hist,
    `use_groove puts it in: a clip on Drums at bar 9, signed by the agent, one undo step ("${tools.use.summary}")`,
  );
  t.ok(
    /bars 9–10 on Drums already holds "Rock, Straight eighths"/.test(tools.again.error) &&
      tools.again.occupied?.length === 1,
    `onto bars that hold a clip it refuses, changing nothing ("${tools.again.error}")`,
  );
  t.ok(
    /no groove "rock\/does-not-exist"/.test(tools.noGroove.error) &&
      /find_grooves/.test(tools.noGroove.hint) &&
      /Bass isn't a drum track/.test(tools.notDrums.error),
    `and says so for a groove that isn't there or a track that isn't drums ("${tools.notDrums.error}")`,
  );
  t.ok(
    tools.planOnly.ok &&
      tools.planOnly.dry &&
      tools.planOnly.unchanged &&
      tools.planOnly.sections === 2 &&
      /^Disco, verse groove in bars 1–4 and chorus groove in 5–8/.test(tools.planOnly.summary),
    `drum_track dry_run: the plan, nothing changed ("${tools.planOnly.summary}")`,
  );
  t.ok(
    tools.drum.ok && tools.drum.clipsBy && tools.drum.clips === 2 && tools.drum.hist && /^Drums/.test(tools.drum.name),
    `drum_track writes it: ${tools.drum.name}, ${tools.drum.clips} clips signed by the MCP client, one undo step`,
  );
  t.ok(/no style "polka"/.test(tools.badDrum.error), "drum_track: a style that isn't there is an error with the list");
  const schemas = await (async () => {
    const m = await import('../../app/src/agent/extra-schemas.js');
    return m.EXTRA_SCHEMAS.filter((x) => ['find_grooves', 'use_groove', 'drum_track'].includes(x.name)).map((x) => ({
      name: x.name,
      a: x.annotations,
      live: app.tools.schemas().find((y) => y.name === x.name)?.description === x.description,
    }));
  })();
  t.ok(
    schemas.length === 3 &&
      schemas.every((x) => x.live && x.a && x.a.openWorldHint === false) &&
      schemas[0].a.readOnlyHint === true &&
      schemas.slice(1).every((x) => x.a.readOnlyHint === false && x.a.destructiveHint === false),
    `the three schemas live in extra-schemas.js with their annotations, the page registers them as they are (${schemas.map((x) => `${x.name} ${x.a.readOnlyHint ? 'read-only' : 'adds'}`).join(', ')})`,
  );
  // fresh eyes 6: following use_groove's hint gave the same error again; drum_track wrote an ending under a loop that
  // goes round the song's end; and find_grooves' results led with a note that the song's maker wrote them
  const more = await (async () => {
    const o = app,
      run = (n, i, by = 'mcp:Claude Code') => o.tools.run(n, i, { by });
    const drums = o.store.get().tracks.find((t) => t.name === 'Drums');
    const taken = await run('use_groove', { groove: 'neosoul/behind-the-beat', bar: 1, bars: 2 });
    const h0 = o.store.history.length;
    const followed = await run('use_groove', {
      groove: 'neosoul/behind-the-beat',
      bar: 1,
      bars: 2,
      track: 'new',
      reason: 'the groove on its own track, as the hint says',
    });
    const t = o.store.get().tracks.find((x) => x.id === followed.track?.id);
    const out = {
      taken,
      followed: {
        ok: followed.ok,
        track: followed.track,
        clips: t?.clips.map((c) => `${c.name}@${c.start}`),
        hist: o.store.history.length - h0,
        beat:
          drums.clips.map((c) => c.name).join(', ') ===
          o.store
            .get()
            .tracks.find((x) => x.id === drums.id)
            .clips.map((c) => c.name)
            .join(', '),
      },
    };
    if (followed.ok) o.store.undo({ by: 'mcp:Claude Code' });
    const loopDry = await run('drum_track', { style: 'pop', dry_run: true });
    const endDry = await run('drum_track', { style: 'pop', ending: true, crashes: false, dry_run: true });
    const badEnd = await run('drum_track', { style: 'pop', ending: 'no' });
    out.loopDry = { loops: loopDry.plan?.loops, ending: loopDry.plan?.ending, summary: loopDry.summary };
    out.endDry = { ending: endDry.plan?.ending?.bars, crashes: endDry.plan?.crashes, summary: endDry.summary };
    out.badEnd = badEnd;
    // nothing of the song's own text reaches find_grooves: a track and a title only this song has
    o.store.dispatch(
      [
        { type: 'project.set', patch: { title: 'Zq7 the title' } },
        { type: 'track.set', track: drums.id, patch: { name: 'Zq7 the drums' } },
      ],
      { by: 'you', label: 'names only this song has' },
    );
    const found = [];
    for (const input of [
      {},
      { style: 'rock' },
      { query: 'shuffle' },
      { rhythm: { onsets: [0, 0.3, 0.6, 0.9, 1.2, 1.5], voices: ['kick', 'hat', 'snare', 'hat', 'kick', 'snare'] } },
    ])
      found.push(await run('find_grooves', input));
    o.store.undo({ by: 'you' });
    out.leaks = found.map((r) => JSON.stringify(r)).filter((s) => /Zq7/.test(s)).length;
    out.found = found.map((r) => (r.grooves || []).length);
    return out;
  })();
  t.ok(
    /track "new" for a new Drums track/.test(more.taken.hint || '') &&
      more.followed.ok &&
      more.followed.track?.new &&
      /^Drums \d/.test(more.followed.track.name) &&
      more.followed.hist === 1 &&
      more.followed.beat,
    `use_groove on taken bars says to give track "new" ("${more.taken.hint}"), and that works: ${more.followed.track?.name}, ${more.followed.clips?.join(', ')}, Drums untouched`,
  );
  t.ok(
    more.loopDry.loops === true &&
      more.loopDry.ending === null &&
      /no ending, so the loop goes round/.test(more.loopDry.summary || ''),
    `drum_track on a song whose loop goes round its end: no ending by default ("${(more.loopDry.summary || '').split('. ')[0]}")`,
  );
  t.ok(
    more.endDry.ending?.join() === '7,8' &&
      more.endDry.crashes?.length === 0 &&
      /no crashes/.test(more.endDry.summary || '') &&
      /ending is true or false/.test(more.badEnd.error || ''),
    `drum_track's ending: true and crashes: false say so in the plan (the ending in bars ${more.endDry.ending?.join('–')}, crashes at ${more.endDry.crashes?.length ?? '?'} bars); a word for ending is an error`,
  );
  t.ok(
    more.leaks === 0 && more.found.every((n) => n > 0),
    `find_grooves carries none of the song's own text, only the library (${more.found.join(', ')} grooves across four calls, none naming the song's title or tracks)`,
  );
  t.done();
});
