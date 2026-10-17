import {footprint, contained, overlap, openingGeometry} from './geometry.js';
import {corrections} from './model.js';
import {resolveItems, worldParts} from './scene.js';

const TOLERANCE = 1e-6;

function verticalOverlap(a, b) {
  return a.y + a.height > b.y + TOLERANCE &&
      b.y + b.height > a.y + TOLERANCE;
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
  const parts = new Map(ready.map((item) => [item.id, worldParts(item)]));
  for (let i = 0; i < ready.length; i++) {
    for (let j = i + 1; j < ready.length; j++) {
      if (parts.get(ready[i].id).some((a) =>
        parts.get(ready[j].id).some((b) =>
          verticalOverlap(a, b) && overlap(footprint(a), footprint(b)),
        ),
      )) {
        issue(
            'FURNITURE_OVERLAP',
            [ready[i].id, ready[j].id],
            `${ready[i].name}と${ready[j].name}が重なっています。`,
        );
      }
    }
  }
  return {
    valid: issues.length === 0 && unresolved.length === 0,
    geometryValid: issues.length === 0,
    provisional: unresolved.length > 0,
    issues,
    corrections: unresolved,
  };
}
/**
 * Create a project view with proposed placements and estimated provenance.
 * @param {!Object} project Normalized project; the input is not mutated.
 * @param {!Array<!Object>} placements IDs, x/z in mm and rotation in degrees.
 * @return {!Object} Project view; unmatched furniture retains its state.
 */
export function applyPlacements(project, placements) {
  return {
    ...project,
    furniture: project.furniture.map((furniture) => {
      const placement = placements.find(
          (candidate) => candidate.id === furniture.id,
      );
      if (!placement) {
        return furniture;
      }
      return {
        ...furniture,
        ...placement,
        evidence: {
          ...furniture.evidence,
          ...Object.fromEntries(
              ['x', 'z', 'rotation'].map((key) => [
                key,
                {
                  status: 'estimated',
                  note: '配置案の位置・回転。実位置は未確認。',
                },
              ]),
          ),
        },
      };
    }),
  };
}
