import type { DocumentState } from "./editorState";
import {
  createInitialDocumentState,
  normalizeSnapSettings,
  mergeMissingDefaultLayers,
  migrateLegacyLayerIdsOnObjects,
  migrateActiveLayerIfLegacy,
  migrateLoadedDocumentState,
  WALLS_LAYER_ID,
  DEFAULT_ACTIVE_LAYER_ID,
} from "./editorState";
import { syncAllWallWindows } from "../geometry/wallWindow";
import { syncFoundationObjects } from "../geometry/foundation";
import { syncPairedDoorSymbolsForObjects } from "../geometry/doorSymbolFromWall";

const PERSIST_VERSION = 1;
export const LOCAL_STORAGE_KEY = "webapp-vector-editor-document-v1";

/** Deep clone document state (JSON). */
export function cloneDocumentState(state: DocumentState): DocumentState {
  return JSON.parse(JSON.stringify(state)) as DocumentState;
}

/** Strip transient UI so history entries stay small and restorable. */
export function stripTransientForHistory(s: DocumentState): DocumentState {
  return {
    ...s,
    drawingPath: null,
    drawPreviewWorld: null,
    drawingMergeObjectId: null,
    drawingMergeFromPointIndex: null,
    measurePath: null,
    measurePreviewWorld: null,
    extrudePreview: null,
    pendingAddShape: false,
    addShapePreviewWorld: null,
    viewportSize: null,
  };
}

export function snapshotForHistory(state: DocumentState): DocumentState {
  return stripTransientForHistory(cloneDocumentState(state));
}

export function serializeForLocalStorage(state: DocumentState): string {
  const snap = snapshotForHistory(state);
  return JSON.stringify({ v: PERSIST_VERSION, doc: snap });
}

/**
 * `blob:` URLs are session-only and break after save/load or refresh; drop them so the layer can be re-imported.
 */
function stripDeadBlobImageUrls(doc: DocumentState): DocumentState {
  return {
    ...doc,
    layers: doc.layers.map((l) => {
      if (l.type !== "image" || !l.imageUrl?.startsWith("blob:")) return l;
      return {
        ...l,
        imageUrl: undefined,
        imageNaturalWidth: undefined,
        imageNaturalHeight: undefined,
      };
    }),
  };
}

/** Load document from `localStorage` JSON (see `serializeForLocalStorage`). */
export function parseFromLocalStorage(json: string): DocumentState | null {
  try {
    const o = JSON.parse(json) as { v?: number; doc?: DocumentState };
    if (o.v !== PERSIST_VERSION || !o.doc || typeof o.doc !== "object") return null;
    const base = createInitialDocumentState();
    const merged: DocumentState = {
      ...base,
      ...o.doc,
      viewportSize: null,
    };
    if (!Array.isArray(merged.objects)) merged.objects = [];
    if (!Array.isArray(merged.layers)) merged.layers = base.layers;
    if (typeof merged.projectName !== "string" || merged.projectName.trim() === "") {
      merged.projectName = base.projectName;
    }
    merged.selection = { ...base.selection, ...merged.selection };
    merged.snap = normalizeSnapSettings(merged.snap);
    merged.doorDrawKind = merged.doorDrawKind === "double" ? "double" : base.doorDrawKind;
    merged.doorDrawRegionFilter =
      merged.doorDrawRegionFilter === "SA" || merged.doorDrawRegionFilter === "UK"
        ? merged.doorDrawRegionFilter
        : base.doorDrawRegionFilter;
    merged.doorDrawSwing = merged.doorDrawSwing === "out" ? "out" : base.doorDrawSwing;
    merged.stairsDrawWidthMm =
      typeof merged.stairsDrawWidthMm === "number" &&
      Number.isFinite(merged.stairsDrawWidthMm) &&
      merged.stairsDrawWidthMm > 0
        ? merged.stairsDrawWidthMm
        : base.stairsDrawWidthMm;
    merged.layers = mergeMissingDefaultLayers(merged.layers);
    merged.objects = syncPairedDoorSymbolsForObjects(
      syncFoundationObjects(
        syncAllWallWindows(migrateLegacyLayerIdsOnObjects(merged.objects, WALLS_LAYER_ID))
      )
    );
    let active = migrateActiveLayerIfLegacy(merged.activeLayerId);
    if (active != null && !merged.layers.some((l) => l.id === active)) {
      active = merged.layers.find((l) => l.type !== "image")?.id ?? WALLS_LAYER_ID;
    }
    merged.activeLayerId = active ?? DEFAULT_ACTIVE_LAYER_ID;
    return stripDeadBlobImageUrls(migrateLoadedDocumentState(merged));
  } catch {
    return null;
  }
}
