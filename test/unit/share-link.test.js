// Share links, the whole round trip and what a hostile one can do (core/share.js, core/project.js cleanProject,
// core/store.js author, devices/registry.js defineDevice), in Node on a song with every kind of author. Moved from
// tools/share-test.js section 1 and its crafted-link blocks; the sharing flows in the page stay there. Several checks
// overlap test/unit/share.test.js on a smaller song; none was dropped.
import { test } from 'node:test';
import * as S from '../../app/src/core/share.js';
import '../../app/src/devices/builtin/index.js';
import '../../app/src/devices/library/index.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { createStore } from '../../app/src/core/store.js';
import { demoProject } from '../../app/src/core/demo.js';
import { T } from './_t.js';
import {
  KERNEL,
  richSong,
  signatures,
  stripBy,
  same,
  linkOf,
  EVIL,
  WRONG_SHAPES,
  spinCycle,
} from './_share-fixtures.js';

test('core/share.js on a rich song: encode, decode, listen copy, devices, credits, provenance, fork, sent back, too big, broken links', async () => {
  const song = richSong();
  const before = JSON.stringify(song);
  const enc = await S.encodeShare(song, { from: { name: 'Sam Rivers', me: 'sender01' } });
  T.ok(
    enc.ok && enc.hash.startsWith('#s=') && /^[A-Za-z0-9_-]+$/.test(enc.data),
    `encodes to a #s= link: ${S.kb(enc.chars)} for a ${S.kb(enc.bytes)} song (${Math.round((100 * enc.chars) / enc.bytes)}%)`,
  );
  T.ok(JSON.stringify(song) === before, 'encoding leaves the song untouched');
  T.ok(
    enc.dropped.audioClips === 1 && enc.dropped.assets === 1,
    'the audio clip and its recording are left out, and counted',
  );
  {
    const withRef = {
      ...richSong(),
      reference: {
        asset: 'a_ref001',
        name: 'Someone Else’s Single.mp3',
        duration: 200,
        profile: { lufs: -9 },
        by: 'you',
      },
    };
    const sh = S.shareable(withRef);
    T.ok(
      !('reference' in sh.song) &&
        sh.dropped.reference === 1 &&
        withRef.reference.name &&
        S.shareable(richSong()).dropped.reference === 0,
      'the reference track (its name, profile and asset) stays out of a link, and is counted',
    );
  }

  const dec = await S.decodeShare('https://overdubstudio.com/app/' + enc.hash);
  const expect = S.shareable(song).song;
  T.ok(
    dec.ok && same(dec.song, expect),
    'decode gives back exactly what was shared (every note, param, section, the mix)',
  );
  T.ok(
    dec.song.tracks.find((t) => t.id === 't_audio1').clips.length === 0 && Object.keys(dec.song.assets).length === 0,
    'no audio clip or asset in the link',
  );
  T.ok(
    same(dec.song.devices, song.devices),
    'the kernels written in the song travel exactly (source, version, author)',
  );
  T.ok(
    dec.from.name === 'Sam Rivers' && dec.dropped.audioClips === 1,
    "the sender's name and what was left out travel with it",
  );

  // the listener's copy: the sender's own parts are a guest's; agents and the house are untouched (in the notes and
  // the mix; the devices, code in the link, are all the sender's)
  const l = S.listenCopy(dec, {});
  const notDevice = (k) => !k.startsWith('device ');
  const a = signatures(dec.song),
    b = signatures(l.song);
  const changed = Object.keys(a).filter((k) => notDevice(k) && a[k] !== b[k]);
  T.ok(
    /^guest:sam-rivers-[0-9a-f]{6}$/.test(l.guest) &&
      changed.length > 0 &&
      changed.every((k) => a[k] === 'you' && b[k] === l.guest),
    `in someone else's studio the sender's ${changed.length} parts are signed ${l.guest}, and nothing else moved`,
  );
  T.ok(
    Object.keys(a)
      .filter((k) => notDevice(k) && a[k] !== 'you')
      .every((k) => a[k] === b[k]),
    "every agent's and the house's signature is exactly as it was (claude, mcp:cursor, overdub)",
  );
  // devices: the sender's own are the guest's; an agent's keep the agent's name (per the sender), under a guest.* id
  const ren = l.devices.renamed;
  const back = Object.fromEntries(Object.entries(ren).map(([k, v]) => [v, k]));
  const devs = Object.values(l.song.devices);
  const was = (d) => dec.song.devices[back[d.id] || d.id];
  const agentDevs = devs.filter((d) => was(d).by === 'claude'),
    mineDevs = devs.filter((d) => was(d).by === 'you');
  T.ok(
    agentDevs.length >= 3 &&
      agentDevs.every(
        (d) =>
          d.by === 'claude' && d.via === l.guest && !d.claimedBy && /^guest\./.test(d.id) && ren[back[d.id]] === d.id,
      ),
    `the link's ${agentDevs.length} devices Claude wrote stay Claude's, per the sender, under guest ids (${agentDevs.map((d) => `${back[d.id]} -> ${d.id}`).join(', ')})`,
  );
  T.ok(
    mineDevs.length === 1 && mineDevs.every((d) => d.by === l.guest && !d.claimedBy && !d.via && d.id === 'you.half'),
    "the sender's own device is the guest's, under its own id",
  );
  T.ok(
    Object.values(l.song.devices).every((d) => !S.isHouseId(d.id) && !/^claude\./.test(d.id)),
    "no device in the listener's copy has a house or claude.* id",
  );
  const noClaim = (p) => JSON.parse(JSON.stringify(p, (k, v) => (k === 'claimedBy' || k === 'via' ? undefined : v)));
  // put the renamed ids back, and the copy is the link, note for note and kernel for kernel
  const unmove = (x) =>
    JSON.parse(
      JSON.stringify(x, (k, v) =>
        k === 'device' && typeof v === 'string' && back[v]
          ? back[v]
          : k === 'id' && typeof v === 'string' && back[v]
            ? back[v]
            : v,
      ),
    );
  const devsBack = Object.fromEntries(Object.entries(unmove(l.song.devices)).map(([k, v]) => [back[k] || k, v]));
  T.ok(
    same(stripBy(unmove(l.song.tracks)), stripBy(dec.song.tracks)) &&
      same(noClaim(stripBy(devsBack)), stripBy(dec.song.devices)) &&
      same(stripBy(unmove(l.song.master)), stripBy(dec.song.master)),
    'the notes and devices themselves are identical (the renamed ids put back)',
  );
  // the banner's line: in proportion, the house included
  {
    const cr = S.creditsOf(l.song);
    const total = cr.reduce((n, a) => n + (a.share || 0), 0);
    const house = cr.find((a) => a.id === 'overdub');
    T.ok(
      total === 100 &&
        cr[0].id === 'overdub' &&
        house.share > 50 &&
        cr.some((a) => a.id === l.guest) &&
        cr.every((a, i) => !i || a.share == null || cr[i - 1].share >= a.share),
      `credits are in proportion and add to 100: ${cr.map(S.shareText).join(', ')}`,
    );
  }
  {
    // the attribution log keeps Claude on Claude's devices, and says a link vouched for it
    const { provenanceModel } = await import('../../app/src/ui/provenance.js');
    const m = provenanceModel(l.song, { getDevice });
    const nb = (m.devices || []).filter((d) => /^guest\.(night-bus|firefly|tidal-cathedral)$/.test(d.id));
    const mine = (m.devices || []).find((d) => d.id === 'you.half');
    T.ok(
      nb.length === 3 &&
        nb.every((d) => d.author === 'Claude, per the sender' && d.authorKind === 'agent' && d.via === l.guest) &&
        mine &&
        mine.authorKind === 'human' &&
        !mine.via,
      `provenance: ${nb.map((d) => `${d.name} by ${d.author}`).join('; ')}; ${mine?.name} by ${mine?.author}`,
    );
  }
  // a link where the house wrote most of it, the agents some and the sender a little: the house leads the line
  {
    const demo = demoProject();
    const t0 = demo.tracks.find((t) => t.clips.some((c) => c.notes?.length));
    t0.clips
      .find((c) => c.notes?.length)
      .notes.slice(0, 2)
      .forEach((n) => {
        n.by = 'you';
      });
    const o = S.listenCopy({ song: S.shareable(demo).song, from: { name: 'Sam', mark: 'abcdef' } }, {});
    const cr = S.creditsOf(o.song);
    const names = cr.map((a) => a.id);
    T.ok(
      names[0] === 'overdub' &&
        names.includes('claude') &&
        names.includes(o.guest) &&
        cr[0].share > cr.find((a) => a.id === o.guest).share,
      `a demo the house mostly wrote reads that way: ${cr.map(S.shareText).join(', ')}`,
    );
    const nb = Object.values(o.song.devices).filter((d) => d.by === 'claude');
    T.ok(
      nb.length === 3 && nb.every((d) => d.via === o.guest && d.id.startsWith('guest.')),
      `Night Shift's ${nb.length} devices arrive signed by Claude (${nb.map((d) => d.name).join(', ')}), per the sender`,
    );
  }
  T.ok(
    l.song.meta.authors[l.guest]?.kind === 'human' &&
      l.song.meta.authors[l.guest]?.name === 'Sam Rivers' &&
      !l.song.meta.authors.you,
    "the guest is a named person in the song's authors",
  );
  const own = S.listenCopy(dec, { own: await S.isOwnLink(dec, 'sender01') });
  T.ok(own.own && same(signatures(own.song), a), 'your own link opens with your parts still yours');

  // the link never carries the browser's id: a mark made from it, the moment and the song, that can't be moved
  T.ok(
    !JSON.stringify(dec.from).includes('sender01') && !('me' in dec.from) && /^[0-9a-f]{16}$/.test(dec.from.mark || ''),
    `the link carries a mark, not the browser's id (from: ${JSON.stringify(dec.from)})`,
  );
  T.ok(!(await S.isOwnLink(dec, 'listener9')) && !(await S.isOwnLink(dec, null)), 'in another browser it is not yours');
  {
    // someone who got that link forges one: their song, signed 'you', with the mark (or the old raw id) lifted onto it
    const forged = S.shareable(richSong()).song;
    forged.tracks[0].clips[0].notes.forEach((n) => {
      n.by = 'you';
    });
    forged.title = 'Not Yours';
    const mk = async (from) =>
      S.toBase64url(
        await S.deflate(
          new TextEncoder().encode(JSON.stringify({ f: S.SHARE_FORMAT, at: dec.at, from, dropped: {}, song: forged })),
        ),
      );
    const lifted = await S.openShared('#s=' + (await mk({ name: 'Sam Rivers', mark: dec.from.mark })), {
      me: 'sender01',
    });
    const legacy = await S.openShared('#s=' + (await mk({ name: 'Sam Rivers', me: 'sender01' })), { me: 'sender01' });
    const yours = (o) => o.song.tracks[0].clips[0].notes.some((n) => n.by === 'you');
    T.ok(
      lifted.ok && !lifted.own && !yours(lifted) && legacy.ok && !legacy.own && !yours(legacy),
      "a forged link (the mark lifted onto another song, or an old-style raw id) opens as a guest's, none of it signed you",
    );
  }

  // a link's devices add to the studio and never take one over: a built-in's id or the house shelf's comes in as the
  // guest's, and every track and insert that named it moves with it
  {
    const evil = demoProject();
    const HOSTILE = `({ create() { return { process(L, R, n) { for (let i = 0; i < n; i++) { L[i] = 0.5; R[i] = 0.5; } } }; } })`;
    const keys = evil.tracks.find((t) => t.instrument?.device === 'core.keys');
    keys.inserts.push({ id: 'fx_evil01', device: 'claude.skylight', on: true, params: {} });
    evil.master.inserts.push({ id: 'fx_evil02', device: 'claude.skylight', on: true, params: {} });
    evil.devices['core.keys'] = {
      id: 'core.keys',
      name: 'Keys',
      kind: 'instrument',
      params: [],
      kernel: HOSTILE,
      by: 'overdub',
    };
    evil.devices['claude.skylight'] = {
      id: 'claude.skylight',
      name: 'Skylight',
      kind: 'effect',
      params: [],
      kernel: HOSTILE,
      by: 'claude',
    };
    evil.devices['sam.innocent'] = {
      id: 'core.drums',
      name: 'Innocent',
      kind: 'effect',
      params: [],
      kernel: HOSTILE,
      by: 'you',
    };
    evil.devices['sam.huge'] = {
      id: 'sam.huge',
      name: 'Huge',
      kind: 'effect',
      params: [],
      kernel: '/*' + 'x'.repeat(S.MAX_KERNEL_CHARS) + '*/({})',
      by: 'you',
    };
    const enc2 = await S.encodeShare(evil, { from: { name: 'Mallory' } });
    const o = await S.openShared(enc2.hash, { me: 'listener9' });
    const ids = Object.keys(o.song.devices);
    const k2 = o.song.tracks.find((t) => t.name === 'Keys');
    const rn = o.devices.renamed;
    T.ok(
      o.ok &&
        rn['core.keys'] === 'guest.keys' &&
        rn['claude.skylight'] === 'guest.skylight' &&
        Object.entries(rn).every(
          ([k, v]) => v.startsWith('guest.') && (S.isHouseId(k) || evil.devices[k].by === 'claude'),
        ) &&
        ids.every((id) => !S.isHouseId(id) && o.song.devices[id].id === id),
      `core.keys and the shelf's claude.skylight come in as guest.keys and guest.skylight (and Claude's own as ${Object.entries(
        rn,
      )
        .filter(([k]) => !S.isHouseId(k))
        .map(([, v]) => v)
        .join(', ')}); no device in the song has a house id (${ids.join(', ')})`,
    );
    T.ok(
      k2.instrument.device === 'guest.keys' &&
        k2.inserts.find((x) => x.id === 'fx_evil01').device === 'guest.skylight' &&
        o.song.master.inserts.find((x) => x.id === 'fx_evil02').device === 'guest.skylight',
      'the Keys track, its insert and the master insert follow them to the new ids',
    );
    T.ok(
      o.song.devices['sam.innocent']?.id === 'sam.innocent' &&
        o.devices.dropped.includes('sam.huge') &&
        !o.song.devices['sam.huge'],
      "a device can't register under another id than its own, and one past 256 KB of source is left out",
    );
    T.ok(
      o.song.devices['guest.keys'].by === o.guest && o.song.devices['guest.keys'].claimedBy === 'overdub',
      "a device in a link that claims to be the house's is signed by the guest",
    );
    T.ok(
      o.song.devices['guest.skylight'].by === 'claude' &&
        o.song.devices['guest.skylight'].via === o.guest &&
        !o.song.devices['claude.skylight'],
      "one that says Claude wrote it keeps that name, per the sender (via the guest), and never under the shelf's id",
    );
    T.ok(
      getDevice('core.keys').source === 'builtin' && getDevice('claude.skylight').source === 'library',
      'the built-in and the shelf device are untouched',
    );
    // and a song can't do it through an op either (apply_ops, a relay, a replayed log)
    const st = createStore(o.song, { getDevice });
    const def = (id) =>
      st.dispatch(
        { type: 'device.define', device: { id, name: 'X', kind: 'effect', params: [], kernel: HOSTILE } },
        { by: 'claude' },
      );
    const r1 = def('core.keys'),
      r2 = def('claude.skylight'),
      r3 = def('claude.mine'),
      r4 = def('__proto__');
    T.ok(
      !r1.ok && !r2.ok && /ships/.test(r1.error) && /ships/.test(r2.error) && r3.ok && !r4.ok,
      `device.define refuses a built-in's or the shelf's id ("${r1.error}"), and takes a new one`,
    );
  }

  // fork
  const f = S.forkSong(l.song, { at: '2026-09-30T12:00:00.000Z' });
  T.ok(
    f.meta.forkedFrom &&
      f.meta.forkedFrom.title === 'Shared Reel' &&
      f.meta.forkedFrom.at === '2026-09-30T12:00:00.000Z',
    'a fork records where it came from (title, when)',
  );
  const fa = f.meta.forkedFrom.authors;
  T.ok(
    fa.some((x) => x.id === l.guest && x.kind === 'human' && x.name === 'Sam Rivers') &&
      fa.some((x) => x.id === 'claude' && x.kind === 'agent') &&
      fa.some((x) => x.id === 'mcp:cursor' && x.kind === 'agent'),
    `and who played on it: ${S.namesLine(fa)}`,
  );
  T.ok(
    same(signatures(f), signatures(l.song)) && same(f.tracks, l.song.tracks) && same(f.devices, l.song.devices),
    'the fork keeps every note, device and signature exactly',
  );

  // a song sent back (FRESH-EYES round 5): Sam's link, made Jo's, sent back. Sam's own instrument read "Tape Organ, by
  // Jo" in Sam's browser, even after Make it yours: every device not an agent's was signed by whoever sent the link.
  // An earlier guest's device keeps its maker, as an earlier guest's parts do, and says whose link it came through
  {
    const { atJo, jos, sentBack } = await spinCycle();
    const back = await S.openShared(sentBack, { me: 'samSecret01' });
    const sam = atJo.guest,
      jo = back.guest,
      dev = back.song.devices['sam.tape-organ'];
    const keyBy = [
      ...new Set(
        back.song.tracks
          .find((t) => t.name === 'Keys')
          .clips.flatMap((c) => [c.by, ...c.notes.map((n) => n.by || c.by)]),
      ),
    ];
    T.ok(
      !back.own &&
        /^guest:sam-/.test(sam) &&
        /^guest:jo-/.test(jo) &&
        dev.by === sam &&
        dev.via === jo &&
        !dev.claimedBy &&
        same(keyBy, [sam]) &&
        back.song.meta.authors[sam]?.name === 'Sam',
      `sent back by Jo, Sam's Tape Organ is still made by Sam (${dev.by}), via Jo's link (${dev.via}), as Sam's Keys parts are (${keyBy.join(', ')}); it was signed ${dev.by === jo ? 'Jo' : 'right'}`,
    );
    const kept = S.forkSong(back.song, { at: '2026-10-02T21:40:00.000Z' }).devices['sam.tape-organ'];
    T.ok(kept.by === sam && kept.via === jo, 'and still after Make it yours');
    const { provenanceModel } = await import('../../app/src/ui/provenance.js');
    const pd = (provenanceModel(back.song, { getDevice }).devices || []).find((d) => d.id === 'sam.tape-organ');
    T.ok(
      pd && pd.author === 'Sam, per the sender' && pd.authorKind === 'human' && pd.via === jo,
      `the provenance report names its maker, per the sender ("${pd?.author}")`,
    );
    // the sender's own device is still the sender's, and one claiming to be the house's is the sender's too
    jos.devices['you.jo-fizz'] = {
      id: 'you.jo-fizz',
      name: 'Fizz',
      kind: 'effect',
      params: [],
      kernel: KERNEL,
      by: 'you',
      version: 1,
    };
    jos.devices['you.claimed'] = {
      id: 'you.claimed',
      name: 'Claimed',
      kind: 'effect',
      params: [],
      kernel: KERNEL,
      by: 'overdub',
      version: 1,
    };
    const back2 = await S.openShared((await S.encodeShare(jos, { from: { name: 'Jo', me: 'joSecret001' } })).hash, {
      me: 'samSecret01',
    });
    const fz = back2.song.devices['you.jo-fizz'],
      cl = back2.song.devices['you.claimed'];
    T.ok(
      fz.by === back2.guest && !fz.via && cl.by === back2.guest && cl.claimedBy === 'overdub' && !cl.via,
      "the sender's own device is the sender's, and a house claim is still the sender's, kept as claimedBy",
    );
  }

  // too big
  const huge = demoProject();
  let seed = 7;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const notes = Array.from({ length: 9000 }, (_, i) => ({
    id: 'n' + i.toString(36),
    p: 30 + Math.floor(rnd() * 60),
    t: Math.round(rnd() * 5000) / 100,
    d: Math.round(rnd() * 400) / 100 + 0.01,
    v: Math.round(rnd() * 100) / 100,
    by: 'you',
  }));
  huge.tracks[0].clips[0].notes = notes;
  const big = await S.encodeShare(huge);
  T.ok(
    !big.ok &&
      big.chars > S.MAX_CHARS &&
      /too big for a link/.test(big.error) &&
      /project file/.test(big.error) &&
      !big.hash,
    `a song too big for a link is refused: "${big.error}"`,
  );

  // broken links fail cleanly
  const cut = await S.decodeShare(enc.hash.slice(0, Math.floor(enc.hash.length / 2)));
  T.ok(!cut.ok && /cut off/.test(cut.error), 'a link cut in half fails with a clear message');
  const none = await S.decodeShare('https://example.com/app/#x=1');
  T.ok(!none.ok && /no #s=/.test(none.error), 'a link with no song says so');
  const other = await S.decodeShare(
    '#s=' + S.toBase64url(await S.deflate(new TextEncoder().encode(JSON.stringify({ f: 'something/1', song: {} })))),
  );
  T.ok(!other.ok && /isn’t an Overdub song/.test(other.error), 'a link holding something else is refused');
  const bomb = await S.decodeShare('#s=' + S.toBase64url(await S.deflate(new Uint8Array(12 * 1024 * 1024).fill(32))));
  T.ok(!bomb.ok, 'a link that inflates past any real song is refused');
});

test('a wrong-shaped song, or text that is not text, or code that is not a kernel, opens as something safe', async () => {
  const { cleanProject, validateProject, summarize } = await import('../../app/src/core/project.js');
  const { keyLabel } = await import('../../app/src/core/music.js');
  const threw = [];
  for (const [name, song] of Object.entries(WRONG_SHAPES)) {
    try {
      const p = cleanProject(JSON.parse(JSON.stringify(song)));
      const bad = validateProject(p);
      if (bad.length) throw new Error(bad.join('; '));
      if (
        !p.tracks.every(
          (t) =>
            t &&
            Array.isArray(t.clips) &&
            Array.isArray(t.inserts) &&
            t.clips.every((c) => c.kind === 'audio' || Array.isArray(c.notes)),
        )
      )
        throw new Error('a track or clip is still the wrong shape');
      summarize(p);
      keyLabel(p.key);
      createStore(JSON.parse(JSON.stringify(song))).dispatch(
        { type: 'project.set', patch: { tempo: 99 } },
        { by: 'you' },
      );
    } catch (e) {
      threw.push(`${name}: ${e.message}`);
    }
  }
  T.ok(
    !threw.length,
    `a wrong-shaped song (${Object.keys(WRONG_SHAPES).length} shapes, from a crafted link or file) opens instead of throwing${threw.length ? ': ' + threw.join(' | ') : ''}`,
  );
  const linkThrew = [];
  for (const [name, song] of Object.entries(WRONG_SHAPES)) {
    if (!Array.isArray(song.tracks)) continue;
    try {
      const o = await S.openShared(await linkOf(song), { me: 'listener9' });
      if (!o.ok) throw new Error(o.error);
      createStore(o.song);
    } catch (e) {
      linkThrew.push(`${name}: ${e.message}`);
    }
  }
  T.ok(
    !linkThrew.length,
    `and through a link (openShared, then the store) too${linkThrew.length ? ': ' + linkThrew.join(' | ') : ''}`,
  );

  // text fields that aren't text: a name, title or blurb that is an object reaches the page as text, never as an object
  const p = cleanProject({
    title: EVIL,
    tracks: [
      {
        name: EVIL,
        by: EVIL,
        color: EVIL,
        instrument: { device: 'core.poly', params: {}, by: EVIL },
        clips: [{ name: EVIL, by: EVIL, color: EVIL, notes: [{ p: 60, t: 0, d: 1, v: 0.8, by: EVIL }] }],
        inserts: [{ device: 'core.eq', by: EVIL }],
      },
    ],
    sections: [{ name: EVIL, color: EVIL }],
    master: { inserts: [{ device: 'core.eq', by: EVIL }] },
    devices: {
      'sam.x': {
        id: 'sam.x',
        kind: 'effect',
        name: EVIL,
        blurb: EVIL,
        nod: EVIL,
        by: EVIL,
        cat: EVIL,
        kindLabel: EVIL,
        claimedBy: EVIL,
        via: EVIL,
        kernel: KERNEL,
      },
    },
    meta: {
      authors: { x: { kind: EVIL, name: EVIL } },
      forkedFrom: { title: EVIL, at: EVIL, id: EVIL, authors: [{ id: EVIL, name: EVIL, kind: EVIL }, null] },
    },
  });
  const leaks = [];
  JSON.stringify(p, function (k, v) {
    if (v && typeof v === 'object' && 'html' in v) leaks.push(k);
    return v;
  });
  T.ok(
    !leaks.length &&
      typeof p.title === 'string' &&
      typeof p.tracks[0].name === 'string' &&
      typeof (p.devices['sam.x'].blurb ?? '') === 'string' &&
      typeof p.meta.forkedFrom.title === 'string',
    `cleanProject: every title, name, blurb, author and colour that isn't text becomes text${leaks.length ? ` (still objects: ${leaks.join(', ')})` : ''}`,
  );
  const { defineDevice, removeDevice } = await import('../../app/src/devices/registry.js');
  const d = defineDevice(
    {
      id: 'sam.evil',
      kind: 'effect',
      kernel: KERNEL,
      source: 'project',
      name: EVIL,
      blurb: EVIL,
      nod: EVIL,
      by: EVIL,
      cat: EVIL,
      kindLabel: EVIL,
    },
    { replace: true },
  );
  const dt =
    ['name', 'blurb', 'by', 'cat'].every((k) => typeof d[k] === 'string') &&
    ['nod', 'kindLabel'].every((k) => d[k] == null || typeof d[k] === 'string');
  removeDevice('sam.evil');
  T.ok(
    dt,
    `defineDevice: a device's name, blurb, nod and author are text (got name ${JSON.stringify(d.name)}, blurb ${JSON.stringify(d.blurb)})`,
  );

  // a song's device is a kernel and its params: build and worklets (module source the graph path would load into the
  // audio thread, past the kernel's rules and the device check) are dropped by a song file, a link and the registry
  const MOD = {
    'pfx-env': 'registerProcessor("pfx-env", class extends AudioWorkletProcessor { process() { return true; } })',
  };
  const modSong = () => ({
    tracks: [],
    devices: { 'sam.mod': { id: 'sam.mod', kind: 'effect', kernel: KERNEL, build: 1, worklets: MOD } },
  });
  const viaFile = cleanProject(modSong()).devices['sam.mod'];
  const viaLink = await S.openShared(await linkOf(modSong()), { me: 'listener9' });
  const linkDev = viaLink.ok ? Object.values(viaLink.song.devices || {})[0] : null;
  const reg = defineDevice({ ...modSong().devices['sam.mod'], source: 'project' }, { replace: true });
  let noKernel = null;
  try {
    defineDevice({ id: 'sam.mod2', kind: 'effect', build: 1, worklets: MOD, source: 'project' });
  } catch (e) {
    noKernel = e.message;
  }
  removeDevice('sam.mod');
  const bare = (x) => !!x && !('build' in x) && !('worklets' in x);
  T.ok(
    bare(viaFile) && bare(linkDev) && bare(reg) && reg.flavour === 'kernel' && !!noKernel,
    `a song's device brings no code but its kernel: build and worklets are gone from a song file (${bare(viaFile)}), a link (${bare(linkDev)}) and the registry (a ${reg.flavour} device); one with no kernel is refused${noKernel ? '' : ' (it was registered)'}`,
  );
});

test('a link at the door: whom it credits and names, how big and deep, its colours and names', async () => {
  const { cleanProject, NAME_MAX, TRACK_COLORS } = await import('../../app/src/core/project.js');
  const keys = { device: 'core.keys', params: {} };
  const linkFrom = async (song, from) =>
    '#s=' +
    S.toBase64url(
      await S.deflate(
        new TextEncoder().encode(JSON.stringify({ f: S.SHARE_FORMAT, at: '2026-10-01T00:00:00.000Z', from, song })),
      ),
    );

  // whom it credits. The studio reads a part signed by nobody as 'you', so a link's unsigned parts (and blank, odd or
  // lookalike signatures) arrived as the listener's own. Every part not signed by an agent, an earlier guest or the
  // house is the sender's: the guest's.
  {
    const song = {
      title: 'Unsigned',
      tracks: [
        {
          id: 't_nob0001',
          name: 'Unsigned',
          instrument: keys,
          inserts: [{ id: 'fx_nob0001', device: 'core.verb', params: {} }],
          auto: {
            gain: {
              points: [
                { t: 0, v: -6 },
                { t: 4, v: 0, by: 'You' },
              ],
            },
          },
          clips: [
            {
              id: 'c_nob0001',
              kind: 'notes',
              start: 0,
              length: 4,
              notes: [
                { id: 'n1', p: 60, t: 0, d: 1, v: 0.8 },
                { id: 'n2', p: 64, t: 1, d: 1, v: 0.8, by: null },
                { id: 'n3', p: 67, t: 2, d: 1, v: 0.8, by: {} },
              ],
            },
          ],
        },
        {
          id: 't_odd0001',
          name: 'Odd',
          by: false,
          instrument: keys,
          clips: [
            {
              id: 'c_odd0001',
              kind: 'notes',
              start: 4,
              length: 4,
              by: '',
              notes: [{ id: 'n1', p: 60, t: 0, d: 1, v: 0.8, by: 'You' }],
            },
          ],
        },
        {
          id: 't_kept001',
          name: 'Kept',
          by: 'overdub',
          instrument: keys,
          clips: [
            {
              id: 'c_kept001',
              kind: 'notes',
              start: 8,
              length: 4,
              by: 'claude.ai',
              notes: [
                { id: 'n1', p: 60, t: 0, d: 1, v: 0.8, by: 'claude' },
                { id: 'n2', p: 62, t: 1, d: 1, v: 0.8, by: 'mcp:claude-code' },
                { id: 'n3', p: 64, t: 2, d: 1, v: 0.8, by: 'guest:sam-ab12cd' },
                { id: 'n4', p: 65, t: 3, d: 1, v: 0.8 },
              ],
            },
          ],
        },
      ],
      master: { gain: 0, inserts: [{ id: 'fx_mast001', device: 'core.limiter', params: {} }] },
    };
    const o = await S.openShared(await linkOf(song), { me: 'listener9' });
    const st = createStore(o.song);
    const p = st.get();
    const sig = {}; // part -> whom the listener's studio credits
    for (const t of p.tracks) {
      sig[t.id] = t.by;
      for (const fx of t.inserts) sig[fx.id] = fx.by;
      for (const [k, lane] of Object.entries(t.auto || {}))
        lane.points.forEach((pt, i) => {
          sig[`${t.id} ${k} ${i}`] = pt.by || lane.by;
        });
      for (const c of t.clips) {
        sig[c.id] = c.by;
        for (const n of c.notes) sig[`${c.id}/${n.id}`] = n.by || c.by;
      }
    }
    for (const fx of p.master.inserts) sig[fx.id] = fx.by;
    const kept = {
      t_kept001: 'overdub',
      c_kept001: 'claude.ai',
      'c_kept001/n1': 'claude',
      'c_kept001/n2': 'mcp:claude-code',
      'c_kept001/n3': 'guest:sam-ab12cd',
      'c_kept001/n4': 'claude.ai',
    };
    const theirs = Object.keys(sig).filter((k) => !(k in kept)),
      yours = Object.keys(sig).filter((k) => sig[k] === 'you');
    T.ok(
      o.ok &&
        !yours.length &&
        theirs.every((k) => sig[k] === o.guest) &&
        Object.entries(kept).every(([k, by]) => sig[k] === by) &&
        !S.creditsOf(p, (id) => st.author(id)).some((a) => a.id === 'you'),
      `a link's unsigned, blank, odd and lookalike parts are the guest's (${theirs.length} of them, ${o.guest}), never the listener's; an agent's, an earlier guest's and the house's travel as they were${yours.length ? ` (credited to you: ${yours.join(', ')})` : ''}`,
    );
  }

  // whom it names. A link names its authors (meta.authors), and the studio teaches its session those names
  // (ui/share.js): claude.ai as a person called You, a guest as the agent Claude. An id's kind is its form, and a name
  // the studio's own go by (or an agent's that joined this session) is no one else's, however it's spaced or wrapped.
  {
    const song = {
      title: 'Relabel',
      tracks: [
        {
          id: 't_rel0001',
          name: 'R',
          instrument: keys,
          by: 'guest:sam-ab12cd',
          clips: [
            {
              id: 'c_rel0001',
              kind: 'notes',
              start: 0,
              length: 4,
              by: 'claude.ai',
              notes: [
                { id: 'n1', p: 60, t: 0, d: 1, v: 0.8, by: 'mcp:cursor' },
                { id: 'n2', p: 62, t: 1, d: 1, v: 0.8, by: 'mcp:evil' },
                { id: 'n3', p: 64, t: 2, d: 1, v: 0.8, by: 'guest:ann-ff0011' },
              ],
            },
          ],
        },
      ],
      meta: {
        authors: {
          'claude.ai': { kind: 'human', name: 'You' },
          'mcp:cursor': { kind: 'house', name: 'C L A U D E' },
          'guest:sam-ab12cd': { kind: 'agent', name: '\u2067Claude\u2069' },
          'mcp:evil': { kind: 'agent', name: 'claude code' },
          'guest:ann-ff0011': { kind: 'human', name: 'Ann' },
        },
      },
    };
    const o = await S.openShared(await linkFrom(song, { name: 'Ｃｌａｕｄｅ' }), { me: 'listener9' });
    const st = createStore(o.song);
    st.addAuthor('mcp:claude-code', { kind: 'agent', name: 'Claude Code' }); // (agent/bridge.js, as Claude Code connects)
    for (const [id, a] of Object.entries(st.get().meta.authors))
      if (!st.authors[id] && !id.startsWith('mcp:')) st.addAuthor(id, a); // (ui/share.js learnAuthors)
    const who = (id) => {
      const a = st.author(id);
      return `${a.kind} ${a.name}`;
    };
    const want = {
      'claude.ai': 'agent claude.ai',
      'mcp:cursor': 'agent cursor',
      'guest:sam-ab12cd': 'human Guest',
      'mcp:evil': 'agent evil',
      [o.guest]: 'human Guest',
      'guest:ann-ff0011': 'human Ann',
      'mcp:claude-code': 'agent Claude Code',
    };
    const got = Object.fromEntries(Object.keys(want).map((id) => [id, who(id)]));
    const banner = S.creditsOf(st.get(), (id) => st.author(id)).map((a) => `${a.kind} ${a.name}`);
    T.ok(
      same(got, want) &&
        same(banner.sort(), ['agent claude.ai', 'agent cursor', 'agent evil', 'human Ann', 'human Guest']),
      `a link can't relabel an author: ${Object.entries(got)
        .map(([k, v]) => `${k} is ${v}`)
        .join(', ')}; the banner: ${banner.join(', ')}`,
    );
  }

  // how big. LIMITS held only a song that grows: a few hundred KB of link opened 120,000 notes or a clip a million beats
  // long. A link past one is refused as it comes in; the same song as a file still opens (it just can't grow)
  {
    const notes = (n) =>
      Array.from({ length: n }, (_, i) => ({ id: 'n' + i.toString(36), p: 60 + (i % 12), t: i / 8, d: 0.1, v: 0.8 }));
    const many = {
      title: 'Many',
      tracks: [0, 1, 2].map((k) => ({
        id: `t_many00${k}`,
        name: 'M' + k,
        instrument: keys,
        clips: [{ id: `c_many00${k}`, kind: 'notes', start: 0, length: 2200, notes: notes(17000) }],
      })),
    };
    const long = {
      title: 'Long',
      tracks: [
        {
          id: 't_long001',
          name: 'L',
          instrument: keys,
          clips: [{ id: 'c_long001', kind: 'notes', start: 0, length: 999999, notes: notes(4) }],
        },
      ],
    };
    const a = await S.openShared(await linkOf(many), { me: 'listener9' }),
      b = await S.openShared(await linkOf(long), { me: 'listener9' });
    const files = [many, long].map((s) => createStore(JSON.parse(JSON.stringify(s))).get());
    T.ok(
      !a.ok &&
        /51,000 notes/.test(a.error) &&
        /up to 50,000/.test(a.error) &&
        !b.ok &&
        /beat 999,999/.test(b.error) &&
        /8,192/.test(b.error) &&
        files[0].tracks.length === 3 &&
        files[1].tracks[0].clips[0].length === 999999,
      `a link past the limits is refused as it comes in ("${a.error}" / "${b.error}"); the same songs as files still open`,
    );
  }

  // how deep. A link nested 20,000 levels ran a recursive walk out of stack (a RangeError, caught only by main.js);
  // now it is refused before anything walks it
  {
    let deep = '0';
    for (let i = 0; i < 20000; i++) deep = `{"a":${deep}}`;
    const text = `{"f":"${S.SHARE_FORMAT}","at":"2026-10-01T00:00:00.000Z","from":{},"song":{"title":"Deep","tracks":[{"name":"D","by":"you","deep":${deep},"clips":[]}]}}`;
    let r = null,
      threw = null;
    try {
      r = await S.openShared('#s=' + S.toBase64url(await S.deflate(new TextEncoder().encode(text))), {
        me: 'listener9',
      });
    } catch (e) {
      threw = e;
    }
    T.ok(
      !threw && r && !r.ok && /nested deeper than any song/.test(r.error),
      `a link nested 20,000 deep is refused with a plain message (${threw ? `it threw ${threw.constructor.name}` : `"${r?.error}"`})`,
    );
  }

  // what its colours can be. A colour was any string, and the page draws one as CSS, where url(...) fetches an address
  // as soon as the song draws. A track, clip or section colour is a palette token or hex, else the default
  {
    const good = ['var(--c-3)', '#abc', '#abcd', '#a1b2c3', '#A1B2C3D4'];
    const bad = [
      'url("https://example.com/beacon.gif")',
      'red',
      'rgb(1, 2, 3)',
      'var(--c-1, url(x))',
      'var(--accent)',
      '#12',
      '#abcdefg',
      'image-set("x.png" 1x)',
      42,
      { html: 'x' },
    ];
    const song = {
      title: 'Colours',
      tracks: [...good, ...bad].map((color, i) => ({
        id: `t_col${String(i).padStart(4, '0')}`,
        name: 'C' + i,
        color,
        instrument: keys,
        clips: [{ id: `c_col${String(i).padStart(4, '0')}`, kind: 'notes', start: 0, length: 4, color, notes: [] }],
      })),
      sections: [...good, ...bad].map((color, i) => ({
        id: `s_col${String(i).padStart(4, '0')}`,
        name: 'S' + i,
        start: i * 4,
        length: 4,
        color,
      })),
    };
    const o = await S.openShared(await linkOf(song), { me: 'listener9' });
    const viaLink = createStore(o.song).get(),
      viaFile = cleanProject(JSON.parse(JSON.stringify(song)));
    const right = (p) =>
      p.tracks.every((t, i) =>
        i < good.length
          ? t.color === good[i] && t.clips[0].color === good[i]
          : TRACK_COLORS.includes(t.color) && !('color' in t.clips[0]),
      ) && p.sections.every((s, i) => (i < good.length ? s.color === good[i] : !('color' in s)));
    T.ok(
      o.ok && right(viaLink) && right(viaFile),
      `a colour comes in only as a palette token or hex (${good.join(', ')}); url(...), named, rgb() and the rest give the default, through a link and a file`,
    );
  }

  // what its names can hold. Any length and any character: a name of a few MB, control characters, bidi overrides that
  // turn text round. A name is cut at NAME_MAX and a title at 200, without control or bidi characters; the rest of
  // Unicode stays
  {
    const other = 'Café ☕ Ünïcødé — 東京 🎹';
    const song = {
      title: '\u202eTitle\u0000' + 't'.repeat(300),
      tracks: [
        {
          id: 't_nam0001',
          name: 'x'.repeat(5000),
          instrument: keys,
          clips: [
            {
              id: 'c_nam0001',
              kind: 'notes',
              start: 0,
              length: 4,
              name: 'Bass\u0000\u0007\u001b[31m\u007f\u0085',
              notes: [],
            },
          ],
        },
        {
          id: 't_nam0002',
          name: '\u202eevil\u202c \u2066Keys\u2069',
          instrument: keys,
          clips: [{ id: 'c_nam0002', kind: 'notes', start: 4, length: 4, name: other, notes: [] }],
        },
        { id: 't_nam0003', name: 'a'.repeat(NAME_MAX - 1) + '🎹', instrument: keys, clips: [] },
      ],
      sections: [{ id: 's_nam0001', name: '\u2067Verse\u2069' + 'v'.repeat(300), start: 0, length: 4 }],
      devices: {
        'sam.named': {
          id: 'sam.named',
          kind: 'effect',
          kernel: KERNEL,
          name: '\u202eDev' + 'y'.repeat(300),
          presets: [{ name: '\u0007Bright', params: {} }],
        },
      },
    };
    const o = await S.openShared(await linkOf(song), { me: 'listener9' });
    const p = createStore(o.song).get();
    const [t1, t2, t3] = p.tracks,
      dev = Object.values(p.devices)[0];
    const UNSEEN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
    const names = [
      p.title,
      ...p.tracks.map((t) => t.name),
      ...p.tracks.flatMap((t) => t.clips.map((c) => c.name)),
      ...p.sections.map((s) => s.name),
      dev.name,
      dev.presets[0].name,
    ];
    T.ok(
      o.ok &&
        t1.name.length === NAME_MAX &&
        t1.clips[0].name === 'Bass[31m' &&
        t2.name === 'evil Keys' &&
        t2.clips[0].name === other &&
        t3.name === 'a'.repeat(NAME_MAX - 1) &&
        p.title.startsWith('Title') &&
        p.title.length === 200 &&
        p.sections[0].name.startsWith('Verse') &&
        p.sections[0].name.length === NAME_MAX &&
        dev.name.startsWith('Dev') &&
        dev.name.length === NAME_MAX &&
        dev.presets[0].name === 'Bright' &&
        !names.some((x) => UNSEEN.test(x)),
      `names come in plain and at most ${NAME_MAX} characters (a 5,000-character track name: ${t1.name.length}; "${t2.name}", "${t1.clips[0].name}"; an emoji at the edge isn't cut in two), the title at 200; other Unicode stays ("${t2.clips[0].name}")`,
    );
  }
});
