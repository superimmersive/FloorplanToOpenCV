import type { Polygon, Vec2 } from "./types";
import { vec2 } from "./types";
import { removeCollinearVertsPolyline } from "./polygonUtils";

/** Legacy default stroke width (mm) for older documents without `drawWidthMm` on outer walls. */
export const LEGACY_WALL_WIDTH_MM = 100;
/** @deprecated Prefer {@link LEGACY_WALL_WIDTH_MM} or per-object `drawWidthMm`. */
export const DRAW_BRUSH_WIDTH_MM = LEGACY_WALL_WIDTH_MM;
const HALF_WIDTH = DRAW_BRUSH_WIDTH_MM / 2;

/** Right perpendicular to direction (dx, dy): in our coords (y up), right of (1,0) is (0,1). */
function rightPerp(dx: number, dy: number): Vec2 {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return vec2(0, dx >= 0 ? 1 : -1);
  }
  return vec2(dy >= 0 ? -1 : 1, 0);
}

/**
 * Build outline polygon from an axis-aligned polyline with given half-width.
 * Path must have at least 2 points; each segment is horizontal or vertical.
 */
export function pathToPolygon(points: Vec2[], halfWidthMm: number = HALF_WIDTH): Vec2[] {
  if (points.length < 2) return [];
  const n = points.length - 1;
  const right: Vec2[] = [];
  const left: Vec2[] = [];

  for (let i = 0; i <= n; i++) {
    const p = points[i];
    if (i === 0) {
      const dx = points[1].x - p.x;
      const dy = points[1].y - p.y;
      const r = rightPerp(dx, dy);
      right.push(vec2(p.x + r.x * halfWidthMm, p.y + r.y * halfWidthMm));
      left.push(vec2(p.x - r.x * halfWidthMm, p.y - r.y * halfWidthMm));
    } else if (i === n) {
      const dx = p.x - points[i - 1].x;
      const dy = p.y - points[i - 1].y;
      const r = rightPerp(dx, dy);
      right.push(vec2(p.x + r.x * halfWidthMm, p.y + r.y * halfWidthMm));
      left.push(vec2(p.x - r.x * halfWidthMm, p.y - r.y * halfWidthMm));
    } else {
      const dxPrev = p.x - points[i - 1].x;
      const dyPrev = p.y - points[i - 1].y;
      const dxNext = points[i + 1].x - p.x;
      const dyNext = points[i + 1].y - p.y;
      const rPrev = rightPerp(dxPrev, dyPrev);
      const rNext = rightPerp(dxNext, dyNext);
      if (rPrev.x === rNext.x && rPrev.y === rNext.y) {
        // Straight line: same perpendicular both sides; use one offset so width stays constant
        right.push(vec2(p.x + rPrev.x * halfWidthMm, p.y + rPrev.y * halfWidthMm));
        left.push(vec2(p.x - rPrev.x * halfWidthMm, p.y - rPrev.y * halfWidthMm));
      } else {
        // Corner: miter using sum of perpendiculars
        const rx = rPrev.x + rNext.x;
        const ry = rPrev.y + rNext.y;
        right.push(vec2(p.x + rx * halfWidthMm, p.y + ry * halfWidthMm));
        left.push(vec2(p.x - rx * halfWidthMm, p.y - ry * halfWidthMm));
      }
    }
  }

  const outline: Vec2[] = [...right];
  for (let i = left.length - 1; i >= 0; i--) {
    outline.push(left[i]);
  }
  return outline;
}

const AXIS_MM_EPS = 1e-3;

/** True if each segment is axis-aligned and each interior vertex is a 90° turn (orthogonal open polyline). */
export function isOrthogonalStairCenterline(points: Vec2[]): boolean {
  if (points.length < 2) return false;
  for (let k = 0; k < points.length - 1; k++) {
    const ax = segmentAxisAligned(points[k], points[k + 1]);
    if (!ax) return false;
  }
  if (points.length === 2) return true;
  for (let i = 1; i < points.length - 1; i++) {
    const a = segmentAxisAligned(points[i - 1], points[i]);
    const b = segmentAxisAligned(points[i], points[i + 1]);
    if (!a || !b || a.horiz === b.horiz) return false;
  }
  return true;
}

/** True if three points form one horizontal and one vertical segment (L). */
export function isAxisAlignedLShape(points: Vec2[]): boolean {
  return points.length === 3 && isOrthogonalStairCenterline(points);
}

