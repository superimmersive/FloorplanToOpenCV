export type Vec2 = {
  x: number;
  y: number;
};

export type Polygon = {
  id: string;
  verts: Vec2[];
  /** Inner contours (holes). Rendered with even-odd fill so center is empty. */
  holes?: Vec2[][];
};

export type Transform2D = {
  position: Vec2;
  rotationDeg: number;
  scale: Vec2;
};

/** Hinge side for plan symbols (view-dependent; we mirror the graphic for “right”). */
export type DoorHanding = "left" | "right";
/** Whether the door swings into the room side or out (mirrors the swing arc in plan). */
export type DoorSwing = "in" | "out";

export type VectorObject = {
  id: string;
  /** Id of the layer this object belongs to. */
  layerId: string;
  polygons: Polygon[];
  transform: Transform2D;
  /** Optional centerline (e.g. from Draw tool); used for display and manipulation. */
  centerline?: Vec2[];
  /** Width in mm for draw shapes (centerline-based); outline is generated with this width. Default 100. */
  drawWidthMm?: number;
  /** When set (e.g. items on item layer), this color is used for fill/stroke instead of layer color. */
  itemColor?: string;
  /** Catalog id when placed from Add item (e.g. `"single-door"`); inner walls use `"inner-wall"`; stair runs use `"stairs"`. */
  itemId?: string;
  /** Human-readable name for inspector (e.g. "Single door"). */
  itemLabel?: string;
  /** Direction the item faces (degrees): 0 = +X right, 90 = +Y up, 270 = -Y down (default); only used when itemColor is set. */
  itemDirectionDeg?: number;
  /** Single-door (etc.): hinge side; `singleDoor.svg` is authored as left-hand. */
  doorHanding?: DoorHanding;
  /** Single-door (etc.): inswing vs outswing; flips the swing relative to the wall line. */
  doorSwing?: DoorSwing;
  /** Nominal door width (mm); plan symbol is drawn as a square of this side length. */
  doorWidthMm?: number;
  /** Double-door catalog row id (e.g. `d-sa-1500-2134`) when width alone is ambiguous. */
  doorCatalogOptionId?: string;
  /**
   * Wall-anchored span along the parent wall centerline (mm from first vertex): used for `wall-window`,
   * and for `single-door` / `double-door` when placed with Draw doors. `a`/`b` may appear in old JSON.
   */
  wallWindowRef?: {
    wallId: string;
    startAlongMm?: number;
    endAlongMm?: number;
    a?: Vec2;
    b?: Vec2;
  };
  /** Optional link from a plan door symbol (separate layer) to the wall-hosted door id. */
  pairedWallDoorId?: string;
  /** Foundation slab derived from a wall; `itemId === "foundation"`. */
  foundationForWallId?: string;
  /** Finished floor (centerline bounds) derived from a wall; `itemId === "floor"`. */
  floorForWallId?: string;
  /** When the outer shell is split into rooms, 0-based index of this floor piece. */
  floorRoomIndex?: number;
  /** Ceiling slab derived from a wall; `itemId === "ceiling"`. */
  ceilingForWallId?: string;
  /** When the outer shell is split into rooms, 0-based index of this ceiling piece. */
  ceilingRoomIndex?: number;
  /** Floor skirting strip derived from a wall segment; `itemId === "floor-skirting"`. */
  floorSkirtingForWallId?: string;
  /** Ceiling skirting strip derived from a wall segment; `itemId === "ceiling-skirting"`. */
  ceilingSkirtingForWallId?: string;
};

export type Camera2D = {
  center: Vec2;
  zoom: number;
};

export type EdgeRef = {
  objectId: string;
  polygonId: string;
  edgeIndex: number;
  /** If set, edge is on polygon.holes[holeIndex]; otherwise on polygon.verts. */
  holeIndex?: number;
};

export const vec2 = (x: number, y: number): Vec2 => ({ x, y });

/** Get the contour for an edge: outer (verts) or hole at holeIndex. */
export function getPolygonContour(poly: Polygon, holeIndex: number | undefined): Vec2[] {
  if (holeIndex === undefined) return poly.verts;
  return poly.holes?.[holeIndex] ?? poly.verts;
}
