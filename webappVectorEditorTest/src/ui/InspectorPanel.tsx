import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useEditorState } from "../state/EditorStateContext";
import {
  REFERENCE_IMAGE_LAYER_ID,
  isDrawWallLikeTool,
  type DoorDrawKind,
  type DoorDrawRegionFilter,
} from "../state/editorState";
import {
  OUTER_WALL_WIDTH_OPTIONS_MM,
  INNER_WALL_WIDTH_OPTIONS_MM,
  STAIRS_WIDTH_OPTIONS_MM,
  effectiveWallDrawWidthMm,
} from "../geometry/wallDrawWidth";
import { getObjectsBbox } from "../geometry/bbox";
import { getPolygonContour } from "../geometry/types";
import { defaultRoomLabel, listRoomsFromObjects } from "../geometry/rooms";
import { DOOR_PLACEMENT_RULES_SUMMARY } from "../geometry/doorPlacementRules";
import type { DoorSwing, EdgeRef, VectorObject } from "../geometry/types";
import type { DoorWidthOption } from "../items/doorSizes";
import {
  DOOR_WIDTH_OPTIONS,
  DEFAULT_DOOR_PLACE_OPTION_ID,
  DEFAULT_DOUBLE_DOOR_OPTION_ID,
  DOUBLE_DOOR_WIDTH_OPTIONS,
  catalogWidthsForDraw,
  doorOptionById,
  doorOptionByWidthMm,
  doubleDoorOptionById,
  doubleDoorOptionByWidthMm,
  doorPlacedWidthMm,
  doorCatalogInspectorLabel,
} from "../items/doorSizes";