function segmentAxisAligned(a: Vec2, b: Vec2): { horiz: boolean } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) > AXIS_MM_EPS && Math.abs(dy) < AXIS_MM_EPS) return { horiz: true };
  if (Math.abs(dy) > AXIS_MM_EPS && Math.abs(dx) < AXIS_MM_EPS) return { horiz: false };
  return null;
}

/**
 * Tile an orthogonal stair centerline with axis-aligned quads: one trimmed run per segment plus one
 * 2w×2w corner square at each bend (L → 1 corner + 2 runs; U with 3 segments → 2 corners + 3 runs).
 * Collinear vertices are merged first. Returns null if not orthogonal or segments too short for half-width w.
 */
export function buildStairsLShapeQuadPolygons(points: Vec2[], halfWidthMm: number): Vec2[][] | null {
  if (halfWidthMm <= 0) return null;
  const collapsed = removeCollinearVertsPolyline(points, 0.5);
  if (collapsed.length < 2) return null;
  const w = halfWidthMm;
  const m = collapsed.length - 1;

  if (!isOrthogonalStairCenterline(collapsed)) return null;

  for (let k = 0; k < m; k++) {
    const segl = Math.hypot(
      collapsed[k + 1].x - collapsed[k].x,
      collapsed[k + 1].y - collapsed[k].y
    );
    let minLen = AXIS_MM_EPS;
    if (k > 0) minLen += w;
    if (k < m - 1) minLen += w;
    if (segl < minLen) return null;
  }

  const quads: Vec2[][] = [];

  for (let i = 1; i < m; i++) {
    const px = collapsed[i].x;
    const py = collapsed[i].y;
    quads.push([
      vec2(px - w, py - w),
      vec2(px + w, py - w),
      vec2(px + w, py + w),
      vec2(px - w, py + w),
    ]);
  }

  for (let k = 0; k < m; k++) {
    const Pk = collapsed[k];
    const Pk1 = collapsed[k + 1];
    const ax = segmentAxisAligned(Pk, Pk1)!;
    if (ax.horiz) {
      const tx = Pk1.x >= Pk.x ? 1 : -1;
      const y = Pk.y;
      const xStart = k === 0 ? Pk.x : Pk.x + tx * w;
      const xEnd = k === m - 1 ? Pk1.x : Pk1.x - tx * w;
      const xLo = Math.min(xStart, xEnd);
      const xHi = Math.max(xStart, xEnd);
      if (xHi - xLo < AXIS_MM_EPS) continue;
      quads.push([
        vec2(xLo, y - w),
        vec2(xHi, y - w),
        vec2(xHi, y + w),
        vec2(xLo, y + w),
      ]);
    } else {
      const ty = Pk1.y >= Pk.y ? 1 : -1;
      const x = Pk.x;
      const yStart = k === 0 ? Pk.y : Pk.y + ty * w;
      const yEnd = k === m - 1 ? Pk1.y : Pk1.y - ty * w;
      const yLo = Math.min(yStart, yEnd);
      const yHi = Math.max(yStart, yEnd);
      if (yHi - yLo < AXIS_MM_EPS) continue;
      quads.push([
        vec2(x - w, yLo),
        vec2(x + w, yLo),
        vec2(x + w, yHi),
        vec2(x - w, yHi),
      ]);
    }
  }

  return quads.length > 0 ? quads : null;
}

/** Outline from centerline for stairs: orthogonal runs + corner squares; otherwise miter outline. */
export function pathToPolygonForStairs(points: Vec2[], halfWidthMm: number): Vec2[][] {
  const quads = buildStairsLShapeQuadPolygons(points, halfWidthMm);
  if (quads) return quads;
  return [pathToPolygon(points, halfWidthMm)];
}

/** Polygons for a stair object from centerline + half-width (one outline, or multiple quads for orthogonal runs + corners). */
export function polygonsFromStairsCenterline(points: Vec2[], halfWidthMm: number, basePolyId: string): Polygon[] {
  const regions = pathToPolygonForStairs(points, halfWidthMm);
  if (regions.length === 1) {
    return [{ id: basePolyId, verts: regions[0] }];
  }
  return regions.map((verts, i) => ({
    id: `${basePolyId}-q${i}`,
    verts,
  }));
}

/** Join tolerance when merging a continue-wall stroke onto an endpoint (matches completeDrawing). */
const MERGE_JOIN_EPS = 1e-4;

