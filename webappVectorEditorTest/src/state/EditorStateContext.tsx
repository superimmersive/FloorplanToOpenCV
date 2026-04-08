import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  useEffect,
  useState,
  useMemo,
} from "react";
import type { Camera2D, DoorHanding, DoorSwing, EdgeRef, VectorObject, Vec2 } from "../geometry/types";
import type {
  DocumentState,
  ToolId,
  SelectionState,
  ExtrudePreview,
  SnapSettings,
  ViewportSize,
  Layer,
  DoorDrawKind,
  DoorDrawRegionFilter,
} from "./editorState";
import {
  createInitialDocumentState,
  createInitialCamera,
  normalizeSnapSettings,
  snapGridStepMm,
  snapVertexToleranceMm,
  ITEM_LAYER_ID,
  REFERENCE_IMAGE_LAYER_ID,
  WALLS_LAYER_ID,
  INNER_WALLS_LAYER_ID,
  WINDOWS_LAYER_ID,
  DOORS_LAYER_ID,
  DOOR_ITEMS_LAYER_ID,
  STAIRS_LAYER_ID,
  STAIRS_LAYER_COLOR,
  WALLS_LAYER_COLOR,
  INNER_WALLS_LAYER_COLOR,
  isDrawWallLikeTool,
  WINDOWS_LAYER_COLOR,
  DEFAULT_ACTIVE_LAYER_ID,
  normalizeLayers,
  migrateLegacyLayerIdsOnObjects,
  migrateActiveLayerIfLegacy,
  migrateLoadedDocumentState,
  mergeMissingDefaultLayers,
  resetBuiltInLayersToDefaults,
} from "./editorState";
import { DEFAULT_FOUNDATION_HEIGHT_MM, DEFAULT_WALL_HEIGHT_MM } from "../building/buildingDefaults";
import { syncFoundationObjects } from "../geometry/foundation";
import {
  doorSpanPassesPlacementRules,
  dragWallHostedDoorEndpointWithRules,
} from "../geometry/doorPlacementRules";
import {
  createDoorSymbolForWallDoor,
  syncPairedDoorSymbolsForObjects,
} from "../geometry/doorSymbolFromWall";
import { generateCeilingSkirtingObjects, generateFloorSkirtingObjects } from "../geometry/skirting";
import { applyPositiveExtrusionMerged, applyNegativeExtrusion } from "../geometry/extrude";
import { cleanObjects } from "../geometry/cleanShape";
import { getObjectsBbox } from "../geometry/bbox";
import { moveEdge, moveShape } from "../geometry/move";
import { rotateObjectGeometry } from "../geometry/rotateShape";
import {
  pathToPolygon,
  polygonsFromStairsCenterline,
  tryCloseWallLoop,
  isWallPolylineOpen,
  mergeWallDrawIntoCenterline,
} from "../geometry/drawPath";
import { effectiveWallDrawWidthMm } from "../geometry/wallDrawWidth";
import {
  buildWindowPolygonAlongCenterlineSpan,
  distanceAlongPolylineToPoint,
  pointAtDistanceAlongPolyline,
  polylineTotalLength,
  snapWallWindowPointerOntoCenterline,
  MIN_WALL_WINDOW_SPAN_MM,
  syncWallWindowsForWall,
  syncAllWallWindows,
  reanchorWallWindowsAfterCenterlineEdit,
  isWallPolylineObject,
  layoutWallWindowObject,
  normalizeWallWindowRef,
} from "../geometry/wallWindow";
import { collectAlignmentVertices, snapWorldPointToGridAndVertices } from "../geometry/vertexSnap";
import {
  hasClosedOuterWallRegion,
  isPointInsideClosedOuterShells,
} from "../geometry/innerWallConstraint";
import {
  catalogWidthsForDraw,
  computeWallDoorSpanFromFixedJamb,
  doubleDoorCatalogIdForSpanMm,
  doubleDoorOptionByWidthMm,
  nearestCatalogWidthMm,
} from "../items/doorSizes";
import { vec2 } from "../geometry/types";
import {
  snapshotForHistory,
  serializeForLocalStorage,
  LOCAL_STORAGE_KEY,
  parseFromLocalStorage,
} from "./documentSnapshot";
import { localProjectFileUrl, safeProjectFileName } from "../api/localDocument";

type EditorAction =
  | { type: "SET_CAMERA"; payload: Partial<Camera2D> }
  | { type: "SET_ACTIVE_TOOL"; payload: ToolId }
  | { type: "SET_SELECTION"; payload: SelectionState }
  | { type: "SET_OBJECTS"; payload: VectorObject[] }
  | { type: "SET_EXTRUDE_PREVIEW"; payload: ExtrudePreview | null }
  | { type: "SET_SNAP"; payload: Partial<SnapSettings> }
  | { type: "SET_SELECTION_DISTANCE_PX"; payload: number }
  | { type: "SET_VIEWPORT_SIZE"; payload: ViewportSize | null }
  | { type: "SET_LAYERS"; payload: Layer[] }
  | { type: "ADD_LAYER"; payload: Layer }
  | { type: "UPDATE_LAYER"; payload: { id: string; patch: Partial<Layer> } }
  | { type: "SET_ACTIVE_LAYER"; payload: string | null }
  | { type: "REMOVE_LAYER"; payload: string }
  | { type: "SET_MEASURE_ENABLED"; payload: boolean }
  | { type: "SET_SHOW_EDGE_MEASUREMENTS"; payload: boolean }
  | { type: "SET_PENDING_ADD_SHAPE"; payload: { enabled: boolean; sizeMm?: number } }
  | { type: "SET_PENDING_ADD_ITEM"; payload: { id: string; label: string; color: string } | null }
  | { type: "SET_ADD_SHAPE_PREVIEW_WORLD"; payload: { x: number; y: number } | null }
  | { type: "SET_ADD_ITEM_PANEL_OPEN"; payload: boolean }
  | { type: "SET_DRAWING_PATH"; payload: { x: number; y: number }[] | null }
  | { type: "APPEND_DRAWING_POINT"; payload: { x: number; y: number } }
  | { type: "SET_DRAW_PREVIEW_WORLD"; payload: { x: number; y: number } | null }
  | { type: "COMPLETE_DRAWING" }
  | { type: "START_CONTINUE_WALL"; payload: { objectId: string; pointIndex: number } }
  | { type: "SET_MEASURE_PATH"; payload: { x: number; y: number }[] | null }
  | { type: "APPEND_MEASURE_POINT"; payload: { x: number; y: number } }
  | { type: "SET_MEASURE_PREVIEW_WORLD"; payload: { x: number; y: number } | null }
  | { type: "FINISH_MEASURE"; payload: { totalMm: number; path: { x: number; y: number }[] } }
  | { type: "CANCEL_MEASURE" }
  | { type: "CLEAR_MEASURE_RESULT" }
  | { type: "UPDATE_COMPLETED_MEASURE_POINT"; payload: { index: number; position: { x: number; y: number } } }
  | {
      type: "SCALE_COMPLETED_MEASURE_WITH_FLOOR_PLAN";
      payload: { center: { x: number; y: number }; k: number; lastMeasureTotalMm: number };
    }
  | { type: "HYDRATE_DOCUMENT"; payload: DocumentState }
  | { type: "SET_PROJECT_NAME"; payload: string }
  | { type: "SET_DOOR_DRAW_KIND"; payload: DoorDrawKind }
  | { type: "SET_DOOR_DRAW_REGION_FILTER"; payload: DoorDrawRegionFilter }
  | { type: "SET_DOOR_DRAW_SWING"; payload: DoorSwing }
  | { type: "SET_OUTER_WALL_DRAW_WIDTH_MM"; payload: number }
  | { type: "SET_INNER_WALL_DRAW_WIDTH_MM"; payload: number }
  | { type: "SET_STAIRS_DRAW_WIDTH_MM"; payload: number }
  | { type: "SET_ROOM_CUSTOM_NAME"; payload: { key: string; name: string } }
  | { type: "SET_SHOW_ROOM_LABELS_IN_VIEWPORT"; payload: boolean }
  /** Ensures Windows/Doors layer exists, appends object, sets active layer (atomic). */
  | {
      type: "PLACE_WALL_OPENING";
      payload: { kind: "window" | "door"; object: VectorObject; companionObject?: VectorObject };
    }
  /** Restore built-in layer z, extrusion, and colours to app defaults (keeps floor plan image + custom layers). */
  | { type: "RESET_LAYER_DEFAULTS" };

