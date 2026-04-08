import { vec2, type Vec2, type VectorObject } from "./types";
import { effectiveWallDrawWidthMm } from "./wallDrawWidth";
import {
  isWallPolylineObject,
  isWallHostedDoorItem,
  normalizeWallWindowRef,
  pointAtDistanceAlongPolyline,
  polylineTotalLength,
} from "./wallWindow";
import {
  CEILING_SKIRTING_LAYER_ID,
  FLOOR_SKIRTING_LAYER_ID,
} from "../state/editorState";
import { DEFAULT_SKIRTING_DEPTH_MM } from "../building/buildingDefaults";

/** Ignore degenerate wall segments (mm). */
const MIN_SEGMENT_MM = 1e-3;

/** Skip skirting pieces shorter than this after door cuts (mm). */
const MIN_SKIRTING_SPAN_MM = 5;

/**
 * Left-hand normal of segment A→B in Y-up plan (skirting strip is offset to the left of the path).
 * For a closed room drawn CCW, this is typically toward the interior — a future toggle can flip.
 */
function leftNormal(
  ax: number,
  ay: number,
  bx: number,
  by: number
): { nx: number; ny: number; len: number } | null {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < MIN_SEGMENT_MM) return null;
  return { nx: -dy / len, ny: dx / len, len };
}

/**
 * Thin plan quad along one wall segment: inner edge on the room side of the wall stroke,
 * outer edge offset by {@link DEFAULT_SKIRTING_DEPTH_MM} into the room. CCW in +Z for extrusion up.
 */
export function segmentSkirtingStripQuad(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  halfWallWidthMm: number,
  depthIntoRoomMm: number
): Vec2[] | null {
  const ln = leftNormal(ax, ay, bx, by);
  if (!ln) return null;
  const { nx, ny } = ln;
  const iAx = ax + nx * halfWallWidthMm;
  const iAy = ay + ny * halfWallWidthMm;
  const iBx = bx + nx * halfWallWidthMm;
  const iBy = by + ny * halfWallWidthMm;
  const oAx = iAx + nx * depthIntoRoomMm;
  const oAy = iAy + ny * depthIntoRoomMm;
  const oBx = iBx + nx * depthIntoRoomMm;
  const oBy = iBy + ny * depthIntoRoomMm;
  return [
    vec2(iAx, iAy),
    vec2(iBx, iBy),
    vec2(oBx, oBy),
    vec2(oAx, oAy),
  ];
}

function vertexDistancesAlong(cl: Vec2[]): number[] {
  const d: number[] = [0];
  for (let i = 1; i < cl.length; i++) {
    d.push(d[i - 1] + Math.hypot(cl[i].x - cl[i - 1].x, cl[i].y - cl[i - 1].y));
  }
  return d;
}

function mergeIntervals(intervals: [number, number][]): [number, number][] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  let cs = sorted[0][0];
  let ce = sorted[0][1];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    if (s <= ce) ce = Math.max(ce, e);
    else {
      merged.push([cs, ce]);
      cs = s;
      ce = e;
    }
  }
  merged.push([cs, ce]);
  return merged;
}

/**
 * Returns sub-intervals of [segStart, segEnd] not covered by merged blocked intervals.
 * `blocked` must be merged and clipped to [segStart, segEnd].
 */
function keptIntervals(segStart: number, segEnd: number, blocked: [number, number][]): [number, number][] {
  if (segEnd - segStart < MIN_SKIRTING_SPAN_MM) return [];
  const merged = mergeIntervals(blocked);
  if (merged.length === 0) {
    return [[segStart, segEnd]];
  }
  const kept: [number, number][] = [];
  let x = segStart;
  for (const [b0, b1] of merged) {
    if (b0 > x) {
      const e = Math.min(b0, segEnd);
      if (e - x >= MIN_SKIRTING_SPAN_MM) kept.push([x, e]);
    }
    x = Math.max(x, b1);
  }
  if (segEnd - x >= MIN_SKIRTING_SPAN_MM) kept.push([x, segEnd]);
  return kept;
}

/** Merged door spans along wall (arc length mm), clamped to polyline length. */
function doorSpansAlongWall(wall: VectorObject, doors: VectorObject[]): [number, number][] {
  const cl = wall.centerline;
  if (!cl || cl.length < 2) return [];
  const total = polylineTotalLength(cl);
  const raw: [number, number][] = [];
  for (const door of doors) {
    if (!isWallHostedDoorItem(door) || !door.wallWindowRef) continue;
    const norm = normalizeWallWindowRef(wall, door.wallWindowRef);
    if (!norm) continue;
    let s = Math.max(0, Math.min(total, Math.min(norm.startAlongMm, norm.endAlongMm)));
    let e = Math.max(0, Math.min(total, Math.max(norm.startAlongMm, norm.endAlongMm)));
    if (e - s < 1e-6) continue;
    raw.push([s, e]);
  }
  return mergeIntervals(raw);
}

