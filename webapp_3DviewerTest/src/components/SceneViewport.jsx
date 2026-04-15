import { Canvas } from "@react-three/fiber";
import { Stats } from "@react-three/drei";
import * as THREE from "three";
import { RASTER_TONE_MAPPING_EXPOSURE } from "../config/viewerConfig.js";

// Stable object identities — inline `{ camera: { ... } }` / `gl={{ ... }}` on each render can make
// R3F reconcile the default camera again after the first OrbitControls update, which reads as a sudden tilt.
const VIEWPORT_CAMERA = { fov: 50, position: [3.2, 2.1, 3.5] };
const VIEWPORT_GL = {
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: RASTER_TONE_MAPPING_EXPOSURE,
  outputColorSpace: THREE.SRGBColorSpace,
};

export function SceneViewport({ statsParentRef, onPointerMissed, children, overlay }) {
  return (
    <main className="viewport">
      <div ref={statsParentRef} className="stats-anchor" />
      <Canvas
        camera={VIEWPORT_CAMERA}
        shadows
        onPointerMissed={onPointerMissed}
        gl={VIEWPORT_GL}
      >
        {children}
        <Stats parent={statsParentRef} className="stats-panel" />
      </Canvas>
      {overlay}
    </main>
  );
}
