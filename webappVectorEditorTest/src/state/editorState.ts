import type { Camera2D, EdgeRef, DoorSwing, VectorObject } from "../geometry/types";
import { vec2 } from "../geometry/types";
import {
  DEFAULT_INNER_WALL_DRAW_WIDTH_MM,
  DEFAULT_OUTER_WALL_DRAW_WIDTH_MM,
  DEFAULT_STAIRS_DRAW_WIDTH_MM,
} from "../geometry/wallDrawWidth";
import {
  DEFAULT_CEILING_THICKNESS_MM,
  DEFAULT_CEILING_SKIRTING_HEIGHT_MM,
  DEFAULT_FLOOR_THICKNESS_MM,
  DEFAULT_FLOOR_SKIRTING_HEIGHT_MM,
  DEFAULT_FOUNDATION_HEIGHT_MM,
  DEFAULT_WALL_HEIGHT_MM,
  DEFAULT_WINDOW_HEIGHT_MM,
  DEFAULT_WINDOW_SILL_HEIGHT_MM,
  DEFAULT_DOOR_SILL_HEIGHT_MM,
} from "../building/buildingDefaults";
import {
  type DoorDrawKind,
  type DoorDrawRegionFilter,
  DEFAULT_DOOR_HEIGHT_FALLBACK_MM,
} from "../items/doorSizes";
import { pruneRoomCustomNames } from "../geometry/rooms";

export type { DoorDrawKind, DoorDrawRegionFilter } from "../items/doorSizes";

export type Layer = {
  id: string;
  name: string;
  /** Fill/stroke colour for objects on this layer (hex e.g. #94a3b8). Not used for item-layer objects; they use itemColor. */
  color: string;
  /** Z position in mm (for Blender / 3D). */
  zPositionMm: number;
  /** Extrusion height in mm (depth when exported to 3D). */
  extrusionHeightMm: number;
  /** When true, this layer is the item layer; objects on it keep their own item color. */
  isItemLayer?: boolean;
  /** When 'image', this layer is the floor plan image (imageUrl, position, etc.). */
  type?: 'vector' | 'image';
  /** Floor plan image URL (object URL or data URL). Only for type 'image'. */
  imageUrl?: string;
  /** World position (center of image) in mm. (0,0) = center on world origin. Only for type 'image'. */
  imagePosition?: { x: number; y: number };
  /** World mm per image pixel (scale). Used when imageWidthMm is not set. Only for type 'image'. */
  imageScaleMmPerPixel?: number;
  /** Display width of the image in mm; aspect ratio preserved. When set, overrides imageScaleMmPerPixel. Only for type 'image'. */
  imageWidthMm?: number;
  /** Opacity 0–1. Only for type 'image'. */
  imageOpacity?: number;
  /** When false, the floor plan image is hidden. Only for type 'image'. */
  visible?: boolean;
  /** Set when the image loads (used for width calibration). */
  imageNaturalWidth?: number;
  imageNaturalHeight?: number;
};

export type ToolId =
  | "Select"
  | "Move"
  | "Rotate"
  | "Scale"
  | "AddPoint"
  | "Extrude"
  | "Measure"
  | "Draw outer wall"
  | "Draw inner wall"
  | "Draw windows"
  | "Draw doors"
  | "Draw stairs";

export type CenterlinePointRef = {
  objectId: string;
  pointIndex: number;
};

export type CenterlineSegmentRef = {
  objectId: string;
  segmentIndex: number;
};

/** Wall-window: which endpoint of the span along the parent wall is active. */
export type WindowEndpointRef = {
  objectId: string;
  which: "start" | "end";
};

export type SelectionState = {
  objectId: string | null;
  edge: EdgeRef | null;
  /** When set, an endpoint of the centerline is selected (move along segment only). */
  centerlinePoint: CenterlinePointRef | null;
  /** When set, a centerline segment is selected (move both endpoints perpendicular). */
  centerlineSegment: CenterlineSegmentRef | null;
  /** Selected vertex index on the completed measure polyline (for drag). */
  measureVertexIndex: number | null;
  /** Wall-window endpoint (drag along parent wall centerline). */
  windowEndpoint: WindowEndpointRef | null;
};

