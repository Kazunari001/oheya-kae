import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyProject, normalizeProject, revise} from '../src/model.js';
import {importAnalysis, normalizeAnalysis, unlinkDetection, imageHash} from '../src/detections.js';
import {convertDetectionReport} from '../src/detection-report.js';

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

test('detection reports preserve crop boxes and raw model answers', () => {
  const report = {
    sha256: analysis.analysis.sources[0].sha256, model: 'external-detector',
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
  // Older analysis drafts have names but no stable IDs or objects.
  const legacy = {room: {outline: null, height: null},
    furniture: [{name: '棚', kind: 'shelf', width: null}]};
  const response = {
    model: 'external-detector', output: [{id: 'shelf', present: true}],
  };
  const converted = convertDetectionReport(legacy, report, response);
  assert.equal(converted.furniture.length, 1);
  assert.equal(converted.furniture[0].id, 'shelf');
  assert.equal(converted.objects[0].parentId, 'shelf');
  assert.equal(converted.objects[0].y, null);
  assert.equal(converted.objects.length, 1);
  assert.deepEqual(converted.analysis.sourceReport, report);
  assert.equal(Object.hasOwn(converted.analysis, 'jevReport'), false);
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
  assert.throws(() => convertDetectionReport(null, bad));
  bad.targets[0] = report.targets[0];
  bad.targets[1].parent_id = 'missing';
  assert.throws(() => convertDetectionReport(null, bad));
});

test('different model identifiers and response shapes use the same import path',
    () => {
      const responses = [
        ['vendor-a/vision', {output: [{label: '棚', score: 0.9}]}],
        ['vendor-b/vision', {content: [{type: 'text', text: '棚を検出'}]}],
        ['local-model', [{name: '棚', confirmed: true}]],
      ];
      const project = emptyProject();
      for (const [model, response] of responses) {
        const report = {
          model, sha256: analysis.analysis.sources[0].sha256,
          targets: [{id: 'shelf', name: '棚', role: 'furniture', kind: 'shelf',
            included: true, presence: null, box_confidence: null,
            kind_confidence: null,
            box: {left: 0.1, top: 0.2, right: 0.4, bottom: 0.8}}],
        };
        const converted = convertDetectionReport(null, report, response);
        assert.equal(converted.room.name, '画像解析の部屋');
        assert.deepEqual(converted.analysis.sourceReport, report);
        assert.deepEqual(converted.analysis.modelAnswer, response);
        importAnalysis(project, converted, [image], 'room');
        const saved = normalizeProject(JSON.parse(JSON.stringify(project)));
        assert.equal(saved.furniture.length, 1);
        assert.equal(saved.furniture[0].width, null);
        assert.ok(Object.values(saved.furniture[0].evidence).every((entry) =>
          entry.status !== 'confirmed',
        ));
        assert.equal(saved.analysis.detections[0].model, model);
        assert.equal(saved.analysis.sourceReport.model, model);
        assert.deepEqual(saved.analysis.modelAnswer, response);
        assert.equal(Object.hasOwn(saved.analysis, 'jevReport'), false);
      }
      assert.equal(project.analysis.runs.length, 3);
    });

test('legacy report provenance remains readable without replacing new records',
    () => {
      const legacyReport = {model: 'legacy-detector', original: {score: 0.8}};
      const project = imported();
      project.analysis.jevReport = structuredClone(legacyReport);
      const serialized = JSON.stringify(project);
      const migrated = normalizeProject(JSON.parse(serialized));
      assert.deepEqual(migrated.analysis.sourceReport, legacyReport);
      assert.deepEqual(migrated.analysis.jevReport, legacyReport);
      assert.equal(JSON.stringify(project), serialized);
      assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(migrated))),
          migrated);
      migrated.analysis.sourceReport = {model: 'current-detector'};
      const current = normalizeProject(migrated);
      assert.deepEqual(current.analysis.sourceReport,
          {model: 'current-detector'});
      assert.deepEqual(current.analysis.jevReport, legacyReport);
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