function editorReducer(state: DocumentState, action: EditorAction): DocumentState {
  switch (action.type) {
    case "SET_CAMERA":
      return {
        ...state,
        camera: { ...state.camera, ...action.payload },
      };
    case "PLACE_WALL_OPENING": {
      const { kind, object, companionObject } = action.payload;
      const layerId = kind === "window" ? WINDOWS_LAYER_ID : DOORS_LAYER_ID;
      const layers = mergeMissingDefaultLayers(state.layers);
      const wallObject = { ...object, layerId };
      const toAdd = companionObject ? [wallObject, companionObject] : [wallObject];
      return {
        ...state,
        layers,
        objects: [...state.objects, ...toAdd],
        activeLayerId: layerId,
        ...(kind === "door"
          ? {
              selection: {
                ...state.selection,
                // Select the plan door symbol (item layer) so handing / swing / facing show in the inspector.
                objectId: companionObject?.id ?? wallObject.id,
                edge: null,
                centerlinePoint: null,
                centerlineSegment: null,
                measureVertexIndex: null,
                windowEndpoint: null,
              },
            }
          : {}),
      };
    }
    case "SET_ACTIVE_TOOL": {
      const tool = action.payload;
      const layers =
        isDrawWallLikeTool(tool) || tool === "Draw windows" || tool === "Draw doors"
          ? mergeMissingDefaultLayers(state.layers)
          : state.layers;
      const activeLayerId =
        tool === "Draw outer wall" && layers.some((l) => l.id === WALLS_LAYER_ID)
          ? WALLS_LAYER_ID
          : tool === "Draw inner wall" && layers.some((l) => l.id === INNER_WALLS_LAYER_ID)
            ? INNER_WALLS_LAYER_ID
            : tool === "Draw stairs" && layers.some((l) => l.id === STAIRS_LAYER_ID)
              ? STAIRS_LAYER_ID
              : tool === "Draw windows" && layers.some((l) => l.id === WINDOWS_LAYER_ID)
                ? WINDOWS_LAYER_ID
                : tool === "Draw doors" && layers.some((l) => l.id === DOORS_LAYER_ID)
                  ? DOORS_LAYER_ID
                  : state.activeLayerId;
      return {
        ...state,
        layers,
        activeTool: tool,
        activeLayerId,
        ...(!isDrawWallLikeTool(tool)
          ? {
              drawingPath: null,
              drawPreviewWorld: null,
              drawingMergeObjectId: null,
              drawingMergeFromPointIndex: null,
            }
          : {}),
        ...(tool !== "Measure" ? { measurePath: null, measurePreviewWorld: null } : {}),
        ...(!isDrawWallLikeTool(tool) && tool !== "Select" && tool !== "Move"
          ? {
              selection: {
                ...state.selection,
                centerlinePoint: null,
                centerlineSegment: null,
                windowEndpoint: null,
              },
            }
          : {}),
        ...(tool !== "Select" && tool !== "Measure"
          ? { selection: { ...state.selection, measureVertexIndex: null } }
          : {}),
      };
    }
    case "SET_SELECTION":
      return { ...state, selection: action.payload };
    case "SET_OBJECTS":
      return { ...state, objects: syncFoundationObjects(action.payload) };
    case "SET_EXTRUDE_PREVIEW":
      return { ...state, extrudePreview: action.payload };
    case "SET_SNAP":
      return { ...state, snap: { ...state.snap, ...action.payload } };
    case "SET_SELECTION_DISTANCE_PX":
      return { ...state, selectionDistancePx: action.payload };
    case "SET_VIEWPORT_SIZE":
      return { ...state, viewportSize: action.payload };
    case "SET_LAYERS":
      return { ...state, layers: normalizeLayers(action.payload) };
    case "ADD_LAYER":
      return { ...state, layers: normalizeLayers([...state.layers, action.payload]) };
    case "UPDATE_LAYER": {
      const { id, patch } = action.payload;
      return {
        ...state,
        layers: state.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      };
    }
    case "RESET_LAYER_DEFAULTS":
      return { ...state, layers: resetBuiltInLayersToDefaults(state.layers) };
    case "SET_ACTIVE_LAYER":
      return { ...state, activeLayerId: action.payload };
    case "REMOVE_LAYER": {
      const idToRemove = action.payload;
      if (idToRemove === REFERENCE_IMAGE_LAYER_ID) return state;
      const remaining = state.layers.filter((l) => l.id !== idToRemove);
      if (remaining.length === 0) return state;
      const layersOrdered = normalizeLayers(remaining);
      const removedObjectIds = new Set(
        state.objects.filter((o) => o.layerId === idToRemove).map((o) => o.id)
      );
      const nextObjects = state.objects.filter((obj) => obj.layerId !== idToRemove);
      const nextActive =
        state.activeLayerId === idToRemove ? layersOrdered[0]?.id ?? null : state.activeLayerId;
      let selection = state.selection;
      if (selection.objectId && removedObjectIds.has(selection.objectId)) {
        selection = {
          ...selection,
          objectId: null,
          edge: null,
          centerlinePoint: null,
          centerlineSegment: null,
          windowEndpoint: null,
        };
      }
      if (selection.windowEndpoint && removedObjectIds.has(selection.windowEndpoint.objectId)) {
        selection = { ...selection, windowEndpoint: null };
      }
      if (selection.centerlinePoint && removedObjectIds.has(selection.centerlinePoint.objectId)) {
        selection = { ...selection, centerlinePoint: null };
      }
      if (selection.centerlineSegment && removedObjectIds.has(selection.centerlineSegment.objectId)) {
        selection = { ...selection, centerlineSegment: null };
      }
      if (selection.edge && removedObjectIds.has(selection.edge.objectId)) {
        selection = { ...selection, edge: null };
      }
      return {
        ...state,
        layers: layersOrdered,
        objects: nextObjects,
        activeLayerId: nextActive,
        selection,
      };
    }
    case "SET_MEASURE_ENABLED":
      return { ...state, measureEnabled: action.payload };
    case "SET_SHOW_EDGE_MEASUREMENTS":
      return { ...state, showEdgeMeasurements: action.payload };
    case "SET_PENDING_ADD_SHAPE": {
      const { enabled, sizeMm } = action.payload;
      const nextSize = enabled && sizeMm != null ? sizeMm : enabled ? state.pendingAddSizeMm : 1000;
      return {
        ...state,
        pendingAddShape: enabled,
        pendingAddSizeMm: nextSize,
        ...(enabled
          ? { addItemPanelOpen: false }
          : { addShapePreviewWorld: null, pendingAddSizeMm: 1000, pendingAddItem: null }),
      };
    }
    case "SET_PENDING_ADD_ITEM":
      return { ...state, pendingAddItem: action.payload };
    case "SET_ADD_SHAPE_PREVIEW_WORLD":
      return { ...state, addShapePreviewWorld: action.payload };
    case "SET_ADD_ITEM_PANEL_OPEN": {
      const open = action.payload;
      if (open) {
        return {
          ...state,
          addItemPanelOpen: true,
          pendingAddShape: false,
          addShapePreviewWorld: null,
          pendingAddSizeMm: 1000,
        };
      }
      return { ...state, addItemPanelOpen: false };
    }
    case "SET_DRAWING_PATH":
      return {
        ...state,
        drawingPath: action.payload,
        drawPreviewWorld: null,
        ...(action.payload === null
          ? { drawingMergeObjectId: null, drawingMergeFromPointIndex: null }
          : {}),
      };
    case "APPEND_DRAWING_POINT":
      return {
        ...state,
        drawingPath: state.drawingPath ? [...state.drawingPath, action.payload] : [action.payload],
      };
    case "SET_DRAW_PREVIEW_WORLD":
      return { ...state, drawPreviewWorld: action.payload };
    case "COMPLETE_DRAWING":
      return {
        ...state,
        drawingPath: null,
        drawPreviewWorld: null,
        drawingMergeObjectId: null,
        drawingMergeFromPointIndex: null,
      };
    case "START_CONTINUE_WALL": {
      const { objectId, pointIndex } = action.payload;
      const obj = state.objects.find((o) => o.id === objectId);
      const cl = obj?.centerline;
      if (!obj || !cl || cl.length < 2) return state;
      const lastI = cl.length - 1;
      const pi =
        pointIndex === 0 || pointIndex === lastI ? pointIndex : lastI;
      const seed = cl[pi];
      return {
        ...state,
        drawingPath: [{ x: seed.x, y: seed.y }],
        drawingMergeObjectId: objectId,
        drawingMergeFromPointIndex: pi,
        drawPreviewWorld: null,
      };
    }
    case "SET_MEASURE_PATH": {
      const p = action.payload;
      return {
        ...state,
        measurePath: p,
        measurePreviewWorld: null,
        ...(p != null && p.length === 1
          ? {
              completedMeasurePath: null,
              selection: { ...state.selection, measureVertexIndex: null },
            }
          : {}),
      };
    }
    case "APPEND_MEASURE_POINT":
      return {
        ...state,
        measurePath: state.measurePath ? [...state.measurePath, action.payload] : [action.payload],
      };
    case "SET_MEASURE_PREVIEW_WORLD":
      return { ...state, measurePreviewWorld: action.payload };
    case "FINISH_MEASURE":
      return {
        ...state,
        measurePath: null,
        measurePreviewWorld: null,
        completedMeasurePath: action.payload.path,
        lastMeasureTotalMm: action.payload.totalMm,
        selection: { ...state.selection, measureVertexIndex: null },
      };
    case "CANCEL_MEASURE":
      return { ...state, measurePath: null, measurePreviewWorld: null };
    case "CLEAR_MEASURE_RESULT":
      return {
        ...state,
        completedMeasurePath: null,
        lastMeasureTotalMm: null,
        selection: { ...state.selection, measureVertexIndex: null },
      };
    case "UPDATE_COMPLETED_MEASURE_POINT": {
      const { index, position } = action.payload;
      const path = state.completedMeasurePath;
      if (!path || index < 0 || index >= path.length) return state;
      const next = path.map((pt, i) => (i === index ? { ...position } : { ...pt }));
      let total = 0;
      for (let i = 1; i < next.length; i++) {
        total += Math.hypot(next[i].x - next[i - 1].x, next[i].y - next[i - 1].y);
      }
      return { ...state, completedMeasurePath: next, lastMeasureTotalMm: total };
    }
    case "SCALE_COMPLETED_MEASURE_WITH_FLOOR_PLAN": {
      const path = state.completedMeasurePath;
      if (!path || path.length === 0) return state;
      const { center, k, lastMeasureTotalMm } = action.payload;
      const next = path.map((p) => ({
        x: center.x + (p.x - center.x) * k,
        y: center.y + (p.y - center.y) * k,
      }));
      return { ...state, completedMeasurePath: next, lastMeasureTotalMm };
    }
    case "HYDRATE_DOCUMENT": {
      const migrated = migrateLoadedDocumentState(action.payload);
      const doorDrawKind: DoorDrawKind =
        migrated.doorDrawKind === "double" ? "double" : "single";
      const doorDrawRegionFilter: DoorDrawRegionFilter =
        migrated.doorDrawRegionFilter === "SA" || migrated.doorDrawRegionFilter === "UK"
          ? migrated.doorDrawRegionFilter
          : "global";
      const mergedLayers = mergeMissingDefaultLayers(Array.isArray(migrated.layers) ? migrated.layers : []);
      const migratedObjects = migrateLegacyLayerIdsOnObjects(
        Array.isArray(migrated.objects) ? migrated.objects : [],
        WALLS_LAYER_ID
      );
      let activeLayerId = migrateActiveLayerIfLegacy(migrated.activeLayerId);
      if (activeLayerId != null && !mergedLayers.some((l) => l.id === activeLayerId)) {
        activeLayerId = mergedLayers.find((l) => l.type !== "image")?.id ?? WALLS_LAYER_ID;
      }
      return {
        ...migrated,
        snap: normalizeSnapSettings(migrated.snap),
        doorDrawKind,
        doorDrawRegionFilter,
        layers: mergedLayers,
        viewportSize: state.viewportSize,
        activeLayerId: activeLayerId ?? DEFAULT_ACTIVE_LAYER_ID,
        objects: syncPairedDoorSymbolsForObjects(syncAllWallWindows(migratedObjects)),
      };
    }
    case "SET_PROJECT_NAME":
      return { ...state, projectName: action.payload };
    case "SET_DOOR_DRAW_KIND":
      return { ...state, doorDrawKind: action.payload };
    case "SET_DOOR_DRAW_REGION_FILTER":
      return { ...state, doorDrawRegionFilter: action.payload };
    case "SET_DOOR_DRAW_SWING":
      return { ...state, doorDrawSwing: action.payload };
    case "SET_OUTER_WALL_DRAW_WIDTH_MM":
      return { ...state, outerWallDrawWidthMm: action.payload };
    case "SET_INNER_WALL_DRAW_WIDTH_MM":
      return { ...state, innerWallDrawWidthMm: action.payload };
    case "SET_STAIRS_DRAW_WIDTH_MM":
      return { ...state, stairsDrawWidthMm: action.payload };
    case "SET_ROOM_CUSTOM_NAME": {
      const { key, name } = action.payload;
      const next = { ...state.roomCustomNames };
      const trimmed = name.trim();
      if (trimmed === "") delete next[key];
      else next[key] = trimmed;
      return { ...state, roomCustomNames: next };
    }
    case "SET_SHOW_ROOM_LABELS_IN_VIEWPORT":
      return { ...state, showRoomLabelsInViewport: action.payload };
    default:
      return state;
  }
}

