import type { Polygon, VectorObject } from "./types";
import { removeCollinearVerts, removeCollinearVertsPolyline } from "./polygonUtils";
import { pathToPolygon, polygonsFromStairsCenterline } from "./drawPath";
import { effectiveWallDrawWidthMm } from "./wallDrawWidth";

/** Remove collinear vertices from a polygon's outer contour and holes. */
function cleanPolygon(poly: Polygon): Polygon {
  const verts = removeCollinearVerts(poly.verts);
  const holes = poly.holes?.map((h) => removeCollinearVerts(h)).filter((h) => h.length >= 2);
  return {
    ...poly,
    verts,
    ...(holes && holes.length > 0 && { holes })
  };
}

/** Clean all shapes: remove vertices that lie on a straight line between neighbors. Draw shapes (with centerline) are cleaned by simplifying the centerline and regenerating the outline. */
export function cleanObjects(objects: VectorObject[]): VectorObject[] {
  return objects.map((obj) => {
    const centerline = obj.centerline;
    if (centerline && centerline.length >= 2) {
      const cleanedCenterline = removeCollinearVertsPolyline(centerline);
      const halfWidth = effectiveWallDrawWidthMm(obj) / 2;
      const baseId = obj.polygons[0]?.id ?? `${obj.id}-poly`;
      if (obj.itemId === "stairs") {
        const polys = polygonsFromStairsCenterline(cleanedCenterline, halfWidth, baseId);
        if (polys.length >= 1) {
          return {
            ...obj,
            centerline: cleanedCenterline,
            polygons: polys,
          };
        }
        return obj;
      }
      const outline = pathToPolygon(cleanedCenterline, halfWidth);
      if (outline.length >= 3 && obj.polygons[0]) {
        return {
          ...obj,
          centerline: cleanedCenterline,
          polygons: [{ ...obj.polygons[0], verts: outline }],
        };
      }
      return obj;
    }
    return {
      ...obj,
      polygons: obj.polygons.map(cleanPolygon),
    };
  });
}
