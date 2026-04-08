/** Standard door widths (mm). Plan symbol uses width × width; height is for labeling only. */

import { getObjectsBbox } from "../geometry/bbox";
import type { VectorObject } from "../geometry/types";

export type DoorRegion = "SA" | "UK";

export type DoorWidthOption = {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
  region: DoorRegion;
};

export const DOOR_WIDTH_OPTIONS: DoorWidthOption[] = [
  { id: "sa-762", label: "SA 762 × 2032 mm", widthMm: 762, heightMm: 2032, region: "SA" },
  { id: "sa-813", label: "SA 813 × 2032 mm", widthMm: 813, heightMm: 2032, region: "SA" },
  { id: "sa-900", label: "SA 900 × 2032 mm", widthMm: 900, heightMm: 2032, region: "SA" },
  { id: "sa-1200", label: "SA 1200 × 2032 mm", widthMm: 1200, heightMm: 2032, region: "SA" },
  { id: "uk-610", label: "UK 610 × 1981 mm", widthMm: 610, heightMm: 1981, region: "UK" },
  { id: "uk-686", label: "UK 686 × 1981 mm", widthMm: 686, heightMm: 1981, region: "UK" },
  { id: "uk-762", label: "UK 762 × 1981 mm", widthMm: 762, heightMm: 1981, region: "UK" },
  { id: "uk-838", label: "UK 838 × 1981 mm", widthMm: 838, heightMm: 1981, region: "UK" },
  { id: "uk-864", label: "UK 864 × 2083 mm", widthMm: 864, heightMm: 2083, region: "UK" },
  { id: "uk-915", label: "UK 915 × 2143 mm", widthMm: 915, heightMm: 2143, region: "UK" },
  { id: "uk-1016", label: "UK 1016 × 1981 mm", widthMm: 1016, heightMm: 1981, region: "UK" },
];

export const DEFAULT_DOOR_PLACE_OPTION_ID = "sa-762";

/** Draw doors tool: single vs double (separate width catalogs). */
export type DoorDrawKind = "single" | "double";

/** Filter catalog when drawing doors: all regions, or one region only. */
export type DoorDrawRegionFilter = "global" | "SA" | "UK";

/** Standard double-door openings (mm); plan symbol is width × width; height is nominal / export. */
export const DOUBLE_DOOR_WIDTH_OPTIONS: DoorWidthOption[] = [
  { id: "d-sa-1500-2032", label: "SA 1500 × 2032 mm", widthMm: 1500, heightMm: 2032, region: "SA" },
  { id: "d-sa-1600-2032", label: "SA 1600 × 2032 mm", widthMm: 1600, heightMm: 2032, region: "SA" },
  { id: "d-sa-1800-2032", label: "SA 1800 × 2032 mm", widthMm: 1800, heightMm: 2032, region: "SA" },
  { id: "d-sa-1200-2134", label: "SA 1200 × 2134 mm", widthMm: 1200, heightMm: 2134, region: "SA" },
  { id: "d-sa-1500-2134", label: "SA 1500 × 2134 mm", widthMm: 1500, heightMm: 2134, region: "SA" },
  { id: "d-sa-1800-2400", label: "SA 1800 × 2400 mm", widthMm: 1800, heightMm: 2400, region: "SA" },
  { id: "d-uk-915-1981", label: "UK 915 × 1981 mm", widthMm: 915, heightMm: 1981, region: "UK" },
  { id: "d-uk-1220-1981", label: "UK 1220 × 1981 mm", widthMm: 1220, heightMm: 1981, region: "UK" },
  { id: "d-uk-1372-1981", label: "UK 1372 × 1981 mm", widthMm: 1372, heightMm: 1981, region: "UK" },
  { id: "d-uk-1524-1981", label: "UK 1524 × 1981 mm", widthMm: 1524, heightMm: 1981, region: "UK" },
  { id: "d-uk-1676-1981", label: "UK 1676 × 1981 mm", widthMm: 1676, heightMm: 1981, region: "UK" },
];

export const DEFAULT_DOUBLE_DOOR_OPTION_ID = "d-sa-1500-2032";

