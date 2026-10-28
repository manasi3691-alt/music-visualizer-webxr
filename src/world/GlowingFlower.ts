/**
 * GlowingFlower: Procedural crystal-lotus flower in Three.js.
 * Features:
 *  - Organic curved lotus petals (procedural parametric teardrop/cupped quad strip with smooth normals)
 *  - Delicate hand-sized scale (diameter ~16cm)
 *  - NormalBlending with depthWrite to prevent multi-layer additive overexposure/washout
 *  - Translucent turquoise/cyan body with soft magenta/pink edge tips and subtle Fresnel rim
 *  - Debug mode (?flowerdebug=1) rendering with MeshNormalMaterial
 *  - Safe focal distance (0.75m in front of seated user)
 *  - Zero per-frame allocations in update()
 */

import {
  Group,
  Mesh,
  Points,
  BufferGeometry,
  Float32BufferAttribute,
  ShaderMaterial,
  MeshNormalMaterial,
  PointsMaterial,
  SphereGeometry,
  Vector3,
  Color,
  NormalBlending,
  DoubleSide,
  Camera,
  World,
} from '@iwsdk/core';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export interface FlowerTimelineConfig {
  t_spawn: number;            // 58.0s (appears during aurora transition)
  t_arrival: number;          // 65.0s (arrives at focal point for Phase 2)
  t_touch_window_end: number; // 165.0s (stays active across all of Phase 2)
}

export const FLOWER_TIMELINE: FlowerTimelineConfig = {
  t_spawn: 58.0,
  t_arrival: 65.0,
  t_touch_window_end: 165.0,
};

export class GlowingFlower {
  readonly group: Group = new Group();
  readonly collisionSphere: Mesh;

  private isQuest: boolean;
  private isSpawned = false;
  private isTouched = false;
  private touchCooldownRemaining = 0;
  private touchGlow = 0;
  private swayAngle = 0;
  private isDebugMode = false;

  // Visual meshes
  readonly flowerRoot: Group = new Group();
  private petals: Mesh[] = [];
  private petalBaseTilts: number[] = [];
  private petalMaterials: ShaderMaterial[] = [];
  private debugMaterials: MeshNormalMaterial[] = [];
  private centerCore: Mesh;
  private centerGlow: Mesh;

  // Particle trail
  private trailGroup: Group = new Group();
  private trailPoints: Points;
  private trailGeo: BufferGeometry;
  private trailPositions: Float32Array;
  private trailHistory: Vector3[] = [];
  private readonly maxTrailCount: number;

  // Pre-allocated scratch objects for zero-allocation updates
  private scratchHeadPos = new Vector3();
  private scratchForward = new Vector3();
  private scratchCurrentPos = new Vector3();
  private targetFocalPos = new Vector3(0, 1.25, -0.75);
  private spawnOriginPos = new Vector3(2.5, 3.8, -9.5);
  private controlPos = new Vector3(0.9, 2.0, -4.5);

  // Dissolve & bloom animation states
  private reactionProgress = 0; // 0 -> 1 after touched

