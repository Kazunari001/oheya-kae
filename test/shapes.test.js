import test from 'node:test';
import assert from 'node:assert/strict';
import {KINDS, normalizeFurniture} from '../src/model.js';
import {solidParts} from '../src/scene.js';

test('simple shapes share occupied parts and retain the legacy kinds', () => {
  assert.equal(KINDS.length, 14);
  for (const kind of KINDS) {
    const item = normalizeFurniture({kind, width: 900, depth: 500,
      height: 1600, x: 0, z: 0, y: 0, rotation: 0});
    const parts = solidParts(item);
    assert.ok(parts.length > 0);
    for (const part of parts) {
      assert.ok(part.width > 0 && part.height > 0 && part.depth > 0);
      assert.ok(part.y >= 0 && part.y + part.height <= item.height);
    }
    if (kind === 'clothes_rack' || kind === 'books') {
      assert.equal(parts.length, 5);
    }
    if (kind === 'screen' || kind === 'lamp') {
      assert.equal(parts.length, 3);
    }
  }
});
