/**
 * Single-component export for embedding the vector editor in another React app.
 * Import this and the styles:
 *
 *   import { VectorEditor } from "./path/to/VectorEditor";
 *   import "./path/to/styles.css";
 *
 *   <VectorEditor />
 *
 * Ensure the container has a height (e.g. height: 100% or flex: 1).
 */
import { EditorStateProvider } from "./state/EditorStateContext";
import { DeleteShapeKeybinding } from "./DeleteShapeKeybinding";
import { Toolbar } from "./ui/Toolbar";
import { BottomToolbar } from "./ui/BottomToolbar";
import { LayersPanel } from "./ui/LayersPanel";
import { InspectorPanel } from "./ui/InspectorPanel";
import { EditorCanvas } from "./editor/EditorCanvas";

export function VectorEditor() {
  return (
    <EditorStateProvider>
      <DeleteShapeKeybinding />
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