/** When a placed door width does not resolve to a catalog row, use this height (mm). */
export const DEFAULT_DOOR_HEIGHT_FALLBACK_MM = 2032;

export function doubleDoorOptionById(id: string): DoorWidthOption | undefined {
  return DOUBLE_DOOR_WIDTH_OPTIONS.find((o) => o.id === id);
}

export function doubleDoorOptionByWidthMm(widthMm: number): DoorWidthOption | undefined {
  return DOUBLE_DOOR_WIDTH_OPTIONS.find((o) => o.widthMm === widthMm);
}

/**
 * After a wall opening span change, keep the same catalog row if its width still matches;
 * otherwise the first catalog row for the new width (used when width-only draw snaps).
 */
export function doubleDoorCatalogIdForSpanMm(
  spanMm: number,
  previousOptionId?: string | null
): string | undefined {
  const wr = Math.round(spanMm);
  const prev = previousOptionId ? doubleDoorOptionById(previousOptionId) : undefined;
  if (prev && prev.widthMm === wr) return previousOptionId ?? undefined;
  return doubleDoorOptionByWidthMm(wr)?.id;
}

export function filterDoorOptionsByRegion(
  options: DoorWidthOption[],
  filter: DoorDrawRegionFilter
): DoorWidthOption[] {
  if (filter === "global") return options;
  return options.filter((o) => o.region === filter);
}

/** Sorted unique widths (mm) for the draw-door tool after region filter. */
export function catalogWidthsForDraw(kind: DoorDrawKind, filter: DoorDrawRegionFilter): number[] {
  const src = kind === "single" ? DOOR_WIDTH_OPTIONS : DOUBLE_DOOR_WIDTH_OPTIONS;
  const filtered = filterDoorOptionsByRegion(src, filter);
  const widths = filtered.map((o) => o.widthMm);
  return [...new Set(widths)].sort((a, b) => a - b);
}

/** Nearest catalog width to `rawMm` (ties: first minimum width among equals). */
export function nearestCatalogWidthMm(widths: number[], rawMm: number): number {
  if (widths.length === 0) return rawMm;
  let best = widths[0]!;
  let bestD = Math.abs(best - rawMm);
  for (let i = 1; i < widths.length; i++) {
    const w = widths[i]!;
    const d = Math.abs(w - rawMm);
    if (d < bestD - 1e-9) {
      best = w;
      bestD = d;
    }
  }
  return best;
}

/**
 * First click fixes `fixedAlongMm`; opening extends toward `pointerAlongMm` by the nearest catalog width,
 * capped by wall length and max catalog size. Returns ordered span along the wall.
 */
export function computeWallDoorSpanFromFixedJamb(
  totalWallLengthMm: number,
  fixedAlongMm: number,
  pointerAlongMm: number,
  catalogWidthsMm: number[]
): { startAlongMm: number; endAlongMm: number; doorWidthMm: number } | null {
  if (catalogWidthsMm.length === 0) return null;
  const minW = Math.min(...catalogWidthsMm);
  const maxW = Math.max(...catalogWidthsMm);
  const sign = pointerAlongMm >= fixedAlongMm ? 1 : -1;
  const room = sign > 0 ? totalWallLengthMm - fixedAlongMm : fixedAlongMm;
  const rawSpan = Math.abs(pointerAlongMm - fixedAlongMm);
  const capped = Math.min(rawSpan, room, maxW);
  let W = nearestCatalogWidthMm(catalogWidthsMm, capped);
  if (W > room + 1e-6) {
    const fits = catalogWidthsMm.filter((w) => w <= room + 1e-6);
    if (fits.length === 0) return null;
    W = Math.max(...fits);
  }
  if (W + 1e-6 < minW) return null;
  const endAlong = fixedAlongMm + sign * W;
  if (endAlong < -1e-6 || endAlong > totalWallLengthMm + 1e-6) return null;
  return {
    startAlongMm: Math.min(fixedAlongMm, endAlong),
    endAlongMm: Math.max(fixedAlongMm, endAlong),
    doorWidthMm: W,
  };
}

