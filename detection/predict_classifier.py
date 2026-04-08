"""
Run the trained floor-plan classifier on a single image or a folder of crops.

Uses the same preprocessing as training (ResNet18). GPU used if available.

Usage:
  python predict_classifier.py image.jpg
  python predict_classifier.py path/to/crops/  [--out results.json]
  python predict_classifier.py image.jpg --model models --top-k 3
"""

import argparse
import json
import os
import sys

import torch
import torch.nn as nn
from PIL import Image
from torchvision import transforms
from torchvision.models import resnet18


# Must match train_classifier.py
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
INPUT_SIZE = (224, 224)


def load_model_and_labels(model_dir: str, device: torch.device):
    """Load checkpoint, rebuild model, return (model, idx_to_class)."""
    pt_path = os.path.join(model_dir, "floorplan_classifier.pt")
    json_path = os.path.join(model_dir, "class_to_idx.json")
    if not os.path.isfile(pt_path):
        raise FileNotFoundError(f"Model not found: {pt_path}. Train first with train_classifier.py")
    if not os.path.isfile(json_path):
        raise FileNotFoundError(f"Labels not found: {json_path}")

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
        transforms.Resize(INPUT_SIZE),
        transforms.ToTensor(),
        transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
    ])


def predict_image(model, transform, image_path: str, device: torch.device, idx_to_class: dict, top_k: int = 1):
    """Run prediction on one image; return list of (class_name, prob)."""
    img = Image.open(image_path).convert("RGB")
    x = transform(img).unsqueeze(0).to(device)
    with torch.no_grad():
        logits = model(x)[0]
    probs = torch.softmax(logits, dim=0).cpu()
    top_probs, top_indices = torch.topk(probs, min(top_k, len(probs)))
    return [(idx_to_class[i.item()], top_probs[j].item()) for j, i in enumerate(top_indices)]


def collect_images(path: str):
    """Return list of image paths (recursive if path is a dir)."""
    ext = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    if os.path.isfile(path):
        return [path] if os.path.splitext(path)[1].lower() in ext else []
    out = []
    for root, _, files in os.walk(path):
        for f in files:
            if os.path.splitext(f)[1].lower() in ext:
                out.append(os.path.join(root, f))
    return sorted(out)


def main():
    parser = argparse.ArgumentParser(description="Classify floor plan element crops")
    parser.add_argument("input", help="Path to a single image or a folder of images")
    parser.add_argument("--model", default="models", help="Directory containing floorplan_classifier.pt and class_to_idx.json")
    parser.add_argument("--top-k", type=int, default=1, help="Number of top classes to return per image")
    parser.add_argument("--out", default="", help="If set, write predictions to this JSON file (for folder input)")
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model, idx_to_class = load_model_and_labels(args.model, device)
    transform = get_transform()

    paths = collect_images(args.input)
    if not paths:
        print("No images found at", args.input)
        sys.exit(1)

    results = []
    for p in paths:
        try:
            preds = predict_image(model, transform, p, device, idx_to_class, top_k=args.top_k)
            results.append({"path": os.path.normpath(p), "predictions": [{"class": c, "prob": round(pr, 4)} for c, pr in preds]})
            line = f"{p} -> {preds[0][0]} ({preds[0][1]:.2%})"
            if args.top_k > 1:
                line += "  [top-k: " + ", ".join(f"{c}:{pr:.2%}" for c, pr in preds) + "]"
            print(line)
        except Exception as e:
            print(p, "Error:", e)
            results.append({"path": os.path.normpath(p), "error": str(e)})

    if args.out and results:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        print("Wrote", args.out)


if __name__ == "__main__":
    main()
