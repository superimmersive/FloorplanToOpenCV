import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Environment, Grid, OrbitControls } from "@react-three/drei";
import { WebGLPathTracer } from "three-gpu-pathtracer";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { DemoScene } from "./scenes/DemoScene";
import { CausticsTestScene } from "./scenes/CausticsTestScene";

function GLTFSpecGlossPlugin(parser) {
  return {
    name: "KHR_materials_pbrSpecularGlossiness",
    getMaterialType(materialIndex) {
      const def = parser.json.materials?.[materialIndex];
      if (def?.extensions?.KHR_materials_pbrSpecularGlossiness) {
        return THREE.MeshStandardMaterial;
      }
      return null;
    },
    extendMaterialParams(materialIndex, params) {
      const def = parser.json.materials?.[materialIndex];
      const ext = def?.extensions?.KHR_materials_pbrSpecularGlossiness;
      if (!ext) return Promise.resolve();

      const pending = [];

      if (ext.diffuseFactor) {
        params.color = new THREE.Color(ext.diffuseFactor[0], ext.diffuseFactor[1], ext.diffuseFactor[2]);
        params.opacity = ext.diffuseFactor[3] ?? 1;
        if (params.opacity < 1) params.transparent = true;
      }

      if (ext.diffuseTexture != null) {
        pending.push(
          parser.assignTexture(params, "map", ext.diffuseTexture, THREE.SRGBColorSpace),
        );
      }

      if (ext.specularGlossinessTexture != null) {
        pending.push(
          parser.assignTexture(params, "roughnessMap", ext.specularGlossinessTexture).then(() => {
            if (params.roughnessMap) params.roughnessMap.colorSpace = THREE.NoColorSpace;
          }),
        );
        pending.push(
          parser.assignTexture(params, "metalnessMap", ext.specularGlossinessTexture).then(() => {
            if (params.metalnessMap) params.metalnessMap.colorSpace = THREE.NoColorSpace;
          }),
        );
      }

      params.roughness = ext.glossinessFactor != null ? 1 - ext.glossinessFactor : 1;

      const spec = ext.specularFactor || [1, 1, 1];
      const specLum = spec[0] * 0.2126 + spec[1] * 0.7152 + spec[2] * 0.0722;
      params.metalness = Math.min(specLum, 1);

      return Promise.all(pending);
    },
  };
}

const PATH_TRACING_PRESETS = {
  performance: {
    label: "Performance",
    samples: 128,
    bounces: 3,
    resolutionFactor: 1,
    renderDelay: 150,
    fadeDuration: 500,
    tiles: [3, 3],
    minSamples: 1,
    filterGlossyFactor: 0.6,
    rasterizeScene: true,
    textureSize: [1024, 1024],
  },
  balanced: {
    label: "Balanced",
    samples: 64,
    bounces: 2,
    resolutionFactor: 1,
    renderDelay: 100,
    fadeDuration: 500,
    tiles: [2, 2],
    minSamples: 1,
    filterGlossyFactor: 0.6,
    rasterizeScene: true,
    textureSize: [1024, 1024],
  },
};

function applyLodPolicy(root, camera, isPathTraced, dynamicLodInRaster, lockLodDuringPT) {
  const hasRenderableGeometry = (object3d) => {
    let found = false;
    object3d.traverse((child) => {
      if (found) return;
      if (!child.isMesh || !child.geometry) return;
      const indexCount = child.geometry.index?.count ?? 0;
      const positionCount = child.geometry.attributes?.position?.count ?? 0;
      if (indexCount > 0 || positionCount > 0) found = true;
    });
    return found;
  };

  root.traverse((obj) => {
    if (!obj.isLOD) return;

    const shouldLock = isPathTraced && lockLodDuringPT;
    const shouldAutoUpdate = shouldLock ? false : dynamicLodInRaster;
    obj.autoUpdate = shouldAutoUpdate;

    if (shouldLock && obj.levels?.length) {
      const validIndex = obj.levels.findIndex((level) => hasRenderableGeometry(level.object));
      const fallbackIndex = validIndex >= 0 ? validIndex : 0;
      obj.levels.forEach((level, index) => {
        level.object.visible = index === fallbackIndex;
      });
    } else if (camera) {
      obj.update(camera);
    }
  });
}

