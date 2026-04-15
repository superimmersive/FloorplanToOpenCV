import { useCallback } from "react";
import { TransformControls } from "@react-three/drei";

export function ImportedModelMoveGizmo({ object, onDragPosition }) {
  const onObjectChange = useCallback(() => {
    if (!object) return;
    onDragPosition([object.position.x, object.position.y, object.position.z]);
  }, [object, onDragPosition]);

  if (!object) return null;

  return <TransformControls mode="translate" object={object} space="world" onObjectChange={onObjectChange} />;
}
