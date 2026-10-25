import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {evaluateDetections} from './detection-quality.js';

const reports = [
  ['quality-room', 'output/quality-detection-room'],
  ['quality-empty', 'output/quality-detection-empty'],
];
const categories = {shelf: 'shelf', books: 'books', oven: 'appliance',
  rack: 'clothes_rack', 'clock-left': 'clock', 'clock-edge': 'clock',
  desk: 'desk', sofa: 'sofa'};
const predictions = [];
const runs = [];
const destination = 'test/fixtures/quality-results';
await mkdir(destination, {recursive: true});
for (const [imageId, directory] of reports) {
  const report = JSON.parse(await readFile(`${directory}/detections.json`,
      'utf8'));
  for (const target of report.targets) {
    const {left, top, right, bottom} = target.box;
    predictions.push({id: target.id, imageId, category: categories[target.id],
      confidence: target.included ? target.presence : 0,
      box: [left, top, right - left, bottom - top]});
  }
  runs.push({imageId, model: report.model, usage: report.usage,
    sourceSHA256: report.sha256});
  for (const name of ['request', 'response', 'detections']) {
    await copyFile(`${directory}/${name}.json`,
        `${destination}/${imageId}-${name}.json`);
  }
}
const gold = JSON.parse(await readFile('test/fixtures/quality-labels.json',
    'utf8'));
const discoveryRuns = [];
for (const [imageId, directory] of [
  ['quality-room', 'output/quality-discovery-room'],
  ['quality-empty', 'output/quality-discovery-empty'],
]) {
  const report = JSON.parse(await readFile(`${directory}/discovery.json`,
      'utf8'));
  discoveryRuns.push({imageId, model: report.model, usage: report.usage,
    proposedCategories: report.categories.filter((entry) => entry.proposed)
        .map((entry) => entry.id)});
  for (const name of ['request', 'response', 'discovery']) {
    await copyFile(`${directory}/${name}.json`,
        `${destination}/${imageId}-discovery-${name}.json`);
  }
}
await writeFile(`${destination}/predictions.json`,
    JSON.stringify(predictions, null, 2) + '\n');
await writeFile(`${destination}/evaluation.json`,
    JSON.stringify({runs, discoveryRuns,
      ...evaluateDetections(gold, predictions)}, null, 2) +
      '\n');
console.log(JSON.stringify(evaluateDetections(gold, predictions), null, 2));
