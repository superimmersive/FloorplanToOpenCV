import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Base path; must match `LOCAL_DOCUMENT_API` in `src/api/localDocument.ts`. */
export const LOCAL_DOCUMENT_PATH = "/api/local-document";

function listProjects(savesDir: string): string[] {
  if (!existsSync(savesDir)) return [];
  const names: string[] = [];
  for (const ent of readdirSync(savesDir, { withFileTypes: true })) {
    if (!ent.isFile() || !ent.name.endsWith(".json")) continue;
    const full = path.join(savesDir, ent.name);
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    names.push(ent.name.slice(0, -".json".length));
  }
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function safeNameParam(raw: string | null): string | null {
  if (raw == null || raw === "") return null;
  const t = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!t || t.length > 80) return null;
  return t;
}

function normalizeFloorplanExt(raw: string | null): string {
  if (raw == null || raw === "") return "png";
  let e = raw.trim().toLowerCase().replace(/^\./, "");
  if (e === "jpeg") e = "jpg";
  const allowed = new Set(["png", "jpg", "webp", "gif"]);
  return allowed.has(e) ? e : "png";
}

function findFloorplanPath(savesDir: string, projectSafe: string): string | null {
  const prefix = `${projectSafe}-floorplan.`;
  if (!existsSync(savesDir)) return null;
  for (const ent of readdirSync(savesDir, { withFileTypes: true })) {
    if (!ent.isFile() || !ent.name.startsWith(prefix)) continue;
    return path.join(savesDir, ent.name);
  }
  return null;
}

function removeFloorplanFiles(savesDir: string, projectSafe: string) {
  if (!existsSync(savesDir)) return;
  const prefix = `${projectSafe}-floorplan.`;
  for (const ent of readdirSync(savesDir, { withFileTypes: true })) {
    if (!ent.isFile() || !ent.name.startsWith(prefix)) continue;
    try {
      unlinkSync(path.join(savesDir, ent.name));
    } catch {
      /* ignore */
    }
  }
}

function mimeForFloorplan(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

function localDocumentMiddleware(savesDir: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (req: any, res: any, next: () => void) => {
    const pathname = req.url?.split("?")[0] ?? "";
    if (!pathname.startsWith(LOCAL_DOCUMENT_PATH)) return next();

    if (pathname === `${LOCAL_DOCUMENT_PATH}/list` && req.method === "GET") {
      const list = listProjects(savesDir);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(list));
      return;
    }

    if (pathname === `${LOCAL_DOCUMENT_PATH}/floorplan`) {
      const u = new URL(req.url ?? "", "http://localhost");
      const name = safeNameParam(u.searchParams.get("project"));
      if (!name) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Missing or invalid project");
        return;
      }

      if (req.method === "GET") {
        const fp = findFloorplanPath(savesDir, name);
        if (!fp) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("No floor plan file for this project");
          return;
        }
        const buf = readFileSync(fp);
        res.statusCode = 200;
        res.setHeader("Content-Type", mimeForFloorplan(fp));
        res.end(buf);
        return;
      }

      if (req.method === "POST") {
        const ext = normalizeFloorplanExt(u.searchParams.get("ext"));
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          try {
            mkdirSync(savesDir, { recursive: true });
            removeFloorplanFiles(savesDir, name);
            const filePath = path.join(savesDir, `${name}-floorplan.${ext}`);
            writeFileSync(filePath, Buffer.concat(chunks));
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("ok");
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end(e instanceof Error ? e.message : "write failed");
          }
        });
        return;
      }
    }

    if (pathname === `${LOCAL_DOCUMENT_PATH}/file`) {
      const u = new URL(req.url ?? "", "http://localhost");
      const name = safeNameParam(u.searchParams.get("name"));
      if (!name) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Missing or invalid name");
        return;
      }
      const filePath = path.join(savesDir, `${name}.json`);

      if (req.method === "GET") {
        if (!existsSync(filePath)) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Not found");
          return;
        }
        const body = readFileSync(filePath, "utf8");
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(body);
        return;
      }

      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          try {
            mkdirSync(savesDir, { recursive: true });
            const body = Buffer.concat(chunks).toString("utf8");
            writeFileSync(filePath, body, "utf8");
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("ok");
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end(e instanceof Error ? e.message : "write failed");
          }
        });
        return;
      }
    }

    res.statusCode = 404;
    res.end();
  };
}

/** GET/POST named files under `projectRoot/saves/*.json` (dev + preview only). */
export function localDocumentPlugin(projectRoot: string): Plugin {
  const savesDir = path.join(projectRoot, "saves");
  const mw = localDocumentMiddleware(savesDir);

  return {
    name: "local-document-api",
    configureServer(server) {
      server.middlewares.use(mw);
    },
    configurePreviewServer(server) {
      server.middlewares.use(mw);
    },
  };
}