export type ExtrudePreview = {
  edgeRef: EdgeRef;
  distanceMm: number;
};

export type SnapSettings = {
  enabled: boolean;
  mm: number;
  /** Snap to the mm grid (spacing from `mm`). */
  gridSnap: boolean;
  /** Snap x/y to align with existing vertices and wall corners (orthogonal). */
  vertexSnap: boolean;
};

/** Default snap options (new documents and migration). */
export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  enabled: true,
  mm: 10,
  gridSnap: true,
  vertexSnap: true,
};

/** Merge partial / legacy snap (missing flags default to on). */
export function normalizeSnapSettings(s: SnapSettings | undefined | null): SnapSettings {
  if (!s) return { ...DEFAULT_SNAP_SETTINGS };
  return {
    enabled: s.enabled !== false,
    mm: typeof s.mm === "number" && Number.isFinite(s.mm) && s.mm >= 1 ? s.mm : DEFAULT_SNAP_SETTINGS.mm,
    gridSnap: s.gridSnap !== false,
    vertexSnap: s.vertexSnap !== false,
  };
}

/** Effective grid step in mm (0 = off). */
export function snapGridStepMm(snap: SnapSettings): number {
  return snap.enabled && snap.gridSnap && snap.mm >= 1 ? snap.mm : 0;
}

/** Vertex / edge alignment tolerance in world mm (0 = off). */
export function snapVertexToleranceMm(
  snap: SnapSettings,
  selectionDistancePx: number,
  zoom: number
): number {
  return snap.enabled && snap.vertexSnap ? selectionDistancePx / Math.max(zoom, 1e-9) : 0;
}

/** Hit-test buffer in pixels; edges within this distance of the pointer are selectable. */
export const DEFAULT_SELECTION_DISTANCE_PX = 10;

export type ViewportSize = { width: number; height: number };

export type DocumentState = {
  objects: VectorObject[];
  layers: Layer[];
  /** Id of the currently selected layer (for new objects, etc.). */
  activeLayerId: string | null;
  camera: Camera2D;
  selection: SelectionState;
  activeTool: ToolId;
  /** When true, show edge length whenever an edge is selected (any tool). */
  measureEnabled: boolean;
  /** When true, draw edge length labels on every edge, offset outward from the shape. */
  showEdgeMeasurements: boolean;
  /** Perpendicular offset in mm for edge measurement labels (outward from edge). */
  edgeMeasurementOffsetMm: number;
  /** When true, a box preview follows the pointer until click places it. */
  pendingAddShape: boolean;
  /** Size in mm of the box to place (e.g. 100 for items, 1000 for 1×1 m). */
  pendingAddSizeMm: number;
  /** When placing an item from Add item, the chosen item (id, label, color); items go on item layer and keep this color. */
  pendingAddItem: { id: string; label: string; color: string } | null;
  /** World position for the add-shape preview (null until first pointer move). */
  addShapePreviewWorld: { x: number; y: number } | null;
  /** When true, inspector shows Add item options (toggled by Add item button). */
  addItemPanelOpen: boolean;
  /** Draw tool: current path points (world coords); null when not drawing. */
  drawingPath: { x: number; y: number }[] | null;
  /** Draw tool: preview position for rubber-band segment (snapped to H/V from last point). */
  drawPreviewWorld: { x: number; y: number } | null;
  /** When set, completing a draw merges into this wall object instead of creating a new one. */
  drawingMergeObjectId: string | null;
  /** Endpoint index on that wall’s centerline (0 = start, last = end) used when merge started via Continue wall. */
  drawingMergeFromPointIndex: number | null;
  /** Measure tool: polyline being measured (world mm); null when inactive. */
  measurePath: { x: number; y: number }[] | null;
  /** Measure tool: rubber-band preview from last point. */
  measurePreviewWorld: { x: number; y: number } | null;
  /** Last finished polyline length from Measure tool (mm); null until a measurement is completed. */
  lastMeasureTotalMm: number | null;
  /** Last completed measure polyline (stays visible until a new measure is started). */
  completedMeasurePath: { x: number; y: number }[] | null;
  extrudePreview: ExtrudePreview | null;
  snap: SnapSettings;
  selectionDistancePx: number;
  viewportSize: ViewportSize | null;
  /** Used for Save to `saves/<name>.json` and shown in the toolbar. */
  projectName: string;
  /** Draw doors tool: single vs double (catalog widths). */
  doorDrawKind: DoorDrawKind;
  /** Draw doors: restrict catalog to region or use all sizes. */
  doorDrawRegionFilter: DoorDrawRegionFilter;
  /** Draw doors: inswing vs outswing for new wall doors and paired door-item symbol. */
  doorDrawSwing: DoorSwing;
  /** Stroke width (mm) for the next outer wall from Draw outer wall. */
  outerWallDrawWidthMm: number;
  /** Stroke width (mm) for the next inner wall from Draw inner wall. */
  innerWallDrawWidthMm: number;
  /** Plan width (mm) for the next stair run from Draw stairs. */
  stairsDrawWidthMm: number;
  /** Custom display names for rooms from floor/ceiling splits; keys `${outerWallId}:${localRoomIndex}`. */
  roomCustomNames: Record<string, string>;
  /** When true, draw room labels at each room centroid in the plan view. */
  showRoomLabelsInViewport: boolean;
};

