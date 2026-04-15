import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

const _tempVec3A = new THREE.Vector3();
const _tempVec3B = new THREE.Vector3();

function getRootFromTarget(target, rootRef) {
  const root = rootRef?.current;
  if (!root) return null;
  if (target === root) return root;
  if (typeof root.getObjectById === "function" && root.getObjectById(target.id)) return root;
  return null;
}

export function ModelPlacementController({ enabled, importedModelRef, onMove, onPlace }) {
  const { camera, scene, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

  useEffect(() => {
    if (!enabled) return undefined;

    const updatePlacementFromPointer = (event) => {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const intersections = raycaster
        .intersectObjects(scene.children, true)
        .filter((hit) => !getRootFromTarget(hit.object, importedModelRef));

      let snapPoint = null;
      for (const hit of intersections) {
        if (!hit.face) continue;
        _tempVec3A.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (_tempVec3A.y > 0.85) {
          snapPoint = hit.point;
          break;
        }
      }

      if (!snapPoint) {
        if (!raycaster.ray.intersectPlane(groundPlane, _tempVec3B)) return;
        snapPoint = _tempVec3B;
      }

      onMove([snapPoint.x, snapPoint.y, snapPoint.z]);
    };

    const handlePointerMove = (event) => {
      updatePlacementFromPointer(event);
    };

    const handlePointerDown = (event) => {
      if (event.button !== 0) return;
      updatePlacementFromPointer(event);
      onPlace();
    };

    gl.domElement.addEventListener("pointermove", handlePointerMove);
    gl.domElement.addEventListener("pointerdown", handlePointerDown);
    return () => {
      gl.domElement.removeEventListener("pointermove", handlePointerMove);
      gl.domElement.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [enabled, raycaster, pointer, camera, scene, gl, groundPlane, importedModelRef, onMove, onPlace]);

  return null;
}
