// The trusted set of kernels [share] (app/src/devices/trust.js), moved from the Node block of tools/share-test.js:
// SHA-256 as node:crypto has it, a migration that runs once, the studio's own code trusted without being stored, and
// what a song holds. The ask in the page, Play them and Keep them off are in the browser: tools/share-test.js.
import { test } from 'node:test';
import crypto from 'node:crypto';
import { checks } from './helpers/check.js';
import { same } from './_share-fixtures.js';

const MARK_INST = `/*MARK-INST*/({ poly: 4, create({ sr }) { return { voice() { let ph = 0, f = 0, g = 0, on = false; return { start(p, v) { f = 440 * Math.pow(2, (p - 69) / 12) / sr; g = 0.25 * v; on = true; }, release() { on = false; }, render(L, R, n) { if (!on) return false; for (let i = 0; i < n; i++) { ph += f; const y = Math.sin(2 * Math.PI * ph) * g; L[i] += y; R[i] += y; } return true; } }; } }; } })`;
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

test('the trusted set: SHA-256, a migration that runs once, what a song holds', async () => {
  const T = checks();
  // the trusted set in Node: SHA-256 as node:crypto has it, a migration that runs once, the studio's own code trusted
  // without being stored, and what a song holds
  const tr = await import('../../app/src/devices/trust.js');
  const mem = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => {
        m.set(k, String(v));
      },
    };
  };
  {
    const texts = [
      '',
      'abc',
      'a'.repeat(55),
      'a'.repeat(56),
      'a'.repeat(64),
      'a'.repeat(119),
      'Café ☕ 東京 🎹',
      MARK_INST,
      'x'.repeat(256 * 1024),
    ];
    T.ok(
      texts.every((s) => tr.sha256(s) === sha(s)),
      `sha256 is SHA-256 of the UTF-8 text, as node:crypto has it (${texts.length} texts, 0 to 256 KB)`,
    );
    const st = mem();
    const t1 = tr.createTrust({ storage: st, shipped: () => ['SHIPPED'] });
    const m1 = t1.migrate([{ devices: { a: { kernel: 'KERNEL-1' } } }, null, { devices: [] }]);
    const t2 = tr.createTrust({ storage: st, shipped: () => ['SHIPPED'] });
    const m2 = t2.migrate([{ devices: { b: { kernel: 'KERNEL-2' } } }]);
    const kept = JSON.parse(st.getItem(tr.TRUST_KEY)).sha256;
    T.ok(
      m1.ran &&
        m1.added === 1 &&
        !m2.ran &&
        t2.trusts('KERNEL-1') &&
        !t2.trusts('KERNEL-2') &&
        t2.trusts('SHIPPED') &&
        same(kept, [sha('KERNEL-1')]),
      `the migration runs once (then ${m2.ran ? 'again' : 'never again'}); the studio's own code is trusted without being stored; stored: { sha256: [${kept.length}] }`,
    );
    t2.allow(['KERNEL-2', sha('KERNEL-3')]);
    const song = {
      tracks: [{ id: 't_a', name: 'A', instrument: { device: 'x.inst' }, inserts: [{ id: 'fx_1', device: 'x.fx' }] }],
      master: { inserts: [{ id: 'fx_2', device: 'x.fx' }] },
      devices: {
        'x.inst': { id: 'x.inst', name: 'Inst', kind: 'instrument', kernel: 'KERNEL-2', by: 'guest:sam' },
        'x.fx': { id: 'x.fx', name: 'Fx', kind: 'effect', kernel: 'KERNEL-4', by: 'claude', via: 'guest:sam' },
      },
    };
    const held = tr.heldIn(song, (h) => tr.createTrust({ storage: st }).has(h));
    T.ok(
      held.length === 1 &&
        held[0].id === 'x.fx' &&
        held[0].hash === sha('KERNEL-4') &&
        held[0].via === 'guest:sam' &&
        same(
          held[0].uses.map((u) => u.track),
          ['A', 'Master'],
        ) &&
        tr.createTrust({ storage: st }).trusts('KERNEL-3'),
      "allow stores a kernel or a hash; heldIn lists what a song brings that isn't trusted, with where it plays",
    );
  }
  T.done();
});
