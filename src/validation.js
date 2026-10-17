import {footprint, contained, overlap, openingGeometry} from './geometry.js';
import {corrections} from './model.js';

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
  const ready = project.furniture.filter((furniture) => {
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
    if (room?.height != null && furniture.height > room.height) {
      issue(
          'ABOVE_CEILING',
          [furniture.id],
          `${furniture.name}が天井高を超えています。`,
      );
    }
    for (const opening of room?.openings ?? []) {
      if (
        opening.type === 'door' &&
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
  for (let i = 0; i < ready.length; i++) {
    for (let j = i + 1; j < ready.length; j++) {
      if (overlap(footprint(ready[i]), footprint(ready[j]))) {
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
