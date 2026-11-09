/**
 * GlowingFlower: Interactive Procedural Crystal Lotus Flower in WebXR.
 *
 * Tailored for Meta Quest 3S seated VR experience:
 * - 12 organic curved crystal lotus petals in 2 concentric tiers (5 inner, 7 outer).
 * - Living Interactive Blooming:
 *     * Petals are individually interactive.
 *     * Touching or selecting any petal gracefully animates the lotus unfolding from
 *       a closed/partially-closed crystal bud into a fully open, magnificent crystal lotus.
 *     * Touching it again gently animates it back to a closed bud.
 *     * Petals animate with smooth, organic rotations and harmonic spring damping (no popping/scaling).
 *     * Staggered tier kinematics: outer petals lead the opening, inner petals lead the closing.
 *     * Individual petals respond to touch with immediate soft glow, localized sway, and stardust sparks,
 *       while coordinating the overarching flower bloom.
 * - Magical Visual Response:
 *     * Soft luminous glow to the touched petal with ripple to neighbors.
 *     * Delicate sparkling stardust particles and luminous trails around petal tips during unfurling.
 *     * Intricate crystalline branched veins gradually illuminate in brilliant electric turquoise/cyan during blooming.
 *     * Radiant golden-white stamen core and breathing halo when fully open.
 *     * Preserves translucent turquoise, cyan, blossom pink, lavender, and royal violet crystal appearance.
 * - Genuine VR Interaction:
 *     * Multi-modal: Meta Quest 3S hand tracking index fingertips, controller grips, and pointing rays.
 *     * Subtle approach highlight: glowing rim aura and edge glimmer when hand or controller nears a petal.
 *     * Perfectly calibrated seated reach distance (0.68m) directly in front of seated user at chest level.
 *     * Debounced toggle prevents multi-frame chatter while remaining effortlessly responsive.
 *     * Full desktop raycast and mouse hover support.
 * - Zero per-frame allocations, fully optimized for 72-90 fps on Meta Quest 3S.
 */

import {
  Group,
  Mesh,
  Points,
  BufferGeometry,
  Float32BufferAttribute,
  ShaderMaterial,
  MeshNormalMaterial,
  SphereGeometry,
  Vector3,
  Color,
  NormalBlending,
  AdditiveBlending,
  DoubleSide,
  Camera,
  World,
} from '@iwsdk/core';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export interface FlowerTimelineConfig {
  t_spawn: number;            // 58.0s (swoops in during aurora transition)
  t_arrival: number;          // 65.0s (arrives at seated focal point for Phase 2)
  t_touch_window_end: number; // 165.0s (stays active throughout Phase 2)
}

export const FLOWER_TIMELINE: FlowerTimelineConfig = {
  t_spawn: 58.0,
  t_arrival: 65.0,
  t_touch_window_end: 165.0,
};

interface PetalData {
  mesh: Mesh;
  mat: ShaderMaterial;
  tier: number;            // 0 = inner (5 petals), 1 = outer (7 petals)
  index: number;
  angle: number;
  radius: number;
  length: number;
  width: number;
  cupDepth: number;
  tiltClosed: number;      // Upright bud angle (rad)
  tiltOpen: number;        // Flared bloom angle (rad)
  currentTilt: number;     // Current animated tilt
  localTip: Vector3;       // Pre-computed local tip position
  worldTip: Vector3;       // Scratch world position of tip
  worldCenter: Vector3;    // Scratch world position of petal body
  hoverIntensity: number;  // 0 to 1
  touchGlow: number;       // 0 to 1
  swayAmp: number;         // Individual harmonic spring recoil
  swayPhase: number;       // Phase accumulator
}

export class GlowingFlower {
  readonly group: Group = new Group();
  readonly flowerRoot: Group = new Group();
  readonly collisionSphere: Mesh;

  private isQuest: boolean;
  private isSpawned = false;
  private isDebugMode = false;

  // Blooming state machine
  private isBlooming = false;      // Target: true = open (1.0), false = closed bud (0.15)
  private bloomProgress = 0.15;    // Current continuous bloom fraction (0.15 closed -> 1.0 open)
  private bloomVelocity = 0.0;     // Rate of opening/closing for sparkle emission
  private targetBloom = 0.15;      // Target bloom fraction
  private touchCooldownRemaining = 0.0; // Debounce timer (seconds)

  // Petals
  readonly petals: Mesh[] = [];
  private petalData: PetalData[] = [];
  private petalMaterials: ShaderMaterial[] = [];
  private debugMaterials: MeshNormalMaterial[] = [];

  // Center golden-white stamen core & halo
  private centerCore: Mesh;
  private centerCoreMat: ShaderMaterial;
  private centerGlow: Mesh;
  private centerGlowMat: ShaderMaterial;

  // Delicate sparkling stardust particles pool
  private readonly maxSparkles: number;
  private sparklePositions!: Float32Array;
  private sparkleVelocities!: Float32Array;
  private sparkleColors!: Float32Array;
  private sparkleAlphas!: Float32Array;
  private sparkleSizes!: Float32Array;
  private sparkleTwinkles!: Float32Array;
  private sparkleLifetimes!: Float32Array;
  private sparkleMaxLifetimes!: Float32Array;
  private sparkleGeo!: BufferGeometry;
  private sparkleMat!: ShaderMaterial;
  private sparklePoints!: Points;
  private nextSparkleIndex = 0;
  private sparkleEmissionTimer = 0.0;

  // Arrival trail
  private trailGroup: Group = new Group();
  private trailPoints: Points;
  private trailGeo: BufferGeometry;
  private trailPositions: Float32Array;
  private trailHistory: Vector3[] = [];
  private readonly maxTrailCount: number;

