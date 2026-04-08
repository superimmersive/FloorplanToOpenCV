import { useEditorState } from "../state/EditorStateContext";
import { getEdgeLengthMm } from "../geometry/measure";
import { exportVectorJson } from "../geometry/exportJson";

const SNAP_MM_OPTIONS = [1, 5, 10, 25, 50, 100];

const SELECTION_DISTANCE_OPTIONS = [5, 8, 10, 12, 15, 20];

export function BottomToolbar() {
  const {
    state,
    cleanShapes,
    setSnap,
    setSelectionDistancePx,
    setMeasureEnabled,
    setShowEdgeMeasurements,
    frameContent,
    centerView,
  } = useEditorState();
  const { measureEnabled, showEdgeMeasurements, selection, objects, snap, selectionDistancePx } = state;
  const edgeLength =
    measureEnabled && selection.edge
      ? getEdgeLengthMm(objects, selection.edge)
      : null;

  const handleExport = () => {
    const json = exportVectorJson(objects, state.layers);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vector_export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="toolbar toolbar-bottom">
      <label className="toolbar-snap">
        <input
          type="checkbox"
          checked={measureEnabled}
          onChange={(e) => setMeasureEnabled(e.target.checked)}
          title="Show edge length when an edge is selected"
        />
        <span>Measure</span>
      </label>
      <label className="toolbar-snap">
        <input
          type="checkbox"
          checked={showEdgeMeasurements}
          onChange={(e) => setShowEdgeMeasurements(e.target.checked)}
          title="Show measurements on every edge (10 mm offset outward)"
        />
        <span>On edges</span>
      </label>
      <span className="toolbar-sep" aria-hidden />
      <span className="toolbar-snap-group">
        <label className="toolbar-snap">
          <input
            type="checkbox"
            checked={snap.enabled}
            onChange={(e) => setSnap({ enabled: e.target.checked })}
            title="Enable snapping (use Grid and/or Vertices below)"
          />
          <span>Snap</span>
        </label>
        <label className="toolbar-snap">
          <input
            type="checkbox"
            checked={snap.gridSnap}
            disabled={!snap.enabled}
            onChange={(e) => setSnap({ gridSnap: e.target.checked })}
            title="Snap to the mm grid (spacing in the dropdown)"
          />
          <span>Grid</span>
        </label>
        <select
          className="toolbar-snap-value"
          value={snap.mm}
          disabled={!snap.enabled || !snap.gridSnap}
          onChange={(e) => setSnap({ mm: Number(e.target.value) })}
          title="Grid spacing (mm)"
          aria-label="Snap grid (mm)"
        >
          {SNAP_MM_OPTIONS.map((mm) => (
            <option key={mm} value={mm}>
              {mm} mm
            </option>
          ))}
        </select>
        <label className="toolbar-snap">
          <input
            type="checkbox"
            checked={snap.vertexSnap}
            disabled={!snap.enabled}
            onChange={(e) => setSnap({ vertexSnap: e.target.checked })}
            title="Align x/y with nearby vertices (uses Hit distance in screen pixels)"
          />
          <span>Vertices</span>
        </label>
      </span>
      <span className="toolbar-sep" aria-hidden />
      <label className="toolbar-snap">
        <span>Hit</span>
      </label>
      <select
        className="toolbar-snap-value"
        value={selectionDistancePx}
        onChange={(e) => setSelectionDistancePx(Number(e.target.value))}
        title="Edge hit-test distance (pixels)"
        aria-label="Selection distance (px)"
      >
        {SELECTION_DISTANCE_OPTIONS.map((px) => (
          <option key={px} value={px}>
            {px} px
          </option>
        ))}
      </select>
      <span className="toolbar-sep" aria-hidden />
      <button
        type="button"
        className="toolbar-action"
        onClick={cleanShapes}
        title="Remove collinear vertices (keep only corners)"
      >
        Clean
      </button>
      <button
        type="button"
        className="toolbar-action"
        onClick={handleExport}
        title="Export as JSON for Blender (units: mm)"
      >
        Export
      </button>
      <span className="toolbar-sep" aria-hidden />
      <button
        type="button"
        className="toolbar-action"
        onClick={frameContent}
        title="Frame selected object in view (or all content if nothing selected)"
      >
        Frame
      </button>
      <button
        type="button"
        className="toolbar-action"
        onClick={centerView}
        title="Center view on origin (0, 0)"
      >
        Center
      </button>
      {edgeLength !== null && (
        <>
          <span className="toolbar-sep" aria-hidden />
          <span className="toolbar-measurement" title="Selected edge length">
            Edge: {edgeLength.toFixed(1)} mm
          </span>
        </>
      )}
    </div>
  );
}
