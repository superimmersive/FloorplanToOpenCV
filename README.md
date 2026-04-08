# FloorplanToOpenCV

Floor plan processing and editing: Python detection pipeline, Flask web app, and a React vector editor (`webappVectorEditorTest`) with Blender-oriented JSON export.

## Layout

| Path | Description |
|------|-------------|
| `detection/` | Image analysis and vector extraction scripts |
| `webapp/` | Python backend and static UI |
| `webappVectorEditorTest/` | Vite + React floor plan editor (TypeScript) |

## Quick start (vector editor)

```bash
cd webappVectorEditorTest
npm install
npm run dev
```

## Requirements

- **Node.js** (for the vector editor)
- **Python 3** + `webapp/requirements.txt` (for the Flask app and detection tools)
- **[Git LFS](https://git-lfs.com/)** — required to fetch large files tracked in this repo (e.g. `models/*.pt`).

### Git LFS

Large binaries tracked with Git LFS (see `.gitattributes`): **`models/*.pt`** (PyTorch) and **`*.obj`** (e.g. Blender mesh references under `webappVectorEditorTest/blender/`). After cloning:

```bash
git lfs install
git lfs pull   # or clone with: git lfs clone <repo-url>
```

If `models/*.pt` is missing or tiny (pointer file only), run `git lfs pull` from the repo root.

---

Private notes, local toolchains under `Tools/`, and Cursor session files are listed in `.gitignore`.
