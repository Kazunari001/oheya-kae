import {normalizeProject} from '../src/model.js';
import {propose} from '../src/proposals.js';

// Reproducible synthetic workload; elapsed times depend on the host.
for (const count of [5, 15, 30]) {
  const project = normalizeProject({version: 2, units: 'mm', room: {
    outline: [[0, 0], [8000, 0], [8000, 8000], [0, 8000]], height: 2400,
  }, furniture: Array.from({length: count}, (_, index) => ({
    id: `item-${index}`, kind: 'box', width: 400, depth: 400, height: 500,
    x: 600 + index % 6 * 1000, z: 600 + Math.floor(index / 6) * 1000,
  })), proposals: []});
  const started = performance.now();
  const proposals = propose(project, {step: 400, clearance: 100});
  console.log(JSON.stringify({
    objects: count, elapsedMs: performance.now() - started,
    evaluated: proposals.reduce((sum, entry) =>
      sum + entry.search.evaluated, 0),
    valid: proposals.map((entry) => entry.validation.geometryValid),
  }));
}
