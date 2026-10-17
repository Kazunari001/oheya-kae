import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {readImages, analysisSchema, analysisPrompt} from '../src/analysis.js';

async function temp(t) {
  const root = path.resolve('output/test');
  await mkdir(root, {recursive: true});
  const dir = await mkdtemp(path.join(root, 'images-'));
  t.after(() => {
    assert.ok(path.resolve(dir).startsWith(root + path.sep));
    return rm(dir, {recursive: true, force: true});
  });
  return dir;
}

test(
    'caller analysis contracts describe room and ' +
    'furniture with unknown values and evidence',
    () => {
      const room = analysisSchema('room');
      const furniture = analysisSchema('furniture');
      assert.ok(
          room.properties.room.properties.outline.type.includes('null'),
      );
      assert.equal(room.properties.furniture.type, 'array');
      assert.equal(room.properties.objects.type, 'array');
      assert.equal(room.properties.objects.items.properties.y.type
          .includes('null'), true);
      assert.ok(room.properties.furniture.items.properties.supports);
      for (const schema of [
        room.properties.furniture.items,
        furniture.properties.furniture,
      ]) {
        for (const key of [
          'width',
          'depth',
          'height',
          'x',
          'z',
          'rotation',
        ]) {
          assert.ok(schema.properties[key].type.includes('null'));
        }
        assert.deepEqual(
            schema.properties.evidence.properties.width.properties
                .status.enum,
            ['estimated', 'image', 'unknown'],
        );
      }
      assert.match(analysisPrompt('room'), /single room/);
      assert.match(analysisPrompt('furniture'), /furniture item/);
      assert.match(analysisPrompt('room'), /millimeters/);
    },
);

test(
    'local image loading preserves each source without ' +
    'network access',
    async (t) => {
      const fetch = t.mock.method(globalThis, 'fetch', () => {
        throw Error('Unexpected network access');
      });
      const dir = await temp(t);
      const files = ['front.png', 'side.png'].map((name) =>
        path.join(dir, name),
      );
      const data = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0' +
          'lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=',
          'base64',
      );
      await Promise.all(files.map((file) => writeFile(file, data)));
      const images = await readImages(files);
      assert.deepEqual(
          images.map((i) => i.name),
          ['front.png', 'side.png'],
      );
      assert.ok(
          images.every(
              (i) =>
                i.data ===
                `data:image/png;base64,${data.toString('base64')}`,
          ),
      );
      assert.equal(fetch.mock.callCount(), 0);
    },
);

test(
    'local image loading rejects invalid inputs and ' +
    'oversized files',
    async (t) => {
      const dir = await temp(t);
      const bad = path.join(dir, 'bad.png');
      const large = path.join(dir, 'large.png');
      await writeFile(bad, 'not an image');
      await writeFile(large, Buffer.alloc(10 * 1024 * 1024 + 1));
      for (const files of [[], Array(13).fill(bad), [bad], [large]]) {
        await assert.rejects(() => readImages(files), {
          code: 'INVALID_DATA',
        });
      }
      await assert.rejects(
          () => readImages([path.join(dir, 'missing.png')]),
          {code: 'IMAGE_READ_FAILED'},
      );
    },
);
