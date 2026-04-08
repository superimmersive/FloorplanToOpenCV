import type { Vec2, VectorObject } from "./types";
import { vec2 } from "./types";

export type SnapVertexExclude = {
  objectId: string;
  /** When dragging this centerline vertex, omit it from alignment targets. */
  centerlinePointIndex?: number;
};

/**
 * All polygon / hole / centerline vertices from every object (world mm).
 * Optional extra points (e.g. in-progress draw path) and exclusion of one centerline handle.
 */
export function collectAlignmentVertices(
  objects: VectorObject[],
  extraPoints?: Vec2[] | null,
  exclude?: SnapVertexExclude | null
): Vec2[] {
  const out: Vec2[] = [];
  for (const o of objects) {
    const cl = o.centerline;
    if (cl) {
      for (let i = 0; i < cl.length; i++) {
        if (exclude?.objectId === o.id && exclude.centerlinePointIndex === i) continue;
        out.push(vec2(cl[i].x, cl[i].y));
      }
    }
    for (const poly of o.polygons) {
      for (const v of poly.verts) out.push(vec2(v.x, v.y));
      for (const hole of poly.holes ?? []) {
        for (const v of hole) out.push(vec2(v.x, v.y));
      }
    }
  }
  if (extraPoints) {
    for (const p of extraPoints) out.push(vec2(p.x, p.y));
  }
  return out;
}

function considerCandidate(value: number, c: number, best: number, bestD: number): { best: number; bestD: number } {
  const d = Math.abs(c - value);
  if (d < bestD - 1e-12) {
    return { best: c, bestD: d };
  }
  return { best, bestD };
}

/** Snap one world X to the closest of: raw, grid, or any vertex x within tolerance (mm). */
export function snapWorldXToGridAndVertices(
  x: number,
  vertices: Vec2[],
  gridMm: number,
  toleranceMm: number,
  snapEnabled: boolean
): number {
  if (!snapEnabled) return x;
  return bestSnapX(x, gridMm, toleranceMm, vertices);
}

/** Snap one world Y (same semantics as {@link snapWorldXToGridAndVertices}). */
export function snapWorldYToGridAndVertices(
  y: number,
  vertices: Vec2[],
  gridMm: number,
  toleranceMm: number,
  snapEnabled: boolean
): number {
  if (!snapEnabled) return y;
  return bestSnapY(y, gridMm, toleranceMm, vertices);
}

function bestSnapX(value: number, gridMm: number, toleranceMm: number, vertices: Vec2[]): number {
  let best = value;
  let bestD = Infinity;
  ({ best, bestD } = considerCandidate(value, value, best, bestD));
  if (gridMm > 0) {
    const g = Math.round(value / gridMm) * gridMm;
    ({ best, bestD } = considerCandidate(value, g, best, bestD));
  }
  if (toleranceMm > 0) {
    for (const v of vertices) {
      const tv = v.x;
      if (Math.abs(tv - value) <= toleranceMm) {
        ({ best, bestD } = considerCandidate(value, tv, best, bestD));
      }
    }
  }
  return best;
}

function bestSnapY(value: number, gridMm: number, toleranceMm: number, vertices: Vec2[]): number {
  let best = value;
  let bestD = Infinity;
  ({ best, bestD } = considerCandidate(value, value, best, bestD));
  if (gridMm > 0) {
    const g = Math.round(value / gridMm) * gridMm;
    ({ best, bestD } = considerCandidate(value, g, best, bestD));
  }
  if (toleranceMm > 0) {
    for (const v of vertices) {
      const tv = v.y;
      if (Math.abs(tv - value) <= toleranceMm) {
        ({ best, bestD } = considerCandidate(value, tv, best, bestD));
      }
    }
  }
  return best;
}

/**
 * Orthogonal snap: per axis, pick the candidate (pointer, grid, or vertex coordinate within tolerance)
 * closest to the raw value. When snap is disabled, returns `p` unchanged.
 */
export function snapWorldPointToGridAndVertices(
  p: Vec2,
  vertices: Vec2[],
  options: { snapEnabled: boolean; gridMm: number; toleranceMm: number }
): Vec2 {
  if (!options.snapEnabled) return p;
  const { gridMm, toleranceMm } = options;
  if (gridMm <= 0 && toleranceMm <= 0) return p;
  return vec2(
    bestSnapX(p.x, gridMm, toleranceMm, vertices),
    bestSnapY(p.y, gridMm, toleranceMm, vertices)
  );
}

const AXIS_LOCK_EPS = 1e-6;

/**
 * After {@link snapToAxisAligned}, one axis matches `last`. Snap the free axis to grid + vertices;
 * keep the locked axis exactly equal to `last` (orthogonal walls stay straight).
 */
export function snapAxisLockedToGridAndVertices(
  last: Vec2,
  aligned: Vec2,
  vertices: Vec2[],
  gridMm: number,
  toleranceMm: number
): Vec2 {
  const horiz = Math.abs(aligned.y - last.y) < AXIS_LOCK_EPS;
  if (horiz) {
    return vec2(bestSnapX(aligned.x, gridMm, toleranceMm, vertices), last.y);
  }
  return vec2(last.x, bestSnapY(aligned.y, gridMm, toleranceMm, vertices));
}
