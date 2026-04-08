import type { Camera2D, EdgeRef, Polygon, Vec2, VectorObject } from "./types";
import { getPolygonContour } from "./types";
import { pointInPolygon } from "./polygonUtils";
import { normalizeWallWindowRef, pointAtDistanceAlongPolyline } from "./wallWindow";

function worldToScreen(
  camera: Camera2D,
  width: number,
  height: number,
  p: Vec2
): { x: number; y: number } {
  const cx = width / 2;
  const cy = height / 2;
  return {
    x: cx + (p.x - camera.center.x) * camera.zoom,
    y: cy - (p.y - camera.center.y) * camera.zoom,
  };
}

export function distPointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;

  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    return Math.hypot(dx, dy);
  }

  let t = (wx * vx + wy * vy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;

  const projX = a.x + t * vx;
  const projY = a.y + t * vy;

  const dx = p.x - projX;
  const dy = p.y - projY;
  return Math.hypot(dx, dy);
}

function testContour(
  poly: Polygon,
  objectId: string,
  polygonId: string,
  holeIndex: number | undefined,
  pointWorld: Vec2,
  bufferWorld: number
): { ref: EdgeRef; dist: number } | null {
  const verts = getPolygonContour(poly, holeIndex);
  if (verts.length < 2) return null;

  let best: { ref: EdgeRef; dist: number } | null = null;
  for (let i = 0; i < verts.length; i += 1) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const d = distPointToSegment(pointWorld, a, b);
    if (d <= bufferWorld && (best === null || d < best.dist)) {
      best = {
        ref: { objectId, polygonId, edgeIndex: i, ...(holeIndex !== undefined && { holeIndex }) },
        dist: d
      };
    }
  }
  return best;
}

export function hitTestEdges(
  objects: VectorObject[],
  camera: Camera2D,
  pointWorld: Vec2,
  bufferPx = 8
): EdgeRef | null {
  const bufferWorld = bufferPx / camera.zoom;
  let best: { ref: EdgeRef; dist: number } | null = null;

  for (const obj of objects) {
    for (const poly of obj.polygons) {
      const outer = testContour(poly, obj.id, poly.id, undefined, pointWorld, bufferWorld);
      if (outer && (best === null || outer.dist < best.dist)) best = outer;

      const holes = poly.holes ?? [];
      for (let h = 0; h < holes.length; h++) {
        const holeHit = testContour(poly, obj.id, poly.id, h, pointWorld, bufferWorld);
        if (holeHit && (best === null || holeHit.dist < best.dist)) best = holeHit;
      }
    }
  }

  return best ? best.ref : null;
}

/** Hit-test centerline segments (the line between consecutive points); returns { objectId, segmentIndex } of closest segment within tolerancePx, or null. */
export function hitTestCenterlineSegment(
  objects: VectorObject[],
  objectId: string | null,
  camera: Camera2D,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
  tolerancePx: number
): { objectId: string; segmentIndex: number } | null {
  if (!objectId) return null;
  const obj = objects.find((o) => o.id === objectId);
  const cl = obj?.centerline;
  if (!cl || cl.length < 2) return null;
  const pt = { x: screenX, y: screenY };
  let best: { objectId: string; segmentIndex: number; dist: number } | null = null;
  for (let i = 0; i < cl.length - 1; i++) {
    const a = worldToScreen(camera, width, height, cl[i]);
    const b = worldToScreen(camera, width, height, cl[i + 1]);
    const d = distPointToSegment(pt, a, b);
    if (d <= tolerancePx && (best === null || d < best.dist)) {
      best = { objectId: obj.id, segmentIndex: i, dist: d };
    }
  }
  return best ? { objectId: best.objectId, segmentIndex: best.segmentIndex } : null;
}

