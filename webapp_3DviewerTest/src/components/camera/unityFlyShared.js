import * as THREE from "three";

export const UNITY_FLY_LOOK_SENS = 0.0022;
export const UNITY_FLY_MOVE_SPEED = 5.2;
export const UNITY_FLY_SPRINT_MULT = 2.35;
export const UNITY_FLY_ORBIT_TARGET_DIST = 6;

export const _unityFlyFwd = new THREE.Vector3();
export const _unityFlyRight = new THREE.Vector3();
export const _unityFlyWorldUp = new THREE.Vector3(0, 1, 0);
export const _unityFlyMove = new THREE.Vector3();
export const _unityFlyLastPointer = new THREE.Vector2();

export function isTypingInFocusedField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function syncOrbitPivotAfterFly(camera, controls) {
  if (!controls?.target) return;
  camera.getWorldDirection(_unityFlyFwd);
  controls.target.copy(camera.position).addScaledVector(_unityFlyFwd, UNITY_FLY_ORBIT_TARGET_DIST);
  controls.update();
}