export const createInitialCamera = (): Camera2D => ({
  center: vec2(0, 0),
  /** Pixels per world mm; lower = more zoomed out. Default chosen for comfortable overview. */
  zoom: 0.1,
});

/** Legacy id from older documents; stripped on load, objects remapped to {@link WALLS_LAYER_ID}. */
export const LEGACY_BASE_LAYER_ID = "layer-base";

/** Item layer id; created automatically when the first item is placed. */
export const ITEM_LAYER_ID = "layer-items";

/** Floor plan layer id; single layer, present by default, cannot be removed. */
export const REFERENCE_IMAGE_LAYER_ID = "layer-reference-image";

/** Axis-aligned foundation slab derived from wall bounds (created by default). */
export const FOUNDATION_LAYER_ID = "layer-foundation";

/** Finished floor (centerline AABB, flush with foundation top; created by default). */
export const FLOOR_LAYER_ID = "layer-floor";

/** Drawn wall centerlines are placed here (created by default). */
export const WALLS_LAYER_ID = "layer-walls";

/** Partition / inner wall centerlines (dividers); separate from outer walls. */
export const INNER_WALLS_LAYER_ID = "layer-inner-walls";

/** Windows layer id; wall-anchored windows are placed here (created by default). */
export const WINDOWS_LAYER_ID = "layer-windows";

/** Doors layer id; wall-anchored doors from Draw doors are placed here (created by default). */
export const DOORS_LAYER_ID = "layer-doors";

/**
 * Catalog-style door symbols (SVG / fill) drawn with Draw doors, paired to wall-hosted openings on {@link DOORS_LAYER_ID}.
 */
export const DOOR_ITEMS_LAYER_ID = "layer-door-items";

/**
 * Stair runs drawn in plan (axis-aligned polyline). Layer Z = finished floor (foundation top);
 * extrusion = full storey height (same vertical span as walls) for simple 3D export.
 */
export const STAIRS_LAYER_ID = "layer-stairs";

/** Ceiling slab derived from wall footprint; sits at wall height (created by default). */
export const CEILING_LAYER_ID = "layer-ceiling";

/** Floor skirting strips along wall segments (created by default). */
export const FLOOR_SKIRTING_LAYER_ID = "layer-floor-skirting";

/** Ceiling skirting strips along wall segments (created by default). */
export const CEILING_SKIRTING_LAYER_ID = "layer-ceiling-skirting";

/** Default Foundation layer colour (stone); slab under walls. */
export const FOUNDATION_LAYER_COLOR = "#78716c";

/** Default Floor layer colour (light floor tone); finished floor plane on foundation. */
export const FLOOR_LAYER_COLOR = "#e7e5e4";

