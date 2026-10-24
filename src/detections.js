import {createHash} from 'node:crypto';
import {requireValue} from './errors.js';
import {normalizeFurniture, normalizeRoom, normalizeImages, KINDS} from './model.js';

const validId = (value) => typeof value === 'string' &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const probability = (value) => value == null ||
    (typeof value === 'number' && Number.isFinite(value) &&
        value >= 0 && value <= 1);

/**
 * Validate detection provenance, retaining raw model answers and exclusions.
 * Boxes and regions use normalized [x, y, width, height] in the source image.
 * @param {!Object} raw Analysis metadata.
 * @return {!Object} Detached metadata suitable for JSON persistence.
 */
export function normalizeAnalysis(raw) {
  requireValue(raw && typeof raw === 'object' && !Array.isArray(raw),
      'analysis must be an object');
  const result = structuredClone(raw);
  if (result.images !== undefined) {
    result.images = normalizeImages(result.images);
  }
  for (const key of ['sources', 'regions', 'detections']) {
    requireValue(Array.isArray(result[key]),
        `analysis.${key} must be an array`);
    const ids = new Set();
    for (const entry of result[key]) {
      requireValue(entry && validId(entry.id) && !ids.has(entry.id),
          `Invalid or duplicate ${key} ID`);
      ids.add(entry.id);
    }
  }
  const sources = new Map(result.sources.map((entry) => [entry.id, entry]));
  for (const source of result.sources) {
    requireValue(typeof source.sha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(source.sha256), 'Invalid source SHA-256');
  }
  const checkBox = (box) => {
    requireValue(Array.isArray(box) && box.length === 4 &&
        box.every((value) => typeof value === 'number' &&
            Number.isFinite(value) && value >= 0 && value <= 1) &&
            box[2] > 0 && box[3] > 0 &&
            box[0] + box[2] <= 1 + 1e-9 &&
            box[1] + box[3] <= 1 + 1e-9, 'Invalid normalized box');
  };
  const regions = new Map(result.regions.map((entry) => [entry.id, entry]));
  for (const region of result.regions) {
    requireValue(sources.has(region.imageId), 'Missing region source image');
    checkBox(region.box);
  }
  for (const detection of result.detections) {
    requireValue(sources.has(detection.imageId),
        'Missing detection source image');
    checkBox(detection.box);
    const region = regions.get(detection.regionId);
    requireValue(detection.regionId == null ||
        (region && region.imageId === detection.imageId),
    'Invalid detection region');
    for (const key of [
      'presenceProbability', 'boxConfidence', 'categoryConfidence',
    ]) {
      requireValue(probability(detection[key]), `Invalid ${key}`);
    }
    requireValue(typeof detection.model === 'string' &&
        detection.model.length > 0, 'Detection model is required');
    requireValue(
        ['accepted', 'excluded', 'pending'].includes(detection.decision),
        'Invalid detection decision');
    requireValue(detection.targetId == null || validId(detection.targetId),
        'Invalid detection target ID');
    requireValue(detection.decision !== 'excluded' ||
        detection.targetId == null,
    'Excluded detections must have a null targetId');
    requireValue(typeof detection.reason === 'string',
        'Detection decision reason is required');
  }
  return result;
}

/**
 * Check metadata mappings against the normalized scene and embedded images.
 * @param {!Object} project Normalized project.
 */
