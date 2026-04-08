# Training data for floor plan elements

Use this folder to store images and (optionally) annotations for training models to recognize **windows**, **doors**, and **fixtures** on floor plans.

## Folder layout

```
training_data/
├── windows/    # Crops or patches containing windows
├── doors/      # Crops or patches containing doors
└── fixtures/   # Crops or patches containing fixtures (sinks, toilets, etc.)
```

Put one image per file in the matching class folder. Supported formats: `.jpg`, `.jpeg`, `.png`, `.bmp`.

---

## How to use this for AI training

### Option 1: Image classification (folder-based)

- **What:** Each image is a small crop of the floor plan showing a single window, door, or fixture. The subfolder name is the label.
- **Use:** Train a classifier (e.g. CNN) to predict class from a crop. At inference, slide a window over the plan and classify each patch, or use a detector first and then classify the crops.
- **Workflow:** Crop regions from your floor plans (manually or with a simple tool), save into `windows/`, `doors/`, or `fixtures/`.

### Option 2: Object detection (bounding boxes)

- **What:** Full floor plan images plus annotation files that list bounding boxes and class (window, door, fixture) for each instance.
- **Use:** Train a detector (e.g. YOLO, Faster R-CNN) to output boxes and class labels on new plans.
- **Workflow:** Keep full-plan images in a separate folder (e.g. `training_data/full_plans/`) and store annotations in a standard format (e.g. YOLO `labels/` with one `.txt` per image, or COCO JSON). You can add `full_plans/` and `annotations/` (or `labels/`) later if you choose this route.

### Option 3: Segmentation (pixel masks)

- **What:** Full floor plan images plus per-pixel masks (e.g. one channel per class, or one PNG per class).
- **Use:** Train a segmentation model (e.g. U-Net) to output window/door/fixture masks.
- **Workflow:** Create mask images aligned to your plans; keep them in a parallel folder (e.g. `training_data/masks/`) or use a standard segmentation dataset layout.

---

**Recommendation:** Start with **Option 1** (crops in `windows/`, `doors/`, `fixtures/`) to build a classifier with minimal tooling. Once you have a detector or segmentation pipeline, you can add `full_plans/` and annotations for Option 2 or 3.

---

## Focus on doors only

- **Detection:** Run the sliding-window detector but only draw and save door detections:
  ```bash
  python run_detector_on_plan.py input/GF_clean.jpg --only-classes doors --out output/doors_overlay.png --save-json output/doors_detections.json
  ```
- **Training (binary door classifier):** Use two folders so the model learns "door" vs "not door":
  - `doors/` – cropped images containing a door
  - `background/` – cropped images with no door (walls, empty space, windows, etc.)
  Then train with:
  ```bash
  python train_classifier.py --data training_data --only doors background --epochs 25 --out models
  ```
  The detector will then only predict door vs background; use `--only-classes doors` to show only door boxes.
