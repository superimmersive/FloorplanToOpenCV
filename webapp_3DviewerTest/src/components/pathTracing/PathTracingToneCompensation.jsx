import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { PATH_TRACING_TONE_MAPPING_EXPOSURE, RASTER_TONE_MAPPING_EXPOSURE } from "../../config/viewerConfig.js";

/**
 * Path tracing integrates lighting in linear space and composites via the pathtracer fullscreen pass.
 * The same renderer exposure as raster often reads darker (especially the background / miss rays).
 * Bump tone-mapping exposure only while PT is active so the canvas matches raster brightness better.
 */
export function PathTracingToneCompensation() {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMappingExposure = PATH_TRACING_TONE_MAPPING_EXPOSURE;
    return () => {
      gl.toneMappingExposure = RASTER_TONE_MAPPING_EXPOSURE;
    };
  }, [gl]);
  return null;
}
