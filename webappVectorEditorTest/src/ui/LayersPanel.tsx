import { useEditorState } from "../state/EditorStateContext";
import type { Layer } from "../state/editorState";
import { LOCAL_DOCUMENT_API, floorplanImageUrl, safeProjectFileName } from "../api/localDocument";

function LayerRow({
  layer,
  isActive,
  canRemove,
  isItemLayer,
  isImageLayer,
  onSelect,
  onUpdate,
  onRemove,
  onImageFileSelect,
}: {
  layer: Layer;
  isActive: boolean;
  canRemove: boolean;
  isItemLayer: boolean;
  isImageLayer: boolean;
  onSelect: () => void;
  onUpdate: (id: string, patch: Partial<Layer>) => void;
  onRemove: () => void;
  onImageFileSelect?: (layerId: string, file: File) => void;
}) {
  const removeTitle = canRemove
    ? "Remove layer and all objects on it"
    : isItemLayer
      ? "Item layer cannot be removed"
      : isImageLayer
        ? "Floor plan layer cannot be removed"
        : "At least one layer required";

  if (isImageLayer) {
    return (
      <div
        className={`layer-row layer-row-image ${isActive ? "layer-row-active" : ""}`}
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        title="Floor plan"
        aria-pressed={isActive}
      >
        <div className="layer-row-image-inner">
          <span className="layer-row-image-label">Floor plan</span>
          <label className="layer-choose-file-wrap">
            <input
              type="file"
              accept="image/*"
              className="layer-file-input-hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && onImageFileSelect) onImageFileSelect(layer.id, file);
                e.target.value = "";
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="layer-choose-file-btn">Choose file</span>
          </label>
          <label className="layer-field layer-field-inline">
            <span className="layer-field-label">Size mm</span>
            <input
              type="number"
              className="layer-input"
              min={1}
              step={10}
              value={layer.imageWidthMm ?? ""}
              onChange={(e) => {
                const v = Number(e.target.value);
                onUpdate(layer.id, { imageWidthMm: v > 0 ? v : undefined });
              }}
              onClick={(e) => e.stopPropagation()}
              placeholder="—"
            />
          </label>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`layer-row ${isActive ? "layer-row-active" : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      title="Click to select layer"
      aria-pressed={isActive}
      aria-label={`Layer ${layer.name}, ${isActive ? "selected" : "click to select"}`}
    >
      <div className="layer-row-top">
        <input
          type="color"
          className="layer-color"
          value={layer.color ?? "#94a3b8"}
          onChange={(e) => onUpdate(layer.id, { color: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          title="Layer colour"
          aria-label="Layer colour"
        />
        <input
          type="text"
          className="layer-name"
          value={layer.name}
          onChange={(e) => onUpdate(layer.id, { name: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          title="Layer name"
          aria-label="Layer name"
        />
        <button
          type="button"
          className="layer-remove-btn"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          disabled={!canRemove}
          title={removeTitle}
          aria-label="Remove layer"
        >
          ×
        </button>
      </div>
      <div className="layer-row-bottom">
        <label className="layer-field">
          <span className="layer-field-label">Z</span>
          <input
            type="number"
            className="layer-input"
            value={layer.zPositionMm}
            onChange={(e) => onUpdate(layer.id, { zPositionMm: Number(e.target.value) || 0 })}
            title="Z position (mm)"
            aria-label="Z position mm"
          />
        </label>
        <label className="layer-field">
          <span className="layer-field-label">H</span>
          <input
            type="number"
            className="layer-input"
            value={layer.extrusionHeightMm}
            onChange={(e) => onUpdate(layer.id, { extrusionHeightMm: Number(e.target.value) || 0 })}
            title="Extrusion height (mm)"
            aria-label="Extrusion height mm"
          />
        </label>
      </div>
    </div>
  );
}

export function LayersPanel() {
  const { state, addLayer, updateLayer, setActiveLayer, removeLayer } = useEditorState();
  const { layers, activeLayerId, projectName } = state;
  const canRemoveAny = layers.length > 1;
  const handleImageFileSelect = async (layerId: string, file: File) => {
    const safe = safeProjectFileName(projectName);
    if (!safe) {
      window.alert("Set a valid project name in the toolbar (Name field) before choosing a floor plan image.");
      return;
    }
    const lastDot = file.name.lastIndexOf(".");
    const rawExt = (lastDot >= 0 ? file.name.slice(lastDot + 1) : "png").toLowerCase();
    const extNorm = rawExt === "jpeg" ? "jpg" : rawExt;
    const uploadUrl = `${LOCAL_DOCUMENT_API}/floorplan?project=${encodeURIComponent(safe)}&ext=${encodeURIComponent(extNorm)}`;
    try {
      const r = await fetch(uploadUrl, { method: "POST", body: file });
      if (!r.ok) {
        const t = await r.text();
        window.alert(`Could not save the image to saves/ (${t || r.status}). Use npm run dev or preview.`);
        return;
      }
    } catch {
      window.alert("Floor plan upload needs the local dev server (npm run dev or npm run preview).");
      return;
    }
    const url = floorplanImageUrl(projectName);
    if (!url) return;
    updateLayer(layerId, { imageUrl: url });
  };

  return (
    <div className="layers-panel">
      <div className="layers-panel-header">
        <span className="layers-panel-title">Layers</span>
        <button
          type="button"
          className="layers-add-btn"
          onClick={addLayer}
          title="Add layer"
          aria-label="Add layer"
        >
          + Add layer
        </button>
      </div>
      <div className="layers-list">
        {layers.map((layer) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            isActive={activeLayerId === layer.id}
            canRemove={canRemoveAny && !layer.isItemLayer && layer.type !== "image"}
            isItemLayer={layer.isItemLayer === true}
            isImageLayer={layer.type === "image"}
            onSelect={() => setActiveLayer(layer.id)}
            onUpdate={updateLayer}
            onRemove={() => removeLayer(layer.id)}
            onImageFileSelect={handleImageFileSelect}
          />
        ))}
      </div>
    </div>
  );
}