function collectNameBasedLodGroups(root) {
  const groups = new Map();
  const lodRegex = /^(.*?)[_\s-]*lod[_\s-]*(\d+)$/i;

  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const match = obj.name.match(lodRegex);
    if (!match) return;

    const key = match[1].trim().toLowerCase();
    const level = Number(match[2]);
    if (!Number.isFinite(level)) return;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ level, object: obj });
  });

  return Array.from(groups.values())
    .map((entries) => entries.sort((a, b) => a.level - b.level))
    .filter((entries) => entries.length > 1);
}

function applyNameBasedLodPolicy(groups, camera, isPathTraced, dynamicLodInRaster, lockLodDuringPT) {
  const hasRenderableGeometry = (object3d) => {
    let found = false;
    object3d.traverse((child) => {
      if (found) return;
      if (!child.isMesh || !child.geometry) return;
      const indexCount = child.geometry.index?.count ?? 0;
      const positionCount = child.geometry.attributes?.position?.count ?? 0;
      if (indexCount > 0 || positionCount > 0) found = true;
    });
    return found;
  };

  const shouldLock = isPathTraced && lockLodDuringPT;
  const thresholds = [0, 10, 24, 40, 60, 90];

  groups.forEach((entries) => {
    const primary = entries[0].object;
    primary.getWorldPosition(_tempVec3A);
    const distance = camera ? _tempVec3A.distanceTo(camera.position) : 0;

    let targetLevel = 0;
    if (!shouldLock && dynamicLodInRaster) {
      let selected = 0;
      for (let i = 0; i < entries.length; i += 1) {
        const threshold = thresholds[Math.min(i, thresholds.length - 1)];
        if (distance >= threshold) selected = i;
      }
      targetLevel = selected;
    }

    let resolvedTargetLevel = targetLevel;
    if (!hasRenderableGeometry(entries[resolvedTargetLevel].object)) {
      const firstValid = entries.findIndex((entry) => hasRenderableGeometry(entry.object));
      resolvedTargetLevel = firstValid >= 0 ? firstValid : targetLevel;
    }

    entries.forEach((entry, index) => {
      entry.object.visible = index === resolvedTargetLevel;
    });
  });
}

const _tempVec3A = new THREE.Vector3();
const _tempVec3B = new THREE.Vector3();

function getRootFromTarget(target, rootRef) {
  const root = rootRef?.current;
  if (!root) return null;
  if (target === root) return root;
  if (typeof root.getObjectById === "function" && root.getObjectById(target.id)) return root;
  return null;
}

function ModelPlacementController({ enabled, importedModelRef, onMove, onPlace }) {
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

function GlbModel({
  source,
  position = [0, 0, 0],
  isPathTraced,
  dynamicLodInRaster,
  lockLodDuringPT,
  onObjectReady,
}) {
  const { camera, gl } = useThree();
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
    loader.register(GLTFSpecGlossPlugin);

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

  const nameBasedLodGroups = useMemo(
    () => (loadedScene ? collectNameBasedLodGroups(loadedScene) : []),
    [loadedScene],
  );

  useEffect(() => {
    if (!loadedScene) return;
    applyLodPolicy(loadedScene, camera, isPathTraced, dynamicLodInRaster, lockLodDuringPT);
  }, [loadedScene, camera, isPathTraced, dynamicLodInRaster, lockLodDuringPT]);

  useFrame(() => {
    if (!loadedScene) return;
    applyLodPolicy(loadedScene, camera, isPathTraced, dynamicLodInRaster, lockLodDuringPT);
    applyNameBasedLodPolicy(nameBasedLodGroups, camera, isPathTraced, dynamicLodInRaster, lockLodDuringPT);
  });

  useEffect(() => {
    onObjectReady?.(modelRootRef.current);
    return () => {
      onObjectReady?.(null);
    };
  }, [onObjectReady, source]);

  return (
    <group ref={modelRootRef} position={position}>
      {loadedScene ? <primitive object={loadedScene} /> : null}
    </group>
  );
}

function FbxModel({
  source,
  position = [0, 0, 0],
  isPathTraced,
  dynamicLodInRaster,
  lockLodDuringPT,
  onObjectReady,
}) {
  const fbxObject = useLoader(FBXLoader, source);
  const { camera } = useThree();
  const modelRootRef = useRef(null);
  const nameBasedLodGroups = useMemo(() => (fbxObject ? collectNameBasedLodGroups(fbxObject) : []), [fbxObject]);

  useEffect(() => {
    if (!fbxObject) return;
    fbxObject.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
    });
    applyLodPolicy(fbxObject, camera, isPathTraced, dynamicLodInRaster, lockLodDuringPT);
  }, [fbxObject, camera, isPathTraced, dynamicLodInRaster, lockLodDuringPT]);

  useFrame(() => {
    if (!fbxObject) return;
    applyLodPolicy(fbxObject, camera, isPathTraced, dynamicLodInRaster, lockLodDuringPT);
    applyNameBasedLodPolicy(nameBasedLodGroups, camera, isPathTraced, dynamicLodInRaster, lockLodDuringPT);
  });

  useEffect(() => {
    onObjectReady?.(modelRootRef.current);
    return () => {
      onObjectReady?.(null);
    };
  }, [onObjectReady, source]);

  return (
    <group ref={modelRootRef} position={position}>
      <primitive object={fbxObject} />
    </group>
  );
}

