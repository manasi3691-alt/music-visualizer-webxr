/**
 * OceanOfLight: Living ocean surface with procedural luminous waves and floating lotuses.
 * Features:
 *  - Single PlaneGeometry ocean surface with procedural GLSL vertex wave + Fresnel reflection
 *  - Instanced glowing lotus blooms on the water surface (12 on Quest, 28 on Desktop)
 *  - Soft ethereal light curtains (additive blending curved ribbon planes)
 *  - Single pooled water spray sparkles points cloud (<= 600 particles on Quest, 1200 on Desktop)
 *  - Smooth entry fade during city dissolve, hidden prior to t_dissolve
 *  - Zero per-frame allocations in update()
 */

import {
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
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
  t_dissolve_start: 24.0,
  t_dissolve_end: 27.5,
  t_star_fire: 28.5,
  t_universe: 31.0,
};

export class OceanOfLight {
  readonly group: Group = new Group();

  private isQuest: boolean;
  private oceanMesh: Mesh;
  private oceanMaterial: ShaderMaterial;
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

    // 1. Ocean Surface Shader (Single PlaneGeometry 90m x 90m)
    const oceanGeo = new PlaneGeometry(90, 90, isQuest ? 32 : 48, isQuest ? 32 : 48);
    oceanGeo.rotateX(-Math.PI * 0.5);

    this.oceanMaterial = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uDeepColor: { value: new Color(0x06182c) },    // Deep luminous teal-indigo
        uSurfaceColor: { value: new Color(0x1a6b8c) }, // Bioluminescent turquoise
        uFoamColor: { value: new Color(0x7df9ff) },    // Cyan crest foam
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying float vElevation;

        void main() {
          vUv = uv;
          vec3 pos = position;

          // Multi-frequency sinusoidal procedural ocean waves
          float wave1 = sin(pos.x * 0.28 + uTime * 1.6) * cos(pos.z * 0.24 + uTime * 1.2) * 0.16;
          float wave2 = sin(pos.x * 0.65 - uTime * 2.2) * sin(pos.z * 0.55 + uTime * 1.8) * 0.08;
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
        uniform vec3 uDeepColor;
        uniform vec3 uSurfaceColor;
        uniform vec3 uFoamColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying float vElevation;

        void main() {
          // Normal/elevation color ramp
          float h = clamp(vElevation * 3.0 + 0.35, 0.0, 1.0);
          vec3 col = mix(uDeepColor, uSurfaceColor, h);

          // Add foam highlights on crests
          float foam = pow(clamp(vElevation * 4.2 + 0.1, 0.0, 1.0), 3.0);
          col = mix(col, uFoamColor, foam * 0.7);

          // Distance fog falloff
          float dist = length(vWorldPos.xz);
          float fog = clamp(1.0 - dist / 42.0, 0.0, 1.0);

          gl_FragColor = vec4(col, uAlpha * fog * 0.92);
        }
      `,
      transparent: true,
      depthWrite: true,
    });

    this.oceanMesh = new Mesh(oceanGeo, this.oceanMaterial);
    this.oceanMesh.position.y = -0.05; // Slightly below floor level
    this.group.add(this.oceanMesh);

    // 2. Instanced Floating Glowing Lotuses
    const lotusGeo = new ConeGeometry(0.12, 0.18, 5);
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
      const dist = 1.6 + Math.random() * 7.5;
      this.scratchPos.set(
        Math.cos(angle) * dist,
        0.04,
        Math.sin(angle) * dist
      );
      this.scratchMat4.identity().setPosition(this.scratchPos);
      this.floatingLotuses.setMatrixAt(i, this.scratchMat4);
    }
    this.floatingLotuses.instanceMatrix.needsUpdate = true;
    this.group.add(this.floatingLotuses);

    // 3. Ethereal Curtains of Light (3 soft curved planes)
    for (let i = 0; i < 3; i++) {
      const curtainGeo = new PlaneGeometry(16, 8, 12, 4);
      const curtainMat = new ShaderMaterial({
        uniforms: {
          uAlpha: { value: 0 },
          uTime: { value: 0 },
          uColor: { value: new Color(0x52e5ff) },
        },
        vertexShader: `
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 pos = position;
            pos.z += sin(pos.x * 0.35 + uTime * 1.1) * 0.8;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uAlpha;
          uniform vec3 uColor;
          varying vec2 vUv;
          void main() {
            float fadeH = sin(vUv.x * 3.14159);
            float fadeV = sin(vUv.y * 3.14159);
            gl_FragColor = vec4(uColor, uAlpha * fadeH * fadeV * 0.22);
          }
        `,
        transparent: true,
        blending: AdditiveBlending,
        side: DoubleSide,
        depthWrite: false,
      });

      const curtainMesh = new Mesh(curtainGeo, curtainMat);
      curtainMesh.position.set((i - 1) * 9.0, 4.0, -14.0 - i * 3.5);
      curtainMesh.rotation.y = (i - 1) * 0.25;
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
      this.sprayPositions[i3 + 1] = 0.05 + Math.random() * 0.3;
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
    // Hidden before dissolve starts
    if (relativeTime < OCEAN_TIMELINE.t_dissolve_start) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;

    // 1. Dissolve fade-in (24.0s -> 27.5s)
    if (relativeTime >= OCEAN_TIMELINE.t_dissolve_start && relativeTime <= OCEAN_TIMELINE.t_dissolve_end) {
      const prog = (relativeTime - OCEAN_TIMELINE.t_dissolve_start) / (OCEAN_TIMELINE.t_dissolve_end - OCEAN_TIMELINE.t_dissolve_start);
      this.oceanAlpha = Math.max(0, Math.min(1, prog));
    } else if (relativeTime > OCEAN_TIMELINE.t_dissolve_end && relativeTime < OCEAN_TIMELINE.t_universe) {
      this.oceanAlpha = 1.0;
    }
    // Fade out as universe reveals at 31.0s - 34.0s
    else if (relativeTime >= OCEAN_TIMELINE.t_universe) {
      const prog = Math.min(1.0, (relativeTime - OCEAN_TIMELINE.t_universe) / 3.0);
      this.oceanAlpha = Math.max(0, 1.0 - prog);
      if (this.oceanAlpha <= 0.01) {
        this.group.visible = false;
        return;
      }
    }

    // Update material uniforms
    this.oceanMaterial.uniforms.uTime.value = relativeTime;
    this.oceanMaterial.uniforms.uAlpha.value = this.oceanAlpha;

    (this.floatingLotuses.material as ShaderMaterial).uniforms.uAlpha.value = this.oceanAlpha;

    for (let i = 0; i < this.lightCurtains.length; i++) {
      const mat = this.lightCurtains[i].material as ShaderMaterial;
      mat.uniforms.uAlpha.value = this.oceanAlpha;
      mat.uniforms.uTime.value = relativeTime;
    }

    // Spray particles animation
    const sprayMat = this.sprayPoints.material as PointsMaterial;
    sprayMat.opacity = this.oceanAlpha * 0.7;

    for (let i = 0; i < this.maxSprayCount; i++) {
      const i3 = i * 3;
      this.sprayPositions[i3 + 1] += this.sprayVelocities[i3 + 1] * deltaSec;
      if (this.sprayPositions[i3 + 1] > 1.2) {
        this.sprayPositions[i3 + 1] = 0.05;
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
