import { computeFloorPolygonFromClosedOuterWall } from "./foundation";
import { isWallPolylineObject } from "./wallWindow";
import { pointInPolygonOrNearBoundary } from "./polygonUtils";
import type { Vec2, VectorObject } from "./types";

/** Allow points on / near the outer wall centerline ring (mm). */
const OUTER_SHELL_BOUNDARY_EPS_MM = 3;

/**
 * Plan polygons for the interior of each **closed** outer wall (same as floor shell).
 */
export function closedOuterWallInteriorPolygons(objects: VectorObject[]): Vec2[][] {
  const out: Vec2[][] = [];
  for (const o of objects) {
    if (!isWallPolylineObject(o)) continue;
    const poly = computeFloorPolygonFromClosedOuterWall(o);
    if (poly && poly.length >= 3) out.push(poly);
  }
  return out;
}

/** True when there is at least one closed outer wall with a valid interior loop. */
export function hasClosedOuterWallRegion(objects: VectorObject[]): boolean {
  return closedOuterWallInteriorPolygons(objects).length > 0;
}

/**
 * True if `p` lies inside any closed outer shell, or on its boundary (within a few mm).
 */
export function isPointInsideClosedOuterShells(objects: VectorObject[], p: Vec2): boolean {
  for (const shell of closedOuterWallInteriorPolygons(objects)) {
    if (pointInPolygonOrNearBoundary(p, shell, OUTER_SHELL_BOUNDARY_EPS_MM)) return true;
  }
  return false;
}
