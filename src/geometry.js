/**
 * Numerical tolerance used by the planar geometry predicates.
 */
export const EPS = 1e-6;
/**
 * Compute the signed 2D cross product of AB and AC.
 * @param {!Array<number>} a Origin [x, z] in mm.
 * @param {!Array<number>} b First endpoint [x, z] in mm.
 * @param {!Array<number>} c Second endpoint [x, z] in mm.
 * @return {number} Signed cross product in square mm.
 */
export const cross = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
/**
 * Compute signed polygon area; winding controls the sign.
 * @param {!Array<!Array<number>>} p Polygon vertices [x, z] in mm.
 * @return {number} Area in square mm.
 */
export const area = (p) =>
  p.reduce((s, a, i) => {
    const b = p[(i + 1) % p.length];
    return s + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
/**
 * Check whether a point lies on a closed line segment within tolerance.
 * @param {!Array<number>} p Point [x, z] in mm.
 * @param {!Array<number>} a Segment start in mm.
 * @param {!Array<number>} b Segment end in mm.
 * @return {boolean} Whether the point touches the segment.
 */
export function onSegment(p, a, b) {
  return (
    Math.abs(cross(a, b, p)) <= EPS &&
    p[0] >= Math.min(a[0], b[0]) - EPS &&
    p[0] <= Math.max(a[0], b[0]) + EPS &&
    p[1] >= Math.min(a[1], b[1]) - EPS &&
    p[1] <= Math.max(a[1], b[1]) + EPS
  );
}
/**
 * Test closed segments, including touching endpoints and collinear overlap.
 * @param {!Array<number>} a First segment start [x, z] in mm.
 * @param {!Array<number>} b First segment end in mm.
 * @param {!Array<number>} c Second segment start in mm.
 * @param {!Array<number>} d Second segment end in mm.
 * @return {boolean} Whether the segments share any point.
 */
export function segmentsIntersect(a, b, c, d) {
  const x = cross(a, b, c);
  const y = cross(a, b, d);
  const z = cross(c, d, a);
  const w = cross(c, d, b);
  return (
    (x * y < 0 && z * w < 0) ||
    onSegment(c, a, b) ||
    onSegment(d, a, b) ||
    onSegment(a, c, d) ||
    onSegment(b, c, d)
  );
}
/**
 * Reject degenerate, crossing and backtracking polygon outlines.
 * @param {!Array<!Array<number>>} p At least three [x, z] points in mm.
 * @return {boolean} Whether the outline forms a simple nonzero-area polygon.
 */
export function simplePolygon(p) {
  if (Math.abs(area(p)) <= EPS) {
    return false;
  }
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= EPS) {
      return false;
    }
    const prev = p[(i + p.length - 1) % p.length];
    if (
      Math.abs(cross(prev, a, b)) <= EPS &&
      (prev[0] - a[0]) * (b[0] - a[0]) +
      (prev[1] - a[1]) * (b[1] - a[1]) >
      0
    ) {
      return false;
    }
    for (let j = i + 1; j < p.length; j++) {
      if (j === i + 1 || (i === 0 && j === p.length - 1)) {
        continue;
      }
      if (segmentsIntersect(a, b, p[j], p[(j + 1) % p.length])) {
        return false;
      }
    }
  }
  return true;
}
/**
 * Use ray crossing to test a point; boundary points count as inside.
 * @param {!Array<number>} pt Point [x, z] in mm.
 * @param {!Array<!Array<number>>} poly Simple polygon in mm.
 * @return {boolean} Whether the point is inside or on the boundary.
 */
