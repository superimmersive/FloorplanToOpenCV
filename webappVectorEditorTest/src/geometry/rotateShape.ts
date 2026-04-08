import { getObjectsBbox } from "./bbox";
import type { Vec2, VectorObject } from "./types";
import { getPolygonContour, vec2 } from "./types";

/** Rotate every point in world space about `center` by `deltaDeg` (degrees, CCW in standard math / +Y up). */
function rotatePoint(p: Vec2, center: Vec2, deltaDeg: number): Vec2 {
  const r = (deltaDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const x = p.x - center.x;
  const y = p.y - center.y;
  return vec2(center.x + x * c - y * s, center.y + x * s + y * c);
}

/**
 * Returns a copy of `source` with geometry rotated about `center` by `deltaDeg`.
 * `transform.rotationDeg` becomes `source.transform.rotationDeg + deltaDeg`.
 */
export function rotateObjectGeometry(source: VectorObject, center: Vec2, deltaDeg: number): VectorObject {
  const rot = (p: Vec2) => rotatePoint(p, center, deltaDeg);
  return {
    ...source,
    transform: {
      ...source.transform,
      rotationDeg: source.transform.rotationDeg + deltaDeg,
    },
    polygons: source.polygons.map((poly) => ({
      ...poly,
      verts: poly.verts.map(rot),
      holes: poly.holes?.map((hole) => hole.map(rot)),
    })),
    ...(source.centerline != null && source.centerline.length > 0
      ? { centerline: source.centerline.map(rot) }
      : {}),
  };
}

/** Shortest signed difference between two angles (radians), in (-π, π]. */
export function angleDeltaRad(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Default rotation snap increment (degrees) for the Rotate tool drag delta. */
export const ROTATE_SNAP_DEG_DEFAULT = 45;

/** Snap `deg` to the nearest multiple of `stepDeg` (e.g. step 45 → …, −90, −45, 0, 45, 90, …). */
export function snapAngleDeg(deg: number, stepDeg: number): number {
  if (stepDeg <= 0) return deg;
  return Math.round(deg / stepDeg) * stepDeg;
}

/** Max distance from `center` to any vertex, hole point, or centerline point (mm). */
function maxExtentFromCenterMm(center: Vec2, obj: VectorObject): number {
  let maxD = 0;
  for (const poly of obj.polygons) {
    for (const v of getPolygonContour(poly, undefined)) {
      maxD = Math.max(maxD, Math.hypot(v.x - center.x, v.y - center.y));
    }
    const holes = poly.holes ?? [];
    for (let h = 0; h < holes.length; h++) {
      for (const v of getPolygonContour(poly, h)) {
        maxD = Math.max(maxD, Math.hypot(v.x - center.x, v.y - center.y));
      }
    }
  }
  if (obj.centerline && obj.centerline.length > 0) {
    for (const p of obj.centerline) {
      maxD = Math.max(maxD, Math.hypot(p.x - center.x, p.y - center.y));
    }
  }
  return maxD;
}

/**
 * Ring radius outside the shape (mm). Uses radial extent from pivot, not AABB half-size, so it does not
 * grow when a square is rotated to 45° (axis-aligned bbox inflates; distance to corners does not).
 */
function manipulatorRadiusMmForObject(center: Vec2, obj: VectorObject): number {
  const base = maxExtentFromCenterMm(center, obj);
  return Math.max(base + 80, 100);
}

/** Handle sits on the ring at angle given by `rotationDeg` (0° = +X). */
export function rotateHandleWorld(center: Vec2, rotationDeg: number, radiusMm: number): Vec2 {
  const r = (rotationDeg * Math.PI) / 180;
  return vec2(center.x + radiusMm * Math.cos(r), center.y + radiusMm * Math.sin(r));
}

export function getRotateManipulatorForObject(obj: VectorObject): {
  center: Vec2;
  radiusMm: number;
  handleWorld: Vec2;
} | null {
  const bbox = getObjectsBbox([obj]);
  if (!bbox) return null;
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const center = vec2(cx, cy);
  const radiusMm = manipulatorRadiusMmForObject(center, obj);
  const handleWorld = rotateHandleWorld(center, obj.transform.rotationDeg, radiusMm);
  return { center, radiusMm, handleWorld };
}
