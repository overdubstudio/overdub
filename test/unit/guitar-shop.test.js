// The guitar room's shop, what needs no room (docs/research/GUITAR-ROOM.md §2.9; ui/liveroom/guitar/shop-data.js), moved
// from tools/liveroom/checks-shop.js, which keeps the levels and the shop in muted Chromium: the amp wall holds every amp
// once, in its tone's section; the pedal case every pedal once, in its drawer; a carried amp keeps your cab and mics and
// comes in at its measured level; a stack in a phrase; the cab builder's reading; the shop's words keep the rules.
import { test } from 'node:test';
import { checks } from './helpers/check.js';

test('the catalogue, a carried amp, the cab and the words', async () => {
  const T = checks();
  const D = await import('../../app/src/ui/liveroom/guitar/shop-data.js');
  const { listDevices } = await import('../../app/src/devices/registry.js');
  const { CLUB_STACK } = await import('../../app/src/core/liveroom/guitar/setup.js');

  /* ---------------------------------------------------------------------------------------- Node */
  {
    const secs = D.ampsBySection();
    const onWall = secs.flatMap((s) => s.amps.map((d) => d.id));
    const amps = listDevices({ cat: 'amp' })
      .filter((d) => d.id.startsWith('amp.'))
      .map((d) => d.id);
    const missing = amps.filter((id) => !onWall.includes(id));
    const twice = onWall.filter((id, i) => onWall.indexOf(id) !== i);
    const wrong = secs.flatMap((s) => s.amps.filter((d) => D.toneOf(d) !== s.tone).map((d) => d.id));
    T.ok(
      !missing.length && !twice.length && !wrong.length && onWall.includes('core.stack'),
      `the amp wall holds every amp once, in its tone's section, the Half Stack with the high-gain heads (${secs.map((s) => `${s.label} ${s.amps.length}`).join(', ')})${missing.length ? ': missing ' + missing.join(' ') : ''}${twice.length ? ': twice ' + twice.join(' ') : ''}`,
    );
    const cats = D.pedalsByCat();
    const inCase = cats.flatMap((c) => c.pedals.map((d) => d.id));
    const pedals = listDevices({ kind: 'effect' })
      .filter((d) => d.id.startsWith('pedal.'))
      .map((d) => d.id);
    const lost = pedals.filter((id) => !inCase.includes(id));
    T.ok(
      !lost.length && inCase.length === pedals.length,
      `the pedal case holds every pedal once, in its drawer (${cats.map((c) => `${c.word} ${c.pedals.length}`).join(', ')}; ${inCase.length} of ${pedals.length})${lost.length ? ': not in a drawer ' + lost.join(' ') : ''}`,
    );
    const club = CLUB_STACK.chain.find((l) => l.device === 'amp.recto');
    const meg = D.carriedAmp('amp.metal', club);
    const keep = ['cab', 'mic', 'micpos', 'micdist', 'micang'].every((k) => meg.params[k] === club.params[k]);
    const lv = D.carryLevel('amp.metal');
    const hs = D.carriedAmp('core.stack', club);
    T.ok(
      keep &&
        meg.params.level === lv.value &&
        meg.on &&
        !('gain' in meg.params) &&
        !('cab' in hs.params) &&
        hs.params.level === D.carryLevel('core.stack').value,
      `a carried amp keeps your cab and mics and comes in at its measured level, its own knobs at their defaults (Megalodon: MASTER ${lv.value}, on cab ${meg.params.cab}; the Half Stack: LEVEL ${hs.params.level} dB)`,
    );
    const said = D.describeStack(CLUB_STACK.chain);
    T.ok(
      /^Kraken on a 4x12 Modern, a noise gate and a treble booster in front$/.test(said),
      `a stack in a phrase: "${said}"`,
    );
    const cab = D.cabOf(club);
    T.ok(
      cab.kind === 'clawd' &&
        cab.cab === 'v412' &&
        cab.mic1.type === 'dyn' &&
        cab.mic1.pos === 0.3 &&
        cab.mic2 === null &&
        D.cabOf({ device: 'core.stack', params: {} }).kind === 'stack',
      `the cab builder reads the amp's own params (Kraken: ${cab.cabName}, ${D.MICS[cab.mic1.type].name} ${D.onCone(cab.mic1.pos)}, ${D.inches(cab.mic1.dist)})`,
    );
    // the shop's own words keep the talkback's rules
    const { SAY, SAMPLE } = await import('../../app/src/ui/liveroom/guitar/shop-say.js');
    const { NEVER, sentences } = await import('../../tools/liveroom/checks-copy.js');
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const NEVER_RE = Object.entries(NEVER).flatMap(([kind, words]) =>
      words.map((w) => ({
        kind,
        w,
        re: new RegExp(`(?<![\\p{L}\\p{N}])${esc(w).replace(/ /g, '\\s+')}(?:s|es)?(?![\\p{L}\\p{N}])`, 'iu'),
      })),
    );
    const bad = [];
    for (const [k, fn] of Object.entries(SAY)) {
      let text;
      try {
        text = fn(SAMPLE[k] || {});
      } catch (e) {
        bad.push(`${k} throws: ${e.message}`);
        continue;
      }
      for (const { kind, re } of NEVER_RE) {
        const m = text.match(re);
        if (m) bad.push(`${k} says "${m[0]}" (${kind})`);
      }
      if (sentences(text) > 2) bad.push(`${k}: ${sentences(text)} sentences`);
      if (/!|undefined|NaN|\[object|\s{2}/.test(text)) bad.push(`${k}: "${text}"`);
    }
    T.ok(
      !bad.length,
      `the shop's ${Object.keys(SAY).length} lines keep the talkback's rules (no never-says word, two sentences at most, nothing broken)${bad.length ? ': ' + bad.join('; ') : ''}`,
    );
  }

  T.done();
});