/** Default Walls layer colour (red); used for layer swatch and wall strokes when `itemColor` is unset. */
export const WALLS_LAYER_COLOR = "#dc2626";

/** Inner / partition walls layer colour (teal), distinct from outer walls and amber selection. */
export const INNER_WALLS_LAYER_COLOR = "#0d9488";

/** Default Windows layer colour (light blue); matches wall-window `itemColor`. */
export const WINDOWS_LAYER_COLOR = "#38bdf8";

/** Default Doors layer colour (green). */
export const DOORS_LAYER_COLOR = "#22c55e";

/** Door items layer (plan symbols); distinct from wall openings layer. */
export const DOOR_ITEMS_LAYER_COLOR = "#3b82f6";

/** Stairs layer (plan run); distinct from walls. */
export const STAIRS_LAYER_COLOR = "#d97706";

/** Default Ceiling layer colour (light neutral). */
export const CEILING_LAYER_COLOR = "#d6d3d1";

/** Floor skirting layer colour (warm neutral). */
export const FLOOR_SKIRTING_LAYER_COLOR = "#a8a29e";

/** Ceiling skirting layer colour (slightly lighter). */
export const CEILING_SKIRTING_LAYER_COLOR = "#c4b5a0";

/** Default active layer for new documents (walls). */
export const DEFAULT_ACTIVE_LAYER_ID = WALLS_LAYER_ID;

/** True for tools that draw axis-aligned polylines (walls or stair run). */
export function isDrawWallLikeTool(tool: ToolId): boolean {
  return (
    tool === "Draw outer wall" || tool === "Draw inner wall" || tool === "Draw stairs"
  );
}

/** Migrate loaded documents (e.g. old `activeTool` / missing wall width prefs). */
export function migrateLoadedDocumentState(doc: DocumentState): DocumentState {
  const base = createInitialDocumentState();
  let activeTool = doc.activeTool;
  if ((activeTool as string) === "Draw wall") {
    activeTool = "Draw outer wall";
  }
  const outer = doc.outerWallDrawWidthMm;
  const inner = doc.innerWallDrawWidthMm;
  const stairsW = doc.stairsDrawWidthMm;
  const objects = Array.isArray(doc.objects) ? doc.objects : [];
  const roomCustomNames = pruneRoomCustomNames(
    objects,
    doc.roomCustomNames && typeof doc.roomCustomNames === "object" ? doc.roomCustomNames : {}
  );
  const doorDrawSwing: DoorSwing = doc.doorDrawSwing === "out" ? "out" : "in";
  return {
    ...doc,
    activeTool,
    doorDrawSwing,
    outerWallDrawWidthMm:
      typeof outer === "number" && Number.isFinite(outer) && outer > 0 ? outer : base.outerWallDrawWidthMm,
    innerWallDrawWidthMm:
      typeof inner === "number" && Number.isFinite(inner) && inner > 0 ? inner : base.innerWallDrawWidthMm,
    stairsDrawWidthMm:
      typeof stairsW === "number" && Number.isFinite(stairsW) && stairsW > 0
        ? stairsW
        : base.stairsDrawWidthMm,
    roomCustomNames,
    showRoomLabelsInViewport: doc.showRoomLabelsInViewport !== false,
  };
}

/** Drop legacy Base layer entries from a layer list. */
export function normalizeLayers(layers: Layer[]): Layer[] {
  return layers.filter((l) => l.id !== LEGACY_BASE_LAYER_ID);
}

/** Remap objects that still reference the removed Base layer to the walls layer. */
export function migrateLegacyLayerIdsOnObjects(
  objects: VectorObject[],
  fallbackLayerId: string
): VectorObject[] {
  return objects.map((o) =>
    o.layerId === LEGACY_BASE_LAYER_ID ? { ...o, layerId: fallbackLayerId } : o
  );
}

export function migrateActiveLayerIfLegacy(activeLayerId: string | null): string | null {
  if (activeLayerId === LEGACY_BASE_LAYER_ID) return WALLS_LAYER_ID;
  return activeLayerId;
}

