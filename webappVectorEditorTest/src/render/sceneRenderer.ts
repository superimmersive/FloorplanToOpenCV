import {
  type DocumentState,
  isDrawWallLikeTool,
  snapGridStepMm,
  snapVertexToleranceMm,
  DEFAULT_SELECTION_DISTANCE_PX,
} from "../state/editorState";
import type { Camera2D, Vec2, DoorHanding, DoorSwing } from "../geometry/types";
import { getPolygonContour } from "../geometry/types";
import { getOutwardNormal } from "../geometry/extrude";
import { pathToPolygon, pathToPolygonForStairs } from "../geometry/drawPath";
import { effectiveWallDrawWidthMm } from "../geometry/wallDrawWidth";
import { renderGrid } from "./gridRenderer";
import { getItemImageUrl } from "../items/itemImages";
import { doorPlacedWidthMm, doorCatalogSummary } from "../items/doorSizes";
import { getRotateManipulatorForObject } from "../geometry/rotateShape";
import {
  normalizeWallWindowRef,
  pointAtDistanceAlongPolyline,
  distanceAlongPolylineToPoint,
  buildWindowPolygonAlongCenterlineSpan,
  spinePointsBetweenAlong,
  snapWallWindowPointerOntoCenterline,
  MIN_WALL_WINDOW_SPAN_MM,
} from "../geometry/wallWindow";
import { computeWallDoorPreviewSpan } from "../geometry/doorDrawPreview";
import { displayRoomLabel, listRoomsFromObjects } from "../geometry/rooms";

function worldToScreen(camera: Camera2D, width: number, height: number, p: Vec2): { x: number; y: number } {
  const cx = width / 2;
  const cy = height / 2;

  return {
    x: cx + (p.x - camera.center.x) * camera.zoom,
    y: cy - (p.y - camera.center.y) * camera.zoom
  };
}

const DEFAULT_OBJECT_COLOR = "#94a3b8";

/** Arrow length in mm for item direction indicator (half of 100 mm item box). */
const ITEM_DIRECTION_ARROW_LENGTH_MM = 50;

function rotateVec2(v: Vec2, deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Average of polygon vertices (world mm). */
function polygonCentroidMm(verts: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const v of verts) {
    x += v.x;
    y += v.y;
  }
  const n = verts.length;
  return { x: x / n, y: y / n };
}

/**
 * Stretch image to the item square, clipped to the polygon, rotated with `rotationDeg` (same as geometry).
 * SVG colours are drawn as-is (no tint). Asset is left-hand / inswing; mirror for right-hand; Y-mirror for outswing (hinge-pivot path included).
 */
function renderItemImageClippedToPolygon(
  ctx: CanvasRenderingContext2D,
  camera: Camera2D,
  width: number,
  height: number,
  verts: Vec2[],
  img: HTMLImageElement,
  doorHanding: DoorHanding = "left",
  doorSwing: DoorSwing = "in",
  rotationDeg: number,
  halfSideMm: number,
  /** Pivot at hinge (verts[0]–verts[1] midpoint on wall spine); swing side is encoded in geometry. */
  hingePivot = false
) {
  if (verts.length < 3) return;
  ctx.save();
  ctx.beginPath();
  const first = worldToScreen(camera, width, height, verts[0]);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < verts.length; i++) {
    const s = worldToScreen(camera, width, height, verts[i]);
    ctx.lineTo(s.x, s.y);
  }
  ctx.closePath();
  ctx.clip();

  if (halfSideMm <= 0 || img.naturalWidth <= 0) {
    ctx.restore();
    return;
  }

  const center = polygonCentroidMm(verts);
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const s0 = worldToScreen(camera, width, height, center);
  const sx = worldToScreen(camera, width, height, {
    x: center.x + halfSideMm * c,
    y: center.y + halfSideMm * s,
  });
  const sy = worldToScreen(camera, width, height, {
    x: center.x - halfSideMm * s,
    y: center.y + halfSideMm * c,
  });
  const halfWpx = Math.hypot(sx.x - s0.x, sx.y - s0.y);
  const halfHpx = Math.hypot(sy.x - s0.x, sy.y - s0.y);
  if (halfWpx <= 0 || halfHpx <= 0) {
    ctx.restore();
    return;
  }

  const screenAngle = Math.atan2(sx.y - s0.y, sx.x - s0.x);
  const flipX = doorHanding === "right";
  const flipY = doorSwing === "out";

  if (hingePivot && verts.length >= 4) {
    const hingeMidW = {
      x: (verts[0].x + verts[1].x) / 2,
      y: (verts[0].y + verts[1].y) / 2,
    };
    const h0 = worldToScreen(camera, width, height, verts[0]);
    const h1 = worldToScreen(camera, width, height, verts[1]);
    const hingeMid = worldToScreen(camera, width, height, hingeMidW);
    const screenAngleU = Math.atan2(h1.y - h0.y, h1.x - h0.x);
    const dx = s0.x - hingeMid.x;
    const dy = s0.y - hingeMid.y;
    const cu = Math.cos(screenAngleU);
    const su = Math.sin(screenAngleU);
    const localX = dx * cu + dy * su;
    const localY = -dx * su + dy * cu;

    ctx.translate(hingeMid.x, hingeMid.y);
    ctx.rotate(screenAngleU);
    ctx.translate(localX, localY);
    ctx.rotate(screenAngle - screenAngleU);
    if (flipX || flipY) {
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    }
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, -halfWpx, -halfHpx, 2 * halfWpx, 2 * halfHpx);
    ctx.restore();
    return;
  }

  ctx.translate(s0.x, s0.y);
  ctx.rotate(screenAngle);
  if (flipX || flipY) {
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  }
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, -halfWpx, -halfHpx, 2 * halfWpx, 2 * halfHpx);
  ctx.restore();
}