export function validateAnalysisLinks(project) {
  if (!project.analysis) {
    return;
  }
  const items = [project.room, ...project.furniture, ...project.objects,
    ...(project.room?.openings ?? [])].filter(Boolean);
  const ids = new Set(items.map((item) => item.id));
  const uniqueImages = new Map([
    ...items.flatMap((item) => item.images ?? []),
    ...(project.analysis.images ?? []),
  ].map((image) => [image.data, image]));
  const imagesByHash = new Map([...uniqueImages.values()].map((image) =>
    [imageHash(image), image],
  ));
  for (const source of project.analysis.sources) {
    requireValue(imagesByHash.has(source.sha256), 'Source image hash mismatch');
  }
  // Migrate older projects before a mutation can delete an image's sole owner.
  project.analysis.images = [...new Set(project.analysis.sources.map((source) =>
    imagesByHash.get(source.sha256),
  ))];
  for (const detection of project.analysis.detections) {
    requireValue(detection.targetId == null || ids.has(detection.targetId),
        'Detection target does not exist');
  }
  project.analysis.idMap = Object.fromEntries(project.analysis.detections.map(
      (entry) => [entry.id, entry.targetId ?? null],
  ));
}

/**
 * Hash original bytes rather than the filename or encoded data URL.
 * @param {!Object} image Embedded image.
 * @return {string} SHA-256 hex digest.
 */
export function imageHash(image) {
  return createHash('sha256')
      .update(Buffer.from(image.data.split(',')[1], 'base64')).digest('hex');
}

function mergeItem(previous, incoming) {
  if (!previous) {
    return incoming;
  }
  const next = {...incoming, id: previous.id};
  for (const [key, evidence] of Object.entries(previous.evidence)) {
    if (evidence.status === 'confirmed') {
      next[key] = structuredClone(previous[key]);
      next.evidence[key] = structuredClone(evidence);
    } else if (incoming.evidence[key]) {
      next.evidence[key].history = [...(evidence.history ?? []), {
        value: structuredClone(previous[key] ?? null),
        status: evidence.status,
        note: evidence.note,
      }];
    }
  }
  if (previous.images || incoming.images) {
    next.images = [...new Map([
      ...(previous.images ?? []), ...(incoming.images ?? []),
    ].map((image) => [image.data, image])).values()];
  }
  return next;
}

/**
 * Merge a local analysis into a project, keeping stable IDs and human values.
 * Caller saves only after normalizeProject validates the entire transaction.
 * @param {!Object} project Existing project to update.
 * @param {!Object} data Caller analysis, with optional detection metadata.
 * @param {!Array<!Object>} images Local source images.
 * @param {string} kind room, furniture or object.
 * @return {!Object} Imported room or item.
 */
