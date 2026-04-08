# SPDX-License-Identifier: MIT
# Import Vector JSON - Blender script for vector_export.json from the web app.
# Units in file: mm. Script converts to Blender meters (scale 0.001) so 1000 mm -> 1 m.
#
# Export v2+ may include buildingDefaults (wall/window heights, sill heights) and per-object
# doorHeightMm / windowSillHeightMm / etc. Mesh import still uses layer zPositionMm + extrusionHeightMm
# only; opening metadata is copied to custom properties for use in modifiers / manual modeling.

bl_info = {
    "name": "Import Vector JSON",
    "author": "Vector Editor",
    "version": (1, 0),
    "blender": (3, 0, 0),
    "location": "File > Import > Vector JSON (.json)",
    "description": "Import vector_export.json from the web vector editor (units: mm).",
    "category": "Import-Export",
}

import json
import math
from typing import Dict, Optional

import bpy
import bmesh
from bpy_extras.io_utils import ImportHelper


def load_json(filepath: str) -> dict:
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


# 1 unit in file = 1 mm. Blender default is meters.
MM_TO_M = 0.001

# Optional keys from web export (v2+) — stored as Blender custom properties, not used for mesh yet.
_OBJECT_META_KEYS = (
    "doorHeightMm",
    "doorSillHeightMm",
    "windowHeightMm",
    "windowSillHeightMm",
)


def _apply_building_defaults_to_scene(scene, building_defaults: dict) -> None:
    if not isinstance(building_defaults, dict):
        return
    prefix = "vector_json_"
    for k, v in building_defaults.items():
        if isinstance(v, (int, float)):
            scene[f"{prefix}{k}"] = float(v)


def _apply_object_meta(obj: bpy.types.Object, obj_data: dict) -> None:
    for k in _OBJECT_META_KEYS:
        if k not in obj_data:
            continue
        v = obj_data[k]
        if isinstance(v, bool):
            obj[k] = v
        elif isinstance(v, (int, float)):
            obj[k] = float(v)
        else:
            obj[k] = v


# Web app layer ids for wall centerlines (see editorState.ts).
_WALLS_LAYER_ID = "layer-walls"
_INNER_WALLS_LAYER_ID = "layer-inner-walls"
_WALL_HOST_LAYER_IDS = frozenset({_WALLS_LAYER_ID, _INNER_WALLS_LAYER_ID})
_OPENING_ITEM_IDS = frozenset({"wall-window", "single-door", "double-door"})


def _layer_id_for_object(objects_data: list, export_id: str) -> Optional[str]:
    for od in objects_data:
        if od.get("id") == export_id:
            return od.get("layerId")
    return None


