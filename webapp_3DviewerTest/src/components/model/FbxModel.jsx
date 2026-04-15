import { useEffect, useRef } from "react";
import { useLoader } from "@react-three/fiber";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

export function FbxModel({
  source,
  position = [0, 0, 0],
  scale = 1,
  onObjectReady,
  importSelectable,
  onImportClick,
}) {
  const fbxObject = useLoader(FBXLoader, source);
  const modelRootRef = useRef(null);

  useEffect(() => {
    if (!fbxObject) return;
    fbxObject.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
    });
  }, [fbxObject]);

  useEffect(() => {
    onObjectReady?.(modelRootRef.current);
    return () => {
      onObjectReady?.(null);
    };
  }, [onObjectReady, source]);

  return (
    <group
      ref={modelRootRef}
      position={position}
      scale={[scale, scale, scale]}
      onClick={(e) => {
        if (!importSelectable) return;
        e.stopPropagation();
        onImportClick?.();
      }}
    >
      <primitive object={fbxObject} />
    </group>
  );
}
