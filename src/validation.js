import {footprint, contained, overlap, openingGeometry} from './geometry.js';
import {corrections, revise} from './model.js';
import {resolveItems, worldParts, movableRoots} from './scene.js';

const TOLERANCE = 1e-6;

function verticalOverlap(a, b) {
  return a.y + a.height > b.y + TOLERANCE &&
      b.y + b.height > a.y + TOLERANCE;
}

function partOf(child, parent, lookup) {
  while (child?.attachment === 'part') {
    if (child.parentId === parent.id) {
      return true;
    }
    child = lookup.get(child.parentId);
  }
  return false;
}

function withBounds(part, polygon) {
  const xs = polygon.map(([x]) => x);
  const zs = polygon.map(([, z]) => z);
  return {...part, polygon, bounds: {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
  }};
}

function occupiedParts(item) {
  return worldParts(item).map((part) => withBounds(part, footprint(part)));
}

function partsOverlap(first, second) {
  return first.some((a) => second.some((b) =>
    verticalOverlap(a, b) &&
    a.bounds.minX < b.bounds.maxX && b.bounds.minX < a.bounds.maxX &&
    a.bounds.minZ < b.bounds.maxZ && b.bounds.minZ < a.bounds.maxZ &&
    overlap(a.polygon, b.polygon),
  ));
}

function descendants(ids, items) {
  const children = new Map();
  for (const item of items) {
    if (!children.has(item.parentId)) {
      children.set(item.parentId, []);
    }
    children.get(item.parentId).push(item.id);
  }
  const result = new Set(ids);
  for (const id of result) {
    for (const child of children.get(id) ?? []) {
      result.add(child);
    }
  }
  return result;
}

/**
 * Cache fixed geometry and validate only a rigidly moving floor-root subtree.
 * Supports and internal collisions are invariant under horizontal movement.
 * @param {!Object} project Current placements with normalized local geometry.
 * @param {string} rootId Floor-level furniture root to move.
 * @param {!Set<string>} ignored Root IDs still waiting to be placed.
 * @return {function(!Object): boolean} Geometry-only x/z and rotation check.
 */
export function createPlacementCheck(project, rootId, ignored = new Set()) {
  const items = resolveItems(project);
  const lookup = new Map(items.map((item) => [item.id, item]));
  const root = lookup.get(rootId);
  if (!root || root.parentId || root.y !== 0) {
    throw new Error('Placement checks require a floor-level root');
  }
  const movingIds = descendants([rootId], items);
  const ignoredIds = descendants(ignored, items);
  const moving = items.filter((item) => movingIds.has(item.id));
  const ready = (item) =>
    [item.width, item.depth, item.height, item.y].every((v) => v != null);
  let invalid = moving.some((item) => !ready(item) ||
      (project.room?.height != null &&
          item.y + item.height > project.room.height));
  if (invalid) {
    return () => false;
  }
  for (const item of moving) {
    checkSupport(project, item, lookup, () => {
      invalid = true;
    });
  }
  const parts = new Map(moving.map((item) =>
    [item.id, occupiedParts(item)],
  ));
  for (let i = 0; i < moving.length; i++) {
    for (let j = i + 1; j < moving.length; j++) {
      if (!partOf(moving[i], moving[j], lookup) &&
          !partOf(moving[j], moving[i], lookup) &&
          partsOverlap(parts.get(moving[i].id), parts.get(moving[j].id))) {
        invalid = true;
      }
    }
  }
  if (invalid) {
    return () => false;
  }
  const obstacles = items.filter((item) => ready(item) &&
      !movingIds.has(item.id) && !ignoredIds.has(item.id))
      .flatMap(occupiedParts);
  const doors = (project.room?.openings ?? [])
      .filter((opening) => opening.type === 'door')
      .map((opening) => ({...opening,
        polygon: openingGeometry(project.room, opening).zone}));
  const relative = (polygon) => polygon.map(([x, z]) =>
    [x - root.x, z - root.z],
  );
  const envelopes = moving.map((item) => ({...item,
    polygon: relative(footprint(item))}));
  const solids = [...parts.values()].flat().map((part) => ({...part,
    polygon: relative(part.polygon)}));
  return (placement) => {
    const radians = (placement.rotation - root.rotation) * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const transform = (polygon) => polygon.map(([x, z]) => [
      placement.x + x * cosine + z * sine,
      placement.z - x * sine + z * cosine,
    ]);
    for (const item of envelopes) {
      const polygon = transform(item.polygon);
      if ((project.room?.outline &&
          !contained(polygon, project.room.outline)) ||
          doors.some((door) =>
            item.y < door.sill + door.height - TOLERANCE &&
            item.y + item.height > TOLERANCE && overlap(polygon, door.polygon),
          )) {
        return false;
      }
    }
    return !solids.some((part) => partsOverlap([
      withBounds(part, transform(part.polygon)),
    ], obstacles));
  };
}

