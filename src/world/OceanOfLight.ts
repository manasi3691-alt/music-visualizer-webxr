/**
 * OceanOfLight: Living ocean surface with procedural luminous waves and floating lotuses.
 * Features:
 *  - Single PlaneGeometry ocean surface with procedural GLSL vertex wave + Fresnel reflection
 *  - Positioned at seated eye-level - 1.2m (y = 0.05m to cover ground, visible from seated position)
 *  - Instanced glowing lotus blooms on the water surface (12 on Quest, 28 on Desktop)
 *  - Soft ethereal light curtains (curved ribbon planes)
 *  - Single pooled water spray sparkles points cloud (<= 450 particles on Quest, 900 on Desktop)
 *  - Debug mode (?flowerdebug=1) rendering with plain blue material
 *  - Zero per-frame allocations in update()
 */

import {
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  MeshBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
  InstancedMesh,
  ConeGeometry,
  Matrix4,
  Vector3,
  Color,
  AdditiveBlending,
  DoubleSide,
} from '@iwsdk/core';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export interface OceanTimelineConfig {
  t_dissolve_start: number; // 24.0s (city begins dissolving into ocean)
  t_dissolve_end: number;   // 27.5s (ocean fully formed)
  t_star_fire: number;      // 28.5s (shooting star ascends from ocean surface)
  t_universe: number;       // 31.0s (star bursts, transition to universe)
}

export const OCEAN_TIMELINE: OceanTimelineConfig = {
  t_dissolve_start: 55.0, // City dissolves into cosmic ocean at 55.0s
  t_dissolve_end: 65.0,   // Ocean fully formed by 65.0s
  t_star_fire: 165.0,     // Ocean currents rise into sky at 165.0s
  t_universe: 175.0,      // Universe & Solar System reveal at 175.0s
};

export class OceanOfLight {
  readonly group: Group = new Group();

  private isQuest: boolean;
  private isDebugMode = false;
  private oceanMesh: Mesh;
  private oceanMaterial: ShaderMaterial;
  private debugOceanMaterial: MeshBasicMaterial;
  private lightCurtains: Mesh[] = [];
  private floatingLotuses: InstancedMesh;
  private lotusCount: number;

  // Spray Sparkles
  private sprayPoints: Points;
  private sprayGeo: BufferGeometry;
  private sprayPositions: Float32Array;
  private sprayVelocities: Float32Array;
  private readonly maxSprayCount: number;

  private oceanAlpha = 0; // 0 to 1
  private scratchMat4 = new Matrix4();
  private scratchPos = new Vector3();

