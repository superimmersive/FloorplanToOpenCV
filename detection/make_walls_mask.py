"""
Floor plan wall and text detection.
- Walls (gray regions): highlighted in red on the overlay; text regions excluded from wall mask.
- Text/labels/dimensions: detected with EasyOCR in two passes (0° then 90°); exported to JSON.
- Simple NMS keeps the tightest bbox per region for better highlight accuracy.

Usage: python make_walls_mask.py input_image output_folder [--no-ocr]
  --no-ocr  Skip EasyOCR (faster; dimension labels may bleed into wall mask).
"""

import argparse
import json
import os
import sys

import cv2
import numpy as np
import torch

try:
    import easyocr
except ImportError:
    print("EasyOCR is required. Install with: pip install easyocr")
    sys.exit(1)


def ensure_dir(path: str):
    os.makedirs(path, exist_ok=True)


def _clean_collinear(points: list) -> list:
    """Remove vertices that lie on the same H or V line as their neighbours."""
    n = len(points)
    if n < 3:
        return points
    cleaned = []
    for i in range(n):
        prev = points[(i - 1) % n]
        curr = points[i]
        nxt = points[(i + 1) % n]
        if prev[0] == curr[0] == nxt[0]:
            continue
        if prev[1] == curr[1] == nxt[1]:
            continue
        cleaned.append(curr)
    return cleaned if len(cleaned) >= 3 else points


def _rectify_contour(contour: np.ndarray, epsilon: float = 8.0) -> np.ndarray:
    """Approximate a contour and snap every segment to strict H or V."""
    approx = cv2.approxPolyDP(contour, epsilon, True)
    pts = [p.tolist() for p in approx.reshape(-1, 2)]
    if len(pts) < 3:
        return contour

    n = len(pts)
    result = []
    for i in range(n):
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        dx = abs(p2[0] - p1[0])
        dy = abs(p2[1] - p1[1])
        result.append(list(p1))
        if dx > 0 and dy > 0:
            if dx >= dy:
                result.append([p2[0], p1[1]])
            else:
                result.append([p1[0], p2[1]])

    result = _clean_collinear(result)
    if len(result) < 3:
        return contour
    return np.array(result, dtype=np.int32).reshape(-1, 1, 2)


def _fill_rectilinear(mask: np.ndarray, vertices: np.ndarray, value: int = 255):
    """Scanline fill for a rectilinear polygon — produces pixel-perfect H/V edges."""
    pts = vertices.reshape(-1, 2)
    n = len(pts)

    v_edges = []
    for i in range(n):
        p1, p2 = pts[i], pts[(i + 1) % n]
        if p1[0] == p2[0] and p1[1] != p2[1]:
            y_min = min(int(p1[1]), int(p2[1]))
            y_max = max(int(p1[1]), int(p2[1]))
            v_edges.append((int(p1[0]), y_min, y_max))

    if not v_edges:
        cv2.fillPoly(mask, [pts], value)
        return

    all_y = sorted({y for _, ym, yx in v_edges for y in (ym, yx)})
    for yi in range(len(all_y) - 1):
        y_top, y_bot = all_y[yi], all_y[yi + 1]
        y_mid = (y_top + y_bot) / 2.0
        x_cross = sorted(x for x, ym, yx in v_edges if ym <= y_mid < yx)
        for j in range(0, len(x_cross) - 1, 2):
            mask[y_top:y_bot, x_cross[j]:x_cross[j + 1]] = value


def rectify_mask(mask: np.ndarray, epsilon: float = 8.0) -> np.ndarray:
    """Rebuild *mask* with all contour corners forced to exact 90-degree angles."""
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return mask

    result = np.zeros_like(mask)
    outers, holes = [], []
    for i, cnt in enumerate(contours):
        rect = _rectify_contour(cnt, epsilon)
        if hierarchy[0][i][3] == -1:
            outers.append(rect)
        else:
            holes.append(rect)

    for poly in outers:
        _fill_rectilinear(result, poly, 255)
    for poly in holes:
        _fill_rectilinear(result, poly, 0)
    return result


def remove_small_components(binary_255: np.ndarray, min_area: int) -> np.ndarray:
    num, labels, stats, _ = cv2.connectedComponentsWithStats(
        (binary_255 > 0).astype(np.uint8), connectivity=8
    )
    out = np.zeros_like(binary_255)
    for i in range(1, num):
        area = stats[i, cv2.CC_STAT_AREA]
        if area >= min_area:
            out[labels == i] = 255
    return out


def write_pbm_from_mask(mask_255: np.ndarray, pbm_path: str):
    h, w = mask_255.shape
    pbm_data = (mask_255 > 0).astype(np.uint8)
    with open(pbm_path, "w", encoding="ascii") as f:
        f.write("P1\n")
        f.write(f"{w} {h}\n")
        for y in range(h):
            row = pbm_data[y]
            f.write(" ".join(str(int(v)) for v in row) + "\n")