function SceneFromJsx({ sceneId }) {
  if (sceneId === "demo") return <DemoScene />;
  if (sceneId === "caustics-test") return <CausticsTestScene />;
  return null;
}

function SceneContents({
  sceneId,
  glbSource,
  modelFormat = "gltf",
  modelPosition = [0, 0, 0],
  includeGrid = true,
  isPathTraced = false,
  dynamicLodInRaster = true,
  lockLodDuringPT = true,
  showDirectionalLight = true,
  showEnvironment = true,
  causticsBoost = false,
  onImportedModelReady,
}) {
  const directionalIntensity = causticsBoost ? 3.9 : 2.3;
  const directionalPosition = causticsBoost ? [2.4, 7.5, 1.8] : [5, 8, 4];

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

      {sceneId === "none" ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#303340" roughness={0.95} />
        </mesh>
      ) : null}

      <Suspense fallback={null}>
        {sceneId !== "none" ? <SceneFromJsx sceneId={sceneId} /> : null}
        {glbSource ? (
          modelFormat === "fbx" ? (
            <FbxModel
              source={glbSource}
              position={modelPosition}
              isPathTraced={isPathTraced}
              dynamicLodInRaster={dynamicLodInRaster}
              lockLodDuringPT={lockLodDuringPT}
              onObjectReady={onImportedModelReady}
            />
          ) : (
            <GlbModel
              source={glbSource}
              position={modelPosition}
              isPathTraced={isPathTraced}
              dynamicLodInRaster={dynamicLodInRaster}
              lockLodDuringPT={lockLodDuringPT}
              onObjectReady={onImportedModelReady}
            />
          )
        ) : null}
        {showEnvironment ? (
          <Environment
            preset="city"
            backgroundBlurriness={isPathTraced ? 0.05 : 0}
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

function DirectPathTracer({
  resetToken,
  samples: maxSamples,
  bounces,
  preset,
  denoiseEnabled,
  denoiseStrength,
  denoiseGlassOnly,
  showGlassMaskOverlay,
  onSamplesUpdate,
}) {
  const { gl, scene, camera, size, controls } = useThree();
  const ptRef = useRef(null);
  const denoiseResourcesRef = useRef(null);
  const sceneReadyRef = useRef(false);
  const lastSceneObjectCountRef = useRef(-1);

  useEffect(() => {
    const pt = new WebGLPathTracer(gl);
    pt.synchronizeRenderSize = true;
    pt.dynamicLowRes = false;
    pt.rasterizeScene = preset.rasterizeScene;
    ptRef.current = pt;
    return () => {
      pt.dispose();
      ptRef.current = null;
      sceneReadyRef.current = false;
      lastSceneObjectCountRef.current = -1;
    };
  }, [gl]);

  useEffect(() => {
    const pt = ptRef.current;
    if (!pt) return;
    pt.bounces = bounces;
    pt.filterGlossyFactor = preset.filterGlossyFactor;
    pt.renderDelay = preset.renderDelay;
    pt.fadeDuration = preset.fadeDuration;
    pt.minSamples = preset.minSamples;
    pt.rasterizeScene = preset.rasterizeScene;
    pt.textureSize.set(preset.textureSize[0], preset.textureSize[1]);
    pt.tiles.set(preset.tiles[0], preset.tiles[1]);
    pt.renderScale = preset.resolutionFactor;
  }, [bounces, preset]);

  useEffect(() => {
    const pt = ptRef.current;
    if (!pt) return;
    pt.setScene(scene, camera);
    sceneReadyRef.current = true;
    lastSceneObjectCountRef.current = -1;
    pt.reset();
  }, [scene, camera, resetToken]);

  useEffect(() => {
    const pt = ptRef.current;
    if (!pt || !controls) return undefined;
    const onChange = () => {
      pt.updateCamera();
    };
    controls.addEventListener("change", onChange);
    return () => {
      controls.removeEventListener("change", onChange);
    };
  }, [controls]);

  useEffect(() => {
    const pt = ptRef.current;
    if (!pt || !denoiseEnabled) {
      if (denoiseResourcesRef.current) {
        const res = denoiseResourcesRef.current;
        pt.renderToCanvasCallback = res.originalCallback;
        res.material.dispose();
        res.mesh.geometry.dispose();
        res.maskMaterial.dispose();
        res.depthPrepassMaterial.dispose();
        res.maskTarget.dispose();
        denoiseResourcesRef.current = null;
      }
      return undefined;
    }

    const originalCallback = pt.renderToCanvasCallback;
    const denoiseScene = new THREE.Scene();
    const denoiseCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const maskTarget = new THREE.WebGLRenderTarget(size.width, size.height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    const maskMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const depthPrepassMaterial = new THREE.MeshDepthMaterial();
    depthPrepassMaterial.depthTest = true;
    depthPrepassMaterial.depthWrite = true;
    depthPrepassMaterial.colorWrite = false;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tGlassMask: { value: null },
        uResolution: { value: new THREE.Vector2(size.width, size.height) },
        uDenoiseStrength: { value: denoiseStrength },
        uOpacity: { value: 1 },
        uGlassOnly: { value: denoiseGlassOnly ? 1 : 0 },
        uShowMaskOverlay: { value: showGlassMaskOverlay ? 1 : 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D tColor;
        uniform sampler2D tGlassMask;
        uniform vec2 uResolution;
        uniform float uDenoiseStrength;
        uniform float uOpacity;
        uniform float uGlassOnly;
        uniform float uShowMaskOverlay;

        float luma(vec3 c) {
          return dot(c, vec3(0.2126, 0.7152, 0.0722));
        }

        void main() {
          vec2 texel = 1.0 / uResolution;
          vec4 centerSample = texture2D(tColor, vUv);
          vec3 center = centerSample.rgb;
          float centerLuma = luma(center) + 1e-5;

          vec3 accum = center;
          float totalWeight = 1.0;

          for (int x = -3; x <= 3; x++) {
            for (int y = -3; y <= 3; y++) {
              if (x == 0 && y == 0) continue;
              vec2 sampleOffset = vec2(float(x), float(y));
              vec2 offset = sampleOffset * texel * (0.5 + (uDenoiseStrength * 1.5));
              vec3 sampleColor = texture2D(tColor, vUv + offset).rgb;

              float sampleLuma = luma(sampleColor);
              float spatial = exp(-dot(sampleOffset, sampleOffset) / 9.0);
              float range = exp(-abs(sampleLuma - centerLuma) * (5.0 + (1.0 - uDenoiseStrength) * 10.0));
              float chroma = exp(-length(sampleColor - center) * (3.0 + (1.0 - uDenoiseStrength) * 6.0));
              float weight = spatial * range * chroma;

              accum += sampleColor * weight;
              totalWeight += weight;
            }
          }

          vec3 denoised = accum / max(totalWeight, 1e-5);
          float glassMask = texture2D(tGlassMask, vUv).r;
          float denoiseMask = mix(1.0, step(0.5, glassMask), step(0.5, uGlassOnly));
          vec3 mixedColor = mix(center, denoised, clamp(uDenoiseStrength, 0.0, 1.0) * denoiseMask);
          if (uShowMaskOverlay > 0.5) {
            vec3 maskTint = vec3(0.1, 0.9, 1.0);
            mixedColor = mix(mixedColor, maskTint, step(0.5, glassMask) * 0.25);
          }
          float outAlpha = centerSample.a * uOpacity;
          gl_FragColor = vec4(mixedColor, outAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    denoiseScene.add(mesh);

    denoiseResourcesRef.current = {
      originalCallback,
      material,
      mesh,
      maskTarget,
      maskMaterial,
      depthPrepassMaterial,
      denoiseScene,
      denoiseCam,
    };

    pt.renderToCanvasCallback = (target, renderer, quad) => {
      if (denoiseGlassOnly || showGlassMaskOverlay) {
        const ptScene = pt.scene;
        const ptCamera = pt.camera;
        const previousTarget = renderer.getRenderTarget();
        const previousOverride = ptScene.overrideMaterial;
        const previousBackground = ptScene.background;
        const previousMask = ptCamera.layers.mask;
        const previousAutoClear = renderer.autoClear;
        const previousClearAlpha = renderer.getClearAlpha();
        const previousClearColor = new THREE.Color();
        renderer.getClearColor(previousClearColor);

        renderer.setRenderTarget(maskTarget);
        renderer.autoClear = true;
        renderer.setClearColor(0x000000, 1);
        renderer.clear(true, true, false);
        ptScene.background = null;

        ptScene.overrideMaterial = depthPrepassMaterial;
        ptCamera.layers.set(0);
        renderer.render(ptScene, ptCamera);

        renderer.autoClear = false;
        ptScene.overrideMaterial = maskMaterial;
        ptCamera.layers.set(1);
        renderer.render(ptScene, ptCamera);

        ptCamera.layers.mask = previousMask;
        ptScene.overrideMaterial = previousOverride;
        ptScene.background = previousBackground;
        renderer.setClearColor(previousClearColor, previousClearAlpha);
        renderer.autoClear = previousAutoClear;
        renderer.setRenderTarget(previousTarget);
      }

      material.uniforms.tColor.value = target.texture;
      material.uniforms.tGlassMask.value = maskTarget.texture;
      material.uniforms.uResolution.value.set(target.width, target.height);
      material.uniforms.uDenoiseStrength.value = denoiseStrength;
      material.uniforms.uOpacity.value = quad.material.opacity;
      material.uniforms.uGlassOnly.value = denoiseGlassOnly ? 1 : 0;
      material.uniforms.uShowMaskOverlay.value = showGlassMaskOverlay ? 1 : 0;
      material.blending = quad.material.blending;
      const currentAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(denoiseScene, denoiseCam);
      renderer.autoClear = currentAutoClear;
    };

    return () => {
      pt.renderToCanvasCallback = originalCallback;
      material.dispose();
      mesh.geometry.dispose();
      maskMaterial.dispose();
      depthPrepassMaterial.dispose();
      maskTarget.dispose();
      denoiseResourcesRef.current = null;
    };
  }, [
    denoiseEnabled,
    denoiseStrength,
    denoiseGlassOnly,
    showGlassMaskOverlay,
    size.width,
    size.height,
  ]);

  useFrame(({ gl: renderer, scene: frameScene, camera: frameCam }) => {
    const pt = ptRef.current;
    if (!pt || !sceneReadyRef.current) {
      renderer.render(frameScene, frameCam);
      return;
    }

    let objectCount = 0;
    frameScene.traverse(() => { objectCount++; });
    if (objectCount !== lastSceneObjectCountRef.current) {
      lastSceneObjectCountRef.current = objectCount;
      pt.setScene(frameScene, frameCam);
      pt.reset();
    }

    pt.pausePathTracing = pt.samples >= maxSamples;
    pt.renderSample();
    if (onSamplesUpdate) {
      onSamplesUpdate(pt.samples);
    }
  }, 1);

  return null;
}

function SceneStatsTracker({ onTrianglesUpdate }) {
  const { scene } = useThree();

  useFrame(() => {
    let triangles = 0;

    scene.traverseVisible((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      const geometry = obj.geometry;
      const indexCount = geometry.index?.count ?? 0;
      const positionCount = geometry.attributes?.position?.count ?? 0;
      triangles += indexCount > 0 ? indexCount / 3 : positionCount / 3;
    });

    if (onTrianglesUpdate) {
      onTrianglesUpdate(triangles);
    }
  });

  return null;
}

function ModelDebugTracker({ importedModelRef, modelFormat, onDebugUpdate }) {
  useFrame(() => {
    const root = importedModelRef?.current;
    if (!root || modelFormat !== "gltf") {
      onDebugUpdate({
        meshCount: 0,
        materialCount: 0,
        materialsWithBaseColorMap: 0,
        textureSlotsBound: 0,
      });
      return;
    }

    let meshCount = 0;
    const materials = new Set();
    let materialsWithBaseColorMap = 0;
    let textureSlotsBound = 0;

    root.traverse((obj) => {
      if (!obj.isMesh) return;
      meshCount += 1;
      if (!obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((mat) => {
        if (!mat || materials.has(mat)) return;
        materials.add(mat);
        if (mat.map) materialsWithBaseColorMap += 1;
        if (mat.map) textureSlotsBound += 1;
        if (mat.emissiveMap) textureSlotsBound += 1;
        if (mat.metalnessMap) textureSlotsBound += 1;
        if (mat.roughnessMap) textureSlotsBound += 1;
        if (mat.normalMap) textureSlotsBound += 1;
        if (mat.aoMap) textureSlotsBound += 1;
        if (mat.alphaMap) textureSlotsBound += 1;
      });
    });

    onDebugUpdate({
      meshCount,
      materialCount: materials.size,
      materialsWithBaseColorMap,
      textureSlotsBound,
    });
  });

  return null;
}

export default function App() {
  const [glbSource, setGlbSource] = useState("");
  const [modelFormat, setModelFormat] = useState("gltf");
  const [modelPosition, setModelPosition] = useState([0, 0, 0]);
  const [isPlacingModel, setIsPlacingModel] = useState(false);
  const [glbUrlInput, setGlbUrlInput] = useState("");
  const [uploadedObjectUrl, setUploadedObjectUrl] = useState("");
  const [sceneId, setSceneId] = useState("demo");
  const [pathTracingEnabled, setPathTracingEnabled] = useState(false);
  const [showDirectionalLight, setShowDirectionalLight] = useState(true);
  const [showEnvironment, setShowEnvironment] = useState(true);
  const [causticsBoostEnabled, setCausticsBoostEnabled] = useState(true);
  const [pathTracingPreset, setPathTracingPreset] = useState("balanced");
  const [pathTracingSamples, setPathTracingSamples] = useState(PATH_TRACING_PRESETS.balanced.samples);
  const [pathTracingBounces, setPathTracingBounces] = useState(PATH_TRACING_PRESETS.balanced.bounces);
  const [denoiseEnabled, setDenoiseEnabled] = useState(false);
  const [denoiseStrength, setDenoiseStrength] = useState(0.35);
  const [denoiseGlassOnly, setDenoiseGlassOnly] = useState(true);
  const [showGlassMaskOverlay, setShowGlassMaskOverlay] = useState(false);
  const [dynamicLodInRaster, setDynamicLodInRaster] = useState(true);
  const [lockLodDuringPT, setLockLodDuringPT] = useState(true);
  const [modelDebugStats, setModelDebugStats] = useState({
    meshCount: 0,
    materialCount: 0,
    materialsWithBaseColorMap: 0,
    textureSlotsBound: 0,
  });
  const fileInputRef = useRef(null);
  const sampleTrackerRef = useRef(null);
  const triangleTrackerRef = useRef(null);
  const importedModelRef = useRef(null);

  const onSamplesUpdate = useCallback((s) => {
    if (sampleTrackerRef.current) {
      sampleTrackerRef.current.textContent = String(Math.floor(s));
    }
  }, []);

  const onTrianglesUpdate = useCallback((t) => {
    if (triangleTrackerRef.current) {
      triangleTrackerRef.current.textContent = Math.round(t).toLocaleString();
    }
  }, []);
  const onImportedModelReady = useCallback((obj) => {
    importedModelRef.current = obj;
  }, []);


  const activePreset = PATH_TRACING_PRESETS[pathTracingPreset];
  const isCausticsScene = sceneId === "caustics-test";
  const causticsBoost = isCausticsScene && causticsBoostEnabled;
  const effectiveShowEnvironment = causticsBoost ? false : showEnvironment;
  const effectiveSamples = causticsBoost ? Math.max(pathTracingSamples, 256) : pathTracingSamples;
  const effectiveBounces = causticsBoost ? Math.max(pathTracingBounces, 6) : pathTracingBounces;

  const showPathTracer = pathTracingEnabled && !isPlacingModel;

  const helpText = useMemo(() => {
    if (glbSource && isPlacingModel) {
      return `${modelFormat.toUpperCase()} follows cursor. Click to place (snap to flat surfaces or ground).`;
    }
    if (glbSource) return `${modelFormat.toUpperCase()} loaded.`;
    return "No model selected. JSX scene is visible.";
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
    setIsPlacingModel(true);
    setGlbSource(url);
  };

  const applyGlbUrl = () => {
    if (!glbUrlInput.trim()) return;
    if (uploadedObjectUrl) {
      URL.revokeObjectURL(uploadedObjectUrl);
      setUploadedObjectUrl("");
    }
    const trimmedUrl = glbUrlInput.trim();
    const urlWithoutQuery = trimmedUrl.split("?")[0].split("#")[0].toLowerCase();
    setModelFormat(urlWithoutQuery.endsWith(".fbx") ? "fbx" : "gltf");
    setModelPosition([0, 0, 0]);
    setIsPlacingModel(true);
    setGlbSource(trimmedUrl);
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
    importedModelRef.current = null;
    setGlbUrlInput("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  useEffect(() => {
    return () => {
      if (uploadedObjectUrl) URL.revokeObjectURL(uploadedObjectUrl);
    };
  }, [uploadedObjectUrl]);

  const onPathTracingPresetChange = (nextPresetId) => {
    const preset = PATH_TRACING_PRESETS[nextPresetId];
    setPathTracingPreset(nextPresetId);
    setPathTracingSamples(preset.samples);
    setPathTracingBounces(preset.bounces);
  };

  return (
    <div className="app-shell">
      <aside className="panel">
        <h1>3D Viewer Test</h1>
        <p>Three.js + React Three Fiber + path tracing</p>

        <label className="control-block">
          <span>Load GLB/GLTF/FBX file</span>
          <input ref={fileInputRef} type="file" accept=".glb,.gltf,.fbx" onChange={onModelUpload} />
        </label>
        <label className="control-block">
          <span>Or model URL</span>
          <input
            type="text"
            placeholder="https://example.com/model.glb or .fbx"
            value={glbUrlInput}
            onChange={(e) => setGlbUrlInput(e.target.value)}
          />
          <button onClick={applyGlbUrl}>Load URL</button>
        </label>

        <label className="control-block">
          <span>JSX scene</span>
          <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
            <option value="demo">DemoScene.jsx</option>
            <option value="caustics-test">CausticsTestScene.jsx</option>
            <option value="none">None</option>
          </select>
        </label>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={pathTracingEnabled}
            onChange={(e) => setPathTracingEnabled(e.target.checked)}
          />
          <span>Enable path tracing</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={showDirectionalLight}
            onChange={(e) => setShowDirectionalLight(e.target.checked)}
          />
          <span>Directional light</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={showEnvironment}
            onChange={(e) => setShowEnvironment(e.target.checked)}
          />
          <span>Environment lighting</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={dynamicLodInRaster}
            onChange={(e) => setDynamicLodInRaster(e.target.checked)}
          />
          <span>Use dynamic LOD in raster</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={lockLodDuringPT}
            onChange={(e) => setLockLodDuringPT(e.target.checked)}
          />
          <span>Lock LOD during PT</span>
        </label>
        {isCausticsScene ? (
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={causticsBoostEnabled}
              onChange={(e) => setCausticsBoostEnabled(e.target.checked)}
            />
            <span>Caustics boost</span>
          </label>
        ) : null}

        <label className="control-block">
          <span>Path tracing preset</span>
          <select
            value={pathTracingPreset}
            onChange={(e) => onPathTracingPresetChange(e.target.value)}
            disabled={!pathTracingEnabled}
          >
            <option value="performance">{PATH_TRACING_PRESETS.performance.label}</option>
            <option value="balanced">{PATH_TRACING_PRESETS.balanced.label}</option>
          </select>
        </label>

        <label className="control-block">
          <span>Samples: {pathTracingSamples}</span>
          <input
            type="range"
            min="16"
            max="2048"
            step="16"
            value={pathTracingSamples}
            onChange={(e) => setPathTracingSamples(Number(e.target.value))}
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
            onChange={(e) => setPathTracingBounces(Number(e.target.value))}
            disabled={!pathTracingEnabled}
          />
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={denoiseEnabled}
            onChange={(e) => setDenoiseEnabled(e.target.checked)}
            disabled={!pathTracingEnabled}
          />
          <span>Denoise pass</span>
        </label>
        <label className="control-block">
          <span>Denoise strength: {denoiseStrength.toFixed(2)}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={denoiseStrength}
            onChange={(e) => setDenoiseStrength(Number(e.target.value))}
            disabled={!pathTracingEnabled || !denoiseEnabled}
          />
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={denoiseGlassOnly}
            onChange={(e) => setDenoiseGlassOnly(e.target.checked)}
            disabled={!pathTracingEnabled || !denoiseEnabled}
          />
          <span>Denoise glass only</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={showGlassMaskOverlay}
            onChange={(e) => setShowGlassMaskOverlay(e.target.checked)}
            disabled={!pathTracingEnabled || !denoiseEnabled}
          />
          <span>Show glass mask overlay</span>
        </label>

        <button onClick={clearGlb}>Clear GLB</button>
        <p className="status">{helpText}</p>
        {showPathTracer ? <p className="status status-pt">Path tracing — refining...</p> : null}
      </aside>

      <main className="viewport">
        <Canvas
          camera={{ position: [3.2, 2.1, 3.5], fov: 50 }}
          shadows
          gl={{
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 0.5,
            outputColorSpace: THREE.SRGBColorSpace,
          }}
        >
          <SceneContents
            sceneId={sceneId}
            glbSource={glbSource}
            modelFormat={modelFormat}
            modelPosition={modelPosition}
            includeGrid={!showPathTracer}
            isPathTraced={showPathTracer}
            showDirectionalLight={showDirectionalLight}
            showEnvironment={effectiveShowEnvironment}
            causticsBoost={causticsBoost}
            dynamicLodInRaster={dynamicLodInRaster}
            lockLodDuringPT={lockLodDuringPT}
            onImportedModelReady={onImportedModelReady}
          />
          {showPathTracer ? (
            <DirectPathTracer
              resetToken={`${sceneId}:${glbSource}:${modelFormat}:${modelPosition.join(",")}:${effectiveSamples}:${effectiveBounces}:${activePreset.resolutionFactor}:${activePreset.tiles.join(",")}:${showDirectionalLight}:${effectiveShowEnvironment}`}
              samples={effectiveSamples}
              bounces={effectiveBounces}
              preset={activePreset}
              denoiseEnabled={denoiseEnabled}
              denoiseStrength={denoiseStrength}
              denoiseGlassOnly={denoiseGlassOnly}
              showGlassMaskOverlay={showGlassMaskOverlay}
              onSamplesUpdate={onSamplesUpdate}
            />
          ) : null}

          <ModelPlacementController
            enabled={Boolean(glbSource) && isPlacingModel}
            importedModelRef={importedModelRef}
            onMove={setModelPosition}
            onPlace={() => setIsPlacingModel(false)}
          />
          <ModelDebugTracker
            importedModelRef={importedModelRef}
            modelFormat={modelFormat}
            onDebugUpdate={setModelDebugStats}
          />
          <SceneStatsTracker onTrianglesUpdate={onTrianglesUpdate} />
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
        </Canvas>
        {showPathTracer ? (
          <div className="sample-tracker">
            <span ref={sampleTrackerRef}>0</span> / {effectiveSamples} samples
          </div>
        ) : null}
        <div className="sample-tracker" style={{ bottom: pathTracingEnabled ? "44px" : "12px" }}>
          <span ref={triangleTrackerRef}>0</span> tris
        </div>
        {glbSource && modelFormat === "gltf" ? (
          <div className="sample-tracker" style={{ bottom: pathTracingEnabled ? "76px" : "44px", maxWidth: "46ch" }}>
            GLB Debug: meshes {modelDebugStats.meshCount} | materials {modelDebugStats.materialCount} | baseColorMaps{" "}
            {modelDebugStats.materialsWithBaseColorMap} | boundTextureSlots {modelDebugStats.textureSlotsBound}
          </div>
        ) : null}
      </main>
    </div>
  );
}
