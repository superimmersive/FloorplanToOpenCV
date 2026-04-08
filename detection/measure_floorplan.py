"""
Compute real-world measurements for all detected floor plan elements.

Loads the scale factor from dimension line analysis, then measures walls,
windows, doors, fixtures, and kitchen counter in millimeters. Computes
element spacing along each wall.

Usage:
  python measure_floorplan.py
  python measure_floorplan.py --input input/GF_clean.jpg --output-dir output
"""
import argparse
import json
import os

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def mm_to_imperial(mm):
    total_inches = mm / 25.4
    feet = int(total_inches // 12)
    inches = round(total_inches % 12)
    if inches == 12:
        feet += 1
        inches = 0
    return f"{feet}'-{inches}\""


def px_to_mm(px, scale):
    return round(px * scale, 1)


def bbox_center(bbox):
    return ((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)


def bbox_wh(bbox):
    return (bbox[2] - bbox[0], bbox[3] - bbox[1])


# ---------------------------------------------------------------------------
# Wall segment extraction
# ---------------------------------------------------------------------------

def extract_wall_segments(walls_mask):
    """Extract major horizontal and vertical wall segments from the binary mask.

    Returns list of dicts with: id, orientation, x1, y1, x2, y2, thickness_px, length_px
    """
    H, W = walls_mask.shape
    segments = []
    seg_id = 0

    # --- Horizontal walls: find rows with wide wall runs ---
    visited_h = np.zeros_like(walls_mask, dtype=bool)

    for y in range(H):
        row = walls_mask[y]
        xs = np.where(row > 0)[0]
        if len(xs) == 0:
            continue
        diffs = np.diff(xs)
        breaks = np.where(diffs > 10)[0]
        run_starts = [xs[0]] + [xs[b + 1] for b in breaks]
        run_ends = [xs[b] for b in breaks] + [xs[-1]]

        for rs, re in zip(run_starts, run_ends):
            run_len = re - rs
            if run_len < 30:
                continue
            if visited_h[y, (rs + re) // 2]:
                continue

            # Measure thickness: how many rows share this horizontal band
            y_top, y_bot = y, y
            mid_x = (rs + re) // 2
            while y_top > 0 and walls_mask[y_top - 1, mid_x] > 0:
                y_top -= 1
            while y_bot < H - 1 and walls_mask[y_bot + 1, mid_x] > 0:
                y_bot += 1
            thickness = y_bot - y_top + 1

            if thickness > run_len * 0.8:
                continue

            for yy in range(y_top, y_bot + 1):
                visited_h[yy, rs:re + 1] = True

            seg_id += 1
            segments.append({
                "id": f"H{seg_id}",
                "orientation": "horizontal",
                "x1": int(rs), "y1": int(y_top),
                "x2": int(re), "y2": int(y_bot),
                "thickness_px": int(thickness),
                "length_px": int(run_len),
            })

    # --- Vertical walls: find columns with tall wall runs ---
    visited_v = np.zeros_like(walls_mask, dtype=bool)

    for x in range(W):
        col = walls_mask[:, x]
        ys = np.where(col > 0)[0]
        if len(ys) == 0:
            continue
        diffs = np.diff(ys)
        breaks = np.where(diffs > 10)[0]
        run_starts = [ys[0]] + [ys[b + 1] for b in breaks]
        run_ends = [ys[b] for b in breaks] + [ys[-1]]

        for rs, re in zip(run_starts, run_ends):
            run_len = re - rs
            if run_len < 30:
                continue
            if visited_v[(rs + re) // 2, x]:
                continue

            x_left, x_right = x, x
            mid_y = (rs + re) // 2
            while x_left > 0 and walls_mask[mid_y, x_left - 1] > 0:
                x_left -= 1
            while x_right < W - 1 and walls_mask[mid_y, x_right + 1] > 0:
                x_right += 1
            thickness = x_right - x_left + 1

            if thickness > run_len * 0.8:
                continue

            for xx in range(x_left, x_right + 1):
                visited_v[rs:re + 1, xx] = True

            seg_id += 1
            segments.append({
                "id": f"V{seg_id}",
                "orientation": "vertical",
                "x1": int(x_left), "y1": int(rs),
                "x2": int(x_right), "y2": int(re),
                "thickness_px": int(thickness),
                "length_px": int(run_len),
            })

    # Deduplicate: merge segments that overlap significantly
    merged = []
    used = set()
    segments.sort(key=lambda s: -s["length_px"])

    for i, s in enumerate(segments):
        if i in used:
            continue
        for j, t in enumerate(segments):
            if j <= i or j in used:
                continue
            if s["orientation"] != t["orientation"]:
                continue
            if s["orientation"] == "horizontal":
                overlap_x = max(0, min(s["x2"], t["x2"]) - max(s["x1"], t["x1"]))
                overlap_y = max(0, min(s["y2"], t["y2"]) - max(s["y1"], t["y1"]))
                if overlap_x > 0.5 * min(s["length_px"], t["length_px"]) and overlap_y > 0:
                    used.add(j)
            else:
                overlap_x = max(0, min(s["x2"], t["x2"]) - max(s["x1"], t["x1"]))
                overlap_y = max(0, min(s["y2"], t["y2"]) - max(s["y1"], t["y1"]))
                if overlap_y > 0.5 * min(s["length_px"], t["length_px"]) and overlap_x > 0:
                    used.add(j)
        merged.append(s)

    # Filter: keep only segments with reasonable thickness (5-80px) and length (>50px)
    filtered = [s for s in merged if 5 <= s["thickness_px"] <= 80 and s["length_px"] > 50]
    filtered.sort(key=lambda s: (s["orientation"], s["y1"] if s["orientation"] == "horizontal" else s["x1"]))

    # Re-number
    for i, s in enumerate(filtered):
        s["id"] = f"{'H' if s['orientation'] == 'horizontal' else 'V'}{i + 1}"

    return filtered


# ---------------------------------------------------------------------------
# Wall-element assignment
# ---------------------------------------------------------------------------

def assign_to_wall(element_bbox, wall_segments, element_orient=None):
    """Find which wall segment an element (window/door) belongs to.

    Windows sit in wall gaps, so we match by center-line proximity
    and range overlap rather than pixel overlap.
    """
    cx, cy = bbox_center(element_bbox)
    ex1, ey1, ex2, ey2 = element_bbox
    best_wall = None
    best_dist = float("inf")

    for ws in wall_segments:
        if ws["orientation"] == "horizontal":
            wall_cy = (ws["y1"] + ws["y2"]) / 2
            # Element must overlap the wall's x range (with generous tolerance)
            x_overlap = min(ex2, ws["x2"] + 80) - max(ex1, ws["x1"] - 80)
            if x_overlap < 0:
                continue
            dist = abs(cy - wall_cy)
            if dist < best_dist and dist < ws["thickness_px"] + 40:
                best_dist = dist
                best_wall = ws
        else:
            wall_cx = (ws["x1"] + ws["x2"]) / 2
            y_overlap = min(ey2, ws["y2"] + 80) - max(ey1, ws["y1"] - 80)
            if y_overlap < 0:
                continue
            dist = abs(cx - wall_cx)
            if dist < best_dist and dist < ws["thickness_px"] + 40:
                best_dist = dist
                best_wall = ws

    return best_wall


def position_on_wall(element_bbox, wall_seg):
    """Return the element's position along the wall (px from wall start)."""
    cx, cy = bbox_center(element_bbox)
    if wall_seg["orientation"] == "horizontal":
        return cx - wall_seg["x1"]
    else:
        return cy - wall_seg["y1"]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Measure floor plan elements")
    parser.add_argument("--input", default="detection/input/GF_clean.jpg", help="Floor plan image (for overlay)")
    parser.add_argument("--output-dir", default="detection/output", help="Directory containing detection JSONs and masks")
    args = parser.parse_args()

    out = args.output_dir
    json_dir = os.path.join(out, "json")
    masks_dir = os.path.join(out, "masks")
    # --- Load data ---
    with open(os.path.join(json_dir, "dim_lines.json")) as f:
        dim_data = json.load(f)
    scale = dim_data["scale_mm_per_px"]
    print(f"Scale: {scale} mm/px")

    def load_json_or_empty(path, default=None):
        if default is None:
            default = []
        p = os.path.join(json_dir, path)
        if not os.path.isfile(p):
            return default
        with open(p) as f:
            return json.load(f)

    windows = load_json_or_empty("windows_detections.json")
    doors = load_json_or_empty("doors_detections.json")
    fixtures = load_json_or_empty("fixtures_detections.json")
    counter = load_json_or_empty("kitchen_counter.json", default={})

    walls_mask = cv2.imread(os.path.join(masks_dir, "walls_mask.png"), cv2.IMREAD_GRAYSCALE)

    # --- Extract wall segments ---
    print("\nExtracting wall segments...")
    wall_segs = extract_wall_segments(walls_mask)
    print(f"Found {len(wall_segs)} wall segments")

    walls_out = []
    for ws in wall_segs:
        length_mm = px_to_mm(ws["length_px"], scale)
        thickness_mm = px_to_mm(ws["thickness_px"], scale)
        entry = {
            "id": ws["id"],
            "orientation": ws["orientation"],
            "bbox_px": [ws["x1"], ws["y1"], ws["x2"], ws["y2"]],
            "length_mm": length_mm,
            "length_imperial": mm_to_imperial(length_mm),
            "thickness_mm": thickness_mm,
        }
        walls_out.append(entry)
        print(f"  {ws['id']:4s} {ws['orientation']:10s}  "
              f"len={length_mm:7.0f}mm ({mm_to_imperial(length_mm):8s})  "
              f"thick={thickness_mm:.0f}mm")

    # --- Measure windows ---
    print("\nWindows:")
    windows_out = []
    for w in windows:
        bbox = w["bbox"]
        wpx, hpx = bbox_wh(bbox)
        w_mm = px_to_mm(wpx, scale)
        h_mm = px_to_mm(hpx, scale)
        # Opening is the dimension along the wall
        if w["orientation"] == "vertical":
            opening_mm = h_mm
        else:
            opening_mm = w_mm
        wall = assign_to_wall(bbox, wall_segs, w["orientation"])
        wall_id = wall["id"] if wall else None

        entry = {
            "id": w["id"],
            "bbox_px": bbox,
            "orientation": w["orientation"],
            "opening_mm": opening_mm,
            "opening_imperial": mm_to_imperial(opening_mm),
            "bbox_width_mm": w_mm,
            "bbox_height_mm": h_mm,
            "wall_id": wall_id,
        }
        if wall:
            pos_px = position_on_wall(bbox, wall)
            entry["offset_from_wall_start_mm"] = px_to_mm(pos_px, scale)
        windows_out.append(entry)
        print(f"  Win#{w['id']}  opening={opening_mm:.0f}mm "
              f"({mm_to_imperial(opening_mm)})  wall={wall_id}")

    # --- Measure doors ---
    print("\nDoors:")
    doors_out = []
    for d in doors:
        bbox = d["bbox"]
        radius_px = d["radius"]
        opening_mm = px_to_mm(radius_px, scale)
        wall = assign_to_wall(bbox, wall_segs)
        wall_id = wall["id"] if wall else None

        entry = {
            "id": d["id"],
            "bbox_px": bbox,
            "opening_width_mm": opening_mm,
            "opening_width_imperial": mm_to_imperial(opening_mm),
            "wall_id": wall_id,
        }
        if wall:
            pos_px = position_on_wall(bbox, wall)
            entry["offset_from_wall_start_mm"] = px_to_mm(pos_px, scale)
        doors_out.append(entry)
        print(f"  Door#{d['id']}  opening={opening_mm:.0f}mm "
              f"({mm_to_imperial(opening_mm)})  wall={wall_id}")

    # --- Measure fixtures ---
    print("\nFixtures:")
    fixtures_out = []
    for fx in fixtures:
        bbox = fx["bbox"]
        wpx, hpx = bbox_wh(bbox)
        w_mm = px_to_mm(wpx, scale)
        h_mm = px_to_mm(hpx, scale)
        fixtures_out.append({
            "type": fx["type"],
            "bbox_px": bbox,
            "width_mm": w_mm,
            "height_mm": h_mm,
            "width_imperial": mm_to_imperial(w_mm),
            "height_imperial": mm_to_imperial(h_mm),
        })
        print(f"  {fx['type']:8s}  {w_mm:.0f}x{h_mm:.0f}mm  "
              f"({mm_to_imperial(w_mm)} x {mm_to_imperial(h_mm)})")

    # --- Measure kitchen counter ---
    print("\nKitchen counter:")
    counter_out = {}
    if counter.get("bboxes"):
        cb = counter["bboxes"][0]
        cw_mm = px_to_mm(cb[2] - cb[0], scale)
        ch_mm = px_to_mm(cb[3] - cb[1], scale)
        area_mm2 = px_to_mm(1, scale) ** 2 * counter["area_px"]
        counter_out = {
            "bbox_px": cb,
            "width_mm": cw_mm,
            "height_mm": ch_mm,
            "width_imperial": mm_to_imperial(cw_mm),
            "height_imperial": mm_to_imperial(ch_mm),
            "area_m2": round(area_mm2 / 1e6, 2),
        }
        print(f"  {cw_mm:.0f}x{ch_mm:.0f}mm  area={counter_out['area_m2']}m2")

    # --- Wall element spacing ---
    # Pre-compute best wall for each element (one wall per element)
    win_wall_map = {}
    for w in windows:
        best = assign_to_wall(w["bbox"], wall_segs, w["orientation"])
        if best:
            win_wall_map[w["id"]] = best["id"]

    door_wall_map = {}
    for d in doors:
        best = assign_to_wall(d["bbox"], wall_segs)
        if best:
            door_wall_map[d["id"]] = best["id"]

    print("\nWall element layout:")
    wall_elements = []

    for ws in wall_segs:
        items = []
        wall_len_mm = px_to_mm(ws["length_px"], scale)

        for w in windows:
            if win_wall_map.get(w["id"]) != ws["id"]:
                continue
            wpx, hpx = bbox_wh(w["bbox"])
            pos = position_on_wall(w["bbox"], ws)
            half = wpx / 2 if ws["orientation"] == "horizontal" else hpx / 2
            items.append({
                "type": "window",
                "id": w["id"],
                "start_px": pos - half,
                "end_px": pos + half,
                "width_mm": px_to_mm(half * 2, scale),
            })

        for d in doors:
            if door_wall_map.get(d["id"]) != ws["id"]:
                continue
            pos = position_on_wall(d["bbox"], ws)
            r = d["radius"]
            half_r = r / 2
            items.append({
                "type": "door",
                "id": d["id"],
                "start_px": pos - half_r,
                "end_px": pos + half_r,
                "width_mm": px_to_mm(r, scale),
            })

        if not items:
            continue

        items.sort(key=lambda it: it["start_px"])

        elements_in_order = [{"type": "wall_start", "position_mm": 0}]
        gaps = []
        prev_end_px = 0

        for item in items:
            gap_px = item["start_px"] - prev_end_px
            gap_mm = px_to_mm(max(0, gap_px), scale)
            pos_mm = px_to_mm(item["start_px"], scale)

            prev_label = elements_in_order[-1]
            prev_name = (f"{prev_label['type']}#{prev_label.get('id', '')}"
                         if prev_label["type"] != "wall_start" else "wall_start")
            curr_name = f"{item['type']}#{item['id']}"

            gaps.append({
                "from": prev_name,
                "to": curr_name,
                "gap_mm": gap_mm,
                "gap_imperial": mm_to_imperial(gap_mm),
            })

            elements_in_order.append({
                "type": item["type"],
                "id": item["id"],
                "position_mm": pos_mm,
                "width_mm": item["width_mm"],
            })
            prev_end_px = item["end_px"]

        trailing_gap_px = ws["length_px"] - prev_end_px
        trailing_mm = px_to_mm(max(0, trailing_gap_px), scale)
        elements_in_order.append({"type": "wall_end", "position_mm": wall_len_mm})
        last_item = items[-1]
        gaps.append({
            "from": f"{last_item['type']}#{last_item['id']}",
            "to": "wall_end",
            "gap_mm": trailing_mm,
            "gap_imperial": mm_to_imperial(trailing_mm),
        })

        we = {
            "wall_id": ws["id"],
            "wall_length_mm": wall_len_mm,
            "wall_length_imperial": mm_to_imperial(wall_len_mm),
            "elements": elements_in_order,
            "gaps": gaps,
        }
        wall_elements.append(we)

        print(f"\n  Wall {ws['id']} ({mm_to_imperial(wall_len_mm)}):")
        for g in gaps:
            print(f"    {g['from']:20s} --{g['gap_mm']:6.0f}mm "
                  f"({g['gap_imperial']:8s})--> {g['to']}")

    # --- Save JSON ---
    output = {
        "scale_mm_per_px": scale,
        "walls": walls_out,
        "windows": windows_out,
        "doors": doors_out,
        "fixtures": fixtures_out,
        "kitchen_counter": counter_out,
        "wall_element_layout": wall_elements,
    }
    os.makedirs(out, exist_ok=True)
    os.makedirs(os.path.join(out, "json"), exist_ok=True)
    with open(os.path.join(out, "json", "measurements.json"), "w") as f:
        json.dump(output, f, indent=2)
    print("\nSaved:", os.path.join(out, "json", "measurements.json"))

    # --- Overlay ---
    img = cv2.imread(args.input)
    vis = img.copy()
    FONT = cv2.FONT_HERSHEY_SIMPLEX

    def draw_label(vis, text, pos, color, scale_f=0.35):
        (tw, th), bl = cv2.getTextSize(text, FONT, scale_f, 1)
        x, y = int(pos[0]), int(pos[1])
        cv2.rectangle(vis, (x - 1, y - th - 2), (x + tw + 1, y + bl + 2),
                      (255, 255, 255), -1)
        cv2.putText(vis, text, (x, y), FONT, scale_f, color, 1, cv2.LINE_AA)

    # Draw windows with measurements
    for w in windows_out:
        b = w["bbox_px"]
        cv2.rectangle(vis, (b[0], b[1]), (b[2], b[3]), (0, 180, 0), 2)
        label = f"W{w['id']}: {w['opening_mm']:.0f}mm ({w['opening_imperial']})"
        draw_label(vis, label, (b[0], b[1] - 5), (0, 140, 0))

    # Draw doors with measurements
    for d in doors_out:
        b = d["bbox_px"]
        cv2.rectangle(vis, (b[0], b[1]), (b[2], b[3]), (0, 0, 200), 2)
        label = f"D{d['id']}: {d['opening_width_mm']:.0f}mm ({d['opening_width_imperial']})"
        draw_label(vis, label, (b[0], b[1] - 5), (0, 0, 180))

    # Draw fixtures with measurements
    for fx in fixtures_out:
        b = fx["bbox_px"]
        cv2.rectangle(vis, (b[0], b[1]), (b[2], b[3]), (180, 0, 180), 1)
        label = f"{fx['type']}: {fx['width_mm']:.0f}x{fx['height_mm']:.0f}mm"
        draw_label(vis, label, (b[0], b[3] + 12), (160, 0, 160))

    # Draw gap measurements with dimension lines
    GAP_COLOR = (0, 140, 220)
    for we in wall_elements:
        ws = next(s for s in wall_segs if s["id"] == we["wall_id"])
        for gap in we["gaps"]:
            if gap["gap_mm"] < 100:
                continue
            elements = we["elements"]
            from_el = next((e for e in elements
                           if f"{e['type']}#{e.get('id', '')}" == gap["from"]
                           or (e["type"] == gap["from"])), None)
            to_el = next((e for e in elements
                         if f"{e['type']}#{e.get('id', '')}" == gap["to"]
                         or (e["type"] == gap["to"])), None)
            if not from_el or not to_el:
                continue
            p1_mm = from_el["position_mm"] + from_el.get("width_mm", 0)
            p2_mm = to_el["position_mm"]
            p1_px = p1_mm / scale
            p2_px = p2_mm / scale
            mid_px = (p1_px + p2_px) / 2

            if ws["orientation"] == "horizontal":
                wall_cy = (ws["y1"] + ws["y2"]) // 2
                x1 = int(ws["x1"] + p1_px)
                x2 = int(ws["x1"] + p2_px)
                y = wall_cy - 20
                cv2.line(vis, (x1, y), (x2, y), GAP_COLOR, 1)
                cv2.line(vis, (x1, y - 4), (x1, y + 4), GAP_COLOR, 1)
                cv2.line(vis, (x2, y - 4), (x2, y + 4), GAP_COLOR, 1)
                lx = int(ws["x1"] + mid_px)
                draw_label(vis, f"{gap['gap_mm']:.0f}mm",
                          (lx - 20, y - 5), GAP_COLOR, 0.3)
            else:
                wall_cx = (ws["x1"] + ws["x2"]) // 2
                y1 = int(ws["y1"] + p1_px)
                y2 = int(ws["y1"] + p2_px)
                x = wall_cx + 20
                cv2.line(vis, (x, y1), (x, y2), GAP_COLOR, 1)
                cv2.line(vis, (x - 4, y1), (x + 4, y1), GAP_COLOR, 1)
                cv2.line(vis, (x - 4, y2), (x + 4, y2), GAP_COLOR, 1)
                ly = int(ws["y1"] + mid_px)
                draw_label(vis, f"{gap['gap_mm']:.0f}mm",
                          (x + 5, ly), GAP_COLOR, 0.3)

    # Scale legend
    draw_label(vis, f"Scale: {scale:.2f} mm/px", (20, vis.shape[0] - 20),
               (0, 0, 0), 0.45)

    os.makedirs(os.path.join(out, "overlays"), exist_ok=True)
    overlay_path = os.path.join(out, "overlays", "measurements_overlay.png")
    cv2.imwrite(overlay_path, vis)
    print("Saved:", overlay_path)


if __name__ == "__main__":
    main()
