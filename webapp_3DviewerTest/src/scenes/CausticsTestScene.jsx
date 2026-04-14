export function CausticsTestScene() {
  return (
    <group>
      <mesh position={[0, 0.01, 0]} receiveShadow>
        <boxGeometry args={[12, 0.02, 12]} />
        <meshStandardMaterial color="#303340" roughness={0.92} metalness={0.02} />
      </mesh>

      <mesh
        position={[0, 0.9, 0]}
        castShadow
        receiveShadow
        onUpdate={(obj) => obj.layers.enable(1)}
      >
        <sphereGeometry args={[0.42, 96, 96]} />
        <meshPhysicalMaterial
          color="#ffffff"
          transmission={1}
          thickness={0.95}
          ior={1.52}
          roughness={0.012}
          attenuationDistance={2.6}
          attenuationColor="#eef6ff"
        />
      </mesh>

      <mesh
        position={[-0.85, 0.58, 0.15]}
        rotation={[0.2, 0.7, 0.1]}
        castShadow
        receiveShadow
        onUpdate={(obj) => obj.layers.enable(1)}
      >
        <boxGeometry args={[0.35, 1.1, 0.35]} />
        <meshPhysicalMaterial
          color="#ffffff"
          transmission={1}
          thickness={1.35}
          ior={1.58}
          roughness={0.016}
          attenuationDistance={2.2}
          attenuationColor="#e7f1ff"
        />
      </mesh>

      <mesh
        position={[1.2, 0.35, -0.55]}
        castShadow
        receiveShadow
        onUpdate={(obj) => obj.layers.enable(1)}
      >
        <torusKnotGeometry args={[0.22, 0.075, 320, 48]} />
        <meshPhysicalMaterial
          color="#ffffff"
          transmission={1}
          thickness={0.85}
          ior={1.52}
          roughness={0.01}
          attenuationDistance={2.8}
          attenuationColor="#f1f8ff"
        />
      </mesh>
    </group>
  );
}
