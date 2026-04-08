"""
Run the detection pipeline for a job. All paths are under job_dir:
  job_dir/output/        — root output directory
  job_dir/output/masks/  — binary masks
  job_dir/output/overlays/ — overlay images
  job_dir/output/json/   — detection JSON files
  job_dir/output/debug/  — debug images
"""
import os
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

STEP_NAMES = [
    "walls",
    "windows",
    "doors",
    "fixtures",
    "kitchen_counter",
    "rooms",
    "dim_lines",
    "match_dim_text",
    "measure",
    "plan_dimensions",
    "export_vectors",
]

# Walls + dimensions only (ignore doors, windows, rooms, etc. for now)
WALLS_SCOPE_STEPS = ["walls", "dim_lines", "match_dim_text", "measure", "plan_dimensions", "export_vectors"]


def _run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=600,
    )


def _masks(out: str) -> str:
    return os.path.join(out, "masks")


def _overlays(out: str) -> str:
    return os.path.join(out, "overlays")


def _json(out: str) -> str:
    return os.path.join(out, "json")


def run_step(step: str, job_dir: Path, input_path: Path, output_dir: Path) -> tuple[bool, str]:
    """Run a single pipeline step. Returns (success, message)."""
    inp = str(input_path)
    out = str(output_dir)
    py = sys.executable

    if step == "walls":
        r = _run([py, "detection/make_walls_mask.py", inp, out, "--no-ocr"], PROJECT_ROOT)
        if r.returncode != 0:
            return False, r.stderr or r.stdout or "make_walls_mask.py failed"
        return True, "Walls mask and OCR done"

    if step == "windows":
        r = _run([
            py, "detection/detect_windows.py", inp,
            "--wall-mask", os.path.join(_masks(out), "walls_mask.png"),
            "--out", os.path.join(_overlays(out), "windows_overlay.png"),
            "--save-json", os.path.join(_json(out), "windows_detections.json"),
        ], PROJECT_ROOT)
        if r.returncode != 0:
            return False, r.stderr or r.stdout or "detect_windows.py failed"
        return True, "Windows detected"

    if step == "doors":
        r = _run([
            py, "detection/detect_doors_hybrid.py", inp,
            "--walls-mask", os.path.join(_masks(out), "walls_mask.png"),
            "--out", os.path.join(_overlays(out), "doors_overlay.png"),
            "--save-json", os.path.join(_json(out), "doors_detections.json"),
        ], PROJECT_ROOT)
        if r.returncode != 0:
            return False, r.stderr or r.stdout or "detect_doors_hybrid.py failed"
        return True, "Doors detected"

    if step == "fixtures":
        r = _run([
            py, "detection/detect_fixtures.py", inp,
            "--out", os.path.join(_overlays(out), "fixtures_overlay.png"),
            "--save-json", os.path.join(_json(out), "fixtures_detections.json"),
        ], PROJECT_ROOT)
        if r.returncode != 0:
            return False, r.stderr or r.stdout or "detect_fixtures.py failed"
        return True, "Fixtures detected"

    if step == "kitchen_counter":
        r = _run([
            py, "detection/detect_kitchen_counter.py", inp,
            "--walls", os.path.join(_masks(out), "walls_mask.png"),
            "--out", os.path.join(_overlays(out), "kitchen_counter_overlay.png"),
            "--mask-out", os.path.join(_masks(out), "kitchen_counter_mask.png"),
            "--json-out", os.path.join(_json(out), "kitchen_counter.json"),
        ], PROJECT_ROOT)
        if r.returncode != 0:
            return False, r.stderr or r.stdout or "detect_kitchen_counter.py failed"
        return True, "Kitchen counter detected"

    if step == "rooms":
        r = _run([
            py, "detection/detect_rooms.py", inp,
            "--walls-mask", os.path.join(_masks(out), "walls_mask.png"),
            "--doors-json", os.path.join(_json(out), "doors_detections.json"),
            "--windows-json", os.path.join(_json(out), "windows_detections.json"),
            "--text-json", os.path.join(_json(out), "detected_text.json"),
            "--dim-json", os.path.join(_json(out), "dim_lines.json"),
            "--out", os.path.join(_overlays(out), "rooms_overlay.png"),
            "--save-json", os.path.join(_json(out), "rooms.json"),
        ], PROJECT_ROOT)
        if r.returncode != 0:
            return False, r.stderr or r.stdout or "detect_rooms.py failed"
        return True, "Rooms detected"

    if step == "dim_lines":
        r = _run([
            py, "detection/detect_dim_lines.py", inp,
            "--walls-mask", os.path.join(_masks(out), "walls_mask.png"),
            "--out", os.path.join(_overlays(out), "dim_lines_overlay.png"),
            "--save-json", os.path.join(_json(out), "dim_lines.json"),
        ], PROJECT_ROOT)
        if r.returncode != 0:
            return False, r.stderr or r.stdout or "detect_dim_lines.py failed"
        return True, "Dimension lines detected"

    if step == "match_dim_text":
        r = _run([
            py, "detection/match_dim_text.py",
            "--input", inp,
            "--output-dir", out,
        ], PROJECT_ROOT)
        if r.returncode != 0:
            return False, r.stderr or r.stdout or "match_dim_text.py failed"
        return True, "Dimension text matched"

    if step == "measure":
        r = _run([
            py, "detection/measure_floorplan.py",
            "--input", inp,
            "--output-dir", out,
        ], PROJECT_ROOT)
        if r.returncode != 0:
            return False, r.stderr or r.stdout or "measure_floorplan.py failed"
        return True, "Measurements computed"

    if step == "plan_dimensions":
        r = _run([
            py, "detection/overlay_plan_dimensions.py",
            "--input", inp,
            "--output-dir", out,
        ], PROJECT_ROOT)
        if r.returncode != 0:
            return False, r.stderr or r.stdout or "overlay_plan_dimensions.py failed"
        return True, "Plan dimensions (width × length) from wall mask"

    if step == "export_vectors":
        r = _run([
            py, "detection/export_mask_vectors.py",
            "--output-dir", out,
        ], PROJECT_ROOT)
        if r.returncode != 0:
            return False, r.stderr or r.stdout or "export_mask_vectors.py failed"
        return True, "Vector export done"

    return False, f"Unknown step: {step}"


def run_full_pipeline(job_dir: Path, input_path: Path, output_dir: Path) -> list[dict]:
    """Run walls + dimensions only. Returns list of {step, success, message}."""
    results = []
    for step in WALLS_SCOPE_STEPS:
        ok, msg = run_step(step, job_dir, input_path, output_dir)
        results.append({"step": step, "success": ok, "message": msg})
        if not ok:
            break
    return results


def get_dependent_steps(mask_type: str) -> list[str]:
    """After editing a mask, which steps should be re-run? Walls scope: only measure + plan_dimensions."""
    if mask_type == "walls":
        return ["measure", "plan_dimensions"]
    return []
