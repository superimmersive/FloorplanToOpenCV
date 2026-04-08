"""
Detect windows by finding glass-pane lines inside wall regions and in
wall-gap zones.

Two complementary detection methods:
  A. **Wall-interior detection** — erode the wall mask and look for long
     dark lines inside the interior (finds bay-window glass lines, etc.).
  B. **Wall-gap detection** — scan each column/row of the wall mask for
     gaps between wall segments; verify the gap contains long dark glass
     lines.  This finds windows where the wall mask has openings.

The results are merged, filtered, and output as bounding boxes.

Usage:
  python detect_windows.py input/GF_clean.jpg
"""

import argparse
import json
import os
import sys

import cv2
import numpy as np


# ---------------------------------------------------------------------------
# A. Wall-interior detection (glass lines inside the wall mask)
# ---------------------------------------------------------------------------

def detect_interior_glass(gray: np.ndarray, wall_mask: np.ndarray,
                          bin_thresh: int = 160,
                          min_line_len: int = 25,
                          wall_erosion: int = 2) -> np.ndarray:
    """Long dark lines inside the eroded wall mask."""
    _, binary = cv2.threshold(gray, bin_thresh, 255, cv2.THRESH_BINARY_INV)
    ek = np.ones((wall_erosion * 2 + 1,) * 2, np.uint8)
    wall_int = cv2.erode(wall_mask, ek)
    ib = cv2.bitwise_and(binary, wall_int)

    kv = cv2.getStructuringElement(cv2.MORPH_RECT, (1, min_line_len))
    kh = cv2.getStructuringElement(cv2.MORPH_RECT, (min_line_len, 1))
    return cv2.bitwise_or(cv2.morphologyEx(ib, cv2.MORPH_OPEN, kv),
                          cv2.morphologyEx(ib, cv2.MORPH_OPEN, kh))


# ---------------------------------------------------------------------------
# B. Wall-gap detection (glass lines inside wall openings)
# ---------------------------------------------------------------------------

def _column_runs(col: np.ndarray) -> list[tuple[int, int]]:
    """Return (start, end) pairs for contiguous white runs in a 1-D array."""
    runs: list[tuple[int, int]] = []
    in_run = False
    s = 0
    for i, v in enumerate(col):
        if v > 0 and not in_run:
            s = i
            in_run = True
        elif v == 0 and in_run:
            runs.append((s, i))
            in_run = False
    if in_run:
        runs.append((s, len(col)))
    return runs


def _find_segment(runs: list[tuple[int, int]], pos: int):
    """Return the (start, end) run that contains *pos*, or None."""
    for s, e in runs:
        if s <= pos < e:
            return (s, e)
    return None


