import {createHash} from 'node:crypto';
import {requireValue} from './errors.js';
import {normalizeAnalysis} from './detections.js';

function boxFromEdges(box) {
  requireValue(box && typeof box === 'object', 'Detection box is required');
  return [box.left, box.top, box.right - box.left, box.bottom - box.top];
}

/**
 * Convert a local detection report without calling an API.
 * Preserve crop transforms, model answers, excluded rows and unknown geometry.
 * @param {?Object} data Optional room analysis containing chosen dimensions.
 * @param {!Object} report Detection JSON, including sha256 and targets.
 * @param {*} response Optional opaque model response JSON.
 * @return {!Object} Room analysis with canonical detection metadata.
 */
export function convertDetectionReport(data, report, response = null) {
  requireValue(report && Array.isArray(report.targets),
      'Detection report must contain targets');
  const result = data?.room ? structuredClone(data) : {
    room: structuredClone(data ?? {
      name: '画像解析の部屋', outline: null, height: null,
      uncertainties: ['部屋の輪郭・縮尺・天井高は未確認です。'],
    }),
    furniture: [], objects: [],
  };
  result.furniture ??= [];
  result.objects ??= [];
  requireValue(Array.isArray(result.furniture) && Array.isArray(result.objects),
      'Analysis furniture and objects must be arrays');
  requireValue(Array.isArray(result.room.openings ?? []),
      'Analysis openings must be an array');
  const rows = new Map();
  for (const row of report.targets) {
    requireValue(row && typeof row.id === 'string' && !rows.has(row.id),
        'Invalid or duplicate detection target ID');
    requireValue(typeof row.included === 'boolean',
        'Detection inclusion decision must be boolean');
    requireValue(['furniture', 'object', 'opening'].includes(row.role),
        'Invalid detection target role');
    rows.set(row.id, row);
  }
  for (const row of rows.values()) {
    const seen = new Set([row.id]);
    let parent = row.parent_id;
    while (parent) {
      requireValue(rows.has(parent) && !seen.has(parent),
          'Missing or cyclic detection parent target');
      seen.add(parent);
      parent = rows.get(parent).parent_id;
    }
  }
  const imageId = `image-${String(report.sha256).slice(0, 16)}`;
  const regions = new Map();
  const targets = new Map();
  for (const row of rows.values()) {
    const collection = row.role === 'opening' ? result.room.openings ?? []
      : row.role === 'object' ? result.objects : result.furniture;
    const matches = collection.filter((item) => item.id === row.id ||
        item.sourceId === row.id || item.name === row.name);
    requireValue(matches.length <= 1, 'Ambiguous detection target match');
    let item = matches[0];
    requireValue(row.included || !item,
        'Excluded detection targets must not have scene items');
    if (!item && row.included && row.role !== 'opening') {
      item = {
        id: row.id, sourceId: row.id, name: row.name,
        category: row.category ?? row.kind ?? row.id,
        kind: row.kind && !['other', 'none'].includes(row.kind)
          ? row.kind : 'box',
        width: null, depth: null, height: null,
        x: null, y: null, z: null, rotation: null,
        uncertainties: ['実寸・設置位置は不明。検出枠は画像上の座標です。'],
      };
      collection.push(item);
    }
    if (item) {
      item.id ??= row.id;
      if (row.role !== 'opening') {
        item.sourceId = row.id;
      }
      targets.set(row.id, item);
    }
  }
  for (const row of rows.values()) {
    const item = targets.get(row.id);
    if (item && row.role === 'object' && row.parent_id &&
        item.parentId === undefined) {
      requireValue(targets.has(row.parent_id),
          'An included child requires an included parent scene item');
      item.parentId = targets.get(row.parent_id).id;
      item.attachment = 'on';
      item.y = null;
    }
  }
  const detections = [...rows.values()].map((row) => {
    const transform = row.source_transform ?? report.input_transform;
    let regionId = null;
    let box = boxFromEdges(row.box);
    if (row.input_box != null) {
      requireValue(transform?.region, 'Missing detection input transform');
      const regionBox = boxFromEdges(transform.region);
      regionId = 'region-' + createHash('sha256')
          .update(JSON.stringify({imageId, transform}))
          .digest('hex').slice(0, 16);
      regions.set(regionId, {id: regionId, imageId, box: regionBox, transform});
      const local = boxFromEdges(row.input_box);
      const restored = [regionBox[0] + local[0] * regionBox[2],
        regionBox[1] + local[1] * regionBox[3],
        local[2] * regionBox[2], local[3] * regionBox[3]];
      requireValue(restored.every((value, index) =>
        Math.abs(value - box[index]) < 1e-6,
      ), 'Detection source box disagrees with its crop transform');
      box = local;
    }
    const targetId = targets.get(row.id)?.id ?? null;
    return {
      id: row.id, imageId, regionId, box, targetId,
      model: report.model,
      presenceProbability: row.presence,
      boxConfidence: row.box_confidence,
      categoryConfidence: row.kind_confidence ?? null,
      decision: !row.included ? 'excluded' : targetId ? 'accepted' : 'pending',
      reason: row.reason ?? (row.included
        ? '検出レポートで採用。実寸・支持関係は別途確認。'
        : '検出レポートの採否指定により除外。'),
      original: row,
    };
  });
  result.analysis = normalizeAnalysis({
    sources: [{id: imageId, sha256: report.sha256}],
    regions: [...regions.values()], detections,
    sourceReport: structuredClone(report),
    modelAnswer: structuredClone(response),
  });
  return result;
}
