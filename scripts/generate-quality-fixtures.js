import {chromium} from 'playwright';
import {readFile, writeFile} from 'node:fs/promises';

const root = 'test/fixtures/';
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  const page = await browser.newPage({viewport: {width: 800, height: 600}});
  await page.setContent('<body style="margin:0">' +
      await readFile(`${root}quality-room.svg`, 'utf8'));
  await page.screenshot({path: `${root}quality-room.png`});
  await page.setContent('<body style="margin:0;background:#faf8f3">');
  await page.screenshot({path: `${root}quality-empty.png`});
} finally {
  await browser.close();
}
const box = (x, y, width, height) =>
  [x / 800, y / 600, width / 800, height / 600];
await writeFile(`${root}quality-labels.json`, JSON.stringify({
  images: ['quality-room', 'quality-empty'],
  labels: [
    ['shelf', 'shelf', box(80, 160, 260, 380)],
    ['books', 'books', box(100, 420, 150, 95)],
    ['oven', 'appliance', box(120, 240, 170, 110)],
    ['rack', 'clothes_rack', box(430, 200, 250, 190)],
    ['clock-left', 'clock', box(440, 30, 80, 80)],
    ['clock-edge', 'clock', box(740, 30, 60, 100)],
  ].map(([id, category, box]) =>
    ({id, category, box, imageId: 'quality-room'})),
}, null, 2) + '\n');
