// ?relay= counts only on a studio on this machine (relayOverride in agent/remote.js), moved from tools/relay-test.js: on the
// live site a link carrying it would show the hidden Connect tab and point this tab at whatever answers on that port, so
// there it is ignored. The live site played by a made-up origin stays in the browser there.
import { test } from 'node:test';
import { relayOverride as o } from '../../app/src/agent/remote.js';
import { checks } from './helpers/check.js';

test('?relay= counts only on a local studio (localhost, 127.0.0.1)', () => {
  const t = checks();
  const pure = [
    o('?relay=http://127.0.0.1:8787', 'localhost'),
    o('?relay=http://localhost:8787/x', '127.0.0.1'),
    o('?relay=https://relay.example', 'localhost'),
    o('?relay=http://127.0.0.1:8787', 'overdubstudio.com'),
    o('?relay=http://localhost:8787', 'overdub.example'),
    o('?relay=javascript:alert(1)', 'localhost'),
    o('', 'localhost'),
  ];
  t.ok(
    JSON.stringify(pure) ===
      JSON.stringify([
        'http://127.0.0.1:8787',
        'http://localhost:8787',
        'https://relay.example',
        null,
        null,
        null,
        null,
      ]),
    `?relay= counts only on a local studio (localhost, 127.0.0.1): ${JSON.stringify(pure)}`,
  );
  t.done();
});
