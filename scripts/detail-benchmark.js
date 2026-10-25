import {chromium} from 'playwright';
import {readFile, stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {normalizeProject} from '../src/model.js';
import {exportHTML} from '../src/export.js';

const browser = await chromium.launch({channel: 'chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
try {
  const context = await browser.newContext({offline: true});
  const page = await context.newPage();
  const image = {name: 'shared.png', data: 'data:image/png;base64,' +
      (await readFile('test/fixtures/quality-room.png')).toString('base64')};
  for (const count of [10, 100, 500]) {
    const project = normalizeProject({version: 2, units: 'mm', room: {
      outline: [[0, 0], [20000, 0], [20000, 20000], [0, 20000]], height: 2400,
    }, furniture: Array.from({length: count}, (_, index) => ({
      id: `item-${index}`, width: 100, depth: 100, height: 100,
      x: 500 + index % 25 * 500, z: 500 + Math.floor(index / 25) * 500,
      images: [image],
    })), proposals: []});
    const file = path.resolve(`output/benchmark-${count}.html`);
    const started = performance.now();
    await exportHTML(project, file);
    const exportMs = performance.now() - started;
    const loadStarted = performance.now();
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction((expected) =>
      window.oheyaKaeViewer?.meshCount === expected, count);
    const html = await readFile(file, 'utf8');
    console.log(JSON.stringify({objects: count, exportMs,
      displayMs: performance.now() - loadStarted,
      htmlBytes: (await stat(file)).size, uniqueImages: 1,
      embeddedImageCopies: html.split(image.data).length - 1}));
  }
} finally {
  await browser.close();
}
