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
      const before = await readFile(file, 'utf8');
      const scaled = spawnSync(process.execPath,
          ['bin/oheya-kae.js', '--project', file, 'furniture', 'scale',
            '--id', 'desk', '--dimension', 'width', '--length', '1600'],
          {encoding: 'utf8'});
      assert.equal(scaled.status, 1);
      assert.equal(await readFile(file, 'utf8'), before);
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
