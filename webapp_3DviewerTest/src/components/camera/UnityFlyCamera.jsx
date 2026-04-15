import { useCallback, useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  _unityFlyFwd,
  _unityFlyLastPointer,
  _unityFlyMove,
  _unityFlyRight,
  _unityFlyWorldUp,
  isTypingInFocusedField,
  syncOrbitPivotAfterFly,
  UNITY_FLY_LOOK_SENS,
  UNITY_FLY_MOVE_SPEED,
  UNITY_FLY_SPRINT_MULT,
} from "./unityFlyShared.js";

/** OrbitControls drives the camera via quaternion; fly mode edits Euler in YXZ. Rebuild yaw/pitch from view dir and force roll=0 to avoid a one-frame Z snap. */
function syncFlyEulerFromViewDirection(camera) {
  _unityFlyFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const pitch = Math.asin(THREE.MathUtils.clamp(_unityFlyFwd.y, -1, 1));
  const yaw = Math.atan2(-_unityFlyFwd.x, -_unityFlyFwd.z);
  camera.rotation.set(pitch, yaw, 0, "YXZ");
  camera.updateMatrixWorld(true);
}

/**
 * Unity Scene View fly: hold RMB (without Alt) + mouse to look, WASD move along view, Q/E world down/up, Shift sprint.
 * Uses pointer lock when available. Alt+RMB remains zoom (handled by OrbitControls).
 */