function nearlySamePointForMerge(
  a: { x: number; y: number },
  b: { x: number; y: number }
): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < MERGE_JOIN_EPS;
}

/**
 * Merge a draw path into an existing wall centerline when continuing from an endpoint (0 or last).
 * Drops the duplicate first point when it matches the anchor. Same rules as completing a continue-wall draw.
 */
export function mergeWallDrawIntoCenterline(
  centerline: { x: number; y: number }[],
  drawPath: { x: number; y: number }[],
  fromPointIndex: number
): Vec2[] | null {
  if (!centerline || centerline.length < 2 || !drawPath || drawPath.length < 1) return null;
  const cl = centerline;
  const lastI = cl.length - 1;
  if (fromPointIndex !== 0 && fromPointIndex !== lastI) return null;
  const firstNew = drawPath[0];
  if (fromPointIndex === lastI) {
    const lastOld = cl[lastI];
    const join = nearlySamePointForMerge(firstNew, lastOld) ? drawPath.slice(1) : drawPath;
    return [...cl.map((p) => vec2(p.x, p.y)), ...join.map((p) => vec2(p.x, p.y))];
  }
  const firstOld = cl[0];
  const join = nearlySamePointForMerge(firstNew, firstOld) ? drawPath.slice(1) : drawPath;
  const extensionReversed = join.map((p) => vec2(p.x, p.y)).reverse();
  return [...extensionReversed, ...cl.map((p) => vec2(p.x, p.y))];
}

/** Snap a point so the segment from prev to result is either horizontal or vertical (dominant axis). */
export function snapToAxisAligned(prev: Vec2, current: Vec2): Vec2 {
  const dx = Math.abs(current.x - prev.x);
  const dy = Math.abs(current.y - prev.y);
  if (dx >= dy) {
    return vec2(current.x, prev.y);
  }
  return vec2(prev.x, current.y);
}

/**
 * True if last→next continues along the same axis as prev→last but reverses direction
 * (e.g. left then right on the same line). Perpendicular turns are allowed.
 */
export function isAxisReversingWallSegment(prev: Vec2, last: Vec2, next: Vec2): boolean {
  const pdx = last.x - prev.x;
  const pdy = last.y - prev.y;
  const ndx = next.x - last.x;
  const ndy = next.y - last.y;

  const prevHoriz = Math.abs(pdy) < AXIS_MM_EPS && Math.abs(pdx) > AXIS_MM_EPS;
  const prevVert = Math.abs(pdx) < AXIS_MM_EPS && Math.abs(pdy) > AXIS_MM_EPS;
  const newHoriz = Math.abs(ndy) < AXIS_MM_EPS && Math.abs(ndx) > AXIS_MM_EPS;
  const newVert = Math.abs(ndx) < AXIS_MM_EPS && Math.abs(ndy) > AXIS_MM_EPS;

  if (prevHoriz && newHoriz) {
    const sp = Math.sign(pdx);
    const sn = Math.sign(ndx);
    if (sp !== 0 && sn !== 0 && sp !== sn) return true;
  }
  if (prevVert && newVert) {
    const sp = Math.sign(pdy);
    const sn = Math.sign(ndy);
    if (sp !== 0 && sn !== 0 && sp !== sn) return true;
  }
  return false;
}

/** How a completed-measure vertex may move: along its axis-aligned incident segment only. */
export type MeasureVertexDragLock =
  | { kind: "horizontal"; fixedY: number }
  | { kind: "vertical"; fixedX: number }
  | { kind: "free" };

/**
 * Incoming segment (i-1)→i takes precedence, else outgoing i→(i+1).
 * Horizontal segment → only x may change; vertical → only y.
 */
export function measureVertexDragLock(path: Vec2[], index: number): MeasureVertexDragLock {
  if (path.length < 2 || index < 0 || index >= path.length) return { kind: "free" };

  if (index > 0) {
    const a = path[index - 1];
    const b = path[index];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dy < AXIS_MM_EPS && dx >= AXIS_MM_EPS) return { kind: "horizontal", fixedY: a.y };
    if (dx < AXIS_MM_EPS && dy >= AXIS_MM_EPS) return { kind: "vertical", fixedX: a.x };
  }
  if (index < path.length - 1) {
    const a = path[index];
    const b = path[index + 1];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dy < AXIS_MM_EPS && dx >= AXIS_MM_EPS) return { kind: "horizontal", fixedY: a.y };
    if (dx < AXIS_MM_EPS && dy >= AXIS_MM_EPS) return { kind: "vertical", fixedX: a.x };
  }
  return { kind: "free" };
}

