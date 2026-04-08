import type { EdgeRef, Polygon, Vec2, VectorObject } from "./types";
import { vec2, getPolygonContour } from "./types";
import { signedArea, pointInPolygon } from "./polygonUtils";
import { subtractPolygons, unionSelfPolygon } from "./clipperSubtract";

const DEFAULT_GRID_MM = 1;

function snap(v: number, gridMm: number): number {
  const g = gridMm > 0 ? gridMm : DEFAULT_GRID_MM;
  return Math.round(v / g) * g;
}

function snapVec(p: Vec2, gridMm: number): Vec2 {
  return vec2(snap(p.x, gridMm), snap(p.y, gridMm));
}

/** Outward normal for edge at edgeIndex (CCW polygon: right of A->B). */
export function getOutwardNormal(verts: Vec2[], edgeIndex: number): Vec2 {
  const a = verts[edgeIndex];
  const b = verts[(edgeIndex + 1) % verts.length];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return vec2(dy / len, -dx / len);
}

/** Positive extrusion (raw): insert A2, B2 so edge becomes A -> A2 -> B2 -> B. Works on outer or hole contour. */
export function applyPositiveExtrusion(
  objects: VectorObject[],
  edgeRef: EdgeRef,
  distanceMm: number,
  snapGridMm: number = DEFAULT_GRID_MM
): VectorObject[] {
  if (distanceMm === 0) return objects;
  const grid = snapGridMm > 0 ? snapGridMm : DEFAULT_GRID_MM;
  const dist = Math.round(distanceMm / grid) * grid;
  if (dist === 0) return objects;

  const { holeIndex } = edgeRef;

  return objects.map((obj) => {
    if (obj.id !== edgeRef.objectId) return obj;

    return {
      ...obj,
      polygons: obj.polygons.map((poly) => {
        if (poly.id !== edgeRef.polygonId) return poly;

        const verts = getPolygonContour(poly, holeIndex);
        if (verts.length < 2) return poly;

        const i = edgeRef.edgeIndex;
        const a = verts[i];
        const b = verts[(i + 1) % verts.length];
        const n = getOutwardNormal(verts, i);

        const a2 = snapVec(vec2(a.x + n.x * dist, a.y + n.y * dist), grid);
        const b2 = snapVec(vec2(b.x + n.x * dist, b.y + n.y * dist), grid);

        const newVerts: Vec2[] = [];
        for (let k = 0; k < verts.length; k++) {
          newVerts.push(verts[k]);
          if (k === i) newVerts.push(a2, b2);
        }

        if (holeIndex === undefined) {
          return { ...poly, verts: newVerts };
        }
        const holes = (poly.holes ?? []).slice();
        holes[holeIndex] = newVerts;
        return { ...poly, holes };
      })
    };
  });
}

/** Classify merged paths into one polygon with outer + holes (snake-eating-tail: center becomes a hole). */
function buildPolygonWithHoles(merged: Vec2[][], polyId: string, snapGridMm: number): Polygon[] {
  if (merged.length === 0) return [];
  const grid = snapGridMm > 0 ? snapGridMm : DEFAULT_GRID_MM;
  const snapped = merged.map((path) => path.map((v) => snapVec(v, grid)));

  if (merged.length === 1) {
    return [{ id: polyId, verts: snapped[0] }];
  }

  const withArea = snapped.map((path) => ({ path, area: Math.abs(signedArea(path)) }));
  withArea.sort((a, b) => b.area - a.area);
  const outer = withArea[0].path;
  const holes: Vec2[][] = [];
  const islands: Vec2[][] = [];

  for (let i = 1; i < withArea.length; i++) {
    const path = withArea[i].path;
    const inside = path.length > 0 && pointInPolygon(path[0], outer);
    if (inside) holes.push(path);
    else islands.push(path);
  }

  const mainPoly: Polygon = {
    id: polyId,
    verts: outer,
    ...(holes.length > 0 && { holes })
  };

  const result: Polygon[] = [mainPoly];
  islands.forEach((verts, idx) => {
    result.push({ id: `${polyId}-island-${idx}`, verts });
  });
  return result;
}

/** Merge hole contour after extrusion. Any crossover (union-self returns ≠1 path) or closed hole (0 or degenerate) removes the hole so the shape becomes solid. */
async function mergeHoleContour(
  currentHoles: Vec2[][],
  holeIndex: number,
  modifiedHoleVerts: Vec2[],
  snapGridMm: number
): Promise<Vec2[][]> {
  const merged = await unionSelfPolygon(modifiedHoleVerts);
  const before = currentHoles.slice(0, holeIndex);
  const after = currentHoles.slice(holeIndex + 1);
  if (merged.length !== 1) {
    return [...before, ...after];
  }
  const path = merged[0];
  if (Math.abs(signedArea(path)) <= 0) return [...before, ...after];
  const grid = snapGridMm > 0 ? snapGridMm : DEFAULT_GRID_MM;
  const snapped = [path.map((v) => snapVec(v, grid))];
  return [...before, ...snapped, ...after];
}

