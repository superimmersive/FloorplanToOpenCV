"""
Detect rooms on a floor plan by finding enclosed regions in the wall mask.

Seals door and window gaps to create fully enclosed spaces, then uses
connected components to identify individual rooms and matches OCR text
labels to name each room.

Usage:
  python detect_rooms.py input/GF_clean.jpg --out output/rooms_overlay.png --save-json output/rooms.json
"""

import argparse
import json
import math
import os
import sys

import cv2
import numpy as np


# ---------------------------------------------------------------------------
# Rectilinear helpers (enforce 90-degree corners on room contours)
# ---------------------------------------------------------------------------

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


def _rectify_contour(contour: np.ndarray, epsilon: float = 12.0) -> np.ndarray:
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


def _fill_rectilinear(mask: np.ndarray, vertices: np.ndarray,
                      value: int = 255):
    """Scanline fill for a rectilinear polygon — pixel-perfect H/V edges."""
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


def build_full_wall_mask(gray: np.ndarray, thick_walls: np.ndarray,
                         text_json: str = "") -> np.ndarray:
    """
    Combine the thick grey wall mask with thin dark partition lines
    detected from the grayscale image. Subtracts known text regions
    to avoid treating text as walls.
    """
    h, w = gray.shape

    _, dark = cv2.threshold(gray, 140, 255, cv2.THRESH_BINARY_INV)

    kh = cv2.getStructuringElement(cv2.MORPH_RECT, (35, 1))
    kv = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 35))
    horizontal = cv2.morphologyEx(dark, cv2.MORPH_OPEN, kh)
    vertical = cv2.morphologyEx(dark, cv2.MORPH_OPEN, kv)
    lines = cv2.bitwise_or(horizontal, vertical)

    margin_x = int(w * 0.06)
    margin_y = int(h * 0.06)
    lines[:margin_y, :] = 0
    lines[h - margin_y:, :] = 0
    lines[:, :margin_x] = 0
    lines[:, w - margin_x:] = 0

    if text_json and os.path.isfile(text_json):
        with open(text_json, "r") as f:
            texts = json.load(f)
        text_mask = np.zeros((h, w), dtype=np.uint8)
        pad = 8
        for t in texts:
            bbox = t.get("bbox", [])
            if len(bbox) >= 4:
                xs = [p[0] for p in bbox]
                ys = [p[1] for p in bbox]
                x1 = max(0, min(xs) - pad)
                y1 = max(0, min(ys) - pad)
                x2 = min(w, max(xs) + pad)
                y2 = min(h, max(ys) + pad)
                cv2.rectangle(text_mask, (x1, y1), (x2, y2), 255, -1)
        lines = cv2.bitwise_and(lines, cv2.bitwise_not(text_mask))

    combined = cv2.bitwise_or(thick_walls, lines)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel)

    return combined


ROOM_COLORS = [
    (76, 175, 80),    # green
    (33, 150, 243),   # blue
    (255, 152, 0),    # orange
    (156, 39, 176),   # purple
    (0, 188, 212),    # cyan
    (255, 87, 34),    # deep orange
    (63, 81, 181),    # indigo
    (205, 220, 57),   # lime
    (233, 30, 99),    # pink
    (121, 85, 72),    # brown
    (255, 235, 59),   # yellow
    (96, 125, 139),   # blue-grey
]

KNOWN_ROOM_NAMES = [
    "LOUNGE", "KITCHEN", "HALL", "DINING", "STUDY",
    "WC", "LAUNDRY", "ST.", "BEDROOM", "BATHROOM",
    "GARAGE", "ENTRANCE", "CORRIDOR", "PANTRY",
]


