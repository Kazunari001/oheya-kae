import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProject} from '../src/model.js';
import {propose} from '../src/proposals.js';
import {applyPlacements} from '../src/validation.js';

function scene() {
  return normalizeProject({version: 2, units: 'mm', room: {
    id: 'room', outline: [[0, 0], [4000, 0], [4000, 4000], [0, 4000]],
  }, furniture: ['a', 'b'].map((id, index) => ({id, width: 500, depth: 500,
    height: 500, x: 1000 + index * 2000, z: 1000, rotation: 0})),
  objects: [], proposals: []});
}

test('constraints fix roots and evidence while controlling priority and angles',
    () => {
      const project = scene();
      const [proposal] = propose(project, {count: 1, constraints: {
        fixedIds: ['a'], priorityIds: ['b'], rotations: [37], clearance: 100,
      }});
      const fixed = proposal.placements.find((item) => item.id === 'a');
      assert.deepEqual(fixed, {id: 'a', x: 1000, z: 1000, rotation: 0});
      assert.equal(proposal.placements[1].rotation, 37);
      assert.ok(proposal.search.evaluated > 0);
      assert.equal(proposal.validation.geometryValid, true);
      assert.deepEqual(applyPlacements(project, proposal.placements)
          .furniture[0], project.furniture[0]);
      const [ordered] = propose(project, {count: 1,
        constraints: {priorityIds: ['b']}});
      assert.equal(ordered.placements[0].id, 'b');
    });

test('duplicate layouts and failed grid searches have explicit reasons', () => {
  const project = scene();
  const proposals = propose(project, {constraints: {fixedIds: ['a', 'b']}});
  assert.ok(proposals[1].notes.some((note) => note.includes('DUPLICATE')));
  project.furniture[0].width = 8000;
  const [failed] = propose(project, {count: 1});
  assert.ok(failed.notes.some((note) =>
    note.includes('NO_FEASIBLE_GRID_POSITION')));
  assert.equal(failed.validation.geometryValid, false);
});

test('malformed constraints and excessive search work fail before searching',
    () => {
      for (const constraints of [
        {fixedIds: ['missing']}, {fixedIds: ['a', 'a']},
        {priorityIds: ['a'], fixedIds: ['a']}, {rotations: []},
        {rotations: ['90']}, {clearance: -1}, {unknown: true},
      ]) {
        assert.throws(() => propose(scene(), {constraints}));
      }
      assert.throws(() => propose(scene(), {step: 0}));
      const project = scene();
      project.room.outline = [[0, 0], [100000, 0], [100000, 100000],
        [0, 100000]];
      assert.throws(() => propose(project), {code: 'SEARCH_TOO_LARGE'});
    });
