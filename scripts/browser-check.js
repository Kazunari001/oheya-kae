import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {load} from '../src/store.js';
import {normalizeProject, emptyProject} from '../src/model.js';
import {importAnalysis} from '../src/detections.js';
import {propose} from '../src/proposals.js';
import {resolveItems} from '../src/scene.js';
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
  await page.locator('#revision-details summary').click();
  assert.match(await page.locator('#revision-info').textContent(),
      /プロジェクト版: [a-f0-9]{64}/);
  assert.match(await page.locator('#revision-info').textContent(),
      /出力元: .*demo.json/);
  assert.equal(
      await page.locator('#revision-details .license-text').count(), 0);
  assert.equal(await page.locator('.license-text').count(), 1);
  const licenseText = await page.locator('#license-details .license-text')
      .textContent();
  assert.match(licenseText, /The above copyright notice/);
  await page.locator('#revision-details summary').click();
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
  assert.equal(await page.locator('#sources button').count(), 3);
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
    await page.locator('#sources button').nth(index).click();
    await page.waitForFunction(() =>
      document.querySelector('#inspection-image').naturalWidth === 1,
    );
    assert.equal(await page.locator('#inspection-image').getAttribute('src'),
        source.data);
    assert.equal(await page.locator('#inspection-image').getAttribute('alt'),
        source.name);
    await page.getByRole('button', {name: '閉じる', exact: true}).click();
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
  const detailed = emptyProject();
  importAnalysis(detailed, JSON.parse(await readFile(
      'test/fixtures/detailed-analysis.json', 'utf8',
  )), withImages.room.images, 'room');
  const normalized = normalizeProject(detailed);
  normalized.proposals = propose(normalized, {
    count: 1, step: 500, clearance: 0,
  });
  await exportHTML(normalized, 'output/detailed-demo.html');
  await page.goto(spatialUrl('detailed-demo.html'));
  await page.waitForFunction(() => window.oheyaKaeViewer?.meshCount === 9);
  assert.match(await page.locator('#object-counts').innerText(),
      /検出 23.*3D表示 9.*未配置 1.*画像のみ 12/);
  assert.match(await page.locator('#area').innerText(), /仮/);
  assert.match(await page.locator('#corrections').innerText(), /検出の曖昧さ/);
  await page.locator('.furniture-button[data-id="shelf"]').click();
  assert.match(await page.locator('#detail').innerText(), /内容物: 下段の本/);
  await page.locator('#sources button').click();
  await page.waitForFunction(() =>
    document.querySelector('#inspection-image').naturalWidth === 1,
  );
  assert.equal(await page.locator('#image-boxes button').count(), 23);
  const crop = page.getByRole('button', {name: '検出 shelf', exact: true});
  assert.equal(await crop.evaluate((node) => node.style.left), '13%');
  assert.equal(await crop.evaluate((node) => node.style.width), '24%');
  const clockBox = page.getByRole('button', {name: '検出 clock', exact: true});
  await clockBox.focus();
  await clockBox.press('Enter');
  assert.equal(await clockBox.evaluate((node) =>
    node === document.activeElement,
  ), true);
  assert.equal(await clockBox.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.oheyaKaeViewer.selected),
      'clock');
  assert.match(await page.locator('#image-selection').innerText(),
      /壁の時計.*意味上の種類/s);
  assert.equal(await page.locator('#image-selection dl').count(), 1);
  assert.match(await page.locator('#image-selection').innerText(),
      /confidenceは実寸/);
  await page.locator('#image-zoom').focus();
  await page.locator('#image-zoom').press('End');
  assert.equal(await page.locator('#image-stage').evaluate((node) =>
    node.style.width,
  ), '300%');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#image-dialog').isVisible(), false);
  assert.equal(await page.locator('.furniture-button[data-id="clock"]')
      .getAttribute('aria-pressed'), 'true');
  await page.locator('#object-filter').selectOption('objects');
  assert.equal(await page.locator('#furniture-list .furniture-button').count(),
      6);
  assert.equal(await page.evaluate(() => window.oheyaKaeViewer.meshCount), 5);
  await page.locator('.furniture-button[data-id="unlocated"]').click();
  assert.match(await page.locator('#detail').innerText(), /未配置/);
  await page.locator('#object-filter').selectOption('openings');
  await page.getByRole('button', {name: 'ドア door', exact: true}).click();
  assert.match(await page.locator('#detail').innerText(), /800 mm/);
  await page.locator('#object-filter').selectOption('candidates');
  await page.getByRole('button', {
    name: '画像上の候補 candidate-22 · excluded', exact: true,
  }).click();
  assert.match(await page.locator('#detail').innerText(), /excluded/);
  await page.locator('#object-filter').selectOption('all');
  await page.locator('#proposal').selectOption(normalized.proposals[0].id);
  positions = await page.evaluate(() => window.oheyaKaeViewer.worldPositions);
  const expected = resolveItems({...normalized, furniture:
    normalized.furniture.map((item) => ({...item,
      ...normalized.proposals[0].placements.find((entry) =>
        entry.id === item.id,
      ),
    })),
  });
  for (const id of ['books', 'oven', 'clock']) {
    const item = expected.find((entry) => entry.id === id);
    assert.ok(Math.abs(positions[id].x - item.x) < 1e-6);
    assert.ok(Math.abs(positions[id].y - item.y) < 1e-6);
    assert.ok(Math.abs(positions[id].z - item.z) < 1e-6);
  }
  await page.locator('#proposal').selectOption('current');
  await page.locator('.furniture-button[data-id="shelf"]').click();
  await page.screenshot({path: 'output/detailed-demo.png', fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  await page.locator('#sources button').click();
  await page.getByRole('button', {name: '検出 clock', exact: true}).click();
  const dialogBounds = await page.locator('#image-dialog').boundingBox();
  assert.ok(dialogBounds.width <= 390);
  await page.screenshot({
    path: 'output/detailed-mobile.png', fullPage: true,
  });
  await page.getByRole('button', {name: '閉じる', exact: true}).click();
  assert.ok(await page.locator('body').evaluate((node) =>
    node.scrollWidth <= window.innerWidth,
  ));
  assert.deepEqual(network, []);
  assert.deepEqual(errors, []);
  const aliases = structuredClone(normalized);
  aliases.analysis.sources.push({
    ...aliases.analysis.sources[0], id: 'photo-alias',
  });
  const clockDetection = aliases.analysis.detections.find((entry) =>
    entry.id === 'clock',
  );
  aliases.analysis.detections.push({
    ...clockDetection, id: 'clock-alias', imageId: 'photo-alias',
  });
  await exportHTML(normalizeProject(aliases), 'output/aliased-sources.html');
  await page.goto(spatialUrl('aliased-sources.html'));
  assert.equal(await page.locator('#sources a').count(), 1);
  await page.locator('#sources button').click();
  assert.equal(await page.locator('#image-boxes button').count(), 24);
  await page.getByRole('button', {name: '検出 clock-alias', exact: true}).click();
  assert.equal(await page.evaluate(() => window.oheyaKaeViewer.selected),
      'clock');
  await page.getByRole('button', {name: '閉じる', exact: true}).click();
  const archived = normalizeProject({
    ...normalized, room: null, furniture: [], objects: [], proposals: [],
    analysis: {...normalized.analysis, regions: [], detections: [{
      ...clockDetection, targetId: null, decision: 'pending',
    }]},
  });
  await exportHTML(archived, 'output/archived-source.html');
  await page.goto(spatialUrl('archived-source.html'));
  await page.locator('#sources button').click();
  await page.waitForFunction(() =>
    document.querySelector('#inspection-image').naturalWidth === 1,
  );
  assert.equal(await page.locator('#image-boxes button').count(), 1);
  await page.getByRole('button', {name: '検出 clock', exact: true}).click();
  assert.equal(await page.evaluate(() => window.oheyaKaeViewer.selected),
      'detection:clock');
  await page.getByRole('button', {name: '閉じる', exact: true}).click();
  assert.deepEqual(network, []);
  assert.deepEqual(errors, []);
  const shapeData = JSON.parse(await readFile(
      'test/fixtures/spatial-room.json', 'utf8',
  ));
  for (const [index, kind] of ['books', 'appliance', 'screen', 'clock',
    'screen'].entries()) {
    shapeData.objects[index].kind = kind;
  }
  shapeData.furniture.push({id: 'rack', kind: 'clothes_rack',
    width: 900, depth: 500, height: 1600, x: 3000, z: 3000});
  shapeData.objects.push({id: 'lamp', kind: 'lamp',
    width: 200, depth: 200, height: 1200, x: 3000, z: 3800});
  await exportHTML(normalizeProject(shapeData), 'output/shapes-demo.html');
  await page.goto(spatialUrl('shapes-demo.html'));
  await page.waitForFunction(() => window.oheyaKaeViewer?.meshCount === 10);
  console.log(
      'Browser checks passed: file://, offline, 3D, ' +
      'selection, orbit, top view, names, dimensions, proposal ' +
      'comparison, mobile, support surfaces, elevated objects, parent moves, ' +
      '23 detections, crop boxes, image selection, filters and keyboard.',
  );
} finally {
  await browser.close();
}
