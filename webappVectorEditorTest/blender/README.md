# Blender import for Vector Editor export

This folder contains a Blender script that imports the JSON exported from the web vector editor.

**FBX meshes:** store local `.fbx` assets in [`fbx/`](./fbx/) (not used automatically by the JSON importer unless you extend the script).

## Units

- **Export (web app):** 1 unit = 1 mm.
- **Blender:** The script converts to **meters** (× 0.001). So a 1000×1000 mm square in the editor becomes a 1×1 m square in Blender when using default Blender units.

## How to use

### One-time: Install the script as an add-on

1. In Blender, go to **Edit → Preferences → Add-ons**.
2. Click **Install…** and choose `import_vector_json.py` from this folder.
3. Enable the add-on (search for "Vector JSON" or "Import Vector JSON").

### Import a file

1. Export your shapes from the web app (**Export** button → saves `vector_export.json`).
2. In Blender: **File → Import → Vector JSON (.json)**.
3. Select your `vector_export.json` file.

The script creates one mesh object per exported object, flat on the XY plane (Z = 0), with the correct scale and position.

### Run the script without installing

1. In Blender, open the **Scripting** workspace.
2. Open `import_vector_json.py` (or paste its contents).
3. Run the script (click the play button or Alt+P).
4. Use **File → Import → Vector JSON (.json)** to pick your JSON file.

## JSON format

The export uses:

- `units`: `"mm"`
- `objects`: array of objects, each with `id`, `position`, `rotationDeg`, `scale`, and `polygons` (each polygon has `verts` and optional `holes`).

Polygons with holes are imported as the outer contour plus separate faces for each hole; you can use a Boolean modifier to subtract the holes if you need proper cutouts.

## Wall-hosted openings (windows / doors)

Wall-anchored objects in the export include `wallWindowRef.wallId` pointing at the **wall centerline object id** (same `id` as in `objects[]`). The importer adds a **Boolean Difference** on that wall mesh, using the opening’s extruded mesh as the cutter—so each door or window is applied to **the wall it belongs to**.

This works for **outer walls** (`layer-walls`) and **inner / partition walls** (`layer-inner-walls`). Plan-only door symbols on the “Door items” layer do not carry `wallWindowRef`; the hosted opening on the Doors layer is what gets boolean-cut into the wall.

### Stairs (`itemId`: `stairs`)

The importer prefers the **exported plan polygon** (the same stroke outline as in the editor): it builds the **bottom face** with `extrude_face_region` (like walls), then sets each **extruded** vertex’s **Z** from **distance along the centerline**—closest point on the polyline to that vertex’s plan position. The **first** centerline point corresponds to **floor** (layer Z), the **last** to **floor + extrusion** (wall height); **t = arc length / total run length**, clamped to [0, 1].

If the polygon is missing or invalid, it falls back to a **centerline ribbon** built from **`drawWidthMm`**.
