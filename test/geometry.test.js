import test from 'node:test';
import assert from 'node:assert/strict';
import {footprint, overlap, contained, simplePolygon, openingGeometry} from '../src/geometry.js';
import {normalizeRoom, normalizeFurniture, normalizeProject, corrections, emptyProject} from '../src/model.js';
import {validate} from '../src/validation.js';
import {propose} from '../src/proposals.js';

const room = () =>
  normalizeRoom(
      {
        outline: [
          [0, 0],
          [4000, 0],
          [4000, 5000],
          [0, 5000],
        ],
        height: 2400,
        openings: [],
        name: 'room',
      },
      {trusted: true, fallback: 'confirmed'},
  );
const furniture = (patch = {}) =>
  normalizeFurniture(
      {
        id: 'desk',
        name: 'desk',
        kind: 'desk',
        color: '#aaaaaa',
        width: 1000,
        depth: 600,
        height: 720,
        x: 2000,
        z: 2500,
        rotation: 0,
        ...patch,
      },
      {trusted: true, fallback: 'confirmed'},
  );
const project = (fs = []) => ({
  ...emptyProject(),
  room: room(),
  furniture: fs,
});
test('touching furniture is allowed, overlap is detected', () => {
  assert.equal(
      overlap(
          footprint(furniture()),
          footprint(furniture({x: 3000})),
      ),
      false,
  );
  assert.equal(
      overlap(
          footprint(furniture()),
          footprint(furniture({x: 2999})),
      ),
      true,
  );
});
test('rotated rectangles use true footprints', () => {
  const a = furniture({
    width: 2000,
    depth: 200,
    rotation: 45,
    x: 1500,
    z: 1500,
  });
  const b = furniture({
    width: 2000,
    depth: 200,
    rotation: 45,
    x: 1750,
    z: 1750,
  });
  assert.equal(overlap(footprint(a), footprint(b)), false);
  assert.equal(
      validate(
          project([
            a,
            furniture({
              id: 'other',
              width: 2000,
              depth: 200,
              rotation: 45,
              x: 1550,
              z: 1500,
            }),
          ]),
      ).issues[0].code,
      'FURNITURE_OVERLAP',
  );
});
test(
    'concave room rejects an edge spanning a notch even ' +
    'with all corners inside',
    () => {
      const r = [
        [0, 0],
        [10, 0],
        [10, 10],
        [6, 10],
        [6, 3],
        [4, 3],
        [4, 10],
        [0, 10],
      ];
      assert.equal(simplePolygon(r), true);
      assert.equal(
          contained(
              [
                [2, 2],
                [8, 2],
                [8, 8],
                [2, 8],
              ],
              r,
          ),
          false,
      );
    },
);
test(
    'room boundaries are allowed; outside and ceiling ' +
    'are detected',
    () => {
      assert.equal(
          validate(project([furniture({x: 500, z: 300})])).valid,
          true,
      );
      assert.deepEqual(
          validate(
              project([furniture({x: 400, height: 2500})]),
          ).issues.map((v) => v.code),
          ['OUTSIDE_ROOM', 'ABOVE_CEILING'],
      );
    },
);
test('self-crossing and backtracking room outlines are rejected', () => {
  for (const outline of [
    [
      [0, 0],
      [10, 10],
      [0, 10],
      [10, 0],
    ],
    [
      [0, 0],
      [10, 0],
      [5, 0],
      [10, 10],
      [0, 10],
    ],
  ]) {
    assert.throws(() => normalizeRoom({outline}));
  }
});
test('door approach points inward regardless of outline winding', () => {
  for (const outline of [
    [
      [0, 0],
      [4000, 0],
      [4000, 4000],
      [0, 4000],
    ],
    [
      [4000, 0],
      [0, 0],
      [0, 4000],
      [4000, 4000],
    ],
  ]) {
    const r = normalizeRoom({
      outline,
      height: 2400,
      openings: [
        {
          id: 'door',
          type: 'door',
          wall: 0,
          offset: 1500,
          width: 1000,
          height: 2100,
          sill: 0,
          clearance: 1000,
        },
      ],
    });
    const g = openingGeometry(r, r.openings[0]);
    assert.equal(g.nz, 1);
    assert.equal(
        validate({
          ...project([furniture({x: 2000, z: 500})]),
          room: r,
        }).issues.some((i) => i.code === 'DOOR_BLOCKED'),
        true,
    );
  }
});
test('invalid openings are rejected', () => {
  assert.throws(() =>
    normalizeRoom({
      ...room(),
      openings: [
        {
          type: 'door',
          wall: 0,
          offset: 3500,
          width: 1000,
          height: 2100,
        },
      ],
    }),
  );
  assert.throws(() =>
    normalizeRoom({
      ...room(),
      openings: [
        {
          type: 'window',
          wall: 0,
          offset: 0,
          width: 1000,
          height: 2000,
          sill: 900,
        },
      ],
    }),
  );
});
test(
    'unknown dimensions and estimated evidence make ' +
    'validation provisional',
    () => {
      const p = project([
        normalizeFurniture({width: 1000, depth: 600}),
      ]);
      const v = validate(p);
      assert.equal(v.valid, false);
      assert.equal(v.provisional, true);
      assert.equal(v.issues[0].code, 'DIMENSIONS_UNKNOWN');
      assert.ok(
          corrections(p).some(
              (v) => v.path.endsWith('.height') && v.status === 'unknown',
          ),
      );
    },
);
test(
    'analysis cannot claim human confirmation; saved ' +
    'state preserves it',
    () => {
      const f = normalizeFurniture({
        width: 1000,
        evidence: {width: {status: 'confirmed'}},
      });
      assert.equal(f.evidence.width.status, 'estimated');
      assert.equal(
          normalizeProject(project([furniture()])).furniture[0].evidence
              .width.status,
          'confirmed',
      );
    },
);
test(
    'missing openings are unknown; explicitly empty ' +
    'openings can be confirmed',
    () => {
      assert.equal(
          normalizeRoom({outline: room().outline}).evidence.openings
              .status,
          'unknown',
      );
      assert.equal(room().evidence.openings.status, 'confirmed');
    },
);
test(
    'proposals are independently validated and cannot ' +
    'hide packing failures',
    () => {
      const p = project([furniture()]);
      assert.equal(propose(p, {count: 3}).length, 3);
      assert.ok(
          propose(p).every(
              (v) =>
                v.validation.geometryValid &&
                v.validation.provisional &&
                !v.validation.valid,
          ),
      );
      const impossible = project([furniture({width: 10000})]);
      assert.ok(
          propose(impossible).every(
              (v) => !v.validation.geometryValid && v.notes.length > 1,
          ),
      );
    },
);
test(
    'project refuses duplicate IDs and invalid proposal ' +
    'references',
    () => {
      assert.throws(() =>
        normalizeProject(project([furniture(), furniture()])),
      );
      assert.throws(() =>
        normalizeProject({
          ...project([furniture()]),
          proposals: [
            {id: 'p', name: 'P', intent: 'test', placements: []},
          ],
        }),
      );
    },
);
