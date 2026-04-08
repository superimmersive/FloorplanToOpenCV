"""
Detect doors on floor plans by finding arc/swing marks (quarter-circle arcs).

Uses Hough Circle Transform to find circle candidates from partial arcs, then
verifies each is a real door arc by checking what fraction of the circumference
has edge pixels. Validates against the wall mask to reduce false positives:
doors must be near wall gaps with the pivot on or adjacent to a wall.

Usage:
  python detect_doors.py input/GF_clean.jpg --out output/doors_overlay.png
  python detect_doors.py input/GF_clean.jpg --out output/doors_overlay.png --save-json output/doors_detections.json
  python detect_doors.py input/GF_clean.jpg --walls-mask output/walls_mask.png --out output/doors_overlay.png --save-json output/doors_detections.json
"""

import argparse
import json
import math
import os
import sys

import cv2
import numpy as np


def get_edge_map(gray: np.ndarray) -> np.ndarray:
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blurred, 30, 100)
    return edges


def arc_coverage(edges: np.ndarray, cx: float, cy: float, radius: float,
                 band: int = 2, num_samples: int = 720):
    """
    Check what fraction of a circle's circumference has edge pixels.
    Uses a ±band pixel tolerance around the nominal radius.
    Returns (total_fraction, sector_fractions, hit_angles) where hit_angles
    is a boolean array of which sample positions had hits.
    """
    h, w = edges.shape
    hits = 0
    quadrant_hits = [0, 0, 0, 0]
    valid = 0
    hit_flags = [False] * num_samples
    for i in range(num_samples):
        angle = 2 * math.pi * i / num_samples
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        in_bounds = False
        for dr in range(-band, band + 1):
            px = int(round(cx + (radius + dr) * cos_a))
            py = int(round(cy + (radius + dr) * sin_a))
            if 0 <= px < w and 0 <= py < h:
                in_bounds = True
                if edges[py, px] > 0:
                    q = i * 4 // num_samples
                    hits += 1
                    quadrant_hits[q] += 1
                    hit_flags[i] = True
                    break
        if in_bounds:
            valid += 1
    total_frac = hits / valid if valid > 0 else 0
    samples_per_q = num_samples // 4
    q_fracs = [qh / samples_per_q for qh in quadrant_hits]
    return total_frac, q_fracs, hit_flags


