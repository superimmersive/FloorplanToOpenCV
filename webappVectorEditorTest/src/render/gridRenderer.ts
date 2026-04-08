import type { Camera2D } from "../geometry/types";

const GRID_10MM = 10;
const GRID_100MM = 100;
const GRID_1000MM = 1000;

const SHOW_10MM_MIN_ZOOM = 0.2;
const SHOW_100MM_MIN_ZOOM = 0.02;

/** World to screen: same convention as scene (x right, y up in world; screen y flipped). */
function worldToScreen(
  center: { x: number; y: number },
  zoom: number,
  width: number,
  height: number,
  wx: number,
  wy: number
): { sx: number; sy: number } {
  const cx = width / 2;
  const cy = height / 2;
  return {
    sx: cx + (wx - center.x) * zoom,
    sy: cy - (wy - center.y) * zoom
  };
}

/** Draw the grid in world space so it moves with the camera. No clear/fill (caller does that). */
export function renderGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: Camera2D
): void {
  const { center, zoom } = camera;

  const worldHalfW = width / zoom / 2;
  const worldHalfH = height / zoom / 2;
  const worldMinX = center.x - worldHalfW;
  const worldMaxX = center.x + worldHalfW;
  const worldMinY = center.y - worldHalfH;
  const worldMaxY = center.y + worldHalfH;

  const drawLayer = (spacingMm: number, color: string, lineWidth: number, alpha: number) => {
    const firstX = Math.floor(worldMinX / spacingMm) * spacingMm;
    const firstY = Math.floor(worldMinY / spacingMm) * spacingMm;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = alpha;
    ctx.beginPath();

    for (let x = firstX; x <= worldMaxX; x += spacingMm) {
      const { sx } = worldToScreen(center, zoom, width, height, x, 0);
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
    }
    for (let y = firstY; y <= worldMaxY; y += spacingMm) {
      const { sy } = worldToScreen(center, zoom, width, height, 0, y);
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
    }

    ctx.stroke();
    ctx.restore();
  };

  if (zoom >= SHOW_10MM_MIN_ZOOM) {
    drawLayer(GRID_10MM, "rgba(75, 85, 99, 0.35)", 1, 1);
  }
  if (zoom >= SHOW_100MM_MIN_ZOOM) {
    drawLayer(GRID_100MM, "rgba(55, 65, 81, 0.6)", 1, 1);
  }
  drawLayer(GRID_1000MM, "rgba(148, 163, 184, 0.9)", 1.2, 1);

  const o = worldToScreen(center, zoom, width, height, 0, 0);
  ctx.save();
  ctx.lineWidth = 1;
  // X axis (y=0): horizontal line — red (Blender: X right)
  ctx.beginPath();
  ctx.moveTo(0, o.sy);
  ctx.lineTo(width, o.sy);
  ctx.strokeStyle = "#dc2626";
  ctx.stroke();
  // Y axis (x=0): vertical line — green (Blender: Y up/forward)
  ctx.beginPath();
  ctx.moveTo(o.sx, 0);
  ctx.lineTo(o.sx, height);
  ctx.strokeStyle = "#16a34a";
  ctx.stroke();

  // Axis labels: on their centerlines but pinned to screen edges, with small offset so they don't sit on the line
  const labelMargin = 10;
  const labelOffset = 6; // nudge off the line so the label doesn't cut through it
  const fontSize = 14;
  const halfFont = fontSize / 2;
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  ctx.textBaseline = "middle";

  // X label: on horizontal axis, pinned to right edge, nudged slightly up
  const xLabelY = Math.max(labelMargin + halfFont, Math.min(height - labelMargin - halfFont, o.sy)) - labelOffset;
  ctx.fillStyle = "#dc2626";
  ctx.textAlign = "right";
  ctx.fillText("X", width - labelMargin, xLabelY);

  // Y label: on vertical axis, pinned to top edge, nudged slightly left
  const yLabelX = Math.max(labelMargin, Math.min(width - labelMargin, o.sx)) - labelOffset;
  ctx.fillStyle = "#16a34a";
  ctx.textAlign = "center";
  ctx.fillText("Y", yLabelX, labelMargin + halfFont);

  ctx.restore();
}
