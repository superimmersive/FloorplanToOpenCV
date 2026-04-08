"""
Hybrid door detection: CV (Hough arcs) + AI classifier (ResNet18).

Runs CV door detection first, then optionally runs a trained classifier
on sliding-window patches. Merges results: keeps CV detections, adds AI
detections that CV missed (no overlap), optionally filters CV by AI
confidence.

Usage:
  python detect_doors_hybrid.py input/GF_clean.jpg --walls-mask output/masks/walls_mask.png
  python detect_doors_hybrid.py input/GF_clean.jpg --no-ai  # CV only
  python detect_doors_hybrid.py input/GF_clean.jpg --model detection/models
"""

import argparse
import json
import math
import os
import sys

import cv2
import numpy as np

# Import CV door detection from detect_doors
from detect_doors import (
    get_edge_map,
    detect_doors_hough,
    split_double_doors,
    merge_nearby,
    determine_swing_direction,
    compute_bbox,
    draw_detections,
)

# Optional: AI classifier
def _load_classifier(model_dir: str):
    """Load ResNet18 classifier. Returns (model, idx_to_class, transform) or None."""
    try:
        import torch
        import torch.nn as nn
        from PIL import Image
        from torchvision import transforms
        from torchvision.models import resnet18
    except ImportError:
        return None

    pt_path = os.path.join(model_dir, "floorplan_classifier.pt")
    json_path = os.path.join(model_dir, "class_to_idx.json")
    if not os.path.isfile(pt_path) or not os.path.isfile(json_path):
        return None

    with open(json_path, encoding="utf-8") as f:
        class_to_idx = json.load(f)
    idx_to_class = {int(v): k for k, v in class_to_idx.items()}
    if "doors" not in class_to_idx:
        return None

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ckpt = torch.load(pt_path, map_location=device, weights_only=False)
    num_classes = ckpt["num_classes"]
    model = resnet18(weights=None)
    model.fc = nn.Linear(model.fc.in_features, num_classes)
    model.load_state_dict(ckpt["model_state_dict"], strict=True)
    model = model.to(device)
    model.eval()

    IMAGENET_MEAN = [0.485, 0.456, 0.406]
    IMAGENET_STD = [0.229, 0.224, 0.225]
    PATCH_SIZE = 224
    transform = transforms.Compose([
        transforms.Resize((PATCH_SIZE, PATCH_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
    ])
    return model, idx_to_class, transform, device


def _run_ai_door_detections(img_rgb, model, idx_to_class, transform, device,
                             stride: int = 112, min_conf: float = 0.6,
                             patch_size: int = 224):
    """Run sliding-window classifier, return list of (x1, y1, x2, y2, conf)."""
    import torch
    from PIL import Image

    h, w = img_rgb.shape[:2]
    door_idx = None
    for k, v in idx_to_class.items():
        if v == "doors":
            door_idx = k
            break
    if door_idx is None:
        return []

    patches = []
    for y in range(0, h - patch_size + 1, stride):
        for x in range(0, w - patch_size + 1, stride):
            patches.append((x, y, x + patch_size, y + patch_size))
    if (w - patch_size) % stride != 0:
        x = w - patch_size
        for y in range(0, h - patch_size + 1, stride):
            patches.append((x, y, w, y + patch_size))
    if (h - patch_size) % stride != 0:
        y = h - patch_size
        for x in range(0, w - patch_size + 1, stride):
            patches.append((x, y, x + patch_size, h))
    if (w - patch_size) % stride != 0 and (h - patch_size) % stride != 0:
        patches.append((w - patch_size, h - patch_size, w, h))

    detections = []
    with torch.no_grad():
        for x1, y1, x2, y2 in patches:
            crop = img_rgb[y1:y2, x1:x2]
            pil = Image.fromarray(crop)
            x = transform(pil).unsqueeze(0).to(device)
            logits = model(x)[0]
            probs = torch.softmax(logits, dim=0).cpu()
            conf = probs[door_idx].item()
            if conf >= min_conf:
                detections.append((x1, y1, x2, y2, conf))
    return detections


def _ai_bbox_to_door(bbox: tuple, img_w: int, img_h: int) -> dict:
    """Convert AI bbox (x1,y1,x2,y2) to door format (center, radius, swing_quadrant)."""
    x1, y1, x2, y2 = bbox
    cx = (x1 + x2) // 2
    cy = (y1 + y2) // 2
    r = int(min(x2 - x1, y2 - y1) / 2)
    r = max(r, 20)
    return {
        "center": [cx, cy],
        "radius": r,
        "total_coverage": 0.0,
        "quadrant_coverage": [0.25, 0.25, 0.25, 0.25],
        "arc_quadrants": [0],
        "swing_quadrant": 0,
        "swing_direction": "right-down",
        "is_double_door": False,
        "source": "ai",
    }


def _bbox_iou(a: tuple, b: tuple) -> float:
    """IoU of two bboxes (x1,y1,x2,y2)."""
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _door_to_bbox(d: dict) -> tuple:
    """Get bbox from door (center, radius) - approximate."""
    cx, cy = d["center"]
    r = d["radius"]
    return (
        max(0, cx - r - 5),
        max(0, cy - r - 5),
        cx + r + 5,
        cy + r + 5,
    )


def _nms_ai_detections(detections: list, iou_threshold: float = 0.3) -> list:
    """NMS on AI detections (x1,y1,x2,y2,conf), keep higher conf."""
    if not detections:
        return []
    detections = sorted(detections, key=lambda d: -d[4])
    kept = []
    for d in detections:
        x1, y1, x2, y2, conf = d
        bbox = (x1, y1, x2, y2)
        overlap = False
        for k in kept:
            if _bbox_iou(bbox, (k[0], k[1], k[2], k[3])) >= iou_threshold:
                overlap = True
                break
        if not overlap:
            kept.append(d)
    return kept


def _merge_cv_and_ai(cv_doors: list, ai_detections: list, img_w: int, img_h: int,
                     overlap_threshold: float = 0.2) -> list:
    """
    Merge CV and AI detections.
    - Keep all CV doors.
    - Add AI detections that don't overlap any CV door (CV missed them).
    """
    merged = list(cv_doors)
    for d in merged:
        d["source"] = "cv"

    for ai in ai_detections:
        x1, y1, x2, y2, conf = ai
        ai_bbox = (x1, y1, x2, y2)
        overlaps_cv = False
        for cv_d in merged:
            cv_bbox = _door_to_bbox(cv_d)
            if _bbox_iou(ai_bbox, cv_bbox) >= overlap_threshold:
                overlaps_cv = True
                break
        if not overlaps_cv:
            door = _ai_bbox_to_door((x1, y1, x2, y2), img_w, img_h)
            door["ai_confidence"] = round(conf, 4)
            merged.append(door)
    return merged


def main():
    parser = argparse.ArgumentParser(description="Hybrid door detection (CV + AI)")
    parser.add_argument("input", help="Path to floor plan image")
    parser.add_argument("--walls-mask", default="", help="Path to walls_mask.png")
    parser.add_argument("--out", default="detection/output/overlays/doors_overlay.png", help="Output overlay")
    parser.add_argument("--save-json", default="", help="Save detections to JSON")
    parser.add_argument("--model", default="models", help="Model directory (AI disabled if not found)")
    parser.add_argument("--no-ai", action="store_true", help="Disable AI, use CV only")
    parser.add_argument("--ai-stride", type=int, default=112, help="Sliding window stride for AI")
    parser.add_argument("--ai-min-conf", type=float, default=0.85, help="Min confidence for AI doors (raise if too many false positives)")
    parser.add_argument("--merge-dist", type=int, default=45, help="Merge nearby CV arcs (pixels)")
    parser.add_argument("--param1", type=int, default=80, help="Hough param1")
    parser.add_argument("--param2", type=int, default=25, help="Hough param2")
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
        if wall_mask is not None and wall_mask.shape[:2] != (h, w):
            wall_mask = cv2.resize(wall_mask, (w, h))
        if wall_mask is not None:
            print(f"Using wall mask: {mask_path}")

    print(f"Image: {w}x{h}")

    # --- CV door detection ---
    bands = [(50, 80), (80, 115), (115, 170)]
    p2_per_band = {(50, 80): max(18, args.param2 - 5), (80, 115): args.param2, (115, 170): args.param2}

    all_cv = []
    for r_min, r_max in bands:
        p2 = p2_per_band.get((r_min, r_max), args.param2)
        dets = detect_doors_hough(
            gray, edges,
            wall_mask=wall_mask,
            min_radius=r_min, max_radius=r_max,
            hough_param1=args.param1, hough_param2=p2,
        )
        all_cv.extend(dets)

    all_cv = split_double_doors(all_cv)
    cv_doors = merge_nearby(all_cv, merge_dist=args.merge_dist)
    cv_doors = [d for d in cv_doors if d["total_coverage"] >= 0.13]

    for d in cv_doors:
        q, label = determine_swing_direction(d["quadrant_coverage"])
        d["swing_quadrant"] = q
        d["swing_direction"] = label

    print(f"CV doors: {len(cv_doors)}")

    # --- AI door detection (optional) ---
    ai_detections = []
    if not args.no_ai:
        model_root = args.model
        if not os.path.isabs(model_root):
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            model_root = os.path.join(project_root, model_root)
        classifier = _load_classifier(model_root)
        if classifier is not None:
            model, idx_to_class, transform, device = classifier
            print("Running AI classifier for doors...")
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            ai_detections = _run_ai_door_detections(
                img_rgb, model, idx_to_class, transform, device,
                stride=args.ai_stride, min_conf=args.ai_min_conf,
            )
            ai_detections = _nms_ai_detections(ai_detections, iou_threshold=0.3)
            print(f"AI door patches: {len(ai_detections)}")
        else:
            print("No classifier model found (or no 'doors' class). Using CV only.")

    # --- Merge ---
    detections = _merge_cv_and_ai(cv_doors, ai_detections, w, h)
    print(f"Merged doors: {len(detections)}")

    # --- Output ---
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
        q = d.get("swing_quadrant", 0)
        start_deg = q * 90
        cv2.ellipse(doors_mask, (cx, cy), (r, r), 0, start_deg, start_deg + 90, 255, -1)
    cv2.imwrite(mask_path, doors_mask)
    print("Saved:", mask_path)

    if args.save_json:
        out_list = []
        for i, d in enumerate(detections):
            cx, cy = d["center"]
            r = d["radius"]
            q_fracs = d.get("quadrant_coverage", [0.25] * 4)
            bbox = compute_bbox(cx, cy, r, q_fracs, w, h)
            out_list.append({
                "id": i + 1,
                "bbox": list(bbox),
                "center": [cx, cy],
                "radius": r,
                "coverage": d.get("total_coverage", 0),
                "quadrant_coverage": q_fracs,
                "swing_quadrant": d.get("swing_quadrant", 0),
                "swing_direction": d.get("swing_direction", "right-down"),
                "is_double_door": d.get("is_double_door", False),
                "source": d.get("source", "cv"),
                "ai_confidence": d.get("ai_confidence"),
            })
        with open(args.save_json, "w", encoding="utf-8") as f:
            json.dump(out_list, f, indent=2)
        print("Saved detections:", args.save_json)


if __name__ == "__main__":
    main()
