/** Base path; routes are `/list`, `/file` (see vite-plugin-local-document.ts). */
export const LOCAL_DOCUMENT_API = "/api/local-document";

/** Safe filename stem for `saves/<name>.json`. Returns null if empty or invalid after sanitizing. */
export function safeProjectFileName(name: string): string | null {
  const t = name
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!t || t.length > 80) return null;
  return t;
}

export async function fetchLocalProjectList(): Promise<string[] | null> {
  try {
    const r = await fetch(`${LOCAL_DOCUMENT_API}/list`);
    if (!r.ok) return null;
    const data = (await r.json()) as unknown;
    if (!Array.isArray(data)) return null;
    return data.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}

export function localProjectFileUrl(name: string): string {
  return `${LOCAL_DOCUMENT_API}/file?name=${encodeURIComponent(name)}`;
}

/** URL to load the floor plan image from `saves/<project>-floorplan.<ext>` (dev/preview API). */
export function floorplanImageUrl(projectName: string): string | null {
  const safe = safeProjectFileName(projectName);
  if (!safe) return null;
  return `${LOCAL_DOCUMENT_API}/floorplan?project=${encodeURIComponent(safe)}`;
}
