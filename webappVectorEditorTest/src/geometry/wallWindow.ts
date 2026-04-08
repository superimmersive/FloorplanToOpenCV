import type { Vec2, VectorObject } from "./types";
import { vec2 } from "./types";
import { effectiveWallDrawWidthMm } from "./wallDrawWidth";
import { doubleDoorCatalogIdForSpanMm, nearestCatalogWidthMm } from "../items/doorSizes";

/** Minimum opening length (mm) for wall windows (placement and endpoint drag). */
export const MIN_WALL_WINDOW_SPAN_MM = 30;

/** Outer walls: centerline polyline, not catalog items. */
export function isWallPolylineObject(obj: VectorObject): boolean {
  const cl = obj.centerline;
  return cl != null && cl.length >= 2 && obj.itemColor == null && obj.itemId == null;
}

/** Partition walls drawn with Draw inner wall (`itemId === "inner-wall"`). */
export function isInnerWallPolylineObject(obj: VectorObject): boolean {
  const cl = obj.centerline;
  return cl != null && cl.length >= 2 && obj.itemColor == null && obj.itemId === "inner-wall";
}

/** Outer or inner wall polylines that can host windows/doors along the centerline. */
export function isWallHostForOpenings(obj: VectorObject): boolean {
  return isWallPolylineObject(obj) || isInnerWallPolylineObject(obj);
}

function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-18) return vec2(a.x, a.y);
  let t = (wx * vx + wy * vy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return vec2(a.x + t * vx, a.y + t * vy);
}

