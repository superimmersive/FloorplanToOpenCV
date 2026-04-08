import type { Vec2, VectorObject } from "./types";
import { vec2 } from "./types";
import { isInnerWallPolylineObject, isWallPolylineObject } from "./wallWindow";

function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-18) return vec2(a.x, a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return vec2(a.x + t * vx, a.y + t * vy);
}

/** Outer or inner wall polylines (centerline-based). */
function isWallLikePolyline(wall: VectorObject): boolean {
  return isWallPolylineObject(wall) || isInnerWallPolylineObject(wall);
}

function forEachWallCenterlineSegment(
  wall: VectorObject,
  fn: (a: Vec2, b: Vec2) => void
): void {
  const cl = wall.centerline;
  if (!cl || cl.length < 2) return;
  for (let i = 0; i < cl.length - 1; i++) {
    fn(vec2(cl[i].x, cl[i].y), vec2(cl[i + 1].x, cl[i + 1].y));
  }
}

/**
 * Snap a free point to the nearest point on another wall’s **centerline** (plan), if within tolerance.
 * Uses spine geometry, not the stroked outline.
 */
export function snapFreePointToWallEdges(
  world: Vec2,
  objects: VectorObject[],
  toleranceMm: number
): Vec2 | null {
  if (toleranceMm <= 0) return null;
  let bestP: Vec2 | null = null;
  let bestD = toleranceMm + 1;
  for (const wall of objects) {
    if (!isWallLikePolyline(wall)) continue;
    forEachWallCenterlineSegment(wall, (a, b) => {
      const q = closestPointOnSegment(world, a, b);
      const d = Math.hypot(q.x - world.x, q.y - world.y);
      if (d < bestD - 1e-9) {
        bestD = d;
        bestP = q;
      }
    });
  }
  return bestP;
}

/**
 * Intersection of axis-aligned line through `last` (same orientation as last→preview) with segment AB.
 * For collinear overlap, picks the point on the segment closest to `preview`.
 */
function axisLineEdgeHit(
  last: Vec2,
  horiz: boolean,
  preview: Vec2,
  a: Vec2,
  b: Vec2
): Vec2 | null {
  if (horiz) {
    const y0 = last.y;
    if (Math.abs(a.y - b.y) < 1e-9) {
      if (Math.abs(a.y - y0) >= 1e-9) return null;
      const xmin = Math.min(a.x, b.x);
      const xmax = Math.max(a.x, b.x);
      const xs = Math.max(xmin, Math.min(preview.x, xmax));
      return vec2(xs, y0);
    }
    const t = (y0 - a.y) / (b.y - a.y);
    if (t < -1e-9 || t > 1 + 1e-9) return null;
    const x = a.x + t * (b.x - a.x);
    return vec2(x, y0);
  }
  const x0 = last.x;
  if (Math.abs(a.x - b.x) < 1e-9) {
    if (Math.abs(a.x - x0) >= 1e-9) return null;
    const ymin = Math.min(a.y, b.y);
    const ymax = Math.max(a.y, b.y);
    const ys = Math.max(ymin, Math.min(preview.y, ymax));
    return vec2(x0, ys);
  }
  const t = (x0 - a.x) / (b.x - a.x);
  if (t < -1e-9 || t > 1 + 1e-9) return null;
  const y = a.y + t * (b.y - a.y);
  return vec2(x0, y);
}

function onRayTowardPreview(last: Vec2, preview: Vec2, horiz: boolean, hit: Vec2): boolean {
  if (horiz) {
    const dir = Math.sign(preview.x - last.x) || 1;
    const dx = hit.x - last.x;
    if (Math.abs(dx) < 1e-9) return true;
    return Math.sign(dx) === dir;
  }
  const dir = Math.sign(preview.y - last.y) || 1;
  const dy = hit.y - last.y;
  if (Math.abs(dy) < 1e-9) return true;
  return Math.sign(dy) === dir;
}

/** When continuing a wall: allow snapping to that wall’s centerline past this distance along the ray (avoids degenerate hits at the merge point). */
export type ContinueWallEdgeSnap = {
  wallId: string;
  minAlongRayMm: number;
};

/** Minimum along-ray distance before accepting a snap on the wall being continued (centerline snap). */
const CONTINUE_WALL_MIN_ALONG_RAY_MM = 5;

/** Build options for {@link snapAxisLockedPointToWallEdges} when merging a stroke into `mergeWallId`. */
export function continueWallEdgeSnapFromObjects(
  objects: VectorObject[],
  mergeWallId: string | null
): ContinueWallEdgeSnap | null {
  if (!mergeWallId) return null;
  const w = objects.find((o) => o.id === mergeWallId);
  if (!w) return null;
  return { wallId: mergeWallId, minAlongRayMm: CONTINUE_WALL_MIN_ALONG_RAY_MM };
}

/**
 * After axis-locked wall draw preview, snap to the nearest hit on a wall **centerline** along the same ray
 * (T-junction), if within tolerance of `preview`.
 * Use `continueWall` when merging into an existing wall so that wall’s centerline is included (not skipped).
 */
export function snapAxisLockedPointToWallEdges(
  last: Vec2,
  preview: Vec2,
  objects: VectorObject[],
  toleranceMm: number,
  continueWall?: ContinueWallEdgeSnap | null
): Vec2 | null {
  if (toleranceMm <= 0) return null;
  const horiz = Math.abs(preview.x - last.x) >= Math.abs(preview.y - last.y);
  const candidates: Vec2[] = [];
  for (const wall of objects) {
    if (!isWallLikePolyline(wall)) continue;
    forEachWallCenterlineSegment(wall, (a, b) => {
      const hit = axisLineEdgeHit(last, horiz, preview, a, b);
      if (!hit) return;
      if (Math.hypot(hit.x - last.x, hit.y - last.y) < 1e-6) return;
      if (!onRayTowardPreview(last, preview, horiz, hit)) return;
      if (continueWall && wall.id === continueWall.wallId) {
        const along = horiz ? Math.abs(hit.x - last.x) : Math.abs(hit.y - last.y);
        if (along < continueWall.minAlongRayMm - 1e-9) return;
      }
      candidates.push(hit);
    });
  }
  if (candidates.length === 0) return null;
  /** Prefer the first wall face along the ray (closest to `last`) among hits near the cursor. */
  let best: Vec2 | null = null;
  let bestAlong = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.x - preview.x, c.y - preview.y);
    if (d > toleranceMm + 1e-9) continue;
    const along = horiz ? Math.abs(c.x - last.x) : Math.abs(c.y - last.y);
    if (along < bestAlong - 1e-9) {
      bestAlong = along;
      best = c;
    }
  }
  return best;
}