export function UnityFlyCamera({ enabled, manualCameraMotionRef }) {
  const { camera, gl, controls } = useThree();
  const flyActiveRef = useRef(false);
  const keysRef = useRef({
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    KeyQ: false,
    KeyE: false,
    ShiftLeft: false,
    ShiftRight: false,
  });
  const pendingLookRef = useRef({ x: 0, y: 0 });
  const pointerIdRef = useRef(null);
  const cameraRef = useRef(camera);
  const controlsRef = useRef(controls);
  const glRef = useRef(gl);
  cameraRef.current = camera;
  controlsRef.current = controls;
  glRef.current = gl;

  const setFlying = useCallback(
    (active) => {
      flyActiveRef.current = active;
      if (manualCameraMotionRef) manualCameraMotionRef.current = active;
    },
    [manualCameraMotionRef],
  );

  const clearKeys = useCallback(() => {
    const k = keysRef.current;
    k.KeyW = k.KeyA = k.KeyS = k.KeyD = k.KeyQ = k.KeyE = false;
    k.ShiftLeft = k.ShiftRight = false;
  }, []);

  const endFly = useCallback(() => {
    if (!flyActiveRef.current) return;
    setFlying(false);
    clearKeys();
    pendingLookRef.current.x = 0;
    pendingLookRef.current.y = 0;
    const c = controlsRef.current;
    const cam = cameraRef.current;
    const dom = glRef.current?.domElement;
    if (c) c.enabled = true;
    if (cam && c) syncOrbitPivotAfterFly(cam, c);
    if (c) c.dispatchEvent({ type: "change" });
    if (dom && pointerIdRef.current != null) {
      try {
        dom.releasePointerCapture(pointerIdRef.current);
      } catch {
        /* ignore */
      }
      pointerIdRef.current = null;
    }
    if (document.pointerLockElement === dom) {
      document.exitPointerLock();
    }
  }, [clearKeys, setFlying]);

  useEffect(() => {
    if (!enabled && flyActiveRef.current) endFly();
  }, [enabled, endFly]);

  useEffect(() => {
    const dom = gl.domElement;
    if (!dom) return undefined;

    const onKeyDown = (e) => {
      if (!flyActiveRef.current || isTypingInFocusedField()) return;
      const k = keysRef.current;
      switch (e.code) {
        case "KeyW":
          k.KeyW = true;
          break;
        case "KeyA":
          k.KeyA = true;
          break;
        case "KeyS":
          k.KeyS = true;
          break;
        case "KeyD":
          k.KeyD = true;
          break;
        case "KeyQ":
          k.KeyQ = true;
          break;
        case "KeyE":
          k.KeyE = true;
          break;
        case "ShiftLeft":
          k.ShiftLeft = true;
          break;
        case "ShiftRight":
          k.ShiftRight = true;
          break;
        default:
          return;
      }
      e.preventDefault();
    };

    const onKeyUp = (e) => {
      const k = keysRef.current;
      switch (e.code) {
        case "KeyW":
          k.KeyW = false;
          break;
        case "KeyA":
          k.KeyA = false;
          break;
        case "KeyS":
          k.KeyS = false;
          break;
        case "KeyD":
          k.KeyD = false;
          break;
        case "KeyQ":
          k.KeyQ = false;
          break;
        case "KeyE":
          k.KeyE = false;
          break;
        case "ShiftLeft":
          k.ShiftLeft = false;
          break;
        case "ShiftRight":
          k.ShiftRight = false;
          break;
        default:
          break;
      }
    };

    const onPointerMove = (e) => {
      if (!flyActiveRef.current) return;
      let mx = e.movementX ?? 0;
      let my = e.movementY ?? 0;
      if (!mx && !my && (e.buttons & 2)) {
        mx = e.clientX - _unityFlyLastPointer.x;
        my = e.clientY - _unityFlyLastPointer.y;
      }
      _unityFlyLastPointer.set(e.clientX, e.clientY);
      pendingLookRef.current.x += mx;
      pendingLookRef.current.y += my;
    };

    const onPointerDown = (e) => {
      if (!enabled || e.button !== 2 || e.altKey || isTypingInFocusedField()) return;
      if (flyActiveRef.current) return;
      setFlying(true);
      const c = controlsRef.current;
      if (c) c.enabled = false;
      syncFlyEulerFromViewDirection(cameraRef.current);
      _unityFlyLastPointer.set(e.clientX, e.clientY);
      pendingLookRef.current.x = 0;
      pendingLookRef.current.y = 0;
      pointerIdRef.current = e.pointerId;
      try {
        dom.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      try {
        dom.requestPointerLock();
      } catch {
        /* ignore — still fly with captured pointer */
      }
    };

    const onPointerUp = (e) => {
      if (!flyActiveRef.current || e.button !== 2) return;
      endFly();
    };

    const onPointerCancel = () => {
      if (flyActiveRef.current) endFly();
    };

    const onPointerLockChange = () => {
      if (document.pointerLockElement !== dom && flyActiveRef.current) {
        endFly();
      }
    };

    const onBlur = () => {
      if (flyActiveRef.current) endFly();
    };

    dom.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    window.addEventListener("blur", onBlur);

    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      window.removeEventListener("blur", onBlur);
      if (flyActiveRef.current) endFly();
    };
  }, [enabled, endFly, gl.domElement, setFlying]);

  useFrame((_, delta) => {
    if (!flyActiveRef.current) return;
    const cam = cameraRef.current;
    const lx = pendingLookRef.current.x;
    const ly = pendingLookRef.current.y;
    pendingLookRef.current.x = 0;
    pendingLookRef.current.y = 0;
    if (lx !== 0 || ly !== 0) {
      cam.rotation.y -= lx * UNITY_FLY_LOOK_SENS;
      cam.rotation.x -= ly * UNITY_FLY_LOOK_SENS;
      const limit = Math.PI / 2 - 0.02;
      cam.rotation.x = Math.max(-limit, Math.min(limit, cam.rotation.x));
    }

    const k = keysRef.current;
    const sprint = k.ShiftLeft || k.ShiftRight;
    const speed = UNITY_FLY_MOVE_SPEED * (sprint ? UNITY_FLY_SPRINT_MULT : 1) * delta;

    cam.getWorldDirection(_unityFlyFwd);
    _unityFlyRight.crossVectors(_unityFlyFwd, _unityFlyWorldUp);
    if (_unityFlyRight.lengthSq() < 1e-10) {
      _unityFlyRight.set(1, 0, 0);
    } else {
      _unityFlyRight.normalize();
    }

    _unityFlyMove.set(0, 0, 0);
    if (k.KeyW) _unityFlyMove.addScaledVector(_unityFlyFwd, speed);
    if (k.KeyS) _unityFlyMove.addScaledVector(_unityFlyFwd, -speed);
    if (k.KeyD) _unityFlyMove.addScaledVector(_unityFlyRight, speed);
    if (k.KeyA) _unityFlyMove.addScaledVector(_unityFlyRight, -speed);
    if (k.KeyE) _unityFlyMove.addScaledVector(_unityFlyWorldUp, speed);
    if (k.KeyQ) _unityFlyMove.addScaledVector(_unityFlyWorldUp, -speed);

    cam.position.add(_unityFlyMove);
    cam.updateMatrixWorld(true);
  });

  return null;
}
