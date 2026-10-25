import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {boxIoU, evaluateDetections} from '../scripts/detection-quality.js';

const label = {id: 'book', imageId: 'positive', category: 'books',
  box: [0.1, 0.2, 0.3, 0.4]};
const gold = {images: ['positive', 'negative'], labels: [label]};

test('quality evaluation penalizes duplicate, wrong-class and absent objects',
    () => {
      assert.equal(boxIoU(label.box, label.box), 1);
      assert.equal(boxIoU(label.box, [0.8, 0.8, 0.1, 0.1]), 0);
      const result = evaluateDetections(gold, [
        {...label, confidence: 0.99}, {...label, confidence: 0.9},
        {...label, category: 'clock', confidence: 0.9},
        {...label, imageId: 'negative', confidence: 0.9},
        {...label, confidence: 0.2},
      ]);
      assert.equal(result.truePositives, 1);
      assert.equal(result.falsePositives, 3);
      assert.equal(result.falseNegatives, 0);
      assert.equal(result.precision, 0.25);
      assert.equal(result.recall, 1);
      assert.equal(result.meanIoU, 1);
    });

test('empty, wrong and invalid predictions cannot imply high quality', () => {
  assert.equal(evaluateDetections(gold, []).recall, 0);
  assert.equal(evaluateDetections(gold, []).precision, null);
  const wrong = evaluateDetections(gold,
      [{...label, category: 'clock', confidence: 1}]);
  assert.equal(wrong.falseNegatives, 1);
  assert.equal(wrong.falsePositives, 1);
  assert.equal(wrong.meanIoU, null);
  assert.throws(() => evaluateDetections(gold,
      [{...label, imageId: 'unknown', confidence: 1}]));
  assert.throws(() => evaluateDetections(gold,
      [{...label, box: [0, 0, -1, 1], confidence: 1}]));
});

test('saved Jev responses reproduce the recorded synthetic evaluation',
    async () => {
      const fixture = async (name) => JSON.parse(await readFile(
          new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
      const labels = await fixture('quality-labels.json');
      const predictions = await fixture('quality-results/predictions.json');
      const recorded = await fixture('quality-results/evaluation.json');
      const actual = evaluateDetections(labels, predictions);
      assert.equal(actual.truePositives, recorded.truePositives);
      assert.equal(actual.falseNegatives, recorded.falseNegatives);
      assert.deepEqual(actual.matches, recorded.matches);
      assert.equal(actual.meanIoU, recorded.meanIoU);
      for (const run of recorded.runs) {
        const bytes = await readFile(new URL(
            `./fixtures/${run.imageId}.png`, import.meta.url));
        assert.equal(createHash('sha256').update(bytes).digest('hex'),
            run.sourceSHA256);
      }
    });
