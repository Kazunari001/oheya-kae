import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeProject, normalizeFurniture} from '../src/model.js';
import {scaleItems} from '../src/scaling.js';
import {resolveItems} from '../src/scene.js';

test('uniform calibration scales nested surfaces and preserves local evidence',
    async () => {
      const project = normalizeProject(JSON.parse(await readFile(
          'test/fixtures/spatial-room.json', 'utf8')));
      project.objects.push(normalizeFurniture({id: 'nested', parentId: 'books',
        attachment: 'part', x: 20, y: null, z: 30, width: 50, depth: 50}));
      const previous = structuredClone(project);
      scaleItems(project, ['shelf'], 2, false, false);
      const shelf = project.furniture[0];
      assert.equal(shelf.x, previous.furniture[0].x);
      assert.equal(shelf.frameThickness, 40);
      assert.equal(shelf.supports[1].y, 1800);
      assert.equal(shelf.supports[1].thickness, 40);
      assert.deepEqual(shelf.evidence.supports.history[0].value,
          previous.furniture[0].supports);
      const books = project.objects[0];
      assert.equal(books.parentId, 'shelf');
      assert.equal(books.surfaceId, 'lower');
      assert.equal(books.y, 200);
      assert.equal(books.evidence.y.history[0].value, 100);
      const nested = resolveItems(project).find((item) => item.id === 'nested');
      assert.equal(nested.local.x, 40);
      assert.equal(nested.y, null);
      assert.equal(nested.height, null);
      assert.doesNotThrow(() => normalizeProject(project));
    });