def _transform_bbox(pts: np.ndarray, rotation_deg: int, w: int, h: int) -> np.ndarray:
    """Transform 4 bbox points from rotated image coords back to original (w, h) image."""
    pts = np.array(pts, dtype=np.float32)
    if rotation_deg == 0:
        return pts
    out = np.zeros_like(pts)
    # OpenCV rotate: 90 CW -> rotated shape (w, h); 90 CCW -> (w, h). Inverse from (rx,ry).
    if rotation_deg == 90:
        # 90 CW: orig (x,y) -> rotated (rx,ry) = (h-1-y, x)
        # Inverse: orig_x = ry, orig_y = h-1-rx
        out[:, 0] = pts[:, 1]
        out[:, 1] = h - 1 - pts[:, 0]
    elif rotation_deg == 180:
        out[:, 0] = w - 1 - pts[:, 0]
        out[:, 1] = h - 1 - pts[:, 1]
    elif rotation_deg == 270:
        # 90 CCW: orig (x,y) -> rotated (w-1-y, h-1-x); inverse: orig_x=w-1-ry, orig_y=h-1-rx
        out[:, 0] = w - 1 - pts[:, 1]
        out[:, 1] = h - 1 - pts[:, 0]
    return out.astype(np.int32)


def detect_text_easyocr(image_path: str, reader, height: int, width: int):
    """
    Run EasyOCR on the image; return (text_mask, detected_text_list).
    text_mask: binary image same size as input; white where text was detected.
    detected_text_list: list of {"text", "conf", "bbox"} for export.
    """
    results = reader.readtext(image_path)
    text_mask = np.zeros((height, width), dtype=np.uint8)
    detected_text = []
    for bbox, text, conf in results:
        pts = np.array(bbox, dtype=np.int32)
        cv2.fillPoly(text_mask, [pts], 255)
        detected_text.append({
            "text": text,
            "conf": float(conf),
            "bbox": pts.tolist(),
        })
    return text_mask, detected_text


def _aabbox_from_pts(pts: np.ndarray):
    """Axis-aligned bbox (x_min, y_min, x_max, y_max) and area from 4 corner points."""
    x_min, y_min = int(pts[:, 0].min()), int(pts[:, 1].min())
    x_max, y_max = int(pts[:, 0].max()), int(pts[:, 1].max())
    area = max(1, (x_max - x_min + 1) * (y_max - y_min + 1))
    return (x_min, y_min, x_max, y_max), area


def _intersection_area(a: tuple, b: tuple) -> int:
    """Intersection area of two axis-aligned boxes (x_min, y_min, x_max, y_max)."""
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    if ix1 >= ix2 or iy1 >= iy2:
        return 0
    return (ix2 - ix1 + 1) * (iy2 - iy1 + 1)


def _nms_keep_tighter(detections: list, overlap_threshold: float = 0.5) -> list:
    """
    When two boxes overlap a lot, keep the smaller (tighter) one so we prefer
    correct orientation over loose horizontal boxes around vertical text.
    """
    with_aabbox = []
    for d in detections:
        pts = np.array(d["bbox"], dtype=np.int32)
        aabbox, area = _aabbox_from_pts(pts)
        with_aabbox.append((aabbox, area, d))
    with_aabbox.sort(key=lambda x: x[1])  # ascending area: smaller first
    kept = []
    for aabbox, area, d in with_aabbox:
        overlap_ratio = 0.0
        for k_aabbox, k_area, _ in kept:
            inter = _intersection_area(aabbox, k_aabbox)
            overlap_ratio = max(overlap_ratio, inter / area)
        if overlap_ratio <= overlap_threshold:
            kept.append((aabbox, area, d))
    return [d for _, _, d in kept]


