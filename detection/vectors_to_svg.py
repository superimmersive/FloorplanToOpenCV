"""
Convert vectors.json to SVG files (one per layer) in the SVG folder.

Usage:
  python vectors_to_svg.py
  python vectors_to_svg.py --vectors output/json/vectors.json --out-dir SVG
"""

import argparse
import json
import os
import sys

# Fill and stroke per layer (for standalone SVGs)
LAYER_STYLES = {
    "walls": {"fill": "#5064dc", "stroke": "#3030a0", "stroke_width": "2"},
    "doors": {"fill": "#00c8c8", "stroke": "#008080", "stroke_width": "2"},
    "windows": {"fill": "#00a0dc", "stroke": "#006080", "stroke_width": "2"},
    "fixtures": {"fill": "#78c864", "stroke": "#408040", "stroke_width": "2"},
    "kitchen_counter": {"fill": "#b4b400", "stroke": "#808000", "stroke_width": "2"},
    "rooms": {"fill": "#4caf50", "stroke": "#2e7d32", "stroke_width": "1"},
}
ROOM_FILLS = ["#4caf50", "#2196f3", "#ff9800", "#9c27b0", "#00bcd4", "#ff5722", "#e91e63", "#cddc39"]


def polygon_to_svg_points(polygon: list) -> str:
    """Convert [[x,y], ...] to SVG points string 'x1,y1 x2,y2 ...'."""
    return " ".join(f"{p[0]},{p[1]}" for p in polygon)


def write_layer_svg(w: int, h: int, layer_name: str, polygons: list,
                   styles: dict, path: str, room_labels: list = None) -> None:
    """Write one SVG file for a single layer."""
    style = styles.get(layer_name, {"fill": "#888", "stroke": "#000", "stroke_width": "1"})
    fill = style["fill"]
    stroke = style["stroke"]
    sw = style["stroke_width"]

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">',
        f'  <g id="{layer_name}" stroke="{stroke}" stroke-width="{sw}">',
    ]
    if room_labels is not None:
        # rooms: list of { id, label, polygon }; one color per room
        for i, item in enumerate(polygons):
            if not isinstance(item, dict):
                continue
            poly = item.get("polygon", [])
            if len(poly) >= 3:
                pts = polygon_to_svg_points(poly)
                fill = ROOM_FILLS[i % len(ROOM_FILLS)]
                lines.append(f'    <polygon points="{pts}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" />')
        # Add text labels (centroid)
        for item in polygons:
            if not isinstance(item, dict):
                continue
            poly = item.get("polygon", [])
            label = item.get("label", "")
            if len(poly) >= 3 and label:
                xs = [p[0] for p in poly]
                ys = [p[1] for p in poly]
                cx = sum(xs) / len(xs)
                cy = sum(ys) / len(ys)
                lines.append(f'    <text x="{cx:.0f}" y="{cy:.0f}" font-size="14" fill="#000" text-anchor="middle">{label}</text>')
    else:
        lines[2] = f'  <g id="{layer_name}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}">'
        for poly in polygons:
            if len(poly) >= 3:
                pts = polygon_to_svg_points(poly)
                lines.append(f'    <polygon points="{pts}" />')
    lines.append("  </g>")
    lines.append("</svg>")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def vectors_to_svg(vectors_path: str, out_dir: str) -> None:
    """Read vectors.json and write one SVG per layer into out_dir."""
    if not os.path.isfile(vectors_path):
        raise FileNotFoundError(f"Vectors not found: {vectors_path}")

    with open(vectors_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    w, h = data.get("image_size", [0, 0])
    if w <= 0 or h <= 0:
        raise ValueError("vectors.json must contain image_size [width, height]")

    os.makedirs(out_dir, exist_ok=True)

    # Walls, doors, windows, fixtures, kitchen_counter: list of polygons
    for key in ("walls", "doors", "windows", "fixtures", "kitchen_counter"):
        polygons = data.get(key, [])
        if not polygons:
            continue
        path = os.path.join(out_dir, f"{key}.svg")
        write_layer_svg(w, h, key, polygons, LAYER_STYLES, path)
        print(f"  {path}")

    # Rooms: list of { id, label, polygon }
    rooms = data.get("rooms", [])
    if rooms:
        path = os.path.join(out_dir, "rooms.svg")
        write_layer_svg(w, h, "rooms", rooms, LAYER_STYLES, path, room_labels=True)
        print(f"  {path}")


def main():
    parser = argparse.ArgumentParser(description="Convert vectors.json to SVG files")
    parser.add_argument("--vectors", default="detection/output/json/vectors.json", help="Path to vectors.json")
    parser.add_argument("--out-dir", default="detection/SVG", help="Output directory for SVG files")
    args = parser.parse_args()

    try:
        vectors_to_svg(args.vectors, args.out_dir)
        print(f"Saved SVGs to: {os.path.abspath(args.out_dir)}")
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        sys.exit(1)
    except ValueError as e:
        print(e, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
