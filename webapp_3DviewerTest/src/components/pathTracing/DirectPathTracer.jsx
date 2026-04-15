import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { WebGLPathTracer } from "three-gpu-pathtracer";
import * as THREE from "three";

const _temporalCurrViewProj = new THREE.Matrix4();
const _temporalPrevCamPos = new THREE.Vector3();
const _temporalCurrCamPos = new THREE.Vector3();
const _temporalPrevCamQuat = new THREE.Quaternion();
const _temporalCurrCamQuat = new THREE.Quaternion();

export function DirectPathTracer({
  resetToken,
  samples: maxSamples,
  bounces,
  preset,
  interactivePtMode,
  temporalEnabled,
  temporalHistoryWeight,
  temporalDepthReject,
  temporalMotionSensitivity,
  onSamplesUpdate,
  manualCameraMotionRef,
}) {
  const { gl, scene, camera, size, controls } = useThree();
  const CAMERA_SETTLE_MS = 70;
  const INTERACTIVE_RECOVERY_MS = 240;
  const ptRef = useRef(null);
  const temporalResourcesRef = useRef(null);
  const temporalHistoryResetRef = useRef(true);
  const wasMovingRef = useRef(false);
  const movementEndTimeRef = useRef(0);
  const interactiveBlendRef = useRef(1);
  const lastMotionSignalRef = useRef(0);
  const sceneReadyRef = useRef(false);
  const lastSceneObjectCountRef = useRef(-1);
  const cameraSettleUntilRef = useRef(0);

  useEffect(() => {
    const pt = new WebGLPathTracer(gl);
    pt.synchronizeRenderSize = true;
    pt.dynamicLowRes = false;
    pt.rasterizeScene = preset.rasterizeScene;
    ptRef.current = pt;
    return () => {
      pt.dispose();
      ptRef.current = null;
      if (temporalResourcesRef.current) {
        const tr = temporalResourcesRef.current;
        tr.temporalMaterial.dispose();
        tr.temporalMesh.geometry.dispose();
        tr.historyTargets.forEach((rt) => rt.dispose());
        tr.depthTargets.forEach((rt) => {
          rt.depthTexture?.dispose();
          rt.dispose();
        });
        temporalResourcesRef.current = null;
      }
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
    temporalHistoryResetRef.current = true;
    pt.reset();
  }, [scene, camera, resetToken]);

  useEffect(() => {
    temporalHistoryResetRef.current = true;
  }, [resetToken]);

  useEffect(() => {
    const pt = ptRef.current;
    if (!pt || !controls) return undefined;
    const markCameraChanging = () => {
      cameraSettleUntilRef.current = performance.now() + CAMERA_SETTLE_MS;
    };
    const onChange = () => {
      markCameraChanging();
      pt.updateCamera();
    };
    const onStart = () => {
      markCameraChanging();
    };
    const onEnd = () => {
      markCameraChanging();
      pt.updateCamera();
    };
    controls.addEventListener("start", onStart);
    controls.addEventListener("change", onChange);
    controls.addEventListener("end", onEnd);
    return () => {
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("change", onChange);
      controls.removeEventListener("end", onEnd);
    };
  }, [controls]);

  useEffect(() => {
    const pt = ptRef.current;
    if (!pt) return undefined;
    const originalCallback = pt.renderToCanvasCallback;

    const makeDepthTarget = (w, h) => {
      const rt = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false,
      });
      rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
      rt.depthTexture.format = THREE.DepthFormat;
      rt.depthTexture.type = THREE.UnsignedIntType;
      return rt;
    };

    const temporalScene = new THREE.Scene();
    const temporalCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const temporalMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tCurrentColor: { value: null },
        tHistoryColor: { value: null },
        tCurrentDepth: { value: null },
        tHistoryDepth: { value: null },
        uInvCurrViewProj: { value: new THREE.Matrix4() },
        uPrevViewProj: { value: new THREE.Matrix4() },
        uTexelSize: { value: new THREE.Vector2(1 / size.width, 1 / size.height) },
        uHistoryWeight: { value: temporalHistoryWeight },
        uDepthReject: { value: temporalDepthReject },
        uHasHistory: { value: 0 },
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
        uniform sampler2D tCurrentColor;
        uniform sampler2D tHistoryColor;
        uniform sampler2D tCurrentDepth;
        uniform sampler2D tHistoryDepth;
        uniform mat4 uInvCurrViewProj;
        uniform mat4 uPrevViewProj;
        uniform vec2 uTexelSize;
        uniform float uHistoryWeight;
        uniform float uDepthReject;
        uniform float uHasHistory;

        vec3 neighborhoodMin(vec2 uv) {
          vec3 mn = vec3(1e9);
          for (int x = -1; x <= 1; x++) {
            for (int y = -1; y <= 1; y++) {
              vec2 o = vec2(float(x), float(y)) * uTexelSize;
              mn = min(mn, texture2D(tCurrentColor, uv + o).rgb);
            }
          }
          return mn;
        }

        vec3 neighborhoodMax(vec2 uv) {
          vec3 mx = vec3(-1e9);
          for (int x = -1; x <= 1; x++) {
            for (int y = -1; y <= 1; y++) {
              vec2 o = vec2(float(x), float(y)) * uTexelSize;
              mx = max(mx, texture2D(tCurrentColor, uv + o).rgb);
            }
          }
          return mx;
        }

        void main() {
          vec4 current = texture2D(tCurrentColor, vUv);
          bool valid = false;
          vec3 historyColor = current.rgb;

          if (uHasHistory > 0.5) {
            float currDepth = texture2D(tCurrentDepth, vUv).r;
            vec4 currClip = vec4(vUv * 2.0 - 1.0, currDepth * 2.0 - 1.0, 1.0);
            vec4 world = uInvCurrViewProj * currClip;
            world /= max(world.w, 1e-6);
            vec4 prevClip = uPrevViewProj * world;

            if (prevClip.w > 1e-6) {
              vec3 prevNdc = prevClip.xyz / prevClip.w;
              vec2 prevUv = prevNdc.xy * 0.5 + 0.5;
              if (prevUv.x >= 0.0 && prevUv.y >= 0.0 && prevUv.x <= 1.0 && prevUv.y <= 1.0) {
                float expectedPrevDepth = prevNdc.z * 0.5 + 0.5;
                float historyDepth = texture2D(tHistoryDepth, prevUv).r;
                valid = abs(historyDepth - expectedPrevDepth) <= uDepthReject;
                if (valid) {
                  historyColor = texture2D(tHistoryColor, prevUv).rgb;
                }
              }
            }
          }

          if (!valid) {
            gl_FragColor = current;
            return;
          }

          vec3 mn = neighborhoodMin(vUv);
          vec3 mx = neighborhoodMax(vUv);
          historyColor = clamp(historyColor, mn, mx);
          gl_FragColor = vec4(mix(current.rgb, historyColor, clamp(uHistoryWeight, 0.0, 0.98)), current.a);
        }
      `,
      transparent: false,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });

    const temporalMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), temporalMaterial);
    temporalScene.add(temporalMesh);
    const temporalDepthPrepassMaterial = new THREE.MeshDepthMaterial();
    temporalDepthPrepassMaterial.depthTest = true;
    temporalDepthPrepassMaterial.depthWrite = true;
    temporalDepthPrepassMaterial.colorWrite = false;
    temporalDepthPrepassMaterial.side = THREE.DoubleSide;

    temporalResourcesRef.current = {
      temporalScene,
      temporalCam,
      temporalMaterial,
      temporalMesh,
      depthPrepassMaterial: temporalDepthPrepassMaterial,
      historyTargets: [
        new THREE.WebGLRenderTarget(size.width, size.height, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          type: THREE.UnsignedByteType,
          depthBuffer: false,
          stencilBuffer: false,
        }),
        new THREE.WebGLRenderTarget(size.width, size.height, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          type: THREE.UnsignedByteType,
          depthBuffer: false,
          stencilBuffer: false,
        }),
      ],
      depthTargets: [makeDepthTarget(size.width, size.height), makeDepthTarget(size.width, size.height)],
      historyIndex: 0,
      hasHistory: false,
      prevViewProj: new THREE.Matrix4(),
      prevCamPos: _temporalPrevCamPos.clone().copy(camera.position),
      prevCamQuat: _temporalPrevCamQuat.clone().copy(camera.quaternion),
    };

    pt.renderToCanvasCallback = (target, renderer, quad) => {
      let pathTraceTarget = target;
      const temporalRes = temporalResourcesRef.current;
      if (temporalEnabled && temporalRes) {
        if (target.width !== temporalRes.historyTargets[0].width || target.height !== temporalRes.historyTargets[0].height) {
          temporalRes.historyTargets.forEach((rt) => rt.setSize(target.width, target.height));
          temporalRes.depthTargets.forEach((rt) => {
            rt.setSize(target.width, target.height);
            rt.depthTexture.image.width = target.width;
            rt.depthTexture.image.height = target.height;
            rt.depthTexture.needsUpdate = true;
          });
          temporalRes.temporalMaterial.uniforms.uTexelSize.value.set(1 / target.width, 1 / target.height);
          temporalRes.hasHistory = false;
        }

        const readIndex = temporalRes.historyIndex;
        const writeIndex = (readIndex + 1) % 2;
        const ptScene = pt.scene;
        const ptCamera = pt.camera;
        const previousTarget = renderer.getRenderTarget();
        const previousOverride = ptScene.overrideMaterial;
        const previousBackground = ptScene.background;
        const previousAutoClear = renderer.autoClear;

        renderer.setRenderTarget(temporalRes.depthTargets[writeIndex]);
        renderer.autoClear = true;
        renderer.clear(true, true, false);
        ptScene.background = null;
        ptScene.overrideMaterial = temporalRes.depthPrepassMaterial;
        renderer.render(ptScene, ptCamera);

        _temporalCurrViewProj.multiplyMatrices(ptCamera.projectionMatrix, ptCamera.matrixWorldInverse);

        _temporalCurrCamPos.copy(ptCamera.position);
        _temporalCurrCamQuat.copy(ptCamera.quaternion);
        const posDelta = _temporalCurrCamPos.distanceTo(temporalRes.prevCamPos);
        const rotDelta = _temporalCurrCamQuat.angleTo(temporalRes.prevCamQuat);
        const motionSignal = posDelta * 2 + rotDelta * 1.2;
        lastMotionSignalRef.current = motionSignal;
        const dynamicHistoryWeight = temporalHistoryWeight;

        temporalRes.temporalMaterial.uniforms.tCurrentColor.value = target.texture;
        temporalRes.temporalMaterial.uniforms.tHistoryColor.value = temporalRes.historyTargets[readIndex].texture;
        temporalRes.temporalMaterial.uniforms.tCurrentDepth.value = temporalRes.depthTargets[writeIndex].depthTexture;
        temporalRes.temporalMaterial.uniforms.tHistoryDepth.value = temporalRes.depthTargets[readIndex].depthTexture;
        temporalRes.temporalMaterial.uniforms.uInvCurrViewProj.value.copy(_temporalCurrViewProj).invert();
        temporalRes.temporalMaterial.uniforms.uPrevViewProj.value.copy(temporalRes.prevViewProj);
        temporalRes.temporalMaterial.uniforms.uHistoryWeight.value = dynamicHistoryWeight;
        temporalRes.temporalMaterial.uniforms.uDepthReject.value = temporalDepthReject;
        temporalRes.temporalMaterial.uniforms.uHasHistory.value =
          temporalRes.hasHistory && !temporalHistoryResetRef.current ? 1 : 0;

        renderer.setRenderTarget(temporalRes.historyTargets[writeIndex]);
        renderer.autoClear = true;
        renderer.clear(true, false, false);
        renderer.render(temporalRes.temporalScene, temporalRes.temporalCam);

        temporalRes.prevViewProj.copy(_temporalCurrViewProj);
        temporalRes.prevCamPos.copy(_temporalCurrCamPos);
        temporalRes.prevCamQuat.copy(_temporalCurrCamQuat);
        temporalRes.hasHistory = true;
        temporalRes.historyIndex = writeIndex;
        temporalHistoryResetRef.current = false;

        ptScene.overrideMaterial = previousOverride;
        ptScene.background = previousBackground;
        renderer.autoClear = previousAutoClear;
        renderer.setRenderTarget(previousTarget);

        pathTraceTarget = temporalRes.historyTargets[writeIndex];
      }

      const sourceTarget = pathTraceTarget;
      quad.material.map = sourceTarget.texture;
      originalCallback(sourceTarget, renderer, quad);
    };

    return () => {
      pt.renderToCanvasCallback = originalCallback;
      if (temporalResourcesRef.current) {
        const tr = temporalResourcesRef.current;
        tr.temporalMaterial.dispose();
        tr.temporalMesh.geometry.dispose();
        tr.depthPrepassMaterial.dispose();
        tr.historyTargets.forEach((rt) => rt.dispose());
        tr.depthTargets.forEach((rt) => {
          rt.depthTexture?.dispose();
          rt.dispose();
        });
        temporalResourcesRef.current = null;
      }
    };
  }, [
    interactivePtMode,
    temporalEnabled,
    temporalHistoryWeight,
    temporalDepthReject,
    temporalMotionSensitivity,
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

    const now = performance.now();
    const isCameraSettling = now < cameraSettleUntilRef.current;
    const isMoving = Boolean(manualCameraMotionRef?.current) || isCameraSettling;

    if (isMoving && !wasMovingRef.current) {
      wasMovingRef.current = true;
    } else if (!isMoving && wasMovingRef.current) {
      wasMovingRef.current = false;
      movementEndTimeRef.current = now;
      // Reset only after significant motion; preserve history for micro-adjustments.
      if (lastMotionSignalRef.current > 0.16) {
        pt.reset();
      }
    }

    if (isMoving) {
      pt.updateCamera();
      pt.dynamicLowRes = interactivePtMode;
      pt.pausePathTracing = pt.samples >= maxSamples;
      pt.renderSample();
      onSamplesUpdate?.(pt.samples);
      return;
    }

    if (interactivePtMode) {
      const t = Math.max(0, Math.min(1, (now - movementEndTimeRef.current) / INTERACTIVE_RECOVERY_MS));
      // Smoothstep transition from interactive/noisy to stable temporal output.
      interactiveBlendRef.current = t * t * (3 - 2 * t);
    } else {
      interactiveBlendRef.current = 1;
    }

    // Keep dynamicLowRes briefly while recovering to avoid a hard visual step.
    pt.dynamicLowRes = interactivePtMode && interactiveBlendRef.current < 0.8;
    // Hard cap accumulation to avoid unbounded GPU load.
    pt.pausePathTracing = pt.samples >= maxSamples;
    pt.renderSample();
    onSamplesUpdate?.(pt.samples);
  }, 1);

  return null;
}
