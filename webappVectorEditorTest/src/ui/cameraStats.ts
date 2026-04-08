import type { Camera2D } from "../geometry/types";
import type { ViewportSize } from "../state/editorState";

export const CAMERA_STATS_TITLE =
  "Plan view is 2D: there is no camera height. " +
  "Center = world position (mm) at the middle of the canvas; " +
  "zoom = screen pixels per world mm (larger = more zoomed in); " +
  "visible = world width × height (mm) shown in the viewport.";

export function fmtWorldMm(n: number): string {
  const a = Math.abs(n);
  if (a >= 10000) return n.toFixed(0);
  if (a >= 1000) return n.toFixed(0);
  return n.toFixed(1);
}

export function fmtZoom(z: number): string {
  if (z < 0.01) return z.toExponential(1);
  if (z >= 100) return z.toFixed(0);
  return z.toFixed(2);
}

/** Single-line summary for the viewport HUD / toolbar. */
export function getCameraStatsLine(camera: Camera2D, viewportSize: ViewportSize | null): string {
  const z = camera.zoom;
  const visibleWmm = viewportSize && z > 0 ? viewportSize.width / z : null;
  const visibleHmm = viewportSize && z > 0 ? viewportSize.height / z : null;
  let s = `Center (${fmtWorldMm(camera.center.x)}, ${fmtWorldMm(camera.center.y)}) mm · Zoom ${fmtZoom(z)} px/mm`;
  if (visibleWmm != null && visibleHmm != null) {
    s += ` · View ${Math.round(visibleWmm)}×${Math.round(visibleHmm)} mm`;
  }
  return s;
}
