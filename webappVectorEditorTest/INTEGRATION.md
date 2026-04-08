# Integrating the Vector Editor into Another Web App

You can use the editor in another application in three main ways.

---

## 1. Embed via iframe (any host app)

**Best for:** Any stack (React, Vue, plain HTML, etc.). No shared state; editor is isolated.

1. **Build the editor** (from this folder):
   ```bash
   npm run build
   ```
   Output is in `dist/` (e.g. `dist/index.html`, `dist/assets/...`).

2. **Serve the built editor** from the same origin as your app, or from a separate URL (e.g. `https://your-domain.com/editor/`).

3. **Embed in your page**:
   ```html
   <iframe
     src="/editor/"
     title="Vector editor"
     style="width: 100%; height: 600px; border: none;"
   ></iframe>
   ```

4. **Optional – talk to the editor** (e.g. load/save data):
   - **Parent → iframe:** `iframe.contentWindow.postMessage({ type: 'LOAD', data: ... }, origin)`
   - **iframe → parent:** `window.parent.postMessage({ type: 'EXPORT', data: ... }, '*')`
   - Add a small message listener in the editor (e.g. in `App.tsx` or a dedicated bridge) that calls your export/load logic and posts back. The editor does not include this bridge by default.

---

## 2. Use as a React component in the same app (copy source)

**Best for:** Another React app where you want the editor in the same bundle and same DOM.

1. **Copy the editor source** into your app:
   - Copy the whole `src/` folder (or at least: `editor/`, `geometry/`, `render/`, `state/`, `ui/`, `App.tsx`, `main.tsx` → adapt so you don’t replace your existing `main.tsx`), plus `styles.css` (or merge its rules into your CSS).
   - Or add this repo as a **git submodule** or **npm dependency** (e.g. `"vector-editor": "file:../webappVectorEditorTest"`) and import from it.

2. **Add dependencies** to your app’s `package.json` (match versions if needed):
   ```json
   {
     "dependencies": {
       "react": "^18.2.0",
       "react-dom": "^18.2.0",
       "clipper2-wasm": "^0.2.1"
     }
   }
   ```

3. **Render the editor** where you need it. Easiest: use the single-component export (see section 3):
   ```tsx
   import { VectorEditor } from "./path/to/VectorEditor";
   import "./path/to/styles.css";

   function MyPage() {
     return (
       <div>
         <h1>My app</h1>
         <div style={{ height: "70vh", minHeight: 400 }}>
           <VectorEditor />
         </div>
       </div>
     );
   }
   ```
   Or render the same tree as in this app’s `App.tsx`:
   ```tsx
   import { EditorStateProvider } from "./path/to/state/EditorStateContext";
   import { Toolbar } from "./path/to/ui/Toolbar";
   import { BottomToolbar } from "./path/to/ui/BottomToolbar";
   import { LayersPanel } from "./path/to/ui/LayersPanel";
   import { InspectorPanel } from "./path/to/ui/InspectorPanel";
   import { EditorCanvas } from "./path/to/editor/EditorCanvas";
   import "./path/to/styles.css"; // or merge into your global CSS

   function VectorEditor() {
     return (
       <EditorStateProvider>
         <div className="app-root">
           <Toolbar />
           <div className="editor-row">
             <LayersPanel />
             <div className="editor-container">
               <EditorCanvas />
             </div>
             <InspectorPanel />
           </div>
           <BottomToolbar />
         </div>
       </EditorStateProvider>
     );
   }
   ```

4. **Layout:** The editor expects a constrained height (e.g. `height: 100%` or `flex: 1`). Give the wrapper a size:
   ```css
   .app-root {
     display: flex;
     flex-direction: column;
     height: 100vh; /* or height: 100%; min-height: 400px; */
   }
   ```

---

## 3. Single-component export

The repo exports a `VectorEditor` component that wraps the full editor (toolbar, canvas, layers, inspector). Use it so the host app only imports one component and the styles.

**In this repo:** `src/VectorEditor.tsx` exports `VectorEditor`.

**In the other app** (after copying or linking the editor source):

```tsx
import { VectorEditor } from "./path/to/VectorEditor";
import "./path/to/styles.css";

// Give the editor a height (it uses flex and 100% internally).
<VectorEditor />
```

Wrap it in a div with a set height (e.g. `height: 100%` and a parent with height, or `height: 70vh`) so the layout works.

---

## Summary

| Method              | Host app     | Effort   | Shared state / theme |
|---------------------|-------------|----------|-----------------------|
| **iframe**          | Any         | Low      | No (isolated)         |
| **React component** | React only  | Medium   | Yes (same DOM/CSS)    |

- **Same origin + React:** Prefer embedding the React component (copy or package) so you can share state, routing, and styles.
- **Different tech or strict isolation:** Use the iframe and, if needed, add a small `postMessage` bridge for load/save.
