import {randomUUID} from 'node:crypto';
import {requireValue} from './errors.js';
import {simplePolygon, openingGeometry} from './geometry.js';

export const STATUSES = [
  'estimated',
  'image',
  'confirmed',
  'unknown',
];
export const KINDS = [
  'box',
  'desk',
  'table',
  'chair',
  'sofa',
  'bed',
  'shelf',
  'cabinet',
];
/**
 * Generate a prefixed identifier for a newly created model object.
 * @param {string} prefix Object kind, such as room or furniture.
 * @return {string} Prefix followed by an eight-character UUID fragment.
 */
export const id = (prefix) =>
  `${prefix}-${randomUUID().slice(0, 8)}`;
/**
 * Create a fresh editable project with no known room geometry.
 * @return {!Object} Version 1 project using millimeters.
 */
export const emptyProject = () => ({
  version: 1,
  units: 'mm',
  room: null,
  furniture: [],
  proposals: [],
});
/**
 * Require a non-null object that is not an array.
 * @param {*} value Candidate input.
 * @param {string} label Field name used in validation errors.
 * @return {!Object} The original validated value.
 * @throws {AppError} If the value is not an object.
 */
export function object(value, label) {
  requireValue(
      value && typeof value === 'object' && !Array.isArray(value),
      `${label} must be an object`,
  );
  return value;
}
/**
 * Require a finite number within inclusive bounds.
 * @param {*} value Candidate input; no string coercion is performed.
 * @param {string} label Field name used in validation errors.
 * @param {number} min Inclusive minimum in the field's unit.
 * @param {number} max Inclusive maximum in the field's unit.
 * @return {number} The original validated number.
 * @throws {AppError} If the value is invalid or outside the bounds.
 */
export function number(value, label, min = -1e7, max = 1e7) {
  requireValue(
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max,
      `${label} must be a finite number between ${min} and ${max}`,
  );
  return value;
}
function dimension(value, label) {
  return value == null ? null : number(value, label, 1, 1e6);
}
function string(value, label) {
  requireValue(
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= 4000,
      `${label} must be a non-empty string`,
  );
  return value;
}
function identifier(value) {
  requireValue(
      typeof value === 'string' &&
      /^[a-zA-Z0-9_-]{1,100}$/.test(value),
      'IDs must contain only letters, digits, underscores ' +
      'and hyphens',
  );
  return value;
}
function notes(value = []) {
  requireValue(
      Array.isArray(value),
      'uncertainties must be an array',
  );
  return value.map((n) => string(n, 'uncertainty'));
}
function images(value = []) {
  requireValue(Array.isArray(value), 'images must be an array');
  return value.map((i) => {
    object(i, 'image');
    requireValue(
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
            i.data,
        ),
        'image must be a PNG, JPEG or WebP data URL',
    );
    return {name: string(i.name, 'image name'), data: i.data};
  });
}
/**
 * Attach provenance while preventing imported data from claiming confirmation.
 * @param {!Object} fields Field values to describe.
 * @param {!Object} input Caller-supplied evidence by field name.
 * @param {string} fallback Status for fields without explicit evidence.
 * @param {boolean} trusted Whether human-confirmed provenance may survive.
 * @return {!Object} Evidence with unknown status for null measurements.
 */
function evidenceFor(
    fields,
    input = {},
    fallback = 'estimated',
    trusted = false,
) {
  object(input, 'evidence');
  const result = {};
  for (const [field, value] of Object.entries(fields)) {
    const fieldEvidence = input[field] ?? {};
    object(fieldEvidence, `evidence.${field}`);
    let status = fieldEvidence.status ?? fallback;
    requireValue(
        STATUSES.includes(status),
        `Invalid evidence status for ${field}`,
    );
    if (!trusted && status === 'confirmed') {
      status = 'estimated';
    }
    if (value == null) {
      status = 'unknown';
    }
    // A numeric preview can carry an unknown status (e.g. a default placement).
    result[field] = {
      status,
      note:
        typeof fieldEvidence.note === 'string'
          ? fieldEvidence.note
          : '',
    };
  }
  return result;
}
/**
 * Validate furniture while preserving unknown measurements and provenance.
 * @param {!Object} raw Partial furniture: lengths in mm, rotation in degrees.
 * @param {!Object} options Trust flag and fallback evidence status.
 * @return {!Object} Normalized furniture with preview placement defaults.
 * @throws {AppError} If any supplied attribute is invalid.
 */
