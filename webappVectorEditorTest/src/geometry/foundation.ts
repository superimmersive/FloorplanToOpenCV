import { vec2, type Vec2, type VectorObject } from "./types";
import { isWallPolylineOpen, pathToPolygon } from "./drawPath";
import { effectiveWallDrawWidthMm } from "./wallDrawWidth";
import { isInnerWallPolylineObject, isWallPolylineObject } from "./wallWindow";
import { CEILING_LAYER_ID, FLOOR_LAYER_ID, FOUNDATION_LAYER_ID } from "../state/editorState";
import { subtractUnionFromSubjectSync } from "./clipperSubtract";

const FLOOR_RING_EPS_MM = 1e-3;
/** Drop slivers from boolean split (mm²). */
const MIN_ROOM_AREA_MM2 = 1e4;
/**
 * Half-width (mm) for the clipper “knife” along inner wall **centerlines** only.
 * Full wall stroke width is not subtracted from the floor — rooms meet at the partition spine.
 * Must be positive for Clipper/pathToPolygon; keep small so the split follows the centerline visually.
 */
const ROOM_SPLIT_CENTERLINE_HALF_MM = 0.5;

function samePointFloor(a: Vec2, b: Vec2): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < FLOOR_RING_EPS_MM;
}

/** Shoelace signed area (mm²); positive ⇒ CCW in Y-up plan when viewed from +Z. */
function signedArea2D(verts: Vec2[]): number {
  let sum = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  return sum / 2;
}

/**
 * One plan polygon for floor and ceiling: closed **outer** wall centerline as boundary (interior of the loop).
 * Returns null if the wall is open, not an outer wall, or the ring is degenerate.
 */
export function computeFloorPolygonFromClosedOuterWall(wall: VectorObject): Vec2[] | null {
  if (!isWallPolylineObject(wall)) return null;
  const cl = wall.centerline;
  if (!cl || cl.length < 2) return null;
  if (isWallPolylineOpen(cl)) return null;

  let ring = cl.map((p) => vec2(p.x, p.y));
  if (samePointFloor(ring[0], ring[ring.length - 1])) {
    ring = ring.slice(0, -1);
  }
  if (ring.length < 3) return null;

  const area = signedArea2D(ring);
  if (Math.abs(area) < FLOOR_RING_EPS_MM) return null;
  const ccw = area > 0 ? ring : [...ring].reverse();
  return ccw;
}

function ensureCCWPlan(verts: Vec2[]): Vec2[] {
  const a = signedArea2D(verts);
  if (a < 0) return [...verts].reverse();
  return verts;
}

function polygonCentroid(verts: Vec2[]): Vec2 {
  let sx = 0;
  let sy = 0;
  for (const v of verts) {
    sx += v.x;
    sy += v.y;
  }
  const n = verts.length;
  return vec2(sx / n, sy / n);
}

/**
 * Axis-aligned rectangle (4 corners, CCW in Y-up plan) that bounds the wall stroke:
 * min/max of the outline from {@link pathToPolygon} (axis-aligned wall segments).
 */
export function computeFoundationAxisAlignedRect(wall: VectorObject): Vec2[] | null {
  const cl = wall.centerline;
  if (!cl || cl.length < 2) return null;
  const halfW = effectiveWallDrawWidthMm(wall) / 2;
  const outline = pathToPolygon(cl, halfW);
  if (outline.length >= 3) {
    return aabbQuadFromPoints(outline);
  }
  return aabbQuadFromCenterlinePadded(cl, halfW);
}

function aabbQuadFromPoints(pts: Vec2[]): Vec2[] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of pts) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;
  return [
    vec2(minX, minY),
    vec2(maxX, minY),
    vec2(maxX, maxY),
    vec2(minX, maxY),
  ];
}

/** Fallback when pathToPolygon returns empty: pad centerline bbox isotropically by half width. */
function aabbQuadFromCenterlinePadded(cl: Vec2[], halfW: number): Vec2[] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of cl) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return null;
  minX -= halfW;
  minY -= halfW;
  maxX += halfW;
  maxY += halfW;
  if (maxX <= minX || maxY <= minY) return null;
  return [
    vec2(minX, minY),
    vec2(maxX, minY),
    vec2(maxX, maxY),
    vec2(minX, maxY),
  ];
}

