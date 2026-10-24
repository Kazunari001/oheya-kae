import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyProject, normalizeProject} from '../src/model.js';
import {importAnalysis} from '../src/detections.js';
import {propose} from '../src/proposals.js';
import {applyPlacements, validate, createPlacementCheck} from '../src/validation.js';
import {resolveItems} from '../src/scene.js';

const analysis = JSON.parse(await readFile(
    new URL('./fixtures/detailed-analysis.json', import.meta.url), 'utf8'));
const image = {name: 'synthetic.png', data:
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1' +
  'HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII='};
function imported() {
  const project = emptyProject();
  importAnalysis(project, structuredClone(analysis), [image], 'room');
  return normalizeProject(project);
}

test('validation groups measurements and detection uncertainty', () => {
  const project = imported();
  const report = validate(project);
  assert.deepEqual(report.counts, {
    detected: 23, displayed: 9, unplaced: 1, imageOnly: 12,
  });
  assert.ok(report.detectionChecks.some((entry) => entry.id === 'clock'));
  assert.ok(!report.detectionChecks.some((entry) =>
    entry.id === 'candidate-22',
  ));
  assert.ok(report.correctionGroups.some((entry) =>
    entry.objectId === 'books' && entry.type === 'measurement',
  ));
});

test('proposals move roots with contents and keep wall items and parts local',
    () => {
      const project = imported();
      project.objects = project.objects.filter((item) =>
        item.id !== 'unlocated',
      );
      delete project.analysis;
      // A furniture collection may also contain attached items.
      project.furniture.push(project.objects.shift());
      project.objects.push({
        ...structuredClone(project.objects[0]), id: 'frame-part',
        parentId: 'rack', attachment: 'part', surfaceId: null,
        x: 0, y: 0, z: 0, width: 20, depth: 20, height: 1600,
      });
      const before = structuredClone(project);
      const [proposal] = propose(project, {count: 1, step: 500, clearance: 0});
      assert.deepEqual(project, before);
      assert.deepEqual(proposal.placements.map((item) => item.id).sort(),
          ['desk', 'rack', 'shelf', 'stand']);
      assert.equal(proposal.validation.geometryValid, true);
      const saved = normalizeProject({...project, proposals: [proposal]});
      const moved = applyPlacements(saved, proposal.placements);
      assert.equal(moved.furniture.find((item) => item.id === 'shelf')
          .evidence.x.history.at(-1).value, 900);
      assert.deepEqual(moved.objects, saved.objects);
      assert.deepEqual(moved.furniture.find((item) => item.id === 'books'),
          saved.furniture.find((item) => item.id === 'books'));
      const world = resolveItems(moved);
      const shelf = world.find((item) => item.id === 'shelf');
      const books = world.find((item) => item.id === 'books');
      assert.equal(books.x, shelf.x);
      assert.equal(books.z, shelf.z);
      assert.equal(books.y, 100);
      assert.equal(world.find((item) => item.id === 'clock').x, 3980);
      assert.deepEqual(applyPlacements(project, [
        {id: 'books', x: 9999, z: 9999, rotation: 20},
      ]).furniture, project.furniture);
    });

function relatedIds(project, initial) {
  const ids = new Set(initial);
  const items = [...project.furniture, ...project.objects];
  for (const id of ids) {
    for (const item of items) {
      if (item.parentId === id) {
        ids.add(item.id);
      }
    }
  }
  return ids;
}

function checkAgainstFullValidation(project, rootId, ignored, placements) {
  const original = structuredClone(project);
  const movingIds = relatedIds(project, [rootId]);
  const ignoredIds = relatedIds(project, ignored);
  const check = createPlacementCheck(project, rootId, new Set(ignored));
  for (const placement of placements) {
    const trial = applyPlacements(project, [{id: rootId, ...placement}]);
    trial.furniture = trial.furniture.filter((item) =>
      !ignoredIds.has(item.id),
    );
    trial.objects = trial.objects.filter((item) => !ignoredIds.has(item.id));
    const expected = !validate(trial).issues.some((issue) =>
      issue.objectIds.some((id) => movingIds.has(id)),
    );
    assert.equal(check(placement), expected,
        `${rootId} at ${JSON.stringify(placement)}`);
  }
  assert.deepEqual(project, original);
}

test('cached candidate checks match full geometry across moving hierarchies',
    () => {
      const project = imported();
      project.objects.push({
        ...structuredClone(project.objects[0]), id: 'frame-part',
        parentId: 'rack', attachment: 'part', surfaceId: null,
        x: 0, y: 0, z: 0, width: 20, depth: 20, height: 1600,
      });
      const placements = [];
      for (const x of [100, 600, 1200, 2000, 3000, 3900]) {
        for (const z of [100, 900, 2200, 4000, 4900]) {
          for (const rotation of [0, 90, 180, 270, 37]) {
            placements.push({x, z, rotation});
          }
        }
      }
      for (const rootId of ['shelf', 'stand', 'desk', 'rack']) {
        for (const ignored of [[], ['stand', 'desk'].filter((id) =>
          id !== rootId,
        )]) {
          checkAgainstFullValidation(project, rootId, ignored, placements);
        }
      }
    });

test('cached checks retain invariant support, ceiling and internal collisions',
    () => {
      const mutations = [
        (project) => project.objects[0].height = null,
        (project) => project.objects[0].y = 110,
        (project) => project.objects[0].y = -10,
        (project) => project.room.height = 1000,
        (project) => project.objects.push({
          ...structuredClone(project.objects[0]), id: 'duplicate-books',
        }),
        (project) => project.objects[1].surfaceId = 'lower',
      ];
      for (const mutate of mutations) {
        const project = imported();
        mutate(project);
        checkAgainstFullValidation(project, 'shelf', [], [
          {x: 900, z: 1000, rotation: 90},
          {x: 2500, z: 2500, rotation: 0},
          {x: 2500, z: 2500, rotation: 90},
        ]);
      }
    });
