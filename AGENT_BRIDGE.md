# Agent Bridge — Detection Pipeline Reference

> **Purpose**: This document is a centralized reference for any secondary agent (web app, UI, integrations) to understand the detection pipeline, data formats, and how to interact with the system. Updated as new features are added.
>
> **Last updated**: 2026-03-04
> **Primary agent focus**: Detection engine (OpenCV, EasyOCR, arc detection, room segmentation)
> **Secondary agent focus**: Web app / UI with interactive mask + vector editing

**For the web app agent (quick checklist)**

- **Fetch inputs**
  - Original plan image: `GET /image/{job_id}`
  - Masks (PNG): `GET /mask/{job_id}/{mask_type}` where `mask_type ∈ {walls, kitchen_counter, doors, windows, fixtures, rooms}`
  - Detection JSON: `GET /json/{job_id}/{data_type}` where `data_type ∈ {doors, windows, rooms, fixtures, dim_lines, measurements, text, kitchen_counter, vectors}`
  - Overlays (for reference only): `GET /overlay/{job_id}/{overlay_type}`
- **Vector data**
  - Use `GET /json/{job_id}/vectors` → `vectors.json` (see section **3b. Vector Export & Editing**).
  - Layers present: `walls`, `doors`, `windows`, `fixtures`, `rooms`, `kitchen_counter`, plus global `image_size`.
  - Render these as SVG or canvas paths with editable vertices.
- **Editing flow (recommended for now)**
  - Use `vectors.json` for the editable UI, but keep **PNG masks** as the source of truth for the existing pipeline.
  - When the user saves an edit for a given layer:
    - Rasterize the edited polygons back to a mask PNG (same size as the plan).
    - Upload via `PUT /mask/{job_id}/{mask_type}` (supports: `walls`, `kitchen_counter`, `doors`, `windows`, `fixtures`, `rooms`).
    - Optionally call `/run/{job_id}/{step}` or `/run/{job_id}` to re-run dependent steps (see `get_dependent_steps` in `webapp/pipeline.py`).
- **Future extension (optional)**
  - We can add a `PUT /json/{job_id}/vectors` endpoint later if you want the backend to store vectors as the primary source and regenerate masks from them.

---

## 1. Project Structure

```
FloorplanToOpenCV/
├── detection/                  # Detection pipeline + local data
│   ├── input/                  # Floor plan images (local test)
│   │   └── GF_clean.jpg
│   ├── output/                 # Local detection results (masks, overlays, json)
│   │   ├── masks/              # Binary masks (editable)
│   │   ├── overlays/           # Visualizations
│   │   ├── json/               # Detection data
│   │   └── debug/              # Debug images
│   ├── SVG/                    # Exported SVG files (from vectors_to_svg.py)
│   ├── training_data/          # Reference images for detection
│   │   ├── doors/, windows/, fixtures/, kitchenCounter/
│   ├── make_walls_mask.py      # Wall mask generation + OCR
│   ├── detect_doors.py, detect_windows.py, detect_fixtures.py
│   ├── detect_kitchen_counter.py, detect_rooms.py, detect_dim_lines.py
│   ├── match_dim_text.py, measure_floorplan.py
│   ├── export_mask_vectors.py, visualize_vectors.py, vectors_to_svg.py
│   ├── run_detector_on_plan.py, train_classifier.py, predict_classifier.py
│   ├── analyze_measurements.py
│   └── debug_*.py
│
├── webapp/                     # Web app (FastAPI + static frontend)
│   ├── main.py                 # API routes
│   ├── pipeline.py             # Pipeline orchestration (subprocess)
│   ├── static/                 # Frontend (index.html, app.js, style.css)
│   ├── data/                   # Job storage (created at runtime)
│   │   └── jobs/{job_id}/input/  # Uploaded floor plan
│   │                 /output/   # Detection outputs (masks/, overlays/, json/)
│   └── README.md
│
└── AGENT_BRIDGE.md             # THIS FILE
```

---

## 2. Pipeline Execution Order

Scripts should be run in this order (each depends on outputs from previous steps):

