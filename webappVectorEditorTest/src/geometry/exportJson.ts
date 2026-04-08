import type { VectorObject } from "./types";
import type { Layer } from "../state/editorState";
import {
  DEFAULT_CEILING_THICKNESS_MM,
  DEFAULT_FOUNDATION_HEIGHT_MM,
  DEFAULT_WALL_HEIGHT_MM,
  DEFAULT_WINDOW_HEIGHT_MM,
  DEFAULT_WINDOW_SILL_HEIGHT_MM,
  DEFAULT_DOOR_SILL_HEIGHT_MM,
} from "../building/buildingDefaults";
import { doorHeightMmForPlacedDoor } from "../items/doorSizes";

/** JSON export format for Blender import. Units are millimetres (mm). */
export type ExportShape = {
  units: "mm";
  /** v2: adds `buildingDefaults` and per-object `doorHeightMm` / `windowHeightMm`. */
  version: 2;
  /** Nominal vertical dimensions for 3D (walls, window openings, sill heights). */
  buildingDefaults: {
    /** Slab thickness; world z = 0 at ground, walls start at this height. */
    foundationHeightMm: number;
    /** Ceiling extrusion (mm); 0 = flat plane at foundation + wall height. */
    ceilingThicknessMm: number;
    wallHeightMm: number;
    windowHeightMm: number;
    /** Finished floor → bottom of window opening (mm); add foundationHeightMm for absolute z. */
    windowSillHeightMm: number;
    /** Finished floor → bottom of door opening (mm); usually 0. */
    doorSillHeightMm: number;
  };
  layers: ExportLayer[];
  objects: ExportObject[];
};

export type ExportLayer = {
  id: string;
  name: string;
  color: string;
  zPositionMm: number;
  extrusionHeightMm: number;
};

export type ExportObject = {
  id: string;
  layerId: string;
  position: [number, number];
  rotationDeg: number;
  scale: [number, number];
  polygons: ExportPolygon[];
  /** Centerline from Draw tool (spine of brush path), when present. */
  centerline?: [number, number][];
  /** Catalog / item metadata when present. */
  itemId?: string;
  itemDirectionDeg?: number;
  doorHanding?: "left" | "right";
  doorSwing?: "in" | "out";
  doorWidthMm?: number;
  doorCatalogOptionId?: string;
  /** Stair run width (mm); used by Blender for ramp mesh. */
  drawWidthMm?: number;
  wallWindowRef?: {
    wallId: string;
    startAlongMm?: number;
    endAlongMm?: number;
    a?: [number, number];
    b?: [number, number];
  };
  /** Nominal door height from SA/UK catalog (single/double doors). */
  doorHeightMm?: number;
  /** Nominal window opening height (wall-window). */
  windowHeightMm?: number;
  /** Floor → bottom of window opening (wall-window); matches `buildingDefaults.windowSillHeightMm` unless overridden later. */
  windowSillHeightMm?: number;
  /** Floor → bottom of door opening; matches `buildingDefaults.doorSillHeightMm`. */
  doorSillHeightMm?: number;
};

export type ExportPolygon = {
  id: string;
  verts: [number, number][];
  holes?: [number, number][][];
};

export function exportVectorJson(objects: VectorObject[], layers: Layer[]): string {
  const data: ExportShape = {
    units: "mm",
    version: 2,
    buildingDefaults: {
      foundationHeightMm: DEFAULT_FOUNDATION_HEIGHT_MM,
      ceilingThicknessMm: DEFAULT_CEILING_THICKNESS_MM,
      wallHeightMm: DEFAULT_WALL_HEIGHT_MM,
      windowHeightMm: DEFAULT_WINDOW_HEIGHT_MM,
      windowSillHeightMm: DEFAULT_WINDOW_SILL_HEIGHT_MM,
      doorSillHeightMm: DEFAULT_DOOR_SILL_HEIGHT_MM,
    },
    layers: layers.map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color ?? "#94a3b8",
      zPositionMm: l.zPositionMm,
      extrusionHeightMm: l.extrusionHeightMm,
    })),
    objects: objects.map((obj) => ({
      id: obj.id,
      layerId: obj.layerId,
      position: [obj.transform.position.x, obj.transform.position.y],
      rotationDeg: obj.transform.rotationDeg,
      scale: [obj.transform.scale.x, obj.transform.scale.y],
      polygons: obj.polygons.map((poly) => ({
        id: poly.id,
        verts: poly.verts.map((v) => [v.x, v.y] as [number, number]),
        ...(poly.holes && poly.holes.length > 0 && {
          holes: poly.holes.map((h) => h.map((v) => [v.x, v.y] as [number, number])),
        }),
      })),
      ...(obj.centerline && obj.centerline.length > 0 && {
        centerline: obj.centerline.map((v) => [v.x, v.y] as [number, number]),
      }),
      ...(obj.itemId != null && obj.itemId.length > 0 && { itemId: obj.itemId }),
      ...(obj.itemDirectionDeg != null && { itemDirectionDeg: obj.itemDirectionDeg }),
      ...(obj.doorHanding != null && { doorHanding: obj.doorHanding }),
      ...(obj.doorSwing != null && { doorSwing: obj.doorSwing }),
      ...(obj.doorWidthMm != null && { doorWidthMm: obj.doorWidthMm }),
      ...(obj.doorCatalogOptionId != null &&
        obj.doorCatalogOptionId.length > 0 && { doorCatalogOptionId: obj.doorCatalogOptionId }),
      ...(typeof obj.drawWidthMm === "number" &&
        Number.isFinite(obj.drawWidthMm) &&
        obj.drawWidthMm > 0 && { drawWidthMm: obj.drawWidthMm }),
      ...(obj.itemId === "single-door" || obj.itemId === "double-door"
        ? {
            doorHeightMm: doorHeightMmForPlacedDoor(obj),
            doorSillHeightMm: DEFAULT_DOOR_SILL_HEIGHT_MM,
          }
        : {}),
      ...(obj.itemId === "wall-window"
        ? {
            windowHeightMm: DEFAULT_WINDOW_HEIGHT_MM,
            windowSillHeightMm: DEFAULT_WINDOW_SILL_HEIGHT_MM,
          }
        : {}),
      ...(obj.pairedWallDoorId != null &&
        obj.pairedWallDoorId.length > 0 && { pairedWallDoorId: obj.pairedWallDoorId }),
      ...(obj.wallWindowRef != null && {
        wallWindowRef: {
          wallId: obj.wallWindowRef.wallId,
          ...(typeof obj.wallWindowRef.startAlongMm === "number" &&
          typeof obj.wallWindowRef.endAlongMm === "number"
            ? {
                startAlongMm: obj.wallWindowRef.startAlongMm,
                endAlongMm: obj.wallWindowRef.endAlongMm,
              }
            : {}),
          ...(obj.wallWindowRef.a && obj.wallWindowRef.b
            ? {
                a: [obj.wallWindowRef.a.x, obj.wallWindowRef.a.y] as [number, number],
                b: [obj.wallWindowRef.b.x, obj.wallWindowRef.b.y] as [number, number],
              }
            : {}),
        },
      }),
    })),
  };
  return JSON.stringify(data, null, 2);
}
