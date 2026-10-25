import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {requireValue} from '../src/errors.js';

/**
 * Calculate intersection over union for normalized [x,y,width,height] boxes.
 * @param {!Array<number>} a First box.
 * @param {!Array<number>} b Second box.
 * @return {number} IoU in [0,1].
 */
export function boxIoU(a, b) {
  const width = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) -
      Math.max(a[0], b[0]));
  const height = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) -
      Math.max(a[1], b[1]));
  const intersection = width * height;
  return Math.min(1, Math.max(0,
      intersection / (a[2] * a[3] + b[2] * b[3] - intersection)));
}

/**
 * Evaluate fixed predictions with confidence-ordered one-to-one matching.
 * @param {!Object} gold Image IDs and exhaustive labels for those images.
 * @param {!Array<!Object>} predictions Image/category/box/confidence entries.
 * @param {!Object} options Frozen confidence and IoU thresholds.
 * @return {!Object} TP/FP/FN, precision, recall and matched-box mean IoU.
 */
export function evaluateDetections(gold, predictions,
    {minConfidence = 0.8, minIoU = 0.5} = {}) {
  const probability = (value) => typeof value === 'number' &&
      Number.isFinite(value) && value >= 0 && value <= 1;
  requireValue(probability(minConfidence) && probability(minIoU) && minIoU > 0,
      'Invalid evaluation thresholds');
  requireValue(Array.isArray(gold.images) && Array.isArray(gold.labels) &&
      Array.isArray(predictions) && gold.images.every((id) =>
    typeof id === 'string') &&
    new Set(gold.images).size === gold.images.length, 'Invalid dataset');
  for (const entry of [...gold.labels, ...predictions]) {
    const b = entry.box;
    requireValue(gold.images.includes(entry.imageId) &&
        typeof entry.category === 'string' && entry.category.length > 0 &&
        Array.isArray(b) && b.length === 4 && b.every(probability) &&
        b[2] > 0 && b[3] > 0 && b[0] + b[2] <= 1 + 1e-9 &&
        b[1] + b[3] <= 1 + 1e-9, 'Invalid detection label or box');
  }
  requireValue(predictions.every((entry) => probability(entry.confidence)),
      'Invalid prediction confidence');
  const used = new Set();
  const matches = [];
  let falsePositives = 0;
  const accepted = predictions.filter((entry) =>
    entry.confidence >= minConfidence).sort((a, b) =>
    b.confidence - a.confidence);
  for (const prediction of accepted) {
    let best = -1;
    let iou = 0;
    for (const [index, label] of gold.labels.entries()) {
      if (used.has(index) || label.imageId !== prediction.imageId ||
          label.category !== prediction.category) {
        continue;
      }
      const candidateIoU = boxIoU(prediction.box, label.box);
      if (candidateIoU > iou) {
        best = index;
        iou = candidateIoU;
      }
    }
    if (best >= 0 && iou >= minIoU) {
      used.add(best);
      matches.push({imageId: prediction.imageId,
        labelId: gold.labels[best].id, predictionId: prediction.id, iou});
    } else {
      falsePositives++;
    }
  }
  const truePositives = matches.length;
  return {minConfidence, minIoU, truePositives, falsePositives,
    falseNegatives: gold.labels.length - truePositives,
    precision: accepted.length ? truePositives / accepted.length : null,
    recall: gold.labels.length ? truePositives / gold.labels.length : null,
    meanIoU: matches.length
      ? matches.reduce((sum, entry) => sum + entry.iou, 0) / matches.length
      : null,
    matches};
}

const isMain = process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [goldPath, predictionsPath] = process.argv.slice(2);
  const [gold, predictions] = await Promise.all([goldPath, predictionsPath]
      .map(async (file) => JSON.parse(await readFile(file, 'utf8'))));
  console.log(JSON.stringify(evaluateDetections(gold, predictions), null, 2));
}
