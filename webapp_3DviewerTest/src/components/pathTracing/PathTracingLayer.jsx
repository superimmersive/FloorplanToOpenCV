import { DirectPathTracer } from "./DirectPathTracer.jsx";
import { PathTracingToneCompensation } from "./PathTracingToneCompensation.jsx";

export function PathTracingLayer({ enabled, pathTracerProps }) {
  if (!enabled) return null;
  return (
    <>
      <DirectPathTracer {...pathTracerProps} />
      <PathTracingToneCompensation />
    </>
  );
}