def detect_gap_glass(gray: np.ndarray, wall_mask: np.ndarray,
                     bin_thresh: int = 160,
                     min_line_len: int = 40,
                     min_gap: int = 30, max_gap: int = 350,
                     min_glass_px: int = 40,
                     sample_step: int = 3) -> np.ndarray:
    """
    Scan columns (for vertical wall gaps) and rows (for horizontal wall
    gaps) to find gaps between wall segments that contain long dark lines.

    Returns a binary map of gap-glass pixels.
    """
    H, W = gray.shape
    _, binary = cv2.threshold(gray, bin_thresh, 255, cv2.THRESH_BINARY_INV)
    gap_glass = np.zeros((H, W), np.uint8)

    kv = cv2.getStructuringElement(cv2.MORPH_RECT, (1, min_line_len))
    kh = cv2.getStructuringElement(cv2.MORPH_RECT, (min_line_len, 1))

    # --- Vertical walls: scan columns ---
    for x in range(0, W, sample_step):
        runs = _column_runs(wall_mask[:, x])
        for i in range(len(runs) - 1):
            gap_y0 = runs[i][1]
            gap_y1 = runs[i + 1][0]
            gap_len = gap_y1 - gap_y0
            if gap_len < min_gap or gap_len > max_gap:
                continue

            # Find the SPECIFIC wall segment at column x above/below the gap
            y_above = max(0, gap_y0 - 5)
            y_below = min(H - 1, gap_y1 + 5)
            seg_a = _find_segment(
                _column_runs(wall_mask[y_above, :]), x)
            seg_b = _find_segment(
                _column_runs(wall_mask[y_below, :]), x)
            if seg_a is None or seg_b is None:
                continue
            x_lo = max(seg_a[0], seg_b[0])
            x_hi = min(seg_a[1], seg_b[1])
            if x_hi - x_lo < 5:
                continue

            roi = binary[gap_y0:gap_y1, x_lo:x_hi]
            filtered = cv2.morphologyEx(roi, cv2.MORPH_OPEN, kv)
            if np.count_nonzero(filtered) >= min_glass_px:
                gap_glass[gap_y0:gap_y1, x_lo:x_hi] = cv2.bitwise_or(
                    gap_glass[gap_y0:gap_y1, x_lo:x_hi], filtered)

    # --- Horizontal walls: scan rows ---
    for y in range(0, H, sample_step):
        runs = _column_runs(wall_mask[y, :])
        for i in range(len(runs) - 1):
            gap_x0 = runs[i][1]
            gap_x1 = runs[i + 1][0]
            gap_len = gap_x1 - gap_x0
            if gap_len < min_gap or gap_len > max_gap:
                continue

            x_left = max(0, gap_x0 - 5)
            x_right = min(W - 1, gap_x1 + 5)
            seg_l = _find_segment(
                _column_runs(wall_mask[:, x_left]), y)
            seg_r = _find_segment(
                _column_runs(wall_mask[:, x_right]), y)
            if seg_l is None or seg_r is None:
                continue
            y_lo = max(seg_l[0], seg_r[0])
            y_hi = min(seg_l[1], seg_r[1])
            if y_hi - y_lo < 5:
                continue

            roi = binary[y_lo:y_hi, gap_x0:gap_x1]
            filtered = cv2.morphologyEx(roi, cv2.MORPH_OPEN, kh)
            if np.count_nonzero(filtered) >= min_glass_px:
                gap_glass[y_lo:y_hi, gap_x0:gap_x1] = cv2.bitwise_or(
                    gap_glass[y_lo:y_hi, gap_x0:gap_x1], filtered)

    return gap_glass


# ---------------------------------------------------------------------------
# Component grouping / filtering
# ---------------------------------------------------------------------------

def find_components(glass: np.ndarray,
                    connect_dilate: int = 5,
                    min_area: int = 60,
                    min_extent: int = 40,
                    min_aspect: float = 3.0) -> list[dict]:
    if connect_dilate > 0:
        mask = cv2.dilate(glass,
                          np.ones((connect_dilate, connect_dilate), np.uint8))
    else:
        mask = glass
    n, _lab, stats, _cen = cv2.connectedComponentsWithStats(mask, 8)
    comps: list[dict] = []
    for i in range(1, n):
        area = int(stats[i, cv2.CC_STAT_AREA])
        x, y = int(stats[i, cv2.CC_STAT_LEFT]), int(stats[i, cv2.CC_STAT_TOP])
        w, h = int(stats[i, cv2.CC_STAT_WIDTH]), int(stats[i, cv2.CC_STAT_HEIGHT])
        extent = max(w, h)
        aspect = extent / max(1, min(w, h))
        if area < min_area or extent < min_extent or aspect < min_aspect:
            continue
        orient = "horizontal" if w > h else "vertical"
        comps.append({"bbox": [x, y, x + w, y + h],
                      "orientation": orient, "area": area})
    return comps


# ---------------------------------------------------------------------------
# Bounding-box helpers
# ---------------------------------------------------------------------------

