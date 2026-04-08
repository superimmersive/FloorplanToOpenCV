"""
Detect dimension lines and their arrow/tick positions around the floor plan.

Finds primary (outermost) and secondary (inner-tier) dimension lines in all
four margins, then locates arrowhead positions along each to define spans.

Usage:
  python detect_dim_lines.py input/GF_clean.jpg --out output/dim_lines_overlay.png --save-json output/dim_lines.json
"""
import argparse
import json
import os

import cv2
import numpy as np

DARK_THRESH = 60
MIN_PRIMARY_PROJECTION = 400
MIN_SECONDARY_PROJECTION = 250
MIN_LINE_LENGTH = 200
MIN_SPAN_PX = 50


def _group_consecutive(values, max_gap=3):
    if not values:
        return []
    groups = [[values[0]]]
    for v in values[1:]:
        if v - groups[-1][-1] <= max_gap:
            groups[-1].append(v)
        else:
            groups.append([v])
    return groups


def _find_lines_in_margin(dark, lo, hi, axis, side):
    """Find candidate dim lines in a margin region.

    axis='row' scans rows (horizontal lines), axis='col' scans columns (vertical).
    """
    orient = "horizontal" if axis == "row" else "vertical"
    results = []

    if axis == "row":
        proj = np.sum(dark[lo:hi, :], axis=1)
        for g in _group_consecutive(
                [i + lo for i, c in enumerate(proj) if c > MIN_SECONDARY_PROJECTION]):
            y = int(np.mean(g))
            xs = np.where(dark[y] > 0)[0]
            if len(xs) == 0:
                continue
            length = int(xs.max() - xs.min())
            if length < MIN_LINE_LENGTH:
                continue
            results.append({"y": y, "x1": int(xs.min()), "x2": int(xs.max()),
                            "side": side, "orientation": orient, "length": length,
                            "projection": int(np.max(proj[np.array(g) - lo]))})
    else:
        proj = np.sum(dark[:, lo:hi], axis=0)
        for g in _group_consecutive(
                [i + lo for i, c in enumerate(proj) if c > MIN_SECONDARY_PROJECTION]):
            x = int(np.mean(g))
            ys = np.where(dark[:, x] > 0)[0]
            if len(ys) == 0:
                continue
            length = int(ys.max() - ys.min())
            if length < MIN_LINE_LENGTH:
                continue
            results.append({"x": x, "y1": int(ys.min()), "y2": int(ys.max()),
                            "side": side, "orientation": orient, "length": length,
                            "projection": int(np.max(proj[np.array(g) - lo]))})
    return results


def _find_arrows(dl, dark, min_width=8, min_thickness=10):
    """Find arrowhead positions along a dim line by scanning perpendicular thickness."""
    half_band = 10
    H, W = dark.shape

    if dl["orientation"] == "horizontal":
        y = dl["y"]
        y0, y1 = max(y - half_band, 0), min(y + half_band + 1, H)
        thickness = np.array([int(np.sum(dark[y0:y1, x]))
                              for x in range(dl["x1"], dl["x2"] + 1)])
        offset = dl["x1"]
    else:
        x = dl["x"]
        x0, x1 = max(x - half_band, 0), min(x + half_band + 1, W)
        thickness = np.array([int(np.sum(dark[y, x0:x1]))
                              for y in range(dl["y1"], dl["y2"] + 1)])
        offset = dl["y1"]

    peaks = [(i + offset, int(thickness[i])) for i in range(len(thickness))
             if thickness[i] > 4]
    if not peaks:
        return []

    groups = [[peaks[0]]]
    for p in peaks[1:]:
        if p[0] - groups[-1][-1][0] <= 10:
            groups[-1].append(p)
        else:
            groups.append([p])

    arrows = []
    for g in groups:
        positions = [p[0] for p in g]
        max_t = max(p[1] for p in g)
        width = len(g)
        if width >= min_width and max_t >= min_thickness:
            arrows.append(int(np.mean(positions)))
    return arrows


def _is_proper_dim_line(dl, dark):
    """Reject building features masquerading as dim lines (e.g. bay window outlines)."""
    if dl["orientation"] == "vertical":
        col = dark[:, dl["x"]]
        ys = np.where(col > 0)[0]
        if len(ys) == 0:
            return False
        runs = []
        in_run = False
        start = 0
        for i in range(1, len(ys)):
            if ys[i] - ys[i - 1] > 5:
                runs.append(ys[i - 1] - ys[start])
                start = i
        runs.append(ys[-1] - ys[start])
        longest_run = max(runs) if runs else 0
        return longest_run > dl["length"] * 0.3
    else:
        row = dark[dl["y"], :]
        xs = np.where(row > 0)[0]
        if len(xs) == 0:
            return False
        runs = []
        start = 0
        for i in range(1, len(xs)):
            if xs[i] - xs[i - 1] > 5:
                runs.append(xs[i - 1] - xs[start])
                start = i
        runs.append(xs[-1] - xs[start])
        longest_run = max(runs) if runs else 0
        return longest_run > dl["length"] * 0.3


def compute_spans(ticks):
    spans = []
    for i in range(len(ticks) - 1):
        length = ticks[i + 1] - ticks[i]
        if length >= MIN_SPAN_PX:
            spans.append({"start": ticks[i], "end": ticks[i + 1], "px": length})
    return spans