/** Closest point on the wall centerline polyline to `p` (union of axis segments). */
export function projectPointOntoWallPolyline(centerline: Vec2[], p: Vec2): Vec2 {
  if (centerline.length === 0) return vec2(p.x, p.y);
  if (centerline.length === 1) return vec2(centerline[0].x, centerline[0].y);
  let best = closestPointOnSegment(p, centerline[0], centerline[1]);
  let bestD = Math.hypot(p.x - best.x, p.y - best.y);
  for (let i = 1; i < centerline.length - 1; i++) {
    const q = closestPointOnSegment(p, centerline[i], centerline[i + 1]);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/**
 * If `p` lies within `toleranceMm` of a centerline vertex, snap to that vertex so window endpoints
 * can align with wall corners (inside / outside) when Snap is on.
 */
export function snapProjectedPointToWallVertices(
  centerline: Vec2[],
  p: Vec2,
  toleranceMm: number
): Vec2 {
  if (toleranceMm <= 0 || centerline.length < 2) return p;
  let best = p;
  let bestD = toleranceMm + 1;
  for (const v of centerline) {
    const d = Math.hypot(v.x - p.x, v.y - p.y);
    if (d <= toleranceMm && d < bestD) {
      bestD = d;
      best = vec2(v.x, v.y);
    }
  }
  return best;
}

/** Project onto wall, optional grid snap along wall, then optional snap to nearest corner vertex. */
export function snapWallWindowPointerOntoCenterline(
  cl: Vec2[],
  worldPoint: Vec2,
  snapGridMm: number,
  vertexSnapTolMm: number
): Vec2 {
  let p = projectPointOntoWallPolyline(cl, worldPoint);
  if (snapGridMm > 0) {
    p = projectPointOntoWallPolyline(
      cl,
      vec2(Math.round(p.x / snapGridMm) * snapGridMm, Math.round(p.y / snapGridMm) * snapGridMm)
    );
  }
  if (vertexSnapTolMm > 0) {
    p = snapProjectedPointToWallVertices(cl, p, vertexSnapTolMm);
  }
  return p;
}

export type WallCenterlineHit = { wall: VectorObject; point: Vec2; dist: number };

/**
 * Closest point on any wall centerline within `maxDistMm` of `worldPoint`.
 */
export function hitNearestWallCenterline(
  objects: VectorObject[],
  worldPoint: Vec2,
  maxDistMm: number
): WallCenterlineHit | null {
  let best: WallCenterlineHit | null = null;
  for (const obj of objects) {
    if (!isWallHostForOpenings(obj)) continue;
    const cl = obj.centerline!;
    for (let i = 0; i < cl.length - 1; i++) {
      const q = closestPointOnSegment(worldPoint, cl[i], cl[i + 1]);
      const d = Math.hypot(worldPoint.x - q.x, worldPoint.y - q.y);
      if (d <= maxDistMm && (best === null || d < best.dist)) {
        best = { wall: obj, point: q, dist: d };
      }
    }
  }
  return best;
}

export function polylineTotalLength(cl: Vec2[]): number {
  let len = 0;
  for (let i = 0; i < cl.length - 1; i++) {
    len += Math.hypot(cl[i + 1].x - cl[i].x, cl[i + 1].y - cl[i].y);
  }
  return len;
}

/** Arc length along `cl` from vertex 0 to the closest point on the polyline to `p`. */
export function distanceAlongPolylineToPoint(cl: Vec2[], p: Vec2): number {
  if (cl.length < 2) return 0;
  let bestD = Infinity;
  let bestAlong = 0;
  let cum = 0;
  for (let i = 0; i < cl.length - 1; i++) {
    const a = cl[i];
    const b = cl[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const q = closestPointOnSegment(p, a, b);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    const tAlong = Math.hypot(q.x - a.x, q.y - a.y);
    if (d < bestD - 1e-9) {
      bestD = d;
      bestAlong = cum + tAlong;
    }
    cum += segLen;
  }
  return bestAlong;
}

/** Point at arc length `alongMm` from `cl[0]` along the polyline (clamped to ends). */
export function pointAtDistanceAlongPolyline(cl: Vec2[], alongMm: number): Vec2 {
  if (cl.length === 0) return vec2(0, 0);
  if (cl.length === 1) return vec2(cl[0].x, cl[0].y);
  const total = polylineTotalLength(cl);
  let remaining = Math.max(0, Math.min(total, alongMm));
  for (let i = 0; i < cl.length - 1; i++) {
    const a = cl[i];
    const b = cl[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < 1e-12) continue;
    if (remaining <= segLen) {
      const t = remaining / segLen;
      return vec2(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y));
    }
    remaining -= segLen;
  }
  const last = cl[cl.length - 1];
  return vec2(last.x, last.y);
}

/** Plan-view rectangle centered on the wall spine from `a` to `b`, half-thickness `halfDepthMm` perpendicular to the wall. */
export function buildWindowRectangleAlongWall(a: Vec2, b: Vec2, halfDepthMm: number): Vec2[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy * halfDepthMm;
  const py = ux * halfDepthMm;
  return [
    vec2(a.x + px, a.y + py),
    vec2(b.x + px, b.y + py),
    vec2(b.x - px, b.y - py),
    vec2(a.x - px, a.y - py),
  ];
}

/** Distance from polyline start to vertex `cl[k]` (k = 0 … n−1). */
function vertexDistancesAlong(cl: Vec2[]): number[] {
  const d: number[] = [0];
  for (let i = 1; i < cl.length; i++) {
    d.push(d[i - 1] + Math.hypot(cl[i].x - cl[i - 1].x, cl[i].y - cl[i - 1].y));
  }
  return d;
}

/**
 * Ordered points along the wall centerline from arc length `startAlong` to `endAlong` (inclusive),
 * following corners so spans can wrap an L-shaped or bent wall (corner windows).
 */
export function spinePointsBetweenAlong(cl: Vec2[], startAlong: number, endAlong: number): Vec2[] {
  const total = polylineTotalLength(cl);
  let s = Math.max(0, Math.min(total, Math.min(startAlong, endAlong)));
  let e = Math.max(0, Math.min(total, Math.max(startAlong, endAlong)));
  if (e - s < 1e-9) return [];
  if (cl.length < 2) return [];
  const pS = pointAtDistanceAlongPolyline(cl, s);
  const pE = pointAtDistanceAlongPolyline(cl, e);
  const vd = vertexDistancesAlong(cl);
  const eps = 1e-6;
  const out: Vec2[] = [pS];
  for (let k = 1; k < cl.length - 1; k++) {
    if (vd[k] > s + eps && vd[k] < e - eps) {
      out.push(vec2(cl[k].x, cl[k].y));
    }
  }
  const last = out[out.length - 1];
  if (Math.hypot(last.x - pE.x, last.y - pE.y) > eps) {
    out.push(pE);
  } else {
    out[out.length - 1] = pE;
  }
  return out;
}

function perpLeftNormalized(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return vec2(0, 0);
  return vec2(-dy / len, dx / len);
}

/** Intersection of infinite lines (a + t v) and (b + u w). */
function lineLineIntersection(a: Vec2, v: Vec2, b: Vec2, w: Vec2): Vec2 | null {
  const cross = v.x * w.y - v.y * w.x;
  if (Math.abs(cross) < 1e-14) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = (dx * w.y - dy * w.x) / cross;
  return vec2(a.x + t * v.x, a.y + t * v.y);
}

/**
 * Closed polygon: offset the polyline spine by ±halfDepthMm with miter joins (plan view).
 * Two-point spine uses {@link buildWindowRectangleAlongWall}.
 */
export function buildMiterOffsetPolygon(spine: Vec2[], halfDepthMm: number): Vec2[] {
  const m = spine.length;
  if (m < 2) return [];
  if (m === 2) {
    return buildWindowRectangleAlongWall(spine[0], spine[1], halfDepthMm);
  }
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const nSegs = m - 1;
  const perps: Vec2[] = [];
  for (let i = 0; i < nSegs; i++) {
    perps.push(perpLeftNormalized(spine[i], spine[i + 1]));
  }
  left.push(
    vec2(spine[0].x + perps[0].x * halfDepthMm, spine[0].y + perps[0].y * halfDepthMm)
  );
  right.push(
    vec2(spine[0].x - perps[0].x * halfDepthMm, spine[0].y - perps[0].y * halfDepthMm)
  );
  for (let i = 1; i < m - 1; i++) {
    const np = perps[i - 1];
    const nq = perps[i];
    const o0a = vec2(spine[i - 1].x + np.x * halfDepthMm, spine[i - 1].y + np.y * halfDepthMm);
    const o0b = vec2(spine[i].x + np.x * halfDepthMm, spine[i].y + np.y * halfDepthMm);
    const o1a = vec2(spine[i].x + nq.x * halfDepthMm, spine[i].y + nq.y * halfDepthMm);
    const o1b = vec2(spine[i + 1].x + nq.x * halfDepthMm, spine[i + 1].y + nq.y * halfDepthMm);
    const dir0 = vec2(o0b.x - o0a.x, o0b.y - o0a.y);
    const dir1 = vec2(o1b.x - o1a.x, o1b.y - o1a.y);
    const hitL = lineLineIntersection(o0a, dir0, o1a, dir1);
    if (hitL) {
      left.push(hitL);
    } else {
      left.push(vec2(spine[i].x + nq.x * halfDepthMm, spine[i].y + nq.y * halfDepthMm));
    }
    const ro0a = vec2(spine[i - 1].x - np.x * halfDepthMm, spine[i - 1].y - np.y * halfDepthMm);
    const ro0b = vec2(spine[i].x - np.x * halfDepthMm, spine[i].y - np.y * halfDepthMm);
    const ro1a = vec2(spine[i].x - nq.x * halfDepthMm, spine[i].y - nq.y * halfDepthMm);
    const ro1b = vec2(spine[i + 1].x - nq.x * halfDepthMm, spine[i + 1].y - nq.y * halfDepthMm);
    const rdir0 = vec2(ro0b.x - ro0a.x, ro0b.y - ro0a.y);
    const rdir1 = vec2(ro1b.x - ro1a.x, ro1b.y - ro1a.y);
    const hitR = lineLineIntersection(ro0a, rdir0, ro1a, rdir1);
    if (hitR) {
      right.push(hitR);
    } else {
      right.push(vec2(spine[i].x - nq.x * halfDepthMm, spine[i].y - nq.y * halfDepthMm));
    }
  }
  const lastN = perps[nSegs - 1];
  left.push(
    vec2(spine[m - 1].x + lastN.x * halfDepthMm, spine[m - 1].y + lastN.y * halfDepthMm)
  );
  right.push(
    vec2(spine[m - 1].x - lastN.x * halfDepthMm, spine[m - 1].y - lastN.y * halfDepthMm)
  );
  const poly: Vec2[] = [...left];
  for (let i = right.length - 1; i >= 0; i--) {
    poly.push(right[i]);
  }
  return poly;
}

/**
 * Plan-view window polygon along the wall centerline from `startAlongMm` to `endAlongMm` (arc length),
 * including corners — suitable for corner windows.
 */
export function buildWindowPolygonAlongCenterlineSpan(
  cl: Vec2[],
  startAlongMm: number,
  endAlongMm: number,
  halfDepthMm: number
): Vec2[] | null {
  const spine = spinePointsBetweenAlong(cl, startAlongMm, endAlongMm);
  if (spine.length < 2) return null;
  const poly = buildMiterOffsetPolygon(spine, halfDepthMm);
  return poly.length >= 3 ? poly : null;
}

export function normalizeWallWindowRef(
  wall: VectorObject,
  ref: NonNullable<VectorObject["wallWindowRef"]>
): { wallId: string; startAlongMm: number; endAlongMm: number } | null {
  const cl = wall.centerline;
  if (!cl || cl.length < 2) return null;
  if (
    typeof ref.startAlongMm === "number" &&
    typeof ref.endAlongMm === "number" &&
    Number.isFinite(ref.startAlongMm) &&
    Number.isFinite(ref.endAlongMm)
  ) {
    return { wallId: ref.wallId, startAlongMm: ref.startAlongMm, endAlongMm: ref.endAlongMm };
  }
  if (ref.a && ref.b) {
    const sa = distanceAlongPolylineToPoint(cl, ref.a);
    const sb = distanceAlongPolylineToPoint(cl, ref.b);
    return { wallId: ref.wallId, startAlongMm: Math.min(sa, sb), endAlongMm: Math.max(sa, sb) };
  }
  return null;
}

export function layoutWallWindowObject(
  wall: VectorObject,
  windowObj: VectorObject,
  norm: { wallId: string; startAlongMm: number; endAlongMm: number }
): VectorObject | null {
  const cl = wall.centerline;
  if (!cl || cl.length < 2) return null;
  const total = polylineTotalLength(cl);
  let s = Math.max(0, Math.min(total, norm.startAlongMm));
  let e = Math.max(0, Math.min(total, norm.endAlongMm));
  if (e < s) {
    const t = s;
    s = e;
    e = t;
  }
  if (e - s < 1) return null;
  const half = effectiveWallDrawWidthMm(wall) / 2;
  const verts = buildWindowPolygonAlongCenterlineSpan(cl, s, e, half);
  if (!verts) return null;
  const poly0 = windowObj.polygons[0];
  if (!poly0) return null;
  const spanMm = e - s;
  const base: VectorObject = {
    ...windowObj,
    wallWindowRef: { wallId: wall.id, startAlongMm: s, endAlongMm: e },
    polygons: [{ ...poly0, verts }],
  };
  if (windowObj.itemId === "single-door" || windowObj.itemId === "double-door") {
    if (windowObj.itemId === "double-door") {
      const catId = doubleDoorCatalogIdForSpanMm(spanMm, windowObj.doorCatalogOptionId);
      return { ...base, doorWidthMm: spanMm, ...(catId && { doorCatalogOptionId: catId }) };
    }
    return { ...base, doorWidthMm: spanMm };
  }
  return base;
}

/** Wall-anchored single or double door (uses same `wallWindowRef` span as windows). */
export function isWallHostedDoorItem(obj: VectorObject): boolean {
  return (
    (obj.itemId === "single-door" || obj.itemId === "double-door") && obj.wallWindowRef != null
  );
}

/**
 * Plan-view square spanMm × spanMm aligned with the wall chord from `startAlongMm` to `endAlongMm`
 * (spanMm = |end − start| along the polyline parameter).
 */
export function buildDoorSquarePolygonAlongWallSpan(
  cl: Vec2[],
  startAlongMm: number,
  endAlongMm: number
): { verts: Vec2[]; rotationDeg: number; center: Vec2; spanMm: number } | null {
  const s = Math.min(startAlongMm, endAlongMm);
  const e = Math.max(startAlongMm, endAlongMm);
  const spanMm = e - s;
  if (spanMm < 1e-6) return null;
  const p0 = pointAtDistanceAlongPolyline(cl, s);
  const p1 = pointAtDistanceAlongPolyline(cl, e);
  const mid = vec2((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const tx = dx / len;
  const ty = dy / len;
  const px = -ty;
  const py = tx;
  const half = spanMm / 2;
  const verts = [
    vec2(mid.x - tx * half - px * half, mid.y - ty * half - py * half),
    vec2(mid.x + tx * half - px * half, mid.y + ty * half - py * half),
    vec2(mid.x + tx * half + px * half, mid.y + ty * half + py * half),
    vec2(mid.x - tx * half + px * half, mid.y - ty * half + py * half),
  ];
  const rotationDeg = (Math.atan2(ty, tx) * 180) / Math.PI;
  return { verts, rotationDeg, center: mid, spanMm };
}

export function layoutWallDoorItem(
  wall: VectorObject,
  doorObj: VectorObject,
  norm: { wallId: string; startAlongMm: number; endAlongMm: number }
): VectorObject | null {
  const cl = wall.centerline;
  if (!cl || cl.length < 2) return null;
  const total = polylineTotalLength(cl);
  let s = Math.max(0, Math.min(total, norm.startAlongMm));
  let e = Math.max(0, Math.min(total, norm.endAlongMm));
  if (e < s) {
    const t = s;
    s = e;
    e = t;
  }
  if (e - s < MIN_WALL_WINDOW_SPAN_MM) return null;
  const built = buildDoorSquarePolygonAlongWallSpan(cl, s, e);
  if (!built) return null;
  const poly0 = doorObj.polygons[0];
  if (!poly0) return null;
  const base = {
    ...doorObj,
    wallWindowRef: { wallId: wall.id, startAlongMm: s, endAlongMm: e },
    doorWidthMm: built.spanMm,
    transform: {
      ...doorObj.transform,
      position: built.center,
      rotationDeg: built.rotationDeg,
    },
    polygons: [{ ...poly0, verts: built.verts }],
  };
  if (doorObj.itemId === "double-door") {
    const catId = doubleDoorCatalogIdForSpanMm(built.spanMm, doorObj.doorCatalogOptionId);
    return { ...base, ...(catId && { doorCatalogOptionId: catId }) };
  }
  return base;
}

/**
 * After dragging a wall door endpoint: snap opening width to the nearest catalog size while keeping
 * the opposite endpoint fixed.
 */
export function snapWallDoorSpanAfterEndpointDrag(
  totalWallMm: number,
  startAlongMm: number,
  endAlongMm: number,
  which: "start" | "end",
  catalogWidthsMm: number[]
): { startAlongMm: number; endAlongMm: number } | null {
  if (catalogWidthsMm.length === 0) return null;
  const minW = Math.min(...catalogWidthsMm);
  const s = Math.min(startAlongMm, endAlongMm);
  const e = Math.max(startAlongMm, endAlongMm);
  const rawW = e - s;
  if (rawW < MIN_WALL_WINDOW_SPAN_MM) return null;

  if (which === "start") {
    const room = e;
    const fits = catalogWidthsMm.filter((w) => w <= room + 1e-6);
    if (fits.length === 0) return null;
    const W = nearestCatalogWidthMm(fits, rawW);
    if (W + 1e-6 < minW) return null;
    const ns = e - W;
    if (ns < -1e-6) return null;
    if (e - Math.max(0, ns) < MIN_WALL_WINDOW_SPAN_MM) return null;
    return { startAlongMm: Math.max(0, ns), endAlongMm: e };
  }
  const room = totalWallMm - s;
  const fits = catalogWidthsMm.filter((w) => w <= room + 1e-6);
  if (fits.length === 0) return null;
  const W = nearestCatalogWidthMm(fits, rawW);
  if (W + 1e-6 < minW) return null;
  const ne = s + W;
  if (ne > totalWallMm + 1e-6) return null;
  if (ne - s < MIN_WALL_WINDOW_SPAN_MM) return null;
  return { startAlongMm: s, endAlongMm: ne };
}

/**
 * Move one endpoint of a wall window along the parent wall centerline (world mm).
 * For wall-hosted doors, pass `doorCatalogWidthsMm` to snap width to SA/UK catalogs after each drag.
 */
export function dragWindowEndpoint(
  objects: VectorObject[],
  windowId: string,
  which: "start" | "end",
  worldPoint: Vec2,
  snapGridMm: number,
  vertexSnapTolMm: number = 0,
  doorCatalogWidthsMm?: number[] | null
): VectorObject[] {
  const win = objects.find((o) => o.id === windowId);
  const wall = objects.find((o) => o.id === win?.wallWindowRef?.wallId);
  if (!win?.wallWindowRef || !wall?.centerline) return objects;
  const cl = wall.centerline;
  const p = snapWallWindowPointerOntoCenterline(cl, worldPoint, snapGridMm, vertexSnapTolMm);
  let along = distanceAlongPolylineToPoint(cl, p);
  const total = polylineTotalLength(cl);
  along = Math.max(0, Math.min(total, along));
  const norm = normalizeWallWindowRef(wall, win.wallWindowRef);
  if (!norm) return objects;
  let { startAlongMm, endAlongMm } = norm;
  if (which === "start") {
    startAlongMm = Math.min(along, endAlongMm - MIN_WALL_WINDOW_SPAN_MM);
    startAlongMm = Math.max(0, startAlongMm);
  } else {
    endAlongMm = Math.max(along, startAlongMm + MIN_WALL_WINDOW_SPAN_MM);
    endAlongMm = Math.min(total, endAlongMm);
  }
  if (endAlongMm - startAlongMm < MIN_WALL_WINDOW_SPAN_MM) return objects;

  let sOut = startAlongMm;
  let eOut = endAlongMm;
  if (
    isWallHostedDoorItem(win) &&
    doorCatalogWidthsMm &&
    doorCatalogWidthsMm.length > 0
  ) {
    const snapped = snapWallDoorSpanAfterEndpointDrag(
      total,
      startAlongMm,
      endAlongMm,
      which,
      doorCatalogWidthsMm
    );
    if (snapped) {
      sOut = snapped.startAlongMm;
      eOut = snapped.endAlongMm;
    }
  }

  const payload = { wallId: wall.id, startAlongMm: sOut, endAlongMm: eOut };
  const next =
    win.itemId === "wall-window" || isWallHostedDoorItem(win)
      ? layoutWallWindowObject(wall, win, payload)
      : null;
  if (!next) return objects;
  return objects.map((o) => (o.id === windowId ? next : o));
}

/**
 * After editing a wall’s centerline in place: keep each window’s spine endpoints at the same **world**
 * positions (projected onto the new polyline). Pure arc-length sync would make openings slide along the
 * wall when vertices move perpendicular to the spine.
 */
export function reanchorWallWindowsAfterCenterlineEdit(
  objects: VectorObject[],
  wallId: string,
  previousCenterline: Vec2[]
): VectorObject[] {
  const wall = objects.find((o) => o.id === wallId);
  const newCl = wall?.centerline;
  if (!wall || !newCl || newCl.length < 2 || previousCenterline.length < 2) {
    return syncWallWindowsForWall(objects, wallId);
  }
  const wallOld: VectorObject = { ...wall, centerline: previousCenterline };
  const result: VectorObject[] = [];
  for (const obj of objects) {
    const hosted =
      obj.wallWindowRef?.wallId === wallId &&
      (obj.itemId === "wall-window" || isWallHostedDoorItem(obj));
    if (!hosted) {
      result.push(obj);
      continue;
    }
    const ref = obj.wallWindowRef;
    if (!ref) {
      result.push(obj);
      continue;
    }
    const norm = normalizeWallWindowRef(wallOld, ref);
    if (!norm) {
      const normNew = normalizeWallWindowRef(wall, ref);
      if (normNew) {
        const fb = layoutWallWindowObject(wall, obj, normNew);
        if (fb) result.push(fb);
        else result.push(obj);
      } else result.push(obj);
      continue;
    }
    const aWorld = pointAtDistanceAlongPolyline(previousCenterline, norm.startAlongMm);
    const bWorld = pointAtDistanceAlongPolyline(previousCenterline, norm.endAlongMm);
    let newS = distanceAlongPolylineToPoint(newCl, aWorld);
    let newE = distanceAlongPolylineToPoint(newCl, bWorld);
    let s = Math.min(newS, newE);
    let e = Math.max(newS, newE);
    const total = polylineTotalLength(newCl);
    s = Math.max(0, Math.min(total, s));
    e = Math.max(0, Math.min(total, e));
    if (e - s < MIN_WALL_WINDOW_SPAN_MM) {
      const mid = (s + e) / 2;
      s = Math.max(0, mid - MIN_WALL_WINDOW_SPAN_MM / 2);
      e = Math.min(total, s + MIN_WALL_WINDOW_SPAN_MM);
      s = Math.max(0, e - MIN_WALL_WINDOW_SPAN_MM);
    }
    const payload = { wallId: wall.id, startAlongMm: s, endAlongMm: e };
    let next = layoutWallWindowObject(wall, obj, payload);
    if (!next) {
      const normNew = normalizeWallWindowRef(wall, ref);
      if (normNew) {
        next = layoutWallWindowObject(wall, obj, normNew);
      }
    }
    if (next) result.push(next);
    else result.push(obj);
  }
  return result;
}

/**
 * Recompute every wall-window whose `wallWindowRef.wallId` matches `wallId`.
 * Removes windows if the wall is missing or invalid, or if the span collapses.
 */
export function syncWallWindowsForWall(objects: VectorObject[], wallId: string): VectorObject[] {
  const wall = objects.find((o) => o.id === wallId);
  if (!wall?.centerline || wall.centerline.length < 2) {
    return objects.filter(
      (o) =>
        !(
          o.wallWindowRef?.wallId === wallId &&
          (o.itemId === "wall-window" || isWallHostedDoorItem(o))
        )
    );
  }
  const result: VectorObject[] = [];
  for (const obj of objects) {
    const onWall =
      obj.wallWindowRef?.wallId === wallId &&
      (obj.itemId === "wall-window" || isWallHostedDoorItem(obj));
    if (!onWall) {
      result.push(obj);
      continue;
    }
    const ref = obj.wallWindowRef;
    if (!ref) continue;
    const norm = normalizeWallWindowRef(wall, ref);
    if (!norm) continue;
    const next = layoutWallWindowObject(wall, obj, norm);
    if (next) result.push(next);
  }
  return result;
}

function isWallHostedOpeningOrphan(obj: VectorObject): boolean {
  if (!obj.wallWindowRef) return false;
  if (obj.itemId === "wall-window") return true;
  return isWallHostedDoorItem(obj);
}

/** After load or bulk wall edits: drop orphans, then resync all wall-anchored windows. */
export function syncAllWallWindows(objects: VectorObject[]): VectorObject[] {
  const wallIds = new Set(
    objects.filter((o) => isWallHostForOpenings(o)).map((o) => o.id)
  );
  let next = objects.filter(
    (o) =>
      !(isWallHostedOpeningOrphan(o) && o.wallWindowRef && !wallIds.has(o.wallWindowRef.wallId))
  );
  for (const id of wallIds) {
    next = syncWallWindowsForWall(next, id);
  }
  return next;
}