def expand_to_wall(bbox, wall_mask, orient, margin=5):
    x1, y1, x2, y2 = bbox
    H, W = wall_mask.shape
    if orient == "vertical":
        cy = (y1 + y2) // 2
        lx, rx = max(0, x1 - 50), min(W, x2 + 50)
        cols = np.where(wall_mask[cy, lx:rx] > 0)[0]
        if len(cols):
            x1 = lx + int(cols[0]) - margin
            x2 = lx + int(cols[-1]) + margin
    else:
        cx = (x1 + x2) // 2
        uy, dy = max(0, y1 - 50), min(H, y2 + 50)
        rows = np.where(wall_mask[uy:dy, cx] > 0)[0]
        if len(rows):
            y1 = uy + int(rows[0]) - margin
            y2 = uy + int(rows[-1]) + margin
    return [max(0, x1), max(0, y1), min(W, x2), min(H, y2)]


def _iou(a, b):
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    if ix1 >= ix2 or iy1 >= iy2:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    return inter / max(1, (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter)


def merge_overlapping(dets, iou_thr=0.15):
    if not dets:
        return []
    dets = sorted(dets, key=lambda d: -d["area"])
    kept = []
    for d in dets:
        merged = False
        for k in kept:
            if _iou(d["bbox"], k["bbox"]) > iou_thr:
                k["bbox"] = [min(k["bbox"][0], d["bbox"][0]),
                             min(k["bbox"][1], d["bbox"][1]),
                             max(k["bbox"][2], d["bbox"][2]),
                             max(k["bbox"][3], d["bbox"][3])]
                k["area"] += d["area"]
                merged = True; break
        if not merged:
            kept.append(d)
    return kept


def merge_proximity(dets, max_gap=20):
    if len(dets) <= 1:
        return dets
    dets = sorted(dets, key=lambda d: -d["area"])
    kept = []
    for d in dets:
        merged = False
        for k in kept:
            bx, kb = d["bbox"], k["bbox"]
            hg = max(0, max(bx[0], kb[0]) - min(bx[2], kb[2]))
            vg = max(0, max(bx[1], kb[1]) - min(bx[3], kb[3]))
            if hg <= max_gap and vg <= max_gap:
                k["bbox"] = [min(bx[0], kb[0]), min(bx[1], kb[1]),
                             max(bx[2], kb[2]), max(bx[3], kb[3])]
                k["area"] += d["area"]
                merged = True; break
        if not merged:
            kept.append(d)
    return kept


def _glass_max_run(combined_glass: np.ndarray, bbox: list) -> int:
    """Longest contiguous glass-line run projected along the detection's
    long axis."""
    x1, y1, x2, y2 = bbox
    roi = combined_glass[y1:y2, x1:x2]
    if roi.size == 0:
        return 0
    if (y2 - y1) > (x2 - x1):
        proj = np.any(roi > 0, axis=1).astype(int)
    else:
        proj = np.any(roi > 0, axis=0).astype(int)
    best = cnt = 0
    for v in proj:
        cnt = cnt + 1 if v else 0
        best = max(best, cnt)
    return best


def filter_perimeter(dets: list, wall_mask: np.ndarray,
                     combined_glass: np.ndarray,
                     edge_margin: int = 25, min_win_len: int = 100,
                     run_thr: int = 50) -> list:
    """Keep detections near the building perimeter with real glass content.

    Uses the bounding box of all wall pixels as the perimeter proxy.
    A detection passes when it is within *edge_margin* of any perimeter
    edge, has a maximum glass-line run >= *run_thr*, and its longest
    dimension is at least *min_win_len*.
    """
    ys, xs = np.where(wall_mask > 0)
    if len(xs) == 0:
        return dets
    x_min, x_max = int(xs.min()), int(xs.max())
    y_min, y_max = int(ys.min()), int(ys.max())

    kept: list[dict] = []
    for d in dets:
        x1, y1, x2, y2 = d["bbox"]
        dist = min(x1 - x_min, x_max - x2, y1 - y_min, y_max - y2)
        win_len = max(x2 - x1, y2 - y1)
        if dist > edge_margin:
            continue
        mrun = _glass_max_run(combined_glass, d["bbox"])
        if mrun >= run_thr and win_len >= min_win_len:
            kept.append(d)
    return kept


def _largest_gap(arr: np.ndarray) -> tuple[int, int] | None:
    """Return (start, end) of the longest contiguous zero-run in *arr*."""
    best = None
    best_len = 0
    in_gap = False
    s = 0
    for i, v in enumerate(arr):
        if v == 0 and not in_gap:
            s = i
            in_gap = True
        elif v != 0 and in_gap:
            if i - s > best_len:
                best_len = i - s
                best = (s, i)
            in_gap = False
    if in_gap and len(arr) - s > best_len:
        best = (s, len(arr))
    return best


def trim_to_opening(dets: list, wall_mask: np.ndarray,
                     margin: int = 3) -> list:
    """Shrink each bbox along its long axis to the wall-mask opening.

    Finds the largest contiguous wall-mask gap along the detection's
    long axis and trims the bbox to that gap.
    """
    H, W = wall_mask.shape
    out: list[dict] = []
    for d in dets:
        x1, y1, x2, y2 = d["bbox"]

        if d["orientation"] == "horizontal":
            cy = min(max((y1 + y2) // 2, 0), H - 1)
            row = wall_mask[cy, max(0, x1):min(W, x2)]
            gap = _largest_gap(row)
            if gap is not None:
                nx1 = max(0, x1) + gap[0] - margin
                nx2 = max(0, x1) + gap[1] + margin
                d["bbox"] = [max(0, nx1), y1, min(W, nx2), y2]
        else:
            cx = min(max((x1 + x2) // 2, 0), W - 1)
            col = wall_mask[max(0, y1):min(H, y2), cx]
            gap = _largest_gap(col)
            if gap is not None:
                ny1 = max(0, y1) + gap[0] - margin
                ny2 = max(0, y1) + gap[1] + margin
                d["bbox"] = [x1, max(0, ny1), x2, min(H, ny2)]

        out.append(d)
    return out


def filter_wall_overlap(dets, wall_mask, min_frac=0.04):
    H, W = wall_mask.shape
    kept = []
    for d in dets:
        x1, y1, x2, y2 = d["bbox"]
        roi = wall_mask[max(0,y1):min(H,y2), max(0,x1):min(W,x2)]
        if roi.size == 0:
            continue
        frac = np.count_nonzero(roi) / roi.size
        if frac >= min_frac:
            d["wall_overlap"] = round(frac, 3)
            kept.append(d)
    return kept


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------

def draw_detections(img, dets):
    vis = img.copy()
    c = (255, 165, 0)
    for d in dets:
        x1, y1, x2, y2 = d["bbox"]
        cv2.rectangle(vis, (x1, y1), (x2, y2), c, 2)
        label = f"win #{d['id']}"
        cv2.putText(vis, label, (x1, y1 - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, c, 1, cv2.LINE_AA)
    return vis


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="Detect windows (interior + gap glass-line detection)")
    ap.add_argument("input", help="Floor plan image")
    ap.add_argument("--wall-mask", default="detection/output/masks/walls_mask.png")
    ap.add_argument("--out", default="detection/output/overlays/windows_overlay.png")
    ap.add_argument("--save-json", default="detection/output/json/windows_detections.json")
    ap.add_argument("--bin-threshold", type=int, default=160)
    ap.add_argument("--min-line-len", type=int, default=25)
    ap.add_argument("--wall-erosion", type=int, default=2)
    args = ap.parse_args()

    if not os.path.isfile(args.input):
        sys.exit(f"Not found: {args.input}")
    img = cv2.imread(args.input)
    if img is None:
        sys.exit(f"Cannot read: {args.input}")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    H, W = gray.shape
    print(f"Image: {W}x{H}")

    if not os.path.isfile(args.wall_mask):
        sys.exit(f"Wall mask not found: {args.wall_mask}")
    wall_mask = cv2.imread(args.wall_mask, cv2.IMREAD_GRAYSCALE)

    # --- Method A: interior glass lines ---
    interior_glass = detect_interior_glass(
        gray, wall_mask,
        bin_thresh=args.bin_threshold,
        min_line_len=args.min_line_len,
        wall_erosion=args.wall_erosion,
    )
    out_root = os.path.dirname(os.path.dirname(args.out)) or "detection/output"
    debug_dir = os.path.join(out_root, "debug")
    os.makedirs(debug_dir, exist_ok=True)
    cv2.imwrite(os.path.join(debug_dir, "debug_interior_glass.png"), interior_glass)

    # --- Method B: gap glass lines ---
    gap_glass = detect_gap_glass(
        gray, wall_mask,
        bin_thresh=args.bin_threshold,
        min_line_len=args.min_line_len,
    )
    cv2.imwrite(os.path.join(debug_dir, "debug_gap_glass.png"), gap_glass)

    # Combine both methods
    combined = cv2.bitwise_or(interior_glass, gap_glass)
    cv2.imwrite(os.path.join(debug_dir, "debug_combined_glass.png"), combined)
    print("Debug images saved")

    # Connected components
    comps = find_components(combined)
    print(f"Candidate components: {len(comps)}")
    for c in comps:
        print(f"  {c['bbox']}  area={c['area']}  {c['orientation']}")

    # Expand to wall width (use bridged wall for gap areas)
    kv_b = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 250))
    kh_b = cv2.getStructuringElement(cv2.MORPH_RECT, (250, 1))
    wall_for_expand = cv2.bitwise_or(
        cv2.morphologyEx(wall_mask, cv2.MORPH_CLOSE, kv_b),
        cv2.morphologyEx(wall_mask, cv2.MORPH_CLOSE, kh_b))
    for c in comps:
        c["bbox"] = expand_to_wall(c["bbox"], wall_for_expand, c["orientation"])

    dets = merge_overlapping(comps)
    print(f"After IoU merge: {len(dets)}")

    dets = merge_proximity(dets, max_gap=20)
    print(f"After proximity merge: {len(dets)}")

    dets = filter_wall_overlap(dets, wall_for_expand)
    print(f"After wall filter: {len(dets)}")

    dets = filter_perimeter(dets, wall_mask, combined)
    print(f"After perimeter filter: {len(dets)}")

    dets = trim_to_opening(dets, wall_mask)

    dets.sort(key=lambda d: (d["bbox"][1], d["bbox"][0]))
    for i, d in enumerate(dets):
        d["id"] = i + 1

    print(f"\nDetected {len(dets)} windows:")
    for d in dets:
        x1, y1, x2, y2 = d["bbox"]
        print(f"  #{d['id']}: [{x1},{y1}]-[{x2},{y2}]  "
              f"{d['orientation']}  wall={d.get('wall_overlap','n/a')}")

    overlay = draw_detections(img, dets)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    cv2.imwrite(args.out, overlay)
    print(f"\nOverlay: {args.out}")

    h, w = img.shape[:2]
    mask_path = os.path.join(out_root, "masks", "windows_mask.png")
    os.makedirs(os.path.join(out_root, "masks"), exist_ok=True)
    windows_mask = np.zeros((h, w), dtype=np.uint8)
    for d in dets:
        x1, y1, x2, y2 = d["bbox"]
        cv2.rectangle(windows_mask, (x1, y1), (x2, y2), 255, -1)
    cv2.imwrite(mask_path, windows_mask)
    print(f"Mask: {mask_path}")

    if args.save_json:
        os.makedirs(os.path.dirname(args.save_json) or ".", exist_ok=True)
        with open(args.save_json, "w", encoding="utf-8") as f:
            json.dump([{"id": d["id"], "bbox": d["bbox"],
                        "orientation": d["orientation"]}
                       for d in dets], f, indent=2)
        print(f"JSON: {args.save_json}")


if __name__ == "__main__":
    main()