export function pointInside(pt, poly) {
  let inside = false;
  let previousIndex = poly.length - 1;
  for (let i = 0; i < poly.length; previousIndex = i++) {
    const a = poly[i];
    const b = poly[previousIndex];
    if (onSegment(pt, a, b)) {
      return true;
    }
    if (
      (a[1] > pt[1]) !== (b[1] > pt[1]) &&
      pt[0] <
          ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}
// Split each object edge at every room boundary intersection. This catches
// concave notches even when every furniture corner lies inside the room.
/**
 * Check every split edge interval so concave room notches are respected.
 * @param {!Array<!Array<number>>} poly Object outline [x, z] in mm.
 * @param {!Array<!Array<number>>} room Simple room outline in mm.
 * @return {boolean} Whether the entire object is inside or on the boundary.
 */
export function contained(poly, room) {
  if (!poly.every((p) => pointInside(p, room))) {
    return false;
  }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const ts = [0, 1];
    for (let j = 0; j < room.length; j++) {
      const c = room[j];
      const d = room[(j + 1) % room.length];
      const ex = d[0] - c[0];
      const ez = d[1] - c[1];
      const den = dx * ez - dz * ex;
      if (Math.abs(den) <= EPS) {
        continue;
      }
      const t = ((c[0] - a[0]) * ez - (c[1] - a[1]) * ex) / den;
      const u = ((c[0] - a[0]) * dz - (c[1] - a[1]) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) {
        ts.push(t);
      }
    }
    ts.sort((x, y) => x - y);
    for (let j = 1; j < ts.length; j++) {
      const t = (ts[j - 1] + ts[j]) / 2;
      if (!pointInside([a[0] + dx * t, a[1] + dz * t], room)) {
        return false;
      }
    }
  }
  return true;
}
/**
 * Build a rotated rectangular footprint using Three.js Y-axis rotation.
 * @param {!Object} f Furniture: x, z, width, depth in mm; rotation in degrees.
 * @param {number} padding Extra outward distance on each side in mm.
 * @return {!Array<!Array<number>>} Four world-space [x, z] corners in mm.
 */
export function footprint(f, padding = 0) {
  const r = (f.rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const w = f.width / 2 + padding;
  const d = f.depth / 2 + padding;
  return [
    [-w, -d],
    [w, -d],
    [w, d],
    [-w, d],
  ].map(([x, z]) => [f.x + x * c + z * s, f.z - x * s + z * c]);
}
/**
 * Apply separating axes to convex polygons; touching alone is allowed.
 * @param {!Array<!Array<number>>} a First convex outline in mm.
 * @param {!Array<!Array<number>>} b Second convex outline in mm.
 * @return {boolean} Whether their interiors overlap beyond tolerance.
 */
export function overlap(a, b) {
  for (const p of [a, b]) {
    for (let i = 0; i < p.length; i++) {
      const v = p[i];
      const w = p[(i + 1) % p.length];
      const nx = -(w[1] - v[1]);
      const nz = w[0] - v[0];
      const pa = a.map((q) => q[0] * nx + q[1] * nz);
      const pb = b.map((q) => q[0] * nx + q[1] * nz);
      // Touching is allowed. Tolerance is in mm, independent of edge length.
      if (
        Math.min(...pa) >=
        Math.max(...pb) - EPS * Math.hypot(nx, nz) ||
        Math.min(...pb) >=
        Math.max(...pa) - EPS * Math.hypot(nx, nz)
      ) {
        return false;
      }
    }
  }
  return true;
}
/**
 * Locate an opening and its inward clearance rectangle along a room edge.
 * @param {!Object} room Normalized room with a nondegenerate outline in mm.
 * @param {!Object} o Opening with a valid wall index and dimensions in mm.
 * @return {!Object} Endpoints, inward unit normal, wall length and zone.
 */
export function openingGeometry(room, o) {
  const a = room.outline[o.wall];
  const b = room.outline[(o.wall + 1) % room.outline.length];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / length;
  const uz = (b[1] - a[1]) / length;
  const sign = Math.sign(area(room.outline));
  const nx = -uz * sign;
  const nz = ux * sign;
  const start = [a[0] + ux * o.offset, a[1] + uz * o.offset];
  const end = [start[0] + ux * o.width, start[1] + uz * o.width];
  return {
    start,
    end,
    nx,
    nz,
    length,
    zone: [
      start,
      end,
      [end[0] + nx * o.clearance, end[1] + nz * o.clearance],
      [start[0] + nx * o.clearance, start[1] + nz * o.clearance],
    ],
  };
}
