import {AppError} from './errors.js';
import {footprint, overlap, contained, openingGeometry} from './geometry.js';
import {id} from './model.js';
import {validate, applyPlacements} from './validation.js';

// Deterministic grid packing, not an optimal solver. Never call a failed

// packing valid.
/**
 * Generate deterministic grid candidates and validate every resulting layout.
 * Failed placements retain their original position and include a note.
 * @param {!Object} project Room outline and furniture dimensions in mm.
 * @param {!Object} options Preference, count, grid step and clearance in mm.
 * @return {!Array<!Object>} Proposals with placements and validation reports.
 * @throws {AppError} If geometry is incomplete or the grid exceeds 30k cells.
 */
export function propose(
    project,
    {
      preference = '通路を広く',
      count = 3,
      step = 200,
      clearance = 400,
    } = {},
) {
  if (
    !project.room?.outline ||
    project.furniture.some((furniture) =>
      [furniture.width, furniture.depth, furniture.height].some(
          (v) => v == null,
      ),
    )
  ) {
    throw new AppError(
        'INCOMPLETE_GEOMETRY',
        'Room outline and all furniture dimensions are ' +
        'required for proposals',
    );
  }
  const xs = project.room.outline.map((v) => v[0]);
  const zs = project.room.outline.map((v) => v[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  if (((maxX - minX) * (maxZ - minZ)) / step ** 2 > 30000) {
    throw new AppError(
        'SEARCH_TOO_LARGE',
        'Increase --step to limit the grid to 30,000 cells',
    );
  }
  const doors = project.room.openings
      .filter((opening) => opening.type === 'door')
      .map((opening) => openingGeometry(project.room, opening).zone);
  const candidates = [];
  for (let x = minX; x <= maxX; x += step) {
    for (let z = minZ; z <= maxZ; z += step) {
      candidates.push({x, z});
    }
  }
  const modes = [
    '周囲を活用',
    '仕事スペース優先',
    '入口からの通路を確保',
  ];
  const workPriority = /仕事|ワーク|work|desk/i.test(preference);
  const results = [];
  for (let k = 0; k < count; k++) {
    const mode = (k + (workPriority ? 1 : 0)) % 3;
    const ordered = [...project.furniture].sort((a, b) =>
      (workPriority || mode === 1) &&
      (a.kind === 'desk') !== (b.kind === 'desk')
        ? a.kind === 'desk'
          ? -1
          : 1
        : b.width * b.depth - a.width * a.depth,
    );
    const placed = [];
    const notes = [];
    const placements = [];
    for (const furniture of ordered) {
      let best = null;
      let bestScore = Infinity;
      for (const candidate of candidates) {
        for (const rotation of mode % 2 ? [90, 0] : [0, 90]) {
          const item = {...furniture, ...candidate, rotation};
          const footprintPolygon = footprint(item);
          if (
            !contained(footprintPolygon, project.room.outline) ||
            doors.some((d) => overlap(footprintPolygon, d)) ||
            placed.some((placedFurniture) =>
              overlap(
                  footprint(item, clearance / 2),
                  footprint(placedFurniture, clearance / 2),
              ),
            )
          ) {
            continue;
          }
          // Keep the center open; alternate the preferred wall/corner. Work
          // mode
          // biases desks toward a window when a located window is available.
          let score =
            Math.min(
                candidate.x - minX,
                maxX - candidate.x,
                candidate.z - minZ,
                maxZ - candidate.z,
            ) +
            (mode === 2
              ? maxX - candidate.x + maxZ - candidate.z
              : candidate.x - minX + candidate.z - minZ) *
              0.03;
          if (
            (workPriority || mode === 1) &&
            furniture.kind === 'desk'
          ) {
            const windows = project.room.openings
                .filter((opening) => opening.type === 'window')
                .map((opening) =>
                  openingGeometry(project.room, opening),
                );
            if (windows.length) {
              score = Math.min(
                  ...windows.map((w) =>
                    Math.hypot(
                        candidate.x - (w.start[0] + w.end[0]) / 2,
                        candidate.z - (w.start[1] + w.end[1]) / 2,
                    ),
                  ),
              );
            }
          }
          if (score < bestScore) {
            best = item;
            bestScore = score;
          }
        }
      }
      if (!best) {
        notes.push(
            `${furniture.name}は指定した間隔で配置できず、元の位置を維持しています。`,
        );
        best = furniture;
      }
      placed.push(best);
      placements.push({
        id: furniture.id,
        x: best.x,
        z: best.z,
        rotation: best.rotation,
      });
    }
    const proposal = {
      id: id('proposal'),
      name: modes[mode],
      intent:
        `${preference}` +
        '。' +
        `${workPriority ? 'デスクを先に配置し、窓に近い位置を優先。' : ''}` +
        '家具間に' +
        `${clearance}` +
        'mmの間隔を試みるグリッド探索。',
      notes: [
        ...notes,
        '家具間の間隔は通路の連結性を保証しません。人の動線・扉の開閉軌跡は実物で確認してください。',
      ],
      placements,
    };
    results.push({
      ...proposal,
      validation: validate(applyPlacements(project, placements)),
    });
  }
  return results;
}