def main():
    parser = argparse.ArgumentParser(description="Detect dimension lines and ticks")
    parser.add_argument("input", nargs="?", default="detection/input/GF_clean.jpg", help="Floor plan image")
    parser.add_argument("--walls-mask", default="detection/output/masks/walls_mask.png", help="Wall mask image")
    parser.add_argument("--out", default="detection/output/overlays/dim_lines_overlay.png", help="Output overlay image")
    parser.add_argument("--save-json", default="detection/output/json/dim_lines.json", help="Output JSON path")
    args = parser.parse_args()

    img = cv2.imread(args.input)
    if img is None:
        raise FileNotFoundError(f"Cannot read image: {args.input}")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    walls = cv2.imread(args.walls_mask, cv2.IMREAD_GRAYSCALE)
    if walls is None:
        raise FileNotFoundError(f"Cannot read walls mask: {args.walls_mask}")
    H, W = gray.shape
    dark = (gray < DARK_THRESH).astype(np.uint8)

    wy, wx = np.where(walls > 0)
    wall_x1, wall_y1, wall_x2, wall_y2 = wx.min(), wy.min(), wx.max(), wy.max()
    print(f"Image: {W}x{H}, Wall bbox: [{wall_x1},{wall_y1}]-[{wall_x2},{wall_y2}]")

    all_lines = []
    all_lines += _find_lines_in_margin(dark, 50, wall_y1 - 5, "row", "top")
    all_lines += _find_lines_in_margin(dark, wall_y2 + 5, H - 50, "row", "bottom")
    all_lines += _find_lines_in_margin(dark, 50, wall_x1 - 5, "col", "left")
    all_lines += _find_lines_in_margin(dark, wall_x2 + 5, W - 50, "col", "right")

    all_lines = [dl for dl in all_lines if _is_proper_dim_line(dl, dark)]

    # Classify into primary (outermost) and secondary lines
    primary = {}
    for dl in all_lines:
        side = dl["side"]
        if side not in primary or dl["length"] > primary[side]["length"]:
            primary[side] = dl

    dim_lines = []
    for dl in all_lines:
        side = dl["side"]
        is_primary = (dl is primary.get(side))
        dl["tier"] = 1 if is_primary else 2

        if is_primary:
            arrows = _find_arrows(dl, dark, min_width=10, min_thickness=15)
        else:
            arrows = _find_arrows(dl, dark, min_width=8, min_thickness=10)

        if len(arrows) < 2:
            continue

        dl["ticks"] = arrows
        dl["spans"] = compute_spans(arrows)
        if dl["spans"]:
            dim_lines.append(dl)

    dim_lines.sort(key=lambda d: (d["side"], d["tier"]))

    for dl in dim_lines:
        orient = dl["orientation"]
        side = dl["side"]
        tier = dl["tier"]
        if orient == "horizontal":
            pos = f"y={dl['y']}, x=[{dl['x1']}-{dl['x2']}]"
        else:
            pos = f"x={dl['x']}, y=[{dl['y1']}-{dl['y2']}]"
        label = "PRIMARY" if tier == 1 else "secondary"
        print(f"\n{side:6s} [{label:9s}] {orient:10s} {pos}")
        print(f"  Ticks: {dl['ticks']}")
        for s in dl["spans"]:
            print(f"  Span: [{s['start']}-{s['end']}] = {s['px']}px")

    # Visualize
    vis = img.copy()
    COLORS_PRIMARY = {"top": (0, 0, 255), "bottom": (0, 140, 255),
                      "left": (255, 0, 0), "right": (200, 0, 200)}
    COLORS_SECONDARY = {"top": (100, 100, 255), "bottom": (100, 200, 255),
                        "left": (255, 100, 100), "right": (255, 100, 255)}

    for dl in dim_lines:
        colors = COLORS_PRIMARY if dl["tier"] == 1 else COLORS_SECONDARY
        c = colors.get(dl["side"], (0, 255, 0))
        lw = 2 if dl["tier"] == 1 else 1

        if dl["orientation"] == "horizontal":
            y = dl["y"]
            cv2.line(vis, (dl["x1"], y), (dl["x2"], y), c, lw)
            for tx in dl["ticks"]:
                cv2.circle(vis, (tx, y), 5, (0, 255, 0), -1)
            for s in dl["spans"]:
                mx = (s["start"] + s["end"]) // 2
                cv2.putText(vis, f"{s['px']}px", (mx - 25, y - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, c, 1, cv2.LINE_AA)
        else:
            x = dl["x"]
            cv2.line(vis, (x, dl["y1"]), (x, dl["y2"]), c, lw)
            for ty in dl["ticks"]:
                cv2.circle(vis, (x, ty), 5, (0, 255, 0), -1)
            for s in dl["spans"]:
                my = (s["start"] + s["end"]) // 2
                cv2.putText(vis, f"{s['px']}px", (x + 8, my),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, c, 1, cv2.LINE_AA)

    out_dir = os.path.dirname(args.out) or "."
    os.makedirs(out_dir, exist_ok=True)
    cv2.imwrite(args.out, vis)
    print(f"\nSaved: {args.out}")

    out_data = []
    for dl in dim_lines:
        entry = {"side": dl["side"], "tier": dl["tier"],
                 "orientation": dl["orientation"],
                 "ticks": dl["ticks"], "spans": dl["spans"]}
        if dl["orientation"] == "horizontal":
            entry["y"] = dl["y"]
            entry["x_range"] = [dl["x1"], dl["x2"]]
        else:
            entry["x"] = dl["x"]
            entry["y_range"] = [dl["y1"], dl["y2"]]
        out_data.append(entry)
    with open(args.save_json, "w") as f:
        json.dump(out_data, f, indent=2)
    print("Saved:", args.save_json)


if __name__ == "__main__":
    main()