```
1. make_walls_mask.py       → walls_mask.png, walls_overlay.png, detected_text.json
2. detect_windows.py        → windows_detections.json, windows_overlay.png
3. detect_doors_hybrid.py   → doors_detections.json, doors_overlay.png (CV + optional AI)
4. detect_fixtures.py       → fixtures_detections.json, fixtures_overlay.png
5. detect_kitchen_counter.py → kitchen_counter.json, kitchen_counter_mask.png
6. detect_rooms.py          → rooms.json, rooms_overlay.png
7. detect_dim_lines.py      → dim_lines.json (includes scale_mm_per_px)
8. match_dim_text.py        → updates dim_lines.json with text labels
9. measure_floorplan.py     → measurements.json, measurements_overlay.png
10. overlay_plan_dimensions.py → plan_dimensions_overlay.png, plan_dimensions.json (W×L from wall mask)
11. export_mask_vectors.py  → vectors.json (polygons from all masks)
```

### Quick run (all steps, from project root):
```bash
python detection/make_walls_mask.py detection/input/GF_clean.jpg detection/output
python detection/detect_windows.py detection/input/GF_clean.jpg
python detection/detect_doors_hybrid.py detection/input/GF_clean.jpg --walls-mask detection/output/masks/walls_mask.png --save-json detection/output/json/doors_detections.json
python detection/detect_fixtures.py detection/input/GF_clean.jpg
python detection/detect_rooms.py detection/input/GF_clean.jpg
python detection/detect_dim_lines.py detection/input/GF_clean.jpg
python detection/match_dim_text.py --input detection/input/GF_clean.jpg --output-dir detection/output
python detection/measure_floorplan.py --input detection/input/GF_clean.jpg --output-dir detection/output
python detection/overlay_plan_dimensions.py --input detection/input/GF_clean.jpg --output-dir detection/output
python detection/export_mask_vectors.py --output-dir detection/output
python detection/vectors_to_svg.py --vectors detection/output/json/vectors.json --out-dir detection/SVG
```

---

## 3. Key Editable Masks

These masks can be edited by users in the web app to improve detection accuracy:

### `detection/output/masks/walls_mask.png` (or `webapp/data/jobs/{id}/output/masks/` for jobs)
- **Format**: Grayscale PNG, same dimensions as input image
- **Convention**: White (255) = wall, Black (0) = not wall
- **Impact**: Used by `detect_doors_hybrid.py`, `detect_rooms.py`, `detect_kitchen_counter.py`, `measure_floorplan.py`
- **User edits**: Draw white lines to add missing walls, erase to remove false walls
- **After edit**: Re-run `detect_rooms.py` and `detect_doors_hybrid.py` for updated results

### `detection/output/masks/kitchen_counter_mask.png`
- **Format**: Grayscale PNG
- **Convention**: White (255) = counter, Black (0) = not counter
- **Impact**: Used by `measure_floorplan.py`

### `detection/output/masks/doors_mask.png`
- **Format**: Grayscale PNG — filled quarter-circle arcs per door
- **Convention**: White (255) = door swing area, Black (0) = not door

### `detection/output/masks/windows_mask.png`
- **Format**: Grayscale PNG — filled rectangles at window positions
- **Convention**: White (255) = window, Black (0) = not window

### `detection/output/masks/fixtures_mask.png`
- **Format**: Grayscale PNG — filled rectangles at fixture positions
- **Convention**: White (255) = fixture, Black (0) = not fixture

### `detection/output/masks/rooms_mask.png`
- **Format**: Grayscale PNG — labeled regions (room ID × 30)
- **Convention**: 0 = background/wall, 30 = room #1, 60 = room #2, etc.

### Future editable masks (planned):
- Room assignment mask (user can paint room boundaries)
- Door/window location overrides

---

## 3b. Vector Export & Editing (contract for Web agent)

**Detection agent** produces vector data from masks so the web app can offer **editable vector UI** (move vertices, add/delete points) instead of painting on raster masks.

- **Script**: `export_mask_vectors.py` — reads all masks from `detection/output/masks/` (or job output), runs OpenCV `findContours` + `approxPolyDP`, writes `vectors.json`.
- **When to run**: After all mask-producing steps (walls, doors, windows, fixtures, kitchen_counter, rooms). Pipeline step name: `export_vectors`.
- **Web agent** responsibilities:
  - Consume `vectors.json` (and optionally generate SVG from it).
  - Draw shapes as editable paths (SVG or canvas); allow vertex edit (move, add, delete).
  - On save: either (a) send updated vector JSON to backend and have backend rasterize back to mask PNG, or (b) rasterize on client and upload mask PNG. Option (a) keeps vectors as single source of truth.

### `detection/output/json/vectors.json` (or job output) — Schema

All coordinates are pixel coordinates in image space. `image_size` is `[width, height]`.