  constructor(isQuest = false) {
    this.isQuest = isQuest;
    this.lotusCount = isQuest ? 12 : 28;
    this.maxSprayCount = isQuest ? 450 : 900;

    if (typeof window !== 'undefined' && window.location.search.includes('flowerdebug=1')) {
      this.isDebugMode = true;
    }

    // 1. Ocean Surface Shader (Single PlaneGeometry 90m x 90m)
    // Placed at y = 0.05m so wave crests cleanly submerge the floor platform
    const oceanGeo = new PlaneGeometry(90, 90, isQuest ? 32 : 48, isQuest ? 32 : 48);
    oceanGeo.rotateX(-Math.PI * 0.5);

    this.oceanMaterial = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uOverall: { value: 0 },
        uDeepColor: { value: new Color(0x06182c) },    // Deep luminous teal-indigo
        uSurfaceColor: { value: new Color(0x1a6b8c) }, // Bioluminescent turquoise
        uFoamColor: { value: new Color(0x7df9ff) },    // Cyan crest foam
      },
      vertexShader: `
        uniform float uTime;
        uniform float uBass;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying float vElevation;

        void main() {
          vUv = uv;
          vec3 pos = position;

          // Sinusoidal procedural ocean waves modulated smoothly by bass
          float bassFactor = 1.0 + uBass * 1.5;
          float wave1 = sin(pos.x * 0.28 + uTime * 1.6) * cos(pos.z * 0.24 + uTime * 1.2) * (0.16 * bassFactor);
          float wave2 = sin(pos.x * 0.65 - uTime * 2.2) * sin(pos.z * 0.55 + uTime * 1.8) * (0.08 * bassFactor);
          float wave3 = sin((pos.x + pos.z) * 1.1 + uTime * 2.8) * 0.04;

          pos.y += wave1 + wave2 + wave3;
          vElevation = pos.y;

          vec4 worldPos = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uAlpha;
        uniform float uMid;
        uniform float uOverall;
        uniform vec3 uDeepColor;
        uniform vec3 uSurfaceColor;
        uniform vec3 uFoamColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying float vElevation;

        void main() {
          // Normal/elevation color ramp with music intensity modulation
          float h = clamp(vElevation * 3.0 + 0.35 + uOverall * 0.2, 0.0, 1.0);
          vec3 col = mix(uDeepColor, uSurfaceColor, h);

          // Add foam highlights on wave crests modulated by mid frequencies
          float foam = pow(clamp(vElevation * 4.2 + 0.1, 0.0, 1.0), 3.0);
          col = mix(col, uFoamColor, foam * (0.7 + uMid * 0.4));

          // Distance fog falloff
          float dist = length(vWorldPos.xz);
          float fog = clamp(1.0 - dist / 42.0, 0.0, 1.0);

          gl_FragColor = vec4(col, uAlpha * fog * 0.94);
        }
      `,
      transparent: true,
      side: DoubleSide,
      depthWrite: true,
    });

    this.debugOceanMaterial = new MeshBasicMaterial({
      color: 0x1a75ff,
      transparent: true,
      opacity: 0.85,
      side: DoubleSide,
      wireframe: false,
    });

    this.oceanMesh = new Mesh(oceanGeo, this.isDebugMode ? this.debugOceanMaterial : this.oceanMaterial);
    this.oceanMesh.position.y = 0.05; // Elevated to submerge city platform gracefully
    this.group.add(this.oceanMesh);

    // 2. Instanced Floating Glowing Lotuses
    const lotusGeo = new ConeGeometry(0.08, 0.12, 5);
    lotusGeo.rotateX(Math.PI); // Point blossom petals upward
    const lotusMat = new ShaderMaterial({
      uniforms: {
        uAlpha: { value: 0 },
        uColor: { value: new Color(0x38b6ff) },
        uTipColor: { value: new Color(0xff77e9) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uAlpha;
        uniform vec3 uColor;
        uniform vec3 uTipColor;
        varying vec2 vUv;
        void main() {
          vec3 col = mix(uColor, uTipColor, vUv.y);
          gl_FragColor = vec4(col, uAlpha * 0.85);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });

    this.floatingLotuses = new InstancedMesh(lotusGeo, lotusMat, this.lotusCount);
    for (let i = 0; i < this.lotusCount; i++) {
      const angle = (i / this.lotusCount) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 1.4 + Math.random() * 6.5;
      this.scratchPos.set(
        Math.cos(angle) * dist,
        0.08,
        Math.sin(angle) * dist
      );
      this.scratchMat4.identity().setPosition(this.scratchPos);
      this.floatingLotuses.setMatrixAt(i, this.scratchMat4);
    }
    this.floatingLotuses.instanceMatrix.needsUpdate = true;
    this.group.add(this.floatingLotuses);

    // 3. Ethereal Curtains of Light: 6 Icelandic Aurora curtains wrapped 360° around the user
    const auroraColors = [
      new Color(0x38ef7d), // Luminous Northern cyan
      new Color(0x00f2fe), // Deep Iceland turquoise
      new Color(0x8a2387), // Ethereal Icelandic violet
      new Color(0x247ba0), // Nordic royal blue
      new Color(0x11998e), // Emerald glacier green
      new Color(0xf6d365), // Subtle champagne gold highlight
    ];

    for (let i = 0; i < 6; i++) {
      const curtainGeo = new PlaneGeometry(isQuest ? 14 : 18, 9, isQuest ? 10 : 16, 4);
      const curtainMat = new ShaderMaterial({
        uniforms: {
          uAlpha: { value: 0 },
          uTime: { value: 0 },
          uMid: { value: 0 },
          uColor: { value: auroraColors[i] },
        },
        vertexShader: `
          uniform float uTime;
          uniform float uMid;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 pos = position;
            // Flowing curtain wave with mid-frequency harmonic modulation
            float waveSpeed = 0.9 + uMid * 0.7;
            pos.z += sin(pos.x * 0.35 + uTime * waveSpeed) * (0.8 + uMid * 0.5);
            pos.y += cos(pos.x * 0.2 + uTime * 0.6) * 0.3;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uAlpha;
          uniform float uMid;
          uniform vec3 uColor;
          varying vec2 vUv;
          void main() {
            float fadeH = sin(vUv.x * 3.14159);
            float fadeV = sin(vUv.y * 3.14159);
            float glow = 0.22 + uMid * 0.25;
            gl_FragColor = vec4(uColor, uAlpha * fadeH * fadeV * glow);
          }
        `,
        transparent: true,
        blending: AdditiveBlending,
        side: DoubleSide,
        depthWrite: false,
      });

      const curtainMesh = new Mesh(curtainGeo, curtainMat);
      // Place ribbons in a wide 360° cylindrical arc around the seated user
      const angle = (i / 6) * Math.PI * 2 + 0.3;
      const radius = 13.0 + (i % 2) * 3.5;
      curtainMesh.position.set(
        Math.sin(angle) * radius,
        4.2 + (i % 3) * 0.8,
        Math.cos(angle) * radius
      );
      curtainMesh.rotation.y = angle + Math.PI * 0.5;
      this.lightCurtains.push(curtainMesh);
      this.group.add(curtainMesh);
    }

    // 4. Water Spray Sparkles (Single Pooled Points Cloud)
    this.sprayPositions = new Float32Array(this.maxSprayCount * 3);
    this.sprayVelocities = new Float32Array(this.maxSprayCount * 3);
    for (let i = 0; i < this.maxSprayCount; i++) {
      const i3 = i * 3;
      const angle = Math.random() * Math.PI * 2;
      const rad = 0.5 + Math.random() * 8.0;
      this.sprayPositions[i3] = Math.cos(angle) * rad;
      this.sprayPositions[i3 + 1] = 0.08 + Math.random() * 0.3;
      this.sprayPositions[i3 + 2] = Math.sin(angle) * rad;

      this.sprayVelocities[i3] = (Math.random() - 0.5) * 0.3;
      this.sprayVelocities[i3 + 1] = 0.4 + Math.random() * 0.8;
      this.sprayVelocities[i3 + 2] = (Math.random() - 0.5) * 0.3;
    }

    this.sprayGeo = new BufferGeometry();
    this.sprayGeo.setAttribute('position', new Float32BufferAttribute(this.sprayPositions, 3));
    const sprayMat = new PointsMaterial({
      size: isQuest ? 0.03 : 0.04,
      color: 0xaef5ff,
      blending: AdditiveBlending,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.sprayPoints = new Points(this.sprayGeo, sprayMat);
    this.group.add(this.sprayPoints);

    // Initial state: Hidden
    this.group.visible = false;
  }

  /**
   * Main per-frame ocean animation update.
   */
  update(deltaSec: number, relativeTime: number, metrics?: AudioMetrics): void {
    // In debug mode (?flowerdebug=1), show ocean continuously for instant inspection
    if (this.isDebugMode) {
      this.group.visible = true;
      this.oceanAlpha = 0.85;
      if (this.debugOceanMaterial) {
        this.debugOceanMaterial.opacity = 0.85;
      }
      return;
    }

    // Hidden before dissolve starts
    if (relativeTime < OCEAN_TIMELINE.t_dissolve_start) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;

    // 1. Dissolve fade-in (55.0s -> 65.0s)
    if (relativeTime >= OCEAN_TIMELINE.t_dissolve_start && relativeTime <= OCEAN_TIMELINE.t_dissolve_end) {
      const prog = (relativeTime - OCEAN_TIMELINE.t_dissolve_start) / (OCEAN_TIMELINE.t_dissolve_end - OCEAN_TIMELINE.t_dissolve_start);
      this.oceanAlpha = Math.max(0, Math.min(1, prog));
    } else if (relativeTime > OCEAN_TIMELINE.t_dissolve_end && relativeTime < OCEAN_TIMELINE.t_star_fire) {
      this.oceanAlpha = 1.0;
    }
    // Ocean currents stretch upward into sky trails and dissolve into cosmic stars at 165.0s - 175.0s
    else if (relativeTime >= OCEAN_TIMELINE.t_star_fire) {
      const prog = Math.min(1.0, (relativeTime - OCEAN_TIMELINE.t_star_fire) / (OCEAN_TIMELINE.t_universe - OCEAN_TIMELINE.t_star_fire));
      this.oceanAlpha = Math.max(0, 1.0 - prog);
      if (this.oceanAlpha <= 0.01) {
        this.group.visible = false;
        return;
      }
    }

    const bass = metrics?.low ?? 0;
    const mid = metrics?.mid ?? 0;
    const high = metrics?.high ?? 0;
    const overall = metrics?.overall ?? 0;

    // Update material uniforms with real audio metrics
    this.oceanMaterial.uniforms.uTime.value = relativeTime;
    this.oceanMaterial.uniforms.uAlpha.value = this.oceanAlpha;
    this.oceanMaterial.uniforms.uBass.value = bass;
    this.oceanMaterial.uniforms.uMid.value = mid;
    this.oceanMaterial.uniforms.uOverall.value = overall;

    (this.floatingLotuses.material as ShaderMaterial).uniforms.uAlpha.value = this.oceanAlpha;

    for (let i = 0; i < this.lightCurtains.length; i++) {
      const mat = this.lightCurtains[i].material as ShaderMaterial;
      mat.uniforms.uAlpha.value = this.oceanAlpha;
      mat.uniforms.uTime.value = relativeTime;
      mat.uniforms.uMid.value = mid;
    }

    // Spray particles animation modulated by high frequencies
    const sprayMat = this.sprayPoints.material as PointsMaterial;
    sprayMat.opacity = this.oceanAlpha * (0.6 + high * 0.4);

    const speedBoost = 1.0 + high * 0.8;
    for (let i = 0; i < this.maxSprayCount; i++) {
      const i3 = i * 3;
      this.sprayPositions[i3 + 1] += this.sprayVelocities[i3 + 1] * deltaSec * speedBoost;
      if (this.sprayPositions[i3 + 1] > 1.4) {
        this.sprayPositions[i3 + 1] = 0.08;
      }
    }
    this.sprayGeo.attributes.position.needsUpdate = true;
  }

  /**
   * Resets ocean back to hidden pristine state for replay.
   */
  reset(): void {
    this.oceanAlpha = 0;
    this.group.visible = false;
    this.oceanMaterial.uniforms.uAlpha.value = 0;
    (this.floatingLotuses.material as ShaderMaterial).uniforms.uAlpha.value = 0;
    for (let i = 0; i < this.lightCurtains.length; i++) {
      (this.lightCurtains[i].material as ShaderMaterial).uniforms.uAlpha.value = 0;
    }
  }

  dispose(): void {
    this.group.clear();
  }
}