/** Positive extrusion then union-self to merge self-intersections; inner empty space becomes a hole. */
export async function applyPositiveExtrusionMerged(
  objects: VectorObject[],
  edgeRef: EdgeRef,
  distanceMm: number,
  snapGridMm: number = DEFAULT_GRID_MM
): Promise<VectorObject[]> {
  const grid = snapGridMm > 0 ? snapGridMm : DEFAULT_GRID_MM;
  if (edgeRef.holeIndex !== undefined) {
    const raw = applyPositiveExtrusion(objects, edgeRef, distanceMm, grid);
    const obj = raw.find((o) => o.id === edgeRef.objectId);
    const poly = obj?.polygons.find((p) => p.id === edgeRef.polygonId);
    if (!poly) return raw;

    const modifiedHoleVerts = getPolygonContour(poly, edgeRef.holeIndex);
    if (modifiedHoleVerts.length < 3) return raw;

    const holes = poly.holes ?? [];
    const newHoles = await mergeHoleContour(holes, edgeRef.holeIndex, modifiedHoleVerts, grid);

    return raw.map((o) => {
      if (o.id !== edgeRef.objectId) return o;
      return {
        ...o,
        polygons: o.polygons.map((p) =>
          p.id === edgeRef.polygonId ? { ...p, holes: newHoles } : p
        )
      };
    });
  }

  const raw = applyPositiveExtrusion(objects, edgeRef, distanceMm, grid);
  const obj = raw.find((o) => o.id === edgeRef.objectId);
  const poly = obj?.polygons.find((p) => p.id === edgeRef.polygonId);
  if (!obj || !poly) return raw;

  const merged = await unionSelfPolygon(poly.verts);
  const newPolygons = buildPolygonWithHoles(merged, poly.id, grid);

  return raw.map((o) => {
    if (o.id !== edgeRef.objectId) return o;
    return {
      ...o,
      polygons: o.polygons
        .filter((p) => p.id !== edgeRef.polygonId)
        .concat(newPolygons)
    };
  });
}

/** Cut rectangle for negative extrusion: A, B, B + inward* depth, A + inward* depth (CCW). */
function cutRectForEdge(verts: Vec2[], edgeIndex: number, depthMm: number, snapGridMm: number): Vec2[] {
  const a = verts[edgeIndex];
  const b = verts[(edgeIndex + 1) % verts.length];
  const n = getOutwardNormal(verts, edgeIndex);
  const inward = vec2(-n.x, -n.y);
  const grid = snapGridMm > 0 ? snapGridMm : DEFAULT_GRID_MM;
  const depth = Math.round(Math.abs(depthMm) / grid) * grid;
  const a2 = vec2(a.x + inward.x * depth, a.y + inward.y * depth);
  const b2 = vec2(b.x + inward.x * depth, b.y + inward.y * depth);
  return [a, b, b2, a2];
}

/** Negative extrusion: subtract cut rectangle from object polygons using Clipper2. */
export async function applyNegativeExtrusion(
  objects: VectorObject[],
  edgeRef: EdgeRef,
  depthMm: number,
  snapGridMm: number = DEFAULT_GRID_MM
): Promise<VectorObject[]> {
  if (depthMm >= 0) return objects;
  const grid = snapGridMm > 0 ? snapGridMm : DEFAULT_GRID_MM;
  const depth = Math.abs(depthMm);
  if (depth < grid) return objects;

  const obj = objects.find((o) => o.id === edgeRef.objectId);
  const poly = obj?.polygons.find((p) => p.id === edgeRef.polygonId);
  if (!obj || !poly || poly.verts.length < 2) return objects;

  const clipRect = cutRectForEdge(poly.verts, edgeRef.edgeIndex, depthMm, grid);
  const subjectVerts = poly.verts;
  const resultPaths = await subtractPolygons(subjectVerts, clipRect);
  if (resultPaths.length === 0) {
    return objects.map((o) =>
      o.id === edgeRef.objectId
        ? { ...o, polygons: o.polygons.filter((p) => p.id !== edgeRef.polygonId) }
        : o
    );
  }

  const newPolygons: Polygon[] = resultPaths.map((verts, idx) => ({
    id: `${poly.id}-split-${idx}`,
    verts: verts.map((v) => snapVec(v, grid))
  }));

  return objects.map((o) => {
    if (o.id !== edgeRef.objectId) return o;
    return {
      ...o,
      polygons: o.polygons
        .filter((p) => p.id !== edgeRef.polygonId)
        .concat(newPolygons)
    };
  });
}
