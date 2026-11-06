// Back from a checkout (takeCheckoutReturn in agent/cloud-panel.js), moved from tools/cloud-test.js: the address-bar part on
// its own. plus and ref leave the address, the rest of the query and the #hash stay. The success URL landing in a fresh
// studio, with the Agent panel closed, stays in the browser there.
import { test } from 'node:test';
import { takeCheckoutReturn as takePaidReturn } from '../../app/src/agent/cloud-panel.js';
import { checks } from './helpers/check.js';

test('?plus=done and ?plus=cancel are read once and leave the address bar', () => {
  const t = checks();
  const at = (u) => {
    const url = new URL(u);
    let now = u;
    return {
      win: {
        location: url,
        history: {
          state: null,
          replaceState: (_s, _t, to) => {
            now = new URL(to, url).href;
          },
        },
      },
      now: () => now,
    };
  };
  const a = at('http://localhost/app/?demo&plus=done&ref=chk_9#s=abc');
  const ra = takePaidReturn(a.win);
  const b = at('http://localhost/app/?plus=done&ref=../../x');
  const rb = takePaidReturn(b.win);
  const c = at('http://localhost/app/?demo&plus=cancel#s=abc');
  const rc = takePaidReturn(c.win);
  const d = at('http://localhost/app/?plus=other');
  const rd = takePaidReturn(d.win);
  const strip = { ra, a: a.now(), rb, b: b.now(), rc, c: c.now(), rd, d: d.now() };
  t.ok(
    strip.ra?.ref === 'chk_9' &&
      strip.a === 'http://localhost/app/?demo#s=abc' &&
      strip.rb?.ref === null &&
      strip.b === 'http://localhost/app/',
    `?plus=done&ref= is read once and leaves the address bar; the rest of the query and the hash stay; a bad ref is dropped (${strip.a} | ${strip.b})`,
  );
  t.ok(
    strip.rc?.cancelled === true &&
      !('ref' in strip.rc) &&
      strip.c === 'http://localhost/app/?demo#s=abc' &&
      strip.rd === null &&
      strip.d === 'http://localhost/app/?plus=other',
    `?plus=cancel is read once and leaves the address bar the same way; any other plus= is left alone (${strip.c} | ${strip.d})`,
  );
  t.done();
});
