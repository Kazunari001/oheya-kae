import {AppError, requireValue} from './errors.js';
import {footprint, overlap, contained, openingGeometry} from './geometry.js';
import {id, number, object} from './model.js';
import {validate, applyPlacements, createPlacementCheck} from './validation.js';
import {movableRoots} from './scene.js';

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
      constraints = {},
    } = {},
) {
  const roots = movableRoots(project);
  object(constraints, 'constraints');
  requireValue(Object.keys(constraints).every((key) =>
    ['fixedIds', 'priorityIds', 'rotations', 'clearance'].includes(key)),
  'Unknown proposal constraint');
  const {fixedIds = [], priorityIds = [], rotations = [0, 90]} = constraints;
  const allIds = new Set([...project.furniture, ...project.objects]
      .map((item) => item.id));
  for (const [name, ids] of Object.entries({fixedIds, priorityIds})) {
    requireValue(Array.isArray(ids) && new Set(ids).size === ids.length &&
        ids.every((value) => typeof value === 'string' && allIds.has(value)),
    `${name} must contain unique existing IDs`);
  }
  requireValue(fixedIds.every((value) =>
    [...project.furniture, ...project.objects].some((item) =>
      item.id === value &&
      (!item.parentId || item.parentId === project.room?.id))),
  'Fix a root ID to keep its entire subtree fixed');
  requireValue(priorityIds.every((value) =>
    roots.some((item) => item.id === value) && !fixedIds.includes(value)),
  'Priority IDs must be movable furniture roots without a fixed constraint');
  requireValue(Array.isArray(rotations) && rotations.length > 0 &&
      rotations.length <= 12 && rotations.every((value) =>
    typeof value === 'number' && Number.isFinite(value)),
  'rotations must contain 1–12 finite angles');
  const angles = [...new Set(rotations.map((value) =>
    ((value % 360) + 360) % 360))];
  clearance = constraints.clearance ?? clearance;
  number(step, 'step', 50, 5000);
  number(clearance, 'clearance', 0, 5000);
  requireValue(Number.isInteger(count) && count >= 1 && count <= 3,
      'count must be 1–3');
  const fixed = roots.filter((item) => fixedIds.includes(item.id));
  const moving = roots.filter((item) => !fixedIds.includes(item.id));
  if (
    !project.room?.outline ||
    roots.some((furniture) =>
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
  const cells = (Math.floor((maxX - minX) / step) + 1) *
      (Math.floor((maxZ - minZ) / step) + 1);
  if (cells > 30000 || cells * angles.length * moving.length * count > 2e6) {
    throw new AppError(
        'SEARCH_TOO_LARGE',
        'Increase --step or reduce rotations/count: limit 30,000 cells ' +
        'and 2,000,000 candidate evaluations',
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
    const started = performance.now();
    let evaluated = 0;
    const mode = (k + (workPriority ? 1 : 0)) % 3;
    const priority = (item) => priorityIds.includes(item.id)
      ? priorityIds.indexOf(item.id) : priorityIds.length;
    const ordered = [...moving].sort((a, b) => {
      if (priority(a) !== priority(b)) {
        return priority(a) - priority(b);
      }
      if ((workPriority || mode === 1) &&
          (a.kind === 'desk') !== (b.kind === 'desk')) {
        return a.kind === 'desk' ? -1 : 1;
      }
      return b.width * b.depth - a.width * a.depth;
    });
    const placed = [...fixed];
    const notes = [];
    const placements = fixed.map(({id, x, z, rotation}) =>
      ({id, x, z, rotation}));
    for (const [index, furniture] of ordered.entries()) {
      const canPlace = createPlacementCheck(
          applyPlacements(project, placements), furniture.id,
          new Set(ordered.slice(index + 1).map((item) => item.id)),
      );
      let best = null;
      let bestScore = Infinity;
      for (const candidate of candidates) {
        for (const rotation of mode % 2 ? [...angles].reverse() : angles) {
          evaluated++;
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
          if (!canPlace(item)) {
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
            `${furniture.name}: NO_FEASIBLE_GRID_POSITION。` +
            '指定グリッド・回転・間隔・支持関係で候補がなく元の位置を維持。',
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
        `探索条件: ${JSON.stringify({fixedIds, priorityIds,
          rotations: angles, clearance})}`,
        `固定: ${fixedIds.join(', ') || '指定なし'}。` +
        '独立小物・壁掛け・子の相対配置は固定。',
        '家具間の間隔は通路の連結性を保証しません。人の動線・扉の開閉軌跡は実物で確認してください。',
      ],
      placements,
    };
    const signature = (entries) => JSON.stringify([...entries]
        .sort((a, b) => a.id.localeCompare(b.id)));
    const duplicate = results.find((entry) =>
      signature(entry.placements) === signature(placements));
    if (duplicate) {
      proposal.notes.push(`DUPLICATE: ${duplicate.id}と同じ配置です。`);
    }
    results.push({
      ...proposal,
      search: {elapsedMs: performance.now() - started, evaluated,
        movableCount: moving.length, gridCells: cells},
      validation: validate(applyPlacements(project, placements)),
    });
  }
  return results;
}
