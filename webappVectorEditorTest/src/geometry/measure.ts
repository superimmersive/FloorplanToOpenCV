import type { EdgeRef, VectorObject } from "./types";
import { getPolygonContour } from "./types";

/** Length of an edge in mm (1 unit = 1 mm). Returns null if edge not found. */
export function getEdgeLengthMm(objects: VectorObject[], edgeRef: EdgeRef): number | null {
  const obj = objects.find((o) => o.id === edgeRef.objectId);
  const poly = obj?.polygons.find((p) => p.id === edgeRef.polygonId);
  const verts = poly ? getPolygonContour(poly, edgeRef.holeIndex) : undefined;
  if (!verts || verts.length < 2) return null;
  const a = verts[edgeRef.edgeIndex];
  const b = verts[(edgeRef.edgeIndex + 1) % verts.length];
  return Math.hypot(b.x - a.x, b.y - a.y);
}