/** Hit-test centerline endpoints only (first and last point); returns { objectId, pointIndex } or null. Mid points are not selectable. */
export function hitTestCenterlinePoint(
  objects: VectorObject[],
  objectId: string | null,
  camera: Camera2D,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
  tolerancePx: number
): { objectId: string; pointIndex: number } | null {
  if (!objectId) return null;
  const obj = objects.find((o) => o.id === objectId);
  const cl = obj?.centerline;
  if (!cl || cl.length === 0) return null;
  const endpoints = cl.length === 1 ? [0] : [0, cl.length - 1];
  let best: { objectId: string; pointIndex: number; dist: number } | null = null;
  for (const i of endpoints) {
    const s = worldToScreen(camera, width, height, cl[i]);
    const d = Math.hypot(screenX - s.x, screenY - s.y);
    if (d <= tolerancePx && (best === null || d < best.dist)) {
      best = { objectId: obj.id, pointIndex: i, dist: d };
    }
  }
  return best ? { objectId: best.objectId, pointIndex: best.pointIndex } : null;
}

/** Hit-test wall-window spine endpoints (on parent wall centerline) for the selected window object. */
export function hitTestWindowEndpoint(
  objects: VectorObject[],
  windowObjectId: string | null,
  camera: Camera2D,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
  tolerancePx: number
): { objectId: string; which: "start" | "end" } | null {
  if (!windowObjectId) return null;
  const win = objects.find((o) => o.id === windowObjectId);
  if (
    !win ||
    !win.wallWindowRef ||
    (win.itemId !== "wall-window" &&
      win.itemId !== "single-door" &&
      win.itemId !== "double-door")
  ) {
    return null;
  }
  const wall = objects.find((o) => o.id === win.wallWindowRef.wallId);
  const cl = wall?.centerline;
  if (!wall || !cl || cl.length < 2) return null;
  const norm = normalizeWallWindowRef(wall, win.wallWindowRef);
  if (!norm) return null;
  const a = pointAtDistanceAlongPolyline(cl, norm.startAlongMm);
  const b = pointAtDistanceAlongPolyline(cl, norm.endAlongMm);
  const sa = worldToScreen(camera, width, height, a);
  const sb = worldToScreen(camera, width, height, b);
  const pt = { x: screenX, y: screenY };
  const da = Math.hypot(pt.x - sa.x, pt.y - sa.y);
  const db = Math.hypot(pt.x - sb.x, pt.y - sb.y);
  if (da <= tolerancePx && db <= tolerancePx) {
    return da <= db
      ? { objectId: win.id, which: "start" }
      : { objectId: win.id, which: "end" };
  }
  if (da <= tolerancePx) return { objectId: win.id, which: "start" };
  if (db <= tolerancePx) return { objectId: win.id, which: "end" };
  return null;
}

/** Return the object id whose polygon (outer, excluding holes) contains the world point, or null. Last matching object in list wins (topmost). */
export function hitTestObjectAtPoint(
  objects: VectorObject[],
  pointWorld: Vec2
): string | null {
  let found: string | null = null;
  for (const obj of objects) {
    for (const poly of obj.polygons) {
      const outer = poly.verts;
      if (outer.length < 3) continue;
      if (!pointInPolygon(pointWorld, outer)) continue;
      const holes = poly.holes ?? [];
      let insideHole = false;
      for (const hole of holes) {
        if (hole.length >= 3 && pointInPolygon(pointWorld, hole)) {
          insideHole = true;
          break;
        }
      }
      if (!insideHole) found = obj.id;
    }
  }
  return found;
}

/** Hit-test vertices of a completed measure polyline (screen px tolerance). Returns vertex index or null. */
export function hitTestMeasureVertex(
  path: { x: number; y: number }[] | null,
  camera: Camera2D,
  width: number,
  height: number,
  canvasX: number,
  canvasY: number,
  tolerancePx: number
): number | null {
  if (!path || path.length === 0) return null;
  for (let i = 0; i < path.length; i++) {
    const s = worldToScreen(camera, width, height, path[i]);
    if (Math.hypot(s.x - canvasX, s.y - canvasY) <= tolerancePx) {
      return i;
    }
  }
  return null;
}