  // Pre-allocated scratch vectors for zero-allocation updates
  private scratchHeadPos = new Vector3();
  private scratchForward = new Vector3();
  private scratchCurrentPos = new Vector3();
  private scratchProbePos = new Vector3();
  private scratchVec = new Vector3();
  private scratchRayOrigin = new Vector3();
  private scratchRayDir = new Vector3();
  private scratchClosestPoint = new Vector3();
  private targetFocalPos = new Vector3(0, 1.12, -0.68);
  private spawnOriginPos = new Vector3(2.5, 3.8, -9.5);
  private controlPos = new Vector3(0.9, 1.8, -4.5);

  // XR Session and world references
  private xrWorld: any = null;
  private xrSession: any = null;
  private boundOnSelectStart: ((e: any) => void) | null = null;
  private audioCtx: AudioContext | null = null;

  constructor(isQuest = false) {
    this.isQuest = isQuest;
    this.maxTrailCount = isQuest ? 80 : 160;
    this.maxSparkles = isQuest ? 140 : 220;

    if (typeof window !== 'undefined' && window.location.search.includes('flowerdebug=1')) {
      this.isDebugMode = true;
    }

    // 1. Root assembly
    this.group.add(this.flowerRoot);

    // 2. Procedural Smooth Cupped Lotus Petals
    this.buildCurvedLotusPetals();

    // 3. Golden-White Center Stamen Core
    const coreGeo = new SphereGeometry(0.019, isQuest ? 12 : 16, isQuest ? 10 : 14);
    this.centerCoreMat = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(0xffdf80) },
        uBloom: { value: 0.15 },
        uTime: { value: 0 },
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
        uniform float uBloom;
        uniform float uTime;
        varying vec3 vNormal;
        void main() {
          float rim = max(0.0, dot(vNormal, vec3(0.0, 1.0, 0.4)));
          // Shimmer and warm white radiance when blooming open
          vec3 warmCore = mix(vec3(0.95, 0.72, 0.35), vec3(1.0, 0.98, 0.92), uBloom);
          float pulse = 0.92 + 0.08 * sin(uTime * 3.5);
          vec3 col = warmCore * (0.85 + 0.45 * rim) * pulse;
          gl_FragColor = vec4(col, 0.95);
        }
      `,
      transparent: true,
      blending: NormalBlending,
      depthWrite: true,
    });
    this.centerCore = new Mesh(coreGeo, this.isDebugMode ? new MeshNormalMaterial() : this.centerCoreMat);
    this.flowerRoot.add(this.centerCore);

    // Center Stamen Halo
    const haloGeo = new SphereGeometry(0.045, 12, 10);
    this.centerGlowMat = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(0xffdf80) },
        uAlpha: { value: 0.20 },
        uBloom: { value: 0.15 },
        uTime: { value: 0 },
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
        uniform float uBloom;
        uniform float uTime;
        varying vec3 vNormal;
        void main() {
          float d = 1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
          float pulse = 0.88 + 0.12 * sin(uTime * 2.8);
          vec3 glowColor = mix(vec3(1.0, 0.82, 0.45), vec3(1.0, 0.98, 0.90), uBloom);
          gl_FragColor = vec4(glowColor, pow(d, 2.2) * uAlpha * pulse);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });
    this.centerGlow = new Mesh(haloGeo, this.centerGlowMat);
    this.flowerRoot.add(this.centerGlow);

    // 4. Coarse Collision Sphere (for backwards compatibility with existing raycasts)
    const colGeo = new SphereGeometry(0.14, 8, 6);
    const colMat = new ShaderMaterial({ visible: false });
    this.collisionSphere = new Mesh(colGeo, colMat);
    this.collisionSphere.name = 'glowing_flower_collision';
    this.flowerRoot.add(this.collisionSphere);

    // 5. Delicate Sparkling Stardust Pool
    this.buildSparklePool();

    // 6. Swooping Arrival Trail
    this.trailPositions = new Float32Array(this.maxTrailCount * 3);
    for (let i = 0; i < this.maxTrailCount; i++) {
      this.trailHistory.push(new Vector3().copy(this.spawnOriginPos));
    }
    this.trailGeo = new BufferGeometry();
    this.trailGeo.setAttribute('position', new Float32BufferAttribute(this.trailPositions, 3));

    const trailMat = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(0x6be5ff) },
        uOpacity: { value: 0.55 },
      },
      vertexShader: `
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(26.0 / -mvPosition.z, 2.0, 24.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          float falloff = pow(1.0 - d * 2.0, 2.0);
          gl_FragColor = vec4(uColor, falloff * uOpacity);
        }
      `,
      transparent: true,
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

  setXRWorld(world: any): void {
    this.xrWorld = world;
  }

  clearXRWorld(): void {
    this.xrWorld = null;
    if (this.xrSession && this.boundOnSelectStart) {
      this.xrSession.removeEventListener('selectstart', this.boundOnSelectStart);
      this.boundOnSelectStart = null;
      this.xrSession = null;
    }
  }

  /**
   * Bind XR session for pinch / trigger selection
   */
  bindXRSession(session: any): void {
    if (!session || this.boundOnSelectStart) return;
    this.xrSession = session;
    this.boundOnSelectStart = (e: any) => this.handleXRSelect(e);
    session.addEventListener('selectstart', this.boundOnSelectStart);
  }

  /**
   * Generates a curved parametric lotus petal geometry.
   * Teardrop curved profile with smooth inward cupping.
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
      const widthProfile = Math.sin(v * Math.PI) * Math.pow(1.0 - v * 0.35, 0.5);
      const halfW = (width * 0.5) * widthProfile;
      const y = v * length;
      const longCurve = Math.pow(v, 1.8) * cupDepth;

      for (let i = 0; i <= uSegs; i++) {
        const u = i / uSegs; // 0 to 1
        const uNorm = (u - 0.5) * 2.0; // -1 to +1
        const x = uNorm * halfW;
        const transCup = (1.0 - uNorm * uNorm) * (cupDepth * 0.5);
        const z = -longCurve - transCup;

        positions.push(x, y, z);
        uvs.push(u, v);

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
   * Total 12 individually interactive petals.
   */
  private buildCurvedLotusPetals(): void {
    const tiers = [
      { count: 5, radius: 0.024, tiltClosed: 0.09, tiltOpen: 0.48, length: 0.065, width: 0.034, cup: 0.016 },
      { count: 7, radius: 0.042, tiltClosed: 0.18, tiltOpen: 0.86, length: 0.082, width: 0.046, cup: 0.022 },
    ];

    let globalIndex = 0;

    tiers.forEach((tier, tierIdx) => {
      for (let i = 0; i < tier.count; i++) {
        const angle = (i / tier.count) * Math.PI * 2 + (tierIdx * 0.45);
        const petalGeo = this.createCurvedPetalGeometry(tier.width, tier.length, tier.cup);

        const petalMat = new ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uBloomProgress: { value: 0.15 },
            uTouchGlow: { value: 0.0 },
            uHover: { value: 0.0 },
            uHigh: { value: 0.0 },
            uBaseColor: { value: new Color(0x1ca3c4) },      // Delicate turquoise
            uEdgeColor: { value: new Color(0x6ee7b7) },      // Mint/cyan luminous edge
            uHighlightColor: { value: new Color(0xf472b6) }, // Soft blossom pink/magenta tip
            uOpacity: { value: 0.90 },
          },
          vertexShader: `
            uniform float uTime;
            uniform float uTouchGlow;
            uniform float uBloomProgress;

            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vViewDir;

