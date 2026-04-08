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

---

Private notes, local toolchains under `Tools/`, and Cursor session files are listed in `.gitignore`.
