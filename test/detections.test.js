import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyProject, normalizeProject, revise} from '../src/model.js';
import {importAnalysis, normalizeAnalysis, unlinkDetection} from '../src/detections.js';
import {convertJevReport} from '../src/jev.js';

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

test('Jev report converts crop boxes and retains raw model answers', () => {
  const report = {
    sha256: analysis.analysis.sources[0].sha256, model: 'jev-fixture',
    input_transform: {region: {left: 0.1, top: 0.2, right: 0.4, bottom: 0.8},
      source_pixels: [100, 200, 400, 800], submitted_size: [300, 600]},
    targets: [
      {id: 'shelf', name: '棚', role: 'furniture', kind: 'shelf',
        included: true, presence: 0.95, box_confidence: 0.85,
        kind_confidence: 0.8,
        box: {left: 0.13, top: 0.26, right: 0.37, bottom: 0.74},
        input_box: {left: 0.1, top: 0.1, right: 0.9, bottom: 0.9}},
      {id: 'books', name: '本', role: 'object', parent_id: 'shelf',
        included: true, presence: 0.9, box_confidence: 0.8,
        box: {left: 0.1, top: 0.2, right: 0.2, bottom: 0.3}},
      {id: 'excluded', name: '除外', role: 'object',
        included: false, presence: 0.2, box_confidence: 0.3,
        box: {left: 0.5, top: 0.5, right: 0.6, bottom: 0.6}},
    ],
  };
  // Legacy skill drafts have furniture names but no stable IDs or objects.
  const legacy = {room: {outline: null, height: null},
    furniture: [{name: '棚', kind: 'shelf', width: null}]};
  const response = {
    model: 'jev-fixture', answers: {shelf_present: {noul: 0.95}},
  };
  const converted = convertJevReport(legacy, report, response);
  assert.equal(converted.furniture.length, 1);
  assert.equal(converted.furniture[0].id, 'shelf');
  assert.equal(converted.objects[0].parentId, 'shelf');
  assert.equal(converted.objects[0].y, null);
  assert.equal(converted.objects.length, 1);
  assert.deepEqual(converted.analysis.jevReport, report);
  assert.deepEqual(converted.analysis.modelAnswer, response);
  assert.deepEqual(converted.analysis.detections[0].box,
      [0.1, 0.1, 0.8, 0.8]);
  assert.equal(converted.analysis.regions.length, 1);
  assert.equal(converted.analysis.detections[2].decision, 'excluded');
  const project = emptyProject();
  importAnalysis(project, converted, [image], 'room');
  assert.equal(normalizeProject(project).objects.length, 1);
  assert.equal(project.furniture[0].width, null);
  const bad = structuredClone(report);
  bad.targets[0].box.left = 0.5;
  assert.throws(() => convertJevReport(null, bad));
  bad.targets[0] = report.targets[0];
  bad.targets[1].parent_id = 'missing';
  assert.throws(() => convertJevReport(null, bad));
});

test('23 detections retain source, crop, raw answer and mapping', () => {
  const project = imported();
  assert.equal(project.analysis.detections.length, 23);
  assert.deepEqual(project.analysis.raw, analysis);
  assert.equal(project.analysis.idMap.clock, 'clock');
  assert.equal(project.analysis.idMap['candidate-22'], null);
  assert.equal(project.analysis.regions[0].box[2], 0.3);
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(project))),
      project);
});

test('reimport matches changed IDs and preserves human dimensions', () => {
  const project = imported();
  const shelf = project.furniture[0];
  const previous = structuredClone(shelf);
  shelf.width = 1300;
  revise(shelf, previous, ['width'], 'confirmed', '実測');
  const revised = structuredClone(analysis);
  revised.furniture[0].id = 'new-shelf';
  revised.furniture[0].width = 1250;
  revised.analysis.detections[0].targetId = 'new-shelf';
  for (const item of revised.objects) {
    if (item.parentId === 'shelf') {
      item.parentId = 'new-shelf';
    }
  }
  importAnalysis(project, revised, [image], 'room');
  const result = normalizeProject(project);
  assert.equal(result.furniture.length, 4);
  assert.equal(result.objects.length, 6);
  assert.equal(result.furniture[0].id, 'shelf');
  assert.equal(result.furniture[0].width, 1300);
  assert.equal(result.furniture[0].evidence.width.status, 'confirmed');
  assert.equal(result.objects[0].parentId, 'shelf');
  assert.equal(result.analysis.raw.furniture[0].width, 1250);
  assert.equal(result.analysis.idMap.shelf, 'shelf');
  importAnalysis(result, revised, [image], 'room');
  assert.equal(normalizeProject(result).objects.length, 6);
});

test('invalid boxes, references, confidence and hashes reject entire analysis',
    () => {
      const changes = [
        (data) => data.analysis.detections[0].box[0] = 2,
        (data) => data.analysis.detections[0].box[2] = 0,
        (data) => data.analysis.detections[0].boxConfidence = 2,
        (data) => data.analysis.detections[0].regionId = 'missing',
        (data) => data.analysis.sources[0].sha256 = '0'.repeat(64),
        (data) => data.objects[0].parentId = 'missing',
        (data) => data.analysis.detections[12].targetId = 'missing',
      ];
      for (const change of changes) {
        const data = structuredClone(analysis);
        change(data);
        assert.throws(() => {
          const project = emptyProject();
          importAnalysis(project, data, [image], 'room');
          normalizeProject(project);
        });
      }
      const bad = structuredClone(analysis.analysis);
      bad.detections[22].targetId = 'shelf';
      assert.throws(() => normalizeAnalysis(bad));
    });

test('unknown shapes retain semantics and use an explicitly provisional box',
    () => {
      const project = emptyProject();
      const item = importAnalysis(project,
          {furniture: {kind: 'custom-shape'}}, [image], 'furniture');
      assert.equal(item.kind, 'box');
      assert.equal(item.category, 'custom-shape');
      assert.match(item.uncertainties[0], /仮表示/);
    });

test('partial analysis keeps earlier detections and raw answers', () => {
  const project = imported();
  const partial = {
    object: {...analysis.objects[3], width: 320},
    analysis: {...structuredClone(analysis.analysis), detections:
      [structuredClone(analysis.analysis.detections[7])]},
  };
  importAnalysis(project, partial, [image], 'object');
  let saved = normalizeProject(project);
  assert.equal(saved.analysis.detections.length, 23);
  assert.equal(saved.analysis.runs.length, 2);
  assert.deepEqual(saved.analysis.runs[0], analysis);
  assert.equal(saved.objects.find((item) => item.id === 'clock').width, 320);
  importAnalysis(saved, partial, [image], 'object');
  saved = normalizeProject(saved);
  assert.equal(saved.analysis.runs.length, 2);
  saved.objects = saved.objects.filter((item) => item.id !== 'clock');
  unlinkDetection(saved, 'clock');
  saved = normalizeProject(saved);
  assert.equal(saved.analysis.idMap.clock, null);
  assert.equal(saved.analysis.detections[7].decision, 'pending');
  assert.equal(saved.analysis.raw.object.width, 320);
});
