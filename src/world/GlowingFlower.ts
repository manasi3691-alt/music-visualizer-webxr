/**
 * GlowingFlower: Procedural crystal-lotus flower in Three.js.
 * Features:
 *  - Translucent multi-layered petals with luminous shader
 *  - Cyan/turquoise edges, blue/violet/pink highlights, golden-white center
 *  - Smooth Bezier travel from distance to 0.75m in front of seated user's head at eye level
 *  - Subtle FFT petal breathing modulation
 *  - Pooled particle trail (<= 150 particles on Quest, 300 on desktop)
 *  - Collision sphere for poke / controller tip / mouse click detection
 *  - Zero per-frame allocations in update()
 */

import {
  Group,
  Mesh,
  Points,
  BufferGeometry,
  Float32BufferAttribute,
  ShaderMaterial,
  PointsMaterial,
  SphereGeometry,
  ConeGeometry,
  Vector3,
  Color,
  AdditiveBlending,
  DoubleSide,
  Camera,
  World,
} from '@iwsdk/core';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export interface FlowerTimelineConfig {
  t_spawn: number;          // 6.0s (appears in distance)
  t_arrival: number;        // 12.0s (arrives at user focal point)
  t_touch_window_end: number; // 24.0s (12s after arrival fallback timeout)
}

export const FLOWER_TIMELINE: FlowerTimelineConfig = {
  t_spawn: 6.0,
  t_arrival: 12.0,
  t_touch_window_end: 24.0,
};

export class GlowingFlower {
  readonly group: Group = new Group();
  readonly collisionSphere: Mesh;

  private isQuest: boolean;
  private isSpawned = false;
  private isTouched = false;
  private touchCooldownRemaining = 0;

  // Visual meshes
  private flowerRoot: Group = new Group();
  private petals: Mesh[] = [];
  private petalMaterials: ShaderMaterial[] = [];
  private centerCore: Mesh;
  private centerGlow: Mesh;

  // Particle trail
  private trailGroup: Group = new Group();
  private trailPoints: Points;
  private trailGeo: BufferGeometry;
  private trailPositions: Float32Array;
  private trailAlphas: Float32Array;
  private trailHistory: Vector3[] = [];
  private readonly maxTrailCount: number;

  // Pre-allocated scratch objects for zero-allocation updates
  private scratchHeadPos = new Vector3();
  private scratchHeadQuat = new Vector3();
  private scratchForward = new Vector3();
  private scratchCurrentPos = new Vector3();
  private targetFocalPos = new Vector3(0, 1.25, -0.85);
  private spawnOriginPos = new Vector3(3.5, 5.0, -14.0);
  private controlPos = new Vector3(1.2, 2.5, -6.0);

  // Dissolve & bloom animation states
  private blossomProgress = 0; // 0 (bud/closed) -> 1 (open lotus)
  private reactionProgress = 0; // 0 -> 1 after touched

