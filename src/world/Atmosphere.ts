/**
 * Atmosphere: Procedural sky hemisphere, horizon gradient rings, and soft ground reflection.
 * Conductor-driven color shifts with zero per-frame allocations.
 */

import {
  Group,
  Mesh,
  SphereGeometry,
  RingGeometry,
  ShaderMaterial,
  MeshBasicMaterial,
  Color,
  BackSide,
  DoubleSide,
  AdditiveBlending,
} from '@iwsdk/core';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export class Atmosphere {
  readonly group: Group = new Group();

  private domeMesh: Mesh;
  private domeMaterial: ShaderMaterial;
  private horizonRingMesh: Mesh;
  private horizonMaterial: MeshBasicMaterial;
  private groundDiscMesh: Mesh;
  private groundMaterial: MeshBasicMaterial;

  private skyColor = new Color();
  private equatorColor = new Color();
  private groundColor = new Color();

  constructor() {
    // Large hemisphere dome for smooth gradient sky — radius 35m for the spacious cosmic world
    const domeGeo = new SphereGeometry(35, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.55);
    this.domeMaterial = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: {
        uSkyColor:    { value: new Color(0.05, 0.09, 0.18) },  // Midnight blue
        uEquatorColor:{ value: new Color(0.08, 0.14, 0.26) },  // Indigo horizon
        uGroundColor: { value: new Color(0.03, 0.05, 0.09) },  // Near-black charcoal
        uIntensity:   { value: 1.0 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uSkyColor;
        uniform vec3 uEquatorColor;
        uniform vec3 uGroundColor;
        uniform float uIntensity;
        varying vec3 vWorldPosition;

        void main() {
          float h = normalize(vWorldPosition).y;
          // Atmospheric haze: slight brightening near horizon for depth
          float hazeBlend = clamp(1.0 - abs(h) * 4.0, 0.0, 1.0) * 0.12;
          vec3 col;
          if (h > 0.0) {
            col = mix(uEquatorColor, uSkyColor, clamp(pow(h, 0.6), 0.0, 1.0));
          } else {
            col = mix(uEquatorColor, uGroundColor, clamp(pow(-h, 0.6), 0.0, 1.0));
          }
          col = mix(col, uEquatorColor + vec3(0.02, 0.04, 0.06), hazeBlend);
          gl_FragColor = vec4(col * uIntensity, 1.0);
        }
      `,
    });
    this.domeMesh = new Mesh(domeGeo, this.domeMaterial);
    this.domeMesh.position.set(0, 0, 0);
    this.group.add(this.domeMesh);

    // Horizon glow ring — scaled to match the larger dome
    const ringGeo = new RingGeometry(14.0, 28.0, 64);
    this.horizonMaterial = new MeshBasicMaterial({
      color: 0x1a3a5a,     // Deep teal-navy
      side: DoubleSide,
      transparent: true,
      opacity: 0.22,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.horizonRingMesh = new Mesh(ringGeo, this.horizonMaterial);
    this.horizonRingMesh.rotation.x = Math.PI * 0.5;
    this.horizonRingMesh.position.set(0, 0.05, 0);
    this.group.add(this.horizonRingMesh);

    // Ground reflective disc — wider for the cosmic world
    const groundGeo = new RingGeometry(0.1, 12.0, 48);
    this.groundMaterial = new MeshBasicMaterial({
      color: 0x060c18,     // Near-black midnight
      side: DoubleSide,
      transparent: true,
      opacity: 0.40,
      depthWrite: false,
    });
    this.groundDiscMesh = new Mesh(groundGeo, this.groundMaterial);
    this.groundDiscMesh.rotation.x = Math.PI * 0.5;
    this.groundDiscMesh.position.set(0, 0.0, 0);
    this.group.add(this.groundDiscMesh);
  }

  update(frameData: ConductorFrameData, metrics: AudioMetrics): void {
    const { interpolatedColor } = frameData;

    this.skyColor.setRGB(...interpolatedColor.sky);
    this.equatorColor.setRGB(...interpolatedColor.equator);
    this.groundColor.setRGB(...interpolatedColor.ground);

    const uniforms = this.domeMaterial.uniforms;
    (uniforms.uSkyColor.value as Color).copy(this.skyColor);
    (uniforms.uEquatorColor.value as Color).copy(this.equatorColor);
    (uniforms.uGroundColor.value as Color).copy(this.groundColor);

    // Level C: subtle breathing of horizon intensity with music
    const microIntensity = interpolatedColor.intensity * (1.0 + metrics.low * 0.04);
    uniforms.uIntensity.value = microIntensity;

    // Horizon glow modulation
    this.horizonMaterial.color.copy(this.equatorColor);
    this.horizonMaterial.opacity = Math.min(0.45, 0.15 + interpolatedColor.intensity * 0.12 + metrics.mid * 0.05);

    this.groundMaterial.color.copy(this.groundColor);
  }

  dispose(): void {
    this.domeMesh.geometry.dispose();
    this.domeMaterial.dispose();
    this.horizonRingMesh.geometry.dispose();
    this.horizonMaterial.dispose();
    this.groundDiscMesh.geometry.dispose();
    this.groundMaterial.dispose();
    this.group.clear();
  }
}
