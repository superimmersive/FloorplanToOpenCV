import type { Vec2, VectorObject } from "./types";
import { isWallPolylineObject } from "./wallWindow";

export type RoomEntry = {
  /** Stable key: `${outerWallId}:${localRoomIndex}` (local index is 0 when not split). */
  key: string;
  wallId: string;
  localRoomIndex: number;
  /** 1-based index for default label `Room-N` (global order across shells). */
  globalIndex: number;
  centroid: Vec2;
};

export function roomKeyFromFloorForWall(floorForWallId: string, localRoomIndex: number): string {
  return `${floorForWallId}:${localRoomIndex}`;
}

export function defaultRoomLabel(globalIndex: number): string {
  return `Room-${globalIndex}`;
}

export function displayRoomLabel(
  globalIndex: number,
  key: string,
  roomCustomNames: Record<string, string> | undefined
): string {
  const c = roomCustomNames?.[key];
  if (c != null && c.trim() !== "") return c.trim();
  return defaultRoomLabel(globalIndex);
}

/**
 * Rooms ordered like foundation: outer walls in first appearance order, then floor pieces by `floorRoomIndex`.
 */
export function listRoomsFromObjects(objects: VectorObject[]): RoomEntry[] {
  const result: RoomEntry[] = [];
  const outerWallIds: string[] = [];
  const seenWall = new Set<string>();
  for (const o of objects) {
    if (isWallPolylineObject(o) && !seenWall.has(o.id)) {
      seenWall.add(o.id);
      outerWallIds.push(o.id);
    }
  }

  let globalIndex = 0;
  for (const wallId of outerWallIds) {
    const floors = objects.filter(
      (o) =>
        o.itemId === "floor" &&
        o.floorForWallId === wallId &&
        o.polygons[0]?.verts != null &&
        o.polygons[0].verts.length >= 3
    );
    floors.sort((a, b) => (a.floorRoomIndex ?? 0) - (b.floorRoomIndex ?? 0));
    for (const f of floors) {
      globalIndex++;
      const localIdx = f.floorRoomIndex ?? 0;
      const verts = f.polygons[0].verts;
      let cx = 0;
      let cy = 0;
      for (const v of verts) {
        cx += v.x;
        cy += v.y;
      }
      const n = verts.length;
      const centroid: Vec2 = { x: cx / n, y: cy / n };
      result.push({
        key: roomKeyFromFloorForWall(wallId, localIdx),
        wallId,
        localRoomIndex: localIdx,
        globalIndex,
        centroid,
      });
    }
  }
  return result;
}

export function pruneRoomCustomNames(
  objects: VectorObject[],
  names: Record<string, string> | undefined
): Record<string, string> {
  if (!names || Object.keys(names).length === 0) return {};
  const valid = new Set(listRoomsFromObjects(objects).map((r) => r.key));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(names)) {
    if (valid.has(k) && typeof v === "string" && v.trim() !== "") out[k] = v.trim();
  }
  return out;
}
