// Screenshots of the second guitar-room mock, in muted headless Chromium on its own server (tools/pw.js):
//   node design/mock/guitar-room-2/shoot.js [id ...]     (no ids: every screen in SHOTS)
// They land in design/mock/guitar-room-2/shots/. The mock makes no sound and asks for no mic.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from '../../../tools/pw.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
const SHOTS = [
  ['01a-getting-started-plug', 'gs-plug'], ['01b-plug-in-the-window', 'gs-plug-in'], ['01c-tune-on-the-floor', 'gs-tune'], ['01d-tune-stomped', 'gs-tune-on'],
  ['01e-timing-eight-clicks', 'gs-time'], ['01f-timing-measured', 'gs-time-done'], ['01g-your-sound', 'gs-sound'], ['01h-tour-board', 'gs-tour-board'], ['01i-tour-drummer', 'gs-tour-kit'],
  ['02a-stage', 'stage'], ['02b-stage-jamming', 'stage-jam'], ['02c-riffs-and-part-line', 'drawer'],
  ['03a-zoom-head', 'zoom-head'], ['03b-zoom-cab-mics', 'zoom-cab'], ['03c-zoom-cab-second-mic', 'zoom-cab-2'], ['03d-zoom-kit-the-book', 'zoom-kit'], ['03e-zoom-board', 'zoom-board'], ['03f-zoom-tuner', 'zoom-tuner'], ['03g-the-tape', 'tape'],
  ['04a-shop-amp-wall', 'shop-wall'], ['04b-shop-looking-at-an-amp', 'shop-look-amp'], ['04c-shop-pedal-case', 'shop-case'], ['04d-shop-looking-at-a-pedal', 'shop-look-pedal'], ['04e-shop-carried-in', 'shop-after'], ['04f-shop-try-out-corner', 'shop-tryout'],
];
const SIZES = { '': [1440, 900], '-1280': [1280, 800], '-2000': [2000, 1028] };
const want = process.argv.slice(2);
const list = want.length ? SHOTS.filter(([n, id]) => want.some((w) => n.includes(w) || id === w)) : SHOTS;
const sizes = process.env.SIZES ? process.env.SIZES.split(',').map((s) => (s === '1440' ? '' : '-' + s)) : [''];
let bad = 0;
for (const suf of sizes) {
  const [width, height] = SIZES[suf];
  const { page, close, errors } = await open('/design/mock/guitar-room-2/', { width, height });
  await page.waitForFunction(() => window.mock);
  await page.waitForTimeout(600);
  for (const [name, id] of list) {
    await page.evaluate((x) => window.mock.go(x), id);
    await page.waitForTimeout(1100);
    await page.screenshot({ path: path.join(OUT, name + suf + '.png') });
    console.log('shot', name + suf);
  }
  if (errors.length) { bad++; console.log(errors.join('\n')); }
  await close();
}
process.exit(bad ? 1 : 0);