const CLOSE_LOOP_EPS = 1e-3;

function samePointMm(a: Vec2, b: Vec2): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < CLOSE_LOOP_EPS;
}

/**
 * Points to append after `end` (open end of the wall) to reach `start` with axis-aligned segments.
 * - Same row or column: one straight segment to `start`.
 * - Otherwise (L / U style): if end is **below** start (smaller Y), go **vertical** to start’s Y then **horizontal** to start;
 *   if end is **above** start (larger Y), go **horizontal** to start’s X then **vertical** to start.
 * (Matches foundation-style U/L thinking: equalise leg height first when moving up, or align X first when moving down.)
 */
export function computeClosingExtensionToStart(end: Vec2, start: Vec2): Vec2[] {
  if (samePointMm(end, start)) return [];

  const sameRow = Math.abs(end.y - start.y) < CLOSE_LOOP_EPS;
  const sameCol = Math.abs(end.x - start.x) < CLOSE_LOOP_EPS;

  if (sameRow) {
    return [vec2(start.x, start.y)];
  }
  if (sameCol) {
    return [vec2(start.x, start.y)];
  }

  if (end.y < start.y) {
    const corner = vec2(end.x, start.y);
    if (samePointMm(corner, start)) {
      return [vec2(start.x, start.y)];
    }
    return [corner, vec2(start.x, start.y)];
  }

  // end.y > start.y
  const corner = vec2(start.x, end.y);
  if (samePointMm(corner, end)) {
    return [vec2(start.x, start.y)];
  }
  return [corner, vec2(start.x, start.y)];
}

function segmentIsAxisAlignedNonDegenerate(a: Vec2, b: Vec2): boolean {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx < CLOSE_LOOP_EPS && dy < CLOSE_LOOP_EPS) return false;
  return dx < CLOSE_LOOP_EPS || dy < CLOSE_LOOP_EPS;
}

/**
 * Append corners then the start point to close an axis-aligned wall polyline, or validate already-closed path.
 * Rules:
 * - A single segment (2 points only) cannot become a closed loop.
 * - If the open end is not on the same row or column as the start, inserts an orthogonal **L** path
 *   (vertical-then-horizontal when the end is below the start, horizontal-then-vertical when above).
 * - Must not reverse direction along the same axis (same rules as drawing).
 */
export function tryCloseWallLoop(
  path: Vec2[]
): { ok: true; closedPath: Vec2[] } | { ok: false; reason: string } {
  if (!path || path.length < 2) {
    return { ok: false, reason: "Add at least two points before closing a loop." };
  }
  if (path.length === 2) {
    return {
      ok: false,
      reason:
        "A wall that is only one straight segment cannot form a closed loop. Add at least one more corner first.",
    };
  }
  const first = path[0];
  const last = path[path.length - 1];
  if (samePointMm(first, last)) {
    return { ok: true, closedPath: path.map((p) => vec2(p.x, p.y)) };
  }

  const prev = path[path.length - 2];
  const extension = computeClosingExtensionToStart(last, first);

  let chain = [...path.map((p) => vec2(p.x, p.y))];
  for (let i = 0; i < extension.length; i++) {
    const next = extension[i];
    const pLast = chain[chain.length - 1];
    const pPrev = chain[chain.length - 2];

    if (!segmentIsAxisAlignedNonDegenerate(pLast, next)) {
      return {
        ok: false,
        reason: "Close loop would create a zero-length segment. Adjust the wall.",
      };
    }
    if (isAxisReversingWallSegment(pPrev, pLast, next)) {
      return {
        ok: false,
        reason: "That closing path would double back along the wall. Adjust the last corner.",
      };
    }
    chain.push(next);
  }

  if (!samePointMm(chain[chain.length - 1], first)) {
    return { ok: false, reason: "Close loop did not reach the start point." };
  }

  return { ok: true, closedPath: chain };
}

/** True when the polyline does not return to the start (open wall). */
export function isWallPolylineOpen(path: Vec2[] | { x: number; y: number }[]): boolean {
  if (!path || path.length < 2) return false;
  const a = path[0];
  const b = path[path.length - 1];
  return Math.hypot(a.x - b.x, a.y - b.y) >= CLOSE_LOOP_EPS;
}