export function doorOptionById(id: string): DoorWidthOption | undefined {
  return DOOR_WIDTH_OPTIONS.find((o) => o.id === id);
}

export function doorOptionByWidthMm(widthMm: number): DoorWidthOption | undefined {
  return DOOR_WIDTH_OPTIONS.find((o) => o.widthMm === widthMm);
}

/**
 * Nominal door height (mm) from the SA/UK catalog row that matches placed width (nearest if not exact).
 */
export function doorHeightMmForPlacedDoor(obj: VectorObject): number {
  if (obj.itemId !== "single-door" && obj.itemId !== "double-door") {
    return DEFAULT_DOOR_HEIGHT_FALLBACK_MM;
  }
  if (obj.doorCatalogOptionId) {
    const byId =
      obj.itemId === "double-door"
        ? doubleDoorOptionById(obj.doorCatalogOptionId)
        : doorOptionById(obj.doorCatalogOptionId);
    if (byId) return byId.heightMm;
  }
  const w = doorPlacedWidthMm(obj);
  const wr = Math.round(w);
  const opts = obj.itemId === "single-door" ? DOOR_WIDTH_OPTIONS : DOUBLE_DOOR_WIDTH_OPTIONS;
  const exact = opts.find((o) => o.widthMm === wr);
  if (exact) return exact.heightMm;
  const widths = [...new Set(opts.map((o) => o.widthMm))].sort((a, b) => a - b);
  if (widths.length === 0) return DEFAULT_DOOR_HEIGHT_FALLBACK_MM;
  const nw = nearestCatalogWidthMm(widths, wr);
  const best = opts.find((o) => o.widthMm === nw);
  return best?.heightMm ?? DEFAULT_DOOR_HEIGHT_FALLBACK_MM;
}

/** Width stored on object, or inferred from square bbox (mm). */
export function doorPlacedWidthMm(obj: VectorObject): number {
  if (obj.doorWidthMm != null && obj.doorWidthMm > 0) return obj.doorWidthMm;
  const b = getObjectsBbox([obj]);
  if (!b) return 762;
  return Math.round(Math.max(b.maxX - b.minX, b.maxY - b.minY));
}

/**
 * Catalog line for draw tool / inspector, e.g. `Single SA 762`. Same rules as {@link doorCatalogInspectorLabel}.
 */
export function doorCatalogSummary(kind: DoorDrawKind, widthMm: number): string {
  const wr = Math.round(widthMm);
  const opts = kind === "single" ? DOOR_WIDTH_OPTIONS : DOUBLE_DOOR_WIDTH_OPTIONS;
  const kindWord = kind === "single" ? "Single" : "Double";
  const exact = opts.find((o) => o.widthMm === wr);
  if (exact) return `${kindWord} ${exact.region} ${exact.widthMm}`;
  const widths = [...new Set(opts.map((o) => o.widthMm))].sort((a, b) => a - b);
  if (widths.length === 0) return `${kindWord} ${wr} mm`;
  const nw = nearestCatalogWidthMm(widths, wr);
  const best = opts.find((o) => o.widthMm === nw);
  if (best) return `${kindWord} ${best.region} ${nw} (~${wr} mm)`;
  return `${kindWord} ${wr} mm`;
}

/**
 * Short catalog summary for inspector, e.g. `Single SA 762` or `Double UK 1524`. If width matches multiple
 * entries (same mm), the first catalog entry wins (SA before UK in our lists). Non-catalog widths show nearest + measured.
 */
export function doorCatalogInspectorLabel(obj: VectorObject): string | null {
  if (obj.itemId !== "single-door" && obj.itemId !== "double-door") return null;
  if (obj.itemId === "double-door" && obj.doorCatalogOptionId) {
    const opt = doubleDoorOptionById(obj.doorCatalogOptionId);
    if (opt) return `Double ${opt.label}`;
  }
  const w = doorPlacedWidthMm(obj);
  const kind: DoorDrawKind = obj.itemId === "double-door" ? "double" : "single";
  return doorCatalogSummary(kind, w);
}