const createDefaultLayers = (): Layer[] => [
  {
    id: REFERENCE_IMAGE_LAYER_ID,
    name: "Floor plan",
    color: "#94a3b8",
    zPositionMm: 0,
    extrusionHeightMm: 0,
    type: "image",
    imagePosition: { x: 0, y: 0 },
    imageScaleMmPerPixel: 1,
    imageOpacity: 0.6,
    visible: true,
  },
  {
    id: FOUNDATION_LAYER_ID,
    name: "Foundation",
    color: FOUNDATION_LAYER_COLOR,
    zPositionMm: 0,
    extrusionHeightMm: DEFAULT_FOUNDATION_HEIGHT_MM,
  },
  {
    id: FLOOR_LAYER_ID,
    name: "Floor",
    color: FLOOR_LAYER_COLOR,
    zPositionMm: DEFAULT_FOUNDATION_HEIGHT_MM,
    extrusionHeightMm: DEFAULT_FLOOR_THICKNESS_MM,
  },
  {
    id: WALLS_LAYER_ID,
    name: "Walls",
    color: WALLS_LAYER_COLOR,
    zPositionMm: DEFAULT_FOUNDATION_HEIGHT_MM,
    extrusionHeightMm: DEFAULT_WALL_HEIGHT_MM,
  },
  {
    id: INNER_WALLS_LAYER_ID,
    name: "Inner walls",
    color: INNER_WALLS_LAYER_COLOR,
    zPositionMm: DEFAULT_FOUNDATION_HEIGHT_MM,
    extrusionHeightMm: DEFAULT_WALL_HEIGHT_MM,
  },
  {
    id: WINDOWS_LAYER_ID,
    name: "Windows",
    color: WINDOWS_LAYER_COLOR,
    zPositionMm: DEFAULT_FOUNDATION_HEIGHT_MM + DEFAULT_WINDOW_SILL_HEIGHT_MM,
    extrusionHeightMm: DEFAULT_WINDOW_HEIGHT_MM,
  },
  {
    id: DOORS_LAYER_ID,
    name: "Doors",
    color: DOORS_LAYER_COLOR,
    zPositionMm: DEFAULT_FOUNDATION_HEIGHT_MM + DEFAULT_DOOR_SILL_HEIGHT_MM,
    extrusionHeightMm: DEFAULT_DOOR_HEIGHT_FALLBACK_MM,
  },
  {
    id: DOOR_ITEMS_LAYER_ID,
    name: "Door items",
    color: DOOR_ITEMS_LAYER_COLOR,
    zPositionMm: DEFAULT_FOUNDATION_HEIGHT_MM + DEFAULT_DOOR_SILL_HEIGHT_MM + 1,
    extrusionHeightMm: DEFAULT_DOOR_HEIGHT_FALLBACK_MM,
  },
  {
    id: STAIRS_LAYER_ID,
    name: "Stairs",
    color: STAIRS_LAYER_COLOR,
    zPositionMm: DEFAULT_FOUNDATION_HEIGHT_MM,
    extrusionHeightMm: DEFAULT_WALL_HEIGHT_MM,
  },
  {
    id: FLOOR_SKIRTING_LAYER_ID,
    name: "Floor skirting",
    color: FLOOR_SKIRTING_LAYER_COLOR,
    zPositionMm: DEFAULT_FOUNDATION_HEIGHT_MM,
    extrusionHeightMm: DEFAULT_FLOOR_SKIRTING_HEIGHT_MM,
  },
  {
    id: CEILING_SKIRTING_LAYER_ID,
    name: "Ceiling skirting",
    color: CEILING_SKIRTING_LAYER_COLOR,
    zPositionMm:
      DEFAULT_FOUNDATION_HEIGHT_MM + DEFAULT_WALL_HEIGHT_MM - DEFAULT_CEILING_SKIRTING_HEIGHT_MM,
    extrusionHeightMm: DEFAULT_CEILING_SKIRTING_HEIGHT_MM,
  },
  {
    id: CEILING_LAYER_ID,
    name: "Ceiling",
    color: CEILING_LAYER_COLOR,
    zPositionMm: DEFAULT_FOUNDATION_HEIGHT_MM + DEFAULT_WALL_HEIGHT_MM,
    extrusionHeightMm: DEFAULT_CEILING_THICKNESS_MM,
  },
];

