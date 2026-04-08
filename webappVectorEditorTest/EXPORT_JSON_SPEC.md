# Vector Export JSON – Spec for Implementers

Use this spec to implement JSON export in **your** application so the output can be imported into Blender using the script in `blender/import_vector_json.py`. The format is already implemented by the web vector editor in this repo; your implementation must match this schema and conventions exactly.

---

## 1. Root schema

Produce a single JSON object with these top-level keys:

| Key       | Type    | Required | Description |
|----------|---------|----------|-------------|
| `units`  | string  | Yes      | Must be `"mm"`. All lengths and coordinates are in millimetres. |
| `version`| number  | Yes      | Must be `1`. |
| `layers` | array   | Yes      | Array of layer descriptors (see below). Used for Z position and extrusion height in Blender. |
| `objects`| array   | Yes      | Array of object descriptors (see below). |

---

## 2. Layer descriptor

Each element of `layers` is an object with:

| Key                | Type   | Required | Description |
|--------------------|--------|----------|-------------|
| `id`               | string | Yes      | Unique id (e.g. `"layer-base"`). Objects reference this via `layerId`. |
| `name`             | string | Yes      | Display name (e.g. `"Base"`). |
| `zPositionMm`      | number | Yes      | Z position in mm. Blender uses this for object location Z. |
| `extrusionHeightMm`| number | Yes      | Extrusion height in mm. Blender extrudes the flat mesh by this amount in Z. |

---

## 3. Object descriptor

Each element of `objects` is an object with:

| Key           | Type   | Required | Description |
|---------------|--------|----------|-------------|
| `id`          | string | Yes      | Unique identifier for this object (e.g. `"obj-1"`). |
| `layerId`     | string | Yes      | Id of the layer this object belongs to (must match a `layers[].id`). |
| `position`    | array  | Yes      | 2D position `[x, y]` in mm. Applied as object location in Blender (X, Y). Z comes from the layer. |
| `rotationDeg`| number | Yes      | Rotation around Z in **degrees** (counter‑clockwise positive). |
| `scale`       | array  | Yes      | 2D scale `[sx, sy]` (e.g. `[1, 1]`). Applied to vertex positions before position/rotation. |
| `polygons`    | array  | Yes      | Array of polygon descriptors (see below). |

---

## 4. Polygon descriptor

Each polygon has:

| Key    | Type   | Required | Description |
|--------|--------|----------|-------------|
| `id`   | string | Yes      | Unique id for the polygon (e.g. `"poly-1"`). |
| `verts`| array  | Yes      | Array of 2D points `[x, y]` in mm. **Outer contour**, closed (first point need not repeat at end). Order: **counter‑clockwise** for outer boundary. |
| `holes`| array  | No       | If present: array of contours, each an array of `[x, y]` in mm. **Holes** are inner boundaries; each hole is one contour. Order for each hole: **clockwise** (opposite to outer). Omit or use empty array if no holes. |

---

## 5. Coordinate system (match the web editor and Blender)

- **Units:** millimetres (mm) everywhere.
- **Axes (right‑handed, view along -Z):**
  - **X** → right (positive X to the right).
  - **Y** → up (positive Y upward).
  - **Z** → out of screen (not used in 2D; Blender import uses Z = 0).
- **Polygon winding:**
  - Outer contour: **counter‑clockwise** (CCW).
  - Hole contours: **clockwise** (CW).
- Vertices are in **object‑local** space. The importer applies `scale`, then `rotationDeg` around Z, then `position` (in that order conceptually; implementation may bake scale into vertices and set object transform).

---

## 6. Example (minimal)

```json
{
  "units": "mm",
  "version": 1,
  "layers": [
    { "id": "layer-base", "name": "Base", "zPositionMm": 0, "extrusionHeightMm": 0 }
  ],
  "objects": [
    {
      "id": "obj-1",
      "layerId": "layer-base",
      "position": [0, 0],
      "rotationDeg": 0,
      "scale": [1, 1],
      "polygons": [
        {
          "id": "poly-1",
          "verts": [[0, 0], [1000, 0], [1000, 1000], [0, 1000]],
          "holes": []
        }
      ]
    }
  ]
}
```

This is a 1000×1000 mm square (1 m × 1 m), which the Blender script will import as a 1×1 m flat mesh (script uses 0.001 to convert mm → m).

---

## 7. Example (with one hole)

```json
{
  "units": "mm",
  "version": 1,
  "layers": [
    { "id": "layer-base", "name": "Base", "zPositionMm": 0, "extrusionHeightMm": 0 }
  ],
  "objects": [
    {
      "id": "obj-1",
      "layerId": "layer-base",
      "position": [0, 0],
      "rotationDeg": 0,
      "scale": [1, 1],
      "polygons": [
        {
          "id": "poly-1",
          "verts": [[0, 0], [1000, 0], [1000, 1000], [0, 1000]],
          "holes": [
            [[250, 250], [250, 750], [750, 750], [750, 250]]
          ]
        }
      ]
    }
  ]
}
```

Outer: 1000×1000 mm CCW. One hole: 500×500 mm inner rectangle, CW.

---

## 8. Implementation checklist for your agent

1. Output UTF-8 JSON with root keys: `units` (string `"mm"`), `version` (number `1`), `layers` (array), `objects` (array).
2. For each layer, emit one element in `layers` with `id`, `name`, `zPositionMm`, `extrusionHeightMm`.
3. For each logical “object” in your app, emit one element in `objects` with `id`, `layerId`, `position` `[x, y]`, `rotationDeg`, `scale` `[sx, sy]`, and `polygons`.
4. For each polygon, emit `id`, `verts` (array of `[x, y]` in mm, CCW for outer), and optionally `holes` (array of contours, each CW).
5. Use **mm** for all coordinates and lengths; ensure your axes match (X right, Y up).
6. Save the file (e.g. `vector_export.json`) so the user can open it in Blender via **File → Import → Vector JSON (.json)** using the script in `blender/import_vector_json.py`.

---

## 9. Reference implementation

- **Schema and export logic (this repo):** `webappVectorEditorTest/src/geometry/exportJson.ts`
- **Blender importer:** `webappVectorEditorTest/blender/import_vector_json.py`

If your output matches this spec, it will import with correct scale (1 mm in file = 0.001 m in Blender) and orientation (X right, Y up, Z = 0).
