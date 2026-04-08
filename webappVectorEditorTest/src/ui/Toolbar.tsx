import { useRef, useState, type ChangeEvent } from "react";
import { useEditorState } from "../state/EditorStateContext";
import {
  type DoorDrawKind,
  type DoorDrawRegionFilter,
  type ToolId,
  isDrawWallLikeTool,
} from "../state/editorState";
import type { DoorSwing } from "../geometry/types";
import { safeProjectFileName } from "../api/localDocument";
import { isWallPolylineOpen } from "../geometry/drawPath";
import { hasClosedOuterWallRegion } from "../geometry/innerWallConstraint";
import { LoadProjectModal } from "./LoadProjectModal";

const TOOLS: ToolId[] = [
  "Select",
  "Move",
  "Rotate",
  "Scale",
  "AddPoint",
  "Extrude",
  "Measure",
  "Draw outer wall",
  "Draw inner wall",
  "Draw windows",
  "Draw doors",
  "Draw stairs",
];

/** Tools that have behaviour implemented; others are shown but disabled (greyed out). */
const ACTIVE_TOOLS: Set<ToolId> = new Set([
  "Select",
  "Move",
  "Rotate",
  "Extrude",
  "Measure",
  "Draw outer wall",
  "Draw inner wall",
  "Draw windows",
  "Draw doors",
  "Draw stairs",
]);

