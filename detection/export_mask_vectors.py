"""
Export mask images to editable vector data (polygons as JSON).

Reads each mask from output/masks/, runs findContours + approxPolyDP,
and writes a single vectors.json with polygons per layer. The web app
can consume this for editable vector UI and optionally rasterize back to masks.

Usage:
  python export_mask_vectors.py --masks-dir output/masks --json-dir output/json --out output/json/vectors.json
  python export_mask_vectors.py --output-dir output   # uses output/masks, output/json, writes output/json/vectors.json
"""

import argparse
import json
import os
import sys

import cv2
import numpy as np


def contour_to_polygon(contour: np.ndarray, epsilon: float = 3.0) -> list:
    """Simplify contour to polygon (list of [x, y])."""
    if contour is None or len(contour) < 3:
        return []
    approx = cv2.approxPolyDP(contour, epsilon, True)
    return [[int(p[0][0]), int(p[0][1])] for p in approx]


def mask_to_polygons(mask: np.ndarray, epsilon: float = 3.0,
                     min_area: int = 50) -> list:
    """
    Extract polygons from a binary mask (one polygon per connected component).
    Returns list of polygons, each polygon = list of [x, y].
    """
    if mask is None or mask.size == 0:
        return []
    if mask.ndim > 2:
        mask = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(
        binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    polygons = []
    for c in contours:
        if cv2.contourArea(c) < min_area:
            continue
        poly = contour_to_polygon(c, epsilon)
        if len(poly) >= 3:
            polygons.append(poly)
    return polygons


def labeled_mask_to_regions(mask: np.ndarray, id_to_label: dict,
                            epsilon: float = 3.0) -> list:
    """
    Extract one polygon per labeled region (e.g. rooms_mask with values 30, 60, ...).
    Returns list of { "id": int, "label": str, "polygon": [[x,y], ...] }.
    """
    if mask is None or mask.size == 0:
        return []
    if mask.ndim > 2:
        mask = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)
    out = []
    unique = np.unique(mask)
    for val in unique:
        if val == 0:
            continue
        binary = (mask == val).astype(np.uint8) * 255
        contours, _ = cv2.findContours(
            binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        if not contours:
            continue
        # Take largest contour per label
        c = max(contours, key=cv2.contourArea)
        if cv2.contourArea(c) < 50:
            continue
        poly = contour_to_polygon(c, epsilon)
        if len(poly) < 3:
            continue
        room_id = int(round(val / 30.0)) if val >= 30 else int(val)
        out.append({
            "id": room_id,
            "label": id_to_label.get(room_id, f"Room_{room_id}"),
            "polygon": poly,
        })
    return out


def load_room_labels(json_path: str) -> dict:
    """Load room id -> label from rooms.json."""
    id_to_label = {}
    if not os.path.isfile(json_path):
        return id_to_label
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            rooms = json.load(f)
        for r in rooms:
            id_to_label[r["id"]] = r.get("label") or f"Room_{r['id']}"
    except (json.JSONDecodeError, KeyError):
        pass
    return id_to_label


def export_vectors(masks_dir: str, json_dir: str, out_path: str,
                   epsilon: float = 3.0, image_size: tuple = None) -> None:
    """
    Read all masks from masks_dir, extract polygons, write vectors.json.
    """
    result = {
        "image_size": [0, 0],
        "walls": [],
        "doors": [],
        "windows": [],
        "fixtures": [],
        "rooms": [],
        "kitchen_counter": [],
    }

    def read_mask(name: str) -> np.ndarray:
        path = os.path.join(masks_dir, name)
        if not os.path.isfile(path):
            return None
        img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        return img

    # Image size from walls mask if available
    walls_mask = read_mask("walls_mask.png")
    if walls_mask is not None:
        h, w = walls_mask.shape
        result["image_size"] = [int(w), int(h)]
    if image_size is not None:
        result["image_size"] = list(image_size)

    # Walls: list of polygons
    if walls_mask is not None:
        result["walls"] = mask_to_polygons(walls_mask, epsilon=epsilon, min_area=100)

    # Doors, windows, fixtures: list of polygons
    for key, filename in [
        ("doors", "doors_mask.png"),
        ("windows", "windows_mask.png"),
        ("fixtures", "fixtures_mask.png"),
    ]:
        m = read_mask(filename)
        if m is not None:
            result[key] = mask_to_polygons(m, epsilon=epsilon, min_area=20)

    # Rooms: list of { id, label, polygon }; need rooms.json for labels
    rooms_mask = read_mask("rooms_mask.png")
    if rooms_mask is not None:
        id_to_label = load_room_labels(os.path.join(json_dir, "rooms.json"))
        result["rooms"] = labeled_mask_to_regions(
            rooms_mask, id_to_label, epsilon=epsilon
        )

    # Kitchen counter: list of polygons (usually one)
    kc_mask = read_mask("kitchen_counter_mask.png")
    if kc_mask is not None:
        result["kitchen_counter"] = mask_to_polygons(
            kc_mask, epsilon=epsilon, min_area=100
        )

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"Saved: {out_path}")
    print(f"  walls: {len(result['walls'])} polygons")
    print(f"  doors: {len(result['doors'])} polygons")
    print(f"  windows: {len(result['windows'])} polygons")
    print(f"  fixtures: {len(result['fixtures'])} polygons")
    print(f"  rooms: {len(result['rooms'])} regions")
    print(f"  kitchen_counter: {len(result['kitchen_counter'])} polygons")


def main():
    parser = argparse.ArgumentParser(
        description="Export masks to vector JSON (polygons) for editable vector UI"
    )
    parser.add_argument(
        "--output-dir",
        default="",
        help="Output root (masks + json under this); overrides --masks-dir and --json-dir if set",
    )
    parser.add_argument("--masks-dir", default="detection/output/masks", help="Directory containing mask PNGs")
    parser.add_argument("--json-dir", default="detection/output/json", help="Directory containing rooms.json etc.")
    parser.add_argument("--out", default="", help="Path to vectors.json (default: <json-dir>/vectors.json)")
    parser.add_argument("--epsilon", type=float, default=3.0,
                        help="approxPolyDP epsilon (higher = fewer vertices)")
    args = parser.parse_args()

    if args.output_dir:
        masks_dir = os.path.join(args.output_dir, "masks")
        json_dir = os.path.join(args.output_dir, "json")
        out_path = args.out or os.path.join(args.output_dir, "json", "vectors.json")
    else:
        masks_dir = args.masks_dir
        json_dir = args.json_dir
        out_path = args.out or os.path.join(json_dir, "vectors.json")

    if not os.path.isdir(masks_dir):
        print("Masks directory not found:", masks_dir, file=sys.stderr)
        sys.exit(1)

    export_vectors(masks_dir, json_dir, out_path, epsilon=args.epsilon)


if __name__ == "__main__":
    main()