type EditorContextValue = {
  state: DocumentState;
  /** Call before a mutating command so Undo can restore the prior document. */
  pushHistory: (snapshot: DocumentState) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Save document: writes to `webappVectorEditorTest/saves/document.json` when the Vite dev/preview
   * server is running; otherwise downloads a `.json` file.
   */
  saveDocumentToFile: () => Promise<void>;
  /** Load `saves/<name>.json` via dev/preview API. Sets project name to `name`. */
  loadDocumentFromProjectFile: (name: string) => Promise<boolean>;
  /** Replace document from JSON. Optional `projectName` overrides the name in the file (e.g. when loading from disk). */
  loadDocumentFromJson: (json: string, options?: { projectName?: string }) => boolean;
  /** Reset to an empty document (clears undo history). */
  newDocument: () => void;
  setProjectName: (name: string) => void;
  setCamera: (camera: Partial<Camera2D>) => void;
  setActiveTool: (tool: ToolId) => void;
  setSelection: (selection: SelectionState) => void;
  setExtrudePreview: (preview: ExtrudePreview | null) => void;
  applyExtrude: (edgeRef: EdgeRef, distanceMm: number) => void | Promise<void>;
  cleanShapes: () => void;
  setSnap: (snap: Partial<SnapSettings>) => void;
  setSelectionDistancePx: (px: number) => void;
  setMeasureEnabled: (enabled: boolean) => void;
  setShowEdgeMeasurements: (enabled: boolean) => void;
  setPendingAddShape: (enabled: boolean, sizeMm?: number) => void;
  setPendingAddItem: (item: { id: string; label: string; color: string } | null) => void;
  setAddItemPanelOpen: (open: boolean) => void;
  setAddShapePreviewWorld: (pos: { x: number; y: number } | null) => void;
  placeAddShape: (worldCenter: { x: number; y: number }) => void;
  /** Wall-anchored window on the Windows layer; span must follow the wall centerline (world mm). */
  placeWallWindow: (wallId: string, a: Vec2, b: Vec2) => void;
  /** Wall-anchored door: first jamb at fixedAlongMm, width from nearest catalog size toward pointer (world mm). */
  placeWallDoor: (wallId: string, a: Vec2, b: Vec2) => void;
  setDoorDrawKind: (kind: DoorDrawKind) => void;
  setDoorDrawRegionFilter: (filter: DoorDrawRegionFilter) => void;
  setDoorDrawSwing: (swing: DoorSwing) => void;
  setOuterWallDrawWidthMm: (mm: number) => void;
  setInnerWallDrawWidthMm: (mm: number) => void;
  setStairsDrawWidthMm: (mm: number) => void;
  setRoomCustomName: (roomKey: string, name: string) => void;
  setShowRoomLabelsInViewport: (show: boolean) => void;
  /** Pass explicitObjectId from keyboard handlers to avoid stale closure; omit to use current selection. */
  removeSelectedShape: (explicitObjectId?: string | null) => void;
  /** Drag a wall-window endpoint along the parent wall (Select/Move + handle). */
  updateWallWindowEndpointDrag: (windowId: string, which: "start" | "end", world: Vec2) => void;
  updateCenterlinePoint: (objectId: string, pointIndex: number, newPosition: Vec2) => void;
  updateCenterlineSegment: (objectId: string, segmentIndex: number, delta: Vec2) => void;
  updateDrawShapeWidth: (objectId: string, widthMm: number) => void;
  /** Single-door: handing / swing / facing (degrees). */
  updateDoorItemProps: (
    objectId: string,
    patch: { doorHanding?: DoorHanding; doorSwing?: DoorSwing; itemDirectionDeg?: number }
  ) => void;
  /** Resize door plan symbol to widthMm × widthMm; wall-hosted doors keep center along wall. */
  updateDoorSquareSize: (objectId: string, widthMm: number, catalogOptionId?: string) => void;
  setDrawingPath: (path: { x: number; y: number }[] | null) => void;
  appendDrawingPoint: (point: { x: number; y: number }) => void;
  setDrawPreviewWorld: (pos: { x: number; y: number } | null) => void;
  /** Finish the wall; optional path when closing loop without waiting for state update. */
  completeDrawing: (pathOverride?: { x: number; y: number }[]) => void;
  /** Append the start point and finish the wall when the open end lines up with the start (axis-aligned). */
  closeWallLoop: () => void;
  cancelDrawing: () => void;
  /** Seed draw path from the selected wall’s last point so new segments merge on Complete. */
  continueWallFromSelection: () => void;
  setMeasurePath: (path: { x: number; y: number }[] | null) => void;
  appendMeasurePoint: (point: { x: number; y: number }) => void;
  setMeasurePreviewWorld: (pos: { x: number; y: number } | null) => void;
  completeMeasure: () => void;
  cancelMeasure: () => void;
  clearCompletedMeasure: () => void;
  updateCompletedMeasurePoint: (index: number, position: { x: number; y: number }) => void;
  /** Scale floor plan width so last measure length (mm) matches trueLengthMm. */
  applyFloorPlanCalibrationFromMeasure: (trueLengthMm: number) => void;
  setViewportSize: (size: ViewportSize | null) => void;
  frameContent: () => void;
  centerView: () => void;
  applyMoveEdge: (edgeRef: EdgeRef, delta: { x: number; y: number }) => void;
  applyMoveObject: (objectId: string, delta: { x: number; y: number }) => void;
  /** Apply move from a snapshot (e.g. drag start) so delta is total from start, not incremental. */
  applyMoveEdgeFromSnapshot: (
    snapshot: VectorObject[],
    edgeRef: EdgeRef,
    delta: { x: number; y: number }
  ) => void;
  applyMoveObjectFromSnapshot: (
    snapshot: VectorObject[],
    objectId: string,
    delta: { x: number; y: number }
  ) => void;
  /** Rotate one object about `center` by `deltaDeg`° from frozen `snapshot` (total delta from drag start). */
  applyRotateObjectFromSnapshot: (
    snapshot: VectorObject[],
    objectId: string,
    center: Vec2,
    deltaDeg: number
  ) => void;
  addLayer: () => void;
  updateLayer: (id: string, patch: Partial<Layer>, options?: { skipHistory?: boolean }) => void;
  setActiveLayer: (id: string | null) => void;
  removeLayer: (id: string) => void;
  /** Move a vector object to another layer (not the floor plan image layer). */
  setObjectLayerId: (objectId: string, layerId: string) => void;
  /** Reset built-in layers to default z, extrusion, and colours (floor plan image URL/position kept). */
  resetLayerDefaults: () => void;
  /** Build/replace floor skirting from walls; omits spans covered by wall-hosted doors. */
  generateFloorSkirting: () => void;
  /** Build/replace ceiling skirting from walls (full segments). */
  generateCeilingSkirting: () => void;
};

const EditorStateContext = createContext<EditorContextValue | null>(null);

const MAX_HISTORY = 60;

function readInitialDocumentState(): DocumentState {
  try {
    if (typeof localStorage === "undefined") return createInitialDocumentState();
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return createInitialDocumentState();
    const doc = parseFromLocalStorage(raw) ?? createInitialDocumentState();
    return { ...doc, layers: mergeMissingDefaultLayers(doc.layers) };
  } catch {
    return createInitialDocumentState();
  }
}

