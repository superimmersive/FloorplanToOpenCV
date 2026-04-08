"""
Detect kitchen/bathroom fixtures using template matching against
reference images in training_data/fixtures/<type>/.

Each fixture type folder should contain one or more reference PNGs.
Multi-scale matching is used to handle minor size variations.

Usage:
  python detect_fixtures.py input/GF_clean.jpg
  python detect_fixtures.py input/GF_clean.jpg --types stove toilet
"""

import argparse
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np

TRAINING_DIR = Path("detection/training_data/fixtures")
FIXTURE_TYPES = ["stove", "toilet", "basin", "sink", "fridge"]


def load_templates(fixture_type: str) -> list[tuple[str, np.ndarray]]:
    folder = TRAINING_DIR / fixture_type
    if not folder.is_dir():
        return []
    templates = []
    for p in sorted(folder.glob("*.png")):
        img = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if img is not None:
            templates.append((p.name, img))
    return templates


def match_template_multiscale(gray: np.ndarray, template: np.ndarray,
                               scales: np.ndarray,
                               threshold: float = 0.65) -> list[dict]:
    H, W = gray.shape
    th, tw = template.shape
    hits: list[dict] = []

    for scale in scales:
        sw, sh = int(tw * scale), int(th * scale)
        if sw > W or sh > H or sw < 10 or sh < 10:
            continue
        resized = cv2.resize(template, (sw, sh))
        result = cv2.matchTemplate(gray, resized, cv2.TM_CCOEFF_NORMED)
        locs = np.where(result >= threshold)
        for y, x in zip(*locs):
            hits.append({
                "bbox": [int(x), int(y), int(x + sw), int(y + sh)],
                "score": float(result[y, x]),
                "scale": float(scale),
            })
    return hits


def nms(hits: list[dict], iou_thr: float = 0.3) -> list[dict]:
    if not hits:
        return []
    hits = sorted(hits, key=lambda h: -h["score"])
    kept: list[dict] = []
    for h in hits:
        suppress = False
        for k in kept:
            ix1 = max(h["bbox"][0], k["bbox"][0])
            iy1 = max(h["bbox"][1], k["bbox"][1])
            ix2 = min(h["bbox"][2], k["bbox"][2])
            iy2 = min(h["bbox"][3], k["bbox"][3])
            if ix1 < ix2 and iy1 < iy2:
                inter = (ix2 - ix1) * (iy2 - iy1)
                area_h = (h["bbox"][2] - h["bbox"][0]) * (h["bbox"][3] - h["bbox"][1])
                area_k = (k["bbox"][2] - k["bbox"][0]) * (k["bbox"][3] - k["bbox"][1])
                iou = inter / max(1, area_h + area_k - inter)
                if iou > iou_thr:
                    suppress = True
                    break
        if not suppress:
            kept.append(h)
    return kept


def detect_fixture(gray: np.ndarray, fixture_type: str,
                   threshold: float = 0.65) -> list[dict]:
    templates = load_templates(fixture_type)
    if not templates:
        return []

    scales = np.arange(0.8, 1.25, 0.05)
    all_hits: list[dict] = []

    for name, tmpl in templates:
        hits = match_template_multiscale(gray, tmpl, scales, threshold)
        for h in hits:
            h["type"] = fixture_type
            h["template"] = name
        all_hits.extend(hits)

    return nms(all_hits)


COLORS = {
    "stove":  (0, 140, 255),
    "toilet": (0, 200, 0),
    "basin":  (255, 100, 0),
    "sink":   (200, 0, 200),
    "fridge": (0, 200, 200),
}


def draw_detections(img: np.ndarray, dets: list[dict]) -> np.ndarray:
    vis = img.copy()
    for d in dets:
        x1, y1, x2, y2 = d["bbox"]
        c = COLORS.get(d["type"], (255, 165, 0))
        cv2.rectangle(vis, (x1, y1), (x2, y2), c, 2)
        label = f"{d['type']} ({d['score']:.2f})"
        cv2.putText(vis, label, (x1, y1 - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, c, 1, cv2.LINE_AA)
    return vis


def main():
    ap = argparse.ArgumentParser(description="Detect fixtures via template matching")
    ap.add_argument("input", help="Floor plan image")
    ap.add_argument("--types", nargs="*", default=None,
                    help="Fixture types to detect (default: all with templates)")
    ap.add_argument("--threshold", type=float, default=0.65)
    ap.add_argument("--out", default="detection/output/overlays/fixtures_overlay.png")
    ap.add_argument("--save-json", default="detection/output/json/fixtures_detections.json")
    args = ap.parse_args()

    if not os.path.isfile(args.input):
        sys.exit(f"Not found: {args.input}")
    img = cv2.imread(args.input)
    if img is None:
        sys.exit(f"Cannot read: {args.input}")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    print(f"Image: {img.shape[1]}x{img.shape[0]}")

    types = args.types or FIXTURE_TYPES
    all_dets: list[dict] = []

    for ft in types:
        templates = load_templates(ft)
        if not templates:
            print(f"  {ft}: no templates found, skipping")
            continue
        dets = detect_fixture(gray, ft, args.threshold)
        print(f"  {ft}: {len(dets)} detected")
        for d in dets:
            x1, y1, x2, y2 = d["bbox"]
            print(f"    [{x1},{y1}]-[{x2},{y2}]  score={d['score']:.3f}")
        all_dets.extend(dets)

    print(f"\nTotal fixtures: {len(all_dets)}")

    overlay = draw_detections(img, all_dets)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    cv2.imwrite(args.out, overlay)
    print(f"Overlay: {args.out}")

    h, w = img.shape[:2]
    out_root = os.path.dirname(os.path.dirname(args.out)) or "output"
    mask_path = os.path.join(out_root, "masks", "fixtures_mask.png")
    os.makedirs(os.path.join(out_root, "masks"), exist_ok=True)
    fixtures_mask = np.zeros((h, w), dtype=np.uint8)
    for d in all_dets:
        x1, y1, x2, y2 = d["bbox"]
        cv2.rectangle(fixtures_mask, (x1, y1), (x2, y2), 255, -1)
    cv2.imwrite(mask_path, fixtures_mask)
    print(f"Mask: {mask_path}")

    if args.save_json:
        os.makedirs(os.path.dirname(args.save_json) or ".", exist_ok=True)
        json_data = [{"type": d["type"], "bbox": d["bbox"],
                      "score": round(d["score"], 3)}
                     for d in all_dets]
        with open(args.save_json, "w", encoding="utf-8") as f:
            json.dump(json_data, f, indent=2)
        print(f"JSON: {args.save_json}")


if __name__ == "__main__":
    main()