/**
 * Drops existing foundation/floor/ceiling derived objects and rebuilds them.
 * Foundation: full wall stroke outline per outer wall.
 * Floor and ceiling: interior of each **closed** outer wall loop; when inner (partition) walls exist,
 * the shell is split with Clipper2 along each inner wall **centerline** (thin strip, not full wall width)
 * so each **room** gets its own floor/ceiling polygon.
 * Order: foundations, floors, ceilings, then other objects so walls draw on top in plan.
 */
export function syncFoundationObjects(objects: VectorObject[]): VectorObject[] {
  const without = objects.filter(
    (o) => o.itemId !== "foundation" && o.itemId !== "floor" && o.itemId !== "ceiling"
  );

  const innerWallCenterlineCutPolys: Vec2[][] = [];
  for (const w of without) {
    if (!isInnerWallPolylineObject(w)) continue;
    const cl = w.centerline;
    if (!cl || cl.length < 2) continue;
    const outline = pathToPolygon(cl, ROOM_SPLIT_CENTERLINE_HALF_MM);
    if (outline.length >= 3) innerWallCenterlineCutPolys.push(outline);
  }

  const foundations: VectorObject[] = [];
  const floors: VectorObject[] = [];
  const ceilings: VectorObject[] = [];
  for (const wall of without) {
    if (!isWallPolylineObject(wall)) continue;
    const foundationVerts = computeFoundationAxisAlignedRect(wall);
    if (!foundationVerts || foundationVerts.length < 4) continue;
    foundations.push({
      id: `foundation-${wall.id}`,
      layerId: FOUNDATION_LAYER_ID,
      transform: { position: vec2(0, 0), rotationDeg: 0, scale: vec2(1, 1) },
      polygons: [{ id: `poly-foundation-${wall.id}`, verts: foundationVerts }],
      itemId: "foundation",
      itemLabel: "Foundation",
      foundationForWallId: wall.id,
    });
  }
  for (const wall of without) {
    if (!isWallPolylineObject(wall)) continue;
    const shellVerts = computeFloorPolygonFromClosedOuterWall(wall);
    if (!shellVerts || shellVerts.length < 3) continue;

    let pieces: Vec2[][] = [shellVerts];
    if (innerWallCenterlineCutPolys.length > 0) {
      const cut = subtractUnionFromSubjectSync(shellVerts, innerWallCenterlineCutPolys);
      if (cut && cut.length > 0) {
        const filtered = cut
          .map(ensureCCWPlan)
          .filter((p) => Math.abs(signedArea2D(p)) >= MIN_ROOM_AREA_MM2);
        if (filtered.length > 0) {
          filtered.sort((a, b) => {
            const ca = polygonCentroid(a);
            const cb = polygonCentroid(b);
            if (ca.x !== cb.x) return ca.x - cb.x;
            return ca.y - cb.y;
          });
          pieces = filtered;
        }
      }
    }

    const multiRoom = pieces.length > 1;
    for (let ri = 0; ri < pieces.length; ri++) {
      const verts = pieces[ri];
      const suffix = multiRoom ? `-r${ri}` : "";
      floors.push({
        id: `floor-outer-${wall.id}${suffix}`,
        layerId: FLOOR_LAYER_ID,
        transform: { position: vec2(0, 0), rotationDeg: 0, scale: vec2(1, 1) },
        polygons: [{ id: `poly-floor-outer-${wall.id}${suffix}`, verts }],
        itemId: "floor",
        itemLabel: multiRoom ? `Floor (room ${ri + 1})` : "Floor",
        floorForWallId: wall.id,
        ...(multiRoom ? { floorRoomIndex: ri } : {}),
      });
      ceilings.push({
        id: `ceiling-outer-${wall.id}${suffix}`,
        layerId: CEILING_LAYER_ID,
        transform: { position: vec2(0, 0), rotationDeg: 0, scale: vec2(1, 1) },
        polygons: [{ id: `poly-ceiling-outer-${wall.id}${suffix}`, verts }],
        itemId: "ceiling",
        itemLabel: multiRoom ? `Ceiling (room ${ri + 1})` : "Ceiling",
        ceilingForWallId: wall.id,
        ...(multiRoom ? { ceilingRoomIndex: ri } : {}),
      });
    }
  }
  return [...foundations, ...floors, ...ceilings, ...without];
}
