import type { DoorDrawKind, DoorDrawRegionFilter } from "../items/doorSizes";
import {
  catalogWidthsForDraw,
  computeWallDoorSpanFromFixedJamb,
} from "../items/doorSizes";
import type { Vec2, VectorObject } from "./types";
import { doorSpanPassesPlacementRules } from "./doorPlacementRules";
import {
  distanceAlongPolylineToPoint,
  polylineTotalLength,
  snapWallWindowPointerOntoCenterline,
  MIN_WALL_WINDOW_SPAN_MM,
} from "./wallWindow";

/**
 * Catalog-quantized door span for Draw doors preview (same rules as placement).
 * First point = fixed jamb, second = drag direction (not min/max of along distances).
 */
export function computeWallDoorPreviewSpan(
  wall: VectorObject,
  objects: VectorObject[],
  startWorld: Vec2,
  endWorld: Vec2,
  snapGridMm: number,
  vertexTolMm: number,
  kind: DoorDrawKind,
  regionFilter: DoorDrawRegionFilter
): { startAlongMm: number; endAlongMm: number; doorWidthMm: number } | null {
  const cl = wall.centerline;
  if (!cl || cl.length < 2) return null;
  const aSnap = snapWallWindowPointerOntoCenterline(cl, startWorld, snapGridMm, vertexTolMm);
  const bSnap = snapWallWindowPointerOntoCenterline(cl, endWorld, snapGridMm, vertexTolMm);
  const fixedAlongMm = distanceAlongPolylineToPoint(cl, aSnap);
  const pointerAlong = distanceAlongPolylineToPoint(cl, bSnap);
  if (Math.abs(pointerAlong - fixedAlongMm) < MIN_WALL_WINDOW_SPAN_MM) return null;
  const total = polylineTotalLength(cl);
  const widths = catalogWidthsForDraw(kind, regionFilter);
  const span = computeWallDoorSpanFromFixedJamb(total, fixedAlongMm, pointerAlong, widths);
  if (!span) return null;
  if (!doorSpanPassesPlacementRules(wall, objects, span.startAlongMm, span.endAlongMm)) return null;
  return span;
}