def longest_contiguous_arc(hit_flags: list, num_samples: int = 720):
    """
    Find the longest contiguous run of True values (with small gap tolerance).
    Returns the run length as a fraction of num_samples.
    A real door arc is one continuous segment; noise is scattered.
    """
    gap_tol = max(3, num_samples // 120)
    best_run = 0
    current_run = 0
    gap_count = 0
    for i in range(num_samples * 2):
        idx = i % num_samples
        if hit_flags[idx]:
            current_run += 1 + gap_count
            gap_count = 0
        else:
            gap_count += 1
            if gap_count > gap_tol:
                best_run = max(best_run, current_run)
                current_run = 0
                gap_count = 0
    best_run = max(best_run, current_run)
    return best_run / num_samples


def is_door_arc(total_frac: float, q_fracs: list, hit_flags: list = None) -> bool:
    """
    A door arc (quarter circle) should have:
      - Overall coverage 12-38%.
      - 1-2 quadrants with strong coverage (>= 35%).
      - At least 2 quadrants nearly empty (<= 8%).
      - The arc is contiguous (not scattered noise).
    """
    if not (0.125 <= total_frac <= 0.42):
        return False

    best_q = max(q_fracs)
    if best_q >= 0.85:
        return True

    strong = sum(1 for q in q_fracs if q >= 0.35)
    empty = sum(1 for q in q_fracs if q <= 0.08)
    if strong < 1 or strong > 2:
        return False
    if empty < 2:
        return False

    second_q = sorted(q_fracs, reverse=True)[1]
    if strong == 1 and second_q > 0.22:
        return False

    if hit_flags is not None:
        cont = longest_contiguous_arc(hit_flags, len(hit_flags))
        if cont < 0.08:
            return False
    return True


def is_thin_dark_line(gray: np.ndarray, cx: float, cy: float, radius: float,
                      q_fracs: list, num_samples: int = 80) -> bool:
    """
    Verify the arc is a thin dark line, not a thick wall or noise.
    """
    h, w = gray.shape
    best_q = max(range(4), key=lambda i: q_fracs[i])
    start_angle = best_q * (math.pi / 2)
    end_angle = start_angle + (math.pi / 2)

    dark_on_arc = 0
    light_near = 0
    total = 0
    for i in range(num_samples):
        angle = start_angle + (end_angle - start_angle) * i / num_samples
        cos_a, sin_a = math.cos(angle), math.sin(angle)

        ax = int(round(cx + radius * cos_a))
        ay = int(round(cy + radius * sin_a))
        if not (0 <= ax < w and 0 <= ay < h):
            continue

        total += 1

        found_dark = False
        for dr in range(-4, 5):
            bx = int(round(cx + (radius + dr) * cos_a))
            by = int(round(cy + (radius + dr) * sin_a))
            if 0 <= bx < w and 0 <= by < h and gray[by, bx] < 170:
                found_dark = True
                break
        if found_dark:
            dark_on_arc += 1

        offset = 12
        ix = int(round(cx + (radius - offset) * cos_a))
        iy = int(round(cy + (radius - offset) * sin_a))
        ox = int(round(cx + (radius + offset) * cos_a))
        oy = int(round(cy + (radius + offset) * sin_a))
        if 0 <= ix < w and 0 <= iy < h and gray[iy, ix] > 140:
            light_near += 1
        if 0 <= ox < w and 0 <= oy < h and gray[oy, ox] > 140:
            light_near += 1

    if total < 10:
        return False
    dark_ratio = dark_on_arc / total
    light_ratio = light_near / (total * 2)

    return dark_ratio >= 0.12 and light_ratio >= 0.15


def check_interior_clean(edges: np.ndarray, cx: float, cy: float, radius: float,
                         q_fracs: list) -> bool:
    """
    Check that the interior of the arc quadrant is mostly edge-free.
    Staircase arcs have many edge pixels inside (stair lines);
    real door arcs have open floor space with very few edges.
    """
    h, w = edges.shape
    best_q = max(range(4), key=lambda i: q_fracs[i])
    start_angle = best_q * (math.pi / 2)
    end_angle = start_angle + (math.pi / 2)

    edge_count = 0
    total = 0
    for r_frac in [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]:
        r_sample = int(radius * r_frac)
        for i in range(24):
            angle = start_angle + (end_angle - start_angle) * i / 24
            px = int(round(cx + r_sample * math.cos(angle)))
            py = int(round(cy + r_sample * math.sin(angle)))
            if 0 <= px < w and 0 <= py < h:
                total += 1
                if edges[py, px] > 0:
                    edge_count += 1
    if total == 0:
        return False
    edge_ratio = edge_count / total
    return edge_ratio < 0.10


def validate_with_wall_mask(cx: int, cy: int, radius: int, q_fracs: list,
                            wall_mask: np.ndarray, max_pivot_dist: int = 18) -> bool:
    """
    Validate a door arc against the wall mask:
    1. The pivot (center) must be near a wall pixel (within max_pivot_dist).
    2. The arc sweep area should be mostly non-wall (open floor space).
    3. There should be wall pixels along at least one radial edge of the arc
       (the wall the door is attached to).
    """
    h, w = wall_mask.shape
    if cx < 0 or cx >= w or cy < 0 or cy >= h:
        return False

    y_lo = max(0, cy - max_pivot_dist)
    y_hi = min(h, cy + max_pivot_dist + 1)
    x_lo = max(0, cx - max_pivot_dist)
    x_hi = min(w, cx + max_pivot_dist + 1)
    patch = wall_mask[y_lo:y_hi, x_lo:x_hi]
    if np.count_nonzero(patch) == 0:
        return False

    best_q = max(range(4), key=lambda i: q_fracs[i])
    start_angle = best_q * (math.pi / 2)
    end_angle = start_angle + (math.pi / 2)

    wall_hits = 0
    total_samples = 0
    for frac in [0.3, 0.5, 0.7]:
        r_sample = int(radius * frac)
        for i in range(24):
            angle = start_angle + (end_angle - start_angle) * i / 24
            px = int(round(cx + r_sample * math.cos(angle)))
            py = int(round(cy + r_sample * math.sin(angle)))
            if 0 <= px < w and 0 <= py < h:
                total_samples += 1
                if wall_mask[py, px] > 0:
                    wall_hits += 1

    if total_samples == 0:
        return False
    wall_ratio = wall_hits / total_samples
    if wall_ratio > 0.30:
        return False

    return True


def detect_doors_hough(gray: np.ndarray, edges: np.ndarray,
                       wall_mask: np.ndarray = None,
                       min_radius: int = 30, max_radius: int = 180,
                       hough_param1: int = 80, hough_param2: int = 25,
                       min_dist_ratio: float = 0.5):
    h, w = gray.shape
    min_dist = int(min_radius * min_dist_ratio)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    circles = cv2.HoughCircles(
        blurred,
        cv2.HOUGH_GRADIENT,
        dp=1.5,
        minDist=max(min_dist, 35),
        param1=hough_param1,
        param2=hough_param2,
        minRadius=min_radius,
        maxRadius=max_radius,
    )

    if circles is None:
        return []

    candidates = []
    for (cx, cy, r) in circles[0]:
        cx, cy, r = float(cx), float(cy), float(r)
        total_frac, q_fracs, hit_flags = arc_coverage(edges, cx, cy, r)
        if not is_door_arc(total_frac, q_fracs, hit_flags):
            continue
        if not is_thin_dark_line(gray, cx, cy, r, q_fracs):
            continue
        if not check_interior_clean(edges, cx, cy, r, q_fracs):
            continue

        margin_pct = 0.04
        if cx < w * margin_pct or cx > w * (1 - margin_pct) or cy < h * margin_pct or cy > h * (1 - margin_pct):
            continue

        if wall_mask is not None:
            if not validate_with_wall_mask(int(round(cx)), int(round(cy)),
                                           int(round(r)), q_fracs, wall_mask):
                continue

        arc_quadrants = [i for i, qf in enumerate(q_fracs) if qf >= 0.15]
        candidates.append({
            "center": (int(round(cx)), int(round(cy))),
            "radius": int(round(r)),
            "total_coverage": round(total_frac, 3),
            "quadrant_coverage": [round(qf, 3) for qf in q_fracs],
            "arc_quadrants": arc_quadrants,
        })

    return candidates


def split_double_doors(detections: list) -> list:
    """
    If a detection has 2 adjacent strong quadrants (both >= 0.30), it's likely
    two doors sharing a hinge point. Split into two separate detections.
    """
    out = []
    for d in detections:
        q = d["quadrant_coverage"]
        strong_qs = [i for i in range(4) if q[i] >= 0.30]
        if len(strong_qs) == 2:
            a, b = strong_qs
            if abs(a - b) == 1 or {a, b} == {0, 3}:
                cx, cy = d["center"]
                r = d["radius"]
                for sq in strong_qs:
                    new_d = dict(d)
                    new_d["center"] = (cx, cy)
                    new_d["radius"] = r
                    new_d["quadrant_coverage"] = [q[sq] if i == sq else 0.0 for i in range(4)]
                    new_d["total_coverage"] = q[sq] / 4
                    new_d["arc_quadrants"] = [sq]
                    new_d["is_double_door"] = True
                    out.append(new_d)
                continue
        out.append(d)
    return out


def merge_nearby(detections: list, merge_dist: int = 50) -> list:
    """Keep one detection per cluster of nearby centers (prefer higher coverage)."""
    if not detections:
        return []
    detections = sorted(detections, key=lambda d: -d["total_coverage"])
    kept = []
    for d in detections:
        cx, cy = d["center"]
        too_close = False
        for k in kept:
            kx, ky = k["center"]
            if math.hypot(cx - kx, cy - ky) < merge_dist:
                too_close = True
                break
        if not too_close:
            kept.append(d)
    return kept


def determine_swing_direction(q_fracs: list):
    """
    Determine the door swing direction from the dominant quadrant.
    Returns (swing_quadrant, swing_label) where label describes the arc direction.
    Q0 (0-90°): arc sweeps right and down
    Q1 (90-180°): arc sweeps down and left
    Q2 (180-270°): arc sweeps left and up
    Q3 (270-360°): arc sweeps up and right
    """
    best_q = max(range(4), key=lambda i: q_fracs[i])
    labels = {0: "right-down", 1: "down-left", 2: "left-up", 3: "up-right"}
    return best_q, labels[best_q]


def compute_bbox(cx: int, cy: int, r: int, q_fracs: list, img_w: int, img_h: int):
    best_q = max(range(4), key=lambda i: q_fracs[i])
    pad = 5

    if best_q == 0:
        x1, y1 = cx - pad, cy - pad
        x2, y2 = cx + r + pad, cy + r + pad
    elif best_q == 1:
        x1, y1 = cx - r - pad, cy - pad
        x2, y2 = cx + pad, cy + r + pad
    elif best_q == 2:
        x1, y1 = cx - r - pad, cy - r - pad
        x2, y2 = cx + pad, cy + pad
    elif best_q == 3:
        x1, y1 = cx - pad, cy - r - pad
        x2, y2 = cx + r + pad, cy + pad
    else:
        x1, y1 = cx - r - pad, cy - r - pad
        x2, y2 = cx + r + pad, cy + r + pad

    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = min(img_w, x2)
    y2 = min(img_h, y2)
    return (x1, y1, x2, y2)


def draw_detections(img: np.ndarray, detections: list) -> np.ndarray:
    overlay = img.copy()
    h, w = img.shape[:2]
    box_color = (0, 200, 0)
    arc_color = (0, 255, 255)
    pivot_color = (0, 0, 255)

    for i, d in enumerate(detections):
        cx, cy = d["center"]
        r = d["radius"]
        q_fracs = d["quadrant_coverage"]
        bbox = compute_bbox(cx, cy, r, q_fracs, w, h)
        x1, y1, x2, y2 = bbox
        d["bbox"] = [x1, y1, x2, y2]

        best_q = max(range(4), key=lambda j: q_fracs[j])
        start_deg = best_q * 90
        cv2.ellipse(overlay, (cx, cy), (r, r), 0, start_deg, start_deg + 90,
                     arc_color, 2, cv2.LINE_AA)

        cv2.rectangle(overlay, (x1, y1), (x2, y2), box_color, 2)
        cv2.circle(overlay, (cx, cy), 5, pivot_color, -1)

        is_dbl = "D" if d.get("is_double_door") else ""
        label = f"door #{i+1}{is_dbl} r={r}"
        cv2.putText(overlay, label, (x1, y1 - 8), cv2.FONT_HERSHEY_SIMPLEX,
                    0.45, box_color, 1, cv2.LINE_AA)
    return overlay


def main():
    parser = argparse.ArgumentParser(description="Detect doors on floor plans via arc detection")
    parser.add_argument("input", help="Path to floor plan image")
    parser.add_argument("--walls-mask", default="", help="Path to walls_mask.png for validation")
    parser.add_argument("--out", default="detection/output/overlays/doors_overlay.png", help="Output overlay image")
    parser.add_argument("--save-json", default="", help="Save detections to JSON")
    parser.add_argument("--min-radius", type=int, default=None, help="Override: single min radius")
    parser.add_argument("--max-radius", type=int, default=None, help="Override: single max radius")
    parser.add_argument("--merge-dist", type=int, default=45, help="Merge arcs closer than this (pixels)")
    parser.add_argument("--param1", type=int, default=80, help="Canny high threshold for HoughCircles")
    parser.add_argument("--param2", type=int, default=25, help="Accumulator threshold (lower = more sensitive)")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print("Image not found:", args.input)
        sys.exit(1)

    img = cv2.imread(args.input)
    if img is None:
        print("Could not read image:", args.input)
        sys.exit(1)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = img.shape[:2]
    edges = get_edge_map(gray)

    wall_mask = None
    mask_path = args.walls_mask
    if not mask_path:
        out_root = os.path.dirname(os.path.dirname(args.out)) or "detection/output"
        auto_path = os.path.join(out_root, "masks", "walls_mask.png")
        if os.path.isfile(auto_path):
            mask_path = auto_path
    if mask_path and os.path.isfile(mask_path):
        wall_mask = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)
        if wall_mask is not None:
            if wall_mask.shape[:2] != (h, w):
                wall_mask = cv2.resize(wall_mask, (w, h))
            print(f"Using wall mask: {mask_path}")

    print(f"Image: {w}x{h}")

    if args.min_radius is not None and args.max_radius is not None:
        bands = [(args.min_radius, args.max_radius)]
    else:
        bands = [
            (50, 80),    # small doors (WC, closets)
            (80, 115),   # standard doors
            (115, 170),  # large doors (lounge, dining)
        ]

    p2_per_band = {
        (50, 80): max(18, args.param2 - 5),
        (80, 115): args.param2,
        (115, 170): args.param2,
    }

    all_detections = []
    for r_min, r_max in bands:
        p2 = p2_per_band.get((r_min, r_max), args.param2)
        print(f"  Band {r_min}-{r_max}px (param2={p2})...", end=" ")
        dets = detect_doors_hough(
            gray, edges,
            wall_mask=wall_mask,
            min_radius=r_min, max_radius=r_max,
            hough_param1=args.param1, hough_param2=p2,
        )
        print(f"{len(dets)} candidates")
        all_detections.extend(dets)

    print(f"Total candidates: {len(all_detections)}")
    all_detections = split_double_doors(all_detections)
    print(f"After double-door split: {len(all_detections)}")
    detections = merge_nearby(all_detections, merge_dist=args.merge_dist)
    print(f"After merging nearby: {len(detections)} doors")

    detections = [d for d in detections if d["total_coverage"] >= 0.13]
    print(f"After coverage filter: {len(detections)} doors")

    for d in detections:
        q, label = determine_swing_direction(d["quadrant_coverage"])
        d["swing_quadrant"] = q
        d["swing_direction"] = label

    overlay = draw_detections(img, detections)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    cv2.imwrite(args.out, overlay)
    print("Saved:", args.out)

    out_root = os.path.dirname(os.path.dirname(args.out)) or "detection/output"
    mask_path = os.path.join(out_root, "masks", "doors_mask.png")
    os.makedirs(os.path.join(out_root, "masks"), exist_ok=True)
    doors_mask = np.zeros((h, w), dtype=np.uint8)
    for d in detections:
        cx, cy = d["center"]
        r = d["radius"]
        q_fracs = d["quadrant_coverage"]
        best_q = max(range(4), key=lambda j: q_fracs[j])
        start_deg = best_q * 90
        cv2.ellipse(doors_mask, (cx, cy), (r, r), 0, start_deg,
                     start_deg + 90, 255, -1)
    cv2.imwrite(mask_path, doors_mask)
    print("Saved:", mask_path)

    if args.save_json:
        out_list = []
        for i, d in enumerate(detections):
            out_list.append({
                "id": i + 1,
                "bbox": d.get("bbox", [0, 0, 0, 0]),
                "center": list(d["center"]),
                "radius": d["radius"],
                "coverage": d["total_coverage"],
                "quadrant_coverage": d["quadrant_coverage"],
                "swing_quadrant": d.get("swing_quadrant"),
                "swing_direction": d.get("swing_direction"),
                "is_double_door": d.get("is_double_door", False),
            })
        with open(args.save_json, "w", encoding="utf-8") as f:
            json.dump(out_list, f, indent=2)
        print("Saved detections:", args.save_json)


if __name__ == "__main__":
    main()
