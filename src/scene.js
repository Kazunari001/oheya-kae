/**
 * Resolve parent-relative mm coordinates without Node.js or DOM dependencies.
 * Null elevation propagates to descendants and must not become a measured zero.
 * @param {!Object} project Room, furniture and objects.
 * @return {!Array<!Object>} World-space items with original local coordinates.
 */
export function resolveItems(project) {
  const items = [...project.furniture, ...(project.objects ?? [])];
  const lookup = new Map(items.map((item) => [item.id, item]));
  const resolved = new Map();
  const visiting = new Set();
  function resolve(item) {
    if (resolved.has(item.id)) {
      return resolved.get(item.id);
    }
    if (visiting.has(item.id)) {
      throw new Error('Cyclic scene parent relationship');
    }
    visiting.add(item.id);
    const parent = item.parentId && item.parentId !== project.room?.id
      ? lookup.get(item.parentId)
      : null;
    if (item.parentId && item.parentId !== project.room?.id && !parent) {
      throw new Error(`Missing scene parent: ${item.parentId}`);
    }
    const worldParent = parent ? resolve(parent) : null;
    const local = {
      x: item.x, y: item.y === undefined ? 0 : item.y,
      z: item.z, rotation: item.rotation,
    };
    const position = worldParent
      ? transformPoint(worldParent, local)
      : local;
    const world = {
      ...item, ...position, local,
      rotation: local.rotation + (worldParent?.rotation ?? 0),
    };
    visiting.delete(item.id);
    resolved.set(item.id, world);
    return world;
  }
  return items.map(resolve);
}

/**
 * Transform a local position by a parent's positive Three.js Y rotation.
 * @param {!Object} parent World x/y/z in mm and rotation in degrees.
 * @param {!Object} point Local x/y/z in mm.
 * @return {!Object} World x/y/z, preserving unknown elevation.
 */
export function transformPoint(parent, point) {
  const radians = parent.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: parent.x + point.x * cosine + point.z * sine,
    y: parent.y == null || point.y == null ? null : parent.y + point.y,
    z: parent.z - point.x * sine + point.z * cosine,
  };
}

/**
 * Return solid local boxes, distinguishing an open shelf from its envelope.
 * Supports describe board TOP elevations; each board occupies y-thickness..y.
 * @param {!Object} item Dimensions in mm, optional supports and frameThickness.
 * @return {!Array<!Object>} Local boxes with bottom y and center x/z in mm.
 */
export function solidParts(item) {
  const {width, depth, height} = item;
  const box = (x, y, z, w, h, d) => ({
    x, y, z, width: w, height: h, depth: d, rotation: 0,
  });
  if (item.kind === 'clothes_rack') {
    const t = Math.min(item.frameThickness, width / 4, depth / 4, height / 4);
    return [
      box(0, height - t, 0, width, t, t),
      ...[-1, 1].flatMap((side) => [
        box(side * (width - t) / 2, 0, 0, t, height, t),
        box(side * (width - t) / 2, 0, 0, t, t, depth),
      ]),
    ];
  }
  if (item.kind === 'books') {
    return Array.from({length: 5}, (_, index) => box(
        -width / 2 + width * (index + 0.5) / 5, 0, 0,
        width / 5 * 0.96, height * (index % 2 ? 0.9 : 1), depth,
    ));
  }
  if (item.kind === 'screen') {
    const base = Math.min(30, height / 10);
    return [
      box(0, height * 0.2, -depth * 0.3,
          width, height * 0.8, depth * 0.4),
      box(0, base, 0, width * 0.08, height * 0.2 - base, depth * 0.2),
      box(0, 0, 0, width * 0.6, base, depth),
    ];
  }
  if (item.kind === 'lamp') {
    return [
      box(0, 0, 0, width, height * 0.05, depth),
      box(0, height * 0.05, 0,
          width * 0.08, height * 0.65, depth * 0.08),
      box(0, height * 0.7, 0, width, height * 0.3, depth),
    ];
  }
  if (item.kind === 'shelf' && item.supports?.length) {
    const thickness = item.frameThickness;
    const parts = item.supports.map((surface) => box(
        surface.x, surface.y - surface.thickness, surface.z,
        surface.width, surface.thickness, surface.depth,
    ));
    for (const x of [-(width - thickness) / 2, (width - thickness) / 2]) {
      for (const z of [-(depth - thickness) / 2, (depth - thickness) / 2]) {
        parts.push(box(x, 0, z, thickness, height, thickness));
      }
    }
    return parts;
  }
  if (['desk', 'table'].includes(item.kind)) {
    const top = Math.min(60, height / 5);
    const leg = Math.min(45, width / 8, depth / 8);
    const parts = [box(0, height - top, 0, width, top, depth)];
    for (const x of [-width / 2 + leg, width / 2 - leg]) {
      for (const z of [-depth / 2 + leg, depth / 2 - leg]) {
        parts.push(box(x, 0, z, leg, height - top, leg));
      }
    }
    return parts;
  }
  return [box(0, 0, 0, width, height, depth)];
}

/**
 * Place solid local boxes in world coordinates for collision checks.
 * @param {!Object} item Resolved world-space item in mm.
 * @return {!Array<!Object>} World-space occupied boxes.
 */
export function worldParts(item) {
  return solidParts(item).map((part) => ({
    ...part, ...transformPoint(item, part), rotation: item.rotation,
  }));
}
