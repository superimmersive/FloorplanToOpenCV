import type { Vec2 } from "./types";

/** Signed area (shoelace). CCW = positive, CW = negative. */
export function signedArea(verts: Vec2[]): number {
  if (verts.length < 3) return 0;
  let sum = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  return sum / 2;
}

/** Cross product (z) of (b - a) and (c - b). Zero when a, b, c are collinear. */
function crossSegments(a: Vec2, b: Vec2, c: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = c.x - b.x;
  const wy = c.y - b.y;
  return vx * wy - vy * wx;
}

/** Remove vertices that lie on a straight line between neighbors; keep only vertices where direction changes. */
export function removeCollinearVerts(verts: Vec2[], epsilon = 0.5): Vec2[] {
  if (verts.length <= 2) return verts;
  const out: Vec2[] = [];
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const prev = verts[(i - 1 + n) % n];
    const curr = verts[i];
    const next = verts[(i + 1) % n];
    const cross = crossSegments(prev, curr, next);
    if (Math.abs(cross) > epsilon) out.push(curr);
  }
  return out.length >= 2 ? out : verts;
}

/** Remove collinear points from an open polyline (e.g. centerline). Keeps first and last; drops mid points on straight segments. */
export function removeCollinearVertsPolyline(verts: Vec2[], epsilon = 0.5): Vec2[] {
  if (verts.length <= 2) return verts;
  const out: Vec2[] = [verts[0]];
  for (let i = 1; i < verts.length - 1; i++) {
    const prev = verts[i - 1];
    const curr = verts[i];
    const next = verts[i + 1];
    const cross = crossSegments(prev, curr, next);
    if (Math.abs(cross) > epsilon) out.push(curr);
  }
  out.push(verts[verts.length - 1]);
  return out;
}

/** Point-in-polygon (ray casting). Returns true if point is inside the path. */
export function pointInPolygon(point: Vec2, path: Vec2[]): boolean {
  if (path.length < 3) return false;
  const { x, y } = point;
  let inside = false;
  const n = path.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = path[i].x;
    const yi = path[i].y;
    const xj = path[j].x;
    const yj = path[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Shortest distance from `p` to segment `ab` (world mm). */
export function distancePointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-18) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = a.x + t * vx;
  const qy = a.y + t * vy;
  return Math.hypot(p.x - qx, p.y - qy);
}

/** Strict interior or within `boundaryEpsMm` of an edge (so snapping to the outer wall spine counts as valid). */
export function pointInPolygonOrNearBoundary(p: Vec2, path: Vec2[], boundaryEpsMm: number): boolean {
  if (path.length < 3) return false;
  if (pointInPolygon(p, path)) return true;
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const a = path[i];
    const b = path[(i + 1) % n];
    if (distancePointToSegment(p, a, b) <= boundaryEpsMm) return true;
  }
  return false;
}