export function Toolbar() {
  const loadInputRef = useRef<HTMLInputElement>(null);
  const [loadModalOpen, setLoadModalOpen] = useState(false);
  const {
    state,
    undo,
    redo,
    canUndo,
    canRedo,
    saveDocumentToFile,
    loadDocumentFromProjectFile,
    loadDocumentFromJson,
    newDocument,
    resetLayerDefaults,
    setProjectName,
    setActiveTool,
    setDoorDrawKind,
    setDoorDrawRegionFilter,
    setDoorDrawSwing,
    setPendingAddShape,
    setAddItemPanelOpen,
    setPendingAddItem,
    removeSelectedShape,
    completeDrawing,
    closeWallLoop,
    cancelDrawing,
    continueWallFromSelection,
    completeMeasure,
    cancelMeasure,
    clearCompletedMeasure,
    generateFloorSkirting,
    generateCeilingSkirting,
  } = useEditorState();
  const {
    activeTool,
    pendingAddShape,
    addItemPanelOpen,
    selection,
    objects,
    drawingPath,
    drawingMergeObjectId,
    measurePath,
    completedMeasurePath,
    lastMeasureTotalMm,
    layers,
    doorDrawKind,
    doorDrawRegionFilter,
    doorDrawSwing,
  } = state;

  const handleNew = () => {
    const hasContent =
      objects.length > 0 ||
      (drawingPath != null && drawingPath.length > 0) ||
      (measurePath != null && measurePath.length > 0) ||
      (completedMeasurePath != null && completedMeasurePath.length > 0) ||
      lastMeasureTotalMm != null ||
      layers.length > 2;
    if (hasContent && !window.confirm("Start a new document? Unsaved changes will be lost.")) return;
    newDocument();
  };

  const handleLoadFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      const stem = file.name.replace(/\.json$/i, "");
      const pn = safeProjectFileName(stem) ?? (stem.slice(0, 80) || "Untitled");
      if (!loadDocumentFromJson(text, { projectName: pn })) {
        window.alert("Could not load this file. Use a JSON document saved with Save, or the same format as local storage.");
      }
      e.target.value = "";
    });
  };

  const handleLoadProjectFromModal = async (name: string) => {
    const ok = await loadDocumentFromProjectFile(name);
    if (ok) setLoadModalOpen(false);
    else window.alert(`Could not load "${name}" from the saves folder.`);
  };

  const handleBrowseFromModal = () => {
    setLoadModalOpen(false);
    loadInputRef.current?.click();
  };
  const hasSelection = selection.objectId != null;
  const selectedWall =
    selection.objectId != null ? objects.find((o) => o.id === selection.objectId) : null;
  const canContinueWall =
    activeTool === "Draw outer wall" &&
    selectedWall != null &&
    selectedWall.itemId !== "stairs" &&
    selectedWall.centerline != null &&
    selectedWall.centerline.length >= 2 &&
    selectedWall.itemColor == null &&
    !drawingMergeObjectId &&
    (drawingPath == null || drawingPath.length === 0);
  const hasDrawingPath = drawingPath != null && drawingPath.length >= 2;
  const hasMeasurePath = measurePath != null && measurePath.length >= 2;
  const hasCompletedMeasure =
    (completedMeasurePath != null && completedMeasurePath.length > 0) || lastMeasureTotalMm != null;

  const selectedCenterline = selectedWall?.centerline;
  const canCloseLoopSelected =
    selectedWall != null &&
    selectedWall.itemId !== "stairs" &&
    selectedWall.itemColor == null &&
    selectedCenterline != null &&
    selectedCenterline.length >= 3 &&
    isWallPolylineOpen(selectedCenterline) &&
    (drawingPath == null || drawingPath.length === 0);
  const canCloseLoopDraw =
    activeTool === "Draw outer wall" &&
    drawingPath != null &&
    drawingPath.length >= 3 &&
    !drawingMergeObjectId;
  /** Continue wall: merge stroke + existing wall, then close loop to the other endpoint. */
  const canCloseLoopMergeContinue =
    activeTool === "Draw outer wall" &&
    drawingMergeObjectId != null &&
    drawingPath != null &&
    drawingPath.length >= 2;
  const canCloseLoop = canCloseLoopDraw || canCloseLoopSelected || canCloseLoopMergeContinue;

  const canDrawInnerWall = hasClosedOuterWallRegion(objects);

  return (
    <div className="toolbar toolbar-top">
      <LoadProjectModal
        open={loadModalOpen}
        onClose={() => setLoadModalOpen(false)}
        onLoadProject={(name) => void handleLoadProjectFromModal(name)}
        onBrowseFile={handleBrowseFromModal}
      />
      <div className="toolbar-file-group" role="group" aria-label="File">
        <span className="toolbar-file-label">File</span>
        <button
          type="button"
          className="toolbar-action"
          onClick={handleNew}
          title="New document (blank canvas)"
        >
          New
        </button>
        <button
          type="button"
          className="toolbar-action"
          onClick={() => void saveDocumentToFile()}
          title="Save to saves/<project name>.json when using npm run dev or preview; otherwise download"
        >
          Save
        </button>
        <input
          ref={loadInputRef}
          type="file"
          accept=".json,application/json"
          className="toolbar-file-input-hidden"
          aria-hidden
          tabIndex={-1}
          onChange={handleLoadFile}
        />
        <button
          type="button"
          className="toolbar-action"
          onClick={() => setLoadModalOpen(true)}
          title="Load a project from the saves folder or from a file"
        >
          Load
        </button>
        <button
          type="button"
          className="toolbar-action"
          onClick={() => {
            if (
              !window.confirm(
                "Reset built-in layers (foundation, floor, walls, inner walls, windows, doors, skirting, ceiling) to default z, extrusion, and colours? The floor plan image URL and position are kept; custom layers are unchanged."
              )
            ) {
              return;
            }
            resetLayerDefaults();
          }}
          title="Restore default z position, extrusion height, and colours for built-in layers"
        >
          Layer defaults
        </button>
      </div>
      <div className="toolbar-file-group toolbar-project-group" role="group" aria-label="Project name">
        <span className="toolbar-file-label">Name</span>
        <input
          type="text"
          className="toolbar-project-input"
          value={state.projectName}
          onChange={(e) => setProjectName(e.target.value)}
          title="Used as the file name when saving to saves/ (letters, numbers, dashes, underscores)"
          placeholder="my-floorplan"
          spellCheck={false}
          autoComplete="off"
          aria-label="Project name"
        />
      </div>
      <span className="toolbar-sep" aria-hidden />
      <div className="toolbar-file-group" role="group" aria-label="Skirting">
        <span className="toolbar-file-label">Skirting</span>
        <button
          type="button"
          className="toolbar-action"
          onClick={() => generateFloorSkirting()}
          title="Generate or refresh floor skirting along walls (wall-hosted doors cut the strip)"
        >
          Floor skirting
        </button>
        <button
          type="button"
          className="toolbar-action"
          onClick={() => generateCeilingSkirting()}
          title="Generate or refresh ceiling skirting along walls (full segments)"
        >
          Ceiling skirting
        </button>
      </div>
      <span className="toolbar-sep" aria-hidden />
      {TOOLS.map((tool) => {
        const implemented = ACTIVE_TOOLS.has(tool);
        const innerWallNeedsOuter = tool === "Draw inner wall" && !canDrawInnerWall;
        const disabledTool = !implemented || innerWallNeedsOuter;
        return (
          <button
            key={tool}
            type="button"
            className={
              activeTool === tool ? "active" : implemented && !innerWallNeedsOuter ? "" : "disabled"
            }
            disabled={disabledTool}
            onClick={() => implemented && !innerWallNeedsOuter && setActiveTool(tool)}
            title={
              innerWallNeedsOuter
                ? "Draw and close an outer wall first; inner walls only go inside that shell."
                : !implemented
                  ? "Not yet implemented"
                  : undefined
            }
          >
            {tool}
          </button>
        );
      })}
      {activeTool === "Draw doors" ? (
        <>
          <span className="toolbar-sep" aria-hidden />
          <label className="toolbar-snap">
            <span>Type</span>
            <select
              className="toolbar-snap-value"
              value={doorDrawKind}
              onChange={(e) => setDoorDrawKind(e.target.value as DoorDrawKind)}
              title="Single vs double door catalog widths"
              aria-label="Draw door type"
            >
              <option value="single">Single</option>
              <option value="double">Double</option>
            </select>
          </label>
          <label className="toolbar-snap">
            <span>Catalog</span>
            <select
              className="toolbar-snap-value"
              value={doorDrawRegionFilter}
              onChange={(e) => setDoorDrawRegionFilter(e.target.value as DoorDrawRegionFilter)}
              title="Filter standard widths by region or use all sizes"
              aria-label="Door catalog region"
            >
              <option value="global">All regions</option>
              <option value="SA">SA only</option>
              <option value="UK">UK only</option>
            </select>
          </label>
          <label className="toolbar-snap">
            <span>Swing</span>
            <select
              className="toolbar-snap-value"
              value={doorDrawSwing}
              onChange={(e) => setDoorDrawSwing(e.target.value as DoorSwing)}
              title="Inswing vs outswing for the plan door symbol (hinge on wall centerline)"
              aria-label="Door swing for draw doors"
            >
              <option value="in">In</option>
              <option value="out">Out</option>
            </select>
          </label>
        </>
      ) : null}
      <span className="toolbar-spacer" aria-hidden />
      <button
        type="button"
        className="toolbar-action"
        onClick={() => undo()}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        type="button"
        className="toolbar-action"
        onClick={() => redo()}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z or Ctrl+Y)"
      >
        Redo
      </button>
      {canCloseLoop && (
        <button
          type="button"
          className="toolbar-action"
          onClick={() => closeWallLoop()}
          title={
            canCloseLoopDraw
              ? "While drawing: close the loop with axis-aligned segments to the start (same row/column = one segment; otherwise an L path: vertical-then-horizontal if the open end is below the start, horizontal-then-vertical if above)."
              : canCloseLoopMergeContinue
                ? "Continue wall: close the loop from the open end to the first corner using the same axis-aligned L rules as when drawing."
                : "Selected open wall: close from the last corner to the first using axis-aligned segments (L path when not on the same row or column)."
          }
        >
          Close loop
        </button>
      )}
      <span className="toolbar-spacer" aria-hidden />
      <button
        type="button"
        className={`toolbar-action ${addItemPanelOpen ? "active" : ""}`}
        onClick={() => setAddItemPanelOpen(!addItemPanelOpen)}
        title={addItemPanelOpen ? "Close add item options" : "Show add item options in inspector"}
      >
        Add item
      </button>
      <button
        type="button"
        className={`toolbar-action ${pendingAddShape ? "active" : ""}`}
        onClick={() => {
          const next = !pendingAddShape;
          if (next) setPendingAddItem(null);
          setPendingAddShape(next, 1000);
        }}
        title={pendingAddShape ? "Click on canvas to place 1×1 m box (or click again to cancel)" : "Add a 1×1 m box; click on canvas to place"}
      >
        Add shape
      </button>
      <button
        type="button"
        className="toolbar-action"
        onClick={() => removeSelectedShape()}
        disabled={!hasSelection}
        title={hasSelection ? "Remove selected shape" : "Select a shape first"}
      >
        Remove shape
      </button>
      <button
        type="button"
        className="toolbar-action"
        disabled={!hasCompletedMeasure}
        onClick={() => clearCompletedMeasure()}
        title="Remove completed measurement from the canvas and inspector"
      >
        Clear measure
      </button>
      {activeTool === "Draw outer wall" && canContinueWall && (
        <button
          type="button"
          className="toolbar-action"
          onClick={() => continueWallFromSelection()}
          title={
            selection.centerlinePoint
              ? "Continue from the selected wall endpoint (start or end); add corners, then Complete"
              : "Continue from the wall end (use Select/Move and click an endpoint first to extend from the start)"
          }
        >
          Continue wall
        </button>
      )}
      {isDrawWallLikeTool(activeTool) && drawingPath && drawingPath.length > 0 && (
        <>
          <button
            type="button"
            className="toolbar-action"
            onClick={() => completeDrawing()}
            disabled={!hasDrawingPath}
            title={
              hasDrawingPath
                ? "Finish the wall (or double-click on the canvas)"
                : "Add at least 2 points to complete"
            }
          >
            Complete
          </button>
          <button
            type="button"
            className="toolbar-action"
            onClick={cancelDrawing}
            title="Cancel drawing"
          >
            Cancel
          </button>
        </>
      )}
      {activeTool === "Measure" && measurePath && measurePath.length > 0 && (
        <>
          <button
            type="button"
            className="toolbar-action"
            onClick={completeMeasure}
            disabled={!hasMeasurePath}
            title={hasMeasurePath ? "Finish measurement (or double-click)" : "Add at least 2 points"}
          >
            Complete
          </button>
          <button
            type="button"
            className="toolbar-action"
            onClick={cancelMeasure}
            title="Cancel measurement (Esc)"
          >
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