export function EditorStateProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, undefined, readInitialDocumentState);

  const historyPastRef = useRef<DocumentState[]>([]);
  const historyFutureRef = useRef<DocumentState[]>([]);
  const [historyRevision, setHistoryRevision] = useState(0);

  const bumpHistoryUi = useCallback(() => setHistoryRevision((n) => n + 1), []);

  const pushHistory = useCallback(
    (stateToSave: DocumentState) => {
      historyPastRef.current.push(snapshotForHistory(stateToSave));
      if (historyPastRef.current.length > MAX_HISTORY) historyPastRef.current.shift();
      historyFutureRef.current = [];
      bumpHistoryUi();
    },
    [bumpHistoryUi]
  );

  const undo = useCallback(() => {
    if (historyPastRef.current.length === 0) return;
    const previous = historyPastRef.current.pop()!;
    historyFutureRef.current.push(snapshotForHistory(state));
    dispatch({ type: "HYDRATE_DOCUMENT", payload: previous });
    bumpHistoryUi();
  }, [state, bumpHistoryUi]);

  const redo = useCallback(() => {
    if (historyFutureRef.current.length === 0) return;
    const next = historyFutureRef.current.pop()!;
    historyPastRef.current.push(snapshotForHistory(state));
    dispatch({ type: "HYDRATE_DOCUMENT", payload: next });
    bumpHistoryUi();
  }, [state, bumpHistoryUi]);

  const canUndo = useMemo(() => historyPastRef.current.length > 0, [historyRevision]);
  const canRedo = useMemo(() => historyFutureRef.current.length > 0, [historyRevision]);

  const saveDocumentToFile = useCallback(async () => {
    const json = serializeForLocalStorage(state);
    const fileStem = safeProjectFileName(state.projectName);
    if (!fileStem) {
      window.alert(
        "Set a project name using letters, numbers, dashes, or underscores (e.g. my-floorplan)."
      );
      return;
    }
    try {
      const r = await fetch(localProjectFileUrl(fileStem), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
      });
      if (r.ok) return;
    } catch {
      /* static hosting or no dev middleware */
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileStem}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state]);

  const loadDocumentFromJson = useCallback(
    (json: string, options?: { projectName?: string }) => {
      let hadBlobFloorPlan = false;
      try {
        const raw = JSON.parse(json) as { doc?: { layers?: { type?: string; imageUrl?: string }[] } };
        hadBlobFloorPlan = Boolean(
          raw.doc?.layers?.some(
            (l) => l?.type === "image" && typeof l.imageUrl === "string" && l.imageUrl.startsWith("blob:")
          )
        );
      } catch {
        /* ignore */
      }
      const doc = parseFromLocalStorage(json);
      if (!doc) return false;
      if (hadBlobFloorPlan) {
        window.alert(
          "This file stored the floor plan as a temporary browser link. Re-add the image: Layers → Floor plan → Choose file."
        );
      }
      const payload =
        options?.projectName != null ? { ...doc, projectName: options.projectName } : doc;
      historyPastRef.current = [];
      historyFutureRef.current = [];
      bumpHistoryUi();
      dispatch({ type: "HYDRATE_DOCUMENT", payload });
      return true;
    },
    [bumpHistoryUi]
  );

  const loadDocumentFromProjectFile = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        const r = await fetch(localProjectFileUrl(name));
        if (!r.ok) return false;
        const text = await r.text();
        return loadDocumentFromJson(text, { projectName: name });
      } catch {
        return false;
      }
    },
    [loadDocumentFromJson]
  );

  const setProjectName = useCallback((name: string) => {
    dispatch({ type: "SET_PROJECT_NAME", payload: name });
  }, []);

  const newDocument = useCallback(() => {
    historyPastRef.current = [];
    historyFutureRef.current = [];
    bumpHistoryUi();
    dispatch({ type: "HYDRATE_DOCUMENT", payload: createInitialDocumentState() });
  }, [bumpHistoryUi]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, serializeForLocalStorage(state));
      } catch {
        /* quota / private mode */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [state]);

  const setCamera = useCallback((camera: Partial<Camera2D>) => {
    dispatch({ type: "SET_CAMERA", payload: camera });
  }, []);

  const setActiveTool = useCallback((tool: ToolId) => {
    dispatch({ type: "SET_ACTIVE_TOOL", payload: tool });
  }, []);

  const setSelection = useCallback((selection: SelectionState) => {
    dispatch({ type: "SET_SELECTION", payload: selection });
  }, []);

  const setExtrudePreview = useCallback((preview: ExtrudePreview | null) => {
    dispatch({ type: "SET_EXTRUDE_PREVIEW", payload: preview });
  }, []);

  const applyExtrude = useCallback((edgeRef: EdgeRef, distanceMm: number) => {
    if (distanceMm === 0) {
      dispatch({ type: "SET_EXTRUDE_PREVIEW", payload: null });
      return;
    }
    pushHistory(state);
    const g = snapGridStepMm(state.snap);
    const snapGridMm = g > 0 ? g : 1;
    const promise =
      distanceMm > 0
        ? applyPositiveExtrusionMerged(state.objects, edgeRef, distanceMm, snapGridMm)
        : applyNegativeExtrusion(state.objects, edgeRef, distanceMm, snapGridMm);
    return promise.then((nextObjects) => {
      dispatch({ type: "SET_OBJECTS", payload: nextObjects });
      dispatch({
        type: "SET_SELECTION",
        payload: {
          objectId: null,
          edge: null,
          centerlinePoint: null,
          centerlineSegment: null,
          measureVertexIndex: null,
          windowEndpoint: null,
        },
      });
      dispatch({ type: "SET_EXTRUDE_PREVIEW", payload: null });
    });
  }, [state, state.objects, state.snap, pushHistory]);

  const cleanShapes = useCallback(() => {
    pushHistory(state);
    const next = state.objects.map((obj) =>
      obj.itemColor != null ? obj : (cleanObjects([obj])[0] ?? obj)
    );
    dispatch({ type: "SET_OBJECTS", payload: syncAllWallWindows(next) });
  }, [state, state.objects, pushHistory]);

  const setSnap = useCallback((payload: Partial<SnapSettings>) => {
    dispatch({ type: "SET_SNAP", payload });
  }, []);

  const setSelectionDistancePx = useCallback((px: number) => {
    dispatch({ type: "SET_SELECTION_DISTANCE_PX", payload: px });
  }, []);

  const setMeasureEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: "SET_MEASURE_ENABLED", payload: enabled });
  }, []);

  const setShowEdgeMeasurements = useCallback((enabled: boolean) => {
    dispatch({ type: "SET_SHOW_EDGE_MEASUREMENTS", payload: enabled });
  }, []);

  const setPendingAddShape = useCallback((enabled: boolean, sizeMm?: number) => {
    dispatch({
      type: "SET_PENDING_ADD_SHAPE",
      payload: { enabled, ...(sizeMm != null && { sizeMm }) },
    });
  }, []);

  const setPendingAddItem = useCallback((item: { id: string; label: string; color: string } | null) => {
    dispatch({ type: "SET_PENDING_ADD_ITEM", payload: item });
  }, []);

  const setAddItemPanelOpen = useCallback((open: boolean) => {
    dispatch({ type: "SET_ADD_ITEM_PANEL_OPEN", payload: open });
  }, []);

  const setAddShapePreviewWorld = useCallback((pos: { x: number; y: number } | null) => {
    dispatch({ type: "SET_ADD_SHAPE_PREVIEW_WORLD", payload: pos });
  }, []);

  const placeAddShape = useCallback((worldCenter: { x: number; y: number }) => {
    pushHistory(state);
    const isItem = state.pendingAddItem != null;
    let layerId: string;
    if (isItem) {
      const itemLayer = state.layers.find((l) => l.isItemLayer);
      if (!itemLayer) {
        dispatch({
          type: "ADD_LAYER",
          payload: {
            id: ITEM_LAYER_ID,
            name: "Items",
            color: "#94a3b8",
            zPositionMm: 0,
            extrusionHeightMm: 0,
            isItemLayer: true,
          },
        });
      }
      layerId = ITEM_LAYER_ID;
    } else {
      const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
      layerId =
        activeLayer?.type === "image"
          ? (state.layers.find((l) => l.type !== "image")?.id ?? WALLS_LAYER_ID)
          : (state.activeLayerId ?? WALLS_LAYER_ID);
    }
    const gridMm = snapGridStepMm(state.snap);
    const tolMm = snapVertexToleranceMm(state.snap, state.selectionDistancePx, state.camera.zoom);
    const verts = collectAlignmentVertices(state.objects, null, null);
    const c = snapWorldPointToGridAndVertices(vec2(worldCenter.x, worldCenter.y), verts, {
      snapEnabled: state.snap.enabled,
      gridMm,
      toleranceMm: tolMm,
    });
    const cx = c.x;
    const cy = c.y;
    const half = state.pendingAddSizeMm / 2;
    const objId = `obj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const polyId = `poly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newObj: VectorObject = {
      id: objId,
      layerId,
      transform: { position: vec2(cx, cy), rotationDeg: 0, scale: vec2(1, 1) },
      polygons: [
        {
          id: polyId,
          verts: [
            vec2(cx - half, cy - half),
            vec2(cx + half, cy - half),
            vec2(cx + half, cy + half),
            vec2(cx - half, cy + half),
          ],
        },
      ],
      ...(state.pendingAddItem
        ? {
            itemColor: state.pendingAddItem.color,
            itemId: state.pendingAddItem.id,
            itemLabel: state.pendingAddItem.label,
            itemDirectionDeg: 270,
            ...(state.pendingAddItem.id === "single-door"
              ? {
                  doorHanding: "left" as const,
                  doorSwing: "in" as const,
                  doorWidthMm: state.pendingAddSizeMm,
                }
              : {}),
          }
        : {}),
    };
    dispatch({ type: "SET_OBJECTS", payload: [...state.objects, newObj] });
    dispatch({ type: "SET_PENDING_ADD_SHAPE", payload: { enabled: false } });
    dispatch({ type: "SET_ADD_SHAPE_PREVIEW_WORLD", payload: null });
  }, [
    state,
    pushHistory,
    state.activeLayerId,
    state.snap,
    state.selectionDistancePx,
    state.camera.zoom,
    state.objects,
    state.pendingAddSizeMm,
    state.pendingAddItem,
    state.layers,
  ]);

  const placeWallWindow = useCallback(
    (wallId: string, a: Vec2, b: Vec2) => {
      const wall = state.objects.find((o) => o.id === wallId);
      const cl = wall?.centerline;
      if (!wall || !cl || cl.length < 2) return;

      const snapGridMm = snapGridStepMm(state.snap);
      const vertexTolMm = snapVertexToleranceMm(
        state.snap,
        state.selectionDistancePx,
        state.camera.zoom
      );
      const a1 = snapWallWindowPointerOntoCenterline(cl, a, snapGridMm, vertexTolMm);
      const b1 = snapWallWindowPointerOntoCenterline(cl, b, snapGridMm, vertexTolMm);
      const sa = distanceAlongPolylineToPoint(cl, a1);
      const sb = distanceAlongPolylineToPoint(cl, b1);
      const startAlongMm = Math.min(sa, sb);
      const endAlongMm = Math.max(sa, sb);
      if (endAlongMm - startAlongMm < MIN_WALL_WINDOW_SPAN_MM) return;

      const halfWall = effectiveWallDrawWidthMm(wall) / 2;
      const verts = buildWindowPolygonAlongCenterlineSpan(cl, startAlongMm, endAlongMm, halfWall);
      if (!verts || verts.length < 3) return;

      pushHistory(state);
      const objId = `obj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const polyId = `poly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newObj: VectorObject = {
        id: objId,
        layerId: WINDOWS_LAYER_ID,
        transform: { position: vec2(0, 0), rotationDeg: 0, scale: vec2(1, 1) },
        polygons: [{ id: polyId, verts }],
        itemId: "wall-window",
        itemLabel: "Window",
        itemColor: WINDOWS_LAYER_COLOR,
        wallWindowRef: { wallId, startAlongMm, endAlongMm },
      };
      dispatch({ type: "PLACE_WALL_OPENING", payload: { kind: "window", object: newObj } });
    },
    [state, pushHistory]
  );

  const placeWallDoor = useCallback(
    (wallId: string, a: Vec2, b: Vec2) => {
      const wall = state.objects.find((o) => o.id === wallId);
      const cl = wall?.centerline;
      if (!wall || !cl || cl.length < 2) return;

      const snapGridMm = snapGridStepMm(state.snap);
      const vertexTolMm = snapVertexToleranceMm(
        state.snap,
        state.selectionDistancePx,
        state.camera.zoom
      );
      const a1 = snapWallWindowPointerOntoCenterline(cl, a, snapGridMm, vertexTolMm);
      const b1 = snapWallWindowPointerOntoCenterline(cl, b, snapGridMm, vertexTolMm);
      const fixedAlongMm = distanceAlongPolylineToPoint(cl, a1);
      const pointerAlong = distanceAlongPolylineToPoint(cl, b1);
      if (Math.abs(pointerAlong - fixedAlongMm) < MIN_WALL_WINDOW_SPAN_MM) return;

      const total = polylineTotalLength(cl);
      const widths = catalogWidthsForDraw(state.doorDrawKind, state.doorDrawRegionFilter);
      const span = computeWallDoorSpanFromFixedJamb(total, fixedAlongMm, pointerAlong, widths);
      if (!span) return;
      if (!doorSpanPassesPlacementRules(wall, state.objects, span.startAlongMm, span.endAlongMm)) return;

      const halfWall = effectiveWallDrawWidthMm(wall) / 2;
      const verts = buildWindowPolygonAlongCenterlineSpan(
        cl,
        span.startAlongMm,
        span.endAlongMm,
        halfWall
      );
      if (!verts || verts.length < 3) return;

      pushHistory(state);
      const objId = `obj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const polyId = `poly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const doubleCatId =
        state.doorDrawKind === "double"
          ? doubleDoorOptionByWidthMm(span.doorWidthMm)?.id
          : undefined;
      const draft: VectorObject = {
        id: objId,
        layerId: DOORS_LAYER_ID,
        transform: { position: vec2(0, 0), rotationDeg: 0, scale: vec2(1, 1) },
        polygons: [{ id: polyId, verts }],
        itemId: state.doorDrawKind === "single" ? "single-door" : "double-door",
        itemLabel: state.doorDrawKind === "single" ? "Single door" : "Double door",
        doorWidthMm: span.doorWidthMm,
        ...(doubleCatId && { doorCatalogOptionId: doubleCatId }),
        wallWindowRef: {
          wallId,
          startAlongMm: span.startAlongMm,
          endAlongMm: span.endAlongMm,
        },
      };
      const companionObject = createDoorSymbolForWallDoor({
        wallDoorId: objId,
        layerId: DOOR_ITEMS_LAYER_ID,
        centerline: cl,
        startAlongMm: span.startAlongMm,
        endAlongMm: span.endAlongMm,
        doorKind: state.doorDrawKind,
        doorWidthMm: span.doorWidthMm,
        doorSwing: state.doorDrawSwing,
        doorCatalogOptionId: doubleCatId,
      });
      dispatch({
        type: "PLACE_WALL_OPENING",
        payload: { kind: "door", object: draft, companionObject },
      });
    },
    [state, pushHistory]
  );

  const setDoorDrawKind = useCallback((kind: DoorDrawKind) => {
    dispatch({ type: "SET_DOOR_DRAW_KIND", payload: kind });
  }, []);

  const setDoorDrawRegionFilter = useCallback((filter: DoorDrawRegionFilter) => {
    dispatch({ type: "SET_DOOR_DRAW_REGION_FILTER", payload: filter });
  }, []);

  const setDoorDrawSwing = useCallback((swing: DoorSwing) => {
    dispatch({ type: "SET_DOOR_DRAW_SWING", payload: swing });
  }, []);

  const setOuterWallDrawWidthMm = useCallback((mm: number) => {
    dispatch({ type: "SET_OUTER_WALL_DRAW_WIDTH_MM", payload: mm });
  }, []);

  const setInnerWallDrawWidthMm = useCallback((mm: number) => {
    dispatch({ type: "SET_INNER_WALL_DRAW_WIDTH_MM", payload: mm });
  }, []);

  const setStairsDrawWidthMm = useCallback((mm: number) => {
    dispatch({ type: "SET_STAIRS_DRAW_WIDTH_MM", payload: mm });
  }, []);

  const removeSelectedShape = useCallback((explicitObjectId?: string | null) => {
    const id =
      typeof explicitObjectId === "string" && explicitObjectId.length > 0
        ? explicitObjectId
        : state.selection.objectId;
    if (!id) return;
    pushHistory(state);
    const removedHostedDoorIds = new Set<string>();
    const deleting = state.objects.find((o) => o.id === id);
    const deletingIsWallHost =
      deleting &&
      deleting.centerline &&
      deleting.centerline.length >= 2 &&
      deleting.itemColor == null &&
      (deleting.itemId == null || deleting.itemId === "inner-wall");
    if (deletingIsWallHost) {
      for (const o of state.objects) {
        if (
          o.wallWindowRef?.wallId === id &&
          (o.itemId === "single-door" || o.itemId === "double-door")
        ) {
          removedHostedDoorIds.add(o.id);
        }
      }
    }
    if (
      deleting &&
      (deleting.itemId === "single-door" || deleting.itemId === "double-door") &&
      deleting.wallWindowRef
    ) {
      removedHostedDoorIds.add(id);
    }
    let next = state.objects.filter((obj) => {
      if (obj.id === id) return false;
      if (obj.pairedWallDoorId && removedHostedDoorIds.has(obj.pairedWallDoorId)) return false;
      return true;
    });
    next = next.filter(
      (obj) =>
        !(
          (obj.itemId === "wall-window" ||
            obj.itemId === "single-door" ||
            obj.itemId === "double-door") &&
          obj.wallWindowRef?.wallId === id
        )
    );
    dispatch({ type: "SET_OBJECTS", payload: next });
    dispatch({
      type: "SET_SELECTION",
      payload: {
        objectId: null,
        edge: null,
        centerlinePoint: null,
        centerlineSegment: null,
        measureVertexIndex: null,
        windowEndpoint: null,
      },
    });
  }, [state, state.selection.objectId, state.objects, pushHistory]);

  const updateWallWindowEndpointDrag = useCallback(
    (windowId: string, which: "start" | "end", world: Vec2) => {
      const snapGridMm = snapGridStepMm(state.snap);
      const vertexTolMm = snapVertexToleranceMm(
        state.snap,
        state.selectionDistancePx,
        state.camera.zoom
      );
      const win = state.objects.find((o) => o.id === windowId);
      const doorKind: DoorDrawKind | null =
        win?.itemId === "double-door"
          ? "double"
          : win?.itemId === "single-door"
            ? "single"
            : null;
      const doorCatalogWidthsMm =
        doorKind != null ? catalogWidthsForDraw(doorKind, state.doorDrawRegionFilter) : null;
      const next = dragWallHostedDoorEndpointWithRules(
        state.objects,
        windowId,
        which,
        world,
        snapGridMm,
        vertexTolMm,
        doorCatalogWidthsMm && doorCatalogWidthsMm.length > 0 ? doorCatalogWidthsMm : null
      );
      dispatch({ type: "SET_OBJECTS", payload: syncPairedDoorSymbolsForObjects(next) });
    },
    [
      state.objects,
      state.snap,
      state.selectionDistancePx,
      state.camera.zoom,
      state.doorDrawRegionFilter,
    ]
  );

  const updateCenterlinePoint = useCallback(
    (objectId: string, pointIndex: number, newPosition: Vec2) => {
      const obj = state.objects.find((o) => o.id === objectId);
      const cl = obj?.centerline;
      if (!obj || !cl || pointIndex < 0 || pointIndex >= cl.length) return;
      const previousCenterline = cl.map((p) => vec2(p.x, p.y));
      const gridMm = snapGridStepMm(state.snap);
      const tolMm = snapVertexToleranceMm(state.snap, state.selectionDistancePx, state.camera.zoom);
      const verts = collectAlignmentVertices(state.objects, null, {
        objectId,
        centerlinePointIndex: pointIndex,
      });
      const pos = snapWorldPointToGridAndVertices(newPosition, verts, {
        snapEnabled: state.snap.enabled,
        gridMm,
        toleranceMm: tolMm,
      });
      const nextCenterline = cl.slice();
      nextCenterline[pointIndex] = pos;
      const halfWidth = effectiveWallDrawWidthMm(obj) / 2;
      const nextPolys =
        obj.itemId === "stairs"
          ? polygonsFromStairsCenterline(nextCenterline, halfWidth, obj.polygons[0]?.id ?? `${objectId}-poly`)
          : (() => {
              const outline = pathToPolygon(nextCenterline, halfWidth);
              if (outline.length < 3) return null;
              const poly = obj.polygons[0];
              return poly ? [{ ...poly, verts: outline }] : null;
            })();
      if (!nextPolys || nextPolys.length === 0) return;
      const nextObjects = state.objects.map((o) => {
        if (o.id !== objectId) return o;
        return {
          ...o,
          centerline: nextCenterline,
          polygons: nextPolys,
        };
      });
      dispatch({
        type: "SET_OBJECTS",
        payload: syncPairedDoorSymbolsForObjects(
          reanchorWallWindowsAfterCenterlineEdit(nextObjects, objectId, previousCenterline)
        ),
      });
    },
    [state.objects, state.snap, state.selectionDistancePx, state.camera.zoom]
  );

  const updateCenterlineSegment = useCallback(
    (objectId: string, segmentIndex: number, delta: Vec2) => {
      const obj = state.objects.find((o) => o.id === objectId);
      const cl = obj?.centerline;
      if (!obj || !cl || segmentIndex < 0 || segmentIndex >= cl.length - 1) return;
      const previousCenterline = cl.map((p) => vec2(p.x, p.y));
      const gridMm = snapGridStepMm(state.snap);
      const snapV = (v: number) => (gridMm > 0 ? Math.round(v / gridMm) * gridMm : v);
      const d = vec2(snapV(delta.x), snapV(delta.y));
      if (d.x === 0 && d.y === 0) return;
      const nextCenterline = cl.slice();
      nextCenterline[segmentIndex] = vec2(cl[segmentIndex].x + d.x, cl[segmentIndex].y + d.y);
      nextCenterline[segmentIndex + 1] = vec2(cl[segmentIndex + 1].x + d.x, cl[segmentIndex + 1].y + d.y);
      const halfWidth = effectiveWallDrawWidthMm(obj) / 2;
      const nextPolys =
        obj.itemId === "stairs"
          ? polygonsFromStairsCenterline(nextCenterline, halfWidth, obj.polygons[0]?.id ?? `${objectId}-poly`)
          : (() => {
              const outline = pathToPolygon(nextCenterline, halfWidth);
              if (outline.length < 3) return null;
              const poly = obj.polygons[0];
              return poly ? [{ ...poly, verts: outline }] : null;
            })();
      if (!nextPolys || nextPolys.length === 0) return;
      const nextObjects = state.objects.map((o) => {
        if (o.id !== objectId) return o;
        return {
          ...o,
          centerline: nextCenterline,
          polygons: nextPolys,
        };
      });
      dispatch({
        type: "SET_OBJECTS",
        payload: syncPairedDoorSymbolsForObjects(
          reanchorWallWindowsAfterCenterlineEdit(nextObjects, objectId, previousCenterline)
        ),
      });
    },
    [state.objects, state.snap]
  );

  const updateDrawShapeWidth = useCallback(
    (objectId: string, widthMm: number) => {
      if (widthMm < 1) return;
      pushHistory(state);
      const obj = state.objects.find((o) => o.id === objectId);
      const cl = obj?.centerline;
      if (!obj || !cl || cl.length < 2) return;
      const half = widthMm / 2;
      const nextPolys =
        obj.itemId === "stairs"
          ? polygonsFromStairsCenterline(cl, half, obj.polygons[0]?.id ?? `${objectId}-poly`)
          : (() => {
              const outline = pathToPolygon(cl, half);
              if (outline.length < 3) return null;
              const poly = obj.polygons[0];
              return poly ? [{ ...poly, verts: outline }] : null;
            })();
      if (!nextPolys || nextPolys.length === 0) return;
      const nextObjects = state.objects.map((o) => {
        if (o.id !== objectId) return o;
        return {
          ...o,
          drawWidthMm: widthMm,
          polygons: nextPolys,
        };
      });
      dispatch({
        type: "SET_OBJECTS",
        payload: syncPairedDoorSymbolsForObjects(syncWallWindowsForWall(nextObjects, objectId)),
      });
    },
    [state, state.objects, pushHistory]
  );

  const updateDoorItemProps = useCallback(
    (
      objectId: string,
      patch: { doorHanding?: DoorHanding; doorSwing?: DoorSwing; itemDirectionDeg?: number }
    ) => {
      pushHistory(state);
      const nextObjects = state.objects.map((o) => {
        if (o.id !== objectId) return o;
        return { ...o, ...patch };
      });
      dispatch({
        type: "SET_OBJECTS",
        payload: syncPairedDoorSymbolsForObjects(nextObjects),
      });
    },
    [state, state.objects, pushHistory]
  );

  const updateDoorSquareSize = useCallback(
    (objectId: string, widthMm: number, catalogOptionId?: string) => {
      if (widthMm <= 0 || !Number.isFinite(widthMm)) return;
      let obj = state.objects.find((o) => o.id === objectId);
      if (!obj || (obj.itemId !== "single-door" && obj.itemId !== "double-door")) return;

      /** Plan symbol on item layer: resize the wall-hosted opening it pairs to. */
      if (obj.pairedWallDoorId) {
        const hosted = state.objects.find((o) => o.id === obj.pairedWallDoorId);
        if (hosted?.wallWindowRef) {
          obj = hosted;
          objectId = hosted.id;
        }
      }

      const wall =
        obj.wallWindowRef?.wallId != null
          ? state.objects.find((o) => o.id === obj.wallWindowRef!.wallId)
          : null;
      const cl = wall?.centerline;

      if (wall && cl && cl.length >= 2 && obj.wallWindowRef) {
        const norm = normalizeWallWindowRef(wall, obj.wallWindowRef);
        if (!norm) return;
        const total = polylineTotalLength(cl);
        const doorKind: DoorDrawKind = obj.itemId === "double-door" ? "double" : "single";
        const catalog = catalogWidthsForDraw(doorKind, state.doorDrawRegionFilter);
        const widthSnap =
          catalog.length > 0 ? nearestCatalogWidthMm(catalog, widthMm) : widthMm;
        const mid = (norm.startAlongMm + norm.endAlongMm) / 2;
        let s = mid - widthSnap / 2;
        let e = mid + widthSnap / 2;
        if (e - s < MIN_WALL_WINDOW_SPAN_MM) return;
        if (s < 0) {
          s = 0;
          e = widthSnap;
        }
        if (e > total) {
          e = total;
          s = total - widthSnap;
        }
        s = Math.max(0, s);
        e = Math.min(total, e);
        if (e - s < MIN_WALL_WINDOW_SPAN_MM) return;
        pushHistory(state);
        const nextObjects = state.objects.map((o) => {
          if (o.id !== objectId) return o;
          const laid = layoutWallWindowObject(wall, o, {
            wallId: wall.id,
            startAlongMm: s,
            endAlongMm: e,
          });
          if (!laid) return o;
          if (obj.itemId === "double-door") {
            const catId =
              catalogOptionId ??
              doubleDoorCatalogIdForSpanMm(widthSnap, o.doorCatalogOptionId);
            return { ...laid, ...(catId && { doorCatalogOptionId: catId }) };
          }
          return laid;
        });
        dispatch({
          type: "SET_OBJECTS",
          payload: syncPairedDoorSymbolsForObjects(nextObjects),
        });
        return;
      }

      const gridMm = snapGridStepMm(state.snap);
      const snapV = (v: number) => (gridMm > 0 ? Math.round(v / gridMm) * gridMm : v);
      const cx = snapV(obj.transform.position.x);
      const cy = snapV(obj.transform.position.y);
      const half = widthMm / 2;
      pushHistory(state);
      const nextObjects = state.objects.map((o) => {
        if (o.id !== objectId) return o;
        const poly = o.polygons[0];
        if (!poly) return o;
        const catPatch =
          obj.itemId === "double-door"
            ? (() => {
                const catId =
                  catalogOptionId ?? doubleDoorCatalogIdForSpanMm(widthMm, o.doorCatalogOptionId);
                return catId ? { doorCatalogOptionId: catId } : {};
              })()
            : {};
        return {
          ...o,
          ...catPatch,
          transform: { ...o.transform, position: vec2(cx, cy) },
          doorWidthMm: widthMm,
          polygons: [
            {
              ...poly,
              verts: [
                vec2(cx - half, cy - half),
                vec2(cx + half, cy - half),
                vec2(cx + half, cy + half),
                vec2(cx - half, cy + half),
              ],
            },
          ],
        };
      });
      dispatch({ type: "SET_OBJECTS", payload: nextObjects });
    },
    [state, state.objects, state.snap, pushHistory]
  );

  const setDrawingPath = useCallback((path: { x: number; y: number }[] | null) => {
    dispatch({ type: "SET_DRAWING_PATH", payload: path });
  }, []);

  const appendDrawingPoint = useCallback((point: { x: number; y: number }) => {
    dispatch({ type: "APPEND_DRAWING_POINT", payload: point });
  }, []);

  const setDrawPreviewWorld = useCallback((pos: { x: number; y: number } | null) => {
    dispatch({ type: "SET_DRAW_PREVIEW_WORLD", payload: pos });
  }, []);

  const completeDrawing = useCallback(
    (pathOverride?: { x: number; y: number }[]) => {
    const path = pathOverride ?? state.drawingPath;
    const mergeId = state.drawingMergeObjectId;
    if (!path || path.length < 2) {
      dispatch({ type: "COMPLETE_DRAWING" });
      return;
    }

    if (mergeId) {
      const src = state.objects.find((o) => o.id === mergeId);
      if (src?.itemId === "stairs") {
        dispatch({ type: "COMPLETE_DRAWING" });
        return;
      }
      const cl = src?.centerline;
      if (!src || !cl) {
        dispatch({ type: "COMPLETE_DRAWING" });
        return;
      }
      if (cl.length < 2) {
        dispatch({ type: "COMPLETE_DRAWING" });
        return;
      }
      const fromIdx = state.drawingMergeFromPointIndex ?? cl.length - 1;
      const mergedCenterline = mergeWallDrawIntoCenterline(cl, path, fromIdx);
      if (!mergedCenterline) {
        dispatch({ type: "COMPLETE_DRAWING" });
        return;
      }
      if (src.itemId === "inner-wall") {
        if (!hasClosedOuterWallRegion(state.objects)) {
          window.alert("Draw and close an outer wall before drawing inner walls.");
          dispatch({ type: "COMPLETE_DRAWING" });
          return;
        }
        for (const p of mergedCenterline) {
          if (!isPointInsideClosedOuterShells(state.objects, vec2(p.x, p.y))) {
            window.alert("Inner walls must stay inside a closed outer wall.");
            dispatch({ type: "COMPLETE_DRAWING" });
            return;
          }
        }
      }
      const halfW = effectiveWallDrawWidthMm(src) / 2;
      const outline = pathToPolygon(mergedCenterline, halfW);
      if (outline.length < 3) {
        dispatch({ type: "COMPLETE_DRAWING" });
        return;
      }
      pushHistory(state);
      const poly0 = src.polygons[0];
      const updated: VectorObject = {
        ...src,
        centerline: mergedCenterline,
        polygons: [{ ...poly0, verts: outline }],
      };
      dispatch({
        type: "SET_OBJECTS",
        payload: syncPairedDoorSymbolsForObjects(
          syncWallWindowsForWall(
            state.objects.map((o) => (o.id === mergeId ? updated : o)),
            mergeId
          )
        ),
      });
      dispatch({ type: "COMPLETE_DRAWING" });
      return;
    }

    const innerDraw = state.activeTool === "Draw inner wall";
    const stairsDraw = state.activeTool === "Draw stairs";
    if (innerDraw) {
      if (!hasClosedOuterWallRegion(state.objects)) {
        window.alert("Draw and close an outer wall before drawing inner walls.");
        dispatch({ type: "COMPLETE_DRAWING" });
        return;
      }
      for (const p of path) {
        if (!isPointInsideClosedOuterShells(state.objects, vec2(p.x, p.y))) {
          window.alert("Inner walls must be drawn inside a closed outer wall.");
          dispatch({ type: "COMPLETE_DRAWING" });
          return;
        }
      }
    }

    const wMm = innerDraw
      ? state.innerWallDrawWidthMm
      : stairsDraw
        ? state.stairsDrawWidthMm
        : state.outerWallDrawWidthMm;
    const polyId = `poly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const halfW = wMm / 2;
    const pathVec = path.map((p) => vec2(p.x, p.y));
    const stairPolys = stairsDraw ? polygonsFromStairsCenterline(pathVec, halfW, polyId) : null;
    const wallPolys = !stairsDraw
      ? (() => {
          const outline = pathToPolygon(pathVec, halfW);
          if (outline.length < 3) return null;
          return [{ id: polyId, verts: outline }];
        })()
      : null;
    const newPolygons = stairPolys ?? wallPolys;
    if (!newPolygons || newPolygons.length === 0) {
      dispatch({ type: "COMPLETE_DRAWING" });
      return;
    }
    const targetLayerId = innerDraw
      ? INNER_WALLS_LAYER_ID
      : stairsDraw
        ? STAIRS_LAYER_ID
        : WALLS_LAYER_ID;
    if (!state.layers.some((l) => l.id === targetLayerId)) {
      dispatch({
        type: "ADD_LAYER",
        payload: innerDraw
          ? {
              id: INNER_WALLS_LAYER_ID,
              name: "Inner walls",
              color: INNER_WALLS_LAYER_COLOR,
              zPositionMm: DEFAULT_FOUNDATION_HEIGHT_MM,
              extrusionHeightMm: DEFAULT_WALL_HEIGHT_MM,
            }
          : stairsDraw
            ? {
                id: STAIRS_LAYER_ID,
                name: "Stairs",
                color: STAIRS_LAYER_COLOR,
                zPositionMm: DEFAULT_FOUNDATION_HEIGHT_MM,
                extrusionHeightMm: DEFAULT_WALL_HEIGHT_MM,
              }
            : {
                id: WALLS_LAYER_ID,
                name: "Walls",
                color: WALLS_LAYER_COLOR,
                zPositionMm: DEFAULT_FOUNDATION_HEIGHT_MM,
                extrusionHeightMm: DEFAULT_WALL_HEIGHT_MM,
              },
      });
    }
    pushHistory(state);
    const objId = `obj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newObj: VectorObject = {
      id: objId,
      layerId: targetLayerId,
      transform: { position: vec2(0, 0), rotationDeg: 0, scale: vec2(1, 1) },
      polygons: newPolygons,
      centerline: path.slice(),
      drawWidthMm: wMm,
      ...(innerDraw ? { itemId: "inner-wall", itemLabel: "Inner wall" } : {}),
      ...(stairsDraw ? { itemId: "stairs", itemLabel: "Stairs" } : {}),
    };
    dispatch({ type: "SET_OBJECTS", payload: [...state.objects, newObj] });
    dispatch({ type: "COMPLETE_DRAWING" });
  },
    [
      state,
      state.activeTool,
      pushHistory,
      state.drawingPath,
      state.drawingMergeObjectId,
      state.drawingMergeFromPointIndex,
      state.layers,
      state.objects,
      state.outerWallDrawWidthMm,
      state.innerWallDrawWidthMm,
      state.stairsDrawWidthMm,
    ]
  );

  const closeWallLoop = useCallback(() => {
    const drawingPath = state.drawingPath;
    if (drawingPath && drawingPath.length > 0 && !state.drawingMergeObjectId) {
      if (drawingPath.length < 3) return;
      const pts = drawingPath.map((p) => vec2(p.x, p.y));
      const result = tryCloseWallLoop(pts);
      if (!result.ok) {
        window.alert(result.reason);
        return;
      }
      completeDrawing(result.closedPath.map((p) => ({ x: p.x, y: p.y })));
      return;
    }

    if (drawingPath && drawingPath.length > 0 && state.drawingMergeObjectId) {
      if (drawingPath.length < 2) return;
      const mergeId = state.drawingMergeObjectId;
      const src = state.objects.find((o) => o.id === mergeId);
      const cl = src?.centerline;
      if (!src || !cl || cl.length < 2) return;
      const fromIdx = state.drawingMergeFromPointIndex ?? cl.length - 1;
      const merged = mergeWallDrawIntoCenterline(cl, drawingPath, fromIdx);
      if (!merged || merged.length < 3) {
        window.alert("Add at least one more corner before closing the loop.");
        return;
      }
      if (!isWallPolylineOpen(merged)) {
        window.alert("This wall is already closed.");
        return;
      }
      const result = tryCloseWallLoop(merged);
      if (!result.ok) {
        window.alert(result.reason);
        return;
      }
      pushHistory(state);
      const halfW = effectiveWallDrawWidthMm(src) / 2;
      const outline = pathToPolygon(result.closedPath, halfW);
      if (outline.length < 3) {
        window.alert("Could not build a closed outline from this wall.");
        return;
      }
      const poly0 = src.polygons[0];
      const updated: VectorObject = {
        ...src,
        centerline: result.closedPath.map((p) => ({ x: p.x, y: p.y })),
        polygons: [{ ...poly0, verts: outline }],
      };
      dispatch({
        type: "SET_OBJECTS",
        payload: syncPairedDoorSymbolsForObjects(
          syncWallWindowsForWall(
            state.objects.map((o) => (o.id === mergeId ? updated : o)),
            mergeId
          )
        ),
      });
      dispatch({ type: "COMPLETE_DRAWING" });
      return;
    }

    const id = state.selection.objectId;
    if (!id) return;
    const obj = state.objects.find((o) => o.id === id);
    if (!obj || !obj.centerline || obj.itemColor != null) return;
    const cl = obj.centerline;
    if (cl.length < 3) return;
    if (!isWallPolylineOpen(cl)) {
      window.alert("This wall is already closed.");
      return;
    }
    const pts = cl.map((p) => vec2(p.x, p.y));
    const result = tryCloseWallLoop(pts);
    if (!result.ok) {
      window.alert(result.reason);
      return;
    }
    pushHistory(state);
    const halfW = effectiveWallDrawWidthMm(obj) / 2;
    const outline = pathToPolygon(result.closedPath, halfW);
    if (outline.length < 3) {
      window.alert("Could not build a closed outline from this wall.");
      return;
    }
    const poly0 = obj.polygons[0];
    const updated: VectorObject = {
      ...obj,
      centerline: result.closedPath.map((p) => ({ x: p.x, y: p.y })),
      polygons: [{ ...poly0, verts: outline }],
    };
    dispatch({
      type: "SET_OBJECTS",
      payload: syncPairedDoorSymbolsForObjects(
        syncWallWindowsForWall(state.objects.map((o) => (o.id === id ? updated : o)), id)
      ),
    });
  }, [
    state,
    state.drawingPath,
    state.drawingMergeObjectId,
    state.selection.objectId,
    state.objects,
    completeDrawing,
    pushHistory,
  ]);

  const continueWallFromSelection = useCallback(() => {
    const id = state.selection.objectId;
    if (!id) return;
    const obj = state.objects.find((o) => o.id === id);
    if (!obj?.centerline || obj.centerline.length < 2 || obj.itemColor != null) return;
    if (obj.itemId === "stairs") return;
    const cl = obj.centerline;
    const cp = state.selection.centerlinePoint;
    let pointIndex: number;
    if (cp && cp.objectId === id) {
      pointIndex = cp.pointIndex === 0 || cp.pointIndex === cl.length - 1 ? cp.pointIndex : cl.length - 1;
    } else {
      pointIndex = cl.length - 1;
    }
    dispatch({ type: "START_CONTINUE_WALL", payload: { objectId: id, pointIndex } });
  }, [state.selection.objectId, state.selection.centerlinePoint, state.objects]);

  const cancelDrawing = useCallback(() => {
    dispatch({ type: "COMPLETE_DRAWING" });
  }, []);

  const setMeasurePath = useCallback((path: { x: number; y: number }[] | null) => {
    dispatch({ type: "SET_MEASURE_PATH", payload: path });
  }, []);

  const appendMeasurePoint = useCallback((point: { x: number; y: number }) => {
    dispatch({ type: "APPEND_MEASURE_POINT", payload: point });
  }, []);

  const setMeasurePreviewWorld = useCallback((pos: { x: number; y: number } | null) => {
    dispatch({ type: "SET_MEASURE_PREVIEW_WORLD", payload: pos });
  }, []);

  const completeMeasure = useCallback(() => {
    const path = state.measurePath;
    if (!path || path.length < 2) {
      dispatch({ type: "CANCEL_MEASURE" });
      return;
    }
    pushHistory(state);
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    }
    dispatch({
      type: "FINISH_MEASURE",
      payload: { totalMm: total, path: path.map((pt) => ({ x: pt.x, y: pt.y })) },
    });
  }, [state.measurePath, state, pushHistory]);

  const cancelMeasure = useCallback(() => {
    dispatch({ type: "CANCEL_MEASURE" });
  }, []);

  const clearCompletedMeasure = useCallback(() => {
    pushHistory(state);
    dispatch({ type: "CLEAR_MEASURE_RESULT" });
  }, [state, pushHistory]);

  const updateCompletedMeasurePoint = useCallback((index: number, position: { x: number; y: number }) => {
    dispatch({ type: "UPDATE_COMPLETED_MEASURE_POINT", payload: { index, position } });
  }, []);

  const applyFloorPlanCalibrationFromMeasure = useCallback(
    (trueLengthMm: number) => {
      const M = state.lastMeasureTotalMm;
      if (M == null || M <= 0 || !Number.isFinite(M)) return;
      const T = trueLengthMm;
      if (T <= 0 || !Number.isFinite(T)) return;

      pushHistory(state);

      const layer = state.layers.find((l) => l.id === REFERENCE_IMAGE_LAYER_ID && l.type === "image");
      if (!layer?.imageUrl) return;

      const nw = layer.imageNaturalWidth;
      if (nw == null || nw <= 0) return;

      const effectiveW =
        layer.imageWidthMm != null && layer.imageWidthMm > 0
          ? layer.imageWidthMm
          : nw * (layer.imageScaleMmPerPixel ?? 1);

      const k = T / M;
      const newWidthMm = effectiveW * k;

      dispatch({
        type: "UPDATE_LAYER",
        payload: {
          id: REFERENCE_IMAGE_LAYER_ID,
          patch: { imageWidthMm: newWidthMm, imageScaleMmPerPixel: undefined },
        },
      });

      const center = layer.imagePosition ?? { x: 0, y: 0 };
      if (state.completedMeasurePath && state.completedMeasurePath.length > 0) {
        dispatch({
          type: "SCALE_COMPLETED_MEASURE_WITH_FLOOR_PLAN",
          payload: { center, k, lastMeasureTotalMm: T },
        });
      }

      const nh = layer.imageNaturalHeight ?? 0;
      const newHeightMm =
        nh > 0 && nw > 0 ? (newWidthMm * nh) / nw : newWidthMm;
      const viewport = state.viewportSize;
      if (
        viewport &&
        viewport.width > 0 &&
        viewport.height > 0 &&
        newWidthMm > 0 &&
        newHeightMm > 0
      ) {
        const paddingPx = 40;
        const zoomX = (viewport.width - 2 * paddingPx) / newWidthMm;
        const zoomY = (viewport.height - 2 * paddingPx) / newHeightMm;
        const zoom = Math.min(zoomX, zoomY, 10);
        dispatch({
          type: "SET_CAMERA",
          payload: { center: vec2(center.x, center.y), zoom: Math.max(0.01, zoom) },
        });
      }
    },
    [state, pushHistory, state.layers, state.lastMeasureTotalMm, state.completedMeasurePath, state.viewportSize]
  );

  const setViewportSize = useCallback((size: ViewportSize | null) => {
    dispatch({ type: "SET_VIEWPORT_SIZE", payload: size });
  }, []);

  const frameContent = useCallback(() => {
    const viewport = state.viewportSize;
    if (!viewport || viewport.width <= 0 || viewport.height <= 0) return;

    const selectedId = state.selection.objectId;
    const selectedObj =
      typeof selectedId === "string" && selectedId.length > 0
        ? state.objects.find((o) => o.id === selectedId)
        : undefined;
    const bboxSelected = selectedObj ? getObjectsBbox([selectedObj]) : null;
    const bbox = bboxSelected ?? getObjectsBbox(state.objects);
    if (!bbox) return;

    const paddingPx = 40;
    const w = bbox.maxX - bbox.minX;
    const h = bbox.maxY - bbox.minY;
    const zoomX = (viewport.width - 2 * paddingPx) / (w || 1);
    const zoomY = (viewport.height - 2 * paddingPx) / (h || 1);
    const zoom = Math.min(zoomX, zoomY, 10);
    const centerX = (bbox.minX + bbox.maxX) / 2;
    const centerY = (bbox.minY + bbox.maxY) / 2;
    dispatch({
      type: "SET_CAMERA",
      payload: { center: vec2(centerX, centerY), zoom: Math.max(0.01, zoom) },
    });
  }, [state.viewportSize, state.objects, state.selection.objectId]);

  const centerView = useCallback(() => {
    dispatch({ type: "SET_CAMERA", payload: { center: vec2(0, 0) } });
  }, []);

  const moveSnapGridMm = snapGridStepMm(state.snap);

  const applyMoveEdge = useCallback(
    (edgeRef: EdgeRef, delta: { x: number; y: number }) => {
      const next = moveEdge(state.objects, edgeRef, vec2(delta.x, delta.y), moveSnapGridMm);
      dispatch({ type: "SET_OBJECTS", payload: next });
    },
    [state.objects, moveSnapGridMm]
  );

  const applyMoveObject = useCallback(
    (objectId: string, delta: { x: number; y: number }) => {
      const next = moveShape(state.objects, objectId, vec2(delta.x, delta.y), moveSnapGridMm);
      const moved = next.find((o) => o.id === objectId);
      dispatch({
        type: "SET_OBJECTS",
        payload:
          moved && isWallPolylineObject(moved)
            ? syncPairedDoorSymbolsForObjects(syncWallWindowsForWall(next, objectId))
            : next,
      });
    },
    [state.objects, moveSnapGridMm]
  );

  const applyMoveEdgeFromSnapshot = useCallback(
    (snapshot: VectorObject[], edgeRef: EdgeRef, delta: { x: number; y: number }) => {
      const next = moveEdge(snapshot, edgeRef, vec2(delta.x, delta.y), moveSnapGridMm);
      dispatch({ type: "SET_OBJECTS", payload: next });
    },
    [moveSnapGridMm]
  );

  const applyMoveObjectFromSnapshot = useCallback(
    (snapshot: VectorObject[], objectId: string, delta: { x: number; y: number }) => {
      const next = moveShape(snapshot, objectId, vec2(delta.x, delta.y), moveSnapGridMm);
      const moved = next.find((o) => o.id === objectId);
      dispatch({
        type: "SET_OBJECTS",
        payload:
          moved && isWallPolylineObject(moved)
            ? syncPairedDoorSymbolsForObjects(syncWallWindowsForWall(next, objectId))
            : next,
      });
    },
    [moveSnapGridMm]
  );

  const applyRotateObjectFromSnapshot = useCallback(
    (snapshot: VectorObject[], objectId: string, center: Vec2, deltaDeg: number) => {
      const src = snapshot.find((o) => o.id === objectId);
      if (!src) return;
      const rotated = rotateObjectGeometry(src, center, deltaDeg);
      const next = snapshot.map((o) => (o.id === objectId ? rotated : o));
      dispatch({
        type: "SET_OBJECTS",
        payload: isWallPolylineObject(rotated)
          ? syncPairedDoorSymbolsForObjects(syncWallWindowsForWall(next, objectId))
          : next,
      });
    },
    []
  );

  const addLayer = useCallback(() => {
    pushHistory(state);
    const nextId = `layer-${Date.now()}`;
    dispatch({
      type: "ADD_LAYER",
      payload: {
        id: nextId,
        name: "Layer",
        color: "#94a3b8",
        zPositionMm: 0,
        extrusionHeightMm: 0,
      },
    });
    dispatch({ type: "SET_ACTIVE_LAYER", payload: nextId });
  }, [state, pushHistory]);

  const updateLayer = useCallback(
    (id: string, patch: Partial<Layer>, options?: { skipHistory?: boolean }) => {
      if (!options?.skipHistory) pushHistory(state);
      dispatch({ type: "UPDATE_LAYER", payload: { id, patch } });
    },
    [state, pushHistory]
  );

  const setActiveLayer = useCallback((id: string | null) => {
    dispatch({ type: "SET_ACTIVE_LAYER", payload: id });
  }, []);

  const removeLayer = useCallback((id: string) => {
    if (id === REFERENCE_IMAGE_LAYER_ID || state.layers.length <= 1) return;
    pushHistory(state);
    dispatch({ type: "REMOVE_LAYER", payload: id });
  }, [state, state.layers.length, pushHistory]);

  const setObjectLayerId = useCallback(
    (objectId: string, layerId: string) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer || layer.type === "image") return;
      const obj = state.objects.find((o) => o.id === objectId);
      if (!obj || obj.layerId === layerId) return;
      pushHistory(state);
      dispatch({
        type: "SET_OBJECTS",
        payload: state.objects.map((o) => (o.id === objectId ? { ...o, layerId } : o)),
      });
    },
    [state, pushHistory]
  );

  const resetLayerDefaults = useCallback(() => {
    pushHistory(state);
    dispatch({ type: "RESET_LAYER_DEFAULTS" });
  }, [state, pushHistory]);

  const generateFloorSkirting = useCallback(() => {
    pushHistory(state);
    dispatch({ type: "SET_OBJECTS", payload: generateFloorSkirtingObjects(state.objects) });
  }, [state, pushHistory]);

  const generateCeilingSkirting = useCallback(() => {
    pushHistory(state);
    dispatch({ type: "SET_OBJECTS", payload: generateCeilingSkirtingObjects(state.objects) });
  }, [state, pushHistory]);

  const setRoomCustomName = useCallback((roomKey: string, name: string) => {
    dispatch({ type: "SET_ROOM_CUSTOM_NAME", payload: { key: roomKey, name } });
  }, []);

  const setShowRoomLabelsInViewport = useCallback((show: boolean) => {
    dispatch({ type: "SET_SHOW_ROOM_LABELS_IN_VIEWPORT", payload: show });
  }, []);

  const value: EditorContextValue = {
    state,
    pushHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    saveDocumentToFile,
    loadDocumentFromProjectFile,
    loadDocumentFromJson,
    newDocument,
    setProjectName,
    setCamera,
    setActiveTool,
    setSelection,
    setExtrudePreview,
    applyExtrude,
    cleanShapes,
    setSnap,
    setSelectionDistancePx,
    setMeasureEnabled,
    setShowEdgeMeasurements,
    setPendingAddShape,
    setPendingAddItem,
    setAddItemPanelOpen,
    setAddShapePreviewWorld,
    placeAddShape,
    placeWallWindow,
    placeWallDoor,
    setDoorDrawKind,
    setDoorDrawRegionFilter,
    setDoorDrawSwing,
    setOuterWallDrawWidthMm,
    setInnerWallDrawWidthMm,
    setStairsDrawWidthMm,
    setRoomCustomName,
    setShowRoomLabelsInViewport,
    removeSelectedShape,
    updateWallWindowEndpointDrag,
    updateCenterlinePoint,
    updateCenterlineSegment,
    updateDrawShapeWidth,
    updateDoorItemProps,
    updateDoorSquareSize,
    setDrawingPath,
    appendDrawingPoint,
    setDrawPreviewWorld,
    completeDrawing,
    closeWallLoop,
    cancelDrawing,
    continueWallFromSelection,
    setMeasurePath,
    appendMeasurePoint,
    setMeasurePreviewWorld,
    completeMeasure,
    cancelMeasure,
    clearCompletedMeasure,
    updateCompletedMeasurePoint,
    applyFloorPlanCalibrationFromMeasure,
    setViewportSize,
    frameContent,
    centerView,
    applyMoveEdge,
    applyMoveObject,
    applyMoveEdgeFromSnapshot,
    applyMoveObjectFromSnapshot,
    applyRotateObjectFromSnapshot,
    addLayer,
    updateLayer,
    setActiveLayer,
    removeLayer,
    setObjectLayerId,
    resetLayerDefaults,
    generateFloorSkirting,
    generateCeilingSkirting,
  };

  return (
    <EditorStateContext.Provider value={value}>
      {children}
    </EditorStateContext.Provider>
  );
}

export function useEditorState() {
  const ctx = useContext(EditorStateContext);
  if (!ctx) throw new Error("useEditorState must be used within EditorStateProvider");
  return ctx;
}
