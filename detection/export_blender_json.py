"""
Export detection vectors to Blender-compatible JSON format.

Reads vectors.json and scale from measurements.json, converts pixels to mm,
flips Y for Blender (Y-up), and outputs the format from EXPORT_JSON_SPEC.md.

Test: walls only.

Usage:
  python export_blender_json.py --output-dir detection/output
  python export_blender_json.py --vectors detection/output/json/vectors.json --out detection/output/json/walls_blender.json
"""

import argparse
import json
import os
import sys


def _signed_area_2d(verts: list) -> float:
    """Shoelace formula. Positive = CCW, negative = CW."""
    n = len(verts)
    if n < 3:
        return 0.0
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += verts[i][0] * verts[j][1] - verts[j][0] * verts[i][1]
    return area * 0.5


def _ensure_ccw(verts: list) -> list:
    """Return vertices in CCW order (Blender outer contour)."""
    if _signed_area_2d(verts) >= 0:
        return verts
    return list(reversed(verts))


def _px_to_mm(x_px: float, y_px: float, img_w: int, img_h: int,
              scale_mm_per_px: float) -> tuple[float, float]:
    """Convert pixel coords to mm. Flip Y so Blender Y is up."""
    x_mm = x_px * scale_mm_per_px
    y_mm = (img_h - y_px) * scale_mm_per_px
    return (x_mm, y_mm)


def export_walls_blender(vectors_path: str, measurements_path: str,
                         out_path: str) -> None:
    """
    Export walls from vectors.json to Blender-compatible JSON.
    """
    if not os.path.isfile(vectors_path):
        raise FileNotFoundError(f"Vectors not found: {vectors_path}")

    with open(vectors_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    walls = data.get("walls", [])
    if not walls:
        print("No walls in vectors.json")
        sys.exit(1)

    img_w, img_h = data.get("image_size", [0, 0])
    if img_w <= 0 or img_h <= 0:
        raise ValueError("Missing or invalid image_size in vectors.json")

    scale_mm_per_px = 6.0  # fallback
    if os.path.isfile(measurements_path):
        with open(measurements_path, "r", encoding="utf-8") as f:
            m = json.load(f)
        scale_mm_per_px = m.get("scale_mm_per_px", scale_mm_per_px)
    else:
        dim_path = os.path.join(os.path.dirname(measurements_path), "dim_lines.json")
        if os.path.isfile(dim_path):
            with open(dim_path, "r", encoding="utf-8") as f:
                d = json.load(f)
            scale_mm_per_px = d.get("scale_mm_per_px", scale_mm_per_px)

    print(f"Scale: {scale_mm_per_px} mm/px, image: {img_w}x{img_h}")

    polygons = []
    for i, poly_px in enumerate(walls):
        if len(poly_px) < 3:
            continue
        verts_mm = []
        for pt in poly_px:
            x_px, y_px = pt[0], pt[1]
            x_mm, y_mm = _px_to_mm(x_px, y_px, img_w, img_h, scale_mm_per_px)
            verts_mm.append([round(x_mm, 2), round(y_mm, 2)])
        verts_mm = _ensure_ccw(verts_mm)
        polygons.append({
            "id": f"wall-{i + 1}",
            "verts": verts_mm,
            "holes": [],
        })

    output = {
        "units": "mm",
        "version": 1,
        "objects": [
            {
                "id": "walls",
                "position": [0, 0],
                "rotationDeg": 0,
                "scale": [1, 1],
                "polygons": polygons,
            }
        ],
    }

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)

    print(f"Saved: {out_path}")
    print(f"  walls: {len(polygons)} polygons")


def main():
    parser = argparse.ArgumentParser(
        description="Export walls to Blender-compatible JSON"
    )
    parser.add_argument("--output-dir", default="",
                       help="Output root (json/ under this)")
    parser.add_argument("--vectors", default="",
                       help="Path to vectors.json")
    parser.add_argument("--out", default="",
                       help="Output path (default: <json-dir>/walls_blender.json)")
    args = parser.parse_args()

    if args.output_dir:
        json_dir = os.path.join(args.output_dir, "json")
        vectors_path = args.vectors or os.path.join(json_dir, "vectors.json")
        measurements_path = os.path.join(json_dir, "measurements.json")
        out_path = args.out or os.path.join(json_dir, "walls_blender.json")
    else:
        json_dir = os.path.dirname(args.vectors) or "detection/output/json"
        vectors_path = args.vectors or "detection/output/json/vectors.json"
        measurements_path = os.path.join(json_dir, "measurements.json")
        out_path = args.out or os.path.join(json_dir, "walls_blender.json")

    export_walls_blender(vectors_path, measurements_path, out_path)


if __name__ == "__main__":
    main()
