// The cloud agent's pure rules, from tools/cloud-test.js section 0: the kind of an ask by the open rules (classify), a
// free move (freeMove), the prompt bundle's canonical form and version against the service's test vector, only an
// https (or local) checkout URL being opened, and ?cloud= only pointing a studio on this machine at a service on this
// machine. The signed-in flows against the fake service stay in the browser check.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const t = { ok: (cond, msg) => (assert.ok(cond, msg), !!cond) };

test('the open rules and the canonical form', async () => {
  {
    const { classify, freeMove, KINDS } = await import('../../app/src/agent/cloud-kind.js');
    const k = (text, hint) => classify({ text, hint }).kind;
    const cases = [
      ['Make this warmer', 'quick_change'],
      ['More space', 'quick_change'],
      ['Make the hats busier', 'quick_change'],
      ['Write a counter-melody', 'new_part'],
      ['add a bassline under the chorus', 'new_part'],
      ['Give me a bass part', 'new_part'],
      ['Give me three takes on the hook', 'new_part'],
      ['Build me a pedal like this, but darker', 'new_instrument'],
      ['make a synth that sounds like glass', 'new_instrument'],
      ['Use the reverb on the keys', 'quick_change'],
      ['find a fuzz pedal', 'quick_change'],
      ['What would you change?', 'question'],
      ['why is the bass so loud', 'question'],
      ['Can you write a bass part?', 'new_part'],
    ];
    const wrong = cases.filter(([s, want]) => k(s) !== want).map(([s, want]) => `"${s}": ${k(s)}, not ${want}`);
    t.ok(
      !wrong.length,
      `node: the kind of an ask, by the open rules (${cases.length} asks)${wrong.length ? ': ' + wrong.join('; ') : ''}`,
    );
    t.ok(
      k('Make this warmer', 'new_part') === 'new_part' &&
        k('x', 'not_a_kind') === 'quick_change' &&
        classify({ text: 'x' }).alternatives.join() === KINDS.join(),
      'node: a picked kind wins; an unknown one is ignored; all four kinds are the alternatives',
    );
    const devices = [
      { id: 'core.verb', name: 'Reverb', kind: 'effect' },
      { id: 'core.pad', name: 'Pad', kind: 'instrument' },
    ];
    const fm = (s, hasTrack = true) => freeMove(s, { devices, hasTrack });
    t.ok(
      fm('warmer')?.tool === 'adjust' &&
        fm('Make it brighter.')?.input.axis === 'brighter' &&
        fm('less muddy')?.tool === 'adjust',
      'node: one lexicon word, or "make it <word>", on a selected track is a free move',
    );
    t.ok(
      fm('use reverb')?.device === 'core.verb' &&
        fm('add a pad', false)?.device === 'core.pad' &&
        !fm('use reverb', false),
      'node: "use / add <device>" by its exact name is a free move (an effect needs a track)',
    );
    t.ok(
      !fm('warmer', false) &&
        !fm('make it warmer and add a bassline') &&
        !fm('use the cathedral reverb') &&
        !fm('warm the bass up a bit') &&
        !fm(''),
      'node: anything looser is an ask, not a free move',
    );

    const { canonicalJson, canonicalBundle, bundleVersion, safeUrl } = await import('../../app/src/agent/cloud.js');
    const vec = canonicalBundle('You are a test agent.', [
      { name: 'b_tool', description: 'B.', input_schema: { type: 'object', properties: {} } },
      { name: 'a_tool', description: 'A.', input_schema: { type: 'object' } },
    ]);
    const want =
      '{"system":"You are a test agent.","tools":[{"description":"A.","input_schema":{"type":"object"},"name":"a_tool"},{"description":"B.","input_schema":{"properties":{},"type":"object"},"name":"b_tool"}]}';
    const v = await bundleVersion(vec);
    t.ok(
      canonicalJson(vec) === want && v === 'sha256:4e39ca426d1be9ae',
      `node: the prompt bundle's canonical form and version match the service's test vector (${v})`,
    );
    t.ok(
      canonicalBundle('s', [
        { name: 'x', description: 'd', input_schema: {}, annotations: { title: 'X' }, eager_input_streaming: true },
      ]).tools[0].annotations === undefined,
      'node: a bundle tool is only name, description and input schema',
    );
    t.ok(
      safeUrl('javascript:alert(1)') === null &&
        safeUrl('http://evil.example/x') === null &&
        !!safeUrl('https://pay.example/x'),
      'node: only an https (or local) checkout URL is opened',
    );

    const { cloudOrigin, cloudOverride } = await import('../../app/src/site-config.js');
    t.ok(
      cloudOrigin('https://api.example.com/x') === 'https://api.example.com' &&
        cloudOrigin('http://localhost:8787') === 'http://localhost:8787' &&
        !cloudOrigin('http://api.example.com') &&
        !cloudOrigin('javascript:x') &&
        !cloudOrigin('https://u:p@api.example.com'),
      'node: a cloud origin is https, or http on this machine',
    );
    t.ok(
      cloudOverride('?cloud=http://localhost:8787', 'localhost') === 'http://localhost:8787' &&
        !cloudOverride('?cloud=https://api.example.com', 'localhost') &&
        !cloudOverride('?cloud=http://localhost:8787', 'overdubstudio.com'),
      "node: ?cloud= only points a studio on this machine at a service on this machine (a link can't send a song elsewhere)",
    );
  }
});
