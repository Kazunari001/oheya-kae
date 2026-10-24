import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {load} from '../src/store.js';
import {normalizeProject} from '../src/model.js';
import {exportHTML} from '../src/export.js';
import * as THREE from 'three';

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
  const objectLabels = page.locator('#labels .furniture:visible');
  const dimensionLabels = page.locator(
      '#labels .dimension:not(.furniture):visible',
  );
  await page.getByRole('button', {name: '名称', exact: true}).click();
  assert.equal(
      await page.locator('#names').getAttribute('aria-pressed'), 'false',
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#labels .furniture')]
        .every((label) => label.style.display === 'none'),
  );
  assert.ok(await dimensionLabels.count() > 0);
  await page.getByRole('button', {name: '間取り', exact: true}).click();
  await page.locator('#proposal').selectOption(options[1]);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#labels .furniture')]
        .every((label) => label.style.display === 'none'),
  );
  assert.equal(await objectLabels.count(), 0);
  await page.locator('#proposal').selectOption('current');
  await page.getByRole('button', {name: '3Dビュー', exact: true}).click();
  await page
      .getByRole('button', {name: '寸法', exact: true})
      .click();
  assert.equal(
      await page.locator('#dimensions').getAttribute('aria-pressed'),
      'false',
  );
  await page.getByRole('button', {name: '名称', exact: true}).click();
  assert.equal(
      await page.locator('#names').getAttribute('aria-pressed'), 'true',
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#labels .furniture')]
        .some((label) => label.style.display === 'block'),
  );
  assert.equal(await dimensionLabels.count(), 0);
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
    '/*OHEYA_KAE_DATA*/ </ScRiPt ignored>' +
    '<SCRIPT>window.sourceInjection = true</SCRIPT>';
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
  assert.equal(await page.locator('script').count(), 2);
  const viewerScript = await page.locator('script').nth(1).textContent();
  assert.ok(viewerScript.includes('WebGLRenderer'));
  assert.ok(!viewerScript.includes('/*OHEYA_KAE_SCRIPT*/'));
  assert.equal(await page.evaluate(() => window.sourceInjection), undefined);
  assert.deepEqual(network, []);
  assert.deepEqual(errors, []);
  const spatial = normalizeProject(JSON.parse(await readFile(
      'test/fixtures/spatial-room.json', 'utf8',
  )));
  const imageProject = structuredClone(spatial);
  const validImages = [
    withImages.room.images[0],
    ...await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      return ['jpeg', 'webp'].map((type) => ({
        name: `<img src=x onerror="window.sourceInjection=true">.${type}`,
        data: canvas.toDataURL(`image/${type}`),
      }));
    }),
  ];
  const unsafeUrls = [
    'javascript:window.sourceInjection=true',
    'JaVaScRiPt:window.sourceInjection=true',
    '\tjava\nscript:window.sourceInjection=true',
    'data:text/html,<script>window.sourceInjection=true</script>',
    'data:image/svg+xml,<svg onload="window.sourceInjection=true"/>',
    'https://example.invalid/source.png',
    '//example.invalid/source.png',
    'file:///invalid-source.png',
    'data:image/png;base64,AAAA" onerror="window.sourceInjection=true',
    null,
    {url: validImages[0].data},
  ];
  const imageOwners = [
    imageProject.room,
    imageProject.furniture[0],
    imageProject.objects[0],
  ];
  for (const [index, owner] of imageOwners.entries()) {
    owner.images = [validImages[index], validImages[index]];
  }
  for (const [index, data] of unsafeUrls.entries()) {
    imageOwners[index % imageOwners.length].images.push({
      name: `unsafe-${index}`,
      data,
    });
  }
  // Exercise the viewer's own boundary with an unnormalized exported payload.
  await exportHTML(imageProject, 'output/browser-source-safety.html');
  await page.goto(pathToFileURL(
      path.resolve('output/browser-source-safety.html'),
  ).href);
  assert.equal(await page.locator('#sources a').count(), 3);
  assert.equal(await page.locator('#sources img').count(), 3);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#sources img')].every(
        (img) => img.naturalWidth === 1,
    ),
  );
  for (const [index, source] of validImages.entries()) {
    const link = page.locator('#sources a').nth(index);
    assert.equal(await link.getAttribute('href'), source.data);
    assert.equal(await link.getAttribute('download'), source.name);
    assert.equal(await link.textContent(), source.name);
    assert.equal(await link.locator('img').getAttribute('alt'), source.name);
  }
  for (const index of unsafeUrls.keys()) {
    assert.ok((await page.locator('#sources').textContent()).includes(
        `unsafe-${index}`,
    ));
  }
  assert.equal(await page.evaluate(() => window.sourceInjection), undefined);
  assert.deepEqual(network, []);
  assert.deepEqual(errors, []);
  spatial.objects.find((item) => item.id === 'books').x = 100;
  await exportHTML(spatial, 'output/spatial-demo.html');
  await page.setViewportSize({width: 1440, height: 980});
  const spatialUrl = (name) =>
    pathToFileURL(path.resolve(`output/${name}`)).href;
  await page.goto(spatialUrl('spatial-demo.html'));
  await page.waitForFunction(() => window.oheyaKaeViewer?.meshCount === 8);
  let positions = await page.evaluate(
      () => window.oheyaKaeViewer.worldPositions,
  );
  assert.equal(positions.books.y, 100);
  assert.equal(positions.oven.y, 900);
  assert.equal(positions.tv.y, 400);
  assert.equal(positions.clock.y, 1500);
  await page.getByRole('button', {name: '下段の本', exact: false}).click();
  assert.match(await page.locator('#detail').innerText(), /支持関係: shelf/);
  // Project known fixture points using the reset perspective camera, then use
  // real pointer events so this covers picking rather than sidebar selection.
  const clickSpatialPoint = async (point, expectedId) => {
    const bounds = await page.locator('canvas').boundingBox();
    const camera = new THREE.PerspectiveCamera(
        42, bounds.width / bounds.height, 0.01, 500,
    );
    camera.position.fromArray(await page.evaluate(
        () => window.oheyaKaeViewer.cameraPosition,
    ));
    camera.lookAt(2, 0, 2.5);
    camera.updateMatrixWorld(true);
    const projected = new THREE.Vector3(...point).project(camera);
    await page.mouse.click(
        bounds.x + (projected.x + 1) * bounds.width / 2,
        bounds.y + (1 - projected.y) * bounds.height / 2,
    );
    assert.equal(
        await page.evaluate(() => window.oheyaKaeViewer.selected),
        expectedId,
    );
  };
  await clickSpatialPoint([0.9, 0.25, 0.9], 'books');
  await clickSpatialPoint([0.9, 1.1, 1], 'oven');
  await clickSpatialPoint([1.1, 0.89, 1.4], 'shelf');
  await clickSpatialPoint([1.14, 0.6, 1.59], 'shelf');
  await clickSpatialPoint([0.9, 0.6, 1], null);
  await page.screenshot({path: 'output/spatial-demo.png', fullPage: true});
  const shelf = spatial.furniture.find((item) => item.id === 'shelf');
  Object.assign(shelf, {x: 1400, z: 1500, rotation: 180});
  await exportHTML(spatial, 'output/spatial-moved.html');
  await page.goto(spatialUrl('spatial-moved.html'));
  await page.waitForFunction(() => window.oheyaKaeViewer?.meshCount === 8);
  positions = await page.evaluate(() => window.oheyaKaeViewer.worldPositions);
  assert.equal(positions.books.x, 1300);
  assert.equal(positions.books.z, 1500);
  assert.equal(positions.books.rotation, 180);
  assert.equal(positions.books.y, 100);
  shelf.y = null;
  await exportHTML(spatial, 'output/spatial-unknown.html');
  await page.goto(spatialUrl('spatial-unknown.html'));
  await page.waitForFunction(() => window.oheyaKaeViewer?.meshCount === 5);
  assert.deepEqual(network, []);
  assert.deepEqual(errors, []);
  console.log(
      'Browser checks passed: file://, offline, 3D, ' +
      'selection, orbit, top view, names, dimensions, proposal ' +
      'comparison, mobile, support surfaces, elevated objects, parent moves.',
  );
} finally {
  await browser.close();
}
