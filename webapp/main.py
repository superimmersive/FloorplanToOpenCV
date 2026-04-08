"""
FastAPI backend for the floor plan detection web app.
- Upload floor plan → create job, run pipeline (or run on demand).
- Get overlays, JSON, upload edited masks, re-run dependent steps.
"""
import json
import os
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from pipeline import run_full_pipeline, run_step, get_dependent_steps, STEP_NAMES

# Job storage: webapp/data/jobs/{job_id}/input/floorplan.*  and  output/
DATA_DIR = Path(__file__).resolve().parent / "data"
JOBS_DIR = DATA_DIR / "jobs"

router = APIRouter(prefix="/api", tags=["api"])


def get_job_dir(job_id: str) -> Path:
    d = JOBS_DIR / job_id
    if not d.is_dir():
        raise HTTPException(status_code=404, detail="Job not found")
    return d


def get_job_input_path(job_id: str) -> Path:
    job_dir = get_job_dir(job_id)
    input_dir = job_dir / "input"
    if not input_dir.is_dir():
        raise HTTPException(status_code=404, detail="Job has no input")
    files = list(input_dir.iterdir())
    if not files:
        raise HTTPException(status_code=404, detail="No input image")
    return files[0]


def get_job_output_dir(job_id: str) -> Path:
    return get_job_dir(job_id) / "output"