def seal_door_gaps(mask: np.ndarray, doors_json: str, thickness: int = 22):
    """Draw lines at door openings to seal wall gaps."""
    if not os.path.isfile(doors_json):
        return mask
    with open(doors_json, "r") as f:
        doors = json.load(f)

    sealed = mask.copy()
    for d in doors:
        cx, cy = d["center"]
        r = d["radius"]
        q = d.get("swing_quadrant", 0)

        start_angle = q * math.pi / 2
        end_angle = (q + 1) * math.pi / 2

        ex1 = int(cx + r * math.cos(start_angle))
        ey1 = int(cy + r * math.sin(start_angle))
        ex2 = int(cx + r * math.cos(end_angle))
        ey2 = int(cy + r * math.sin(end_angle))

        cv2.line(sealed, (ex1, ey1), (ex2, ey2), 255, thickness)
        cv2.line(sealed, (cx, cy), (ex1, ey1), 255, thickness)
        cv2.line(sealed, (cx, cy), (ex2, ey2), 255, thickness)

    return sealed


def seal_window_gaps(mask: np.ndarray, windows_json: str, thickness: int = 22):
    """Draw lines at window openings to seal wall gaps."""
    if not os.path.isfile(windows_json):
        return mask
    with open(windows_json, "r") as f:
        windows = json.load(f)

    sealed = mask.copy()
    for w in windows:
        bbox = w.get("bbox", [])
        if len(bbox) == 4:
            x1, y1, x2, y2 = bbox
            bw = x2 - x1
            bh = y2 - y1
            if bw > bh:
                mid_y = (y1 + y2) // 2
                cv2.line(sealed, (x1, mid_y), (x2, mid_y), 255, thickness)
            else:
                mid_x = (x1 + x2) // 2
                cv2.line(sealed, (mid_x, y1), (mid_x, y2), 255, thickness)
    return sealed


def close_remaining_gaps(mask: np.ndarray, gap_size: int = 30):
    """Morphological closing to bridge any small remaining gaps."""
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (gap_size, gap_size))
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)


def get_room_seeds(text_json: str):
    """
    Get room center seed points from OCR text and known positions.
    Returns list of (name, x, y).
    """
    seeds = []

    known_positions = {
        "HALL": (1150, 1000),
        "DINING": (1600, 1080),
    }
    for name, (x, y) in known_positions.items():
        seeds.append((name, x, y))

    if os.path.isfile(text_json):
        with open(text_json, "r") as f:
            texts = json.load(f)
        for t in texts:
            txt = t["text"].strip().upper().replace(",", ".")
            matched_name = None
            for name in KNOWN_ROOM_NAMES:
                if name in txt or txt in name:
                    matched_name = name
                    break
            if matched_name and not any(s[0] == matched_name for s in seeds):
                bbox = t["bbox"]
                cx = int(sum(p[0] for p in bbox) / len(bbox))
                cy = int(sum(p[1] for p in bbox) / len(bbox))
                seeds.append((matched_name, cx, cy))

    return seeds


