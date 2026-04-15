import { useEffect, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { gltfSpecGlossPlugin } from "./gltfSpecGlossPlugin.js";

export function GlbModel({
  source,
  position = [0, 0, 0],
  scale = 1,
  onObjectReady,
  importSelectable,
  onImportClick,
}) {
  const { gl } = useThree();
  const [loadedScene, setLoadedScene] = useState(null);
  const modelRootRef = useRef(null);

  useEffect(() => {
    let disposed = false;

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");

    const ktx2Loader = new KTX2Loader();
    ktx2Loader.setTranscoderPath("https://unpkg.com/three@0.183.2/examples/jsm/libs/basis/");
    ktx2Loader.detectSupport(gl);

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    loader.setKTX2Loader(ktx2Loader);
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.register(gltfSpecGlossPlugin);

    loader.load(
      source,
      (gltf) => {
        if (disposed) return;

        const scene = gltf.scene;
        scene.traverse((obj) => {
          if (!obj.isMesh) return;
          obj.castShadow = true;
          obj.receiveShadow = true;
          if (!obj.material) return;
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          materials.forEach((mat) => {
            if (!mat) return;
            ["map", "emissiveMap", "metalnessMap", "roughnessMap", "normalMap", "aoMap", "alphaMap"].forEach((key) => {
              const tex = mat[key];
              if (tex) {
                if (key === "map") tex.colorSpace = THREE.SRGBColorSpace;
                tex.needsUpdate = true;
              }
            });
            mat.needsUpdate = true;
          });
        });

        setLoadedScene(scene);
      },
      undefined,
      (err) => {
        if (!disposed) console.error("GLB load error:", err);
      },
    );

    return () => {
      disposed = true;
      dracoLoader.dispose();
      ktx2Loader.dispose();
      setLoadedScene(null);
    };
  }, [source, gl]);

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
      {loadedScene ? <primitive object={loadedScene} /> : null}
    </group>
  );
}
