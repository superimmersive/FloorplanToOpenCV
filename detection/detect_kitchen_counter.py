"""
Detect kitchen counters using a reference layer that provides the counter
outline at full floor-plan resolution.

The counter area is identified by:
  1. Extracting counter edge lines from the reference layer.
  2. Combining them with the wall mask + dark floor-plan lines to form
     closed boundaries.
  3. Finding enclosed regions that fall within the counter bounding box.
  4. Filling interior gaps and removing noise.

Usage:
  python detect_kitchen_counter.py input/GF_clean.jpg
"""

import argparse
import json
import os
import sys

import cv2
import numpy as np

REFERENCE_LAYER = "detection/training_data/kitchenCounter/GF_clean_0016_Layer-21.png"
WALLS_MASK = "detection/output/masks/walls_mask.png"


def load_counter_lines(ref_path: str) -> np.ndarray:
    ref = cv2.imread(ref_path, cv2.IMREAD_GRAYSCALE)
    if ref is None:
        sys.exit(f"Cannot read reference layer: {ref_path}")
    return (ref < 128).astype(np.uint8) * 255


def detect_counter(fp_gray: np.ndarray, walls: np.ndarray,
                   counter_lines: np.ndarray,
                   min_area: int = 200, max_area: int = 100000,
                   margin: int = 80) -> np.ndarray:
    """Return a filled binary mask of the kitchen counter area."""
    H, W = fp_gray.shape

    # Bounding box of counter lines
    cy, cx = np.where(counter_lines > 0)
    if len(cx) == 0:
        return np.zeros((H, W), dtype=np.uint8)
    cl_x1, cl_y1 = int(cx.min()), int(cy.min())
    cl_x2, cl_y2 = int(cx.max()), int(cy.max())

    # Outer edge of the nearest wall (right boundary)
    wy, wx = np.where(walls[cl_y1:cl_y2, cl_x2 - 100:cl_x2 + 200] > 0)
    wall_outer_x = (cl_x2 - 100 + int(wx.max())) if len(wx) > 0 else cl_x2 + 50

    # Bridge gaps between walls, counter lines, and floor-plan dark lines
    k_wall = cv2.getStructuringElement(cv2.MORPH_RECT, (11, 11))
    k_cnt = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    walls_br = cv2.dilate(walls, k_wall, iterations=1)
    counter_br = cv2.dilate(counter_lines, k_cnt, iterations=1)

    dark_fp = (fp_gray < 30).astype(np.uint8) * 255
    kitchen_dark = np.zeros_like(dark_fp)
    ky1 = max(0, cl_y1)
    ky2 = min(H, cl_y2 + 20)
    kx1 = max(0, cl_x1 - 50)
    kx2 = min(W, cl_x2 + 20)
    kitchen_dark[ky1:ky2, kx1:kx2] = dark_fp[ky1:ky2, kx1:kx2]

    boundary = cv2.bitwise_or(walls_br, counter_br)
    boundary = cv2.bitwise_or(boundary, kitchen_dark)

    # Find enclosed regions
    inv = cv2.bitwise_not(boundary)
    num, labels, stats, centroids = cv2.connectedComponentsWithStats(inv, 8)

    counter_mask = np.zeros((H, W), dtype=np.uint8)
    for i in range(1, num):
        area = stats[i, cv2.CC_STAT_AREA]
        cx_r, cy_r = centroids[i]
        if cx_r < cl_x1 - margin or cy_r > cl_y2 + margin:
            continue
        if cx_r > wall_outer_x:
            continue
        if area > max_area or area < min_area:
            continue
        counter_mask[labels == i] = 255

    # Fill holes (fixture interiors are part of counter) and clean noise
    k_fill = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
    counter_mask = cv2.morphologyEx(counter_mask, cv2.MORPH_CLOSE, k_fill, iterations=3)

    num2, labels2, stats2, _ = cv2.connectedComponentsWithStats(counter_mask, 8)
    final = np.zeros_like(counter_mask)
    for i in range(1, num2):
        if stats2[i, cv2.CC_STAT_AREA] >= 1000:
            final[labels2 == i] = 255

    return final


def draw_overlay(img: np.ndarray, mask: np.ndarray,
                 color: tuple = (200, 200, 0), alpha: float = 0.4) -> np.ndarray:
    vis = img.astype(np.float32)
    fill = np.zeros_like(vis)
    fill[:, :] = color
    m = mask > 0
    vis[m] = vis[m] * (1 - alpha) + fill[m] * alpha
    vis = np.clip(vis, 0, 255).astype(np.uint8)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(vis, contours, -1, color, 2)

    for cnt in contours:
        M = cv2.moments(cnt)
        if M["m00"] > 0:
            cx = int(M["m10"] / M["m00"])
            cy = int(M["m01"] / M["m00"])
            cv2.putText(vis, "kitchen counter", (cx - 60, cy),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)
    return vis


def main():
    ap = argparse.ArgumentParser(description="Detect kitchen counter")
    ap.add_argument("input", help="Floor plan image")
    ap.add_argument("--ref", default=REFERENCE_LAYER,
                    help="Full-size counter outline reference layer")
    ap.add_argument("--walls", default=WALLS_MASK)
    ap.add_argument("--out", default="detection/output/overlays/kitchen_counter_overlay.png")
    ap.add_argument("--mask-out", default="detection/output/masks/kitchen_counter_mask.png")
    ap.add_argument("--json-out", default="detection/output/json/kitchen_counter.json")
    args = ap.parse_args()

    img = cv2.imread(args.input)
    if img is None:
        sys.exit(f"Cannot read: {args.input}")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    walls = cv2.imread(args.walls, cv2.IMREAD_GRAYSCALE)
    if walls is None:
        sys.exit(f"Cannot read wall mask: {args.walls}")

    counter_lines = load_counter_lines(args.ref)
    if counter_lines.shape != gray.shape:
        sys.exit(f"Reference layer size {counter_lines.shape} != floor plan {gray.shape}")

    print(f"Image: {img.shape[1]}x{img.shape[0]}")
    print(f"Counter reference lines: {np.count_nonzero(counter_lines)} px")

    mask = detect_counter(gray, walls, counter_lines)
    area_px = np.count_nonzero(mask)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    bboxes = []
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        bboxes.append([x, y, x + w, y + h])

    print(f"Counter detected: {len(contours)} component(s), {area_px} px")
    for b in bboxes:
        print(f"  bbox: [{b[0]},{b[1]}]-[{b[2]},{b[3]}]")

    overlay = draw_overlay(img, mask, color=(200, 200, 0), alpha=0.4)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    cv2.imwrite(args.out, overlay)
    cv2.imwrite(args.mask_out, mask)
    print(f"Overlay: {args.out}")
    print(f"Mask:    {args.mask_out}")

    data = {"components": len(contours), "area_px": int(area_px),
            "bboxes": [[int(v) for v in b] for b in bboxes]}
    with open(args.json_out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"JSON:    {args.json_out}")


if __name__ == "__main__":
    main()
