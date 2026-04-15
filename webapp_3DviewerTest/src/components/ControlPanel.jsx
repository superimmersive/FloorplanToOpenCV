export function ControlPanel({
  fileInputRef,
  modelScale,
  glbSource,
  isPlacingModel,
  onModelUpload,
  onModelScaleChange,
  pathTracingEnabled,
  onPathTracingEnabledChange,
  showDirectionalLight,
  onShowDirectionalLightChange,
  showEnvironment,
  onShowEnvironmentChange,
  environmentIntensity,
  onEnvironmentIntensityChange,
  pathTracingSamples,
  onPathTracingSamplesChange,
  pathTracingBounces,
  onPathTracingBouncesChange,
  interactivePtMode,
  onInteractivePtModeChange,
  temporalEnabled,
  onTemporalEnabledChange,
  temporalHistoryWeight,
  onTemporalHistoryWeightChange,
  temporalDepthReject,
  onTemporalDepthRejectChange,
  temporalMotionSensitivity,
  onTemporalMotionSensitivityChange,
  clearGlb,
  helpText,
  showPathTracer,
}) {
  return (
    <aside className="panel">
      <h1>3D Viewer Test</h1>
      <p>Three.js + React Three Fiber + path tracing</p>

      <section className="controls-help" aria-label="Camera and navigation controls">
        <h2 className="controls-help-title">Controls</h2>
        <ul className="controls-help-list">
          <li>
            <span className="controls-help-keys">Alt + LMB</span>
            <span className="controls-help-desc">Orbit around target</span>
          </li>
          <li>
            <span className="controls-help-keys">MMB</span>
            <span className="controls-help-desc">Pan</span>
          </li>
          <li>
            <span className="controls-help-keys">Alt + RMB</span>
            <span className="controls-help-desc">Zoom toward cursor</span>
          </li>
          <li>
            <span className="controls-help-keys">Scroll</span>
            <span className="controls-help-desc">Zoom in / out</span>
          </li>
          <li>
            <span className="controls-help-keys">Hold RMB</span>
            <span className="controls-help-desc">Mouselook (fly mode)</span>
          </li>
          <li>
            <span className="controls-help-keys">W A S D</span>
            <span className="controls-help-desc">Move while flying</span>
          </li>
          <li>
            <span className="controls-help-keys">Q / E</span>
            <span className="controls-help-desc">World down / up while flying</span>
          </li>
          <li>
            <span className="controls-help-keys">Shift</span>
            <span className="controls-help-desc">Sprint while flying</span>
          </li>
          <li>
            <span className="controls-help-keys">Release RMB</span>
            <span className="controls-help-desc">Exit fly (pointer lock clears)</span>
          </li>
        </ul>
        {isPlacingModel ? (
          <p className="controls-help-note">Placing: model follows cursor ù <strong>LMB</strong> to place on surface or ground. Fly is off.</p>
        ) : glbSource ? (
          <p className="controls-help-note">
            <strong>Click</strong> the imported model to select, drag <strong>axis handles</strong> to move, <strong>click empty space</strong> to deselect.
          </p>
        ) : null}
      </section>

      <label className="control-block">
        <span>Load GLB/GLTF/FBX file</span>
        <input ref={fileInputRef} type="file" accept=".glb,.gltf,.fbx" onChange={onModelUpload} />
      </label>
      <label className="control-block">
        <span>Model scale: {modelScale.toFixed(2)}x</span>
        <input
          type="range"
          min="0.05"
          max="10"
          step="0.05"
          value={modelScale}
          onChange={onModelScaleChange}
          disabled={!glbSource}
        />
      </label>

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={pathTracingEnabled}
          onChange={onPathTracingEnabledChange}
        />
        <span>Enable path tracing</span>
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={showDirectionalLight}
          onChange={onShowDirectionalLightChange}
        />
        <span>Directional light</span>
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={showEnvironment}
          onChange={onShowEnvironmentChange}
        />
        <span>Environment lighting</span>
      </label>
      <label className="control-block">
        <span>Environment intensity: {environmentIntensity.toFixed(2)}</span>
        <input
          type="range"
          min="0"
          max="4"
          step="0.05"
          value={environmentIntensity}
          onChange={onEnvironmentIntensityChange}
          disabled={!showEnvironment}
        />
      </label>
      <label className="control-block">
        <span>Samples: {pathTracingSamples}</span>
        <input
          type="range"
          min="16"
          max="2048"
          step="16"
          value={pathTracingSamples}
          onChange={onPathTracingSamplesChange}
          disabled={!pathTracingEnabled}
        />
      </label>

      <label className="control-block">
        <span>Bounces: {pathTracingBounces}</span>
        <input
          type="range"
          min="1"
          max="12"
          step="1"
          value={pathTracingBounces}
          onChange={onPathTracingBouncesChange}
          disabled={!pathTracingEnabled}
        />
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={interactivePtMode}
          onChange={onInteractivePtModeChange}
          disabled={!pathTracingEnabled}
        />
        <span>Interactive PT mode (noisy while moving)</span>
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={temporalEnabled}
          onChange={onTemporalEnabledChange}
          disabled={!pathTracingEnabled}
        />
        <span>Temporal reprojection</span>
      </label>
      <label className="control-block">
        <span>Temporal history weight: {temporalHistoryWeight.toFixed(2)}</span>
        <input
          type="range"
          min="0"
          max="0.98"
          step="0.01"
          value={temporalHistoryWeight}
          onChange={onTemporalHistoryWeightChange}
          disabled={!pathTracingEnabled || !temporalEnabled}
        />
      </label>
      <label className="control-block">
        <span>Temporal depth reject: {temporalDepthReject.toFixed(3)}</span>
        <input
          type="range"
          min="0.001"
          max="0.05"
          step="0.001"
          value={temporalDepthReject}
          onChange={onTemporalDepthRejectChange}
          disabled={!pathTracingEnabled || !temporalEnabled}
        />
      </label>
      <label className="control-block">
        <span>Temporal motion sensitivity: {temporalMotionSensitivity.toFixed(2)}</span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={temporalMotionSensitivity}
          onChange={onTemporalMotionSensitivityChange}
          disabled={!pathTracingEnabled || !temporalEnabled}
        />
      </label>
      <button onClick={clearGlb}>Clear GLB</button>
      <p className="status">{helpText}</p>
      {showPathTracer ? <p className="status status-pt">Path tracing ù refining...</p> : null}
    </aside>
  );
}
