import type { EdgeRef, Vec2, VectorObject } from "./types";
import { vec2, getPolygonContour } from "./types";

function snapValue(v: number, gridMm: number): number {
  if (gridMm <= 0) return v;
  return Math.round(v / gridMm) * gridMm;
}

function snapVec(p: Vec2, gridMm: number): Vec2 {
  return vec2(snapValue(p.x, gridMm), snapValue(p.y, gridMm));
}

/** Move an edge by translating its two vertices by delta. Optional snap grid in mm (0 = no snap). */
export function moveEdge(
  objects: VectorObject[],
  edgeRef: EdgeRef,
  delta: Vec2,
  snapGridMm: number = 0
): VectorObject[] {
  const d = snapGridMm > 0 ? snapVec(delta, snapGridMm) : delta;
  if (d.x === 0 && d.y === 0) return objects;

  return objects.map((obj) => {
    if (obj.id !== edgeRef.objectId) return obj;
    return {
      ...obj,
      polygons: obj.polygons.map((poly) => {
        if (poly.id !== edgeRef.polygonId) return poly;
        const contour = getPolygonContour(poly, edgeRef.holeIndex);
        if (contour.length < 2) return poly;
        const i = edgeRef.edgeIndex;
        const j = (i + 1) % contour.length;
        const newV0 = vec2(contour[i].x + d.x, contour[i].y + d.y);
        const newV1 = vec2(contour[j].x + d.x, contour[j].y + d.y);
        if (edgeRef.holeIndex === undefined) {
          const verts = poly.verts.slice();
          verts[i] = newV0;
          verts[j] = newV1;
          return { ...poly, verts };
        }
        const holes = (poly.holes ?? []).slice();
        const hole = holes[edgeRef.holeIndex].slice();
        hole[i] = newV0;
        hole[j] = newV1;
        holes[edgeRef.holeIndex] = hole;
        return { ...poly, holes };
      }),
    };
  });
}

/** Move an entire object by translating all its polygon verts (and holes) by delta. Optional snap grid in mm. */
export function moveShape(
  objects: VectorObject[],
  objectId: string,
  delta: Vec2,
  snapGridMm: number = 0
): VectorObject[] {
  const d = snapGridMm > 0 ? snapVec(delta, snapGridMm) : delta;
  if (d.x === 0 && d.y === 0) return objects;

  return objects.map((obj) => {
    if (obj.id !== objectId) return obj;
    const nextCenterline = obj.centerline?.map((v) => vec2(v.x + d.x, v.y + d.y));
    return {
      ...obj,
      transform: {
        ...obj.transform,
        position: vec2(obj.transform.position.x + d.x, obj.transform.position.y + d.y),
      },
      polygons: obj.polygons.map((poly) => {
        const verts = poly.verts.map((v) => vec2(v.x + d.x, v.y + d.y));
        const holes = (poly.holes ?? []).map((hole) =>
          hole.map((v) => vec2(v.x + d.x, v.y + d.y))
        );
        return { ...poly, verts, ...(holes.length > 0 && { holes }) };
      }),
      ...(nextCenterline != null && { centerline: nextCenterline }),
    };
  });
}