```json
{
  "image_size": [2151, 1624],
  "walls": [
    [[x1,y1], [x2,y2], ... ]
  ],
  "doors": [
    [[x1,y1], [x2,y2], ... ]
  ],
  "windows": [
    [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
  ],
  "fixtures": [
    [[x1,y1], [x2,y2], ... ]
  ],
  "rooms": [
    { "id": 1, "label": "LOUNGE", "polygon": [[x1,y1], [x2,y2], ... ] },
    { "id": 2, "label": "DINING", "polygon": [...] }
  ],
  "kitchen_counter": [
    [[x1,y1], [x2,y2], ... ]
  ]
}
```

- **walls**, **doors**, **windows**, **fixtures**, **kitchen_counter**: array of polygons. Each polygon is an array of `[x, y]` points (closed: first point need not repeat at end).
- **rooms**: array of objects with `id`, `label` (from `rooms.json`), and `polygon` (same format).
- Empty layers are `[]`. Missing layers can be treated as `[]`.

---

## 4. JSON Data Schemas

### `dim_lines.json` — Scale & Dimensions
```json
{
  "scale_px_per_mm": 0.16067,
  "scale_mm_per_px": 6.22,
  "dimension_lines": [
    {
      "side": "bottom",
      "tier": 1,
      "orientation": "horizontal",
      "ticks": [387, 760, 932, 1314, 1868],
      "spans": [
        {
          "start": 387, "end": 760, "px": 373,
          "text": { "raw": "2324 [7'- 791", "mm": 2324, "imperial": "7'-7\"" }
        }
      ]
    }
  ]
}
```
**Key field**: `scale_mm_per_px` (6.22) — multiply any pixel measurement by this to get millimeters.

### `doors_detections.json` — Detected Doors
```json
[
  {
    "id": 1,
    "bbox": [x1, y1, x2, y2],
    "center": [cx, cy],           // Pivot/hinge point (center of arc)
    "radius": 148,                 // Arc radius in pixels
    "coverage": 0.393,             // Fraction of circumference with edges
    "quadrant_coverage": [0.99, 0.17, 0.23, 0.18],
    "swing_quadrant": 0,           // 0=right-down, 1=down-left, 2=left-up, 3=up-right
    "swing_direction": "right-down",
    "is_double_door": false
  }
]
```

### `windows_detections.json` — Detected Windows
```json
[
  {
    "id": 1,
    "bbox": [x1, y1, x2, y2],
    "orientation": "vertical",
    "method": "interior"
  }
]
```

### `rooms.json` — Detected Rooms
```json
[
  {
    "id": 1,
    "label": "LOUNGE",            // Room name from OCR or known positions
    "bbox": [x1, y1, x2, y2],
    "centroid": [614, 570],
    "area_px": 377505,
    "area_m2": 14.6
  }
]
```

### `fixtures_detections.json` — Detected Fixtures
```json
[
  {
    "id": 1,
    "label": "stovetop",
    "bbox": [x1, y1, x2, y2],
    "confidence": 0.85,
    "center": [cx, cy]
  }
]
```

### `detected_text.json` — OCR Text Detections
```json
[
  {
    "text": "LOUNGE",
    "conf": 0.964,
    "bbox": [[x1,y1], [x2,y1], [x2,y2], [x1,y2]],  // 4-point polygon
    "orientation": "horizontal"
  }
]
```

### `measurements.json` — Real-World Measurements
Contains wall segments, element sizes, and gap distances. Used for the final measurement overlay.

---

## 5. Detection Methods Summary

| Element | Script | Method | Key Parameters |
|---------|--------|--------|----------------|
| Walls | `make_walls_mask.py` | Grayscale thresholding (185-200) + morphology + corner rectification | Grayscale range, morph kernels |
| Windows | `detect_windows.py` | Interior line + gap glass detection, perimeter filtering | Glass color range, line length |
| Doors | `detect_doors_hybrid.py` | CV (Hough arcs) + AI classifier (ResNet18). Merge: keep CV, add AI detections CV missed. Use `--no-ai` for CV only. | `--model models`, `--ai-min-conf 0.6`, radius bands |
| Fixtures | `detect_fixtures.py` | Multi-scale template matching + NMS | Confidence threshold, scale range |
| Rooms | `detect_rooms.py` | Multi-source BFS from OCR-labeled seed points, walls as barriers | Seed positions, min_area |
| Kitchen counter | `detect_kitchen_counter.py` | Reference lines + wall mask + enclosed region finding | Dilation kernels |
| Dimensions | `detect_dim_lines.py` | Row/column projection + arrowhead detection | Arrow width/thickness thresholds |
| Text/OCR | `make_walls_mask.py` (EasyOCR) | EasyOCR with GPU, horizontal + rotated passes | GPU enabled, confidence threshold |

