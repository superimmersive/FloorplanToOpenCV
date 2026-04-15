import { Suspense } from "react";
import { Environment, Grid } from "@react-three/drei";
import { DemoScene } from "../../scenes/DemoScene";
import { FbxModel } from "./FbxModel.jsx";
import { GlbModel } from "./GlbModel.jsx";

export function SceneContents({
  glbSource,
  modelFormat = "gltf",
  modelPosition = [0, 0, 0],
  modelScale = 1,
  includeGrid = true,
  isPathTraced = false,
  showDirectionalLight = true,
  showEnvironment = true,
  environmentIntensity = 1,
  onImportedModelReady,
  importSelectable,
  onImportClick,
}) {
  const directionalIntensity = 2.3;
  const directionalPosition = [5, 8, 4];

  return (
    <>
      <color attach="background" args={["#12141b"]} />
      {showDirectionalLight ? (
        <directionalLight
          castShadow
          intensity={directionalIntensity}
          position={directionalPosition}
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
      ) : null}

      <Suspense fallback={null}>
        <DemoScene />
        {glbSource ? (
          modelFormat === "fbx" ? (
            <FbxModel
              source={glbSource}
              position={modelPosition}
              scale={modelScale}
              onObjectReady={onImportedModelReady}
              importSelectable={importSelectable}
              onImportClick={onImportClick}
            />
          ) : (
            <GlbModel
              source={glbSource}
              position={modelPosition}
              scale={modelScale}
              onObjectReady={onImportedModelReady}
              importSelectable={importSelectable}
              onImportClick={onImportClick}
            />
          )
        ) : null}
        {showEnvironment ? (
          <Environment
            preset="city"
            backgroundBlurriness={isPathTraced ? 0.05 : 0}
            environmentIntensity={environmentIntensity}
          />
        ) : null}
      </Suspense>

      {includeGrid ? (
        <Grid
          args={[20, 20]}
          position={[0, -0.001, 0]}
          cellColor="#5d6170"
          sectionColor="#888ea4"
          fadeDistance={60}
          infiniteGrid
        />
      ) : null}
    </>
  );
}
