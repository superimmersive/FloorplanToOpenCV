"""
Match dimension text labels to detected dimension line spans.

Crops the text region for each span and runs targeted EasyOCR for accurate
measurement extraction.

Usage:
  python match_dim_text.py
  python match_dim_text.py --input input/GF_clean.jpg --output-dir output
"""
import argparse
import json
import os
import re

import cv2
import easyocr
import numpy as np

TEXT_MARGIN = 45


def mm_to_imperial(mm):
    """Convert millimeters to feet-inches string."""
    total_inches = mm / 25.4
    feet = int(total_inches // 12)
    inches = round(total_inches % 12)
    if inches == 12:
        feet += 1
        inches = 0
    return f"{feet}'-{inches}\""


def parse_dimension(text):
    """Extract metric (mm) and imperial (feet-inches) from dimension text."""
    text = text.strip().replace(",", "").replace(";", "")
    result = {"raw": text, "mm": None, "imperial": None}

    mm_match = re.search(r"(\d{3,5})", text)
    if mm_match:
        result["mm"] = int(mm_match.group(1))

    if result["mm"]:
        result["imperial"] = mm_to_imperial(result["mm"])

    return result


def crop_for_span(img, W, H, dl, span):
    """Return the image crop where dimension text sits, rotated to horizontal."""
    side = dl["side"]
    pad = 15

    if dl["orientation"] == "horizontal":
        y_dim = dl["y"]
        x1, x2 = span["start"] - pad, span["end"] + pad
        x1, x2 = max(x1, 0), min(x2, W)
        if side == "top":
            crop = img[max(y_dim - TEXT_MARGIN, 0):y_dim + 2, x1:x2]
        else:
            crop = img[y_dim - TEXT_MARGIN:y_dim + 2, x1:x2]
        return crop

    else:
        x_dim = dl["x"]
        y1, y2 = span["start"] - pad, span["end"] + pad
        y1, y2 = max(y1, 0), min(y2, H)
        if side == "left":
            crop = img[y1:y2, max(x_dim - TEXT_MARGIN, 0):x_dim + 2]
        else:
            crop = img[y1:y2, x_dim - TEXT_MARGIN:x_dim + 2]
        crop = cv2.rotate(crop, cv2.ROTATE_90_CLOCKWISE)
        return crop


def _format_label(span):
    txt = span.get("text", {})
    if isinstance(txt, str):
        txt = {}
    mm_val = txt.get("mm")
    imp_val = txt.get("imperial")
    if mm_val:
        label = f"{mm_val}mm"
        if imp_val:
            label += f" [{imp_val}]"
        return label
    return f"{span['px']}px"


def _draw_label_bg(vis, text, org, font, scale, color, thickness):
    """Draw text with a white background rectangle for readability."""
    (tw, th), baseline = cv2.getTextSize(text, font, scale, thickness)
    x, y = org
    cv2.rectangle(vis, (x - 2, y - th - 2), (x + tw + 2, y + baseline + 2),
                  (255, 255, 255), -1)
    cv2.putText(vis, text, org, font, scale, color, thickness, cv2.LINE_AA)


def main():
    parser = argparse.ArgumentParser(description="Match dimension text to spans")
    parser.add_argument("--input", default="detection/input/GF_clean.jpg", help="Floor plan image")
    parser.add_argument("--output-dir", default="detection/output", help="Output directory for JSON and overlay")
    args = parser.parse_args()

    output_dir = args.output_dir
    input_path = args.input
    os.makedirs(os.path.join(output_dir, "debug"), exist_ok=True)
    os.makedirs(os.path.join(output_dir, "json"), exist_ok=True)
    os.makedirs(os.path.join(output_dir, "overlays"), exist_ok=True)

    img = cv2.imread(input_path)
    if img is None:
        raise FileNotFoundError(f"Cannot read image: {input_path}")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    H, W = gray.shape

    dim_lines_path = os.path.join(output_dir, "json", "dim_lines.json")
    walls_path = os.path.join(output_dir, "masks", "walls_mask.png")
    if not os.path.isfile(dim_lines_path):
        raise FileNotFoundError(f"dim_lines.json not found: {dim_lines_path}")
    with open(dim_lines_path) as f:
        dim_lines = json.load(f)
    # Handle both legacy format (list) and enriched format (dict with dimension_lines)
    if isinstance(dim_lines, dict) and "dimension_lines" in dim_lines:
        dim_lines = dim_lines["dimension_lines"]
    if not os.path.isfile(walls_path):
        raise FileNotFoundError(f"walls_mask not found: {walls_path}")
    walls = cv2.imread(walls_path, cv2.IMREAD_GRAYSCALE)

    reader = easyocr.Reader(["en"], gpu=False)

    print("Matching dimension text to spans...\n")

    for dl in dim_lines:
        side = dl["side"]
        tier = dl["tier"]
        orient = dl["orientation"]

        for i, span in enumerate(dl["spans"]):
            crop = crop_for_span(img, W, H, dl, span)
            if crop is None or crop.size == 0:
                span["text"] = {"raw": "", "mm": None, "imperial": None}
                continue

            debug_path = os.path.join(output_dir, "debug", f"dim_crop_{side}_t{tier}_s{i}.png")
            cv2.imwrite(debug_path, crop)

            results = reader.readtext(crop, detail=1, paragraph=False)

            full_text = " ".join(r[1] for r in results).strip()
            parsed = parse_dimension(full_text)
            span["text"] = parsed

            label = parsed.get("mm") or parsed.get("imperial") or full_text
            print(f"  {side:6s} T{tier} span{i} [{span['start']:4d}-{span['end']:4d}] "
                  f"{span['px']:4d}px  ->  '{full_text}'  =>  mm={parsed['mm']}  "
                  f"imp={parsed['imperial']}")

    # Compute scale factor (px per mm) from spans that have mm values
    px_per_mm_samples = []
    for dl in dim_lines:
        for span in dl["spans"]:
            mm = span.get("text", {}).get("mm")
            if mm and mm > 500:
                px_per_mm_samples.append(span["px"] / mm)

    if px_per_mm_samples:
        avg_scale = np.mean(px_per_mm_samples)
        print(f"\nScale: {avg_scale:.4f} px/mm ({1/avg_scale:.2f} mm/px)")
        print(f"  = {avg_scale * 1000:.1f} px/m")
    else:
        avg_scale = None
        print("\nCould not compute scale (no mm values found)")

    # Save enriched JSON with scale
    output = {
        "scale_px_per_mm": round(avg_scale, 5) if avg_scale else None,
        "scale_mm_per_px": round(1.0 / avg_scale, 2) if avg_scale else None,
        "dimension_lines": dim_lines,
    }
    with open(dim_lines_path, "w") as f:
        json.dump(output, f, indent=2, default=str)
    print("\nUpdated:", dim_lines_path)

    # Draw overlay
    COLORS = {"top": (0, 0, 220), "bottom": (0, 120, 220),
              "left": (220, 0, 0), "right": (180, 0, 180)}
    FONT = cv2.FONT_HERSHEY_SIMPLEX
    vis = img.copy()

    for dl in dim_lines:
        c = COLORS.get(dl["side"], (0, 200, 0))
        lw = 2 if dl["tier"] == 1 else 1

        if dl["orientation"] == "horizontal":
            y = dl["y"]
            x_range = dl["x_range"]
            cv2.line(vis, (x_range[0], y), (x_range[1], y), c, lw)
            for t in dl["ticks"]:
                cv2.circle(vis, (t, y), 5, (0, 200, 0), -1)
            for span in dl["spans"]:
                label = _format_label(span)
                mx = (span["start"] + span["end"]) // 2
                (tw, _), _ = cv2.getTextSize(label, FONT, 0.38, 1)
                label_y = y + 18 if dl["side"] == "top" else y - 8
                _draw_label_bg(vis, label, (mx - tw // 2, label_y), FONT, 0.38, c, 1)
        else:
            x = dl["x"]
            y_range = dl["y_range"]
            cv2.line(vis, (x, y_range[0]), (x, y_range[1]), c, lw)
            for t in dl["ticks"]:
                cv2.circle(vis, (x, t), 5, (0, 200, 0), -1)
            for span in dl["spans"]:
                label = _format_label(span)
                my = (span["start"] + span["end"]) // 2
                label_x = x - 8 if dl["side"] == "right" else x + 8
                if dl["side"] == "right":
                    (tw, _), _ = cv2.getTextSize(label, FONT, 0.38, 1)
                    label_x = x - tw - 8
                _draw_label_bg(vis, label, (label_x, my), FONT, 0.38, c, 1)

    if avg_scale:
        scale_text = f"Scale: {1/avg_scale:.2f} mm/px ({avg_scale*1000:.0f} px/m)"
        _draw_label_bg(vis, scale_text, (20, H - 20), FONT, 0.45, (0, 0, 0), 1)

    overlay_path = os.path.join(output_dir, "overlays", "dim_lines_overlay.png")
    cv2.imwrite(overlay_path, vis)
    print("Saved:", overlay_path)


if __name__ == "__main__":
    main()