function wallAttachmentFits(room, item) {
  const start = room.outline[item.wall];
  const end = room.outline[(item.wall + 1) % room.outline.length];
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.hypot(dx, dz);
  const polygon = footprint(item);
  const distances = polygon.map(([x, z]) =>
    Math.abs((x - start[0]) * dz - (z - start[1]) * dx) / length,
  );
  return Math.min(...distances) <= TOLERANCE && polygon.every(([x, z]) => {
    const along = ((x - start[0]) * dx + (z - start[1]) * dz) / length;
    return along >= -TOLERANCE && along <= length + TOLERANCE;
  });
}

function checkSupport(project, item, lookup, issue) {
  if (item.y < -TOLERANCE) {
    issue('BELOW_FLOOR', [item.id], `${item.name}が床にめり込んでいます。`);
  }
  if (!item.parentId) {
    if (item.y > TOLERANCE) {
      issue('UNSUPPORTED_ELEVATION', [item.id],
          `${item.name}の設置高さに支持物がありません。`);
    }
    return;
  }
  if (item.attachment === 'wall') {
    if (!wallAttachmentFits(project.room, item)) {
      issue('WALL_ATTACHMENT_INVALID', [item.id],
          `${item.name}が指定した壁面に接していません。`);
    }
    return;
  }
  const parent = lookup.get(item.parentId);
  const parentDimensions = [parent.width, parent.depth, parent.height];
  if (parentDimensions.some((value) => value == null)) {
    issue('SUPPORT_UNKNOWN', [item.id, parent.id],
        `${item.name}の支持物の寸法が不足しています。`);
    return;
  }
  const surface = item.surfaceId
    ? parent.supports.find((entry) => entry.id === item.surfaceId)
    : {x: 0, z: 0, y: parent.height, width: parent.width, depth: parent.depth};
  const localFootprint = footprint({...item, ...item.local});
  const target = item.attachment === 'part'
    ? {x: 0, z: 0, width: parent.width, depth: parent.depth, rotation: 0}
    : {...surface, rotation: 0};
  if (!contained(localFootprint, footprint(target))) {
    issue('OUTSIDE_SUPPORT', [item.id, parent.id],
        `${item.name}が支持物からはみ出しています。`);
  }
  if (item.attachment !== 'part' &&
      Math.abs(item.local.y - surface.y) > TOLERANCE) {
    issue('OFF_SUPPORT_SURFACE', [item.id, parent.id],
        `${item.name}の底面が支持面に接していません。`);
  }
  if (['inside', 'part'].includes(item.attachment) &&
      (item.local.y < 0 || item.local.y + item.height > parent.height)) {
    issue('OUTSIDE_PARENT_HEIGHT', [item.id, parent.id],
        `${item.name}が親物体の高さの範囲を超えています。`);
  }
}

/**
 * Check footprint containment, overlap, door clearance and ceiling height.
 * @param {!Object} project Normalized project; geometric lengths are in mm.
 * @return {!Object} Geometry issues and outstanding provenance corrections.
 */
