"""
Train a floor-plan element classifier (windows, doors, fixtures, stairs, etc.)
using cropped images in training_data/<class_name>/.

Uses PyTorch + torchvision with transfer learning (ResNet18). Uses GPU if available.

Usage:
  python train_classifier.py [--data training_data] [--epochs 20] [--batch 16] [--out models]
"""

import argparse
import json
import os
import sys

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset, random_split
from torchvision import transforms
from torchvision.datasets import ImageFolder
from torchvision.models import resnet18, ResNet18_Weights


class FilteredClassDataset(Dataset):
    """Subset of an ImageFolder with remapped class indices (e.g. only windows, doors, fixtures)."""
    def __init__(self, base_dataset: ImageFolder, indices: list, new_targets: list):
        self.base = base_dataset
        self.indices = indices
        self.new_targets = new_targets

    def __len__(self):
        return len(self.indices)

    def __getitem__(self, i):
        img, _ = self.base[self.indices[i]]
        return img, self.new_targets[i]


def get_args():
    p = argparse.ArgumentParser(description="Train floor plan element classifier")
    p.add_argument("--data", default="training_data", help="Path to folder containing class subfolders")
    p.add_argument("--only", nargs="+", default=None, metavar="CLASS",
                  help="Use only these classes (e.g. --only windows doors fixtures). Default: all subfolders.")
    p.add_argument("--epochs", type=int, default=20, help="Number of training epochs")
    p.add_argument("--batch", type=int, default=16, help="Batch size")
    p.add_argument("--lr", type=float, default=1e-3, help="Learning rate")
    p.add_argument("--val-ratio", type=float, default=0.2, help="Fraction of data for validation (0..1)")
    p.add_argument("--out", default="models", help="Output directory for saved model and metadata")
    p.add_argument("--seed", type=int, default=42, help="Random seed for train/val split")
    p.add_argument("--workers", type=int, default=2, help="DataLoader num_workers (0 = main thread only)")
    return p.parse_args()


def main():
    args = get_args()
    data_root = os.path.abspath(args.data)
    if not os.path.isdir(data_root):
        print(f"Data folder not found: {data_root}")
        sys.exit(1)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    full_dataset = ImageFolder(data_root, transform=transform)
    if len(full_dataset) == 0:
        print("No images found. Add .jpg, .jpeg, .png (etc.) inside the class subfolders.")
        sys.exit(1)

    allowed_classes = args.only
    if allowed_classes is not None:
        allowed_classes = sorted(set(allowed_classes))
        # Filter samples to allowed classes only and remap labels to 0..k-1
        new_class_to_idx = {c: i for i, c in enumerate(allowed_classes)}
        indices = []
        new_targets = []
        for i in range(len(full_dataset)):
            orig_idx = full_dataset.imgs[i][1]
            c = full_dataset.classes[orig_idx]
            if c in new_class_to_idx:
                indices.append(i)
                new_targets.append(new_class_to_idx[c])
        if not indices:
            print("No images in the selected classes:", allowed_classes)
            sys.exit(1)
        dataset = FilteredClassDataset(full_dataset, indices, new_targets)
        class_to_idx = new_class_to_idx
        print("Classes (only):", allowed_classes, f"({len(indices)} samples)")
    else:
        dataset = full_dataset
        class_to_idx = full_dataset.class_to_idx
        print("Classes:", full_dataset.classes)

    idx_to_class = {v: k for k, v in class_to_idx.items()}
    num_classes = len(class_to_idx)
    n = len(dataset)
    n_val = max(1, int(n * args.val_ratio))
    n_train = n - n_val
    train_ds, val_ds = random_split(dataset, [n_train, n_val], generator=torch.Generator().manual_seed(args.seed))

    num_workers = args.workers if device.type == "cuda" else 0
    train_loader = DataLoader(train_ds, batch_size=args.batch, shuffle=True, num_workers=num_workers, pin_memory=(device.type == "cuda"))
    val_loader = DataLoader(val_ds, batch_size=args.batch, shuffle=False, num_workers=num_workers)

    model = resnet18(weights=ResNet18_Weights.IMAGENET1K_V1)
    model.fc = nn.Linear(model.fc.in_features, num_classes)
    model = model.to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)

    best_acc = 0.0
    for epoch in range(1, args.epochs + 1):
        model.train()
        train_loss = 0.0
        for x, y in train_loader:
            x, y = x.to(device), y.to(device)
            optimizer.zero_grad()
            logits = model(x)
            loss = criterion(logits, y)
            loss.backward()
            optimizer.step()
            train_loss += loss.item()
        train_loss /= len(train_loader)

        model.eval()
        correct = 0
        total = 0
        with torch.no_grad():
            for x, y in val_loader:
                x, y = x.to(device), y.to(device)
                pred = model(x).argmax(dim=1)
                correct += (pred == y).sum().item()
                total += y.size(0)
        val_acc = correct / total if total else 0.0
        print(f"Epoch {epoch}/{args.epochs}  train_loss={train_loss:.4f}  val_acc={val_acc:.4f}")

        if val_acc > best_acc:
            best_acc = val_acc
            os.makedirs(args.out, exist_ok=True)
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "num_classes": num_classes,
                "class_to_idx": class_to_idx,
                "idx_to_class": idx_to_class,
            }, os.path.join(args.out, "floorplan_classifier.pt"))
            with open(os.path.join(args.out, "class_to_idx.json"), "w", encoding="utf-8") as f:
                json.dump(class_to_idx, f, indent=2)
            print(f"  -> Saved best model (val_acc={best_acc:.4f})")

    print("Done. Model and class_to_idx saved under", args.out)


if __name__ == "__main__":
    main()
