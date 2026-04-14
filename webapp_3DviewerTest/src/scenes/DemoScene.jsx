export function DemoScene() {
  return (
    <group position={[0, 0.25, 0]}>
      <mesh position={[-1.2, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.8, 0.8, 0.8]} />
        <meshStandardMaterial color="#4e9bf6" metalness={0.15} roughness={0.35} />
      </mesh>
      <mesh
        position={[0, 0.5, 0]}
        castShadow
        receiveShadow
        onUpdate={(obj) => obj.layers.enable(1)}
      >
        <sphereGeometry args={[0.48, 64, 64]} />
        <meshPhysicalMaterial
          color="#ffffff"
          transmission={1}
          thickness={0.95}
          roughness={0.018}
          ior={1.52}
          attenuationDistance={2.6}
          attenuationColor="#eef6ff"
          envMapIntensity={1}
        />
      </mesh>
      <mesh position={[1.2, 0.5, 0]} castShadow receiveShadow>
        <torusKnotGeometry args={[0.3, 0.11, 256, 32]} />
        <meshStandardMaterial color="#f0a847" metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial color="#303340" roughness={0.95} />
      </mesh>
    </group>
  );
}
