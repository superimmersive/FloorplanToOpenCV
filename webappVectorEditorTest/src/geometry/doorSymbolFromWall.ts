import { vec2, type DoorSwing, type Vec2, type VectorObject } from "./types";
import { type DoorDrawKind, doubleDoorCatalogIdForSpanMm } from "../items/doorSizes";
import { normalizeWallWindowRef, pointAtDistanceAlongPolyline } from "./wallWindow";

/**
 * Plan symbol (catalog door graphic) aligned to a wall-hosted door span: square in world space,
 * no `wallWindowRef` so the renderer uses the single-door SVG / double-door fill.
 *
 * The **hinge / bottom** edge of the icon (along the wall opening) lies **on** the wall centerline;
 * the square extends **into the room** along the perpendicular (inswing), or the opposite side (outswing).
 */
export function buildDoorSymbolGeometryFromSpan(params: {
  centerline: Vec2[];
  startAlongMm: number;
  endAlongMm: number;
  doorWidthMm: number;
  doorSwing: DoorSwing;
}): { verts: Vec2[]; rotationDeg: number; centroid: Vec2 } {
  const { centerline: cl, startAlongMm, endAlongMm, doorWidthMm, doorSwing } = params;
  const p0 = pointAtDistanceAlongPolyline(cl, startAlongMm);
  const p1 = pointAtDistanceAlongPolyline(cl, endAlongMm);
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const vx = -uy;
  const vy = ux;
  const half = doorWidthMm / 2;
  const w = doorWidthMm;
  const mid = vec2(mx, my);
  const sign = doorSwing === "out" ? -1 : 1;
  const verts: Vec2[] = [
    vec2(mid.x - ux * half, mid.y - uy * half),
    vec2(mid.x + ux * half, mid.y + uy * half),
    vec2(mid.x + ux * half + vx * w * sign, mid.y + uy * half + vy * w * sign),
    vec2(mid.x - ux * half + vx * w * sign, mid.y - uy * half + vy * w * sign),
  ];
  let cx = 0;
  let cy = 0;
  for (const pt of verts) {
    cx += pt.x;
    cy += pt.y;
  }
  cx /= verts.length;
  cy /= verts.length;
  const rotationDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
  return { verts, rotationDeg, centroid: vec2(cx, cy) };
}

/** Recompute door-item verts / transform from the current wall-hosted door span and swing. */
export function refreshPairedDoorSymbolGeometry(
  symbol: VectorObject,
  hostedDoor: VectorObject,
  wall: VectorObject
): VectorObject | null {
  const cl = wall.centerline;
  if (!cl || cl.length < 2 || !hostedDoor.wallWindowRef) return null;
  const norm = normalizeWallWindowRef(wall, hostedDoor.wallWindowRef);
  if (!norm) return null;
  const doorWidthMm = hostedDoor.doorWidthMm;
  if (typeof doorWidthMm !== "number" || !Number.isFinite(doorWidthMm) || doorWidthMm <= 0) {
    return null;
  }
  const swing = symbol.doorSwing ?? "in";
  const { verts, rotationDeg, centroid } = buildDoorSymbolGeometryFromSpan({
    centerline: cl,
    startAlongMm: norm.startAlongMm,
    endAlongMm: norm.endAlongMm,
    doorWidthMm,
    doorSwing: swing,
  });
  const poly0 = symbol.polygons[0];
  if (!poly0) return null;
  const next: VectorObject = {
    ...symbol,
    doorWidthMm,
    transform: { ...symbol.transform, position: centroid, rotationDeg },
    polygons: [{ ...poly0, verts }],
  };
  if (hostedDoor.itemId === "double-door") {
    const catId = doubleDoorCatalogIdForSpanMm(doorWidthMm, hostedDoor.doorCatalogOptionId);
    return { ...next, ...(catId && { doorCatalogOptionId: catId }) };
  }
  return next;
}

/**
 * After wall-hosted doors move, update every door-item symbol that references one (`pairedWallDoorId`).
 */
export function syncPairedDoorSymbolsForObjects(objects: VectorObject[]): VectorObject[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  return objects.map((o) => {
    if (!o.pairedWallDoorId) return o;
    const hosted = byId.get(o.pairedWallDoorId);
    if (!hosted) return o;
    const wallId = hosted.wallWindowRef?.wallId;
    if (!wallId) return o;
    const wall = byId.get(wallId);
    if (!wall?.centerline) return o;
    return refreshPairedDoorSymbolGeometry(o, hosted, wall) ?? o;
  });
}

export function createDoorSymbolForWallDoor(params: {
  wallDoorId: string;
  layerId: string;
  centerline: Vec2[];
  startAlongMm: number;
  endAlongMm: number;
  doorKind: DoorDrawKind;
  doorWidthMm: number;
  doorSwing: DoorSwing;
  doorCatalogOptionId?: string;
}): VectorObject {
  const {
    wallDoorId,
    layerId,
    centerline,
    startAlongMm,
    endAlongMm,
    doorKind,
    doorWidthMm,
    doorSwing,
    doorCatalogOptionId,
  } = params;
  const { verts, rotationDeg, centroid } = buildDoorSymbolGeometryFromSpan({
    centerline,
    startAlongMm,
    endAlongMm,
    doorWidthMm,
    doorSwing,
  });
  const id = `obj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const polyId = `poly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const isSingle = doorKind === "single";
  return {
    id,
    layerId,
    transform: { position: centroid, rotationDeg, scale: vec2(1, 1) },
    polygons: [{ id: polyId, verts }],
    itemColor: isSingle ? "#3b82f6" : "#06b6d4",
    itemId: isSingle ? "single-door" : "double-door",
    itemLabel: isSingle ? "Single door" : "Double door",
    itemDirectionDeg: 270,
    doorHanding: "left",
    doorSwing,
    doorWidthMm,
    pairedWallDoorId: wallDoorId,
    ...(!isSingle && doorCatalogOptionId && { doorCatalogOptionId }),
  };
}
