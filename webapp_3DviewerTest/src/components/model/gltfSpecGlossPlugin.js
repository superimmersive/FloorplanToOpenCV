import * as THREE from "three";

export function gltfSpecGlossPlugin(parser) {
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
