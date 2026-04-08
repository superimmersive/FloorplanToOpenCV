import type { Vec2, VectorObject } from "./types";
import {
  distanceAlongPolylineToPoint,
  dragWindowEndpoint,
  isWallHostForOpenings,
  isWallHostedDoorItem,
  normalizeWallWindowRef,
  polylineTotalLength,
  projectPointOntoWallPolyline,
} from "./wallWindow";

/** Ignore crossings closer than this to an opening endpoint (jambs may sit near a node). */
const RULE_EPS_MM = 0.5;
/** How close another wall’s endpoint must be to this wall’s centerline to count as a T (mm). */
const T_JUNCTION_PROXIMITY_MM = 6;

/**
 * Human-readable rules for Draw doors (enforced + ideas for later).
 * Enforced: no spanning corners; no straddling T junctions.
 */
export const DOOR_PLACEMENT_RULES_SUMMARY: readonly string[] = [
  "Opening must lie on a single straight segment — it cannot bend around a corner of the wall centerline.",
  "Opening cannot straddle a T junction (where another wall’s end meets the middle of this wall).",
  "Suggested later: minimum inset from corners/junctions for framing; no overlapping doors on one wall;",
  "Suggested later: minimum clear stud between openings; block doors on segments shorter than the catalog width.",
];

function dedupeNear(distances: number[], mergeMm: number): number[] {
  if (distances.length === 0) return [];
  const s = [...distances].sort((a, b) => a - b);
  const out: number[] = [s[0]];
  for (let i = 1; i < s.length; i++) {
    if (s[i] - out[out.length - 1] > mergeMm) out.push(s[i]);
  }
  return out;
}

/** Cumulative distance to each vertex; used for interior corners. */
function vertexDistancesFromStart(cl: Vec2[]): number[] {
  const d: number[] = [0];
  for (let i = 1; i < cl.length; i++) {
    d.push(d[i - 1] + Math.hypot(cl[i].x - cl[i - 1].x, cl[i].y - cl[i - 1].y));
  }
  return d;
}

/** Arc distances at interior vertices only (where the wall can “turn”). */
export function interiorCornerDistancesAlongWallCenterline(cl: Vec2[]): number[] {
  if (cl.length < 3) return [];
  const vd = vertexDistancesFromStart(cl);
  const out: number[] = [];
  for (let k = 1; k < cl.length - 1; k++) {
    out.push(vd[k]);
  }
  return out;
}

/**
 * True if `alongMm` falls strictly inside one segment (not at a polyline vertex), excluding chain ends.
 */
export function isArcLengthStrictlyInteriorToASegment(hostCl: Vec2[], alongMm: number): boolean {
  const total = polylineTotalLength(hostCl);
  if (alongMm <= RULE_EPS_MM || alongMm >= total - RULE_EPS_MM) return false;
  let cum = 0;
  for (let i = 0; i < hostCl.length - 1; i++) {
    const a = hostCl[i];
    const b = hostCl[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < 1e-9) continue;
    if (alongMm <= cum + segLen + 1e-9) {
      const t = (alongMm - cum) / segLen;
      return t > 1e-4 && t < 1 - 1e-4;
    }
    cum += segLen;
  }
  return false;
}

/**
 * Distances along `hostCl` where another wall’s endpoint lands on this wall’s **edge** (T),
 * not at a corner of this wall.
 */
export function tJunctionDistancesAlongWall(
  hostCl: Vec2[],
  hostId: string,
  objects: VectorObject[]
): number[] {
  const found: number[] = [];
  for (const obj of objects) {
    if (!isWallHostForOpenings(obj) || obj.id === hostId) continue;
    const ocl = obj.centerline;
    if (!ocl || ocl.length < 2) continue;
    const endpoints: Vec2[] = [ocl[0], ocl[ocl.length - 1]];
    for (const ep of endpoints) {
      const q = projectPointOntoWallPolyline(hostCl, ep);
      if (Math.hypot(ep.x - q.x, ep.y - q.y) > T_JUNCTION_PROXIMITY_MM) continue;
      const along = distanceAlongPolylineToPoint(hostCl, ep);
      if (isArcLengthStrictlyInteriorToASegment(hostCl, along)) {
        found.push(along);
      }
    }
  }
  return dedupeNear(found, 2);
}

/** All arc distances where a door opening must not pass through (corners + T junctions). */
export function collectDoorBlockedDistancesAlongWall(wall: VectorObject, objects: VectorObject[]): number[] {
  const cl = wall.centerline;
  if (!cl || cl.length < 2) return [];
  const corners = interiorCornerDistancesAlongWallCenterline(cl);
  const tJ = tJunctionDistancesAlongWall(cl, wall.id, objects);
  return dedupeNear([...corners, ...tJ], 1);
}

function spanCrossesBlockedDistance(lo: number, hi: number, blocked: number[]): boolean {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  for (const d of blocked) {
    if (a + RULE_EPS_MM < d && d < b - RULE_EPS_MM) return true;
  }
  return false;
}

/** Wall-hosted door opening [startAlongMm, endAlongMm] obeys corner + T rules. */
export function doorSpanPassesPlacementRules(
  wall: VectorObject,
  objects: VectorObject[],
  startAlongMm: number,
  endAlongMm: number
): boolean {
  const blocked = collectDoorBlockedDistancesAlongWall(wall, objects);
  return !spanCrossesBlockedDistance(startAlongMm, endAlongMm, blocked);
}

/**
 * Runs {@link dragWindowEndpoint}; if the result would violate door rules, returns `previousObjects`.
 */
export function dragWallHostedDoorEndpointWithRules(
  previousObjects: VectorObject[],
  windowId: string,
  which: "start" | "end",
  worldPoint: Vec2,
  snapGridMm: number,
  vertexSnapTolMm: number,
  doorCatalogWidthsMm: number[] | null | undefined
): VectorObject[] {
  const next = dragWindowEndpoint(
    previousObjects,
    windowId,
    which,
    worldPoint,
    snapGridMm,
    vertexSnapTolMm,
    doorCatalogWidthsMm && doorCatalogWidthsMm.length > 0 ? doorCatalogWidthsMm : null
  );
  if (next === previousObjects) return next;
  const win = next.find((o) => o.id === windowId);
  const wall = next.find((o) => o.id === win?.wallWindowRef?.wallId);
  if (!win?.wallWindowRef || !wall?.centerline) return next;
  if (!isWallHostedDoorItem(win)) return next;
  const norm = normalizeWallWindowRef(wall, win.wallWindowRef);
  if (!norm) return next;
  if (!doorSpanPassesPlacementRules(wall, next, norm.startAlongMm, norm.endAlongMm)) {
    return previousObjects;
  }
  return next;
}
