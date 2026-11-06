// The panes in Liner notes (design/LINER-NOTES-KIT.md), read as source: no sparkle, no inset stripe, no pill, a byline
// and not a badge. Moved intact from the static part of tools/panes-test.js; the panes in the studio stay there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES = ['sketch', 'browser', 'rack', 'mixer', 'pianoroll', 'drumgrid', 'inspector', 'reference'];

test('the panes carry no sparkle, stripe, pill or badge', () => {
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(HERE, '../../app/src/ui', f + '.js'), 'utf8');
    const cssStart = src.lastIndexOf('= `');
    const cssSrc = cssStart > 0 ? src.slice(cssStart) : '';
    assert.ok(!/icon\('sparkle'/.test(src), `${f}.js calls no sparkle icon`);
    assert.ok(
      !/inset\s+-?\d+(\.\d+)?px\s+0\s+0\s/.test(cssSrc) && !/inset 0 -\d+px 0 var\(--ae\)/.test(cssSrc),
      `${f}.js's CSS draws no inset stripe`,
    );
    assert.ok(!/border-radius:\s*99px/.test(cssSrc), `${f}.js's CSS has no 99px pill`);
    assert.ok(
      !/span\.badge-(agent|human)'?\s*,\s*authorName|h\(`span\.badge-/.test(src),
      `${f}.js signs with byline(), not a badge span`,
    );
  }
});

test("Sketch's rolls and dot", () => {
  const sk = fs.readFileSync(path.join(HERE, '../../app/src/ui/sketch.js'), 'utf8');
  assert.ok(
    !/fillStyle = cs\.human; g\.fillRect\(x, y, 2\.5, hh\)/.test(sk),
    "Sketch's rolls draw no warm left edge on notes (a warm outline instead)",
  );
  assert.ok(!/animation: sk-pulse/.test(sk) && !/@keyframes sk-pulse/.test(sk), 'Sketch has no pulsing dot');
});