test('provenance retains a unique photo after its only scene owner is deleted',
    () => {
      for (const kind of ['furniture', 'object']) {
        for (const withRoom of [false, true]) {
          const project = withRoom ? imported() : emptyProject();
          const unique = {...image, name: 'unique.png', data:
            'data:image/png;base64,' + Buffer.concat([
              Buffer.from(image.data.split(',')[1], 'base64'), Buffer.from([1]),
            ]).toString('base64')};
          const metadata = {
            sources: [{id: 'unique-photo', sha256: imageHash(unique)}],
            regions: [], detections: [{...analysis.analysis.detections[7],
              id: 'unique-detection', targetId: 'unique-item',
              imageId: 'unique-photo'}],
          };
          importAnalysis(project, {[kind]: {id: 'unique-item', name: 'unique'},
            analysis: metadata}, [unique], kind);
          let saved = normalizeProject(project);
          // Older saved projects must migrate before a mutation removes images.
          delete saved.analysis.images;
          saved = normalizeProject(saved);
          const key = kind === 'object' ? 'objects' : 'furniture';
          saved[key] = saved[key].filter((item) => item.id !== 'unique-item');
          unlinkDetection(saved, 'unique-item');
          saved = normalizeProject(JSON.parse(JSON.stringify(saved)));
          assert.equal(saved.analysis.idMap['unique-detection'], null);
          assert.ok(saved.analysis.images.some((entry) =>
            entry.data === unique.data,
          ));
          assert.equal(saved.analysis.detections.at(-1).decision, 'pending');
        }
      }
    });

test('opening merge preserves confirmed fields and omitted openings', () => {
  const project = imported();
  const door = project.room.openings[0];
  const before = structuredClone(door);
  door.width = 900;
  revise(door, before, ['width'], 'confirmed', '実測の幅');
  const evidence = structuredClone(door.evidence.width);
  const incoming = structuredClone(analysis);
  incoming.room.openings[0].height = 1900;
  incoming.room.openings.push({id: 'window', type: 'window', wall: 0,
    offset: 2000, width: 500, height: 500, sill: 1200});
  importAnalysis(project, incoming, [image], 'room');
  let saved = normalizeProject(project);
  const updated = saved.room.openings.find((item) => item.id === door.id);
  assert.equal(updated.width, 900);
  assert.deepEqual(updated.evidence.width, evidence);
  assert.equal(updated.height, 1900);
  assert.equal(updated.evidence.height.history.at(-1).value, 2000);
  assert.equal(saved.room.openings.length, 2);
  incoming.room.openings.shift();
  importAnalysis(saved, incoming, [image], 'room');
  saved = normalizeProject(saved);
  assert.equal(saved.room.openings.length, 2);
  assert.deepEqual(saved.room.openings[0].evidence.width, evidence);
});

test('identity prioritizes detection mapping, ID, then source ID', () => {
  const seed = {
    furniture: [{id: 'one', sourceId: 'd1', name: 'first'},
      {id: 'two', sourceId: 'd2', name: 'second'}],
    room: {},
    analysis: {sources: analysis.analysis.sources, regions: [], detections:
      ['one', 'two'].map((targetId, index) => ({
        ...analysis.analysis.detections[7], id: `d${index + 1}`,
        imageId: 'photo', targetId,
      }))},
  };
  for (const reverse of [false, true]) {
    const project = emptyProject();
    importAnalysis(project, seed, [image], 'room');
    const saved = normalizeProject(project);
    if (reverse) {
      saved.furniture.reverse();
    }
    const metadata = structuredClone(seed.analysis);
    metadata.detections[1].targetId = 'one';
    importAnalysis(saved, {furniture: {
      id: 'one', sourceId: 'd2', name: 'updated'},
    analysis: metadata}, [image], 'furniture');
    const merged = normalizeProject(saved);
    assert.equal(merged.furniture.length, 2);
    assert.equal(merged.furniture.find((item) => item.id === 'one').name,
        'first');
    assert.equal(merged.furniture.find((item) => item.id === 'two').name,
        'updated');
    assert.equal(merged.analysis.idMap.d1, 'one');
    assert.equal(merged.analysis.idMap.d2, 'two');
    importAnalysis(merged, {furniture: {
      id: 'two', sourceId: 'd1', name: 'id-priority',
    }}, [image], 'furniture');
    assert.equal(merged.furniture.find((item) => item.id === 'one').name,
        'first');
    assert.equal(merged.furniture.find((item) => item.id === 'two').name,
        'id-priority');
    const fallback = normalizeProject(project);
    if (reverse) {
      fallback.furniture.reverse();
    }
    importAnalysis(fallback, {furniture: {
      id: 'new-alias', sourceId: 'd1', name: 'source-fallback',
    }}, [image], 'furniture');
    assert.equal(fallback.furniture.find((item) => item.id === 'one').name,
        'source-fallback');
    assert.equal(fallback.furniture.length, 2);
  }
});
