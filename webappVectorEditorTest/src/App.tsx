import { EditorStateProvider } from "./state/EditorStateContext";
import { DeleteShapeKeybinding } from "./DeleteShapeKeybinding";
import { Toolbar } from "./ui/Toolbar";
import { BottomToolbar } from "./ui/BottomToolbar";
import { LayersPanel } from "./ui/LayersPanel";
import { InspectorPanel } from "./ui/InspectorPanel";
import { EditorCanvas } from "./editor/EditorCanvas";

export const App = () => {
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
};
