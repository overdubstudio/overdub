// ?view=round is the simple view for that load, round: true, never written down. Moved from tools/round-test.js.
import { test } from 'node:test';
import { decideView } from '../../app/src/ui/workspace-view.js';
import { T } from './_t.js';

test('decideView: ?view=round is the simple view, round, this load only', () => {
  const d = decideView({ search: '?view=round', storage: null, webdriver: true });
  T.ok(
    d.view === 'simple' && d.round === true && d.persist === false && d.from === 'url',
    `?view=round is the simple view, round, this load only (${JSON.stringify(d)})`,
  );
  const s = decideView({ search: '?view=simple', storage: null, webdriver: true });
  T.ok(!s.round, '?view=simple is not round');
});
