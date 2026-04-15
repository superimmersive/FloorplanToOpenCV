import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ControlPanel } from "./components/ControlPanel.jsx";
import { SceneViewport } from "./components/SceneViewport.jsx";
import { UnityFlyCamera } from "./components/camera/UnityFlyCamera.jsx";
import { UnitySceneOrbitControls } from "./components/camera/UnitySceneOrbitControls.jsx";
import { ImportedModelMoveGizmo } from "./components/model/ImportedModelMoveGizmo.jsx";
import { ModelPlacementController } from "./components/model/ModelPlacementController.jsx";
import { SceneContents } from "./components/model/SceneContents.jsx";
import { PathTracingLayer } from "./components/pathTracing/PathTracingLayer.jsx";
import { PATH_TRACING_PRESET } from "./config/viewerConfig.js";

export default function App() {
  const [glbSource, setGlbSource] = useState("");
  const [modelFormat, setModelFormat] = useState("gltf");
  const [modelPosition, setModelPosition] = useState([0, 0, 0]);
  const [modelScale, setModelScale] = useState(1);
  const [modelTransformSelected, setModelTransformSelected] = useState(false);
  const [importedModelObject, setImportedModelObject] = useState(null);
  const [isPlacingModel, setIsPlacingModel] = useState(false);
  const [uploadedObjectUrl, setUploadedObjectUrl] = useState("");
  const [pathTracingEnabled, setPathTracingEnabled] = useState(false);
  const [showDirectionalLight, setShowDirectionalLight] = useState(true);
  const [showEnvironment, setShowEnvironment] = useState(true);
  const [environmentIntensity, setEnvironmentIntensity] = useState(() => {
    const raw = Number(import.meta.env?.VITE_ENVIRONMENT_INTENSITY);
    if (Number.isFinite(raw) && raw >= 0) return raw;
    return 1;
  });
  const [pathTracingSamples, setPathTracingSamples] = useState(PATH_TRACING_PRESET.samples);
  const [pathTracingBounces, setPathTracingBounces] = useState(PATH_TRACING_PRESET.bounces);
  const [interactivePtMode, setInteractivePtMode] = useState(true);
  const [temporalEnabled, setTemporalEnabled] = useState(true);
  const [temporalHistoryWeight, setTemporalHistoryWeight] = useState(0.84);
  const [temporalDepthReject, setTemporalDepthReject] = useState(0.01);
  const [temporalMotionSensitivity, setTemporalMotionSensitivity] = useState(1);
  const fileInputRef = useRef(null);
  const statsParentRef = useRef(null);
  const sampleTrackerRef = useRef(null);
  const importedModelRef = useRef(null);
  const unityFlyActiveRef = useRef(false);
  const onSamplesUpdate = useCallback((s) => {
    if (sampleTrackerRef.current) {
      sampleTrackerRef.current.textContent = String(Math.floor(s));
    }
  }, []);
  const onImportedModelReady = useCallback((obj) => {
    importedModelRef.current = obj;
    setImportedModelObject(obj ?? null);
    if (!obj) setModelTransformSelected(false);
  }, []);

  const onImportModelClick = useCallback(() => {
    setModelTransformSelected(true);
  }, []);

  const onTransformDragPosition = useCallback((next) => {
    setModelPosition(next);
  }, []);

  const activePreset = PATH_TRACING_PRESET;
  const effectiveShowEnvironment = showEnvironment;
  const effectiveSamples = pathTracingSamples;
  const effectiveBounces = pathTracingBounces;

  const showPathTracer = pathTracingEnabled && !isPlacingModel;

  const helpText = useMemo(() => {
    const cam =
      "Camera (Unity Scene): Alt+LMB orbit · MMB pan · Alt+RMB zoom · scroll zoom · hold RMB + mouse to look, WASD move, Q/E world down/up, Shift sprint.";
    if (glbSource && isPlacingModel) {
      return `${modelFormat.toUpperCase()} follows cursor. Click to place (snap to flat surfaces or ground). Fly mode is off while placing. ${cam}`;
    }
    if (glbSource) {
      return `${modelFormat.toUpperCase()} loaded. Click the model to select, then drag axes to move. Click empty space to deselect. ${cam}`;
    }
    return `No model selected. JSX scene is visible. ${cam}`;
  }, [glbSource, modelFormat, isPlacingModel]);

  const onModelUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const extension = file.name.toLowerCase().split(".").pop();
    setModelFormat(extension === "fbx" ? "fbx" : "gltf");
    const url = URL.createObjectURL(file);
    if (uploadedObjectUrl) URL.revokeObjectURL(uploadedObjectUrl);
    setUploadedObjectUrl(url);
    setModelPosition([0, 0, 0]);
    setModelTransformSelected(false);
    setIsPlacingModel(true);
    setGlbSource(url);
  };

  const clearGlb = () => {
    if (uploadedObjectUrl) {
      URL.revokeObjectURL(uploadedObjectUrl);
      setUploadedObjectUrl("");
    }
    setGlbSource("");
    setModelFormat("gltf");
    setModelPosition([0, 0, 0]);
    setIsPlacingModel(false);
    setModelTransformSelected(false);
    setImportedModelObject(null);
    importedModelRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  useEffect(() => {
    return () => {
      if (uploadedObjectUrl) URL.revokeObjectURL(uploadedObjectUrl);
    };
  }, [uploadedObjectUrl]);

  const pathTracerProps = {
    resetToken: `${glbSource}:${modelFormat}:${modelPosition.join(",")}:${modelScale}:${effectiveSamples}:${effectiveBounces}:${activePreset.resolutionFactor}:${activePreset.tiles.join(",")}:${showDirectionalLight}:${effectiveShowEnvironment}:${environmentIntensity}`,
    samples: effectiveSamples,
    bounces: effectiveBounces,
    preset: activePreset,
    interactivePtMode,
    temporalEnabled,
    temporalHistoryWeight,
    temporalDepthReject,
    temporalMotionSensitivity,
    onSamplesUpdate,
    manualCameraMotionRef: unityFlyActiveRef,
  };

  return (
    <div className="app-shell">
      <ControlPanel
        fileInputRef={fileInputRef}
        modelScale={modelScale}
        glbSource={glbSource}
        isPlacingModel={isPlacingModel}
        onModelUpload={onModelUpload}
        onModelScaleChange={(e) => setModelScale(Number(e.target.value))}
        pathTracingEnabled={pathTracingEnabled}
        onPathTracingEnabledChange={(e) => setPathTracingEnabled(e.target.checked)}
        showDirectionalLight={showDirectionalLight}
        onShowDirectionalLightChange={(e) => setShowDirectionalLight(e.target.checked)}
        showEnvironment={showEnvironment}
        onShowEnvironmentChange={(e) => setShowEnvironment(e.target.checked)}
        environmentIntensity={environmentIntensity}
        onEnvironmentIntensityChange={(e) => setEnvironmentIntensity(Number(e.target.value))}
        pathTracingSamples={pathTracingSamples}
        onPathTracingSamplesChange={(e) => setPathTracingSamples(Number(e.target.value))}
        pathTracingBounces={pathTracingBounces}
        onPathTracingBouncesChange={(e) => setPathTracingBounces(Number(e.target.value))}
        interactivePtMode={interactivePtMode}
        onInteractivePtModeChange={(e) => setInteractivePtMode(e.target.checked)}
        temporalEnabled={temporalEnabled}
        onTemporalEnabledChange={(e) => setTemporalEnabled(e.target.checked)}
        temporalHistoryWeight={temporalHistoryWeight}
        onTemporalHistoryWeightChange={(e) => setTemporalHistoryWeight(Number(e.target.value))}
        temporalDepthReject={temporalDepthReject}
        onTemporalDepthRejectChange={(e) => setTemporalDepthReject(Number(e.target.value))}
        temporalMotionSensitivity={temporalMotionSensitivity}
        onTemporalMotionSensitivityChange={(e) => setTemporalMotionSensitivity(Number(e.target.value))}
        clearGlb={clearGlb}
        helpText={helpText}
        showPathTracer={showPathTracer}
      />

      <SceneViewport
        statsParentRef={statsParentRef}
        onPointerMissed={() => {
          if (!isPlacingModel) setModelTransformSelected(false);
        }}
        overlay={
          showPathTracer ? (
            <div className="sample-tracker">
              <span ref={sampleTrackerRef}>0</span> / {effectiveSamples} samples
            </div>
          ) : null
        }
      >
        <SceneContents
          glbSource={glbSource}
          modelFormat={modelFormat}
          modelPosition={modelPosition}
          modelScale={modelScale}
          includeGrid={!showPathTracer}
          isPathTraced={showPathTracer}
          showDirectionalLight={showDirectionalLight}
          showEnvironment={effectiveShowEnvironment}
          environmentIntensity={environmentIntensity}
          onImportedModelReady={onImportedModelReady}
          importSelectable={Boolean(glbSource) && !isPlacingModel}
          onImportClick={onImportModelClick}
        />
        {glbSource && modelTransformSelected && !isPlacingModel && importedModelObject ? (
          <ImportedModelMoveGizmo object={importedModelObject} onDragPosition={onTransformDragPosition} />
        ) : null}
        <PathTracingLayer enabled={showPathTracer} pathTracerProps={pathTracerProps} />
        <ModelPlacementController
          enabled={Boolean(glbSource) && isPlacingModel}
          importedModelRef={importedModelRef}
          onMove={setModelPosition}
          onPlace={() => setIsPlacingModel(false)}
        />
        <UnitySceneOrbitControls />
        <UnityFlyCamera enabled={!isPlacingModel} manualCameraMotionRef={unityFlyActiveRef} />
      </SceneViewport>
    </div>
  );
}