export function importAnalysis(project, data, images, kind) {
  const metadata = data.analysis ? normalizeAnalysis(data.analysis) : null;
  const hashes = new Set(images.map(imageHash));
  for (const source of metadata?.sources ?? []) {
    requireValue(hashes.has(source.sha256), 'Source image hash mismatch');
    const previous = project.analysis?.sources.find((entry) =>
      entry.id === source.id,
    );
    requireValue(!previous || previous.sha256 === source.sha256,
        'A source ID cannot be reused for different image bytes');
  }
  for (const detection of metadata?.detections ?? []) {
    const previous = project.analysis?.detections.find((entry) =>
      entry.id === detection.id,
    );
    requireValue(!previous || previous.imageId === detection.imageId,
        'A detection ID cannot be reused for a different source');
  }
  const oldItems = [...project.furniture, ...project.objects];
  const previousIds = new Set([
    ...oldItems, project.room, ...(project.room?.openings ?? []),
  ].filter(Boolean).map((item) => item.id));
  const remap = new Map();
  const used = new Set();
  const prepare = (raw) => {
    const detection = metadata?.detections.find((entry) =>
      entry.id === raw.sourceId,
    ) ?? metadata?.detections.find((entry) =>
      raw.id && entry.targetId === raw.id,
    );
    const previousTarget = detection
      ? project.analysis?.idMap?.[detection.id] : null;
    requireValue(detection?.decision !== 'excluded',
        'Excluded detections must remain metadata-only');
    const previous = oldItems.find((item) => item.id === previousTarget) ??
        oldItems.find((item) => item.id === raw.id) ??
        oldItems.find((item) => raw.sourceId && item.sourceId === raw.sourceId);
    const input = {...raw, images,
      sourceId: raw.sourceId ?? detection?.id ?? null};
    if (input.kind && !KINDS.includes(input.kind)) {
      input.category ??= input.kind;
      input.uncertainties = [...(input.uncertainties ?? []),
        `未対応形状 ${input.kind} を外接箱で仮表示。`];
      input.kind = 'box';
    }
    const incoming = normalizeFurniture(input);
    const next = mergeItem(previous, incoming);
    requireValue(!used.has(next.id), 'Multiple imports match the same item');
    used.add(next.id);
    remap.set(raw.id ?? incoming.id, next.id);
    if (detection) {
      detection.targetId = next.id;
    }
    return {previous, next};
  };
  let importedRoom;
  if (kind === 'room') {
    const raw = data.room ?? data;
    const previous = project.room;
    importedRoom = mergeItem(previous,
        normalizeRoom({...raw, images}));
    if (previous && previous.evidence.openings.status !== 'confirmed') {
      const openings = new Map(previous.openings.map((entry) =>
        [entry.id, entry],
      ));
      for (const opening of importedRoom.openings) {
        openings.set(opening.id, mergeItem(openings.get(opening.id), opening));
      }
      importedRoom.openings = [...openings.values()];
    }
    if (raw.id) {
      remap.set(raw.id, importedRoom.id);
    }
    project.room = importedRoom;
  }
  const groups = kind === 'room' ? [
    ['furniture', data.furniture ?? []], ['objects', data.objects ?? []],
  ] : [
    [kind === 'object' ? 'objects' : 'furniture', [data[kind] ?? data]],
  ];
  const prepared = groups.map(([key, values]) => [key, values.map(prepare)]);
  for (const [key, entries] of prepared) {
    for (const {previous, next} of entries) {
      if (next.parentId && next.evidence.parentId?.status !== 'confirmed') {
        next.parentId = remap.get(next.parentId) ?? next.parentId;
      }
      // Do not move a matched item into a second collection.
      const collection = previous
        ? (project.furniture.includes(previous) ? 'furniture' : 'objects')
        : key;
      const index = project[collection].findIndex((item) =>
        item.id === next.id,
      );
      if (index < 0) {
        project[collection].push(next);
      } else {
        project[collection][index] = next;
      }
    }
  }
  if (metadata) {
    for (const detection of metadata.detections) {
      if (!previousIds.has(detection.targetId)) {
        detection.targetId = remap.get(detection.targetId) ??
            detection.targetId ?? null;
      }
    }
    // Preserve the original answer separately from accepted/corrected fields.
    const raw = structuredClone(data);
    delete raw.analysis?.raw;
    delete raw.analysis?.runs;
    const previous = project.analysis;
    const runs = previous?.runs ?? (previous?.raw ? [previous.raw] : []);
    const serialized = JSON.stringify(raw);
    const merged = {...previous, ...metadata, raw, runs:
      runs.some((entry) => JSON.stringify(entry) === serialized)
        ? runs : [...runs, raw]};
    merged.images = [...new Map([
      ...(previous?.images ?? []), ...images,
    ].map((image) => [image.data, image])).values()];
    for (const key of ['sources', 'regions', 'detections']) {
      merged[key] = [...new Map([
        ...(previous?.[key] ?? []), ...metadata[key],
      ].map((entry) => [entry.id, entry])).values()];
    }
    project.analysis = merged;
  }
  return importedRoom ?? prepared[0][1][0].next;
}

/**
 * Keep detection provenance when its editable scene object is removed.
 * @param {!Object} project Project edited by a CLI transaction.
 * @param {string} id Removed scene ID.
 */
export function unlinkDetection(project, id) {
  for (const entry of project.analysis?.detections ?? []) {
    if (entry.targetId === id) {
      entry.targetId = null;
      entry.decision = 'pending';
      entry.reason += ' / CLIで物体を削除。画像候補として保持。';
    }
  }
}
