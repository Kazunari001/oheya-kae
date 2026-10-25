import {revise} from './model.js';

/**
 * Scale selected roots and all descendants, retaining local relationships.
 * @param {!Object} project Normalized project, mutated in place.
 * @param {!Array<string>} rootIds Roots to calibrate.
 * @param {number} factor Positive scale factor.
 * @param {boolean} horizontal Whether to leave vertical geometry unchanged.
 * @param {boolean} moveRoots Whether root positions scale about the origin.
 * @return {!Array<string>} IDs changed, including descendants.
 */
export function scaleItems(project, rootIds, factor, horizontal, moveRoots) {
  const items = [...project.furniture, ...project.objects];
  const roots = new Set(rootIds);
  const selected = new Set(rootIds);
  // Parent order is arbitrary; expand until the entire subtree is selected.
  for (let size = -1; size !== selected.size;) {
    size = selected.size;
    for (const item of items) {
      if (selected.has(item.parentId)) {
        selected.add(item.id);
      }
    }
  }
  for (const item of items.filter((entry) => selected.has(entry.id))) {
    const previous = structuredClone(item);
    const keys = ['width', 'depth'];
    if (!horizontal) {
      keys.push('height', 'frameThickness');
    }
    if (moveRoots || !roots.has(item.id)) {
      keys.push('x', 'z');
      if (!horizontal) {
        keys.push('y');
      }
    }
    for (const key of keys) {
      if (item[key] != null) {
        item[key] *= factor;
        revise(item, previous, [key], 'estimated', '親子関係を保って縮尺補正。');
      }
    }
    if (item.supports.length) {
      item.supports = item.supports.map((surface) => {
        const next = {...surface};
        const fields = ['x', 'z', 'width', 'depth'];
        if (!horizontal) {
          fields.push('y', 'thickness');
        }
        for (const field of fields) {
          next[field] *= factor;
        }
        return next;
      });
      revise(item, previous, ['supports'], 'estimated', '支持面も比例補正。');
    }
  }
  return [...selected];
}