/**
 * After loading a document, ensure built-in layers (floor plan, walls, windows, doors) exist so ids stay stable.
 * Drops legacy `layer-base` from incoming lists.
 */
export function mergeMissingDefaultLayers(incoming: Layer[]): Layer[] {
  const template = createDefaultLayers();
  const defaultIds = new Set(template.map((d) => d.id));
  const filtered = incoming.filter((l) => l.id !== LEGACY_BASE_LAYER_ID);
  const byId = new Map(filtered.map((l) => [l.id, l]));
  const merged: Layer[] = [];
  for (const d of template) {
    merged.push(byId.get(d.id) ?? d);
  }
  for (const l of filtered) {
    if (!defaultIds.has(l.id)) merged.push(l);
  }
  return merged;
}

/**
 * Replace built-in layers with fresh template defaults (z, extrusion, colours).
 * Preserves the floor plan image URL, position, scale, and visibility; other custom layers are kept after the template.
 */
export function resetBuiltInLayersToDefaults(currentLayers: Layer[]): Layer[] {
  const template = createDefaultLayers();
  const defaultIds = new Set(template.map((d) => d.id));
  const custom = currentLayers.filter((l) => !defaultIds.has(l.id));
  const prevById = new Map(currentLayers.map((l) => [l.id, l]));

  const rebuilt = template.map((def) => {
    if (def.id === REFERENCE_IMAGE_LAYER_ID && def.type === "image") {
      const prev = prevById.get(def.id);
      if (prev?.type === "image") {
        return {
          ...def,
          imageUrl: prev.imageUrl,
          imagePosition: prev.imagePosition ?? def.imagePosition,
          imageScaleMmPerPixel: prev.imageScaleMmPerPixel ?? def.imageScaleMmPerPixel,
          imageWidthMm: prev.imageWidthMm,
          imageNaturalWidth: prev.imageNaturalWidth,
          imageNaturalHeight: prev.imageNaturalHeight,
          visible: prev.visible !== false,
        };
      }
    }
    return { ...def };
  });

  return normalizeLayers([...rebuilt, ...custom]);
}

export const createInitialDocumentState = (): DocumentState => ({
  objects: [],
  layers: createDefaultLayers(),
  activeLayerId: DEFAULT_ACTIVE_LAYER_ID,
  camera: createInitialCamera(),
  selection: {
    objectId: null,
    edge: null,
    centerlinePoint: null,
    centerlineSegment: null,
    measureVertexIndex: null,
    windowEndpoint: null,
  },
  activeTool: "Select",
  measureEnabled: false,
  showEdgeMeasurements: false,
  edgeMeasurementOffsetMm: 10,
  pendingAddShape: false,
  pendingAddSizeMm: 1000,
  pendingAddItem: null,
  addShapePreviewWorld: null,
  addItemPanelOpen: false,
  drawingPath: null,
  drawPreviewWorld: null,
  drawingMergeObjectId: null,
  drawingMergeFromPointIndex: null,
  measurePath: null,
  measurePreviewWorld: null,
  lastMeasureTotalMm: null,
  completedMeasurePath: null,
  extrudePreview: null,
  snap: { ...DEFAULT_SNAP_SETTINGS },
  selectionDistancePx: DEFAULT_SELECTION_DISTANCE_PX,
  viewportSize: null,
  projectName: "Untitled",
  doorDrawKind: "single",
  doorDrawRegionFilter: "global",
  doorDrawSwing: "in",
  outerWallDrawWidthMm: DEFAULT_OUTER_WALL_DRAW_WIDTH_MM,
  innerWallDrawWidthMm: DEFAULT_INNER_WALL_DRAW_WIDTH_MM,
  stairsDrawWidthMm: DEFAULT_STAIRS_DRAW_WIDTH_MM,
  roomCustomNames: {},
  showRoomLabelsInViewport: true,
});