def _add_wall_boolean_cutouts(
    obj_by_export_id: Dict[str, bpy.types.Object],
    objects_data: list,
) -> int:
    """Add Boolean Difference (solver Exact) on each wall for wall-hosted windows and doors.

    Each opening's ``wallWindowRef.wallId`` selects the wall mesh to cut. Outer walls
    (``layer-walls``) and inner/partition walls (``layer-inner-walls``) both receive
    the correct modifiers; door-item plan symbols (no ``wallWindowRef``) are not cutters.
    """
    count = 0
    for obj_data in objects_data:
        item_id = obj_data.get("itemId")
        if item_id not in _OPENING_ITEM_IDS:
            continue
        wref = obj_data.get("wallWindowRef") or {}
        wall_id = wref.get("wallId")
        if not wall_id:
            continue
        o_id = obj_data.get("id")
        if not o_id:
            continue
        cutter = obj_by_export_id.get(o_id)
        wall_obj = obj_by_export_id.get(wall_id)
        if cutter is None or wall_obj is None:
            print(
                f"Boolean cutout skipped: missing object(s) wallId={wall_id!r} opener={o_id!r}"
            )
            continue
        host_layer = _layer_id_for_object(objects_data, wall_id)
        if host_layer not in _WALL_HOST_LAYER_IDS:
            continue
        if not wall_obj.data or len(wall_obj.data.vertices) == 0:
            continue
        if not cutter.data or len(cutter.data.vertices) == 0:
            continue
        mod_name = f"Bool {o_id}"[:63]
        mod = wall_obj.modifiers.new(name=mod_name, type="BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.object = cutter
        # Exact solver (user request: "Extract" interpreted as Exact; not BMESH/Fast).
        if hasattr(mod, "solver"):
            try:
                mod.solver = "EXACT"
            except (TypeError, ValueError):
                mod.solver = "BMESH"
        count += 1
    if count:
        print(f"Added {count} wall Boolean Difference modifier(s) (operand = window/door mesh).")
    return count


def _stairs_cumulative_distances_mm(pts: list) -> list:
    """Cumulative distance along polyline from first point (mm)."""
    if not pts:
        return [0.0]
    dists = [0.0]
    for i in range(1, len(pts)):
        dx = float(pts[i][0]) - float(pts[i - 1][0])
        dy = float(pts[i][1]) - float(pts[i - 1][1])
        dists.append(dists[-1] + math.hypot(dx, dy))
    return dists


def cumulative_distance_to_closest_point_mm(pts: list, px: float, py: float) -> float:
    """Arc length from pts[0] to the closest point on the polyline to (px, py), in mm."""
    if len(pts) < 2:
        return 0.0
    best_d2 = float("inf")
    best_arc = 0.0
    cum = 0.0
    for i in range(len(pts) - 1):
        ax, ay = float(pts[i][0]), float(pts[i][1])
        bx, by = float(pts[i + 1][0]), float(pts[i + 1][1])
        dx, dy = bx - ax, by - ay
        seg_len_sq = dx * dx + dy * dy
        if seg_len_sq < 1e-18:
            continue
        t = ((px - ax) * dx + (py - ay) * dy) / seg_len_sq
        t = max(0.0, min(1.0, t))
        cx = ax + t * dx
        cy = ay + t * dy
        d2 = (px - cx) ** 2 + (py - cy) ** 2
        seg_len = math.sqrt(seg_len_sq)
        arc_here = cum + t * seg_len
        if d2 < best_d2:
            best_d2 = d2
            best_arc = arc_here
        cum += seg_len
    return best_arc


def _stairs_tangent_and_left_perp(pts: list, i: int) -> tuple:
    """Unit tangent (tx, ty) and left perpendicular (-ty, tx) in plan (mm)."""
    n = len(pts)
    if n < 2:
        return (1.0, 0.0), (0.0, 1.0)
    if i == 0:
        dx = float(pts[1][0]) - float(pts[0][0])
        dy = float(pts[1][1]) - float(pts[0][1])
    elif i == n - 1:
        dx = float(pts[i][0]) - float(pts[i - 1][0])
        dy = float(pts[i][1]) - float(pts[i - 1][1])
    else:
        dx = float(pts[i + 1][0]) - float(pts[i - 1][0])
        dy = float(pts[i + 1][1]) - float(pts[i - 1][1])
    ln = math.hypot(dx, dy)
    if ln < 1e-12:
        return (1.0, 0.0), (0.0, 1.0)
    tx, ty = dx / ln, dy / ln
    return (tx, ty), (-ty, tx)


def create_stairs_ramp_object(
    name: str,
    position: list,
    rotation_deg: float,
    scale_xy: list,
    centerline_mm: list,
    draw_width_mm: float,
    z_floor_m: float,
    extrusion_height_m: float,
) -> bpy.types.Object:
    """Ribbon along centerline: bottom at Z=0 (foundation); top ramps linearly by distance along path.

    First centerline point → local Z = 0; last point → Z = extrusion_height_m (wall height span).
    Object origin Z = layer foundation (zPositionMm).
    """
    n = len(centerline_mm)
    if n < 2:
        raise ValueError("stairs need at least 2 centerline points")
    scale_x = float(scale_xy[0]) if len(scale_xy) > 0 else 1.0
    scale_y = float(scale_xy[1]) if len(scale_xy) > 1 else 1.0
    half_w_m = max(float(draw_width_mm), 1.0) * 0.5 * MM_TO_M

    def xy_local_m(x_mm: float, y_mm: float) -> tuple:
        return (x_mm * scale_x * MM_TO_M, y_mm * scale_y * MM_TO_M)

    dists = _stairs_cumulative_distances_mm(centerline_mm)
    total = dists[-1]
    if total < 1e-12:
        total = 1.0

    def z_top_at(i: int) -> float:
        return (dists[i] / total) * extrusion_height_m

    mesh = bpy.data.meshes.new(name=name)
    obj = bpy.data.objects.new(name=name, object_data=mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    try:
        all_v = []
        for i in range(n):
            (tx, ty), (px, py) = _stairs_tangent_and_left_perp(centerline_mm, i)
            cx = float(centerline_mm[i][0])
            cy = float(centerline_mm[i][1])
            xm, ym = xy_local_m(cx, cy)
            lx = xm + px * half_w_m
            ly = ym + py * half_w_m
            rx = xm - px * half_w_m
            ry = ym - py * half_w_m
            zt = z_top_at(i)
            all_v.append(bm.verts.new((lx, ly, 0.0)))
            all_v.append(bm.verts.new((rx, ry, 0.0)))
            all_v.append(bm.verts.new((lx, ly, zt)))
            all_v.append(bm.verts.new((rx, ry, zt)))

        for i in range(n - 1):
            o = 4 * i
            lb0, rb0, lt0, rt0 = all_v[o : o + 4]
            lb1, rb1, lt1, rt1 = all_v[o + 4 : o + 8]
            bm.faces.new((lt0, rt0, rt1, lt1))
            bm.faces.new((lb0, lb1, rb1, rb0))
            bm.faces.new((lb0, lt0, lt1, lb1))
            bm.faces.new((rb0, rb1, rt1, rt0))

        lb0, rb0, lt0, rt0 = all_v[0:4]
        bm.faces.new((lb0, rb0, rt0, lt0))

        o = 4 * (n - 1)
        lb1, rb1, lt1, rt1 = all_v[o : o + 4]
        bm.faces.new((lb1, lt1, rt1, rb1))

        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()
    except Exception:
        bm.free()
        raise

    obj.location.x = float(position[0]) * MM_TO_M
    obj.location.y = float(position[1]) * MM_TO_M
    obj.location.z = z_floor_m
    obj.rotation_euler = (0, 0, math.radians(rotation_deg))
    return obj


def create_stairs_extruded_from_plan_shape(
    name: str,
    position: list,
    rotation_deg: float,
    scale_xy: list,
    polygons: list,
    centerline_mm: list,
    z_floor_m: float,
    extrusion_height_m: float,
) -> bpy.types.Object:
    """Build stairs from exported plan face(s): bottom at Z=0; top ramps by distance along centerline.

    Elevation: first centerline point → top Z = 0; last point → top Z = extrusion_height_m (wall height).
    Each extruded vertex gets Z = t * extrusion_height_m where t is normalized arc length to closest
    point on centerline (mm). Object Z = foundation (layer zPositionMm). Outer contours only (holes ignored).
    """
    poly_list = [p for p in (polygons or []) if isinstance(p, dict) and p.get("verts")]
    if not poly_list:
        raise ValueError("stairs extrude-from-shape needs polygon verts")
    if any(len(p["verts"]) < 3 for p in poly_list):
        raise ValueError("stairs polygon needs at least 3 vertices per face")

    use_elevation = isinstance(centerline_mm, list) and len(centerline_mm) >= 2
    dists = _stairs_cumulative_distances_mm(centerline_mm) if use_elevation else [0.0]
    total = dists[-1] if dists else 0.0
    if total < 1e-12:
        total = 1.0

    scale_x = float(scale_xy[0]) if len(scale_xy) > 0 else 1.0
    scale_y = float(scale_xy[1]) if len(scale_xy) > 1 else 1.0
    sx = scale_x * MM_TO_M
    sy = scale_y * MM_TO_M

    mesh = bpy.data.meshes.new(name=name)
    obj = bpy.data.objects.new(name=name, object_data=mesh)
    bpy.context.collection.objects.link(obj)

    flip_plan_winding = True
    bm = bmesh.new()
    try:
        for poly in poly_list:
            verts_xy = poly["verts"]
            create_mesh_from_polygon(
                bm,
                verts_xy,
                holes_xy=[],
                scale_xy=(scale_xy[0], scale_xy[1]),
                flip_plan_winding=flip_plan_winding,
            )
        # Merge coincident verts from adjacent quads (L-shape stair = 8 unique positions).
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        if extrusion_height_m <= 0 or not bm.faces:
            bm.to_mesh(mesh)
            bm.free()
            obj.location.x = float(position[0]) * MM_TO_M
            obj.location.y = float(position[1]) * MM_TO_M
            obj.location.z = z_floor_m
            obj.rotation_euler = (0, 0, math.radians(rotation_deg))
            return obj

        ret = bmesh.ops.extrude_face_region(bm, geom=list(bm.faces))
        new_verts = [v for v in ret["geom"] if isinstance(v, bmesh.types.BMVert)]
        if use_elevation and extrusion_height_m > 0:
            for v in new_verts:
                x_m, y_m, _z = v.co
                px_mm = x_m / sx
                py_mm = y_m / sy
                arc = cumulative_distance_to_closest_point_mm(centerline_mm, px_mm, py_mm)
                t = max(0.0, min(1.0, arc / total))
                v.co.z = t * extrusion_height_m
        else:
            bmesh.ops.translate(bm, vec=(0, 0, extrusion_height_m), verts=new_verts)

        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()
    except Exception:
        bm.free()
        raise

    obj.location.x = float(position[0]) * MM_TO_M
    obj.location.y = float(position[1]) * MM_TO_M
    obj.location.z = z_floor_m
    obj.rotation_euler = (0, 0, math.radians(rotation_deg))
    return obj


def create_mesh_from_polygon(
    bm: bmesh.types.BMesh,
    verts_xy: list,
    holes_xy: list = None,
    scale_xy: tuple = (1.0, 1.0),
    flip_plan_winding: bool = True,
) -> None:
    """Add vertices and face(s) for one polygon. Vertices in mm; applied scale_xy (object scale).
    If flip_plan_winding is True, reverse vertex order so face normals are +Z (web app walls are CW).
    Foundation, floor, and skirting strips are CCW (+Z on the base face, extrusion upward). Pass
    flip_plan_winding=False for itemId foundation, floor, floor-skirting, or ceiling-skirting.
    Ceiling slab (itemId ceiling) should face downward: pass flip_plan_winding=True so normals are -Z.
    """
    holes_xy = holes_xy or []
    scale_x, scale_y = scale_xy

    # Convert to 3D (Z=0) in meters
    def to_3d(pts):
        return [
            (x * scale_x * MM_TO_M, y * scale_y * MM_TO_M, 0.0)
            for x, y in pts
        ]

    outer = to_3d(verts_xy)
    holes_3d = [to_3d(h) for h in holes_xy]

    if not holes_3d:
        # Simple polygon: one face. Vert order from the app is typically CW in plan view,
        # which yields face normals along -Z; we want +Z for extrusion / booleans.
        bverts = [bm.verts.new(v) for v in outer]
        if flip_plan_winding:
            bverts.reverse()
        bm.faces.new(bverts)
        return

    # Polygon with holes: triangulate by fanning from first outer vertex
    # (simple approach: one triangle per ear; holes become inner boundaries)
    # Blender bmesh: create outer face, then try to add hole by creating a single
    # combined face with a "bridge". We'll use a simple method: create outer face,
    # then for each hole create a face (so hole is filled). Then we need to remove
    # the hole faces and have the outer face have a hole - not trivial in bmesh.
    # So we triangulate: add all verts (outer + holes), then add triangles.
    # Ear-clipping would need to handle holes; simpler: use bmesh.ops.triangulate.
    # So: add outer verts, make outer face, add hole verts, make hole faces,
    # then bmesh.ops.delete(bm, geom=hole_faces, context='FACES') - but that leaves
    # a hole. Actually deleting the hole face just removes that face; the outer
    # face still exists. So we have outer face + hole "face" (filled). If we
    # delete the hole face we have a gap (no face there) but the outer face
    # doesn't have a hole - we have open boundary. So we need to merge: outer
    # boundary and hole boundary into one face with two loops. In bmesh you
    # can have a face with multiple loops (outer + inner). So we need to create
    # that. In bmesh: bm.faces.new(outer_verts) creates one loop. To add an
    # inner loop we'd need to use the C API or a workaround. Workaround: use
    # bmesh.ops.connect_verts to add two edges from outer to hole, making one
    # continuous loop (with a "keyhole"). Then create one face from that loop.
    # The loop order: outer[0..i], hole[0..n], hole[0], outer[i..0]. So we
    # need to duplicate one vertex from outer and one from hole. So we have
    # outer_verts + hole_verts, then face = [o0, o1, ..., o_i, h0, h1, ..., h_n, h0, o_i, o_{i+1}, ...].
    # That's a single loop. Add as one face. But the winding might be wrong
    # (inner hole winding should be opposite to outer for correct normal).
    # Let me try: create face with outer only; then use bmesh.ops.bridge_loops
    # to connect outer to hole - that might create a tunnel. Actually the
    # simplest for now: polygons with holes -> create only the outer face
    # and log a message.
    bverts_outer = [bm.verts.new(v) for v in outer]
    if flip_plan_winding:
        bverts_outer.reverse()
    bm.faces.new(bverts_outer)
    if holes_3d:
        # Create hole faces as separate faces (so they appear as filled);
        # user can apply a Boolean modifier to subtract if needed.
        for hole in holes_3d:
            bverts_hole = [bm.verts.new(v) for v in hole]
            if flip_plan_winding:
                bverts_hole.reverse()
            bm.faces.new(bverts_hole)
        print("Note: Polygons with holes imported as outer + filled hole faces. Use Boolean modifier to cut holes if needed.")


def create_object_from_export_obj(
    name: str,
    position: list,
    rotation_deg: float,
    scale_xy: list,
    polygons: list,
    z_position_m: float = 0.0,
    extrusion_height_m: float = 0.0,
    item_id: Optional[str] = None,
) -> bpy.types.Object:
    """Create a single Blender mesh object from one export object.
    z_position_m: object location Z (meters). extrusion_height_m: extrude flat mesh by this (meters).
    """
    mesh = bpy.data.meshes.new(name=name)
    obj = bpy.data.objects.new(name=name, object_data=mesh)
    bpy.context.collection.objects.link(obj)

    # Foundation / floor / skirting quads are CCW in plan (+Z on the horizontal face, extrusion +Z). Ceiling
    # slab uses the same vertex order but should face down (-Z), so flip like walls. Other shapes are CW.
    flip_plan_winding = item_id not in ("foundation", "floor", "floor-skirting", "ceiling-skirting")

    bm = bmesh.new()
    try:
        for poly in polygons:
            verts_xy = poly["verts"]
            holes_xy = poly.get("holes") or []
            create_mesh_from_polygon(
                bm,
                verts_xy,
                holes_xy=holes_xy,
                scale_xy=(scale_xy[0], scale_xy[1]),
                flip_plan_winding=flip_plan_winding,
            )
        if extrusion_height_m > 0 and bm.faces:
            ret = bmesh.ops.extrude_face_region(bm, geom=list(bm.faces))
            new_verts = [v for v in ret["geom"] if isinstance(v, bmesh.types.BMVert)]
            if new_verts:
                bmesh.ops.translate(bm, vec=(0, 0, extrusion_height_m), verts=new_verts)
        bm.to_mesh(mesh)
        bm.free()
    except Exception:
        bm.free()
        raise

    obj.location.x = position[0] * MM_TO_M
    obj.location.y = position[1] * MM_TO_M
    obj.location.z = z_position_m
    obj.rotation_euler = (0, 0, math.radians(rotation_deg))
    return obj


def import_vector_json(filepath: str) -> set:
    """Import vector_export.json and create mesh objects. Uses layers for Z and extrusion height."""
    data = load_json(filepath)
    if data.get("units") != "mm":
        print("Warning: Expected units 'mm' in JSON.")
    ver = data.get("version")
    if ver is not None and ver != 2:
        print(f"Note: JSON version is {ver!r}; this add-on targets version 2.")
    building_defaults = data.get("buildingDefaults")
    if isinstance(building_defaults, dict):
        _apply_building_defaults_to_scene(bpy.context.scene, building_defaults)
    layers_data = data.get("layers", [])
    layer_by_id = {l["id"]: l for l in layers_data}
    objects_data = data.get("objects", [])
    created = set()
    obj_by_export_id: Dict[str, bpy.types.Object] = {}
    for obj_data in objects_data:
        obj_id = obj_data.get("id", "VectorObject")
        position = obj_data.get("position", [0, 0])
        rotation_deg = obj_data.get("rotationDeg", 0)
        scale_xy = obj_data.get("scale", [1, 1])
        polygons = obj_data.get("polygons", [])
        layer_id = obj_data.get("layerId")
        z_position_m = 0.0
        extrusion_height_m = 0.0
        layer = layer_by_id.get(layer_id) if layer_id else None
        if layer:
            z_position_m = layer.get("zPositionMm", 0) * MM_TO_M
            extrusion_height_m = layer.get("extrusionHeightMm", 0) * MM_TO_M
        # Blender object name reflects layer name from the web editor (e.g. "Walls - obj-1")
        name = f"{layer['name']} - {obj_id}" if layer else obj_id
        item_id = obj_data.get("itemId")
        cl = obj_data.get("centerline") or []
        if item_id == "stairs" and isinstance(cl, list) and len(cl) >= 2:
            poly0 = polygons[0] if polygons else {}
            verts0 = poly0.get("verts") if isinstance(poly0, dict) else None
            if verts0 and len(verts0) >= 3:
                try:
                    obj = create_stairs_extruded_from_plan_shape(
                        name=name,
                        position=position,
                        rotation_deg=rotation_deg,
                        scale_xy=scale_xy,
                        polygons=polygons,
                        centerline_mm=cl,
                        z_floor_m=z_position_m,
                        extrusion_height_m=extrusion_height_m,
                    )
                    print(
                        "Stairs: plan extrusion with elevation along centerline "
                        f"(foundation Z={z_position_m:.4f} m, run rises 0 → {extrusion_height_m:.4f} m → "
                        f"world top ≈ {z_position_m + extrusion_height_m:.4f} m at end)."
                    )
                except Exception as ex:
                    print(f"Stairs extrude-from-shape failed ({ex}); using centerline ribbon fallback.")
                    dw = obj_data.get("drawWidthMm")
                    try:
                        dw_f = float(dw) if dw is not None else 1000.0
                    except (TypeError, ValueError):
                        dw_f = 1000.0
                    obj = create_stairs_ramp_object(
                        name=name,
                        position=position,
                        rotation_deg=rotation_deg,
                        scale_xy=scale_xy,
                        centerline_mm=cl,
                        draw_width_mm=dw_f,
                        z_floor_m=z_position_m,
                        extrusion_height_m=extrusion_height_m,
                    )
                    print(
                        f"Stairs ribbon (fallback): elevation 0 → {extrusion_height_m:.4f} m along path; "
                        f"world Z ≈ {z_position_m:.4f} … {z_position_m + extrusion_height_m:.4f} m."
                    )
            else:
                dw = obj_data.get("drawWidthMm")
                try:
                    dw_f = float(dw) if dw is not None else 1000.0
                except (TypeError, ValueError):
                    dw_f = 1000.0
                obj = create_stairs_ramp_object(
                    name=name,
                    position=position,
                    rotation_deg=rotation_deg,
                    scale_xy=scale_xy,
                    centerline_mm=cl,
                    draw_width_mm=dw_f,
                    z_floor_m=z_position_m,
                    extrusion_height_m=extrusion_height_m,
                )
                print(
                    f"Stairs ribbon (no polygon): elevation along centerline; "
                    f"world Z ≈ {z_position_m:.4f} … {z_position_m + extrusion_height_m:.4f} m."
                )
        else:
            obj = create_object_from_export_obj(
                name=name,
                position=position,
                rotation_deg=rotation_deg,
                scale_xy=scale_xy,
                polygons=polygons,
                z_position_m=z_position_m,
                extrusion_height_m=extrusion_height_m,
                item_id=item_id,
            )
        _apply_object_meta(obj, obj_data)
        obj_by_export_id[obj_id] = obj
        created.add(obj.name)

    _add_wall_boolean_cutouts(obj_by_export_id, objects_data)
    return created


class IMPORT_OT_vector_json(bpy.types.Operator, ImportHelper):
    """Import Vector JSON (mm) from the web app; creates flat meshes in Blender with correct scale (1 unit = 1 mm -> 0.001 m)."""
    bl_idname = "import_shape.vector_json"
    bl_label = "Import Vector JSON"
    bl_options = {"REGISTER", "UNDO"}

    filename_ext = ".json"
    filter_glob: bpy.props.StringProperty(default="*.json", options={"HIDDEN"})

    def execute(self, context):
        try:
            created = import_vector_json(self.filepath)
            self.report({"INFO"}, f"Imported {len(created)} object(s): {', '.join(created)}")
            return {"FINISHED"}
        except Exception as e:
            self.report({"ERROR"}, str(e))
            return {"CANCELLED"}


def menu_import(self, context):
    self.layout.operator(IMPORT_OT_vector_json.bl_idname, text="Vector JSON (.json)")


def register():
    bpy.utils.register_class(IMPORT_OT_vector_json)
    bpy.types.TOPBAR_MT_file_import.append(menu_import)


def unregister():
    bpy.types.TOPBAR_MT_file_import.remove(menu_import)
    bpy.utils.unregister_class(IMPORT_OT_vector_json)


if __name__ == "__main__":
    register()
