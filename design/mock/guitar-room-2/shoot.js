// Screenshots of the second guitar-room mock, in muted headless Chromium on its own server (tools/pw.js):
//   node design/mock/guitar-room-2/shoot.js [id ...]     (no ids: every screen in SHOTS)
// They land in design/mock/guitar-room-2/shots/. The mock makes no sound and asks for no mic.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from '../../../tools/pw.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
const SHOTS = [
  ['01a-getting-started-plug', 'gs-plug'], ['01b-plug-in-the-jack', 'gs-plug-jack'], ['01c-plug-in-the-window', 'gs-plug-in'], ['01d-tune-on-the-floor', 'gs-tune'], ['01e-tune-stomped', 'gs-tune-on'],
  ['01f-timing-eight-clicks', 'gs-time'], ['01g-timing-measured', 'gs-time-done'], ['01h-your-sound', 'gs-sound'], ['01i-tour-board', 'gs-tour-board'], ['01j-tour-drummer', 'gs-tour-kit'], ['01k-tour-shop-door', 'gs-tour-door'],
  ['02a-stage', 'stage'], ['02b-stage-jamming', 'stage-jam'], ['02c-turning-a-knob', 'stage-knob'], ['02d-riffs-and-part-line', 'drawer'],
  ['03a-zoom-head', 'zoom-head'], ['03b-zoom-cab-mics', 'zoom-cab'], ['03c-zoom-cab-second-mic', 'zoom-cab-2'], ['03d-zoom-kit-the-book', 'zoom-kit'], ['03e-zoom-board', 'zoom-board'], ['03f-zoom-tuner', 'zoom-tuner'], ['03g-the-tape', 'tape'],
  ['04a-shop-amp-wall', 'shop-wall'], ['04b-shop-looking-at-an-amp', 'shop-look-amp'], ['04c-shop-pedal-case', 'shop-case'], ['04d-shop-looking-at-a-pedal', 'shop-look-pedal'], ['04e-shop-case-modulation', 'shop-case-mod'], ['04f-shop-carried-in', 'shop-after'], ['04g-shop-try-out-amp', 'shop-tryout'], ['04h-shop-try-out-cab', 'shop-tryout-cab'],
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
    await page.mouse.move(2, 2);
    await page.evaluate((x) => window.mock.go(x), id);
    await page.waitForTimeout(id.startsWith('shop') ? 2100 : 1400);
    await page.screenshot({ path: path.join(OUT, name + suf + '.png') });
    console.log('shot', name + suf);
  }
  if (errors.length) { bad++; console.log(errors.join('\n')); }
  await close();
}
process.exit(bad ? 1 : 0);