export function validate(project) {
  const issues = [];
  const unresolved = corrections(project);
  const room = project.room;
  const issue = (code, objectIds, message) =>
    issues.push({code, objectIds, message});
  if (!room?.outline) {
    issue(
        'ROOM_UNKNOWN',
        room ? [room.id] : [],
        '部屋の輪郭が未確定です。',
    );
  }
  const items = resolveItems(project);
  const lookup = new Map(items.map((item) => [item.id, item]));
  const ready = items.filter((furniture) => {
    if (
      furniture.width == null ||
      furniture.depth == null ||
      furniture.height == null
    ) {
      issue(
          'DIMENSIONS_UNKNOWN',
          [furniture.id],
          '家具の寸法が不足しています。',
      );
      return false;
    }
    if (furniture.y == null) {
      issue('POSITION_UNKNOWN', [furniture.id], '設置高さが未確定です。');
      return false;
    }
    return true;
  });
  for (const furniture of ready) {
    const footprintPolygon = footprint(furniture);
    if (
      room?.outline &&
      !contained(footprintPolygon, room.outline)
    ) {
      issue(
          'OUTSIDE_ROOM',
          [furniture.id],
          `${furniture.name}が部屋からはみ出しています。`,
      );
    }
    if (room?.height != null &&
        furniture.y + furniture.height > room.height) {
      issue(
          'ABOVE_CEILING',
          [furniture.id],
          `${furniture.name}が天井高を超えています。`,
      );
    }
    checkSupport(project, furniture, lookup, issue);
    for (const opening of room?.openings ?? []) {
      if (
        opening.type === 'door' &&
        furniture.y < opening.sill + opening.height - TOLERANCE &&
        furniture.y + furniture.height > TOLERANCE &&
        overlap(
            footprintPolygon,
            openingGeometry(room, opening).zone,
        )
      ) {
        issue(
            'DOOR_BLOCKED',
            [furniture.id, opening.id],
            `${furniture.name}がドア前の必要空間と重なっています。`,
        );
      }
    }
  }
  const parts = new Map(ready.map((item) => [item.id, occupiedParts(item)]));
  for (let i = 0; i < ready.length; i++) {
    for (let j = i + 1; j < ready.length; j++) {
      if (partOf(ready[i], ready[j], lookup) ||
          partOf(ready[j], ready[i], lookup)) {
        continue;
      }
      if (partsOverlap(parts.get(ready[i].id), parts.get(ready[j].id))) {
        issue(
            'FURNITURE_OVERLAP',
            [ready[i].id, ready[j].id],
            `${ready[i].name}と${ready[j].name}が重なっています。`,
        );
      }
    }
  }
  const detectionChecks = (project.analysis?.detections ?? []).filter((entry) =>
    entry.decision !== 'excluded' && (entry.decision === 'pending' ||
        ['presenceProbability', 'boxConfidence', 'categoryConfidence'].some(
            (key) => entry[key] != null && entry[key] < 0.6,
        )),
  );
  return {
    valid: issues.length === 0 && unresolved.length === 0 &&
        detectionChecks.length === 0,
    geometryValid: issues.length === 0,
    provisional: unresolved.length > 0 || detectionChecks.length > 0,
    issues,
    corrections: unresolved,
    correctionGroups: correctionGroups(unresolved),
    detectionChecks,
    counts: {
      detected: project.analysis?.detections.length ?? items.length,
      displayed: ready.length,
      unplaced: items.length - ready.length,
      imageOnly: project.analysis?.detections.filter((entry) =>
        !entry.targetId,
      ).length ?? 0,
    },
  };
}

function correctionGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const field = entry.path.split('.').at(-1);
    const type = ['width', 'depth', 'height', 'outline', 'supports',
      'x', 'y', 'z', 'rotation', 'offset', 'sill'].includes(field)
      ? 'measurement' : 'attribute';
    const key = `${entry.objectId ?? 'room'}:${type}`;
    if (!groups.has(key)) {
      groups.set(key, {objectId: entry.objectId, type, entries: []});
    }
    groups.get(key).entries.push(entry);
  }
  return [...groups.values()];
}
/**
 * Create a project view with proposed placements and estimated provenance.
 * @param {!Object} project Normalized project; the input is not mutated.
 * @param {!Array<!Object>} placements IDs, x/z in mm and rotation in degrees.
 * @return {!Object} Project view; unmatched furniture retains its state.
 */
export function applyPlacements(project, placements) {
  const allowed = new Set(movableRoots(project).map((item) => item.id));
  return {
    ...project,
    furniture: project.furniture.map((furniture) => {
      const placement = placements.find(
          (candidate) => candidate.id === furniture.id,
      );
      if (!placement || !allowed.has(furniture.id)) {
        return furniture;
      }
      if (['x', 'z', 'rotation'].every((key) =>
        placement[key] === furniture[key])) {
        return furniture;
      }
      const next = {
        ...furniture,
        ...placement,
        evidence: {...furniture.evidence},
      };
      revise(next, furniture, ['x', 'z', 'rotation'], 'estimated',
          '配置案の位置・回転。実位置は未確認。');
      return next;
    }),
  };
}