def detect_text_easyocr_two_pass(reader, img_bgr: np.ndarray, h: int, w: int):
    """
    Run EasyOCR on:
      - original image (0°),
      - then 90° clockwise rotated image,
    so vertical labels become horizontal in at least one pass.

    NMS keeps the tightest box per region so loose/wrong-orientation boxes are dropped.
    Each detection also gets a simple orientation label ("horizontal"/"vertical")
    based on its bbox in original coordinates.
    """
    all_detections = []

    # Pass 1: original orientation
    im_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    results0 = reader.readtext(im_rgb)
    for bbox, text, conf in results0:
        pts = np.array(bbox, dtype=np.int32)
        all_detections.append({
            "text": text,
            "conf": float(conf),
            "bbox": pts.tolist(),
        })

    # Pass 2: 90° clockwise - catches vertical text better
    img_rot = cv2.rotate(img_bgr, cv2.ROTATE_90_CLOCKWISE)
    im_rot_rgb = cv2.cvtColor(img_rot, cv2.COLOR_BGR2RGB)
    results90 = reader.readtext(im_rot_rgb)
    for bbox, text, conf in results90:
        pts_rot = np.array(bbox, dtype=np.int32)
        pts_orig = _transform_bbox(pts_rot, 90, w, h)
        pts_orig = np.clip(pts_orig, [0, 0], [w - 1, h - 1]).astype(np.int32)
        all_detections.append({
            "text": text,
            "conf": float(conf),
            "bbox": pts_orig.tolist(),
        })

    # Prefer tighter boxes when overlapping (fixes loose/wrong-orientation highlights)
    detected_text = _nms_keep_tighter(all_detections, overlap_threshold=0.5)

    # Build mask and annotate orientation
    text_mask = np.zeros((h, w), dtype=np.uint8)
    for d in detected_text:
        pts = np.array(d["bbox"], dtype=np.int32)
        cv2.fillPoly(text_mask, [pts], 255)

        # Simple orientation classification from axis-aligned bbox
        (x_min, y_min, x_max, y_max), _ = _aabbox_from_pts(pts)
        w_box = x_max - x_min + 1
        h_box = y_max - y_min + 1
        d["orientation"] = "horizontal" if w_box >= h_box else "vertical"

    return text_mask, detected_text


def main():
    parser = argparse.ArgumentParser(description="Floor plan wall and text detection")
    parser.add_argument("input_image", help="Input floor plan image")
    parser.add_argument("output_folder", help="Output directory")
    parser.add_argument("--no-ocr", action="store_true",
                        help="Skip EasyOCR (faster; dimension labels may bleed into wall mask)")
    args = parser.parse_args()

    in_path = args.input_image
    out_dir = args.output_folder
    ensure_dir(out_dir)

    img = cv2.imread(in_path)
    if img is None:
        raise RuntimeError(f"Could not read image: {in_path}")

    h, w = img.shape[:2]

    # --- Walls: narrow gray-band targeting the solid wall fill (~193) ---
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    bw = cv2.inRange(gray, 185, 200)

    # Remove thin lines (dimension arrows, annotations) — walls are ≥8px thick
    kh = cv2.getStructuringElement(cv2.MORPH_RECT, (8, 1))
    kv = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 8))
    bw = cv2.bitwise_or(cv2.morphologyEx(bw, cv2.MORPH_OPEN, kh),
                         cv2.morphologyEx(bw, cv2.MORPH_OPEN, kv))

    close_k = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, close_k, iterations=2)
    bw = remove_small_components(bw, min_area=500)

    # --- Text: EasyOCR (optional) ---
    if args.no_ocr:
        print("Skipping EasyOCR (--no-ocr).")
        text_mask = np.zeros((h, w), dtype=np.uint8)
        detected_text = []
    else:
        print("Running EasyOCR for text detection (0° then 90°)...")
        use_gpu = torch.cuda.is_available()
        reader = easyocr.Reader(["en"], gpu=use_gpu)
        text_mask, detected_text = detect_text_easyocr_two_pass(reader, img, h, w)

    # Walls only: exclude text regions so labels are not highlighted as walls
    walls_only = cv2.bitwise_and(bw, cv2.bitwise_not(text_mask))

    # Rectify: force every corner to a perfect 90-degree angle
    walls_only = rectify_mask(walls_only, epsilon=8.0)
    print("Rectified wall mask to 90-degree corners.")

    # --- Save outputs into subfolders ---
    masks_dir = os.path.join(out_dir, "masks")
    overlays_dir = os.path.join(out_dir, "overlays")
    json_dir = os.path.join(out_dir, "json")
    for d in (masks_dir, overlays_dir, json_dir):
        ensure_dir(d)

    mask_png = os.path.join(masks_dir, "walls_mask.png")
    cv2.imwrite(mask_png, walls_only)

    overlay_png = os.path.join(overlays_dir, "walls_overlay.png")
    alpha = 0.5
    overlay = img.astype(np.float32)
    red_layer = np.zeros_like(overlay)
    red_layer[:, :, 2] = 255
    wall_pixels = walls_only > 0
    overlay[wall_pixels] = overlay[wall_pixels] * (1.0 - alpha) + red_layer[wall_pixels] * alpha
    overlay = np.clip(overlay, 0, 255).astype(np.uint8)
    cv2.imwrite(overlay_png, overlay)

    pbm_path = os.path.join(masks_dir, "walls_mask.pbm")
    write_pbm_from_mask(walls_only, pbm_path)

    text_json_path = os.path.join(json_dir, "detected_text.json")
    with open(text_json_path, "w", encoding="utf-8") as f:
        json.dump(detected_text, f, indent=2, ensure_ascii=False)

    print("Saved:")
    print(" -", mask_png)
    print(" -", overlay_png)
    print(" -", pbm_path)
    print(" -", text_json_path)
    print(f"Detected {len(detected_text)} text regions.")


if __name__ == "__main__":
    main()
