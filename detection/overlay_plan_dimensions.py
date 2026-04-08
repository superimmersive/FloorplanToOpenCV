"""
Overlay overall plan dimensions (width × length) measured from the wall mask.

Computes the bounding box of wall pixels, converts to mm using scale from
dim_lines.json, and draws the extent with labels. Ignores dimension lines
on the plan.

Usage:
  python overlay_plan_dimensions.py --output-dir detection/output
"""

import argparse
import json
import os

import cv2
import numpy as np


def mm_to_imperial(mm: float) -> str:
    total_inches = mm / 25.4
    feet = int(total_inches // 12)
    inches = round(total_inches % 12)
    if inches == 12:
        feet += 1
        inches = 0
    return f"{feet}'-{inches}\""


def main():
    parser = argparse.ArgumentParser(
        description="Overlay plan dimensions on walls mask"
    )
    parser.add_argument("--input", default="detection/input/GF_clean.jpg",
                       help="Input floor plan image")
    parser.add_argument("--output-dir", default="detection/output",
                       help="Output directory (masks, json, overlays)")
    args = parser.parse_args()

    out_dir = args.output_dir
    masks_dir = os.path.join(out_dir, "masks")
    json_dir = os.path.join(out_dir, "json")
    overlays_dir = os.path.join(out_dir, "overlays")
    # json_dir used later for plan_dimensions.json

    walls_mask_path = os.path.join(masks_dir, "walls_mask.png")
    dim_lines_path = os.path.join(json_dir, "dim_lines.json")
    input_path = args.input

    if not os.path.isfile(walls_mask_path):
        print(f"Walls mask not found: {walls_mask_path}")
        print("Run make_walls_mask.py first.")
        return 1

    walls_mask = cv2.imread(walls_mask_path, cv2.IMREAD_GRAYSCALE)
    if walls_mask is None:
        print("Could not read walls mask")
        return 1

    # Bounding box of wall pixels (ignore dimension lines on plan)
    ys, xs = np.where(walls_mask > 0)
    if len(xs) == 0 or len(ys) == 0:
        print("No wall pixels in mask")
        return 1

    x_min, x_max = int(xs.min()), int(xs.max())
    y_min, y_max = int(ys.min()), int(ys.max())
    width_px = x_max - x_min
    height_px = y_max - y_min

    # Scale from dim_lines (needed to convert px → mm)
    scale = 6.22
    if os.path.isfile(dim_lines_path):
        with open(dim_lines_path, "r", encoding="utf-8") as f:
            dim_data = json.load(f)
        scale = dim_data.get("scale_mm_per_px", scale)
    else:
        print("Note: dim_lines.json not found, using default scale 6.22 mm/px")

    width_mm = width_px * scale
    length_mm = height_px * scale

    # Use input image as base (or walls overlay) so we have the plan visible
    if os.path.isfile(input_path):
        base = cv2.imread(input_path)
    else:
        base = cv2.cvtColor(walls_mask, cv2.COLOR_GRAY2BGR)

    if base is None:
        base = cv2.cvtColor(walls_mask, cv2.COLOR_GRAY2BGR)

    h, w = base.shape[:2]

    overlay = base.copy()
    # Highlight walls in red (wall mask)
    if len(overlay.shape) == 3:
        for c in range(3):
            overlay[:, :, c] = np.where(
                walls_mask > 0,
                (overlay[:, :, c].astype(np.float32) * 0.5 + (255 if c == 2 else 0)).astype(np.uint8),
                overlay[:, :, c]
            )

    # Colors
    line_color = (0, 255, 255)  # cyan
    label_bg = (0, 0, 0)
    label_fg = (255, 255, 255)
    tick_color = (0, 255, 255)

    # Draw width line (horizontal) - full extent of wall mask
    x1, x2 = x_min, x_max
    y = y_min - 30
    if y < 20:
        y = y_max + 40
    cv2.line(overlay, (x1, y), (x2, y), line_color, 3)
    cv2.circle(overlay, (x1, y), 6, tick_color, 2)
    cv2.circle(overlay, (x2, y), 6, tick_color, 2)

    label = f"{width_mm:.0f} mm ({mm_to_imperial(width_mm)})"
    mid_x = (x1 + x2) // 2
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
    pad = 8
    ly = y - 12 if y < h // 2 else y + th + 10
    cv2.rectangle(overlay, (mid_x - tw // 2 - pad, ly - th - pad),
                  (mid_x + tw // 2 + pad, ly + pad), label_bg, -1)
    cv2.putText(overlay, label, (mid_x - tw // 2, ly),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, label_fg, 2, cv2.LINE_AA)

    # Draw length line (vertical) - full extent of wall mask
    y1, y2 = y_min, y_max
    x = x_min - 50
    if x < 50:
        x = x_max + 50
    cv2.line(overlay, (x, y1), (x, y2), line_color, 3)
    cv2.circle(overlay, (x, y1), 6, tick_color, 2)
    cv2.circle(overlay, (x, y2), 6, tick_color, 2)

    label = f"{length_mm:.0f} mm ({mm_to_imperial(length_mm)})"
    mid_y = (y1 + y2) // 2
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
    pad = 8
    tx = x - 130 if x > 150 else x + 20
    ty = mid_y + th // 2
    cv2.rectangle(overlay, (tx, ty - th - pad), (tx + tw + pad * 2, ty + pad),
                  label_bg, -1)
    cv2.putText(overlay, label, (tx + pad, ty - 5),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, label_fg, 2, cv2.LINE_AA)

    # Draw bounding box outline (optional, faint)
    cv2.rectangle(overlay, (x_min, y_min), (x_max, y_max), (0, 255, 255), 1)

    # Title
    cv2.rectangle(overlay, (w - 330, 5), (w - 10, 45), (0, 0, 0), -1)
    cv2.putText(overlay, f"Plan: {width_mm/1000:.1f}m x {length_mm/1000:.1f}m",
                (w - 320, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)

    os.makedirs(overlays_dir, exist_ok=True)
    out_path = os.path.join(overlays_dir, "plan_dimensions_overlay.png")
    cv2.imwrite(out_path, overlay)
    print(f"Saved: {out_path}")

    # Save JSON for webapp API
    dim_json = {
        "width_mm": round(width_mm, 1),
        "length_mm": round(length_mm, 1),
        "width_px": width_px,
        "length_px": height_px,
        "scale_mm_per_px": scale,
        "width_imperial": mm_to_imperial(width_mm),
        "length_imperial": mm_to_imperial(length_mm),
    }
    json_path = os.path.join(json_dir, "plan_dimensions.json")
    os.makedirs(json_dir, exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(dim_json, f, indent=2)
    print(f"Saved: {json_path}")

    print(f"  Width:  {width_mm:.0f} mm ({mm_to_imperial(width_mm)})")
    print(f"  Length: {length_mm:.0f} mm ({mm_to_imperial(length_mm)})")
    return 0


if __name__ == "__main__":
    exit(main())
