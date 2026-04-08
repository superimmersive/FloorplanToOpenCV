"""
Run the trained classifier on sliding-window patches over a floor plan image,
then draw detections (windows, doors, fixtures) on the image.

Usage:
  python run_detector_on_plan.py input/GF_clean.jpg --out output/elements_overlay.png
  python run_detector_on_plan.py input/GF_clean.jpg --only-classes doors --out output/doors_overlay.png
"""

import argparse
import json
import os
import sys

import cv2
import torch
import torch.nn as nn
from PIL import Image
from torchvision import transforms
from torchvision.models import resnet18

# Match train_classifier.py / predict_classifier.py
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
PATCH_SIZE = 224


def load_model_and_labels(model_dir: str, device: torch.device):
    pt_path = os.path.join(model_dir, "floorplan_classifier.pt")
    json_path = os.path.join(model_dir, "class_to_idx.json")
    if not os.path.isfile(pt_path):
        raise FileNotFoundError(f"Model not found: {pt_path}. Train first with train_classifier.py")
    with open(json_path, encoding="utf-8") as f:
        class_to_idx = json.load(f)
    idx_to_class = {int(v): k for k, v in class_to_idx.items()}
    ckpt = torch.load(pt_path, map_location=device, weights_only=False)
    num_classes = ckpt["num_classes"]
    model = resnet18(weights=None)
    model.fc = nn.Linear(model.fc.in_features, num_classes)
    model.load_state_dict(ckpt["model_state_dict"], strict=True)
    model = model.to(device)
    model.eval()
    return model, idx_to_class