def find_rooms_watershed(sealed_walls: np.ndarray, seeds: list, min_area: int = 5000):
    """
    Find rooms using multi-source BFS from seed points, with walls as barriers.
    Each room grows outward from its seed until it hits a wall or another room.
    """
    from collections import deque

    h, w = sealed_walls.shape
    is_wall = sealed_walls > 127

    room_map = np.zeros((h, w), dtype=np.int32)

    queue = deque()
    for idx, (name, sx, sy) in enumerate(seeds, start=1):
        if 0 <= sx < w and 0 <= sy < h and not is_wall[sy, sx]:
            room_map[sy, sx] = idx
            queue.append((sy, sx))
        else:
            for dy in range(-30, 31):
                for dx in range(-30, 31):
                    ny, nx = sy + dy, sx + dx
                    if 0 <= nx < w and 0 <= ny < h and not is_wall[ny, nx]:
                        room_map[ny, nx] = idx
                        queue.append((ny, nx))
                        break
                else:
                    continue
                break

    dirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    while queue:
        cy, cx = queue.popleft()
        label = room_map[cy, cx]
        for dy, dx in dirs:
            ny, nx = cy + dy, cx + dx
            if 0 <= nx < w and 0 <= ny < h:
                if room_map[ny, nx] == 0 and not is_wall[ny, nx]:
                    room_map[ny, nx] = label
                    queue.append((ny, nx))

    rooms = []
    for idx, (name, sx, sy) in enumerate(seeds, start=1):
        room_mask = (room_map == idx).astype(np.uint8) * 255
        area = np.count_nonzero(room_mask)
        if area < min_area:
            continue

        contours, _ = cv2.findContours(room_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        contour = max(contours, key=cv2.contourArea)

        M = cv2.moments(contour)
        if M["m00"] > 0:
            cx_r = int(M["m10"] / M["m00"])
            cy_r = int(M["m01"] / M["m00"])
        else:
            cx_r, cy_r = sx, sy

        x, y, rw, rh = cv2.boundingRect(contour)

        rooms.append({
            "id": len(rooms) + 1,
            "label": name,
            "bbox": [int(x), int(y), int(x + rw), int(y + rh)],
            "centroid": [cx_r, cy_r],
            "area_px": int(area),
            "contour": contour,
        })

    rooms.sort(key=lambda r: r["area_px"], reverse=True)
    for i, r in enumerate(rooms):
        r["id"] = i + 1

    return rooms, room_map


def rectify_room_contours(rooms: list, wall_mask: np.ndarray,
                          room_map_bfs: np.ndarray) -> tuple:
    """
    Enforce 90-degree corners on all room contours.

    1. Rectify each raw BFS contour to strict H/V edges.
    2. Rebuild a clean room_map from the rectified polygons (largest
       rooms painted first so smaller rooms take priority on overlap).
    3. Fill any remaining gaps using the original BFS assignment.
    4. Re-extract contours from the clean map and rectify once more.
    """
    h, w = wall_mask.shape
    is_wall = wall_mask > 127

    rect = {}
    for room in rooms:
        rect[room["id"]] = _rectify_contour(room["contour"], epsilon=12.0)

    new_map = np.zeros((h, w), dtype=np.int32)
    for room in sorted(rooms, key=lambda r: r["area_px"], reverse=True):
        idx = room["id"]
        tmp = np.zeros((h, w), dtype=np.uint8)
        _fill_rectilinear(tmp, rect[idx], 255)
        new_map[(tmp > 0) & (~is_wall)] = idx

    gaps = (new_map == 0) & (~is_wall) & (room_map_bfs > 0)
    new_map[gaps] = room_map_bfs[gaps]

    for room in rooms:
        idx = room["id"]
        rmask = (new_map == idx).astype(np.uint8) * 255
        area = np.count_nonzero(rmask)
        contours, _ = cv2.findContours(rmask, cv2.RETR_EXTERNAL,
                                       cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        contour = max(contours, key=cv2.contourArea)
        room["contour"] = _rectify_contour(contour, epsilon=10.0)
        room["area_px"] = int(area)

        M = cv2.moments(room["contour"])
        if M["m00"] > 0:
            room["centroid"] = [int(M["m10"] / M["m00"]),
                                int(M["m01"] / M["m00"])]

        x, y, rw, rh = cv2.boundingRect(room["contour"])
        room["bbox"] = [int(x), int(y), int(x + rw), int(y + rh)]

    return rooms, new_map


def label_rooms_from_text(rooms: list, text_json: str, labels_map: np.ndarray):
    """Match OCR text labels to rooms by checking which room region the text falls in."""
    if not os.path.isfile(text_json):
        return

    with open(text_json, "r") as f:
        texts = json.load(f)

    room_name_texts = []
    for t in texts:
        txt = t["text"].strip().upper().replace(",", ".").replace(";", ".")
        for name in KNOWN_ROOM_NAMES:
            if name in txt or txt in name:
                bbox = t["bbox"]
                xs = [p[0] for p in bbox]
                ys = [p[1] for p in bbox]
                cx = int(sum(xs) / len(xs))
                cy = int(sum(ys) / len(ys))
                room_name_texts.append({"name": name, "cx": cx, "cy": cy, "raw": t["text"]})
                break

    h, w = labels_map.shape
    for rnt in room_name_texts:
        cx, cy = rnt["cx"], rnt["cy"]
        if 0 <= cx < w and 0 <= cy < h:
            lbl = labels_map[cy, cx]
            for room in rooms:
                if room["label_id"] == lbl and room["label"] is None:
                    room["label"] = rnt["name"]
                    break

    known_rooms_from_plan = {
        "HALL": (1150, 1000),
        "DINING": (1600, 1050),
    }
    for name, (tx, ty) in known_rooms_from_plan.items():
        already_found = any(r["label"] == name for r in rooms)
        if already_found:
            continue
        if 0 <= tx < w and 0 <= ty < h:
            lbl = labels_map[ty, tx]
            for room in rooms:
                if room["label_id"] == lbl and room["label"] is None:
                    room["label"] = name
                    break


def draw_rooms_overlay(img: np.ndarray, rooms: list, alpha: float = 0.35) -> np.ndarray:
    overlay = img.copy()
    color_layer = np.zeros_like(img)
    h, w = img.shape[:2]

    for i, room in enumerate(rooms):
        color = ROOM_COLORS[i % len(ROOM_COLORS)]
        contour = room["contour"]
        fill_mask = np.zeros((h, w), dtype=np.uint8)
        _fill_rectilinear(fill_mask, contour, 255)
        color_layer[fill_mask > 0] = color
        cv2.drawContours(overlay, [contour], -1, color, 2)

    filled = cv2.cvtColor(color_layer, cv2.COLOR_BGR2GRAY) > 0
    overlay[filled] = cv2.addWeighted(img, 1 - alpha, color_layer, alpha, 0)[filled]

    for i, room in enumerate(rooms):
        color = ROOM_COLORS[i % len(ROOM_COLORS)]
        cx, cy = room["centroid"]
        label = room["label"] or f"Room {room['id']}"

        font = cv2.FONT_HERSHEY_SIMPLEX
        scale = 0.55
        thickness = 2
        (tw, th), _ = cv2.getTextSize(label, font, scale, thickness)

        tx = cx - tw // 2
        ty = cy + th // 2

        cv2.rectangle(overlay, (tx - 4, ty - th - 4), (tx + tw + 4, ty + 6), (255, 255, 255), -1)
        cv2.rectangle(overlay, (tx - 4, ty - th - 4), (tx + tw + 4, ty + 6), color, 2)
        cv2.putText(overlay, label, (tx, ty), font, scale, (0, 0, 0), thickness, cv2.LINE_AA)

        area_m2 = room.get("area_m2", 0)
        if area_m2:
            area_label = f"#{room['id']} {area_m2:.3f} m\u00b2"
        else:
            area_label = f"#{room['id']} ({room['area_px']}px)"
        (aw, ah), _ = cv2.getTextSize(area_label, font, 0.4, 1)
        cv2.putText(overlay, area_label, (cx - aw // 2, cy + th + 14),
                    font, 0.4, color, 1, cv2.LINE_AA)

        if area_m2:
            sf_label = f"{area_m2 * 10.7639:.1f} SF"
            (sw, _), _ = cv2.getTextSize(sf_label, font, 0.4, 1)
            cv2.putText(overlay, sf_label, (cx - sw // 2, cy + th + 28),
                        font, 0.4, color, 1, cv2.LINE_AA)

    return overlay


def main():
    parser = argparse.ArgumentParser(description="Detect rooms on a floor plan")
    parser.add_argument("input", help="Path to floor plan image")
    parser.add_argument("--walls-mask", default="detection/output/masks/walls_mask.png")
    parser.add_argument("--doors-json", default="detection/output/json/doors_detections.json")
    parser.add_argument("--windows-json", default="detection/output/json/windows_detections.json")
    parser.add_argument("--text-json", default="detection/output/json/detected_text.json")
    parser.add_argument("--dim-json", default="detection/output/json/dim_lines.json", help="For scale factor")
    parser.add_argument("--out", default="detection/output/overlays/rooms_overlay.png")
    parser.add_argument("--save-json", default="detection/output/json/rooms.json")
    parser.add_argument("--min-area", type=int, default=15000, help="Minimum room area in pixels")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print("Image not found:", args.input)
        sys.exit(1)

    img = cv2.imread(args.input)
    if img is None:
        print("Could not read image:", args.input)
        sys.exit(1)

    wall_mask = cv2.imread(args.walls_mask, cv2.IMREAD_GRAYSCALE)
    if wall_mask is None:
        print("Wall mask not found:", args.walls_mask)
        sys.exit(1)

    h, w = img.shape[:2]
    if wall_mask.shape[:2] != (h, w):
        wall_mask = cv2.resize(wall_mask, (w, h))

    _, wall_mask = cv2.threshold(wall_mask, 127, 255, cv2.THRESH_BINARY)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    print(f"Image: {w}x{h}")
    print(f"Grey wall pixels: {np.count_nonzero(wall_mask)}")

    print("Building full wall mask (grey walls + dark partition lines)...")
    full_walls = build_full_wall_mask(gray, wall_mask, text_json=args.text_json)
    print(f"Full wall pixels: {np.count_nonzero(full_walls)}")

    out_root = os.path.dirname(os.path.dirname(args.out)) or "detection/output"
    debug_dir = os.path.join(out_root, "debug")
    os.makedirs(debug_dir, exist_ok=True)
    cv2.imwrite(os.path.join(debug_dir, "rooms_full_walls.png"), full_walls)

    print("Sealing door gaps...")
    sealed = seal_door_gaps(full_walls, args.doors_json)
    print("Sealing window gaps...")
    sealed = seal_window_gaps(sealed, args.windows_json)
    print("Closing remaining small gaps...")
    sealed = close_remaining_gaps(sealed, gap_size=20)

    cv2.imwrite(os.path.join(debug_dir, "rooms_sealed_walls.png"), sealed)

    print("Getting room seeds from OCR text...")
    seeds = get_room_seeds(args.text_json)
    print(f"Room seeds: {[(s[0], s[1], s[2]) for s in seeds]}")

    print("Finding rooms via multi-source BFS...")
    rooms, room_map = find_rooms_watershed(sealed, seeds, min_area=args.min_area)
    print(f"Found {len(rooms)} rooms")

    print("Rectifying room contours to 90\u00b0 corners...")
    rooms, room_map = rectify_room_contours(rooms, sealed, room_map)
    print("Room contours rectified")

    mm_per_px = 6.22
    if os.path.isfile(args.dim_json):
        with open(args.dim_json, "r") as f:
            dim_data = json.load(f)
        mm_per_px = dim_data.get("scale_mm_per_px", 6.22)

    for r in rooms:
        area_m2 = r["area_px"] * (mm_per_px ** 2) / 1e6
        r["area_m2"] = round(area_m2, 2)
        label = r["label"] or f"Room {r['id']}"
        print(f"  {label}: {area_m2:.1f} m² ({r['area_px']}px), centroid={r['centroid']}")

    overlay = draw_rooms_overlay(img, rooms)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    cv2.imwrite(args.out, overlay)
    print(f"Saved: {args.out}")

    mask_path = os.path.join(out_root, "masks", "rooms_mask.png")
    os.makedirs(os.path.join(out_root, "masks"), exist_ok=True)
    rooms_mask = np.zeros((h, w), dtype=np.uint8)
    for room in rooms:
        val = min(room["id"] * 30, 255)
        fill_tmp = np.zeros((h, w), dtype=np.uint8)
        _fill_rectilinear(fill_tmp, room["contour"], 255)
        rooms_mask[fill_tmp > 0] = val
    cv2.imwrite(mask_path, rooms_mask)
    print(f"Saved: {mask_path}")

    if args.save_json:
        out_list = []
        for r in rooms:
            out_list.append({
                "id": r["id"],
                "label": r["label"],
                "bbox": r["bbox"],
                "centroid": r["centroid"],
                "area_px": r["area_px"],
                "area_m2": r.get("area_m2", 0),
            })
        with open(args.save_json, "w", encoding="utf-8") as f:
            json.dump(out_list, f, indent=2)
        print(f"Saved: {args.save_json}")


if __name__ == "__main__":
    main()