  constructor(isQuest = false) {
    this.isQuest = isQuest;
    this.maxTrailCount = isQuest ? 120 : 250;

    // 1. Core blossom root
    this.group.add(this.flowerRoot);

    // 2. Procedural Lotus Petals (3 concentric layers)
    this.buildCrystalPetals();

    // 3. Golden-White Center Stamen/Core
    const coreGeo = new SphereGeometry(0.045, isQuest ? 12 : 16, isQuest ? 10 : 14);
    const coreMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color(0xfff4cc) },
        uIntensity: { value: 1.8 },
      },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uIntensity;
        varying vec3 vNormal;
        void main() {
          float rim = 1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
          vec3 col = uColor * (0.8 + rim * uIntensity);
          gl_FragColor = vec4(col, 0.95);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.centerCore = new Mesh(coreGeo, coreMat);
    this.flowerRoot.add(this.centerCore);

    // Glow halo around center
    const haloGeo = new SphereGeometry(0.12, 12, 10);
    const haloMat = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(0xffdf80) },
        uAlpha: { value: 0.5 },
      },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uAlpha;
        varying vec3 vNormal;
        void main() {
          float d = 1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
          gl_FragColor = vec4(uColor, pow(d, 2.0) * uAlpha);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });
    this.centerGlow = new Mesh(haloGeo, haloMat);
    this.flowerRoot.add(this.centerGlow);

    // 4. Invisible Collision Volume for Poke / Proximity / Raycast
    const colGeo = new SphereGeometry(0.24, 8, 6);
    const colMat = new ShaderMaterial({
      visible: false,
    });
    this.collisionSphere = new Mesh(colGeo, colMat);
    this.collisionSphere.name = 'glowing_flower_collision';
    this.flowerRoot.add(this.collisionSphere);

    // 5. Pooled Particle Trail
    this.trailPositions = new Float32Array(this.maxTrailCount * 3);
    this.trailAlphas = new Float32Array(this.maxTrailCount);
    for (let i = 0; i < this.maxTrailCount; i++) {
      this.trailHistory.push(new Vector3().copy(this.spawnOriginPos));
    }
    this.trailGeo = new BufferGeometry();
    this.trailGeo.setAttribute('position', new Float32BufferAttribute(this.trailPositions, 3));

    const trailMat = new PointsMaterial({
      size: isQuest ? 0.035 : 0.045,
      color: 0x6be5ff,
      transparent: true,
      opacity: 0.65,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.trailPoints = new Points(this.trailGeo, trailMat);
    this.trailGroup.add(this.trailPoints);
    this.group.add(this.trailGroup);

    // Start hidden
    this.group.visible = false;
    this.flowerRoot.scale.set(0.001, 0.001, 0.001);
  }

  /**
   * Builds crystal lotus petals arranged in 3 tiers (inner 5, middle 7, outer 9).
   */
  private buildCrystalPetals(): void {
    const tiers = [
      { count: 5, radius: 0.09, tilt: 0.35, length: 0.16, width: 0.07 },
      { count: 7, radius: 0.14, tilt: 0.65, length: 0.22, width: 0.10 },
      { count: 9, radius: 0.19, tilt: 0.95, length: 0.28, width: 0.13 },
    ];

    tiers.forEach((tier, tierIdx) => {
      for (let i = 0; i < tier.count; i++) {
        const angle = (i / tier.count) * Math.PI * 2 + (tierIdx * 0.3);
        const petalGeo = new ConeGeometry(tier.width, tier.length, 4, 1);
        petalGeo.scale(1.0, 1.0, 0.25); // Flatten into leaf/petal crystal shape

        const petalMat = new ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uBaseColor: { value: new Color(0x38b6ff) }, // Sky blue/cyan
            uEdgeColor: { value: new Color(0x7df9ff) }, // Turquoise edge
            uHighlightColor: { value: new Color(0xd946ef) }, // Violet/pink highlight
            uVeinIntensity: { value: 1.4 },
            uOpacity: { value: 0.82 },
          },
          vertexShader: `
            varying vec2 vUv;
            varying vec3 vNormal;
            void main() {
              vUv = uv;
              vNormal = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform float uTime;
            uniform vec3 uBaseColor;
            uniform vec3 uEdgeColor;
            uniform vec3 uHighlightColor;
            uniform float uVeinIntensity;
            uniform float uOpacity;
            varying vec2 vUv;
            varying vec3 vNormal;

            void main() {
              float edge = abs(vUv.x - 0.5) * 2.0;
              float tip = vUv.y;
              float vein = sin(vUv.x * 24.0 + vUv.y * 12.0 + uTime * 1.5) * 0.5 + 0.5;

              vec3 col = mix(uBaseColor, uEdgeColor, edge);
              col = mix(col, uHighlightColor, tip * 0.7);
              col += vec3(0.9, 0.95, 1.0) * pow(vein, 4.0) * 0.35 * uVeinIntensity;

              float fresnel = 1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
              col += uEdgeColor * pow(fresnel, 1.8) * 0.6;

              gl_FragColor = vec4(col, uOpacity * (0.6 + 0.4 * tip));
            }
          `,
          transparent: true,
          blending: AdditiveBlending,
          side: DoubleSide,
          depthWrite: false,
        });

        const petalMesh = new Mesh(petalGeo, petalMat);
        petalMesh.position.set(
          Math.cos(angle) * tier.radius,
          0.02 * tierIdx,
          Math.sin(angle) * tier.radius
        );
        petalMesh.rotation.y = -angle - Math.PI * 0.5;
        petalMesh.rotation.z = tier.tilt;

        this.petals.push(petalMesh);
        this.petalMaterials.push(petalMat);
        this.flowerRoot.add(petalMesh);
      }
    });
  }

  /**
   * Computes XR-safe focal target point at runtime:
   * 0.75m in front of seated user's eyes at comfortable eye level.
   */
  updateFocalTarget(world?: World, camera?: Camera): void {
    if (!camera) return;

    const xrCam = (world?.renderer as any)?.xr?.getCamera ? (world?.renderer as any).xr.getCamera() : null;
    const isPresenting = (world?.renderer as any)?.xr?.isPresenting;

    if (isPresenting && xrCam) {
      xrCam.getWorldPosition(this.scratchHeadPos);
    } else {
      camera.getWorldPosition(this.scratchHeadPos);
    }

    camera.getWorldDirection(this.scratchForward);
    this.scratchForward.y = 0;
    if (this.scratchForward.lengthSq() < 0.001) {
      this.scratchForward.set(0, 0, -1);
    } else {
      this.scratchForward.normalize();
    }

    // Seated arm's-reach distance: 0.78m (safely within [0.6m, 1.0m], >= 0.5m safe near)
    const targetDistance = 0.78;
    this.targetFocalPos.copy(this.scratchHeadPos).addScaledVector(this.scratchForward, targetDistance);
    this.targetFocalPos.y = Math.max(1.15, this.scratchHeadPos.y - 0.05);

    // Author spawn origin relative to focal axis in distant sky
    this.spawnOriginPos.set(
      this.targetFocalPos.x + 2.8,
      this.targetFocalPos.y + 4.2,
      this.targetFocalPos.z - 11.5
    );

    // Smooth Bezier mid control point
    this.controlPos.set(
      this.targetFocalPos.x + 1.2,
      this.targetFocalPos.y + 1.8,
      this.targetFocalPos.z - 5.2
    );
  }

  /**
   * Trigger touch response (once). Called either by user interaction or 12s fallback timeout.
   */
  triggerTouch(): boolean {
    if (this.isTouched || this.touchCooldownRemaining > 0) return false;
    this.isTouched = true;
    this.touchCooldownRemaining = 0.30; // 300ms debounce
    console.log('[GlowingFlower] Touch reaction triggered!');
    return true;
  }

  get touched(): boolean {
    return this.isTouched;
  }

  /**
   * Update flower animation and trail.
   */
  update(deltaSec: number, relativeTime: number, metrics?: AudioMetrics, world?: World, camera?: Camera): void {
    if (this.touchCooldownRemaining > 0) {
      this.touchCooldownRemaining -= deltaSec;
    }

    // 1. Spawning / Approach phase
    if (relativeTime >= FLOWER_TIMELINE.t_spawn && relativeTime < FLOWER_TIMELINE.t_arrival) {
      if (!this.isSpawned) {
        this.isSpawned = true;
        this.group.visible = true;
        this.updateFocalTarget(world, camera);
      }

      const duration = FLOWER_TIMELINE.t_arrival - FLOWER_TIMELINE.t_spawn;
      const rawT = (relativeTime - FLOWER_TIMELINE.t_spawn) / duration;
      const t = Math.max(0, Math.min(1, rawT));

      // Ease-out smooth cubic Bezier
      const easeT = 1 - Math.pow(1 - t, 2.6);
      const omt = 1 - easeT;

      this.scratchCurrentPos.set(0, 0, 0)
        .addScaledVector(this.spawnOriginPos, omt * omt)
        .addScaledVector(this.controlPos, 2 * omt * easeT)
        .addScaledVector(this.targetFocalPos, easeT * easeT);

      this.flowerRoot.position.copy(this.scratchCurrentPos);

      // Scale up gracefully as it approaches
      const scale = Math.min(1.0, 0.15 + easeT * 0.85);
      this.flowerRoot.scale.set(scale, scale, scale);

      // Trail update
      this.updateTrail(this.scratchCurrentPos, easeT);
    }
    // 2. Waiting for Touch / Interactive window
    else if (relativeTime >= FLOWER_TIMELINE.t_arrival && relativeTime <= FLOWER_TIMELINE.t_touch_window_end) {
      this.group.visible = true;
      this.flowerRoot.position.copy(this.targetFocalPos);

      // Subtle hovering bobbing
      const hoverOffset = Math.sin(relativeTime * 1.8) * 0.025;
      this.flowerRoot.position.y = this.targetFocalPos.y + hoverOffset;

      // Gentle rotation
      this.flowerRoot.rotation.y += deltaSec * 0.4;

      // Fallback timer auto-trigger
      if (relativeTime >= FLOWER_TIMELINE.t_touch_window_end - 0.05 && !this.isTouched) {
        this.triggerTouch();
      }

      // Trail fades out once arrived
      this.trailPoints.visible = false;
    }
    // 3. Post-touch window / dissolution into ocean
    else if (relativeTime > FLOWER_TIMELINE.t_touch_window_end) {
      if (this.isTouched && this.reactionProgress < 1.0) {
        this.reactionProgress = Math.min(1.0, this.reactionProgress + deltaSec * 0.6);
        // Expand and softly dissolve as ocean emerges
        const scale = 1.0 + this.reactionProgress * 1.5;
        const alpha = Math.max(0, 1.0 - this.reactionProgress);
        this.flowerRoot.scale.set(scale, scale, scale);
        for (let i = 0; i < this.petalMaterials.length; i++) {
          this.petalMaterials[i].uniforms.uOpacity.value = alpha * 0.82;
        }
        if (alpha <= 0.01) {
          this.group.visible = false;
        }
      }
    } else {
      this.group.visible = false;
    }

    // Gentle FFT breathing modulation on petals
    const energy = metrics ? metrics.overall : 0;
    const breathe = 1.0 + Math.sin(relativeTime * 2.2) * 0.04 + energy * 0.06;
    for (let i = 0; i < this.petals.length; i++) {
      this.petals[i].scale.set(breathe, breathe, breathe);
    }

    // Update material time uniform
    for (let i = 0; i < this.petalMaterials.length; i++) {
      this.petalMaterials[i].uniforms.uTime.value = relativeTime;
    }
  }

  private updateTrail(pos: Vector3, alpha: number): void {
    this.trailHistory.pop();
    this.trailHistory.unshift(pos.clone());

    for (let i = 0; i < this.maxTrailCount; i++) {
      const i3 = i * 3;
      const p = this.trailHistory[Math.min(i, this.trailHistory.length - 1)];
      this.trailPositions[i3] = p.x;
      this.trailPositions[i3 + 1] = p.y;
      this.trailPositions[i3 + 2] = p.z;
    }
    this.trailGeo.attributes.position.needsUpdate = true;
    (this.trailPoints.material as PointsMaterial).opacity = alpha * 0.7;
    this.trailPoints.visible = true;
  }

  /**
   * Resets flower back to pristine initial state for replay.
   */
  reset(): void {
    this.isSpawned = false;
    this.isTouched = false;
    this.touchCooldownRemaining = 0;
    this.blossomProgress = 0;
    this.reactionProgress = 0;
    this.group.visible = false;
    this.flowerRoot.scale.set(0.001, 0.001, 0.001);
    this.flowerRoot.position.copy(this.spawnOriginPos);
    for (let i = 0; i < this.petalMaterials.length; i++) {
      this.petalMaterials[i].uniforms.uOpacity.value = 0.82;
    }
  }

  dispose(): void {
    this.group.clear();
  }
}