---

## 6. Web App Integration Notes

### API Design Suggestion
```
POST /api/upload              — Upload floor plan image
GET  /api/results/{id}        — Get all detection results
POST /api/run/{id}/{step}     — Run a specific detection step
PUT  /api/mask/{id}/{type}    — Upload edited mask (walls, rooms, etc.)
GET  /api/overlay/{id}/{type} — Get overlay image (doors, rooms, etc.)
GET  /api/json/{id}/{type}    — Get detection JSON data
```

### Interactive Mask Editor Requirements
- HTML5 Canvas overlay on top of the floor plan image
- Brush tool: paint white (add wall) or black (remove wall)
- Brush size selector (5-50px)
- Undo/redo
- Save mask → triggers re-run of dependent detections
- Toggle visibility of different overlays (walls, rooms, doors, etc.)

### Re-run Dependencies
When a mask is edited, only downstream detections need re-running:
```
walls_mask.png edited → re-run: detect_doors_hybrid, detect_rooms, detect_kitchen_counter, measure_floorplan
doors manually adjusted → re-run: detect_rooms (uses door positions for gap sealing), measure_floorplan
windows manually adjusted → re-run: detect_rooms, measure_floorplan
```

### Tech Stack Recommendation
- **Backend**: FastAPI (Python) — wraps existing scripts, serves API
- **Frontend**: React + HTML5 Canvas for mask editing
- **Image handling**: PIL/OpenCV on backend, Canvas API on frontend
- **State**: File-based (each upload gets a folder with input + output)

---

## 7. Current Detection Status

| Element | Status | Accuracy | Notes |
|---------|--------|----------|-------|
| Walls (grey) | Good | ~90% | Clean 90° corners, misses some thin partition lines |
| Windows | Good | ~95% | 4/5 detected, U-shape bay window parked for later |
| Doors | In Progress | ~70% | 7/~9 detected, WC + Study double doors missing |
| Fixtures | Good | ~95% | Stovetop, toilet, basin, sink, fridge all detected |
| Rooms | Good | 8/8 rooms | BFS watershed approach, areas within ~15% of labeled |
| Kitchen counter | Good | Detected | L-shape + island |
| Dimensions | Good | All spans | Scale factor: 6.22 mm/px |
| Measurements | Good | Walls + spacing | JSON with real-world sizes |

---

## 8. Changelog

### 2026-03-02
- Initial bridge document created
- Room detection added (BFS watershed from OCR seeds)
- Door detection refined (7 doors, wall mask validation, interior clean check)
- All 8 rooms identified: LOUNGE, KITCHEN, HALL, DINING, STUDY, WC, LAUNDRY, ST.

### 2026-03-04
- **Output layout**: Local runs use `detection/output/` (masks/, overlays/, json/, debug/). Web jobs use `webapp/data/jobs/{id}/output/` with same subfolders. Mask API supports types: walls, kitchen_counter, doors, windows, fixtures, rooms.

### 2026-03-05
- **Hybrid door detection**: Pipeline now uses `detect_doors_hybrid.py` (CV + optional AI). If `models/floorplan_classifier.pt` exists with a "doors" class, sliding-window classifier adds doors CV missed. Use `--no-ai` for CV-only. Train with `train_classifier.py --data detection/training_data --out models`.

### Planned Next Steps (Detection Agent)
- [ ] Door pivot point identification
- [ ] Door opening detection within wall mask
- [ ] Door opening width measurement
- [ ] Improve door detection for WC and Study double doors
- [ ] Room area accuracy refinement

### Web App (implemented)
- [x] FastAPI backend with pipeline orchestration (`webapp/main.py`, `webapp/pipeline.py`)
- [x] Floor plan upload + job storage under `data/jobs/{id}/`
- [x] Overlay viewer (layer dropdown: walls, doors, rooms, etc.)
- [x] Dedicated vector editor (edit polygon vertices from vectors.json, rasterize to mask, re-run doors/rooms/measure)
- [x] Re-run full pipeline or single step via API
- See `webapp/README.md` for run instructions and API summary.