def get_transform():
    return transforms.Compose([
        transforms.Resize((PATCH_SIZE, PATCH_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
    ])


# BGR colors per class (windows, doors, fixtures, stairs)
CLASS_COLORS = {
    "windows": (255, 165, 0),   # blue-ish / orange
    "doors": (0, 200, 0),       # green
    "fixtures": (0, 165, 255),  # orange
    "stairs": (200, 0, 200),    # purple
}


def sliding_window_patches(h: int, w: int, patch_size: int, stride: int):
    """Yield (x1, y1, x2, y2) in image coords. If image smaller than patch, yield one centered crop."""
    if h < patch_size or w < patch_size:
        x1 = max(0, (w - patch_size) // 2)
        y1 = max(0, (h - patch_size) // 2)
        x2 = min(w, x1 + patch_size)
        y2 = min(h, y1 + patch_size)
        yield (x1, y1, x2, y2)
        return
    seen = set()
    for y in range(0, h - patch_size + 1, stride):
        for x in range(0, w - patch_size + 1, stride):
            key = (x, y)
            if key in seen:
                continue
            seen.add(key)
            yield (x, y, x + patch_size, y + patch_size)
    # Right and bottom edges
    if (w - patch_size) % stride != 0:
        x = w - patch_size
        for y in range(0, h - patch_size + 1, stride):
            if (x, y) not in seen:
                seen.add((x, y))
                yield (x, y, w, y + patch_size)
    if (h - patch_size) % stride != 0:
        y = h - patch_size
        for x in range(0, w - patch_size + 1, stride):
            if (x, y) not in seen:
                seen.add((x, y))
                yield (x, y, x + patch_size, h)
    if (w - patch_size) % stride != 0 and (h - patch_size) % stride != 0:
        xy = (w - patch_size, h - patch_size)
        if xy not in seen:
            yield (w - patch_size, h - patch_size, w, h)


def nms_same_class(boxes: list, iou_threshold: float = 0.3) -> list:
    """Keep one box per overlapping group (by class), preferring higher confidence."""
    if not boxes:
        return []
    # boxes: (x1, y1, x2, y2, class_name, conf)
    by_class = {}
    for b in boxes:
        c = b[4]
        if c not in by_class:
            by_class[c] = []
        by_class[c].append(b)
    out = []
    for c, lst in by_class.items():
        lst = sorted(lst, key=lambda x: -x[5])  # desc conf
        kept = []
        for b in lst:
            x1, y1, x2, y2, _, conf = b
            area_b = (x2 - x1) * (y2 - y1)
            overlap_any = False
            for k in kept:
                kx1, ky1, kx2, ky2 = k[0], k[1], k[2], k[3]
                ix1 = max(x1, kx1)
                iy1 = max(y1, ky1)
                ix2 = min(x2, kx2)
                iy2 = min(y2, ky2)
                if ix2 > ix1 and iy2 > iy1:
                    inter = (ix2 - ix1) * (iy2 - iy1)
                    iou = inter / area_b
                    if iou >= iou_threshold:
                        overlap_any = True
                        break
            if not overlap_any:
                kept.append(b)
        out.extend(kept)
    return out


def main():
    parser = argparse.ArgumentParser(description="Run element detector on floor plan via sliding window")
    parser.add_argument("input", help="Path to floor plan image")
    parser.add_argument("--out", default="detection/output/overlays/elements_overlay.png", help="Output image path")
    parser.add_argument("--model", default="models", help="Model directory")
    parser.add_argument("--stride", type=int, default=112, help="Sliding window stride (smaller = more patches, slower)")
    parser.add_argument("--min-conf", type=float, default=0.7, help="Minimum confidence to draw a detection")
    parser.add_argument("--nms", type=float, default=0.3, help="IoU threshold for NMS (0 = disable)")
    parser.add_argument("--save-json", default="", help="If set, save detections to this JSON path")
    parser.add_argument("--only-classes", nargs="+", default=None, metavar="CLASS",
                       help="Only show and save these classes (e.g. --only-classes doors)")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print("Input image not found:", args.input)
        sys.exit(1)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model, idx_to_class = load_model_and_labels(args.model, device)
    transform = get_transform()

    img = cv2.imread(args.input)
    if img is None:
        print("Could not read image:", args.input)
        sys.exit(1)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w = img.shape[:2]

    patches = list(sliding_window_patches(h, w, PATCH_SIZE, args.stride))
    print(f"Running classifier on {len(patches)} patches (stride={args.stride}, min_conf={args.min_conf})...")

    detections = []
    for i, (x1, y1, x2, y2) in enumerate(patches):
        crop = img_rgb[y1:y2, x1:x2]
        pil = Image.fromarray(crop)
        x = transform(pil).unsqueeze(0).to(device)
        with torch.no_grad():
            logits = model(x)[0]
        probs = torch.softmax(logits, dim=0).cpu()
        conf, idx = probs.max(dim=0)
        conf_val = conf.item()
        if conf_val >= args.min_conf:
            class_name = idx_to_class[idx.item()]
            if args.only_classes is not None and class_name not in args.only_classes:
                continue
            detections.append((x1, y1, x2, y2, class_name, conf_val))
        if (i + 1) % 100 == 0:
            print(f"  {i + 1}/{len(patches)} patches, {len(detections)} detections so far")

    if args.nms > 0:
        detections = nms_same_class(detections, iou_threshold=args.nms)
    if args.only_classes is not None:
        print(f"Filtered to classes: {args.only_classes}")
    print(f"Detections: {len(detections)}")

    overlay = img.copy()
    for (x1, y1, x2, y2, class_name, conf) in detections:
        color = CLASS_COLORS.get(class_name, (200, 200, 200))
        cv2.rectangle(overlay, (x1, y1), (x2, y2), color, 2)
        label = f"{class_name} {conf:.0%}"
        cv2.putText(overlay, label, (x1, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    cv2.imwrite(args.out, overlay)
    print("Saved:", args.out)

    if args.save_json:
        out_list = [
            {"bbox": [x1, y1, x2, y2], "class": c, "confidence": round(conf, 4)}
            for (x1, y1, x2, y2, c, conf) in detections
        ]
        with open(args.save_json, "w", encoding="utf-8") as f:
            json.dump(out_list, f, indent=2)
        print("Saved detections:", args.save_json)


if __name__ == "__main__":
    main()