export function normalizeFurniture(
    raw,
    {trusted = false, fallback = 'estimated'} = {},
) {
  object(raw, 'furniture');
  const furniture = {
    id: identifier(raw.id ?? id('furniture')),
    name:
      raw.name == null ? '未確認の家具' : string(raw.name, 'name'),
    kind: raw.kind ?? 'box',
    color: raw.color ?? '#a5a8ad',
    width: dimension(raw.width, 'width'),
    depth: dimension(raw.depth, 'depth'),
    height: dimension(raw.height, 'height'),
    x: number(raw.x ?? 0, 'x'),
    z: number(raw.z ?? 0, 'z'),
    rotation: number(raw.rotation ?? 0, 'rotation') % 360,
    images: images(raw.images),
    uncertainties: notes(raw.uncertainties),
  };
  requireValue(
      KINDS.includes(furniture.kind),
      `kind must be one of ${KINDS.join(', ')}`,
  );
  requireValue(
      typeof furniture.color === 'string' &&
      /^#[0-9a-fA-F]{6}$/.test(furniture.color),
      'color must be #RRGGBB',
  );
  furniture.evidence = evidenceFor(
      Object.fromEntries(
          [
            'name',
            'kind',
            'color',
            'width',
            'depth',
            'height',
            'x',
            'z',
            'rotation',
          ].map((key) => [key, furniture[key]]),
      ),
      raw.evidence,
      fallback,
      trusted,
  );
  for (const key of ['x', 'z', 'rotation']) {
    if (raw[key] == null) {
      furniture.evidence[key] = {
        status: 'unknown',
        note: '表示用の仮配置。実位置を入力してください。',
      };
    }
  }
  for (const key of ['name', 'kind', 'color']) {
    if (raw[key] == null) {
      furniture.evidence[key] = {
        status: 'unknown',
        note: '表示用の仮値。確認してください。',
      };
    }
  }
  return furniture;
}
/**
 * Validate a room outline, openings and evidence without inventing dimensions.
 * @param {!Object} raw Partial room; lengths and [x, z] vertices are in mm.
 * @param {!Object} options Trust flag and fallback evidence status.
 * @return {!Object} Normalized room with non-overlapping valid openings.
 * @throws {AppError} If geometry, opening bounds or attributes are invalid.
 */
export function normalizeRoom(
    raw,
    {trusted = false, fallback = 'estimated'} = {},
) {
  object(raw, 'room');
  let outline = raw.outline ?? null;
  if (outline != null) {
    requireValue(
        Array.isArray(outline) &&
        outline.length >= 3 &&
        outline.length <= 200,
        'outline must contain 3–200 [x,z] points',
    );
    outline = outline.map((project) => {
      requireValue(
          Array.isArray(project) && project.length === 2,
          'Each outline point must be [x,z]',
      );
      return project.map((value) =>
        number(value, 'outline coordinate'),
      );
    });
    requireValue(
        simplePolygon(outline),
        'outline must be a simple polygon without crossings ' +
        'or zero-length edges',
    );
  }
  const room = {
    id: identifier(raw.id ?? id('room')),
    name: raw.name == null ? '部屋' : string(raw.name, 'name'),
    outline,
    height: dimension(raw.height, 'height'),
    openings: [],
    images: images(raw.images),
    uncertainties: notes(raw.uncertainties),
  };
  requireValue(
      Array.isArray(raw.openings ?? []),
      'openings must be an array',
  );
  room.openings = (raw.openings ?? []).map((item) => {
    object(item, 'opening');
    const opening = {
      id: identifier(item.id ?? id('opening')),
      type: item.type,
      wall: number(item.wall, 'wall', 0, 199),
      offset: number(item.offset, 'offset', 0),
      width: dimension(item.width, 'opening width'),
      height: dimension(item.height, 'opening height'),
      sill: number(item.sill ?? 0, 'sill', 0, 1e6),
      clearance: number(
          item.clearance ?? item.width ?? 900,
          'clearance',
          1,
          1e6,
      ),
    };
    requireValue(
        ['door', 'window'].includes(opening.type),
        'opening type must be door or window',
    );
    requireValue(
        outline &&
        Number.isInteger(opening.wall) &&
        opening.wall < outline.length,
        'opening wall must refer to a room edge',
    );
    requireValue(
        opening.width != null && opening.height != null,
        'Opening width and height are required; list ' +
        'unlocated openings in uncertainties',
    );
    requireValue(
        opening.offset + opening.width <=
        openingGeometry(room, opening).length + 1e-6,
        'opening extends beyond its wall',
    );
    requireValue(
        room.height == null ||
        opening.sill + opening.height <= room.height,
        'opening extends above room height',
    );
    opening.evidence = evidenceFor(
        Object.fromEntries(
            [
              'type',
              'wall',
              'offset',
              'width',
              'height',
              'sill',
              'clearance',
            ].map((key) => [key, opening[key]]),
        ),
        item.evidence,
        fallback,
        trusted,
    );
    for (const key of ['sill', 'clearance']) {
      if (item[key] == null) {
        opening.evidence[key] = {
          status: 'estimated',
          note: '初期値。実寸を確認してください。',
        };
      }
    }
    return opening;
  });
  requireValue(
      new Set(room.openings.map((item) => item.id)).size ===
          room.openings.length,
      'Duplicate opening IDs',
  );
  for (let i = 0; i < room.openings.length; i++) {
    for (let j = i + 1; j < room.openings.length; j++) {
      const a = room.openings[i];
      const b = room.openings[j];
      requireValue(
          a.wall !== b.wall ||
          a.offset + a.width <= b.offset ||
          b.offset + b.width <= a.offset ||
          a.sill + a.height <= b.sill ||
          b.sill + b.height <= a.sill,
          'Openings overlap on the same wall',
      );
    }
  }
  room.evidence = evidenceFor(
      {
        name: room.name,
        outline: room.outline,
        height: room.height,
        openings: room.openings,
      },
      raw.evidence,
      fallback,
      trusted,
  );
  if (raw.openings == null) {
    room.evidence.openings = {
      status: 'unknown',
      note: '開口部の有無は未確認。',
    };
  }
  return room;
}
/**
 * Validate saved state, preserving trusted evidence and proposal references.
 * @param {!Object} raw Version 1 project using millimeters.
 * @return {!Object} Normalized state with unique object and proposal IDs.
 * @throws {AppError} If the state or any proposal reference is invalid.
 */
