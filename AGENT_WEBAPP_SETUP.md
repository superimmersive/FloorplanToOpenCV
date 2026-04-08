# Agent Guide: Run the Floorplan Web App Locally

> **Purpose**: Step-by-step directions for any agent to get the FloorplanToOpenCV web app running locally. Use this when asked to "get the webpage up and running" or "run the web app locally".

---

## Quick Checklist

1. Create Python venv (once)
2. Install dependencies (once)
3. Start the server
4. Open http://localhost:8000 in a browser

---

## Step-by-Step (Windows)

All commands assume you are in the **project root** (`FloorplanToOpenCV/`).

### 1. Create virtual environment (once)

```powershell
python -m venv .venv
```

If you use VS Code / Cursor: **Terminal → Run Task… → Create venv (web app)**.

### 2. Install dependencies (once)

**PowerShell** (Windows):

```powershell
& "${PWD}\.venv\Scripts\pip.exe" install -r webapp/requirements.txt
```

Or from project root:

```powershell
.\.venv\Scripts\pip.exe install -r webapp/requirements.txt
```

If you use VS Code / Cursor: **Terminal → Run Task… → Install web app deps (in venv)**.

**Note**: On Windows PowerShell, avoid `&&`; use separate commands or `;` instead. The tasks in `.vscode/tasks.json` use `cwd` and `& "path"` for venv executables.

### 3. Start the web app

**PowerShell** (from project root):

```powershell
cd webapp
& "..\.venv\Scripts\python.exe" -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Or as a single command (PowerShell):

```powershell
Set-Location webapp; & "..\.venv\Scripts\python.exe" -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

If you use VS Code / Cursor: **Terminal → Run Task… → Start Web App (Floorplan)**. This runs in the background.

### 4. Open in browser

- **URL**: http://localhost:8000
- In Cursor/VS Code: **Ctrl+Shift+P** → "Simple Browser: Show" → enter `http://localhost:8000`

---

## Step-by-Step (Linux / macOS)

```bash
# 1. Create venv (once)
python3 -m venv .venv

# 2. Install deps (once)
.venv/bin/pip install -r webapp/requirements.txt

# 3. Start app
cd webapp && .venv/bin/python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Then open http://localhost:8000.

---

## Common Issues

| Issue | Fix |
|------|-----|
| `uvicorn` not found | Use `python -m uvicorn` with the venv Python, or ensure uvicorn is installed in the venv |
| `pip` install fails (Scripts locked) | Use the project `.venv`, not system Python |
| PowerShell: `&&` not supported | Use `;` or run commands separately; tasks use `cwd` instead |
| PowerShell: `.venv` treated as module | Use `& "path\to\python.exe"` with quoted path |
| Port 8000 in use | Change port: `--port 8001` (and open http://localhost:8001) |

**Port conflicts**: Port 8000 can conflict if (a) another instance of this Floorplan app is already running, or (b) another agent/project is using 8000. Use `--port 8001` (or another free port) to avoid conflicts.

---

## Project Layout (relevant for web app)

```
FloorplanToOpenCV/
├── .venv/                    # Virtual environment (create once)
├── webapp/
│   ├── main.py               # FastAPI app
│   ├── pipeline.py           # Pipeline orchestration
│   ├── requirements.txt      # Python deps
│   ├── static/               # Frontend (index.html, app.js, style.css)
│   └── data/                 # Created at runtime: jobs/{job_id}/...
├── detection/                # Scripts called by pipeline (must exist)
└── .vscode/tasks.json        # VS Code tasks for venv + run
```

---

## Verify It Works

1. Server starts without errors (look for `Uvicorn running on http://0.0.0.0:8000`)
2. http://localhost:8000 loads the upload page
3. Upload a floor plan image → job created → "Run full pipeline" → overlays appear in layer dropdown

---

## For Other Agents

- **AGENT_BRIDGE.md** — Detection pipeline, data formats, API contract
- **webapp/README.md** — Shorter run instructions and API summary