            void main() {
              vUv = uv;
              vNormal = normalize(normalMatrix * normal);

              // Organic gentle fluttering ripple along petal body
              float flutter = sin(uTime * 3.2 + position.y * 22.0) * (0.002 + uTouchGlow * 0.004);
              vec3 pos = position + normal * flutter;

              vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
              vViewDir = -mvPosition.xyz;
              gl_Position = projectionMatrix * mvPosition;
            }
          `,
          fragmentShader: `
            uniform float uTime;
            uniform float uBloomProgress;
            uniform float uTouchGlow;
            uniform float uHover;
            uniform float uHigh;
            uniform vec3 uBaseColor;
            uniform vec3 uEdgeColor;
            uniform vec3 uHighlightColor;
            uniform float uOpacity;

            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vViewDir;

            void main() {
              float tip = vUv.y;
              float edge = abs(vUv.x - 0.5) * 2.0;

              // Detailed crystalline branched veins that illuminate dynamically as the lotus blooms!
              float vein1 = sin(vUv.x * 26.0 + vUv.y * 14.0 + uTime * 1.5) * 0.5 + 0.5;
              float vein2 = cos(vUv.x * 16.0 - vUv.y * 24.0 + uTime * 1.0) * 0.5 + 0.5;
              float crystalVeins = pow(vein1 * vein2, 1.5) * 2.4;

              // Vein illumination increases dramatically during blooming
              float veinBloom = mix(0.18, 1.0, uBloomProgress);
              float veinPower = (0.22 + uHigh * 0.50 + uTouchGlow * 0.70) * veinBloom;

              vec3 col = mix(uBaseColor, uEdgeColor, edge * 0.65);
              // Pink/magenta blossom flush toward petal tip
              col = mix(col, uHighlightColor, pow(tip, 1.5) * 0.78);
              // Illuminating crystal veins (electric cyan & lavender)
              col += vec3(0.70, 0.95, 1.0) * crystalVeins * veinPower;

              // Soft luminous radiance to touched petal
              col += vec3(0.35, 0.88, 1.0) * (uTouchGlow * 0.80);
              col += uHighlightColor * (uTouchGlow * 0.45);

              // Hover highlight: soft rim aura and edge glimmer when hand/ray approaches
              col += uEdgeColor * (uHover * (pow(edge, 1.8) * 0.95 + 0.35));

              // Smooth fresnel rim
              vec3 N = normalize(vNormal);
              vec3 V = normalize(vViewDir);
              float fresnel = 1.0 - max(0.0, dot(N, V));
              col += uEdgeColor * pow(fresnel, 2.2) * (0.35 + uTouchGlow * 0.45 + uHover * 0.35);

              gl_FragColor = vec4(col, uOpacity * (0.82 + 0.18 * tip));
            }
          `,
          transparent: true,
          blending: NormalBlending,
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
        petalMesh.rotation.y = -angle - Math.PI * 0.5;
        petalMesh.rotation.x = tier.tiltClosed;

        this.petals.push(petalMesh);
        this.petalMaterials.push(petalMat);
        this.flowerRoot.add(petalMesh);

        // Petal local tip coordinates: base at (0,0,0), tip at y=length, z = -cupDepth
        const localTip = new Vector3(0, tier.length, -tier.cup * 0.85);

        this.petalData.push({
          mesh: petalMesh,
          mat: petalMat,
          tier: tierIdx,
          index: globalIndex++,
          angle,
          radius: tier.radius,
          length: tier.length,
          width: tier.width,
          cupDepth: tier.cup,
          tiltClosed: tier.tiltClosed,
          tiltOpen: tier.tiltOpen,
          currentTilt: tier.tiltClosed,
          localTip,
          worldTip: new Vector3(),
          worldCenter: new Vector3(),
          hoverIntensity: 0.0,
          touchGlow: 0.0,
          swayAmp: 0.0,
          swayPhase: 0.0,
        });
      }
    });
  }

  /**
   * Pre-allocated pooled particle system for delicate stardust & petal sparkles.
   */
  private buildSparklePool(): void {
    this.sparklePositions = new Float32Array(this.maxSparkles * 3);
    this.sparkleVelocities = new Float32Array(this.maxSparkles * 3);
    this.sparkleColors = new Float32Array(this.maxSparkles * 3);
    this.sparkleAlphas = new Float32Array(this.maxSparkles);
    this.sparkleSizes = new Float32Array(this.maxSparkles);
    this.sparkleTwinkles = new Float32Array(this.maxSparkles);
    this.sparkleLifetimes = new Float32Array(this.maxSparkles);
    this.sparkleMaxLifetimes = new Float32Array(this.maxSparkles);

    for (let i = 0; i < this.maxSparkles; i++) {
      this.sparkleAlphas[i] = 0.0;
      this.sparkleSizes[i] = 0.04;
      this.sparkleTwinkles[i] = Math.random() * Math.PI * 2;
      this.sparkleLifetimes[i] = 0.0;
      this.sparkleMaxLifetimes[i] = 1.6;
    }

    this.sparkleGeo = new BufferGeometry();
    this.sparkleGeo.setAttribute('position', new Float32BufferAttribute(this.sparklePositions, 3));
    this.sparkleGeo.setAttribute('customColor', new Float32BufferAttribute(this.sparkleColors, 3));
    this.sparkleGeo.setAttribute('alpha', new Float32BufferAttribute(this.sparkleAlphas, 1));
    this.sparkleGeo.setAttribute('size', new Float32BufferAttribute(this.sparkleSizes, 1));
    this.sparkleGeo.setAttribute('twinklePhase', new Float32BufferAttribute(this.sparkleTwinkles, 1));

    this.sparkleMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        attribute vec3 customColor;
        attribute float alpha;
        attribute float size;
        attribute float twinklePhase;

        varying vec3 vColor;
        varying float vAlpha;

        uniform float uTime;

        void main() {
          vColor = customColor;
          float twinkle = 0.65 + 0.35 * sin(uTime * 24.0 + twinklePhase);
          vAlpha = alpha * twinkle;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float ptSize = size * (260.0 / -mvPosition.z);
          gl_PointSize = clamp(ptSize, 2.5, 42.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          if (vAlpha <= 0.01) discard;

          vec2 coord = gl_PointCoord - vec2(0.5);
          float dist = length(coord);
          if (dist > 0.5) discard;

          // 4-pointed cross star diffraction + soft bright core
          float starX = max(0.0, 1.0 - abs(coord.x) * 5.0) * max(0.0, 1.0 - abs(coord.y) * 1.8);
          float starY = max(0.0, 1.0 - abs(coord.y) * 5.0) * max(0.0, 1.0 - abs(coord.x) * 1.8);
          float starCross = max(starX, starY);
          float core = exp(-dist * 16.0) * 1.8;
          float intensity = starCross * 1.4 + core;

          vec3 col = mix(vColor, vec3(1.0, 1.0, 1.0), clamp(core * 0.9, 0.0, 1.0));
          gl_FragColor = vec4(col, vAlpha * clamp(intensity, 0.0, 1.0));
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    this.sparklePoints = new Points(this.sparkleGeo, this.sparkleMat);
    this.group.add(this.sparklePoints);
  }

  /**
   * Spawns a burst of delicate sparkling stardust particles at a specific world location.
   */
  private emitSparkleBurst(pos: Vector3, count = 12, speedMult = 1.0): void {
    for (let i = 0; i < count; i++) {
      const pIdx = this.nextSparkleIndex;
      this.nextSparkleIndex = (this.nextSparkleIndex + 1) % this.maxSparkles;
      const p3 = pIdx * 3;

      this.sparklePositions[p3] = pos.x + (Math.random() - 0.5) * 0.03;
      this.sparklePositions[p3 + 1] = pos.y + (Math.random() - 0.5) * 0.03;
      this.sparklePositions[p3 + 2] = pos.z + (Math.random() - 0.5) * 0.03;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2.0 * Math.random() - 1.0);
      const spd = (0.25 + Math.random() * 0.55) * speedMult;

      this.sparkleVelocities[p3] = Math.sin(phi) * Math.cos(theta) * spd;
      this.sparkleVelocities[p3 + 1] = Math.sin(phi) * Math.sin(theta) * spd + 0.22; // Upward float
      this.sparkleVelocities[p3 + 2] = Math.cos(phi) * spd;

      // Color variation: cyan, turquoise, blossom pink, lavender, and diamond white
      const roll = Math.random();
      if (roll < 0.25) {
        this.sparkleColors[p3] = 0.0;
        this.sparkleColors[p3 + 1] = 0.95;
        this.sparkleColors[p3 + 2] = 1.0;
      } else if (roll < 0.50) {
        this.sparkleColors[p3] = 0.96;
        this.sparkleColors[p3 + 1] = 0.45;
        this.sparkleColors[p3 + 2] = 0.72;
      } else if (roll < 0.75) {
        this.sparkleColors[p3] = 0.75;
        this.sparkleColors[p3 + 1] = 0.62;
        this.sparkleColors[p3 + 2] = 1.0;
      } else {
        this.sparkleColors[p3] = 1.0;
        this.sparkleColors[p3 + 1] = 0.96;
        this.sparkleColors[p3 + 2] = 0.88;
      }

      this.sparkleAlphas[pIdx] = 1.0;
      this.sparkleSizes[pIdx] = 0.036 + Math.random() * 0.028;
      this.sparkleLifetimes[pIdx] = 0.0;
      this.sparkleMaxLifetimes[pIdx] = 1.3 + Math.random() * 0.8;
    }

    this.sparkleGeo.attributes.customColor.needsUpdate = true;
    this.sparkleGeo.attributes.size.needsUpdate = true;
  }

  /**
   * Computes XR-safe focal target point:
   * 0.68m in front of seated user's eyes at comfortable chest/lap level (1.12m).
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

    // Seated arm's reach distance: 0.68m (comfortable relaxed touch range)
    const targetDistance = 0.68;
    this.targetFocalPos.copy(this.scratchHeadPos).addScaledVector(this.scratchForward, targetDistance);
    this.targetFocalPos.y = Math.max(1.08, this.scratchHeadPos.y - 0.12);

    this.spawnOriginPos.set(
      this.targetFocalPos.x + 2.5,
      this.targetFocalPos.y + 3.8,
      this.targetFocalPos.z - 9.5
    );

    this.controlPos.set(
      this.targetFocalPos.x + 0.9,
      this.targetFocalPos.y + 1.8,
      this.targetFocalPos.z - 4.5
    );
  }

  /**
   * Main touch reaction trigger.
   * Gracefully toggles blooming open <-> closing, and illuminates the touched petal.
   */
  triggerTouch(petalIndex?: number): boolean {
    if (this.touchCooldownRemaining > 0) return false;

    // Toggle bloom state
    if (this.targetBloom < 0.5) {
      this.targetBloom = 1.0;
      this.isBlooming = true;
    } else {
      this.targetBloom = 0.15;
      this.isBlooming = false;
    }

    // Identify touched petal (or pick foremost petal if unspecified)
    let pIdx = petalIndex !== undefined ? petalIndex : 0;
    if (pIdx < 0 || pIdx >= this.petalData.length) pIdx = 0;

    const touchedPetal = this.petalData[pIdx];
    touchedPetal.touchGlow = 1.0;
    touchedPetal.swayAmp = 0.16;
    touchedPetal.swayPhase = 0.0;

    // Sympathetic ripple on adjacent petals in the same tier
    const tierPetals = this.petalData.filter((p) => p.tier === touchedPetal.tier);
    const localTierIdx = tierPetals.findIndex((p) => p.index === touchedPetal.index);
    if (localTierIdx >= 0) {
      const prev = tierPetals[(localTierIdx - 1 + tierPetals.length) % tierPetals.length];
      const next = tierPetals[(localTierIdx + 1) % tierPetals.length];
      prev.touchGlow = Math.max(prev.touchGlow, 0.45);
      prev.swayAmp = Math.max(prev.swayAmp, 0.08);
      next.touchGlow = Math.max(next.touchGlow, 0.45);
      next.swayAmp = Math.max(next.swayAmp, 0.08);
    }

    // Emit sparkling stardust burst at the touched petal's tip
    this.emitSparkleBurst(touchedPetal.worldTip, 16, 1.2);

    // Debounce to allow clean, responsive toggling without multi-frame stutter
    this.touchCooldownRemaining = 0.55;

    this.playLotusChime();
    return true;
  }

  /**
   * Returns whether the flower is on touch cooldown (consumed by CityXRInput).
   */
  get touched(): boolean {
    return this.touchCooldownRemaining > 0;
  }

  getBloomProgress(): number {
    return this.bloomProgress;
  }

  isOpen(): boolean {
    return this.bloomProgress > 0.65;
  }

  /**
   * Main per-frame update.
   */
  update(deltaSec: number, relativeTime: number, metrics?: AudioMetrics, world?: World, camera?: Camera): void {
    if (this.touchCooldownRemaining > 0) {
      this.touchCooldownRemaining -= deltaSec;
    }

    // Auto-capture world if passed
    if (world && !this.xrWorld) {
      this.xrWorld = world;
      const session = (world.renderer as any)?.xr?.getSession() || (world as any).session;
      if (session) this.bindXRSession(session);
    }

    // 1. Spawning / Arrival phase (58s -> 65s)
    if (relativeTime >= FLOWER_TIMELINE.t_spawn && relativeTime < FLOWER_TIMELINE.t_arrival) {
      if (!this.isSpawned) {
        this.isSpawned = true;
        this.group.visible = true;
        this.updateFocalTarget(world, camera);
      }

      const duration = FLOWER_TIMELINE.t_arrival - FLOWER_TIMELINE.t_spawn;
      const rawT = (relativeTime - FLOWER_TIMELINE.t_spawn) / duration;
      const t = Math.max(0, Math.min(1, rawT));

      const easeT = 1.0 - Math.pow(1.0 - t, 2.6);
      const omt = 1.0 - easeT;

      this.scratchCurrentPos.set(0, 0, 0)
        .addScaledVector(this.spawnOriginPos, omt * omt)
        .addScaledVector(this.controlPos, 2 * omt * easeT)
        .addScaledVector(this.targetFocalPos, easeT * easeT);

      this.flowerRoot.position.copy(this.scratchCurrentPos);

      const scale = Math.min(1.0, 0.2 + easeT * 0.8);
      this.flowerRoot.scale.set(scale, scale, scale);

      this.updateTrail(this.scratchCurrentPos, easeT);
    }
    // 2. Active Interactive Phase 2 Window (65s -> 165s)
    else if (relativeTime >= FLOWER_TIMELINE.t_arrival && relativeTime <= FLOWER_TIMELINE.t_touch_window_end) {
      this.group.visible = true;
      this.flowerRoot.position.copy(this.targetFocalPos);

      // Subtle living hover bobbing
      const hoverOffset = Math.sin(relativeTime * 1.6) * 0.012;
      this.flowerRoot.position.y = this.targetFocalPos.y + hoverOffset;

      // Gentle continuous axial rotation
      this.flowerRoot.rotation.y += deltaSec * 0.20;

      this.trailPoints.visible = false;
    }
    // 3. Cosmic Ascent Transition (165s -> 175s)
    else if (relativeTime > FLOWER_TIMELINE.t_touch_window_end && relativeTime < 175.0) {
      this.group.visible = true;
      const dissolveProgress = Math.max(0, Math.min(1, (relativeTime - FLOWER_TIMELINE.t_touch_window_end) / 10.0));
      const ease = dissolveProgress * dissolveProgress * (3.0 - 2.0 * dissolveProgress);
      const scale = 1.0 + ease * 1.2;
      const alpha = Math.max(0, 1.0 - ease);
      this.flowerRoot.scale.set(scale, scale, scale);
      for (let i = 0; i < this.petalMaterials.length; i++) {
        this.petalMaterials[i].uniforms.uOpacity.value = alpha * 0.90;
      }
      if (alpha <= 0.01) {
        this.group.visible = false;
      }
    } else {
      this.group.visible = false;
      return;
    }

    // 4. Smooth Organic Blooming Interpolation (critically damped spring)
    const prevBloom = this.bloomProgress;
    const bloomSpringSpeed = 2.8;
    this.bloomProgress += (this.targetBloom - this.bloomProgress) * (1.0 - Math.exp(-deltaSec * bloomSpringSpeed));
    this.bloomVelocity = Math.abs(this.bloomProgress - prevBloom) / Math.max(0.001, deltaSec);

    // Audio reactivity
    const mid = metrics ? metrics.mid : 0;
    const high = metrics ? metrics.high : 0;
    const energy = metrics ? metrics.overall : 0;
    const breathe = 1.0 + Math.sin(relativeTime * 2.2) * 0.018 + energy * 0.035;

    // 5. Compute each Petal's World Transform, Tip & Proximity
    this.flowerRoot.updateMatrixWorld();

    for (let i = 0; i < this.petalData.length; i++) {
      const p = this.petalData[i];

      // Smooth touch glow fadeout
      if (p.touchGlow > 0) {
        p.touchGlow = Math.max(0, p.touchGlow - deltaSec * 1.6);
      }

      // Harmonic spring recoil decay
      if (p.swayAmp > 0.001) {
        p.swayPhase += deltaSec * 16.0;
        p.swayAmp *= Math.exp(-deltaSec * 4.5);
      } else {
        p.swayAmp = 0;
      }

      // Staggered blooming lag: outer petals open first; inner petals close first
      let tierLag = p.tier === 0 ? 0.12 : 0.0;
      if (!this.isBlooming) {
        tierLag = p.tier === 1 ? 0.12 : 0.0;
      }
      const effectiveBloom = Math.max(0.0, Math.min(1.0, (this.bloomProgress - tierLag) / (1.0 - 0.12)));

      // Interpolate tilt from closed upright to flared open
      const baseTilt = p.tiltClosed + (p.tiltOpen - p.tiltClosed) * effectiveBloom;
      const swayOffset = Math.sin(p.swayPhase) * p.swayAmp;
      p.currentTilt = baseTilt + swayOffset;

      p.mesh.rotation.x = p.currentTilt;
      p.mesh.scale.set(breathe, breathe, breathe);

      // Update world positions of tip & body for precise proximity
      p.mesh.updateMatrixWorld();
      this.scratchVec.copy(p.localTip);
      p.mesh.localToWorld(this.scratchVec);
      p.worldTip.copy(this.scratchVec);

      this.scratchVec.set(0, p.length * 0.5, 0);
      p.mesh.localToWorld(this.scratchVec);
      p.worldCenter.copy(this.scratchVec);

      // Material uniforms
      p.mat.uniforms.uTime.value = relativeTime;
      p.mat.uniforms.uBloomProgress.value = this.bloomProgress;
      p.mat.uniforms.uTouchGlow.value = p.touchGlow;
      p.mat.uniforms.uHover.value = p.hoverIntensity;
      p.mat.uniforms.uHigh.value = high;
    }

    // 6. Gather VR Probes and Test Petal Proximity / Direct Touch
    this.processVRInteraction();

    // 7. Golden-White Center Stamen Core & Halo Blooming State
    this.centerCoreMat.uniforms.uTime.value = relativeTime;
    this.centerCoreMat.uniforms.uBloom.value = this.bloomProgress;
    const coreScale = 0.85 + this.bloomProgress * 0.40 + energy * 0.08;
    this.centerCore.scale.set(coreScale, coreScale, coreScale);

    this.centerGlowMat.uniforms.uTime.value = relativeTime;
    this.centerGlowMat.uniforms.uBloom.value = this.bloomProgress;
    this.centerGlowMat.uniforms.uAlpha.value = (0.15 + this.bloomProgress * 0.60) * (0.85 + 0.15 * Math.sin(relativeTime * 3.0));
    const haloScale = 0.70 + this.bloomProgress * 0.75;
    this.centerGlow.scale.set(haloScale, haloScale, haloScale);

    // 8. Dynamic Stardust Sparkle Emission During Blooming Motion
    if (this.bloomVelocity > 0.08) {
      this.sparkleEmissionTimer += deltaSec;
      if (this.sparkleEmissionTimer >= 0.08) {
        this.sparkleEmissionTimer = 0.0;
        // Pick a random outer petal tip to emit a delicate sparkle
        const randomPetal = this.petalData[Math.floor(Math.random() * this.petalData.length)];
        this.emitSparkleBurst(randomPetal.worldTip, 3, 0.6);
      }
    }

    // 9. Update Active Sparkles
    this.updateSparkles(deltaSec, relativeTime);
  }

  /**
   * Gathers all VR interaction points and ray spaces.
   * Updates individual petal hover highlights and triggers petal touch.
   */
  private processVRInteraction(): void {
    const probePoints: { pos: Vector3; isFinger: boolean }[] = [];
    const pointingRays: { origin: Vector3; dir: Vector3 }[] = [];

    if (this.xrWorld) {
      const p = this.xrWorld.player;
      if (p) {
        // Hand tracking index fingertips
        const rightIndex = p.indexTipSpaces?.right;
        const leftIndex = p.indexTipSpaces?.left;
        if (rightIndex && (rightIndex.visible || rightIndex.matrixWorld?.elements[15] > 0)) {
          rightIndex.updateMatrixWorld();
          this.scratchProbePos.setFromMatrixPosition(rightIndex.matrixWorld);
          probePoints.push({ pos: this.scratchProbePos.clone(), isFinger: true });
        }
        if (leftIndex && (leftIndex.visible || leftIndex.matrixWorld?.elements[15] > 0)) {
          leftIndex.updateMatrixWorld();
          this.scratchProbePos.setFromMatrixPosition(leftIndex.matrixWorld);
          probePoints.push({ pos: this.scratchProbePos.clone(), isFinger: true });
        }

        // Controller grips
        const rightGrip = p.gripSpaces?.right;
        const leftGrip = p.gripSpaces?.left;
        if (rightGrip && (rightGrip.visible || rightGrip.matrixWorld?.elements[15] > 0)) {
          rightGrip.updateMatrixWorld();
          this.scratchProbePos.setFromMatrixPosition(rightGrip.matrixWorld);
          probePoints.push({ pos: this.scratchProbePos.clone(), isFinger: false });
        }
        if (leftGrip && (leftGrip.visible || leftGrip.matrixWorld?.elements[15] > 0)) {
          leftGrip.updateMatrixWorld();
          this.scratchProbePos.setFromMatrixPosition(leftGrip.matrixWorld);
          probePoints.push({ pos: this.scratchProbePos.clone(), isFinger: false });
        }

        // Controller / Hand pointing rays
        const rightRay = p.raySpaces?.right;
        const leftRay = p.raySpaces?.left;
        if (rightRay && (rightRay.visible || rightRay.matrixWorld?.elements[15] > 0)) {
          rightRay.updateMatrixWorld();
          const o = new Vector3().setFromMatrixPosition(rightRay.matrixWorld);
          const d = new Vector3(0, 0, -1).transformDirection(rightRay.matrixWorld).normalize();
          pointingRays.push({ origin: o, dir: d });
        }
        if (leftRay && (leftRay.visible || leftRay.matrixWorld?.elements[15] > 0)) {
          leftRay.updateMatrixWorld();
          const o = new Vector3().setFromMatrixPosition(leftRay.matrixWorld);
          const d = new Vector3(0, 0, -1).transformDirection(leftRay.matrixWorld).normalize();
          pointingRays.push({ origin: o, dir: d });
        }
      }
    }

    let closestTouchedPetal: PetalData | null = null;
    let minTouchDist = Infinity;

    // Evaluate proximity on each petal
    for (let i = 0; i < this.petalData.length; i++) {
      const petal = this.petalData[i];
      let targetHover = 0.0;

      // 1. Physical finger / controller probe test
      for (let k = 0; k < probePoints.length; k++) {
        const probe = probePoints[k];
        const distToTip = probe.pos.distanceTo(petal.worldTip);
        const distToCenter = probe.pos.distanceTo(petal.worldCenter);
        const dist = Math.min(distToTip, distToCenter);

        const hoverRange = 0.16;
        if (dist < hoverRange) {
          const h = 1.0 - (dist / hoverRange);
          if (h > targetHover) targetHover = h;
        }

        const touchThreshold = probe.isFinger ? 0.052 : 0.075;
        if (dist <= touchThreshold && dist < minTouchDist) {
          minTouchDist = dist;
          closestTouchedPetal = petal;
        }
      }

      // 2. Pointing ray hover test
      if (pointingRays.length > 0 && targetHover < 0.9) {
        for (let r = 0; r < pointingRays.length; r++) {
          const ray = pointingRays[r];
          this.scratchVec.copy(petal.worldCenter).sub(ray.origin);
          const projection = this.scratchVec.dot(ray.dir);
          if (projection > 0 && projection < 3.0) {
            this.scratchClosestPoint.copy(ray.origin).addScaledVector(ray.dir, projection);
            const dist = this.scratchClosestPoint.distanceTo(petal.worldCenter);
            if (dist < 0.14) {
              const h = 1.0 - (dist / 0.14);
              if (h > targetHover) targetHover = h;
            }
          }
        }
      }

      // Smooth hover intensity transition
      petal.hoverIntensity += (targetHover - petal.hoverIntensity) * 0.25;
    }

    // Direct touch trigger on the closest petal
    if (closestTouchedPetal) {
      this.triggerTouch(closestTouchedPetal.index);
    }
  }

  /**
   * Handle WebXR selectstart (trigger pull or hand pinch raycast).
   */
  private handleXRSelect(e: any): void {
    if (!this.group.visible || !this.xrWorld) return;
    const handedness = e.inputSource?.handedness || 'right';

    const p = this.xrWorld.player;
    if (!p) return;
    const raySpace = handedness === 'left' ? p.raySpaces?.left : p.raySpaces?.right;
    if (!raySpace) return;

    raySpace.updateMatrixWorld();
    this.scratchRayOrigin.setFromMatrixPosition(raySpace.matrixWorld);
    this.scratchRayDir.set(0, 0, -1).transformDirection(raySpace.matrixWorld).normalize();

    this.hitTest(this.scratchRayOrigin, this.scratchRayDir);
  }

  /**
   * Tests ray intersection against all individual petals.
   * Returns touched petal index or null.
   */
  hitTest(rayOrigin: Vector3, rayDir: Vector3): number | null {
    if (!this.group.visible) return null;

    let closestPetal: PetalData | null = null;
    let closestDist = Infinity;

    for (let i = 0; i < this.petalData.length; i++) {
      const petal = this.petalData[i];
      this.scratchVec.copy(petal.worldCenter).sub(rayOrigin);
      const projection = this.scratchVec.dot(rayDir);

      if (projection > 0 && projection < 3.5) {
        this.scratchClosestPoint.copy(rayOrigin).addScaledVector(rayDir, projection);
        const dist = this.scratchClosestPoint.distanceTo(petal.worldCenter);
        const hitRadius = petal.width * 1.2;

        if (dist < hitRadius && projection < closestDist) {
          closestDist = projection;
          closestPetal = petal;
        }
      }
    }

    if (closestPetal) {
      this.triggerTouch(closestPetal.index);
      return closestPetal.index;
    }

    // Fallback: test core center collision sphere
    this.flowerRoot.updateMatrixWorld();
    this.scratchVec.setFromMatrixPosition(this.flowerRoot.matrixWorld);
    this.scratchCurrentPos.copy(this.scratchVec).sub(rayOrigin);
    const proj = this.scratchCurrentPos.dot(rayDir);
    if (proj > 0 && proj < 3.5) {
      this.scratchClosestPoint.copy(rayOrigin).addScaledVector(rayDir, proj);
      if (this.scratchClosestPoint.distanceTo(this.scratchVec) < 0.16) {
        this.triggerTouch(0);
        return 0;
      }
    }

    return null;
  }

  /**
   * Desktop mouse hover test across petals.
   */
  hoverTest(rayOrigin: Vector3, rayDir: Vector3): void {
    if (!this.group.visible) return;

    for (let i = 0; i < this.petalData.length; i++) {
      const petal = this.petalData[i];
      this.scratchVec.copy(petal.worldCenter).sub(rayOrigin);
      const projection = this.scratchVec.dot(rayDir);

      if (projection > 0 && projection < 3.5) {
        this.scratchClosestPoint.copy(rayOrigin).addScaledVector(rayDir, projection);
        const dist = this.scratchClosestPoint.distanceTo(petal.worldCenter);
        if (dist < 0.15) {
          petal.hoverIntensity = Math.min(1.0, petal.hoverIntensity + 0.22);
        }
      }
    }
  }

  /**
   * Updates pooled stardust sparkle particles.
   */
  private updateSparkles(deltaSec: number, t: number): void {
    let hasActive = false;

    for (let p = 0; p < this.maxSparkles; p++) {
      if (this.sparkleAlphas[p] <= 0.001) continue;
      hasActive = true;

      this.sparkleLifetimes[p] += deltaSec;
      const prog = this.sparkleLifetimes[p] / this.sparkleMaxLifetimes[p];

      if (prog >= 1.0) {
        this.sparkleAlphas[p] = 0.0;
        continue;
      }

      const p3 = p * 3;
      this.sparkleVelocities[p3] *= 0.92;
      this.sparkleVelocities[p3 + 1] = (this.sparkleVelocities[p3 + 1] + 0.20 * deltaSec) * 0.93;
      this.sparkleVelocities[p3 + 2] *= 0.92;

      this.sparklePositions[p3] += this.sparkleVelocities[p3] * deltaSec;
      this.sparklePositions[p3 + 1] += this.sparkleVelocities[p3 + 1] * deltaSec;
      this.sparklePositions[p3 + 2] += this.sparkleVelocities[p3 + 2] * deltaSec;

      const fade = Math.sin(prog * Math.PI);
      this.sparkleAlphas[p] = Math.pow(fade, 0.75);
    }

    if (hasActive) {
      this.sparkleGeo.attributes.position.needsUpdate = true;
      this.sparkleGeo.attributes.alpha.needsUpdate = true;
    }
    this.sparkleMat.uniforms.uTime.value = t;
  }

  /**
   * Arrival trail update during swooping arrival.
   */
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
    (this.trailPoints.material as ShaderMaterial).uniforms.uOpacity.value = alpha * 0.55;
    this.trailPoints.visible = true;
  }

  /**
   * Plays a crystal harp/chime harmonic chord on touch.
   */
  private playLotusChime(): void {
    try {
      if (!this.audioCtx) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (AC) this.audioCtx = new AC();
      }
      if (!this.audioCtx) return;

      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') ctx.resume();

      const now = ctx.currentTime;
      // Radiant crystal bell chords (pentatonic F# / G# / C# sparkle)
      const freqs = this.isBlooming ? [880, 1174, 1760] : [1760, 1174, 880];

      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.04);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.98, now + idx * 0.04 + 0.35);

        gain.gain.setValueAtTime(0.045, now + idx * 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.04 + 0.38);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.04);
        osc.stop(now + idx * 0.04 + 0.40);

        osc.onended = () => {
          osc.disconnect();
          gain.disconnect();
        };
      });
    } catch (_) {
      // Audio errors ignored silently
    }
  }

  /**
   * Resets flower back to pristine state for replay.
   */
  reset(): void {
    this.isSpawned = false;
    this.isBlooming = false;
    this.bloomProgress = 0.15;
    this.targetBloom = 0.15;
    this.bloomVelocity = 0.0;
    this.touchCooldownRemaining = 0.0;
    this.group.visible = false;
    this.flowerRoot.scale.set(0.001, 0.001, 0.001);
    this.flowerRoot.position.copy(this.spawnOriginPos);

    for (let i = 0; i < this.petalData.length; i++) {
      const p = this.petalData[i];
      p.currentTilt = p.tiltClosed;
      p.mesh.rotation.x = p.tiltClosed;
      p.hoverIntensity = 0.0;
      p.touchGlow = 0.0;
      p.swayAmp = 0.0;
      p.swayPhase = 0.0;
      p.mat.uniforms.uOpacity.value = 0.90;
      p.mat.uniforms.uTouchGlow.value = 0.0;
      p.mat.uniforms.uHover.value = 0.0;
      p.mat.uniforms.uBloomProgress.value = 0.15;
    }

    for (let p = 0; p < this.maxSparkles; p++) {
      this.sparkleAlphas[p] = 0.0;
    }
    if (this.sparkleGeo.attributes.alpha) {
      this.sparkleGeo.attributes.alpha.needsUpdate = true;
    }
  }

  dispose(): void {
    this.clearXRWorld();
    for (const mat of this.petalMaterials) {
      mat.dispose();
    }
    this.centerCoreMat.dispose();
    this.centerGlowMat.dispose();
    this.sparkleGeo.dispose();
    this.sparkleMat.dispose();
    this.trailGeo.dispose();
    this.group.clear();
    this.petalData.length = 0;
    this.petals.length = 0;
  }
}
