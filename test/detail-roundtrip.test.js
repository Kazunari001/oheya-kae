import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';

function run(file, ...args) {
  const result = spawnSync(process.execPath,
      ['bin/oheya-kae.js', '--project', file, ...args], {encoding: 'utf8'});
  return {status: result.status,
    data: JSON.parse(result.stdout || result.stderr)};
}

test('detailed import revisions survive merge, rollback, save and HTML export',
    async (t) => {
      const root = path.resolve('output/test');
      await mkdir(root, {recursive: true});
      const directory = await mkdtemp(path.join(root, 'detail-roundtrip-'));
      t.after(() => rm(directory, {recursive: true, force: true}));
      const file = path.join(directory, 'room.json');
      const image = path.join(directory, 'synthetic.png');
      const analysisFile = path.resolve('test/fixtures/detailed-analysis.json');
      await writeFile(image, Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1' +
          'HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=', 'base64'));
      assert.equal(run(file, 'room', 'import', '--image', image,
          '--analysis', analysisFile).status, 0);
      const imported = run(file, 'state').data.project;
      assert.equal(imported.analysis.detections.length, 23);
      assert.equal(run(file, 'furniture', 'update', '--id', 'shelf',
          '--width', '1240', '--status', 'confirmed').status, 0);
      assert.equal(run(file, 'room', 'import', '--merge', '--image', image,
          '--analysis', analysisFile).status, 0);
      const revised = run(file, 'state').data.project;
      assert.equal(revised.furniture.find((item) => item.id === 'shelf')
          .width, 1240);
      assert.equal(revised.objects.find((item) => item.id === 'books')
          .parentId, 'shelf');
      const before = await readFile(file, 'utf8');
      assert.equal(run(file, 'furniture', 'remove', '--id', 'shelf').status, 1);
      assert.equal(await readFile(file, 'utf8'), before);
      const broken = path.join(directory, 'broken.json');
      const bad = JSON.parse(await readFile(analysisFile, 'utf8'));
      bad.objects[0].parentId = 'missing';
      await writeFile(broken, JSON.stringify(bad));
      assert.equal(run(file, 'room', 'import', '--merge', '--image', image,
          '--analysis', broken).status, 1);
      assert.equal(await readFile(file, 'utf8'), before);
      const saved = path.join(directory, 'saved.json');
      assert.equal(run(file, 'layout', 'save', '--output', saved).status, 0);
      assert.equal(run(file, 'layout', 'load', '--input', saved).status, 0);
      assert.deepEqual(run(file, 'state').data.project, revised);
      const htmlFile = path.join(directory, 'room.html');
      assert.equal(run(file, 'export', '--output', htmlFile).status, 0);
      const html = await readFile(htmlFile, 'utf8');
      const pattern =
        /<script id="oheya-kae-data" type="application\/json">(.*?)<\/script>/s;
      const payload = JSON.parse(html.match(pattern)[1]);
      assert.deepEqual(payload.project, revised);
      assert.deepEqual(payload.validation,
          run(file, 'layout', 'validate').data.validation);
    });