/**
 * Replaces all floor skirting objects. Strips follow wall segments on the left of the path;
 * spans covered by wall-hosted doors (single/double) are omitted. No miters at corners.
 */
export function generateFloorSkirtingObjects(objects: VectorObject[]): VectorObject[] {
  const without = objects.filter((o) => o.itemId !== "floor-skirting");
  const doorsByWall = new Map<string, VectorObject[]>();
  for (const o of without) {
    if (isWallHostedDoorItem(o) && o.wallWindowRef?.wallId) {
      const wid = o.wallWindowRef.wallId;
      if (!doorsByWall.has(wid)) doorsByWall.set(wid, []);
      doorsByWall.get(wid)!.push(o);
    }
  }

  const floorSkirting: VectorObject[] = [];
  const depth = DEFAULT_SKIRTING_DEPTH_MM;

  for (const wall of without) {
    if (!isWallPolylineObject(wall)) continue;
    const cl = wall.centerline;
    if (!cl || cl.length < 2) continue;
    const halfW = effectiveWallDrawWidthMm(wall) / 2;
    const cum = vertexDistancesAlong(cl);
    const doors = doorsByWall.get(wall.id) ?? [];
    const doorSpans = doorSpansAlongWall(wall, doors);

    for (let j = 0; j < cl.length - 1; j++) {
      const segStart = cum[j];
      const segEnd = cum[j + 1];
      const segLen = segEnd - segStart;
      if (segLen < MIN_SEGMENT_MM) continue;

      const blocked = mergeIntervals(
        doorSpans
          .map(([d0, d1]) => [Math.max(segStart, d0), Math.min(segEnd, d1)] as [number, number])
          .filter(([s, e]) => e - s > 1e-9)
      );
      const kept = keptIntervals(segStart, segEnd, blocked);
      let pieceIdx = 0;
      for (const [ka, kb] of kept) {
        const pa = pointAtDistanceAlongPolyline(cl, ka);
        const pb = pointAtDistanceAlongPolyline(cl, kb);
        const verts = segmentSkirtingStripQuad(pa.x, pa.y, pb.x, pb.y, halfW, depth);
        if (!verts) continue;
        const segId = `${wall.id}-s${j}-p${pieceIdx}`;
        pieceIdx += 1;
        floorSkirting.push({
          id: `floor-skirting-${segId}`,
          layerId: FLOOR_SKIRTING_LAYER_ID,
          transform: { position: vec2(0, 0), rotationDeg: 0, scale: vec2(1, 1) },
          polygons: [{ id: `poly-floor-skirting-${segId}`, verts }],
          itemId: "floor-skirting",
          itemLabel: "Floor skirting",
          floorSkirtingForWallId: wall.id,
        });
      }
    }
  }

  return [...floorSkirting, ...without];
}

/**
 * Replaces all ceiling skirting objects (full segment strips; door trimming applies to floor only).
 */
export function generateCeilingSkirtingObjects(objects: VectorObject[]): VectorObject[] {
  const without = objects.filter((o) => o.itemId !== "ceiling-skirting");
  const ceilingSkirting: VectorObject[] = [];
  const depth = DEFAULT_SKIRTING_DEPTH_MM;

  for (const wall of without) {
    if (!isWallPolylineObject(wall)) continue;
    const cl = wall.centerline;
    if (!cl || cl.length < 2) continue;
    const halfW = effectiveWallDrawWidthMm(wall) / 2;

    for (let i = 0; i < cl.length - 1; i++) {
      const a = cl[i];
      const b = cl[i + 1];
      const verts = segmentSkirtingStripQuad(a.x, a.y, b.x, b.y, halfW, depth);
      if (!verts) continue;
      const segId = `${wall.id}-s${i}`;
      ceilingSkirting.push({
        id: `ceiling-skirting-${segId}`,
        layerId: CEILING_SKIRTING_LAYER_ID,
        transform: { position: vec2(0, 0), rotationDeg: 0, scale: vec2(1, 1) },
        polygons: [{ id: `poly-ceiling-skirting-${segId}`, verts }],
        itemId: "ceiling-skirting",
        itemLabel: "Ceiling skirting",
        ceilingSkirtingForWallId: wall.id,
      });
    }
  }

  return [...ceilingSkirting, ...without];
}
