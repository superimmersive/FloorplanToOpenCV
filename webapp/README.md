# Floorplan Detection — Web App

FastAPI backend + static frontend for uploading floor plans, running the detection pipeline, viewing overlays, and editing the wall mask.

## Run

From the **project root**. Easiest: use a venv so you don't need to install into system Python.

1. **Create venv** (once): Run Task → **Create venv (web app)**  
   Or: `python -m venv .venv`
2. **Install deps** (once): Run Task → **Install web app deps (in venv)**  
   Or: `.venv\Scripts\pip install -r webapp/requirements.txt` (Windows)
3. **Start app**: Run Task → **Start Web App (Floorplan)**  
   Or: `cd webapp` then `.venv\Scripts\python.exe -m uvicorn main:app --reload --host 0.0.0.0 --port 8000`

If you prefer system Python (and have no install errors):  
`python -m pip install fastapi "uvicorn[standard]"` then run the Start Web App task (change the task command back to `python -m uvicorn ...` if not using a venv).

Or from `webapp/`:

```bash
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000** in a browser.

### View in Cursor / VS Code

1. Start the server: **Terminal → Run Task… → Start Web App (Floorplan)** (or run the `cd webapp && uvicorn …` command in a terminal).
2. Open the app in a tab: **Ctrl+Shift+P** (or **Cmd+Shift+P** on Mac) → run **"Simple Browser: Show"** → enter `http://localhost:8000`.

The page will open in an embedded browser tab inside the editor.

## Flow

1. **Upload** a floor plan image (jpg/png). A job is created under `data/jobs/<job_id>/`.
2. **Run full pipeline** to run all detection steps (walls, windows, doors, fixtures, kitchen counter, rooms, dim lines, match text, measurements).
3. **View results** via the layer dropdown (base image, walls, doors, windows, rooms, etc.).
4. **Edit wall mask** (optional): click "Edit wall mask", paint white to add walls / black to remove, then **Save wall mask**. Use **Save and re-run doors & rooms** to update detections.

## API (for other agents)

- `POST /api/upload` — upload image, returns `{ "job_id": "..." }`
- `GET /api/results/{job_id}` — which output files exist
- `POST /api/run/{job_id}` — run full pipeline
- `POST /api/run/{job_id}/{step}` — run one step (`walls`, `doors`, `rooms`, etc.)
- `PUT /api/mask/{job_id}/walls` — upload edited walls mask (form body: `file`)
- `GET /api/overlay/{job_id}/{type}` — overlay image (`walls`, `doors`, `rooms`, …)
- `GET /api/image/{job_id}` — original floor plan image
- `GET /api/mask/{job_id}/walls` — current walls mask
- `GET /api/json/{job_id}/{type}` — JSON (`doors`, `windows`, `rooms`, `dim_lines`, `measurements`, …)

Pipeline steps: `walls`, `windows`, `doors`, `fixtures`, `kitchen_counter`, `rooms`, `dim_lines`, `match_dim_text`, `measure`.
