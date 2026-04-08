# Integrating the Vector Editor into the Floorplan Web App

This guide explains how to append the vector editor webtool (from `webappVectorEditorTest/` or your agent's build) into the Floorplan web app.

---

## Option A: iframe (recommended — simplest)

**Best for:** Vanilla HTML/JS Floorplan app. No shared state; editor runs in isolation.

### Step 1: Build the vector editor

From the project root:

```powershell
cd webappVectorEditorTest
npm install
npm run build
```

Output is in `webappVectorEditorTest/dist/` (index.html, assets/)

### Step 2: Copy built files into the web app

**Windows (PowerShell):**
```powershell
# From project root
New-Item -ItemType Directory -Force -Path webapp\static\editor
Copy-Item -Path webappVectorEditorTest\dist\* -Destination webapp\static\editor\ -Recurse
```

**Or manually:** Copy everything from `webappVectorEditorTest/dist/` into `webapp/static/editor/`

Result: `webapp/static/editor/index.html`, `webapp/static/editor/assets/...`

### Step 3: Serve from the Floorplan app

The FastAPI app serves `webapp/static/` at `/`. So `/editor/` will serve `webapp/static/editor/index.html` automatically.

### Step 4: Add a link/button in the Floorplan app

Add a button in the View results section that opens the vector editor:

```html
<a href="/editor/?job_id=JOB_ID" target="_blank">Open Vector Editor</a>
```

Or in `app.js`, after a job is created:

```javascript
// Add a button that opens the editor
const editorLink = document.createElement('a');
editorLink.href = `/editor/?job_id=${jobId}`;
editorLink.textContent = 'Open Vector Editor';
editorLink.target = '_blank';
```

### Step 5: Vite base path (required for correct asset loading)

The vector editor must be built with `base: '/editor/'` so its JS/CSS assets load from `/editor/assets/...`. Update `webappVectorEditorTest/vite.config.ts`:

```ts
export default defineConfig({
  plugins: [react()],
  base: '/editor/',
  server: { port: 5173 }
});
```

Then rebuild: `npm run build`

---

## Option B: Separate dev server (during development)

While the vector editor agent is still building:

1. **Floorplan app:** `cd webapp && uvicorn main:app --reload --port 8000`
2. **Vector editor:** `cd webappVectorEditorTest && npm run dev` (runs on port 5173)  
3. **Link:** Add a button that opens `http://localhost:5173/` in a new tab.

No build step needed; the editor agent edits source and hot-reloads.

---

## Option C: React component (if Floorplan ever becomes React)

If you migrate the Floorplan app to React, you can copy the vector editor source and render it as a component. See `webappVectorEditorTest/INTEGRATION.md` for details.

---

## Passing job data to the editor

To load a specific job's vectors or floor plan in the editor:

1. **URL param:** `/editor/?job_id=abc123`
2. **In the editor:** `const params = new URLSearchParams(location.search); const jobId = params.get('job_id');`
3. **Fetch data:** `fetch(\`/api/image/${jobId}\`)` and `fetch(\`/api/json/${jobId}/vectors\`)` (same origin as Floorplan app).

The editor agent should add a small `postMessage` or `fetch` bridge to load/save job data from the Floorplan API.

---

## Quick checklist

- [ ] `webappVectorEditorTest/vite.config.ts` has `base: '/editor/'`
- [ ] `npm run build` in webappVectorEditorTest
- [ ] Copy `dist/` → `webapp/static/editor/`
- [ ] Add "Open Vector Editor" button in the Floorplan app that links to `/editor/?job_id=${jobId}`