function DoorWidthSelect(props: {
  value: string;
  onChange: (optionId: string) => void;
  title?: string;
  /** Defaults to single-door catalog when omitted. */
  options?: DoorWidthOption[];
}) {
  const opts = props.options ?? DOOR_WIDTH_OPTIONS;
  const sa = opts.filter((o) => o.region === "SA");
  const uk = opts.filter((o) => o.region === "UK");
  return (
    <select
      className="inspector-input"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      title={props.title}
    >
      <optgroup label="South Africa">
        {sa.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="UK">
        {uk.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

const itemOptions = [
  { id: "single-door", label: "Single door", color: "#3b82f6" },
  { id: "double-door", label: "Double door", color: "#06b6d4" },
  { id: "toilet", label: "Toilet", color: "#22c55e" },
  { id: "basin", label: "Basin", color: "#f59e0b" },
  { id: "stove", label: "Stove", color: "#ef4444" },
] as const;

function resolveItemDisplayName(obj: VectorObject): string {
  if (obj.itemLabel) return obj.itemLabel;
  if (obj.itemId) {
    const found = itemOptions.find((o) => o.id === obj.itemId);
    if (found) return found.label;
  }
  if (obj.itemColor) {
    const byColor = itemOptions.find((o) => o.color === obj.itemColor);
    if (byColor) return byColor.label;
  }
  return "Item";
}

function RoomNameField(props: {
  roomKey: string;
  defaultLabel: string;
  committedCustom: string;
  onCommit: (key: string, value: string) => void;
}) {
  const { roomKey, defaultLabel, committedCustom, onCommit } = props;
  const [local, setLocal] = useState(committedCustom);
  useEffect(() => {
    setLocal(committedCustom);
  }, [committedCustom, roomKey]);
  return (
    <label className="inspector-field" style={{ alignItems: "stretch", flexDirection: "column" }}>
      <span className="inspector-field-label">{defaultLabel}</span>
      <input
        type="text"
        className="inspector-input"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => onCommit(roomKey, local)}
        placeholder="Custom name (optional)"
        title="Shown on the plan; leave empty for the default label (e.g. Room-1)"
      />
    </label>
  );
}

function fmtMm(n: number): string {
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : 2;
  return n.toFixed(digits);
}

const VERT_COUNT_ROUND = 100;

function countVertices(obj: VectorObject): number {
  if (obj.itemId === "stairs") {
    const keys = new Set<string>();
    for (const poly of obj.polygons) {
      for (const v of poly.verts) {
        keys.add(`${Math.round(v.x * VERT_COUNT_ROUND)}:${Math.round(v.y * VERT_COUNT_ROUND)}`);
      }
      for (const hole of poly.holes ?? []) {
        for (const v of hole) {
          keys.add(`${Math.round(v.x * VERT_COUNT_ROUND)}:${Math.round(v.y * VERT_COUNT_ROUND)}`);
        }
      }
    }
    return keys.size;
  }
  let n = 0;
  for (const poly of obj.polygons) {
    n += poly.verts.length;
    for (const hole of poly.holes ?? []) {
      n += hole.length;
    }
  }
  return n;
}

function centerlineLengthMm(obj: VectorObject): number | null {
  const cl = obj.centerline;
  if (!cl || cl.length < 2) return null;
  let len = 0;
  for (let i = 1; i < cl.length; i++) {
    len += Math.hypot(cl[i].x - cl[i - 1].x, cl[i].y - cl[i - 1].y);
  }
  return len;
}

function selectedEdgeLengthMm(obj: VectorObject | null, edge: EdgeRef | null): number | null {
  if (!obj || !edge || edge.objectId !== obj.id) return null;
  const poly = obj.polygons.find((p) => p.id === edge.polygonId);
  if (!poly) return null;
  const contour = getPolygonContour(poly, edge.holeIndex);
  if (contour.length < 2) return null;
  const i = edge.edgeIndex;
  const j = (i + 1) % contour.length;
  const a = contour[i];
  const b = contour[j];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Width × height for the inspector "Size" row. Uses stored door width or true edge length for squares so
 * values do not change when the shape rotates (axis-aligned bbox would grow at 45°).
 */
function inspectorDisplaySizeMm(obj: VectorObject): { w: number; h: number } {
  if (obj.doorWidthMm != null && obj.doorWidthMm > 0) {
    const s = obj.doorWidthMm;
    return { w: s, h: s };
  }
  const poly = obj.polygons[0];
  if (poly && poly.verts.length === 4) {
    const v = poly.verts;
    const edgeLen = (i: number) =>
      Math.hypot(v[(i + 1) % 4].x - v[i].x, v[(i + 1) % 4].y - v[i].y);
    const s0 = edgeLen(0);
    const eps = 1e-3;
    if (
      Math.abs(edgeLen(1) - s0) < eps &&
      Math.abs(edgeLen(2) - s0) < eps &&
      Math.abs(edgeLen(3) - s0) < eps
    ) {
      return { w: s0, h: s0 };
    }
  }
  const b = getObjectsBbox([obj]);
  if (!b) return { w: 0, h: 0 };
  return { w: b.maxX - b.minX, h: b.maxY - b.minY };
}

export function InspectorPanel() {
  const {
    state,
    setActiveTool,
    setPendingAddItem,
    setPendingAddShape,
    setAddItemPanelOpen,
    updateDrawShapeWidth,
    updateDoorItemProps,
    updateDoorSquareSize,
    clearCompletedMeasure,
    applyFloorPlanCalibrationFromMeasure,
    continueWallFromSelection,
    setObjectLayerId,
    setOuterWallDrawWidthMm,
    setInnerWallDrawWidthMm,
    setStairsDrawWidthMm,
    pushHistory,
    setRoomCustomName,
    setShowRoomLabelsInViewport,
    setDoorDrawKind,
    setDoorDrawRegionFilter,
    setDoorDrawSwing,
  } = useEditorState();
  const {
    addItemPanelOpen,
    activeTool,
    outerWallDrawWidthMm,
    innerWallDrawWidthMm,
    stairsDrawWidthMm,
    selection,
    objects,
    layers,
    drawingPath,
    drawingMergeObjectId,
    lastMeasureTotalMm,
    completedMeasurePath,
    pendingAddItem,
    pendingAddShape,
    roomCustomNames,
    showRoomLabelsInViewport,
    doorDrawKind,
    doorDrawRegionFilter,
    doorDrawSwing,
  } = state;

  const [calibrateTrueMm, setCalibrateTrueMm] = useState("");
  const [roomNamesOpen, setRoomNamesOpen] = useState(false);
  const [doorPlaceOptionId, setDoorPlaceOptionId] = useState(DEFAULT_DOOR_PLACE_OPTION_ID);
  const floorPlanLayer = layers.find((l) => l.id === REFERENCE_IMAGE_LAYER_ID && l.type === "image");
  const canCalibrateFloorPlan =
    lastMeasureTotalMm != null &&
    lastMeasureTotalMm > 0 &&
    floorPlanLayer?.imageUrl != null &&
    floorPlanLayer.imageNaturalWidth != null &&
    floorPlanLayer.imageNaturalWidth > 0;

  const selectedObject = selection.objectId ? objects.find((o) => o.id === selection.objectId) : null;
  const isLineObject = selectedObject?.centerline != null && selectedObject.centerline.length >= 2;

  const handlePickItem = (item: (typeof itemOptions)[number]) => {
    setPendingAddItem(item);
    if (item.id === "single-door") {
      const w = doorOptionById(doorPlaceOptionId)?.widthMm ?? 762;
      setPendingAddShape(true, w);
    } else {
      setPendingAddShape(true, 100);
    }
    setAddItemPanelOpen(false);
  };

  const onDoorPlaceOptionChange = (optionId: string) => {
    setDoorPlaceOptionId(optionId);
    const w = doorOptionById(optionId)?.widthMm ?? 762;
    if (pendingAddItem?.id === "single-door" && pendingAddShape) {
      setPendingAddShape(true, w);
    }
  };

  const selectedSingleDoorOptionId = useMemo(() => {
    if (!selectedObject || selectedObject.itemId !== "single-door") return DEFAULT_DOOR_PLACE_OPTION_ID;
    const w = doorPlacedWidthMm(selectedObject);
    return doorOptionByWidthMm(w)?.id ?? DEFAULT_DOOR_PLACE_OPTION_ID;
  }, [selectedObject]);

  const selectedDoubleDoorOptionId = useMemo(() => {
    if (!selectedObject || selectedObject.itemId !== "double-door") return DEFAULT_DOUBLE_DOOR_OPTION_ID;
    if (selectedObject.doorCatalogOptionId) {
      const byId = doubleDoorOptionById(selectedObject.doorCatalogOptionId);
      if (byId) return byId.id;
    }
    const w = doorPlacedWidthMm(selectedObject);
    return doubleDoorOptionByWidthMm(w)?.id ?? DEFAULT_DOUBLE_DOOR_OPTION_ID;
  }, [selectedObject]);

  const bbox = selectedObject ? getObjectsBbox([selectedObject]) : null;
  const vectorLayers = layers.filter((l) => l.type !== "image");
  const centerX = bbox ? (bbox.minX + bbox.maxX) / 2 : null;
  const centerY = bbox ? (bbox.minY + bbox.maxY) / 2 : null;
  const sizeDisplay = selectedObject ? inspectorDisplaySizeMm(selectedObject) : null;
  const widthMm = sizeDisplay != null ? sizeDisplay.w : null;
  const heightMm = sizeDisplay != null ? sizeDisplay.h : null;
  const verts = selectedObject ? countVertices(selectedObject) : 0;
  const spineLen = selectedObject ? centerlineLengthMm(selectedObject) : null;
  const edgeLen = selectedEdgeLengthMm(selectedObject, selection.edge);

  const wallEndpointContinue =
    isLineObject &&
    selectedObject != null &&
    selectedObject.itemColor == null &&
    selection.centerlinePoint != null &&
    selection.centerlinePoint.objectId === selectedObject.id &&
    !drawingMergeObjectId &&
    (drawingPath == null || drawingPath.length === 0);
  const continueEndpointLabel =
    wallEndpointContinue && selectedObject.centerline && selection.centerlinePoint
      ? selection.centerlinePoint.pointIndex === 0
        ? "start"
        : "end"
      : null;

  const rooms = useMemo(() => listRoomsFromObjects(objects), [objects]);

  const doorDrawCatalogWidthsMm = useMemo(
    () => catalogWidthsForDraw(doorDrawKind, doorDrawRegionFilter),
    [doorDrawKind, doorDrawRegionFilter]
  );

  const commitRoomName = useCallback(
    (key: string, next: string) => {
      const prev = roomCustomNames[key] ?? "";
      const trimmed = next.trim();
      if (prev === trimmed) return;
      pushHistory(state);
      setRoomCustomName(key, trimmed);
    },
    [roomCustomNames, pushHistory, state, setRoomCustomName]
  );

  return (
    <div className="inspector-panel">
      <div className="inspector-panel-header">
        <span className="inspector-panel-title">Inspector</span>
      </div>
      <div className="inspector-panel-content">
        <div className="inspector-section">
          <button
            type="button"
            className="inspector-option"
            onClick={() => setRoomNamesOpen((o) => !o)}
            title="Name rooms from floor/ceiling splits (inner walls)"
          >
            {roomNamesOpen ? "Hide room names" : "Room names"}
          </button>
          {roomNamesOpen ? (
            <>
              <label className="inspector-field" style={{ marginTop: "0.35rem" }}>
                <span className="inspector-field-label">Show labels in viewport</span>
                <input
                  type="checkbox"
                  checked={showRoomLabelsInViewport}
                  onChange={(e) => setShowRoomLabelsInViewport(e.target.checked)}
                  title="Draw room names at the centre of each floor region"
                />
              </label>
              {rooms.length === 0 ? (
                <p className="inspector-section-hint" style={{ marginTop: "0.35rem" }}>
                  No rooms yet. Draw a closed outer wall; inner walls split the floor into separate rooms.
                </p>
              ) : (
                <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {rooms.map((r) => (
                    <RoomNameField
                      key={r.key}
                      roomKey={r.key}
                      defaultLabel={defaultRoomLabel(r.globalIndex)}
                      committedCustom={roomCustomNames[r.key] ?? ""}
                      onCommit={commitRoomName}
                    />
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
        {lastMeasureTotalMm != null || (completedMeasurePath != null && completedMeasurePath.length > 0) ? (
          <div className="inspector-section">
            <div className="inspector-section-title">Measure</div>
            <p className="inspector-section-hint">
              Last completed polyline length (mm). To scale the floor plan: trace a known distance, complete, then enter its
              real length below. Applying scale resizes the measurement with the plan about the floor plan centre so it stays
              aligned.
            </p>
            {lastMeasureTotalMm != null ? (
              <div className="inspector-field">
                <span className="inspector-field-label">Total</span>
                <span className="inspector-value">{fmtMm(lastMeasureTotalMm)} mm</span>
              </div>
            ) : null}
            {lastMeasureTotalMm != null ? (
              <>
                <label className="inspector-field">
                  <span className="inspector-field-label">True length</span>
                  <input
                    type="number"
                    className="inspector-input"
                    min={0.01}
                    step={1}
                    placeholder="mm"
                    value={calibrateTrueMm}
                    onChange={(e) => setCalibrateTrueMm(e.target.value)}
                    title="Real-world length of what you measured (millimetres)"
                  />
                </label>
                <button
                  type="button"
                  className="inspector-option"
                  style={{ marginTop: "0.35rem" }}
                  disabled={!canCalibrateFloorPlan || Number(calibrateTrueMm) <= 0}
                  onClick={() => {
                    const T = Number(calibrateTrueMm);
                    if (T > 0) applyFloorPlanCalibrationFromMeasure(T);
                  }}
                  title={
                    canCalibrateFloorPlan
                      ? "Scale floor plan and this measurement together (about floor plan centre) so the line stays on the drawing"
                      : floorPlanLayer?.imageUrl
                        ? "Wait for floor plan image to finish loading"
                        : "Choose a floor plan image in the layers panel first"
                  }
                >
                  Apply scale to floor plan
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="inspector-option"
              style={{ marginTop: "0.5rem" }}
              onClick={() => clearCompletedMeasure()}
              title="Remove measurement from canvas and clear total"
            >
              Clear measurement
            </button>
          </div>
        ) : null}
        {activeTool === "Draw doors" ? (
          <div className="inspector-section">
            <div className="inspector-section-title">Draw doors</div>
            <p className="inspector-section-hint" style={{ marginTop: 0 }}>
              Same settings as the toolbar. Drag on a wall to place; width snaps to the nearest catalog size.
            </p>
            <label className="inspector-field">
              <span className="inspector-field-label">Door type</span>
              <select
                className="inspector-input"
                value={doorDrawKind}
                onChange={(e) => setDoorDrawKind(e.target.value as DoorDrawKind)}
                title="Single vs double door catalog widths"
              >
                <option value="single">Single</option>
                <option value="double">Double</option>
              </select>
            </label>
            <label className="inspector-field">
              <span className="inspector-field-label">Catalog</span>
              <select
                className="inspector-input"
                value={doorDrawRegionFilter}
                onChange={(e) => setDoorDrawRegionFilter(e.target.value as DoorDrawRegionFilter)}
                title="Filter standard widths by region or use all sizes"
              >
                <option value="global">All regions</option>
                <option value="SA">SA only</option>
                <option value="UK">UK only</option>
              </select>
            </label>
            <label className="inspector-field">
              <span className="inspector-field-label">Swing</span>
              <select
                className="inspector-input"
                value={doorDrawSwing}
                onChange={(e) => setDoorDrawSwing(e.target.value as DoorSwing)}
                title="Inswing vs outswing for the plan door symbol (paired with wall opening)"
              >
                <option value="in">In</option>
                <option value="out">Out</option>
              </select>
            </label>
            <div className="inspector-field">
              <span className="inspector-field-label">Standard widths (mm)</span>
              <span
                className="inspector-value"
                style={{ fontSize: "0.7rem", lineHeight: 1.35, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                title={doorDrawCatalogWidthsMm.join(", ") + " mm"}
              >
                {doorDrawCatalogWidthsMm.join(", ")}
              </span>
            </div>
            <div className="inspector-section-title" style={{ marginTop: "0.75rem" }}>
              Placement rules
            </div>
            <ul
              className="inspector-section-hint"
              style={{ margin: "0.25rem 0 0", paddingLeft: "1.15rem", listStyleType: "disc" }}
            >
              {DOOR_PLACEMENT_RULES_SUMMARY.map((line, i) => (
                <li key={i} style={{ marginBottom: "0.3rem" }}>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {isDrawWallLikeTool(activeTool) ? (
          <div className="inspector-section">
            <div className="inspector-section-title">
              {activeTool === "Draw outer wall"
                ? "Outer wall (draw)"
                : activeTool === "Draw inner wall"
                  ? "Inner wall (draw)"
                  : "Stairs (draw)"}
            </div>
            <label className="inspector-field">
              <span className="inspector-field-label">
                {activeTool === "Draw stairs" ? "Stair run width" : "Stroke width"}
              </span>
              <select
                className="inspector-input"
                value={
                  activeTool === "Draw inner wall"
                    ? innerWallDrawWidthMm
                    : activeTool === "Draw stairs"
                      ? stairsDrawWidthMm
                      : outerWallDrawWidthMm
                }
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (activeTool === "Draw inner wall") setInnerWallDrawWidthMm(v);
                  else if (activeTool === "Draw stairs") setStairsDrawWidthMm(v);
                  else setOuterWallDrawWidthMm(v);
                }}
                title={
                  activeTool === "Draw stairs"
                    ? "Width of the stair run in plan (mm); same vertical span as walls in 3D export"
                    : "Width of the wall stroke for new segments (mm)"
                }
              >
                {(activeTool === "Draw inner wall"
                  ? INNER_WALL_WIDTH_OPTIONS_MM
                  : activeTool === "Draw stairs"
                    ? STAIRS_WIDTH_OPTIONS_MM
                    : OUTER_WALL_WIDTH_OPTIONS_MM
                ).map((w) => (
                  <option key={w} value={w}>
                    {w} mm
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {addItemPanelOpen ? (
          <div className="inspector-section">
            <div className="inspector-section-title">Add item</div>
            <p className="inspector-section-hint">Choose an item to place on the canvas.</p>
            <label className="inspector-field">
              <span className="inspector-field-label">Single door width</span>
              <DoorWidthSelect
                value={doorPlaceOptionId}
                onChange={onDoorPlaceOptionChange}
                title="Plan symbol is square: width × width (mm). Heights are nominal."
              />
            </label>
            <p className="inspector-section-hint" style={{ marginTop: "0.25rem" }}>
              For single doors, the symbol uses the chosen <strong>width</strong> for both sides (e.g. 762×762 mm).
            </p>
            <div className="inspector-options">
              {itemOptions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="inspector-option inspector-option-tinted"
                  style={
                    {
                      "--item-color": item.color,
                    } as CSSProperties
                  }
                  onClick={() => handlePickItem(item)}
                  title={`Place ${item.label}; click on canvas to position`}
                >
                  <span className="inspector-option-swatch" style={{ backgroundColor: item.color }} aria-hidden />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {selectedObject ? (
          <div className="inspector-section">
            <div className="inspector-section-title">Shape</div>
            <p className="inspector-section-hint" style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.7rem" }}>
              {selectedObject.id}
            </p>
            {selectedObject.itemId === "single-door" || selectedObject.itemId === "double-door" ? (
              <div className="inspector-field">
                <span className="inspector-field-label">Door</span>
                <span className="inspector-value" title="Door: standard size from SA / UK catalog (width mm)">
                  {doorCatalogInspectorLabel(selectedObject)}
                </span>
              </div>
            ) : null}
            <label className="inspector-field">
              <span className="inspector-field-label">Layer</span>
              <select
                className="inspector-input"
                value={selectedObject.layerId}
                onChange={(e) => setObjectLayerId(selectedObject.id, e.target.value)}
                title="Layer controls stroke/fill colour and export grouping"
              >
                {vectorLayers.every((l) => l.id !== selectedObject.layerId) ? (
                  <option value={selectedObject.layerId}>
                    {layers.find((l) => l.id === selectedObject.layerId)?.name ?? selectedObject.layerId}{" "}
                    (invalid)
                  </option>
                ) : null}
                {vectorLayers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="inspector-field">
              <span className="inspector-field-label">Center (mm)</span>
              <span className="inspector-value">
                {centerX != null && centerY != null ? `${fmtMm(centerX)}, ${fmtMm(centerY)}` : "—"}
              </span>
            </div>
            <div className="inspector-field">
              <span className="inspector-field-label">Size (mm)</span>
              <span className="inspector-value">
                {widthMm != null && heightMm != null ? `${fmtMm(widthMm)} × ${fmtMm(heightMm)}` : "—"}
              </span>
            </div>
            <div className="inspector-field">
              <span className="inspector-field-label">Vertices</span>
              <span className="inspector-value">{verts}</span>
            </div>
            <div className="inspector-field">
              <span className="inspector-field-label">Rotation (°)</span>
              <span className="inspector-value">{fmtMm(selectedObject.transform.rotationDeg)}</span>
            </div>
            {selectedObject.itemColor != null ? (
              <>
                <div className="inspector-field">
                  <span className="inspector-field-label">Item</span>
                  <span
                    className="inspector-value"
                    style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.35rem" }}
                  >
                    <span>{resolveItemDisplayName(selectedObject)}</span>
                    <span
                      aria-hidden
                      title="Item color"
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 2,
                        flexShrink: 0,
                        backgroundColor: selectedObject.itemColor,
                        border: "1px solid #334155",
                      }}
                    />
                  </span>
                </div>
                <div className="inspector-field">
                  <span className="inspector-field-label">Facing</span>
                  <span className="inspector-value" title="Degrees (0 = +X, 90 = +Y)">
                    {selectedObject.itemDirectionDeg != null ? `${fmtMm(selectedObject.itemDirectionDeg)}°` : "—"}
                  </span>
                </div>
                {selectedObject.itemId === "single-door" || selectedObject.itemId === "double-door" ? (
                  <>
                    <label className="inspector-field">
                      <span className="inspector-field-label">Door size</span>
                      <DoorWidthSelect
                        value={
                          selectedObject.itemId === "single-door"
                            ? selectedSingleDoorOptionId
                            : selectedDoubleDoorOptionId
                        }
                        options={
                          selectedObject.itemId === "double-door" ? DOUBLE_DOOR_WIDTH_OPTIONS : undefined
                        }
                        onChange={(optionId) => {
                          const opt =
                            selectedObject.itemId === "double-door"
                              ? doubleDoorOptionById(optionId)
                              : doorOptionById(optionId);
                          if (opt)
                            updateDoorSquareSize(
                              selectedObject.id,
                              opt.widthMm,
                              selectedObject.itemId === "double-door" ? opt.id : undefined
                            );
                        }}
                        title="Resize plan symbol to standard width (square)"
                      />
                    </label>
                    <label className="inspector-field">
                      <span className="inspector-field-label">Handing</span>
                      <select
                        className="inspector-input"
                        value={selectedObject.doorHanding ?? "left"}
                        onChange={(e) =>
                          updateDoorItemProps(selectedObject.id, {
                            doorHanding: e.target.value as "left" | "right",
                          })
                        }
                        title="Hinge side (single-door graphic is authored left-hand)"
                      >
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                    <label className="inspector-field">
                      <span className="inspector-field-label">Swing</span>
                      <select
                        className="inspector-input"
                        value={selectedObject.doorSwing ?? "in"}
                        onChange={(e) =>
                          updateDoorItemProps(selectedObject.id, {
                            doorSwing: e.target.value as "in" | "out",
                          })
                        }
                        title="Inswing vs outswing (mirrors swing arc in plan)"
                      >
                        <option value="in">Inswing</option>
                        <option value="out">Outswing</option>
                      </select>
                    </label>
                  </>
                ) : null}
              </>
            ) : null}
            {spineLen != null ? (
              <div className="inspector-field">
                <span className="inspector-field-label">Path length</span>
                <span className="inspector-value">{fmtMm(spineLen)} mm</span>
              </div>
            ) : null}
            {selection.edge && edgeLen != null ? (
              <div className="inspector-field">
                <span className="inspector-field-label">Edge length</span>
                <span className="inspector-value">{fmtMm(edgeLen)} mm</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {isLineObject && selectedObject ? (
          <div className="inspector-section">
            <div className="inspector-section-title">Line object</div>
            <label className="inspector-field">
              <span className="inspector-field-label">Width (mm)</span>
              {selectedObject.itemId === "inner-wall" ? (
                <select
                  className="inspector-input"
                  value={effectiveWallDrawWidthMm(selectedObject)}
                  onChange={(e) => updateDrawShapeWidth(selectedObject.id, Number(e.target.value))}
                  title="Stroke width in mm"
                >
                  {Array.from(
                    new Set([...INNER_WALL_WIDTH_OPTIONS_MM, effectiveWallDrawWidthMm(selectedObject)])
                  )
                    .sort((a, b) => a - b)
                    .map((w) => (
                      <option key={w} value={w}>
                        {w} mm
                      </option>
                    ))}
                </select>
              ) : selectedObject.itemId == null ? (
                <select
                  className="inspector-input"
                  value={effectiveWallDrawWidthMm(selectedObject)}
                  onChange={(e) => updateDrawShapeWidth(selectedObject.id, Number(e.target.value))}
                  title="Stroke width in mm"
                >
                  {Array.from(
                    new Set([...OUTER_WALL_WIDTH_OPTIONS_MM, effectiveWallDrawWidthMm(selectedObject)])
                  )
                    .sort((a, b) => a - b)
                    .map((w) => (
                      <option key={w} value={w}>
                        {w} mm
                      </option>
                    ))}
                </select>
              ) : (
                <input
                  type="number"
                  className="inspector-input"
                  min={1}
                  step={10}
                  value={selectedObject.drawWidthMm ?? 100}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v >= 1) updateDrawShapeWidth(selectedObject.id, v);
                  }}
                  title="Stroke width in mm"
                />
              )}
            </label>
            {wallEndpointContinue ? (
              <>
                <button
                  type="button"
                  className="inspector-option"
                  style={{ marginTop: "0.35rem", width: "100%" }}
                  onClick={() => {
                    setActiveTool("Draw outer wall");
                    continueWallFromSelection();
                  }}
                  title="Switch to Draw outer wall and extend from this endpoint; click to add corners, then Complete"
                >
                  Continue wall from {continueEndpointLabel} endpoint
                </button>
                <p className="inspector-section-hint" style={{ marginTop: "0.25rem" }}>
                  Uses the selected centerline endpoint (yellow handle). Same as toolbar Continue wall.
                </p>
              </>
            ) : null}
          </div>
        ) : null}

        {!selectedObject && !addItemPanelOpen ? (
          <p className="inspector-placeholder">Select a shape to see position, size, and layer. Use Add item to place fixtures.</p>
        ) : null}
      </div>
    </div>
  );
}
