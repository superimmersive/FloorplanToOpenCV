"""
Draw vector polygons from vectors.json on the floor plan for visual verification.

Usage:
  python visualize_vectors.py
  python visualize_vectors.py --image input/GF_clean.jpg --vectors output/json/vectors.json --out output/overlays/vectors_overlay.png
"""

import argparse
import json
import os
import sys

import cv2
import numpy as np

# BGR colors per layer (semi-opaque fills + solid outlines)
WALLS_COLOR = (80, 80, 220)       # red
DOORS_COLOR = (220, 200, 0)       # cyan
WINDOWS_COLOR = (220, 160, 0)     # blue
FIXTURES_COLOR = (0, 200, 120)    # green
KITCHEN_COLOR = (180, 180, 0)     # teal
ROOM_COLORS = [
    (76, 175, 80),    # green
    (33, 150, 243),   # blue
    (255, 152, 0),    # orange
    (156, 39, 176),   # purple
    (0, 188, 212),    # cyan
    (255, 87, 34),    # deep orange
    (233, 30, 99),    # pink
    (205, 220, 57),   # lime
]


def draw_polygons(img: np.ndarray, polygons: list, color_bgr: tuple,
                  fill_alpha: float = 0.35, line_thickness: int = 2) -> None:
    """Draw polygons with semi-transparent fill and solid outline."""
    overlay = img.copy()
    for poly in polygons:
        if len(poly) < 3:
            continue
        pts = np.array(poly, dtype=np.int32).reshape((-1, 1, 2))
        cv2.fillPoly(overlay, [pts], color_bgr)
        cv2.polylines(img, [pts], True, color_bgr, line_thickness, cv2.LINE_AA)
    cv2.addWeighted(overlay, fill_alpha, img, 1 - fill_alpha, 0, img)


def main():
    parser = argparse.ArgumentParser(description="Visualize vector JSON on floor plan")
    parser.add_argument("--image", default="detection/input/GF_clean.jpg", help="Floor plan image")
    parser.add_argument("--vectors", default="detection/output/json/vectors.json", help="vectors.json path")
    parser.add_argument("--out", default="detection/output/overlays/vectors_overlay.png", help="Output overlay image")
    args = parser.parse_args()

    if not os.path.isfile(args.image):
        print("Image not found:", args.image, file=sys.stderr)
        sys.exit(1)
    if not os.path.isfile(args.vectors):
        print("Vectors not found:", args.vectors, file=sys.stderr)
        sys.exit(1)

    img = cv2.imread(args.image)
    if img is None:
        print("Could not read image:", args.image, file=sys.stderr)
        sys.exit(1)

    with open(args.vectors, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Draw in order: walls first, then doors/windows/fixtures, then kitchen_counter, then rooms (so rooms on top)
    if data.get("walls"):
        draw_polygons(img, data["walls"], WALLS_COLOR, fill_alpha=0.4)
    if data.get("doors"):
        draw_polygons(img, data["doors"], DOORS_COLOR)
    if data.get("windows"):
        draw_polygons(img, data["windows"], WINDOWS_COLOR)
    if data.get("fixtures"):
        draw_polygons(img, data["fixtures"], FIXTURES_COLOR)
    if data.get("kitchen_counter"):
        draw_polygons(img, data["kitchen_counter"], KITCHEN_COLOR)
    if data.get("rooms"):
        for i, room in enumerate(data["rooms"]):
            color = ROOM_COLORS[i % len(ROOM_COLORS)]
            poly = room.get("polygon", [])
            if len(poly) >= 3:
                draw_polygons(img, [poly], color, fill_alpha=0.3)
            # Label
            pts = np.array(poly, dtype=np.int32)
            if len(pts) > 0:
                M = cv2.moments(pts)
                if M["m00"] > 0:
                    cx = int(M["m10"] / M["m00"])
                    cy = int(M["m01"] / M["m00"])
                    label = room.get("label", f"Room {room.get('id', '')}")
                    cv2.putText(img, label, (cx - 30, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2, cv2.LINE_AA)
                    cv2.putText(img, label, (cx - 30, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    cv2.imwrite(args.out, img)
    print("Saved:", args.out)
    print("Open this image to verify the vector output.")


if __name__ == "__main__":
    main()
