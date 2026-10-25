import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {resolveItems} from '../src/scene.js';

async function workspace(t) {
  const root = path.resolve('output/test');
  await mkdir(root, {recursive: true});
  const directory = await mkdtemp(path.join(root, 'spatial-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

function run(project, ...args) {
  return JSON.parse(execFileSync(process.execPath,
      ['bin/oheya-kae.js', '--project', project, ...args],
      {encoding: 'utf8'}));
}

test('room scaling reports independent objects excluded from calibration',
    async (t) => {
      const file = path.join(await workspace(t), 'scope.json');
      run(file, 'room', 'create', '--width', '4000', '--depth', '5000');
      run(file, 'furniture', 'add', '--id', 'desk', '--width', '500',
          '--depth', '500', '--height', '700', '--x', '1000', '--z', '1000');
      run(file, 'object', 'add', '--id', 'box', '--width', '100',
          '--depth', '100', '--height', '100', '--x', '3000', '--z', '3000');
      const result = run(file, 'room', 'scale', '--wall', '0', '--length',
          '8000', '--include-furniture');
      assert.equal(result.warnings[0].code, 'UNSCALED_ITEMS');
      assert.deepEqual(result.warnings[0].objectIds, ['box']);
      const state = run(file, 'state').project;
      assert.equal(state.furniture[0].x, 2000);
      assert.equal(state.objects[0].x, 3000);
      assert.equal(state.objects[0].width, 100);
      const roomOnly = run(file, 'room', 'scale', '--wall', '0',
          '--length', '4000');
      assert.deepEqual(roomOnly.warnings[0].objectIds, ['desk', 'box']);
    });

test('room scaling selects hierarchies and wall objects explicitly',
    async (t) => {
      const file = path.join(await workspace(t), 'attached.json');
      run(file, 'layout', 'load', '--input', 'test/fixtures/spatial-room.json');
      const before = run(file, 'state').project.objects;
      const result = run(file, 'room', 'scale', '--wall', '0',
          '--length', '8000');
      assert.deepEqual(result.warnings[0].objectIds,
          ['shelf', 'stand', 'desk', ...before.map((item) => item.id)]);
      assert.deepEqual(run(file, 'state').project.objects, before);
      const scaled = run(file, 'room', 'scale', '--wall', '0', '--length',
          '4000', '--include-furniture');
      assert.deepEqual(scaled.warnings[0].objectIds, ['clock']);
      const state = run(file, 'state').project;
      assert.equal(state.objects.find((item) => item.id === 'books').width,
          250);
      assert.equal(state.objects.find((item) => item.id === 'books').y, 100);
      assert.equal(state.furniture[0].supports[0].thickness, 20);
      assert.equal(state.furniture[0].supports[0].width, 600);
      const all = run(file, 'room', 'scale', '--wall', '0', '--length',
          '8000', '--include-furniture', '--include-objects');
      assert.deepEqual(all.warnings, []);
      const clock = run(file, 'state').project.objects
          .find((item) => item.id === 'clock');
      assert.equal(clock.x, 7960);
      assert.equal(clock.y, 1500);
      assert.equal(clock.width, 600);
      const saved = await readFile(file, 'utf8');
      const refused = spawnSync(process.execPath,
          ['bin/oheya-kae.js', '--project', file, 'furniture', 'scale',
            '--id', 'shelf', '--dimension', 'width', '--length', '1'],
          {encoding: 'utf8'});
      assert.equal(refused.status, 1);
      assert.equal(await readFile(file, 'utf8'), saved);
    });

test('CLI deletes sole image owners while retaining pending source candidates',
    async (t) => {
      const directory = await workspace(t);
      const data = JSON.parse(await readFile(
          'test/fixtures/detailed-analysis.json', 'utf8'));
      const imageFile = path.join(directory, 'single.png');
      const imageBytes = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0' +
          'lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=', 'base64');
      await writeFile(imageFile, imageBytes);
      for (const kind of ['furniture', 'object']) {
        for (const withRoom of [false, true]) {
          const file = path.join(directory, `${kind}-${withRoom}.json`);
          if (withRoom) {
            run(file, 'room', 'create', '--width', '2000', '--depth', '2000');
          }
          const analysisFile = path.join(directory, `${kind}-analysis.json`);
          await writeFile(analysisFile, JSON.stringify({
            [kind]: {id: 'single'}, analysis: {
              sources: data.analysis.sources, regions: [],
              detections: [{...data.analysis.detections[7],
                id: 'single-detection', targetId: 'single'}],
            },
          }));
          run(file, kind, 'import', '--image', imageFile,
              '--analysis', analysisFile);
          run(file, kind, 'remove', '--id', 'single');
          const saved = run(file, 'state').project;
          assert.equal(saved.analysis.idMap['single-detection'], null);
          assert.equal(saved.analysis.images.length, 1);
          assert.equal(saved.analysis.detections[0].decision, 'pending');
          const htmlFile = path.join(directory, `${kind}-${withRoom}.html`);
          run(file, 'export', '--output', htmlFile);
          assert.ok((await readFile(htmlFile, 'utf8'))
              .includes(imageBytes.toString('base64')));
        }
      }
    });

test('CLI saves objects, follows parents and refuses orphaning or bad imports',
    async (t) => {
      const directory = await workspace(t);
      const file = path.join(directory, 'scene.json');
      run(file, 'layout', 'load', '--input', 'test/fixtures/spatial-room.json');
      run(file, 'object', 'add', '--id', 'cup', '--category', 'cup',
          '--width', '50', '--depth', '50', '--height', '80',
          '--parent-id', 'desk', '--attachment', 'on', '--y', '730',
          '--x', '100', '--z', '100', '--rotation', '0');
      run(file, 'furniture', 'move', '--id', 'desk', '--x', '2800',
          '--z', '2000', '--rotation', '90');
      const state = run(file, 'state').project;
      const cup = resolveItems(state).find((item) => item.id === 'cup');
      assert.equal(cup.x, 2900);
      assert.equal(cup.z, 1900);
      assert.equal(cup.y, 730);
      assert.equal(state.objects.find((item) => item.id === 'cup').x, 100);
      run(file, 'furniture', 'scale', '--id', 'desk', '--dimension',
          'width', '--length', '2800');
      const scaledCup = run(file, 'state').project.objects
          .find((item) => item.id === 'cup');
      assert.equal(scaledCup.x, 200);
      assert.equal(scaledCup.y, 1460);
      assert.equal(scaledCup.width, 100);
      const before = await readFile(file, 'utf8');
      const removed = spawnSync(process.execPath,
          ['bin/oheya-kae.js', '--project', file,
            'furniture', 'remove', '--id', 'desk'], {encoding: 'utf8'});
      assert.equal(removed.status, 1);
      assert.equal(await readFile(file, 'utf8'), before);
      const wrong = path.join(directory, 'wrong.json');
      await writeFile(wrong, JSON.stringify({room: {}, objects: {}}));
      const image = path.join(directory, 'image.png');
      await writeFile(image, Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0' +
          'lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=', 'base64'));
      const imported = spawnSync(process.execPath,
          ['bin/oheya-kae.js', '--project', file, 'room', 'import',
            '--replace', '--image', image, '--analysis', wrong],
          {encoding: 'utf8'});
      assert.equal(imported.status, 1);
      assert.equal(await readFile(file, 'utf8'), before);
      run(file, 'object', 'remove', '--id', 'cup');
      assert.equal(run(file, 'state').project.objects.length, 5);
    });

test('room import retains stable object references with estimated provenance',
    async (t) => {
      const directory = await workspace(t);
      const fixture = JSON.parse(await readFile(
          'test/fixtures/spatial-room.json', 'utf8'));
      const analysis = path.join(directory, 'analysis.json');
      await writeFile(analysis, JSON.stringify({room: fixture.room,
        furniture: fixture.furniture, objects: fixture.objects}));
      const image = path.join(directory, 'source.jpg');
      await writeFile(image, Buffer.from([255, 216, 255, 1]));
      const file = path.join(directory, 'imported.json');
      run(file, 'room', 'import', '--image', image, '--analysis', analysis);
      const state = run(file, 'state');
      assert.equal(state.project.objects.length, 5);
      assert.equal(state.project.objects[0].parentId, 'shelf');
      assert.equal(state.project.objects[0].evidence.y.status, 'estimated');
      assert.equal(state.validation.geometryValid, true);
      run(file, 'layout', 'save', '--output',
          path.join(directory, 'copy.json'));
      assert.deepEqual(JSON.parse(await readFile(
          path.join(directory, 'copy.json'), 'utf8')), state.project);
      assert.ok(run(file, 'schema', '--kind', 'room')
          .schema.properties.objects);
      assert.ok(run(file, 'schema', '--kind', 'object')
          .schema.properties.object.properties.parentId);
    });

test('CLI keeps estimated revisions, unknowns and explicit confirmations',
    async (t) => {
      const directory = await workspace(t);
      const file = path.join(directory, 'revisions.json');
      run(file, 'layout', 'load', '--input', 'test/fixtures/spatial-room.json');
      run(file, 'object', 'add', '--id', 'unknown');
      let item = run(file, 'object', 'update', '--id', 'unknown',
          '--width', '200', '--status', 'estimated',
          '--note', '画像の比率による仮値').object;
      assert.equal(item.evidence.width.status, 'estimated');
      assert.equal(item.evidence.width.history[0].value, null);
      assert.equal(item.evidence.width.history[0].status, 'unknown');
      item = run(file, 'object', 'update', '--id', 'unknown',
          '--width', '250', '--status', 'confirmed', '--note', '実測').object;
      assert.equal(item.evidence.width.status, 'confirmed');
      assert.equal(item.evidence.width.history.at(-1).value, 200);
      assert.match(item.evidence.width.history.at(-1).note, /仮値/);
      const moved = run(file, 'furniture', 'move', '--id', 'shelf',
          '--x', '1500', '--status', 'estimated', '--note', '配置案').furniture;
      assert.equal(moved.evidence.x.status, 'estimated');
      assert.equal(moved.evidence.x.history.at(-1).value, 900);
      const room = run(file, 'room', 'update', '--height', '2500',
          '--status', 'estimated', '--note', '暫定').room;
      assert.equal(room.evidence.height.status, 'estimated');
      const before = await readFile(file, 'utf8');
      for (const args of [
        ['object', 'update', '--id', 'unknown', '--width', '300',
          '--status', 'estimated'],
        ['object', 'update', '--id', 'unknown', '--width', '300',
          '--status', 'estimated', '--note', '仮', '--confirm', 'width'],
        ['furniture', 'move', '--id', 'shelf', '--x', '2000',
          '--status', 'invalid', '--note', '仮'],
      ]) {
        const result = spawnSync(process.execPath,
            ['bin/oheya-kae.js', '--project', file, ...args],
            {encoding: 'utf8'});
        assert.equal(result.status, 1);
        assert.equal(await readFile(file, 'utf8'), before);
      }
      assert.equal(run(file, 'state').project.objects.at(-1)
          .evidence.width.history.length, 2);
    });

test('CLI merges detection imports and preserves files on invalid metadata',
    async (t) => {
      const directory = await workspace(t);
      const file = path.join(directory, 'detections.json');
      const image = path.join(directory, 'source.png');
      await writeFile(image, Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0' +
          'lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=', 'base64'));
      const source = 'test/fixtures/detailed-analysis.json';
      run(file, 'room', 'import', '--image', image, '--analysis', source);
      run(file, 'furniture', 'update', '--id', 'shelf', '--width', '1300');
      run(file, 'room', 'import', '--merge', '--image', image,
          '--analysis', source);
      const state = run(file, 'state').project;
      assert.equal(state.analysis.detections.length, 23);
      assert.equal(state.furniture.length, 4);
      assert.equal(state.objects.length, 6);
      assert.equal(state.furniture[0].width, 1300);
      const before = await readFile(file, 'utf8');
      const invalid = JSON.parse(await readFile(source, 'utf8'));
      invalid.analysis.sources[0].sha256 = '0'.repeat(64);
      const bad = path.join(directory, 'bad.json');
      await writeFile(bad, JSON.stringify(invalid));
      const result = spawnSync(process.execPath,
          ['bin/oheya-kae.js', '--project', file, 'room', 'import', '--merge',
            '--image', image, '--analysis', bad], {encoding: 'utf8'});
      assert.equal(result.status, 1);
      assert.equal(await readFile(file, 'utf8'), before);
      const nativeReport = path.join(directory, 'detection-report.json');
      await writeFile(nativeReport, JSON.stringify({
        model: 'external-detector', sha256: invalid.analysis.sources[0].sha256,
        targets: [{
          id: 'detected-shelf', name: '棚', role: 'furniture', kind: 'shelf',
          included: true, presence: 0.9, box_confidence: 0.8,
          box: {left: 0.1, top: 0.1, right: 0.4, bottom: 0.8},
        }],
      }));
      // Correct the intentionally invalid hash used in the failure above.
      const report = JSON.parse(await readFile(nativeReport, 'utf8'));
      report.sha256 = state.analysis.sources[0].sha256;
      await writeFile(nativeReport, JSON.stringify(report));
      const nativeFile = path.join(directory, 'detected-project.json');
      run(nativeFile, 'room', 'import', '--image', image,
          '--detections', nativeReport);
      const native = run(nativeFile, 'state').project;
      assert.equal(native.furniture[0].id, 'detected-shelf');
      assert.equal(native.furniture[0].width, null);
      assert.equal(native.analysis.idMap['detected-shelf'], 'detected-shelf');
      assert.equal(native.room.name, '画像解析の部屋');
      assert.equal(native.analysis.sourceReport.model, 'external-detector');
      assert.equal(Object.hasOwn(native.analysis, 'jevReport'), false);
    });