@router.post("/upload")
async def api_upload(file: UploadFile = File(...)):
    """Upload a floor plan image. Creates a job and returns job_id."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Upload must be an image")
    ext = Path(file.filename or "image.png").suffix or ".png"
    if ext.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
        ext = ".png"
    job_id = str(uuid.uuid4())[:8]
    job_dir = JOBS_DIR / job_id
    input_dir = job_dir / "input"
    output_dir = job_dir / "output"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    input_path = input_dir / f"floorplan{ext}"
    with open(input_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"job_id": job_id, "input_path": str(input_path)}


@router.get("/results/{job_id}")
async def api_results(job_id: str):
    """Get summary of detection results (which files exist)."""
    get_job_dir(job_id)
    out = get_job_output_dir(job_id)
    files = {}
    for sub, name in [
        ("masks", "walls_mask.png"), ("overlays", "walls_overlay.png"),
        ("overlays", "windows_overlay.png"), ("overlays", "doors_overlay.png"),
        ("overlays", "fixtures_overlay.png"), ("overlays", "rooms_overlay.png"),
        ("overlays", "dim_lines_overlay.png"), ("overlays", "measurements_overlay.png"),
        ("overlays", "plan_dimensions_overlay.png"), ("overlays", "kitchen_counter_overlay.png"),
        ("masks", "doors_mask.png"), ("masks", "windows_mask.png"),
        ("masks", "fixtures_mask.png"), ("masks", "rooms_mask.png"),
        ("masks", "kitchen_counter_mask.png"),
        ("json", "doors_detections.json"), ("json", "windows_detections.json"),
        ("json", "rooms.json"), ("json", "dim_lines.json"),
        ("json", "measurements.json"), ("json", "plan_dimensions.json"),
        ("json", "detected_text.json"),
        ("json", "fixtures_detections.json"), ("json", "kitchen_counter.json"),
        ("json", "vectors.json"),
    ]:
        p = out / sub / name
        files[f"{sub}/{name}"] = p.is_file()
    return {"job_id": job_id, "files": files}


@router.post("/run/{job_id}/{step}")
async def api_run_step(job_id: str, step: str):
    """Run a single pipeline step (e.g. walls, doors, rooms)."""
    if step not in STEP_NAMES:
        raise HTTPException(status_code=400, detail=f"Unknown step. Use: {STEP_NAMES}")
    job_dir = get_job_dir(job_id)
    input_path = get_job_input_path(job_id)
    output_dir = get_job_output_dir(job_id)
    success, message = run_step(step, job_dir, input_path, output_dir)
    if not success:
        raise HTTPException(status_code=500, detail=message)
    return {"step": step, "success": True, "message": message}


@router.post("/run/{job_id}")
async def api_run_full(job_id: str):
    """Run the full pipeline for this job."""
    job_dir = get_job_dir(job_id)
    input_path = get_job_input_path(job_id)
    output_dir = get_job_output_dir(job_id)
    results = run_full_pipeline(job_dir, input_path, output_dir)
    return {"job_id": job_id, "results": results}


@router.put("/mask/{job_id}/{mask_type}")
async def api_upload_mask(job_id: str, mask_type: str, file: UploadFile = File(...)):
    """Upload an edited mask (e.g. walls). Re-run dependent steps optionally via /run."""
    valid_masks = ("walls", "kitchen_counter", "doors", "windows", "fixtures", "rooms")
    if mask_type not in valid_masks:
        raise HTTPException(status_code=400, detail=f"mask_type must be one of {valid_masks}")
    out = get_job_output_dir(job_id)
    mask_names = {
        "walls": "walls_mask.png", "kitchen_counter": "kitchen_counter_mask.png",
        "doors": "doors_mask.png", "windows": "windows_mask.png",
        "fixtures": "fixtures_mask.png", "rooms": "rooms_mask.png",
    }
    masks_dir = out / "masks"
    masks_dir.mkdir(parents=True, exist_ok=True)
    path = masks_dir / mask_names[mask_type]
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    dependents = get_dependent_steps(mask_type)
    return {"saved": name, "re_run_steps": dependents}


@router.get("/overlay/{job_id}/{overlay_type}")
async def api_overlay(job_id: str, overlay_type: str):
    """Get an overlay image (walls, doors, rooms, etc.)."""
    out = get_job_output_dir(job_id)
    names = {
        "walls": "walls_overlay.png",
        "doors": "doors_overlay.png",
        "windows": "windows_overlay.png",
        "rooms": "rooms_overlay.png",
        "fixtures": "fixtures_overlay.png",
        "dim_lines": "dim_lines_overlay.png",
        "measurements": "measurements_overlay.png",
        "plan_dimensions": "plan_dimensions_overlay.png",
        "kitchen_counter": "kitchen_counter_overlay.png",
    }
    name = names.get(overlay_type)
    if not name:
        raise HTTPException(status_code=400, detail=f"Unknown overlay. Use: {list(names.keys())}")
    path = out / "overlays" / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"Overlay not found: {overlay_type}")
    return FileResponse(path, media_type="image/png")


@router.get("/image/{job_id}")
async def api_input_image(job_id: str):
    """Get the original floor plan image."""
    path = get_job_input_path(job_id)
    return FileResponse(path)


@router.get("/mask/{job_id}/{mask_type}")
async def api_get_mask(job_id: str, mask_type: str):
    """Get a mask image (e.g. walls_mask.png)."""
    valid_masks = ("walls", "kitchen_counter", "doors", "windows", "fixtures", "rooms")
    if mask_type not in valid_masks:
        raise HTTPException(status_code=400, detail=f"mask_type must be one of {valid_masks}")
    out = get_job_output_dir(job_id)
    mask_names = {
        "walls": "walls_mask.png", "kitchen_counter": "kitchen_counter_mask.png",
        "doors": "doors_mask.png", "windows": "windows_mask.png",
        "fixtures": "fixtures_mask.png", "rooms": "rooms_mask.png",
    }
    path = out / "masks" / mask_names[mask_type]
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"Mask not found. Run walls step first.")
    return FileResponse(path, media_type="image/png")


@router.get("/json/{job_id}/{data_type}")
async def api_json(job_id: str, data_type: str):
    """Get detection JSON (doors, windows, rooms, dim_lines, measurements, etc.)."""
    out = get_job_output_dir(job_id)
    names = {
        "doors": "doors_detections.json",
        "windows": "windows_detections.json",
        "rooms": "rooms.json",
        "fixtures": "fixtures_detections.json",
        "dim_lines": "dim_lines.json",
        "measurements": "measurements.json",
        "plan_dimensions": "plan_dimensions.json",
        "text": "detected_text.json",
        "kitchen_counter": "kitchen_counter.json",
        "vectors": "vectors.json",
    }
    name = names.get(data_type) or data_type
    if not name.endswith(".json"):
        name += ".json"
    path = out / "json" / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"JSON not found: {data_type}")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return JSONResponse(data)


def create_app():
    from fastapi import FastAPI
    app = FastAPI(title="Floorplan Detection API", version="0.1.0")
    app.include_router(router)
    static_dir = Path(__file__).resolve().parent / "static"
    if static_dir.is_dir():
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
