import type { Vec2 } from "./types";

type PathDLike = { size: () => number; get: (i: number) => { x: number; y: number } };
type PathsDLike = { size: () => number; get: (i: number) => PathDLike };

type ClipperModule = {
  MakePathD: (intArray: number[]) => PathDLike;
  PathsD: new () => {
    push_back: (path: unknown) => void;
    size: () => number;
    get: (i: number) => PathDLike;
  };
  DifferenceD: (
    subject: unknown,
    clip: unknown,
    fillRule: { value: number },
    precision: number
  ) => PathsDLike;
  UnionSelfD: (paths: unknown, fillRule: { value: number }, precision: number) => PathsDLike;
  FillRule: { NonZero: { value: number } };
};

let clipperPromise: Promise<ClipperModule> | null = null;
let clipperModule: ClipperModule | null = null;

function getClipper(): Promise<ClipperModule> {
  if (clipperModule) return Promise.resolve(clipperModule);
  if (clipperPromise) return clipperPromise;
  clipperPromise = (async () => {
    const factory = (await import("clipper2-wasm")).default;
    const Module = await factory({
      locateFile: (file: string) => `/${file}`
    });
    clipperModule = Module as unknown as ClipperModule;
    return clipperModule;
  })();
  return clipperPromise;
}

/** Preload WASM so synchronous boolean ops (e.g. room subdivision) work. Call from app entry before first sync. */
export async function initClipper(): Promise<void> {
  await getClipper();
}

function getClipperSync(): ClipperModule | null {
  return clipperModule;
}

function vec2ArrayToFlat(verts: Vec2[]): number[] {
  const flat: number[] = [];
  for (const v of verts) {
    flat.push(v.x, v.y);
  }
  return flat;
}

function pathDToVec2Array(path: PathDLike): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < path.size(); i++) {
    const p = path.get(i);
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * Subtract the union of `clips` from `subject`. Used to carve partition walls out of a floor shell.
 * Returns null if Clipper is not loaded yet, or a non-empty list of result polygons.
 */
export function subtractUnionFromSubjectSync(subject: Vec2[], clips: Vec2[][]): Vec2[][] | null {
  const Mod = getClipperSync();
  if (!Mod) return null;
  if (clips.length === 0) return [subject];
  const clipPaths = new Mod.PathsD();
  for (const c of clips) {
    if (c.length >= 3) {
      clipPaths.push_back(Mod.MakePathD(vec2ArrayToFlat(c)));
    }
  }
  if (clipPaths.size() === 0) return [subject];
  const united = Mod.UnionSelfD(clipPaths, Mod.FillRule.NonZero, 2);
  const subjectPath = Mod.MakePathD(vec2ArrayToFlat(subject));
  const subjectPaths = new Mod.PathsD();
  subjectPaths.push_back(subjectPath);
  const result = Mod.DifferenceD(subjectPaths, united, Mod.FillRule.NonZero, 2);
  const out: Vec2[][] = [];
  for (let i = 0; i < result.size(); i++) {
    out.push(pathDToVec2Array(result.get(i)));
  }
  return out.length > 0 ? out : null;
}

/** Union a polygon with itself to resolve self-intersections and merge overlapping regions. Returns one or more simple polygons. */
export async function unionSelfPolygon(verts: Vec2[]): Promise<Vec2[][]> {
  if (verts.length < 3) return [verts];
  const Mod = await getClipper();
  const path = Mod.MakePathD(vec2ArrayToFlat(verts));
  const paths = new Mod.PathsD();
  paths.push_back(path);
  const result = Mod.UnionSelfD(paths, Mod.FillRule.NonZero, 2);
  const out: Vec2[][] = [];
  for (let i = 0; i < result.size(); i++) {
    out.push(pathDToVec2Array(result.get(i)));
  }
  return out.length > 0 ? out : [verts];
}

/** Subtract clip polygon from subject polygon. Returns one or more result polygons. */
export async function subtractPolygons(subject: Vec2[], clip: Vec2[]): Promise<Vec2[][]> {
  const Mod = await getClipper();
  const subjectPath = Mod.MakePathD(vec2ArrayToFlat(subject));
  const clipPath = Mod.MakePathD(vec2ArrayToFlat(clip));

  const subjectPaths = new Mod.PathsD();
  subjectPaths.push_back(subjectPath);
  const clipPaths = new Mod.PathsD();
  clipPaths.push_back(clipPath);

  const result = Mod.DifferenceD(subjectPaths, clipPaths, Mod.FillRule.NonZero, 2);

  const out: Vec2[][] = [];
  for (let i = 0; i < result.size(); i++) {
    const path = result.get(i);
    out.push(pathDToVec2Array(path));
  }
  return out;
}
