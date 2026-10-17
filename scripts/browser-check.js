import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {load} from '../src/store.js';
import {exportHTML} from '../src/export.js';

// Google Chrome is the only supported browser on every platform.
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const context = await browser.newContext({
    viewport: {width: 1440, height: 980},
    offline: true,
  });
  const page = await context.newPage();
  const errors = [];
  const network = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) {
      network.push(r.url());
    }
  });
  await page.goto(
      pathToFileURL(path.resolve('output/demo.html')).href,
  );
  await page.waitForFunction(
      () => window.oheyaKaeViewer?.meshCount === 4,
  );
  assert.equal(
      await page.evaluate(() => window.oheyaKaeViewer.colors.desk),
      'b99069',
  );
  assert.equal(await page.title(), 'oheya-kae — Layout Studio');
  await page
      .getByRole('button', {name: 'ワークデスク', exact: false})
      .click();
  assert.equal(
      await page.evaluate(() => window.oheyaKaeViewer.selected),
      'desk',
  );
  assert.ok(
      (await page.locator('#detail').textContent()).includes('730'),
  );
  await page
      .getByRole('button', {name: '間取り', exact: true})
      .click();
  assert.equal(
      await page.evaluate(() => window.oheyaKaeViewer.mode),
      'top',
  );
  // Measure the projected distance between opposite wall labels, not just the
  // camera position.
  const wallSpan = () =>
    page
        .locator('#labels .dimension')
        .evaluateAll((es) =>
          Math.abs(
              parseFloat(es[1].style.left) -
              parseFloat(es[3].style.left),
          ),
        );
  await page.waitForFunction(
      () =>
        document.querySelectorAll('#labels .dimension')[1]?.style
            .left,
  );
  await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
  );
  const initialSpan = await wallSpan();
  const viewport = await page.locator('canvas').boundingBox();
  await page.mouse.move(
      viewport.x + viewport.width / 2,
      viewport.y + viewport.height / 2,
  );
  await page.mouse.wheel(0, -500);
  await page.waitForFunction((initial) => {
    const es = document.querySelectorAll('#labels .dimension');
    return (
      Math.abs(
          parseFloat(es[1].style.left) - parseFloat(es[3].style.left),
      ) >
      initial * 1.1
    );
  }, initialSpan);
  await page
      .getByRole('button', {name: '視点を戻す', exact: true})
      .click();
  await page.waitForFunction((initial) => {
    const es = document.querySelectorAll('#labels .dimension');
    return (
      Math.abs(
          Math.abs(
              parseFloat(es[1].style.left) -
              parseFloat(es[3].style.left),
          ) - initial,
      ) < 0.1
    );
  }, initialSpan);
  await page
      .getByRole('button', {name: '3Dビュー', exact: true})
      .click();
  const before = await page.evaluate(
      () => window.oheyaKaeViewer.cameraPosition,
  );
  const options = await page
      .locator('#proposal option')
      .evaluateAll((os) => os.map((o) => o.value));
  for (const v of options.slice(1)) {
    await page.locator('#proposal').selectOption(v);
    assert.deepEqual(
        await page.evaluate(
            () => window.oheyaKaeViewer.cameraPosition,
        ),
        before,
    );
    assert.equal(
        await page.evaluate(() => window.oheyaKaeViewer.meshCount),
        4,
    );
  }
  await page.locator('#proposal').selectOption('current');
  await page
      .getByRole('button', {name: '寸法', exact: true})
      .click();
  assert.equal(
      await page.locator('#dimensions').getAttribute('aria-pressed'),
      'false',
  );
  await page
      .getByRole('button', {name: '寸法', exact: true})
      .click();
  const canvas = page.locator('canvas');
  const rect = await canvas.boundingBox();
  const cameraBefore = await page.evaluate(
      () => window.oheyaKaeViewer.cameraPosition,
  );
  await page.mouse.move(
      rect.x + rect.width * 0.6,
      rect.y + rect.height * 0.55,
  );
  await page.mouse.down();
  await page.mouse.move(
      rect.x + rect.width * 0.7,
      rect.y + rect.height * 0.6,
      {steps: 10},
  );
  await page.mouse.up();
  assert.notDeepEqual(
      await page.evaluate(() => window.oheyaKaeViewer.cameraPosition),
      cameraBefore,
  );
  await page
      .getByRole('button', {name: '視点を戻す', exact: true})
      .click();
  await page.screenshot({path: 'output/demo.png', fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  await page
      .getByRole('button', {name: '間取り', exact: true})
      .click();
  await page.screenshot({
    path: 'output/demo-mobile.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  assert.equal(await page.locator('#status').textContent(), '');
  const withImages = await load('output/demo.json');
  withImages.room.images = [
    {
      name: '元画像.png',
      data:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEA' +
        'AAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAA' +
        'AASUVORK5CYII=',
    },
  ];
  withImages.room.name =
    'Room $& $\' $` $$ /*OHEYA_KAE_SCRIPT*/ ' +
    '/*OHEYA_KAE_DATA*/ </script>';
  await exportHTML(withImages, 'output/browser-images.html');
  await page.goto(
      pathToFileURL(path.resolve('output/browser-images.html')).href,
  );
  await page.waitForFunction(
      () =>
        document.querySelector('#sources img')?.naturalWidth === 1,
  );
  await page.waitForFunction(
      () => window.oheyaKaeViewer?.meshCount === 4,
  );
  assert.equal(
      await page.locator('#room-name').textContent(),
      withImages.room.name,
  );
  assert.deepEqual(network, []);
  assert.deepEqual(errors, []);
  console.log(
      'Browser checks passed: file://, offline, 3D, ' +
      'selection, orbit, top view, dimensions, proposal ' +
      'comparison, mobile.',
  );
} finally {
  await browser.close();
}
