export const RASTER_TONE_MAPPING_EXPOSURE = 0.5;
export const PATH_TRACING_TONE_MAPPING_EXPOSURE = 0.72;

export const PATH_TRACING_PRESET = {
  // Balanced preset (fixed)
  samples: 64,
  bounces: 2,
  resolutionFactor: 1,
  renderDelay: 0,
  fadeDuration: 0,
  // One tile per frame => sample counter increments every frame (see three-gpu-pathtracer PathTracingRenderer).
  tiles: [1, 1],
  minSamples: 1,
  filterGlossyFactor: 0.6,
  rasterizeScene: false,
  textureSize: [1024, 1024],
};
