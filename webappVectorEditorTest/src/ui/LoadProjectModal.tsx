import { useEffect, useState } from "react";
import { fetchLocalProjectList } from "../api/localDocument";

type Props = {
  open: boolean;
  onClose: () => void;
  onLoadProject: (name: string) => void;
  onBrowseFile: () => void;
};

export function LoadProjectModal({ open, onClose, onLoadProject, onBrowseFile }: Props) {
  const [projects, setProjects] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelected("");
    let cancelled = false;
    void fetchLocalProjectList().then((list) => {
      if (cancelled) return;
      if (list == null) {
        setProjects([]);
        setError("Local project list is not available (open the app via npm run dev or preview).");
        return;
      }
      setProjects(list);
      if (list.length > 0) setSelected(list[0]);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const hasList = projects != null && projects.length > 0;

  return (
    <div className="load-project-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="load-project-modal"
        role="dialog"
        aria-labelledby="load-project-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="load-project-title" className="load-project-modal-title">
          Load project
        </h2>
        <p className="load-project-modal-hint">
          Choose a saved project from <code className="load-project-code">saves/*.json</code>, or browse for a file.
        </p>
        {error && <p className="load-project-modal-error">{error}</p>}
        {hasList && (
          <label className="load-project-modal-field">
            <span className="load-project-modal-label">Project</span>
            <select
              className="load-project-modal-select"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              aria-label="Saved project"
            >
              {projects!.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="load-project-modal-actions">
          <button
            type="button"
            className="toolbar-action"
            disabled={!hasList || !selected}
            onClick={() => {
              if (selected) onLoadProject(selected);
            }}
          >
            Load
          </button>
          <button type="button" className="toolbar-action" onClick={onBrowseFile}>
            Browse file…
          </button>
          <button type="button" className="toolbar-action" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