/** Draw direction arrow for item objects (from center toward itemDirectionDeg, then object rotation). */
function renderItemDirection(
  ctx: CanvasRenderingContext2D,
  camera: Camera2D,
  width: number,
  height: number,
  position: Vec2,
  rotationDeg: number,
  itemDirectionDeg: number,
  color: string,
  /** Doors: mirror arrow across wall line in local space (same side as texture flip for outswing). */
  doorSwing?: DoorSwing
) {
  const d = (itemDirectionDeg * Math.PI) / 180;
  let lx = Math.cos(d);
  let ly = Math.sin(d);
  if (doorSwing === "out") {
    ly = -ly;
  }
  const localDir: Vec2 = { x: lx, y: ly };
  const worldDir = rotateVec2(localDir, rotationDeg);
  const end: Vec2 = {
    x: position.x + ITEM_DIRECTION_ARROW_LENGTH_MM * worldDir.x,
    y: position.y + ITEM_DIRECTION_ARROW_LENGTH_MM * worldDir.y,
  };
  const startScreen = worldToScreen(camera, width, height, position);
  const endScreen = worldToScreen(camera, width, height, end);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(startScreen.x, startScreen.y);
  ctx.lineTo(endScreen.x, endScreen.y);
  ctx.stroke();

  const headLen = 8;
  const angle = Math.atan2(endScreen.y - startScreen.y, endScreen.x - startScreen.x);
  const headTip = endScreen;
  const headLeft = {
    x: headTip.x - headLen * Math.cos(angle - Math.PI / 6),
    y: headTip.y - headLen * Math.sin(angle - Math.PI / 6),
  };
  const headRight = {
    x: headTip.x - headLen * Math.cos(angle + Math.PI / 6),
    y: headTip.y - headLen * Math.sin(angle + Math.PI / 6),
  };
  ctx.beginPath();
  ctx.moveTo(headTip.x, headTip.y);
  ctx.lineTo(headLeft.x, headLeft.y);
  ctx.lineTo(headRight.x, headRight.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Parse hex #rrggbb or #rgb to rgba string. */
function hexToRgba(hex: string, a: number): string {
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
    ?? hex.match(/^#?([a-f\d])([a-f\d])([a-f\d])$/i);
  if (!match) return `rgba(148, 163, 184, ${a})`;
  let r = parseInt(match[1], 16);
  let g = parseInt(match[2], 16);
  let b = parseInt(match[3], 16);
  if (match[1].length === 1) {
    r = r * 17;
    g = g * 17;
    b = b * 17;
  }
  return `rgba(${r},${g},${b},${a})`;
}

/** Draw edge length labels for all edges, offset perpendicular outward by offsetMm. */
function renderEdgeMeasurements(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  objects: DocumentState["objects"],
  camera: DocumentState["camera"],
  offsetMm: number
) {
  ctx.save();
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e5e7eb";

  for (const obj of objects) {
    for (const poly of obj.polygons) {
      // Outer contour
      const outerVerts = poly.verts;
      for (let i = 0; i < outerVerts.length; i++) {
        const a = outerVerts[i];
        const b = outerVerts[(i + 1) % outerVerts.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) continue;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const n = getOutwardNormal(outerVerts, i);
        const labelPos = { x: mid.x + n.x * offsetMm, y: mid.y + n.y * offsetMm };
        const screen = worldToScreen(camera, width, height, labelPos);
        ctx.fillText(`${len.toFixed(1)} mm`, screen.x, screen.y);
      }
      // Holes
      const holes = poly.holes ?? [];
      for (let hi = 0; hi < holes.length; hi++) {
        const hole = holes[hi];
        for (let i = 0; i < hole.length; i++) {
          const a = hole[i];
          const b = hole[(i + 1) % hole.length];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy);
          if (len < 1e-6) continue;
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const n = getOutwardNormal(hole, i);
          const labelPos = { x: mid.x + n.x * offsetMm, y: mid.y + n.y * offsetMm };
          const screen = worldToScreen(camera, width, height, labelPos);
          ctx.fillText(`${len.toFixed(1)} mm`, screen.x, screen.y);
        }
      }
    }
  }

  ctx.restore();
}

/** Cache of loaded images by URL (for floor plan layer). */
export type ImageCache = Map<string, HTMLImageElement>;

function renderReferenceImages(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  layers: DocumentState["layers"],
  camera: Camera2D,
  imageCache: ImageCache
) {
  for (const layer of layers) {
    if (layer.type !== "image" || layer.visible === false || !layer.imageUrl) continue;
    const img = imageCache.get(layer.imageUrl);
    if (!img || !img.naturalWidth) continue;
    const center = layer.imagePosition ?? { x: 0, y: 0 };
    const opacity = layer.imageOpacity ?? 0.6;
    const wMm =
      layer.imageWidthMm != null && layer.imageWidthMm > 0 && img.naturalWidth > 0
        ? layer.imageWidthMm
        : img.naturalWidth * (layer.imageScaleMmPerPixel ?? 1);
    const hMm =
      layer.imageWidthMm != null && layer.imageWidthMm > 0 && img.naturalWidth > 0
        ? (layer.imageWidthMm * img.naturalHeight) / img.naturalWidth
        : img.naturalHeight * (layer.imageScaleMmPerPixel ?? 1);
    const halfW = wMm / 2;
    const halfH = hMm / 2;
    const topLeft = worldToScreen(camera, width, height, { x: center.x - halfW, y: center.y + halfH });
    const bottomRight = worldToScreen(camera, width, height, { x: center.x + halfW, y: center.y - halfH });
    const destX = topLeft.x;
    const destY = topLeft.y;
    const destW = bottomRight.x - topLeft.x;
    const destH = bottomRight.y - topLeft.y;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, destX, destY, destW, destH);
    ctx.restore();
  }
}

function fmtMeasureMm(mm: number): string {
  if (mm >= 100) return mm.toFixed(0);
  if (mm >= 10) return mm.toFixed(1);
  return mm.toFixed(2);
}

/** Same pill + typography as measure segment labels ({@link renderMeasureOverlay}). */
function drawMeasureStylePillLabel(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  text: string,
  fg = "#fef3c7"
) {
  ctx.save();
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
  ctx.fillRect(screenX - tw / 2 - 4, screenY - 7, tw + 8, 14);
  ctx.fillStyle = fg;
  ctx.fillText(text, screenX, screenY);
  ctx.restore();
}

/** Measure tool: polyline with per-segment labels and running total (mm). */
function renderMeasureOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: DocumentState["camera"],
  measurePath: { x: number; y: number }[],
  measurePreviewWorld: { x: number; y: number } | null,
  selectedVertexIndex: number | null = null
) {
  const pathLen = measurePath.length;
  if (pathLen === 0) return;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const stroke = "rgba(251, 191, 36, 0.95)";
  const fillPt = "#fbbf24";
  const labelBg = "rgba(15, 23, 42, 0.88)";
  const labelFg = "#fef3c7";

  for (let i = 0; i < pathLen - 1; i++) {
    const a = measurePath[i];
    const b = measurePath[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const sa = worldToScreen(camera, width, height, a);
    const sb = worldToScreen(camera, width, height, b);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();

    const midWorld = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const mid = worldToScreen(camera, width, height, midWorld);
    const dx = sb.x - sa.x;
    const dy = sb.y - sa.y;
    const el = Math.hypot(dx, dy) || 1;
    const ox = (-dy / el) * 12;
    const oy = (dx / el) * 12;
    const lx = mid.x + ox;
    const ly = mid.y + oy;
    const text = `${fmtMeasureMm(segLen)} mm`;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = labelBg;
    ctx.fillRect(lx - tw / 2 - 4, ly - 7, tw + 8, 14);
    ctx.fillStyle = labelFg;
    ctx.fillText(text, lx, ly);
  }

  if (measurePreviewWorld && pathLen >= 1) {
    const last = measurePath[pathLen - 1];
    const pv = measurePreviewWorld;
    const segLen = Math.hypot(pv.x - last.x, pv.y - last.y);
    const sl = worldToScreen(camera, width, height, last);
    const sp = worldToScreen(camera, width, height, pv);
    ctx.strokeStyle = "rgba(251, 191, 36, 0.65)";
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sl.x, sl.y);
    ctx.lineTo(sp.x, sp.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const midWorld = { x: (last.x + pv.x) / 2, y: (last.y + pv.y) / 2 };
    const mid = worldToScreen(camera, width, height, midWorld);
    const dx = sp.x - sl.x;
    const dy = sp.y - sl.y;
    const el = Math.hypot(dx, dy) || 1;
    const ox = (-dy / el) * 12;
    const oy = (dx / el) * 12;
    const lx = mid.x + ox;
    const ly = mid.y + oy;
    const text = `${fmtMeasureMm(segLen)} mm`;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = labelBg;
    ctx.fillRect(lx - tw / 2 - 4, ly - 7, tw + 8, 14);
    ctx.fillStyle = "#a8a29e";
    ctx.fillText(text, lx, ly);
  }

  for (let i = 0; i < pathLen; i++) {
    const p = measurePath[i];
    const s = worldToScreen(camera, width, height, p);
    const sel = selectedVertexIndex === i;
    ctx.fillStyle = sel ? "#fff" : fillPt;
    ctx.beginPath();
    ctx.arc(s.x, s.y, sel ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
    if (sel) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  let running = 0;
  for (let i = 1; i < pathLen; i++) {
    running += Math.hypot(
      measurePath[i].x - measurePath[i - 1].x,
      measurePath[i].y - measurePath[i - 1].y
    );
  }
  if (measurePreviewWorld && pathLen >= 1) {
    const last = measurePath[pathLen - 1];
    running += Math.hypot(measurePreviewWorld.x - last.x, measurePreviewWorld.y - last.y);
  }

  if (pathLen >= 2 || (pathLen >= 1 && measurePreviewWorld)) {
    const anchor = measurePath[pathLen - 1];
    const sa = worldToScreen(camera, width, height, anchor);
    const totalText = `Σ ${fmtMeasureMm(running)} mm`;
    ctx.textAlign = "left";
    const tw = ctx.measureText(totalText).width;
    ctx.fillStyle = labelBg;
    ctx.fillRect(sa.x + 8, sa.y - 24, tw + 8, 16);
    ctx.fillStyle = labelFg;
    ctx.fillText(totalText, sa.x + 12, sa.y - 16);
  }

  ctx.restore();
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: DocumentState,
  imageCache?: ImageCache,
  /** Snapped world position for Draw wall pointer dot (not in React state). */
  drawWallCursorWorld?: { x: number; y: number } | null,
  /** Draw windows / Draw doors: drag preview along wall (not in React state). */
  wallWindowDrawPreview?: { wallId: string; start: Vec2; end: Vec2 } | null
) {
  const {
    camera,
    activeTool,
    objects,
    layers,
    selection,
    extrudePreview,
    showEdgeMeasurements,
    edgeMeasurementOffsetMm,
    pendingAddShape,
    pendingAddSizeMm,
    addShapePreviewWorld,
    drawingPath,
    drawPreviewWorld,
    outerWallDrawWidthMm,
    innerWallDrawWidthMm,
    stairsDrawWidthMm,
    measurePath,
    measurePreviewWorld,
    completedMeasurePath,
  } = state;
  const layerColorById = new Map(layers.map((l) => [l.id, l.color ?? DEFAULT_OBJECT_COLOR]));

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // Background
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, width, height);

  if (imageCache?.size) {
    renderReferenceImages(ctx, width, height, layers, camera, imageCache);
  }

  // Grid
  renderGrid(ctx, width, height, camera);

  // Objects (colour from layer)
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const obj of objects) {
    const baseColor = obj.itemColor ?? (layerColorById.get(obj.layerId) ?? DEFAULT_OBJECT_COLOR);
    const fillColor = hexToRgba(baseColor, 0.15);
    const strokeColor = hexToRgba(baseColor, 0.9);
    const vertexColor = hexToRgba(baseColor, 1);

    const itemImageUrl = getItemImageUrl(obj.itemId);
    const itemImage =
      itemImageUrl && imageCache?.get(itemImageUrl)?.complete
        ? imageCache.get(itemImageUrl)!
        : null;
    const useItemBitmap =
      itemImage != null && itemImage.naturalWidth > 0 && itemImage.naturalHeight > 0;
    /** Wall-anchored doors use the same filled opening as windows (no single-door SVG on the plan). */
    const wallHostedDoorNoItemIcon =
      obj.wallWindowRef != null &&
      (obj.itemId === "single-door" || obj.itemId === "double-door");

    for (const poly of obj.polygons) {
      const verts = poly.verts;
      if (verts.length === 0) continue;

      if (useItemBitmap && !wallHostedDoorNoItemIcon) {
        const handing = obj.doorHanding ?? "left";
        const swing = obj.doorSwing ?? "in";
        const halfFromEdge =
          verts.length >= 2
            ? Math.hypot(verts[1].x - verts[0].x, verts[1].y - verts[0].y) / 2
            : 0;
        const halfSideMm = halfFromEdge > 0 ? halfFromEdge : doorPlacedWidthMm(obj) / 2;
        renderItemImageClippedToPolygon(
          ctx,
          camera,
          width,
          height,
          verts,
          itemImage,
          handing,
          swing,
          obj.transform.rotationDeg,
          halfSideMm,
          Boolean(obj.pairedWallDoorId)
        );
        continue;
      }

      ctx.beginPath();
      const first = worldToScreen(camera, width, height, verts[0]);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < verts.length; i += 1) {
        const s = worldToScreen(camera, width, height, verts[i]);
        ctx.lineTo(s.x, s.y);
      }
      ctx.closePath();

      const holes = poly.holes ?? [];
      for (const hole of holes) {
        if (hole.length < 2) continue;
        const hFirst = worldToScreen(camera, width, height, hole[0]);
        ctx.moveTo(hFirst.x, hFirst.y);
        for (let i = 1; i < hole.length; i += 1) {
          const s = worldToScreen(camera, width, height, hole[i]);
          ctx.lineTo(s.x, s.y);
        }
        ctx.closePath();
      }

      ctx.fillStyle = fillColor;
      ctx.fill("evenodd");

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = vertexColor;
      for (const v of verts) {
        const s = worldToScreen(camera, width, height, v);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const hole of holes) {
        for (const v of hole) {
          const s = worldToScreen(camera, width, height, v);
          ctx.beginPath();
          ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (
      obj.itemColor != null &&
      obj.itemId !== "wall-window" &&
      !(obj.wallWindowRef && (obj.itemId === "single-door" || obj.itemId === "double-door"))
    ) {
      renderItemDirection(
        ctx,
        camera,
        width,
        height,
        obj.transform.position,
        obj.transform.rotationDeg,
        obj.itemDirectionDeg ?? 270,
        strokeColor,
        obj.itemId === "single-door" || obj.itemId === "double-door"
          ? (obj.doorSwing ?? "in")
          : undefined
      );
    }
  }

  // Room labels (floor/ceiling split regions), on top of floor fills
  if (state.showRoomLabelsInViewport) {
    const rooms = listRoomsFromObjects(objects);
    if (rooms.length > 0) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const fontPx = 13;
      ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
      for (const r of rooms) {
        const text = displayRoomLabel(r.globalIndex, r.key, state.roomCustomNames);
        const s = worldToScreen(camera, width, height, r.centroid);
        ctx.strokeStyle = "rgba(15, 23, 42, 0.88)";
        ctx.lineWidth = 4;
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.strokeText(text, s.x, s.y);
        ctx.fillStyle = "rgba(248, 250, 252, 0.96)";
        ctx.fillText(text, s.x, s.y);
      }
      ctx.restore();
    }
  }

  // Draw tool: current path and preview (axis-aligned stroke from inspector width)
  if (drawingPath && drawingPath.length > 0) {
    const halfBrush =
      activeTool === "Draw inner wall"
        ? innerWallDrawWidthMm / 2
        : activeTool === "Draw stairs"
          ? stairsDrawWidthMm / 2
          : outerWallDrawWidthMm / 2;
    const pathWithPreview =
      drawPreviewWorld != null ? [...drawingPath, drawPreviewWorld] : drawingPath;
    if (pathWithPreview.length >= 2) {
      const regions =
        activeTool === "Draw stairs"
          ? pathToPolygonForStairs(pathWithPreview, halfBrush)
          : [pathToPolygon(pathWithPreview, halfBrush)];
      const anyRegion = regions.some((r) => r.length >= 3);
      if (anyRegion) {
        ctx.beginPath();
        for (const outline of regions) {
          if (outline.length < 3) continue;
          const first = worldToScreen(camera, width, height, outline[0]);
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < outline.length; i++) {
            const s = worldToScreen(camera, width, height, outline[i]);
            ctx.lineTo(s.x, s.y);
          }
          ctx.closePath();
        }
        ctx.fillStyle = "rgba(96, 165, 250, 0.25)";
        ctx.fill();
        ctx.strokeStyle = "rgba(96, 165, 250, 0.85)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.strokeStyle = "rgba(96, 165, 250, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const p0 = worldToScreen(camera, width, height, drawingPath[0]);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < drawingPath.length; i++) {
      const s = worldToScreen(camera, width, height, drawingPath[i]);
      ctx.lineTo(s.x, s.y);
    }
    if (drawPreviewWorld) {
      const s = worldToScreen(camera, width, height, drawPreviewWorld);
      ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();
    ctx.fillStyle = "#93c5fd";
    for (const p of drawingPath) {
      const s = worldToScreen(camera, width, height, p);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (completedMeasurePath && completedMeasurePath.length > 0) {
    renderMeasureOverlay(
      ctx,
      width,
      height,
      camera,
      completedMeasurePath,
      null,
      selection.measureVertexIndex
    );
  }
  if (measurePath && measurePath.length > 0) {
    renderMeasureOverlay(ctx, width, height, camera, measurePath, measurePreviewWorld, null);
  }

  // Add-shape preview: 1×1 m box following the pointer
  if (pendingAddShape && addShapePreviewWorld) {
    const cx = addShapePreviewWorld.x;
    const cy = addShapePreviewWorld.y;
    const h = pendingAddSizeMm / 2;
    const verts = [
      { x: cx - h, y: cy - h },
      { x: cx + h, y: cy - h },
      { x: cx + h, y: cy + h },
      { x: cx - h, y: cy + h },
    ];
    ctx.beginPath();
    const first = worldToScreen(camera, width, height, verts[0]);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < verts.length; i++) {
      const s = worldToScreen(camera, width, height, verts[i]);
      ctx.lineTo(s.x, s.y);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(96, 165, 250, 0.2)";
    ctx.fill();
    ctx.strokeStyle = "rgba(96, 165, 250, 0.9)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Edge measurement labels (offset outward from each edge)
  if (showEdgeMeasurements) {
    renderEdgeMeasurements(ctx, width, height, objects, camera, edgeMeasurementOffsetMm);
  }

  // Selection overlay: highlight selected edge, or whole object when shape is selected (no edge)
  if (selection.edge) {
    const { objectId, polygonId, edgeIndex, holeIndex } = selection.edge;
    const obj = objects.find((o) => o.id === objectId);
    const poly = obj?.polygons.find((p) => p.id === polygonId);
    const verts = poly ? getPolygonContour(poly, holeIndex) : undefined;

    if (verts && verts.length >= 2) {
      const a = verts[edgeIndex];
      const b = verts[(edgeIndex + 1) % verts.length];

      const sa = worldToScreen(camera, width, height, a);
      const sb = worldToScreen(camera, width, height, b);

      ctx.strokeStyle = "#f97316";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
    }
  } else if (selection.objectId) {
    const obj = objects.find((o) => o.id === selection.objectId);
    if (obj) {
      ctx.strokeStyle = "rgba(249, 115, 22, 0.85)";
      ctx.lineWidth = 2.5;
      for (const poly of obj.polygons) {
        const verts = poly.verts;
        if (verts.length < 2) continue;
        const first = worldToScreen(camera, width, height, verts[0]);
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < verts.length; i++) {
          const s = worldToScreen(camera, width, height, verts[i]);
          ctx.lineTo(s.x, s.y);
        }
        ctx.closePath();
        ctx.stroke();
        for (const hole of poly.holes ?? []) {
          if (hole.length < 2) continue;
          const hFirst = worldToScreen(camera, width, height, hole[0]);
          ctx.moveTo(hFirst.x, hFirst.y);
          for (let i = 1; i < hole.length; i++) {
            const s = worldToScreen(camera, width, height, hole[i]);
            ctx.lineTo(s.x, s.y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
      // Centerline overlay when object has one (e.g. from Draw tool); not for item shapes (move/rotate only)
      const cl = obj.centerline;
      if (cl && cl.length >= 2 && obj.itemColor == null) {
        const cseg = selection.centerlineSegment;
        const segSelected = cseg?.objectId === obj.id;
        ctx.beginPath();
        const c0 = worldToScreen(camera, width, height, cl[0]);
        ctx.moveTo(c0.x, c0.y);
        for (let i = 1; i < cl.length; i++) {
          const s = worldToScreen(camera, width, height, cl[i]);
          ctx.lineTo(s.x, s.y);
        }
        ctx.strokeStyle = "rgba(147, 197, 253, 0.95)";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (segSelected && cseg != null) {
          const si = cseg.segmentIndex;
          if (si >= 0 && si < cl.length - 1) {
            const sa = worldToScreen(camera, width, height, cl[si]);
            const sb = worldToScreen(camera, width, height, cl[si + 1]);
            ctx.strokeStyle = "rgba(249, 115, 22, 0.9)";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(sa.x, sa.y);
            ctx.lineTo(sb.x, sb.y);
            ctx.stroke();
          }
        }
        const cp = selection.centerlinePoint;
        const n = cl.length;
        for (let i = 0; i < n; i++) {
          const p = cl[i];
          const s = worldToScreen(camera, width, height, p);
          const isEndpoint = i === 0 || i === n - 1;
          const isSelected = isEndpoint && cp?.objectId === obj.id && cp?.pointIndex === i;
          ctx.fillStyle = isSelected ? "#f97316" : isEndpoint ? "#93c5fd" : "rgba(147, 197, 253, 0.6)";
          ctx.beginPath();
          ctx.arc(s.x, s.y, isSelected ? 5 : isEndpoint ? 3.5 : 2, 0, Math.PI * 2);
          ctx.fill();
          if (isSelected) {
            ctx.strokeStyle = "rgba(249, 115, 22, 0.9)";
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      }
      // Wall-window: spine endpoints on parent wall (drag handles)
      if (
        (obj.itemId === "wall-window" ||
          obj.itemId === "single-door" ||
          obj.itemId === "double-door") &&
        obj.wallWindowRef
      ) {
        const wall = objects.find((o) => o.id === obj.wallWindowRef!.wallId);
        const wcl = wall?.centerline;
        if (wall && wcl && wcl.length >= 2) {
          const norm = normalizeWallWindowRef(wall, obj.wallWindowRef);
          if (norm) {
            const a = pointAtDistanceAlongPolyline(wcl, norm.startAlongMm);
            const b = pointAtDistanceAlongPolyline(wcl, norm.endAlongMm);
            const wp = selection.windowEndpoint;
            const endpoints: { which: "start" | "end"; p: Vec2 }[] = [
              { which: "start", p: a },
              { which: "end", p: b },
            ];
            const handleColor = "#7dd3fc";
            for (const { which, p } of endpoints) {
              const s = worldToScreen(camera, width, height, p);
              const isSel = wp?.objectId === obj.id && wp?.which === which;
              ctx.fillStyle = isSel ? "#f97316" : handleColor;
              ctx.beginPath();
              ctx.arc(s.x, s.y, isSel ? 5 : 3.5, 0, Math.PI * 2);
              ctx.fill();
              if (isSel) {
                ctx.strokeStyle = "rgba(249, 115, 22, 0.9)";
                ctx.lineWidth = 2;
                ctx.stroke();
              }
            }
          }
        }
      }
    }
  }

  // Extrude preview: A2–B2 and A–A2, B–B2
  if (extrudePreview && extrudePreview.distanceMm !== 0) {
    const { objectId, polygonId, edgeIndex, holeIndex } = extrudePreview.edgeRef;
    const obj = objects.find((o) => o.id === objectId);
    const poly = obj?.polygons.find((p) => p.id === polygonId);
    const verts = poly ? getPolygonContour(poly, holeIndex) : undefined;

    if (verts && verts.length >= 2) {
      const a = verts[edgeIndex];
      const b = verts[(edgeIndex + 1) % verts.length];
      const n = getOutwardNormal(verts, edgeIndex);
      const d = extrudePreview.distanceMm;

      const a2 = { x: a.x + n.x * d, y: a.y + n.y * d };
      const b2 = { x: b.x + n.x * d, y: b.y + n.y * d };

      const sa = worldToScreen(camera, width, height, a);
      const sb = worldToScreen(camera, width, height, b);
      const sa2 = worldToScreen(camera, width, height, a2);
      const sb2 = worldToScreen(camera, width, height, b2);

      ctx.strokeStyle = "rgba(34, 197, 94, 0.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sa2.x, sa2.y);
      ctx.lineTo(sb2.x, sb2.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Rotate tool: ring + handle at current rotation
  if (activeTool === "Rotate" && selection.objectId && !selection.edge) {
    const robj = objects.find((o) => o.id === selection.objectId);
    const manip = robj ? getRotateManipulatorForObject(robj) : null;
    if (manip) {
      const { center, radiusMm, handleWorld } = manip;
      const steps = 72;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        const wx = center.x + radiusMm * Math.cos(t);
        const wy = center.y + radiusMm * Math.sin(t);
        const s = worldToScreen(camera, width, height, { x: wx, y: wy });
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      }
      ctx.closePath();
      ctx.strokeStyle = "rgba(148, 163, 184, 0.95)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      const cs = worldToScreen(camera, width, height, center);
      const cross = 9;
      ctx.strokeStyle = "rgba(251, 191, 36, 0.95)";
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(cs.x - cross, cs.y);
      ctx.lineTo(cs.x + cross, cs.y);
      ctx.moveTo(cs.x, cs.y - cross);
      ctx.lineTo(cs.x, cs.y + cross);
      ctx.stroke();
      const hs = worldToScreen(camera, width, height, handleWorld);
      ctx.beginPath();
      ctx.moveTo(cs.x, cs.y);
      ctx.lineTo(hs.x, hs.y);
      ctx.strokeStyle = "rgba(251, 191, 36, 0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#fbbf24";
      ctx.strokeStyle = "#d97706";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hs.x, hs.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Draw windows: min–max span preview (cyan). Draw doors: catalog span from fixed jamb (green).
  if (wallWindowDrawPreview) {
    const { wallId, start, end } = wallWindowDrawPreview;
    const wall = objects.find((o) => o.id === wallId);
    const wcl = wall?.centerline;
    if (wall && wcl && wcl.length >= 2) {
      const gridMm = snapGridStepMm(state.snap);
      const vertexTolMm = snapVertexToleranceMm(
        state.snap,
        DEFAULT_SELECTION_DISTANCE_PX,
        camera.zoom
      );
      const halfW = effectiveWallDrawWidthMm(wall) / 2;

      if (activeTool === "Draw doors") {
        const span = computeWallDoorPreviewSpan(
          wall,
          objects,
          start,
          end,
          gridMm,
          vertexTolMm,
          state.doorDrawKind,
          state.doorDrawRegionFilter
        );
        const aSnap = snapWallWindowPointerOntoCenterline(wcl, start, gridMm, vertexTolMm);
        const bSnap = snapWallWindowPointerOntoCenterline(wcl, end, gridMm, vertexTolMm);
        const fixedAlong = distanceAlongPolylineToPoint(wcl, aSnap);
        const pointerAlong = distanceAlongPolylineToPoint(wcl, bSnap);
        const s0 = Math.min(fixedAlong, pointerAlong);
        const s1 = Math.max(fixedAlong, pointerAlong);

        const drawDoorFill = (
          sA: number,
          sB: number,
          fill: string,
          stroke: string,
          dashed: boolean
        ) => {
          const fillVerts = buildWindowPolygonAlongCenterlineSpan(wcl, sA, sB, halfW);
          if (fillVerts && fillVerts.length >= 3) {
            ctx.fillStyle = fill;
            ctx.beginPath();
            const f0 = worldToScreen(camera, width, height, fillVerts[0]);
            ctx.moveTo(f0.x, f0.y);
            for (let i = 1; i < fillVerts.length; i++) {
              const si = worldToScreen(camera, width, height, fillVerts[i]);
              ctx.lineTo(si.x, si.y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 2;
            if (dashed) ctx.setLineDash([5, 4]);
            else ctx.setLineDash([]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        };

        if (span) {
          drawDoorFill(
            span.startAlongMm,
            span.endAlongMm,
            "rgba(34, 197, 94, 0.28)",
            "rgba(22, 163, 74, 0.95)",
            false
          );
          const pOpen0 = pointAtDistanceAlongPolyline(wcl, span.startAlongMm);
          const pOpen1 = pointAtDistanceAlongPolyline(wcl, span.endAlongMm);
          const midWorld = {
            x: (pOpen0.x + pOpen1.x) / 2,
            y: (pOpen0.y + pOpen1.y) / 2,
          };
          const mid = worldToScreen(camera, width, height, midWorld);
          const s0 = worldToScreen(camera, width, height, pOpen0);
          const s1 = worldToScreen(camera, width, height, pOpen1);
          const dx = s1.x - s0.x;
          const dy = s1.y - s0.y;
          const el = Math.hypot(dx, dy) || 1;
          const ox = (-dy / el) * 12;
          const oy = (dx / el) * 12;
          const lx = mid.x + ox;
          const ly = mid.y + oy;
          const labelText = doorCatalogSummary(state.doorDrawKind, span.doorWidthMm);
          drawMeasureStylePillLabel(ctx, lx, ly, labelText);
        } else if (Math.abs(pointerAlong - fixedAlong) >= MIN_WALL_WINDOW_SPAN_MM) {
          drawDoorFill(
            s0,
            s1,
            "rgba(34, 197, 94, 0.1)",
            "rgba(22, 163, 74, 0.45)",
            true
          );
        } else {
          const spine = spinePointsBetweenAlong(wcl, s0, s1);
          if (spine.length >= 2) {
            ctx.strokeStyle = "rgba(22, 163, 74, 0.75)";
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            const s00 = worldToScreen(camera, width, height, spine[0]);
            ctx.moveTo(s00.x, s00.y);
            for (let i = 1; i < spine.length; i++) {
              const si = worldToScreen(camera, width, height, spine[i]);
              ctx.lineTo(si.x, si.y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        ctx.fillStyle = "rgba(34, 197, 94, 0.55)";
        for (const p of [start, end]) {
          const sc = worldToScreen(camera, width, height, p);
          ctx.beginPath();
          ctx.arc(sc.x, sc.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const sa = distanceAlongPolylineToPoint(wcl, start);
        const sb = distanceAlongPolylineToPoint(wcl, end);
        const s0 = Math.min(sa, sb);
        const s1 = Math.max(sa, sb);
        const fillVerts = buildWindowPolygonAlongCenterlineSpan(wcl, s0, s1, halfW);
        if (fillVerts && fillVerts.length >= 3) {
          ctx.fillStyle = "rgba(56, 189, 248, 0.25)";
          ctx.beginPath();
          const f0 = worldToScreen(camera, width, height, fillVerts[0]);
          ctx.moveTo(f0.x, f0.y);
          for (let i = 1; i < fillVerts.length; i++) {
            const si = worldToScreen(camera, width, height, fillVerts[i]);
            ctx.lineTo(si.x, si.y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "rgba(56, 189, 248, 0.9)";
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          const spine = spinePointsBetweenAlong(wcl, s0, s1);
          if (spine.length >= 2) {
            ctx.strokeStyle = "rgba(56, 189, 248, 0.95)";
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            const s00 = worldToScreen(camera, width, height, spine[0]);
            ctx.moveTo(s00.x, s00.y);
            for (let i = 1; i < spine.length; i++) {
              const si = worldToScreen(camera, width, height, spine[i]);
              ctx.lineTo(si.x, si.y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        ctx.fillStyle = "rgba(56, 189, 248, 0.5)";
        for (const p of [start, end]) {
          const sc = worldToScreen(camera, width, height, p);
          ctx.beginPath();
          ctx.arc(sc.x, sc.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // Draw wall / inner wall: pointer dot on top (matches centerline endpoint size / colour)
  if (isDrawWallLikeTool(activeTool) && drawWallCursorWorld) {
    const s = worldToScreen(camera, width, height, drawWallCursorWorld);
    ctx.fillStyle = "#93c5fd";
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
}
