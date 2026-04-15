import { useCallback, useEffect, useRef } from "react";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

/** Unity Scene view mouse mapping: Alt+LMB orbit, MMB pan, Alt+RMB dolly, wheel zoom. Plain LMB does not orbit (selection / gizmo friendly). */
export function UnitySceneOrbitControls() {
  const controlsRef = useRef(null);
  const altHeldRef = useRef(false);

  const syncMouseButtons = useCallback(() => {
    const c = controlsRef.current;
    if (!c) return;
    const inactive = -1;
    c.mouseButtons = {
      LEFT: altHeldRef.current ? THREE.MOUSE.ROTATE : inactive,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: altHeldRef.current ? THREE.MOUSE.DOLLY : inactive,
    };
  }, []);

  const setControlsRef = useCallback(
    (c) => {
      controlsRef.current = c;
      if (c) syncMouseButtons();
    },
    [syncMouseButtons],
  );

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.repeat) return;
      if (e.altKey) {
        altHeldRef.current = true;
        syncMouseButtons();
      }
    };
    const onKeyUp = (e) => {
      if (!e.altKey) {
        altHeldRef.current = false;
        syncMouseButtons();
      }
    };
    const onBlur = () => {
      altHeldRef.current = false;
      syncMouseButtons();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [syncMouseButtons]);

  return (
    <OrbitControls
      ref={setControlsRef}
      makeDefault
      enableDamping={false}
      zoomToCursor
      screenSpacePanning
      rotateSpeed={0.95}
      panSpeed={0.85}
      zoomSpeed={0.72}
    />
  );
}