  constructor(isQuest = false) {
    this.isQuest = isQuest;
    this.maxTrailCount = isQuest ? 100 : 200;

    // Check ?flowerdebug=1
    if (typeof window !== 'undefined' && window.location.search.includes('flowerdebug=1')) {
      this.isDebugMode = true;
    }

    // 1. Core blossom root
    this.group.add(this.flowerRoot);

    // 2. Procedural Smooth Cupped Lotus Petals
    this.buildCurvedLotusPetals();

    // 3. Golden-White Center Stamen/Core
    const coreGeo = new SphereGeometry(0.018, isQuest ? 12 : 16, isQuest ? 10 : 14);
    const coreMat = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(0xfff3cc) },
        uOpacity: { value: 0.95 },
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
        uniform float uOpacity;
        varying vec3 vNormal;
        void main() {
          float rim = max(0.0, dot(vNormal, vec3(0.0, 1.0, 0.4)));
          vec3 col = uColor * (0.85 + 0.35 * rim);
          gl_FragColor = vec4(col, uOpacity);
        }
      `,
      transparent: true,
      blending: NormalBlending,
      depthWrite: true,
    });
    this.centerCore = new Mesh(coreGeo, this.isDebugMode ? new MeshNormalMaterial() : coreMat);
    this.flowerRoot.add(this.centerCore);

    // Glow halo around center (delicate, non-overpowering)
    const haloGeo = new SphereGeometry(0.038, 12, 10);
    const haloMat = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(0xffdf80) },
        uAlpha: { value: 0.45 },
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
          gl_FragColor = vec4(uColor, pow(d, 2.5) * uAlpha);
        }
      `,
      transparent: true,
      blending: NormalBlending,
      side: DoubleSide,
      depthWrite: false,
    });
    this.centerGlow = new Mesh(haloGeo, haloMat);
    this.flowerRoot.add(this.centerGlow);

    // 4. Collision Volume for Poke / Proximity / Raycast (diameter ~20cm)
    const colGeo = new SphereGeometry(0.12, 8, 6);
    const colMat = new ShaderMaterial({ visible: false });
    this.collisionSphere = new Mesh(colGeo, colMat);
    this.collisionSphere.name = 'glowing_flower_collision';
    this.flowerRoot.add(this.collisionSphere);

    // 5. Pooled Particle Trail
    this.trailPositions = new Float32Array(this.maxTrailCount * 3);
    for (let i = 0; i < this.maxTrailCount; i++) {
      this.trailHistory.push(new Vector3().copy(this.spawnOriginPos));
    }
    this.trailGeo = new BufferGeometry();
    this.trailGeo.setAttribute('position', new Float32BufferAttribute(this.trailPositions, 3));

    const trailMat = new PointsMaterial({
      size: isQuest ? 0.025 : 0.035,
      color: 0x6be5ff,
      transparent: true,
      opacity: 0.55,
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
   * Generates a curved parametric lotus petal geometry.
   * Teardrop curved profile with cupped inward curvature.
   * Length ~6-9cm, width ~3-4.5cm, smoothly subdivided (uSegs=6, vSegs=10).
   */
  private createCurvedPetalGeometry(width: number, length: number, cupDepth: number): BufferGeometry {
    const uSegs = 6;
    const vSegs = 10;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let j = 0; j <= vSegs; j++) {
      const v = j / vSegs; // 0 (base) to 1 (tip)
      // Teardrop profile width curve
      const widthProfile = Math.sin(v * Math.PI) * Math.pow(1.0 - v * 0.35, 0.5);
      const halfW = (width * 0.5) * widthProfile;
      const y = v * length;
      // Inward cupped arc: longitudinal curve + transversal hollow
      const longCurve = Math.pow(v, 1.8) * cupDepth;

      for (let i = 0; i <= uSegs; i++) {
        const u = i / uSegs; // 0 to 1
        const uNorm = (u - 0.5) * 2.0; // -1 to +1
        const x = uNorm * halfW;
        const transCup = (1.0 - uNorm * uNorm) * (cupDepth * 0.5);
        const z = -longCurve - transCup;

        positions.push(x, y, z);
        uvs.push(u, v);

        // Approximate outward normal
        const nx = uNorm * 0.4;
        const ny = -0.3;
        const nz = 1.0;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        normals.push(nx / len, ny / len, nz / len);
      }
    }

    for (let j = 0; j < vSegs; j++) {
      for (let i = 0; i < uSegs; i++) {
        const a = j * (uSegs + 1) + i;
        const b = (j + 1) * (uSegs + 1) + i;
        const c = (j + 1) * (uSegs + 1) + (i + 1);
        const d = j * (uSegs + 1) + (i + 1);
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Builds delicate lotus petals in 2 cupped concentric tiers (inner 5, outer 7).
   * Total diameter of blossom: ~15-18cm (hand-sized).
   */
  private buildCurvedLotusPetals(): void {
    const tiers = [
      { count: 5, radius: 0.024, tilt: 0.32, length: 0.065, width: 0.034, cup: 0.016 },
      { count: 7, radius: 0.042, tilt: 0.55, length: 0.082, width: 0.046, cup: 0.022 },
    ];

    tiers.forEach((tier, tierIdx) => {
      for (let i = 0; i < tier.count; i++) {
        const angle = (i / tier.count) * Math.PI * 2 + (tierIdx * 0.45);
        const petalGeo = this.createCurvedPetalGeometry(tier.width, tier.length, tier.cup);

        const petalMat = new ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uTouchGlow: { value: 0.0 },
            uHigh: { value: 0.0 },
            uBaseColor: { value: new Color(0x1ca3c4) },      // Delicate turquoise
            uEdgeColor: { value: new Color(0x6ee7b7) },      // Mint/cyan luminous edge
            uHighlightColor: { value: new Color(0xf472b6) }, // Soft blossom pink/magenta tip
            uOpacity: { value: 0.88 },
            uDebugColorOnly: { value: 0.0 },
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
            uniform float uTouchGlow;
            uniform float uHigh;
            uniform vec3 uBaseColor;
            uniform vec3 uEdgeColor;
            uniform vec3 uHighlightColor;
            uniform float uOpacity;
            varying vec2 vUv;
            varying vec3 vNormal;

            void main() {
              // Delicate gradient from base to tip
              float tip = vUv.y;
              float edge = abs(vUv.x - 0.5) * 2.0;

              // Detailed crystalline branched veins dynamically illuminated by high frequencies and touch
              float vein1 = sin(vUv.x * 24.0 + vUv.y * 12.0 + uTime * 1.5) * 0.5 + 0.5;
              float vein2 = cos(vUv.x * 14.0 - vUv.y * 22.0 + uTime * 0.9) * 0.5 + 0.5;
              float crystalVeins = pow(vein1 * vein2, 1.6) * 2.2;
              float veinPower = 0.20 + uHigh * 0.55 + uTouchGlow * 0.60;

              vec3 col = mix(uBaseColor, uEdgeColor, edge * 0.65);
              // Pink/magenta flush toward upper petal edges and tip
              col = mix(col, uHighlightColor, pow(tip, 1.6) * 0.75);
              col += vec3(0.75, 0.95, 1.0) * crystalVeins * veinPower;

              // Touch glow radiance boost
              col += vec3(0.3, 0.8, 1.0) * uTouchGlow * 0.65;

              // Subtle non-overblown Fresnel rim
              float fresnel = 1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
              col += uEdgeColor * pow(fresnel, 2.2) * (0.35 + uTouchGlow * 0.4);

              gl_FragColor = vec4(col, uOpacity * (0.80 + 0.20 * tip));
            }
          `,
          transparent: true,
          blending: NormalBlending, // Eliminates unchecked multi-layer washout
          side: DoubleSide,
          depthWrite: true,
        });

        const normalMat = new MeshNormalMaterial({ side: DoubleSide });
        this.debugMaterials.push(normalMat);

        const petalMesh = new Mesh(petalGeo, this.isDebugMode ? normalMat : petalMat);
        petalMesh.position.set(
          Math.cos(angle) * tier.radius,
          0.005 * tierIdx,
          Math.sin(angle) * tier.radius
        );
        // Cup petals upward and inward
        petalMesh.rotation.y = -angle - Math.PI * 0.5;
        petalMesh.rotation.x = tier.tilt;

        this.petals.push(petalMesh);
        this.petalBaseTilts.push(tier.tilt);
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

    // Seated arm's-reach distance: 0.75m (strictly 0.5m-0.9m range, comfortably in view)
    const targetDistance = 0.75;
    this.targetFocalPos.copy(this.scratchHeadPos).addScaledVector(this.scratchForward, targetDistance);
    this.targetFocalPos.y = Math.max(1.15, this.scratchHeadPos.y - 0.05);

    // Author spawn origin relative to focal axis in distant sky
    this.spawnOriginPos.set(
      this.targetFocalPos.x + 2.5,
      this.targetFocalPos.y + 3.8,
      this.targetFocalPos.z - 9.5
    );

    // Smooth Bezier mid control point
    this.controlPos.set(
      this.targetFocalPos.x + 0.9,
      this.targetFocalPos.y + 1.8,
      this.targetFocalPos.z - 4.5
    );
  }

  /**
   * Trigger touch response. Can be re-triggered throughout Phase 2.
   */
  triggerTouch(): boolean {
    if (this.touchCooldownRemaining > 0) return false;
    this.isTouched = true;
    this.touchGlow = 1.0;
    this.swayAngle = 0.22;
    this.touchCooldownRemaining = 0.25; // 250ms debounce for responsive repeated touches
    console.log('[GlowingFlower] Lotus petal touch reaction triggered — glowing veins & gentle sway!');
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
    if (this.touchGlow > 0) {
      this.touchGlow = Math.max(0, this.touchGlow - deltaSec * 1.4);
    }
    if (Math.abs(this.swayAngle) > 0.001) {
      this.swayAngle *= Math.pow(0.08, deltaSec);
    }

    // 1. Spawning / Approach phase (58s -> 65s)
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

      // Scale up gracefully from distance to full 1.0 authored scale
      const scale = Math.min(1.0, 0.2 + easeT * 0.8);
      this.flowerRoot.scale.set(scale, scale, scale);

      // Trail update
      this.updateTrail(this.scratchCurrentPos, easeT);
    }
    // 2. Active Interactive Phase 2 Window (65s -> 165s)
    else if (relativeTime >= FLOWER_TIMELINE.t_arrival && relativeTime <= FLOWER_TIMELINE.t_touch_window_end) {
      this.group.visible = true;
      this.flowerRoot.position.copy(this.targetFocalPos);

      // Subtle hovering bobbing
      const hoverOffset = Math.sin(relativeTime * 1.8) * 0.015;
      this.flowerRoot.position.y = this.targetFocalPos.y + hoverOffset;

      // Gentle rotation plus touch sway
      const sway = Math.sin(relativeTime * 8.0) * this.swayAngle;
      this.flowerRoot.rotation.y += deltaSec * 0.25;
      this.flowerRoot.rotation.z = sway;

      // Trail fades out once arrived
      this.trailPoints.visible = false;
    }
    // 3. Cosmic Ascent Transition: Dissolving gracefully into star streams (165s -> 175s)
    else if (relativeTime > FLOWER_TIMELINE.t_touch_window_end && relativeTime < 175.0) {
      this.group.visible = true;
      const dissolveProgress = Math.max(0, Math.min(1, (relativeTime - FLOWER_TIMELINE.t_touch_window_end) / 10.0));
      // Smoothstep easing for petal expansion and stardust dispersal
      const ease = dissolveProgress * dissolveProgress * (3.0 - 2.0 * dissolveProgress);
      const scale = 1.0 + ease * 1.2;
      const alpha = Math.max(0, 1.0 - ease);
      this.flowerRoot.scale.set(scale, scale, scale);
      for (let i = 0; i < this.petalMaterials.length; i++) {
        this.petalMaterials[i].uniforms.uOpacity.value = alpha * 0.88;
      }
      if (alpha <= 0.01) {
        this.group.visible = false;
      }
    } else {
      this.group.visible = false;
    }

    // Gentle FFT breathing modulation on petals + unfolding bloom angle
    const energy = metrics ? metrics.overall : 0;
    const mid = metrics ? metrics.mid : 0;
    const high = metrics ? metrics.high : 0;
    const breathe = 1.0 + Math.sin(relativeTime * 2.2) * 0.02 + energy * 0.04 + this.touchGlow * 0.06;

    // Transition 1 unfolding bloom progress (58.0s -> 65.0s)
    let bloomProgress = 1.0;
    if (relativeTime < FLOWER_TIMELINE.t_arrival) {
      const bT = Math.max(0, Math.min(1, (relativeTime - FLOWER_TIMELINE.t_spawn) / (FLOWER_TIMELINE.t_arrival - FLOWER_TIMELINE.t_spawn)));
      bloomProgress = 0.12 + Math.pow(bT, 2.0) * 0.88;
    }

    for (let i = 0; i < this.petals.length; i++) {
      this.petals[i].scale.set(breathe, breathe, breathe);
      // Unfold petals from closed bud to full bloom, plus subtle mid-frequency breathing
      const baseTilt = this.petalBaseTilts[i] ?? 0.4;
      this.petals[i].rotation.x = baseTilt * bloomProgress * (1.0 + mid * 0.06);
    }

    // Update material time, high frequency vein boost, and touch radiance
    for (let i = 0; i < this.petalMaterials.length; i++) {
      this.petalMaterials[i].uniforms.uTime.value = relativeTime;
      this.petalMaterials[i].uniforms.uTouchGlow.value = this.touchGlow;
      this.petalMaterials[i].uniforms.uHigh.value = high;
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
    (this.trailPoints.material as PointsMaterial).opacity = alpha * 0.55;
    this.trailPoints.visible = true;
  }

  /**
   * Resets flower back to pristine initial state for replay.
   */
  reset(): void {
    this.isSpawned = false;
    this.isTouched = false;
    this.touchCooldownRemaining = 0;
    this.touchGlow = 0;
    this.swayAngle = 0;
    this.reactionProgress = 0;
    this.group.visible = false;
    this.flowerRoot.scale.set(0.001, 0.001, 0.001);
    this.flowerRoot.position.copy(this.spawnOriginPos);
    for (let i = 0; i < this.petalMaterials.length; i++) {
      this.petalMaterials[i].uniforms.uOpacity.value = 0.88;
    }
  }

  dispose(): void {
    this.group.clear();
  }
}
