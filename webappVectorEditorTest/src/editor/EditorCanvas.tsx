import { useRef, useEffect, useCallback, useState } from "react";
import { useEditorState } from "../state/EditorStateContext";
import { isDrawWallLikeTool, snapGridStepMm, snapVertexToleranceMm } from "../state/editorState";
import { renderScene, type ImageCache } from "../render/sceneRenderer";
import { ALL_ITEM_IMAGE_URLS } from "../items/itemImages";
import {
  hitTestEdges,
  hitTestObjectAtPoint,
  hitTestCenterlinePoint,
  hitTestCenterlineSegment,
  hitTestMeasureVertex,
  hitTestWindowEndpoint,
} from "../geometry/hitTest";
import { pointInPolygon } from "../geometry/polygonUtils";
import { getOutwardNormal } from "../geometry/extrude";
import { isAxisReversingWallSegment, measureVertexDragLock, snapToAxisAligned } from "../geometry/drawPath";
import {
  continueWallEdgeSnapFromObjects,
  snapAxisLockedPointToWallEdges,
  snapFreePointToWallEdges,
} from "../geometry/wallEdgeSnap";
import {
  hasClosedOuterWallRegion,
  isPointInsideClosedOuterShells,
} from "../geometry/innerWallConstraint";
import { hitNearestWallCenterline, snapWallWindowPointerOntoCenterline } from "../geometry/wallWindow";
import { vec2, getPolygonContour } from "../geometry/types";
import type { EdgeRef, Vec2, VectorObject } from "../geometry/types";
import {
  collectAlignmentVertices,
  snapWorldPointToGridAndVertices,
  snapAxisLockedToGridAndVertices,
  snapWorldXToGridAndVertices,
  snapWorldYToGridAndVertices,
} from "../geometry/vertexSnap";
import {
  angleDeltaRad,
  getRotateManipulatorForObject,
  ROTATE_SNAP_DEG_DEFAULT,
  snapAngleDeg,
} from "../geometry/rotateShape";
import { CAMERA_STATS_TITLE, getCameraStatsLine } from "../ui/cameraStats";
/** Map client (CSS) coordinates to canvas bitmap pixel coordinates. */
function clientToCanvasPixel(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function screenToWorld(
  canvas: HTMLCanvasElement,
  camera: { center: { x: number; y: number }; zoom: number },
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const { x, y } = clientToCanvasPixel(canvas, clientX, clientY);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return {
    x: camera.center.x + (x - cx) / camera.zoom,
    y: camera.center.y - (y - cy) / camera.zoom
  };
}

export function EditorCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const {
    state,
    pushHistory,
    undo,
    redo,
    setCamera,
    setSelection,
    setExtrudePreview,
    applyExtrude,
    setViewportSize,
    applyMoveEdgeFromSnapshot,
    applyMoveObjectFromSnapshot,
    applyRotateObjectFromSnapshot,
    setAddShapePreviewWorld,
    placeAddShape,
    placeWallWindow,
    placeWallDoor,
    setDrawingPath,
    appendDrawingPoint,
    setDrawPreviewWorld,
    completeDrawing,
    cancelDrawing,
    setMeasurePath,
    appendMeasurePoint,
    setMeasurePreviewWorld,
    completeMeasure,
    cancelMeasure,
    updateLayer,
    updateCompletedMeasurePoint,
    updateCenterlinePoint,
    updateCenterlineSegment,
    updateWallWindowEndpointDrag,
  } = useEditorState();
  const {
    camera,
    activeTool,
    objects,
    selection,
    snap,
    selectionDistancePx,
    pendingAddShape,
    drawingPath,
    measurePath,
    completedMeasurePath,
    viewportSize,
  } = state;

  const stateRef = useRef(state);
  stateRef.current = state;

  const isItemObject = useCallback((obj: VectorObject) => obj.itemColor != null, []);

  const panStartRef = useRef<{ x: number; y: number; centerX: number; centerY: number } | null>(
    null
  );

  const extrudeDragRef = useRef<{
    startWorld: { x: number; y: number };
    edgeRef: EdgeRef;
    lastDistanceMm: number;
  } | null>(null);

  const moveDragRef = useRef<
    | {
        type: "edge" | "shape";
        startWorld: { x: number; y: number };
        initialObjects: VectorObject[];
        edgeRef?: EdgeRef;
        objectId?: string;
      }
    | null
  >(null);

  const rotateDragRef = useRef<{
    objectId: string;
    initialObjects: VectorObject[];
    centerWorld: Vec2;
    startAngleRad: number;
  } | null>(null);

  const drawLastClickRef = useRef<{ x: number; y: number; t: number } | null>(null);
  /** Snapped world position for Draw wall cursor dot (refreshed on pointermove; not React state). */
  const drawWallCursorWorldRef = useRef<{ x: number; y: number } | null>(null);
  /** Draw windows / Draw doors: drag along wall (wallId + start/end; not React state). */
  const wallWindowDrawPreviewRef = useRef<{
    wallId: string;
    start: { x: number; y: number };
    end: { x: number; y: number };
  } | null>(null);
  const windowEndpointDragRef = useRef<{ windowId: string; which: "start" | "end" } | null>(null);
  const renderRef = useRef<() => void>(() => {});
  const measureLastClickRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const measurePointDragRef = useRef<{
    index: number;
    startWorld: { x: number; y: number };
    startPos: { x: number; y: number };
    lock: ReturnType<typeof measureVertexDragLock>;
  } | null>(null);

  const centerlineDragRef = useRef<{
    objectId: string;
    pointIndex: number;
    startWorld: { x: number; y: number };
    startPos: { x: number; y: number };
    /** Endpoint only: direction along which point can move (unit vector). */
    segmentDir: { x: number; y: number };
  } | null>(null);

  const centerlineSegmentDragRef = useRef<{
    objectId: string;
    segmentIndex: number;
    startWorld: { x: number; y: number };
    perpDir: { x: number; y: number };
    /** Last applied delta (for incremental updates). */
    lastDelta: { x: number; y: number };
  } | null>(null);

  const imageCacheRef = useRef<ImageCache>(new Map());
  const [imageCacheVersion, setImageCacheVersion] = useState(0);

  useEffect(() => {
    const cache = imageCacheRef.current;
    const urls = ALL_ITEM_IMAGE_URLS.filter((u) => !cache.has(u));
    if (urls.length === 0) return;
    let pending = urls.length;
    urls.forEach((url) => {
      const img = new Image();
      img.onload = () => {
        cache.set(url, img);
        pending -= 1;
        if (pending === 0) setImageCacheVersion((n) => n + 1);
      };
      img.onerror = () => {
        pending -= 1;
        if (pending === 0) setImageCacheVersion((n) => n + 1);
      };
      img.src = url;
    });
  }, []);

  useEffect(() => {
    const cache = imageCacheRef.current;
    const activeUrls = new Set(
      state.layers
        .filter((l) => l.type === "image" && l.imageUrl)
        .map((l) => l.imageUrl as string)
    );
    for (const key of [...cache.keys()]) {
      if (!ALL_ITEM_IMAGE_URLS.includes(key) && !activeUrls.has(key)) {
        cache.delete(key);
      }
    }
    const urlsToLoad: string[] = [];
    for (const layer of state.layers) {
      if (layer.type === "image" && layer.imageUrl && !cache.has(layer.imageUrl)) {
        urlsToLoad.push(layer.imageUrl);
      }
    }
    if (urlsToLoad.length === 0) return;
    let pending = urlsToLoad.length;
    urlsToLoad.forEach((url) => {
      const img = new Image();
      img.onload = () => {
        cache.set(url, img);
        const imageLayer = state.layers.find((l) => l.type === "image" && l.imageUrl === url);
        if (imageLayer && img.naturalWidth > 0) {
          updateLayer(
            imageLayer.id,
            {
              imageNaturalWidth: img.naturalWidth,
              imageNaturalHeight: img.naturalHeight,
            },
            { skipHistory: true }
          );
        }
        pending -= 1;
        if (pending === 0) setImageCacheVersion((n) => n + 1);
      };
      img.onerror = () => {
        pending -= 1;
        if (pending === 0) setImageCacheVersion((n) => n + 1);
      };
      img.src = url;
    });
  }, [state.layers, updateLayer]);

  useEffect(() => {
    const cache = imageCacheRef.current;
    for (const layer of state.layers) {
      if (layer.type !== "image" || !layer.imageUrl) continue;
      if (layer.imageNaturalWidth != null && layer.imageNaturalWidth > 0) continue;
      const img = cache.get(layer.imageUrl);
      if (img && img.complete && img.naturalWidth > 0) {
        updateLayer(
          layer.id,
          {
            imageNaturalWidth: img.naturalWidth,
            imageNaturalHeight: img.naturalHeight,
          },
          { skipHistory: true }
        );
      }
    }
  }, [state.layers, imageCacheVersion, updateLayer]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    renderScene(
      ctx,
      width,
      height,
      state,
      imageCacheRef.current,
      drawWallCursorWorldRef.current,
      wallWindowDrawPreviewRef.current
        ? {
            wallId: wallWindowDrawPreviewRef.current.wallId,
            start: wallWindowDrawPreviewRef.current.start,
            end: wallWindowDrawPreviewRef.current.end,
          }
        : null
    );
  }, [state, imageCacheVersion]);

  useEffect(() => {
    renderRef.current = render;
  }, [render]);

  useEffect(() => {
    render();
  }, [render]);

  useEffect(() => {
    if (!isDrawWallLikeTool(activeTool)) {
      drawWallCursorWorldRef.current = null;
      requestAnimationFrame(() => renderRef.current());
    }
  }, [activeTool]);

  useEffect(() => {
    if (activeTool !== "Draw windows" && activeTool !== "Draw doors") {
      wallWindowDrawPreviewRef.current = null;
      requestAnimationFrame(() => renderRef.current());
    }
  }, [activeTool]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = (width: number, height: number) => {
      canvas.width = Math.floor(width);
      canvas.height = Math.floor(height);
      setViewportSize({ width, height });
      render();
    };

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      updateSize(width, height);
    });

    resizeObserver.observe(canvas);

    const parent = canvas.parentElement;
    if (parent) {
      const { width, height } = parent.getBoundingClientRect();
      updateSize(width, height);
    }

    return () => resizeObserver.disconnect();
  }, [render, setViewportSize]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select") || t?.isContentEditable) return;

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "z") {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
          return;
        }
        if (k === "y") {
          e.preventDefault();
          redo();
          return;
        }
      }

      if (e.key !== "Escape") return;
      if (windowEndpointDragRef.current) {
        e.preventDefault();
        windowEndpointDragRef.current = null;
        return;
      }
      if (
        (activeTool === "Draw windows" || activeTool === "Draw doors") &&
        wallWindowDrawPreviewRef.current
      ) {
        e.preventDefault();
        wallWindowDrawPreviewRef.current = null;
        requestAnimationFrame(() => renderRef.current());
        return;
      }
      if (isDrawWallLikeTool(activeTool) && drawingPath && drawingPath.length > 0) {
        e.preventDefault();
        cancelDrawing();
      }
      if (activeTool === "Measure" && measurePath && measurePath.length > 0) {
        e.preventDefault();
        cancelMeasure();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTool, drawingPath, measurePath, cancelDrawing, cancelMeasure, undo, redo]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x: mx, y: my } = clientToCanvasPixel(canvas, e.clientX, e.clientY);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      const worldX = camera.center.x + (mx - cx) / camera.zoom;
      const worldY = camera.center.y - (my - cy) / camera.zoom;

      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newZoom = Math.max(0.01, Math.min(10, camera.zoom * (1 + delta)));

      const newCenterX = worldX - (mx - cx) / newZoom;
      const newCenterY = worldY + (my - cy) / newZoom;

      setCamera({ center: vec2(newCenterX, newCenterY), zoom: newZoom });
    };

    const handlePointerDown = (e: PointerEvent) => {
      canvas.focus({ preventScroll: true });
      if (e.button === 0 && pendingAddShape) {
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        placeAddShape({ x: world.x, y: world.y });
        return;
      }
      if (e.button === 0 && (activeTool === "Draw windows" || activeTool === "Draw doors")) {
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        const tolMm = selectionDistancePx / camera.zoom;
        const hit = hitNearestWallCenterline(stateRef.current.objects, vec2(world.x, world.y), tolMm);
        if (!hit) return;
        const st = stateRef.current;
        const cl = hit.wall.centerline!;
        const gridMm = snapGridStepMm(st.snap);
        const vertexTolMm = snapVertexToleranceMm(st.snap, st.selectionDistancePx, camera.zoom);
        const p0 = snapWallWindowPointerOntoCenterline(cl, hit.point, gridMm, vertexTolMm);
        wallWindowDrawPreviewRef.current = {
          wallId: hit.wall.id,
          start: { x: p0.x, y: p0.y },
          end: { x: p0.x, y: p0.y },
        };
        canvas.setPointerCapture(e.pointerId);
        requestAnimationFrame(() => renderRef.current());
        return;
      }
      if (
        e.button === 0 &&
        !pendingAddShape &&
        !isDrawWallLikeTool(activeTool) &&
        activeTool !== "Draw windows" &&
        activeTool !== "Draw doors"
      ) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        const completed = completedMeasurePath;
        const skipMeasureVertex =
          activeTool === "Measure" && measurePath != null && measurePath.length > 0;
        if (
          completed &&
          completed.length > 0 &&
          !skipMeasureVertex &&
          (activeTool === "Select" || activeTool === "Measure")
        ) {
          const tol = Math.max(selectionDistancePx, 10);
          const vHit = hitTestMeasureVertex(
            completed,
            camera,
            canvas.width,
            canvas.height,
            canvasX,
            canvasY,
            tol
          );
          if (vHit != null) {
            pushHistory(stateRef.current);
            setSelection({
              objectId: null,
              edge: null,
              centerlinePoint: null,
              centerlineSegment: null,
              measureVertexIndex: vHit,
              windowEndpoint: null,
            });
            measurePointDragRef.current = {
              index: vHit,
              startWorld: world,
              startPos: { ...completed[vHit] },
              lock: measureVertexDragLock(completed, vHit),
            };
            canvas.setPointerCapture(e.pointerId);
            return;
          }
        }
      }
      if (e.button === 0 && isDrawWallLikeTool(activeTool)) {
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        const gridMm = snapGridStepMm(snap);
        const tolMm = snapVertexToleranceMm(snap, selectionDistancePx, camera.zoom);
        const snapGrid = (v: number) => (gridMm > 0 ? Math.round(v / gridMm) * gridMm : v);
        const objs = stateRef.current.objects;
        if (!drawingPath || drawingPath.length === 0) {
          const verts = collectAlignmentVertices(objs, null, null);
          let pt = snapWorldPointToGridAndVertices(vec2(world.x, world.y), verts, {
            snapEnabled: snap.enabled,
            gridMm,
            toleranceMm: tolMm,
          });
          const edgeTolMm = selectionDistancePx / Math.max(camera.zoom, 1e-9);
          const edge = snapFreePointToWallEdges(vec2(pt.x, pt.y), objs, edgeTolMm);
          if (edge) {
            pt = edge;
          }
          if (activeTool === "Draw inner wall") {
            if (!hasClosedOuterWallRegion(objs)) {
              window.alert("Draw and close an outer wall before drawing inner walls.");
              return;
            }
            if (!isPointInsideClosedOuterShells(objs, pt)) {
              window.alert("Start the inner wall inside the closed outer wall.");
              return;
            }
          }
          setDrawingPath([{ x: pt.x, y: pt.y }]);
          drawLastClickRef.current = { x: world.x, y: world.y, t: Date.now() };
          return;
        }
        const last = drawingPath[drawingPath.length - 1];
        const isDouble = drawLastClickRef.current &&
          Date.now() - drawLastClickRef.current.t < 400 &&
          Math.hypot(world.x - drawLastClickRef.current.x, world.y - drawLastClickRef.current.y) < 50;
        if (isDouble) {
          completeDrawing();
          drawLastClickRef.current = null;
          return;
        }
        const pt = vec2(snapGrid(world.x), snapGrid(world.y));
        const aligned = snapToAxisAligned(last, pt);
        const verts = collectAlignmentVertices(
          objs,
          drawingPath.map((p) => vec2(p.x, p.y)),
          null
        );
        let snappedGrid =
          gridMm > 0 || tolMm > 0
            ? snapAxisLockedToGridAndVertices(last, aligned, verts, gridMm, tolMm)
            : aligned;
        const edgeTolMm = selectionDistancePx / Math.max(camera.zoom, 1e-9);
        const continueWallSnap = continueWallEdgeSnapFromObjects(
          objs,
          stateRef.current.drawingMergeObjectId
        );
        const edgeSnap = snapAxisLockedPointToWallEdges(
          last,
          snappedGrid,
          objs,
          edgeTolMm,
          continueWallSnap
        );
        if (edgeSnap) {
          snappedGrid = edgeSnap;
        }
        if (activeTool === "Draw inner wall" && !isPointInsideClosedOuterShells(objs, snappedGrid)) {
          return;
        }
        if (snappedGrid.x === last.x && snappedGrid.y === last.y) return;
        if (drawingPath.length >= 2) {
          const prev = drawingPath[drawingPath.length - 2];
          if (isAxisReversingWallSegment(prev, last, snappedGrid)) return;
        }
        appendDrawingPoint({ x: snappedGrid.x, y: snappedGrid.y });
        drawLastClickRef.current = { x: world.x, y: world.y, t: Date.now() };
        return;
      }
      if (e.button === 0 && activeTool === "Measure") {
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        const gridMm = snapGridStepMm(snap);
        const tolMm = snapVertexToleranceMm(snap, selectionDistancePx, camera.zoom);
        const snapGrid = (v: number) => (gridMm > 0 ? Math.round(v / gridMm) * gridMm : v);
        const objs = stateRef.current.objects;
        if (!measurePath || measurePath.length === 0) {
          const verts = collectAlignmentVertices(objs, null, null);
          const pt = snapWorldPointToGridAndVertices(vec2(world.x, world.y), verts, {
            snapEnabled: snap.enabled,
            gridMm,
            toleranceMm: tolMm,
          });
          setMeasurePath([{ x: pt.x, y: pt.y }]);
          measureLastClickRef.current = { x: world.x, y: world.y, t: Date.now() };
          return;
        }
        const last = measurePath[measurePath.length - 1];
        const isDouble =
          measureLastClickRef.current &&
          Date.now() - measureLastClickRef.current.t < 400 &&
          Math.hypot(world.x - measureLastClickRef.current.x, world.y - measureLastClickRef.current.y) < 50;
        if (isDouble) {
          completeMeasure();
          measureLastClickRef.current = null;
          return;
        }
        const pt = vec2(snapGrid(world.x), snapGrid(world.y));
        const aligned = snapToAxisAligned(last, pt);
        const verts = collectAlignmentVertices(
          objs,
          measurePath.map((p) => vec2(p.x, p.y)),
          null
        );
        const snappedGrid =
          gridMm > 0 || tolMm > 0
            ? snapAxisLockedToGridAndVertices(last, aligned, verts, gridMm, tolMm)
            : aligned;
        if (snappedGrid.x === last.x && snappedGrid.y === last.y) return;
        appendMeasurePoint({ x: snappedGrid.x, y: snappedGrid.y });
        measureLastClickRef.current = { x: world.x, y: world.y, t: Date.now() };
        return;
      }
      if (e.button === 1) {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        panStartRef.current = {
          x,
          y,
          centerX: camera.center.x,
          centerY: camera.center.y
        };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;

      const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const canvasX = (e.clientX - rect.left) * scaleX;
      const canvasY = (e.clientY - rect.top) * scaleY;

      if ((activeTool === "Select" || activeTool === "Move") && selection.objectId) {
        const selObj = objects.find((o) => o.id === selection.objectId);
        if (
          selObj &&
          selObj.wallWindowRef &&
          (selObj.itemId === "wall-window" ||
            selObj.itemId === "single-door" ||
            selObj.itemId === "double-door")
        ) {
          const tolerance = Math.max(selectionDistancePx, 12);
          const weHit = hitTestWindowEndpoint(
            objects,
            selection.objectId,
            camera,
            canvas.width,
            canvas.height,
            canvasX,
            canvasY,
            tolerance
          );
          if (weHit) {
            pushHistory(stateRef.current);
            setSelection({
              ...selection,
              centerlinePoint: null,
              centerlineSegment: null,
              measureVertexIndex: null,
              windowEndpoint: weHit,
            });
            windowEndpointDragRef.current = {
              windowId: weHit.objectId,
              which: weHit.which,
            };
            canvas.setPointerCapture(e.pointerId);
            return;
          }
        }
        const obj = objects.find((o) => o.id === selection.objectId);
        const cl = obj?.centerline;
        if (obj && cl && cl.length >= 2 && !isItemObject(obj)) {
          const tolerance = Math.max(selectionDistancePx, 12);
          const centerlineHit = hitTestCenterlinePoint(
            objects,
            selection.objectId,
            camera,
            canvas.width,
            canvas.height,
            canvasX,
            canvasY,
            tolerance
          );
          if (centerlineHit) {
            pushHistory(stateRef.current);
            const i = centerlineHit.pointIndex;
            const segDir = i === 0
              ? { x: cl[1].x - cl[0].x, y: cl[1].y - cl[0].y }
              : { x: cl[i].x - cl[i - 1].x, y: cl[i].y - cl[i - 1].y };
            const len = Math.hypot(segDir.x, segDir.y) || 1;
            segDir.x /= len;
            segDir.y /= len;
            setSelection({
              ...selection,
              centerlinePoint: centerlineHit,
              centerlineSegment: null,
              measureVertexIndex: null,
              windowEndpoint: null,
            });
            centerlineDragRef.current = {
              objectId: centerlineHit.objectId,
              pointIndex: centerlineHit.pointIndex,
              startWorld: world,
              startPos: { ...cl[i] },
              segmentDir: segDir,
            };
            canvas.setPointerCapture(e.pointerId);
            return;
          }
          const segmentHit = hitTestCenterlineSegment(
            objects,
            selection.objectId,
            camera,
            canvas.width,
            canvas.height,
            canvasX,
            canvasY,
            tolerance
          );
          if (segmentHit) {
            pushHistory(stateRef.current);
            const i = segmentHit.segmentIndex;
            const dx = cl[i + 1].x - cl[i].x;
            const dy = cl[i + 1].y - cl[i].y;
            const len = Math.hypot(dx, dy) || 1;
            const perpX = dy / len;
            const perpY = -dx / len;
            setSelection({
              ...selection,
              centerlinePoint: null,
              centerlineSegment: segmentHit,
              measureVertexIndex: null,
              windowEndpoint: null,
            });
            centerlineSegmentDragRef.current = {
              objectId: segmentHit.objectId,
              segmentIndex: segmentHit.segmentIndex,
              startWorld: world,
              perpDir: { x: perpX, y: perpY },
              lastDelta: { x: 0, y: 0 },
            };
            canvas.setPointerCapture(e.pointerId);
            return;
          }
        }
      }

      if (activeTool === "Rotate" && selection.objectId && !selection.edge) {
        const obj = objects.find((o) => o.id === selection.objectId);
        if (obj) {
          const manip = getRotateManipulatorForObject(obj);
          if (manip) {
            const { x: px, y: py } = clientToCanvasPixel(canvas, e.clientX, e.clientY);
            const cx = canvas.width / 2;
            const cy = canvas.height / 2;
            const hs = {
              x: cx + (manip.handleWorld.x - camera.center.x) * camera.zoom,
              y: cy - (manip.handleWorld.y - camera.center.y) * camera.zoom,
            };
            if (Math.hypot(px - hs.x, py - hs.y) <= 14) {
              pushHistory(stateRef.current);
              rotateDragRef.current = {
                objectId: obj.id,
                initialObjects: JSON.parse(JSON.stringify(objects)) as VectorObject[],
                centerWorld: manip.center,
                startAngleRad: Math.atan2(world.y - manip.center.y, world.x - manip.center.x),
              };
              canvas.setPointerCapture(e.pointerId);
              return;
            }
          }
        }
      }

      if (activeTool === "Extrude" && selection.edge) {
        const hit = hitTestEdges(objects, camera, vec2(world.x, world.y), selectionDistancePx);
        const sameEdge =
          hit &&
          hit.objectId === selection.edge.objectId &&
          hit.polygonId === selection.edge.polygonId &&
          hit.edgeIndex === selection.edge.edgeIndex;
        if (sameEdge) {
          extrudeDragRef.current = {
            startWorld: world,
            edgeRef: selection.edge,
            lastDistanceMm: 0
          };
          setExtrudePreview({ edgeRef: selection.edge, distanceMm: 0 });
          canvas.setPointerCapture(e.pointerId);
        }
      }

      if (activeTool === "Move") {
        if (selection.edge) {
          const hit = hitTestEdges(objects, camera, vec2(world.x, world.y), selectionDistancePx);
          const sameEdge =
            hit &&
            hit.objectId === selection.edge.objectId &&
            hit.polygonId === selection.edge.polygonId &&
            hit.edgeIndex === selection.edge.edgeIndex;
          if (sameEdge) {
            pushHistory(stateRef.current);
            moveDragRef.current = {
              type: "edge",
              startWorld: world,
              initialObjects: JSON.parse(JSON.stringify(objects)) as VectorObject[],
              edgeRef: selection.edge,
            };
            canvas.setPointerCapture(e.pointerId);
          }
        } else if (selection.objectId) {
          const hitId = hitTestObjectAtPoint(objects, vec2(world.x, world.y));
          if (hitId === selection.objectId) {
            pushHistory(stateRef.current);
            moveDragRef.current = {
              type: "shape",
              startWorld: world,
              initialObjects: JSON.parse(JSON.stringify(objects)) as VectorObject[],
              objectId: selection.objectId,
            };
            canvas.setPointerCapture(e.pointerId);
          }
        }
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (windowEndpointDragRef.current) {
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        const ref = windowEndpointDragRef.current;
        updateWallWindowEndpointDrag(ref.windowId, ref.which, vec2(world.x, world.y));
        return;
      }
      if (wallWindowDrawPreviewRef.current) {
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        const ref = wallWindowDrawPreviewRef.current;
        const wall = stateRef.current.objects.find((o) => o.id === ref.wallId);
        if (!wall?.centerline) return;
        const st = stateRef.current;
        const gridMm = snapGridStepMm(st.snap);
        const vertexTolMm = snapVertexToleranceMm(st.snap, st.selectionDistancePx, camera.zoom);
        const end = snapWallWindowPointerOntoCenterline(
          wall.centerline,
          vec2(world.x, world.y),
          gridMm,
          vertexTolMm
        );
        wallWindowDrawPreviewRef.current = {
          wallId: ref.wallId,
          start: ref.start,
          end: { x: end.x, y: end.y },
        };
        requestAnimationFrame(() => renderRef.current());
        return;
      }
      if (rotateDragRef.current) {
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        const ref = rotateDragRef.current;
        const angleNow = Math.atan2(world.y - ref.centerWorld.y, world.x - ref.centerWorld.x);
        const deltaRad = angleDeltaRad(ref.startAngleRad, angleNow);
        let deltaDeg = (deltaRad * 180) / Math.PI;
        deltaDeg = snapAngleDeg(deltaDeg, ROTATE_SNAP_DEG_DEFAULT);
        applyRotateObjectFromSnapshot(ref.initialObjects, ref.objectId, ref.centerWorld, deltaDeg);
        return;
      }
      if (measurePointDragRef.current) {
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        const ref = measurePointDragRef.current;
        const dx = world.x - ref.startWorld.x;
        const dy = world.y - ref.startWorld.y;
        const proposed = { x: ref.startPos.x + dx, y: ref.startPos.y + dy };
        const st = stateRef.current;
        const completed = st.completedMeasurePath ?? [];
        const extras = completed
          .filter((_, i) => i !== ref.index)
          .map((p) => vec2(p.x, p.y));
        const verts = collectAlignmentVertices(st.objects, extras, null);
        const gridMm = snapGridStepMm(st.snap);
        const tolMm = snapVertexToleranceMm(st.snap, st.selectionDistancePx, camera.zoom);
        let nx: number;
        let ny: number;
        const { lock } = ref;
        if (lock.kind === "horizontal") {
          nx = snapWorldXToGridAndVertices(proposed.x, verts, gridMm, tolMm, st.snap.enabled);
          ny = lock.fixedY;
        } else if (lock.kind === "vertical") {
          nx = lock.fixedX;
          ny = snapWorldYToGridAndVertices(proposed.y, verts, gridMm, tolMm, st.snap.enabled);
        } else {
          const snapGrid = (v: number) => (gridMm > 0 ? Math.round(v / gridMm) * gridMm : v);
          const pt = vec2(snapGrid(proposed.x), snapGrid(proposed.y));
          const aligned = snapToAxisAligned(ref.startPos, pt);
          const snapped =
            gridMm > 0 || tolMm > 0
              ? snapAxisLockedToGridAndVertices(ref.startPos, aligned, verts, gridMm, tolMm)
              : aligned;
          nx = snapped.x;
          ny = snapped.y;
        }
        updateCompletedMeasurePoint(ref.index, { x: nx, y: ny });
        return;
      }
      if (centerlineSegmentDragRef.current) {
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        const ref = centerlineSegmentDragRef.current;
        const dx = world.x - ref.startWorld.x;
        const dy = world.y - ref.startWorld.y;
        const scalar = dx * ref.perpDir.x + dy * ref.perpDir.y;
        const totalDelta = { x: ref.perpDir.x * scalar, y: ref.perpDir.y * scalar };
        const incr = {
          x: totalDelta.x - ref.lastDelta.x,
          y: totalDelta.y - ref.lastDelta.y,
        };
        ref.lastDelta = totalDelta;
        updateCenterlineSegment(ref.objectId, ref.segmentIndex, incr);
        return;
      }
      if (centerlineDragRef.current) {
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        const { objectId, pointIndex, startWorld, startPos, segmentDir } = centerlineDragRef.current;
        const dx = world.x - startWorld.x;
        const dy = world.y - startWorld.y;
        const scalar = dx * segmentDir.x + dy * segmentDir.y;
        const newPos = {
          x: startPos.x + segmentDir.x * scalar,
          y: startPos.y + segmentDir.y * scalar,
        };
        updateCenterlinePoint(objectId, pointIndex, newPos);
        return;
      }
      if (pendingAddShape) {
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        const st = stateRef.current;
        const gridMm = snapGridStepMm(st.snap);
        const tolMm = snapVertexToleranceMm(st.snap, st.selectionDistancePx, camera.zoom);
        const verts = collectAlignmentVertices(st.objects, null, null);
        const p = snapWorldPointToGridAndVertices(vec2(world.x, world.y), verts, {
          snapEnabled: st.snap.enabled,
          gridMm,
          toleranceMm: tolMm,
        });
        setAddShapePreviewWorld({ x: p.x, y: p.y });
        return;
      }
      if (isDrawWallLikeTool(activeTool)) {
        const scheduleDraw = () => requestAnimationFrame(() => renderRef.current());
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        const gridMm = snapGridStepMm(snap);
        const tolMm = snapVertexToleranceMm(snap, selectionDistancePx, camera.zoom);
        const snapGrid = (v: number) => (gridMm > 0 ? Math.round(v / gridMm) * gridMm : v);
        const objs = stateRef.current.objects;
        const drawingPathNow = stateRef.current.drawingPath;

        if (!drawingPathNow || drawingPathNow.length === 0) {
          const verts = collectAlignmentVertices(objs, null, null);
          let pt = snapWorldPointToGridAndVertices(vec2(world.x, world.y), verts, {
            snapEnabled: snap.enabled,
            gridMm,
            toleranceMm: tolMm,
          });
          const edgeTolMm = selectionDistancePx / Math.max(camera.zoom, 1e-9);
          const edge = snapFreePointToWallEdges(vec2(pt.x, pt.y), objs, edgeTolMm);
          if (edge) {
            pt = edge;
          }
          if (activeTool === "Draw inner wall") {
            if (!hasClosedOuterWallRegion(objs) || !isPointInsideClosedOuterShells(objs, pt)) {
              drawWallCursorWorldRef.current = null;
              scheduleDraw();
              return;
            }
          }
          drawWallCursorWorldRef.current = { x: pt.x, y: pt.y };
          scheduleDraw();
        } else {
          const last = drawingPathNow[drawingPathNow.length - 1];
          const pt = vec2(snapGrid(world.x), snapGrid(world.y));
          const aligned = snapToAxisAligned(last, pt);
          const verts = collectAlignmentVertices(
            objs,
            drawingPathNow.map((p) => vec2(p.x, p.y)),
            null
          );
          let preview =
            gridMm > 0 || tolMm > 0
              ? snapAxisLockedToGridAndVertices(last, aligned, verts, gridMm, tolMm)
              : aligned;
          const edgeTolMm = selectionDistancePx / Math.max(camera.zoom, 1e-9);
          const continueWallSnap = continueWallEdgeSnapFromObjects(
            objs,
            stateRef.current.drawingMergeObjectId
          );
          const edgeSnap = snapAxisLockedPointToWallEdges(
            last,
            preview,
            objs,
            edgeTolMm,
            continueWallSnap
          );
          if (edgeSnap) {
            preview = edgeSnap;
          }
          if (activeTool === "Draw inner wall") {
            if (!hasClosedOuterWallRegion(objs) || !isPointInsideClosedOuterShells(objs, preview)) {
              drawWallCursorWorldRef.current = null;
              setDrawPreviewWorld(null);
              scheduleDraw();
              return;
            }
          }
          if (preview.x === last.x && preview.y === last.y) {
            drawWallCursorWorldRef.current = null;
            setDrawPreviewWorld(null);
            scheduleDraw();
            return;
          }
          if (drawingPathNow.length >= 2) {
            const prev = drawingPathNow[drawingPathNow.length - 2];
            if (isAxisReversingWallSegment(prev, last, preview)) {
              drawWallCursorWorldRef.current = null;
              setDrawPreviewWorld(null);
              scheduleDraw();
              return;
            }
          }
          drawWallCursorWorldRef.current = preview;
          setDrawPreviewWorld(preview);
          scheduleDraw();
          return;
        }
      }
      if (activeTool === "Measure" && measurePath && measurePath.length > 0) {
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        const last = measurePath[measurePath.length - 1];
        const gridMm = snapGridStepMm(snap);
        const tolMm = snapVertexToleranceMm(snap, selectionDistancePx, camera.zoom);
        const snapGrid = (v: number) => (gridMm > 0 ? Math.round(v / gridMm) * gridMm : v);
        const objs = stateRef.current.objects;
        const pt = vec2(snapGrid(world.x), snapGrid(world.y));
        const aligned = snapToAxisAligned(last, pt);
        const verts = collectAlignmentVertices(
          objs,
          measurePath.map((p) => vec2(p.x, p.y)),
          null
        );
        const preview =
          gridMm > 0 || tolMm > 0
            ? snapAxisLockedToGridAndVertices(last, aligned, verts, gridMm, tolMm)
            : aligned;
        setMeasurePreviewWorld(preview);
        return;
      }
      if (panStartRef.current) {
        e.preventDefault();
      }
      if (moveDragRef.current) {
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        const { startWorld, type, initialObjects } = moveDragRef.current;
        const dx = world.x - startWorld.x;
        const dy = world.y - startWorld.y;
        if (type === "edge" && moveDragRef.current.edgeRef) {
          const edgeRef = moveDragRef.current.edgeRef;
          const obj = initialObjects.find((o) => o.id === edgeRef.objectId);
          const poly = obj?.polygons.find((p) => p.id === edgeRef.polygonId);
          const verts = poly ? getPolygonContour(poly, edgeRef.holeIndex) : undefined;
          const n = verts && verts.length >= 2 ? getOutwardNormal(verts, edgeRef.edgeIndex) : { x: 0, y: 0 };
          const dist = dx * n.x + dy * n.y;
          const perpDelta = { x: n.x * dist, y: n.y * dist };
          applyMoveEdgeFromSnapshot(initialObjects, edgeRef, perpDelta);
        } else if (type === "shape" && moveDragRef.current.objectId) {
          applyMoveObjectFromSnapshot(initialObjects, moveDragRef.current.objectId, { x: dx, y: dy });
        }
        return;
      }
      if (extrudeDragRef.current) {
        const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
        const { startWorld, edgeRef } = extrudeDragRef.current;
        const obj = objects.find((o) => o.id === edgeRef.objectId);
        const poly = obj?.polygons.find((p) => p.id === edgeRef.polygonId);
        const verts = poly ? getPolygonContour(poly, edgeRef.holeIndex) : undefined;
        if (verts && verts.length >= 2) {
          const n = getOutwardNormal(verts, edgeRef.edgeIndex);
          const dx = world.x - startWorld.x;
          const dy = world.y - startWorld.y;
          let distanceMm = Math.round(dx * n.x + dy * n.y);
          {
            const grid = snapGridStepMm(snap);
            if (grid > 0) {
              distanceMm = Math.round(distanceMm / grid) * grid;
            }
          }
          extrudeDragRef.current.lastDistanceMm = distanceMm;
          setExtrudePreview({ edgeRef, distanceMm });
        }
        return;
      }
      if (!panStartRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      const dx = (x - panStartRef.current.x) / camera.zoom;
      const dy = -(y - panStartRef.current.y) / camera.zoom;

      setCamera({
        center: vec2(panStartRef.current.centerX - dx, panStartRef.current.centerY - dy)
      });
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.button === 1) {
        panStartRef.current = null;
        canvas.releasePointerCapture(e.pointerId);
        return;
      }
      if (e.button === 0) {
        if (windowEndpointDragRef.current) {
          windowEndpointDragRef.current = null;
          try {
            canvas.releasePointerCapture(e.pointerId);
          } catch {
            /* */
          }
          return;
        }
        if (wallWindowDrawPreviewRef.current) {
          const r = wallWindowDrawPreviewRef.current;
          wallWindowDrawPreviewRef.current = null;
          try {
            canvas.releasePointerCapture(e.pointerId);
          } catch {
            /* already released */
          }
          if (activeTool === "Draw doors") {
            placeWallDoor(r.wallId, vec2(r.start.x, r.start.y), vec2(r.end.x, r.end.y));
          } else {
            placeWallWindow(r.wallId, r.start, r.end);
          }
          requestAnimationFrame(() => renderRef.current());
          return;
        }
        if (centerlineSegmentDragRef.current) {
          centerlineSegmentDragRef.current = null;
          canvas.releasePointerCapture(e.pointerId);
          return;
        }
        if (centerlineDragRef.current) {
          centerlineDragRef.current = null;
          canvas.releasePointerCapture(e.pointerId);
          return;
        }
        if (measurePointDragRef.current) {
          measurePointDragRef.current = null;
          canvas.releasePointerCapture(e.pointerId);
          return;
        }
        if (rotateDragRef.current) {
          rotateDragRef.current = null;
          canvas.releasePointerCapture(e.pointerId);
        } else if (moveDragRef.current) {
          moveDragRef.current = null;
          canvas.releasePointerCapture(e.pointerId);
        } else if (extrudeDragRef.current) {
          const { edgeRef, lastDistanceMm } = extrudeDragRef.current;
          if (lastDistanceMm !== 0) {
            applyExtrude(edgeRef, lastDistanceMm);
          }
          setExtrudePreview(null);
          extrudeDragRef.current = null;
          canvas.releasePointerCapture(e.pointerId);
        } else if (
          activeTool === "Select" ||
          activeTool === "Extrude" ||
          activeTool === "Move" ||
          activeTool === "Rotate"
        ) {
          const world = screenToWorld(canvas, camera, e.clientX, e.clientY);
          if (selection.edge && selection.objectId) {
            const obj = objects.find((o) => o.id === selection.objectId);
            if (obj) {
              let insideBody = false;
              for (const poly of obj.polygons) {
                if (poly.verts.length >= 3 && pointInPolygon(world, poly.verts)) {
                  let inHole = false;
                  for (const hole of poly.holes ?? []) {
                    if (hole.length >= 3 && pointInPolygon(world, hole)) {
                      inHole = true;
                      break;
                    }
                  }
                  if (!inHole) {
                    insideBody = true;
                    break;
                  }
                }
              }
              if (insideBody) {
                setSelection({
                  objectId: selection.objectId,
                  edge: null,
                  centerlinePoint: null,
                  centerlineSegment: null,
                  measureVertexIndex: null,
                  windowEndpoint: null,
                });
                return;
              }
            }
          }
          const edgeHit = hitTestEdges(objects, camera, vec2(world.x, world.y), selectionDistancePx);
          const hitObj = edgeHit ? objects.find((o) => o.id === edgeHit.objectId) : null;
          const edgeOnItem = edgeHit && hitObj && isItemObject(hitObj);
          if (edgeHit && !edgeOnItem) {
            setSelection({
              objectId: edgeHit.objectId,
              edge: edgeHit,
              centerlinePoint: null,
              centerlineSegment: null,
              measureVertexIndex: null,
              windowEndpoint: null,
            });
          } else {
            const objectHit = hitTestObjectAtPoint(objects, vec2(world.x, world.y));
            if (objectHit) {
              const obj = objects.find((o) => o.id === objectHit);
              setSelection({
                objectId: objectHit,
                edge: obj && isItemObject(obj) ? null : (edgeHit ?? null),
                centerlinePoint: null,
                centerlineSegment: null,
                measureVertexIndex: null,
                windowEndpoint: null,
              });
            } else {
              setSelection({
                objectId: null,
                edge: null,
                centerlinePoint: null,
                centerlineSegment: null,
                measureVertexIndex: null,
                windowEndpoint: null,
              });
            }
          }
        }
      }
    };

    const handlePointerLeave = () => {
      measurePointDragRef.current = null;
      centerlineDragRef.current = null;
      centerlineSegmentDragRef.current = null;
      windowEndpointDragRef.current = null;
      if (pendingAddShape) {
        setAddShapePreviewWorld(null);
      }
      if (isDrawWallLikeTool(activeTool)) {
        setDrawPreviewWorld(null);
        drawWallCursorWorldRef.current = null;
        requestAnimationFrame(() => renderRef.current());
      }
      if (activeTool === "Measure") {
        setMeasurePreviewWorld(null);
      }
      wallWindowDrawPreviewRef.current = null;
      if (activeTool === "Draw windows" || activeTool === "Draw doors") {
        requestAnimationFrame(() => renderRef.current());
      }
      if (extrudeDragRef.current) {
        setExtrudePreview(null);
        extrudeDragRef.current = null;
      }
      moveDragRef.current = null;
      rotateDragRef.current = null;
      panStartRef.current = null;
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerLeave);

    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [
    camera,
    activeTool,
    objects,
    selection,
    snap,
    selectionDistancePx,
    pendingAddShape,
    drawingPath,
    measurePath,
    completedMeasurePath,
    isItemObject,
    setCamera,
    setSelection,
    setExtrudePreview,
    applyExtrude,
    applyMoveEdgeFromSnapshot,
    applyMoveObjectFromSnapshot,
    applyRotateObjectFromSnapshot,
    setAddShapePreviewWorld,
    placeAddShape,
    placeWallWindow,
    placeWallDoor,
    setDrawingPath,
    appendDrawingPoint,
    setDrawPreviewWorld,
    completeDrawing,
    setMeasurePath,
    appendMeasurePoint,
    setMeasurePreviewWorld,
    completeMeasure,
    cancelMeasure,
    updateWallWindowEndpointDrag,
    updateCenterlinePoint,
    updateCenterlineSegment,
    pushHistory,
  ]);

  const cameraHudLine = getCameraStatsLine(camera, viewportSize);

  return (
    <div className="editor-canvas-root">
      <canvas ref={canvasRef} tabIndex={0} />
      <div
        className="editor-canvas-camera-hud"
        title={CAMERA_STATS_TITLE}
        aria-label={`Camera: ${cameraHudLine}`}
      >
        {cameraHudLine}
      </div>
    </div>
  );
}
