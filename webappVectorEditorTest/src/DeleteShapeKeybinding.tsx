import { useEffect, useRef } from "react";
import { useEditorState } from "./state/EditorStateContext";

/** Delete or Backspace removes the selected shape when focus is not in a text field. */
export function DeleteShapeKeybinding() {
  const { state, removeSelectedShape } = useEditorState();
  const objectIdRef = useRef(state.selection.objectId);
  objectIdRef.current = state.selection.objectId;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.isContentEditable || t.closest("input, textarea, select")) return;
      if (!objectIdRef.current) return;
      e.preventDefault();
      removeSelectedShape(objectIdRef.current);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [removeSelectedShape]);

  return null;
}
