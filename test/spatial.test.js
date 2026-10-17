import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeProject, normalizeFurniture, normalizeRoom} from '../src/model.js';
import {resolveItems} from '../src/scene.js';
import {validate, applyPlacements} from '../src/validation.js';

const fixture = JSON.parse(await readFile(
    new URL('./fixtures/spatial-room.json', import.meta.url), 'utf8',
));
const scene = () => normalizeProject(structuredClone(fixture));

test('version 1 migration preserves floor items and rejects future versions',
    () => {
      const old = {
        version: 1, units: 'mm', room: null, proposals: [],
        furniture: [{id: 'old', width: 100, depth: 100, height: 100}],
      };
      const migrated = normalizeProject(old);
      assert.equal(migrated.version, 2);
      assert.deepEqual(migrated.objects, []);
      assert.equal(migrated.furniture[0].y, 0);
      assert.equal(migrated.furniture[0].parentId, null);
      assert.deepEqual(normalizeProject(migrated), migrated);
      assert.throws(() => normalizeProject({...old, version: 3}));
      assert.throws(() => normalizeProject({...old, objects: fixture.objects}));
    });

test('semantic category, source and support graph survive round trip',
    () => {
      const project = scene();
      assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(project))),
          project);
      assert.equal(project.objects[0].sourceId, 'detected-books');
      assert.equal(project.objects[0].category, 'book_group');
      assert.equal(project.objects[0].parentId, 'shelf');
      assert.equal(project.furniture[0].supports[0].thickness, 20);
    });

test('invalid IDs, parent graphs and surfaces are rejected', () => {
  const mutate = (change) => {
    const project = structuredClone(fixture);
    change(project);
    assert.throws(() => normalizeProject(project));
  };
  mutate((p) => p.objects[0].id = 'desk');
  mutate((p) => p.objects[0].id = 'room');
  mutate((p) => p.objects[0].parentId = 'missing');
  mutate((p) => p.objects[0].parentId = 'books');
  mutate((p) => {
    p.objects[0].parentId = 'oven';
    p.objects[0].attachment = 'on';
    p.objects[0].surfaceId = null;
    p.objects[1].parentId = 'books';
    p.objects[1].attachment = 'on';
    p.objects[1].surfaceId = null;
  });
  mutate((p) => p.objects[0].surfaceId = 'missing');
  mutate((p) => p.objects[3].wall = 5);
  mutate((p) => p.furniture[0].supports[0].width = 2000);
  mutate((p) => p.furniture[0].supports[0].y = 1);
  mutate((p) => p.furniture[0].supports.push(p.furniture[0].supports[0]));
  mutate((p) => p.furniture[0].supports = null);
  mutate((p) => p.objects = null);
});

test('moving and rotating a parent moves descendants and preserves local data',
    () => {
      const project = scene();
      project.objects[0].x = 100;
      const before = resolveItems(project).find((item) => item.id === 'books');
      assert.equal(before.x, 900);
      assert.equal(before.z, 900);
      const moved = applyPlacements(project,
          [{id: 'shelf', x: 1400, z: 1500, rotation: 180}]);
      const after = resolveItems(moved).find((item) => item.id === 'books');
      assert.equal(after.x, 1300);
      assert.equal(after.z, 1500);
      assert.equal(after.y, 100);
      assert.equal(after.rotation, 180);
      assert.equal(moved.objects[0].x, 100);
      assert.equal(project.furniture[0].x, 900);
    });

test('unknown parent elevation propagates and is not rendered as zero', () => {
  const project = scene();
  project.furniture[0].y = null;
  const items = resolveItems(project);
  assert.equal(items.find((item) => item.id === 'books').y, null);
  assert.ok(validate(project).issues.some((issue) =>
    issue.code === 'POSITION_UNKNOWN' && issue.objectIds.includes('books'),
  ));
});

test('TV, books, appliance and clock fit their support surfaces', () => {
  assert.deepEqual(validate(scene()).issues, []);
});

test('shelf boards, unsupported placement and overhang are checked', () => {
  const issueCodes = (change) => {
    const project = scene();
    change(project);
    return validate(project).issues.map((issue) => issue.code);
  };
  assert.ok(issueCodes((p) => p.objects[1].y = 880)
      .includes('FURNITURE_OVERLAP'));
  assert.ok(issueCodes((p) => p.objects[1].y = 920)
      .includes('OFF_SUPPORT_SURFACE'));
  assert.ok(issueCodes((p) => p.objects[0].x = 500)
      .includes('OUTSIDE_SUPPORT'));
  assert.ok(issueCodes((p) => p.objects[0].height = 1900)
      .includes('OUTSIDE_PARENT_HEIGHT'));
  assert.ok(issueCodes((p) => p.objects[3].x = 3500)
      .includes('WALL_ATTACHMENT_INVALID'));
});

test('collision checks include unrelated objects and do not exempt relatives',
    () => {
      const project = scene();
      project.objects.push(normalizeFurniture({
        ...project.objects[0], id: 'other-books',
      }));
      assert.ok(validate(project).issues.some((issue) =>
        issue.code === 'FURNITURE_OVERLAP' &&
        issue.objectIds.includes('books') &&
        issue.objectIds.includes('other-books'),
      ));
      project.objects.pop();
      project.objects[0].y = 850;
      assert.ok(validate(project).issues.some((issue) =>
        issue.code === 'FURNITURE_OVERLAP' &&
        issue.objectIds.includes('shelf'),
      ));
    });

test('ceiling and floor validation include bottom elevations', () => {
  const project = scene();
  project.objects[3].y = 2200;
  project.furniture[2].y = -10;
  const codes = validate(project).issues.map((issue) => issue.code);
  assert.ok(codes.includes('ABOVE_CEILING'));
  assert.ok(codes.includes('BELOW_FLOOR'));
});

test('nested child elevations compose without flattening stored coordinates',
    () => {
      const project = scene();
      project.objects.push(normalizeFurniture({
        id: 'magazine', name: '本の上の雑誌', category: 'magazine',
        width: 100, depth: 100, height: 10, x: 50, z: 0, y: 300,
        rotation: 0, parentId: 'books', attachment: 'on',
      }));
      const magazine = resolveItems(project)
          .find((item) => item.id === 'magazine');
      assert.equal(magazine.y, 400);
      assert.equal(magazine.x, 900);
      assert.equal(magazine.z, 950);
      assert.deepEqual(validate(project).issues, []);
    });

test('door clearance excludes objects above the opening but includes low ones',
    () => {
      const project = scene();
      project.room = normalizeRoom({...project.room, openings: [{
        id: 'door', type: 'door', wall: 0, offset: 0, width: 1000,
        height: 2000, sill: 0, clearance: 1000,
      }]});
      project.objects[3].wall = 0;
      Object.assign(project.objects[3], {
        x: 500, z: 20, rotation: 0, y: 2050, height: 200,
      });
      const blocked = (p) => validate(p).issues.some((issue) =>
        issue.code === 'DOOR_BLOCKED' && issue.objectIds.includes('clock'),
      );
      assert.equal(blocked(project), false);
      project.objects[3].y = 1700;
      assert.equal(blocked(project), true);
    });
