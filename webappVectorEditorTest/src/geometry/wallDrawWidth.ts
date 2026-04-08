import type { VectorObject } from "./types";
import { LEGACY_WALL_WIDTH_MM } from "./drawPath";

/** Preset widths (mm) for new outer walls from Draw outer wall. */
export const OUTER_WALL_WIDTH_OPTIONS_MM = [280, 300] as const;

/** Preset widths (mm) for new inner walls from Draw inner wall. */
export const INNER_WALL_WIDTH_OPTIONS_MM = [80, 100, 150] as const;

export const DEFAULT_OUTER_WALL_DRAW_WIDTH_MM = 280;
export const DEFAULT_INNER_WALL_DRAW_WIDTH_MM = 100;

/** Default plan width (mm) for Draw stairs (stair run). */
export const DEFAULT_STAIRS_DRAW_WIDTH_MM = 1000;

/** Preset widths (mm) for Draw stairs in the inspector. */
export const STAIRS_WIDTH_OPTIONS_MM = [800, 900, 1000, 1100, 1200] as const;

/**
 * Stroke width for wall polylines. Uses stored `drawWidthMm` when set; otherwise legacy outer
 * shells default to {@link LEGACY_WALL_WIDTH_MM}, inner walls to {@link DEFAULT_INNER_WALL_DRAW_WIDTH_MM}.
 */
export function effectiveWallDrawWidthMm(obj: VectorObject): number {
  if (typeof obj.drawWidthMm === "number" && Number.isFinite(obj.drawWidthMm) && obj.drawWidthMm > 0) {
    return obj.drawWidthMm;
  }
  if (obj.itemId === "stairs") return DEFAULT_STAIRS_DRAW_WIDTH_MM;
  if (obj.itemId === "inner-wall") return DEFAULT_INNER_WALL_DRAW_WIDTH_MM;
  return LEGACY_WALL_WIDTH_MM;
}