export function normalizeProject(raw) {
  object(raw, 'project');
  requireValue(
      raw.version === 1 && raw.units === 'mm',
      'Unsupported project version or units',
  );
  requireValue(
      Array.isArray(raw.furniture) &&
      Array.isArray(raw.proposals ?? []),
      'furniture/proposals must be arrays',
  );
  const project = {
    version: 1,
    units: 'mm',
    room:
      raw.room == null
        ? null
        : normalizeRoom(raw.room, {trusted: true}),
    furniture: raw.furniture.map((furniture) =>
      normalizeFurniture(furniture, {trusted: true}),
    ),
    proposals: [],
  };
  requireValue(
      new Set(project.furniture.map((furniture) => furniture.id))
          .size === project.furniture.length,
      'Duplicate furniture IDs',
  );
  project.proposals = (raw.proposals ?? []).map((value) => {
    object(value, 'proposal');
    requireValue(
        Array.isArray(value.placements),
        'proposal placements must be an array',
    );
    const ids = new Set();
    const placements = value.placements.map((furniture) => {
      object(furniture, 'placement');
      requireValue(
          project.furniture.some(
              (item) => item.id === furniture.id,
          ) && !ids.has(furniture.id),
          'Invalid or duplicate proposal furniture ID',
      );
      ids.add(furniture.id);
      return {
        id: furniture.id,
        x: number(furniture.x, 'x'),
        z: number(furniture.z, 'z'),
        rotation: number(furniture.rotation, 'rotation') % 360,
      };
    });
    requireValue(
        ids.size === project.furniture.length,
        'A proposal must place every furniture item',
    );
    return {
      id: identifier(value.id),
      name: string(value.name, 'proposal name'),
      intent: string(value.intent, 'intent'),
      notes: notes(value.notes),
      placements,
    };
  });
  requireValue(
      new Set(project.proposals.map((value) => value.id)).size ===
          project.proposals.length,
      'Duplicate proposal IDs',
  );
  return project;
}
/**
 * Collect fields and uncertainties that still need human confirmation.
 * @param {!Object} project Normalized project.
 * @return {!Array<!Object>} Correction paths, statuses and explanatory notes.
 */
export function corrections(project) {
  const result = [];
  function scan(item, base) {
    for (const [field, fieldEvidence] of Object.entries(
        item.evidence,
    )) {
      if (fieldEvidence.status !== 'confirmed') {
        result.push({
          objectId: item.id,
          path: `${base}.${field}`,
          status: fieldEvidence.status,
          note: fieldEvidence.note,
        });
      }
    }
    for (const note of item.uncertainties ?? []) {
      result.push({
        objectId: item.id,
        path: base,
        status: 'unknown',
        note,
      });
    }
  }
  if (project.room) {
    scan(project.room, 'room');
    for (const item of project.room.openings) {
      scan(item, `room.openings.${item.id}`);
    }
  } else {
    result.push({
      path: 'room',
      status: 'unknown',
      note: '部屋を作成してください。',
    });
  }
  for (const furniture of project.furniture) {
    scan(furniture, `furniture.${furniture.id}`);
  }
  return result;
}
/**
 * Mark supplied non-null fields confirmed; null fields remain unknown.
 * @param {!Object} item Normalized object whose evidence is mutated.
 * @param {!Array<string>} keys Field names explicitly entered or checked.
 * @return {void}
 */
export function confirmed(item, keys) {
  for (const key of keys) {
    item.evidence[key] = {
      status: item[key] == null ? 'unknown' : 'confirmed',
      note: 'CLIで入力・確認済み。',
    };
  }
}
