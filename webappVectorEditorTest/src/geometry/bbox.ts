import type { VectorObject } from "./types";
import { getPolygonContour } from "./types";

export type BBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** World-space axis-aligned bounding box of all objects (polygon verts/holes are world coords; see sceneRenderer). */
export function getObjectsBbox(objects: VectorObject[]): BBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasAny = false;

  const expand = (wx: number, wy: number) => {
    minX = Math.min(minX, wx);
    minY = Math.min(minY, wy);
    maxX = Math.max(maxX, wx);
    maxY = Math.max(maxY, wy);
    hasAny = true;
  };

  for (const obj of objects) {
    for (const poly of obj.polygons) {
      const outer = getPolygonContour(poly, undefined);
      for (const v of outer) {
        expand(v.x, v.y);
      }
      const holes = poly.holes ?? [];
      for (let h = 0; h < holes.length; h++) {
        const hole = getPolygonContour(poly, h);
        for (const v of hole) {
          expand(v.x, v.y);
        }
      }
    }
    if (obj.centerline && obj.centerline.length > 0) {
      for (const p of obj.centerline) {
        expand(p.x, p.y);
      }
    }
  }

  if (!hasAny) return null;
  return { minX, minY, maxX, maxY };
}
