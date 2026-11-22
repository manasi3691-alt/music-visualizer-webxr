/**
 * InfiniteBloomLotusField: Grand Finale for EXPERIENCE — "A Sky Full of Stars: The Infinite Bloom"
 *
 * Requirements:
 * 1. THE METEOR STORM:
 *    - Perseid-inspired meteor shower across the full 360° sky (100+ meteors).
 *    - Streaks from deep cosmic sky towards the ocean with luminous particle trails.
 *    - Varied sizes, speeds, brightness, and colors (brilliant white, icy blue, cyan, soft gold).
 * 2. METEOR-TO-LOTUS TRANSFORMATION (ONE METEOR = ONE LOTUS):
 *    - Meteor descends -> decelerates above water -> trail converges into core ->
 *      becomes luminous orb -> transforms into closed lotus bud -> petals form.
 * 3. THE INFINITE LOTUS FIELD:
 *    - Dozens of floating lotuses across the cosmic ocean (0.55m to 28m distance).
 *    - Translucent cyan, turquoise, lavender, violet, soft pink, and moonlight-white petals.
 *    - Gentle water bobbing and ocean reflections.
 * 4. EVERY LOTUS IS INDEPENDENTLY INTERACTIVE:
 *    - Reuses Phase 2 lotus geometry (6 inner + 8 outer curved petals, individual base pivots and hinges).
 *    - Starts completely closed.
 *    - Opens when touched/selected; closes when touched/selected again.
 *    - Individually animated petals using smooth organic bloom interpolation.
 *    - Supports Meta Quest 3S hand tracking, Touch controllers, and desktop mouse.
 *    - Opening one flower does NOT affect any other flower.
 * 5. THE FINAL CINEMATIC MOMENT:
 *    - Grand hero meteor descends at ~236s directly in front of the seated user.
 *    - Transforms into special central lotus at (0, 0.10, -0.85).
 *    - At 250s (outro release downbeat), it slowly blooms, sending a wave of light across the ocean.
 *    - Surrounding flowers pulse in response; environment settles into serene cosmic lotus ocean.
 * 6. ZERO PER-FRAME ALLOCATIONS & QUEST 3S OPTIMIZATION:
 *    - InstancedMesh for petals (single draw call for all inner petals, single draw call for all outer petals).
 *    - InstancedBufferAttribute for per-flower bloom progress, touch glow, and color tint.
 */

import {
  Group,
  Mesh,
  Points,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Color,
  Matrix4,
  Quaternion,
  AdditiveBlending,
  DoubleSide,
  World,
  Camera,
} from '@iwsdk/core';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export interface FlowerData {
  id: number;
  worldPos: Vector3;
  baseY: number;
  rotationY: number;
  scale: number;
  baseColor: Color;
  edgeColor: Color;
  highlightColor: Color;

  // Lifecycle state
  lifecycle: 'inactive' | 'meteor_fall' | 'meteor_converge' | 'bud_form' | 'active_lotus';
  meteorProgress: number; // 0 to 1
  convergeProgress: number; // 0 to 1
  budFormProgress: number; // 0 to 1

  // Meteor trajectory
  meteorStartPos: Vector3;
  meteorControlPos: Vector3;
  meteorTargetPos: Vector3;
  meteorSpawnTime: number;
  meteorFallDuration: number;
  meteorCurrentPos: Vector3;
  isHero: boolean;

  // Blooming state (Independent per flower!)
  isBlooming: boolean;
  bloomProgress: number; // 0.0 (closed bud) -> 1.0 (fully open)
  targetBloom: number; // 0.0 or 1.0
  bloomVelocity: number;
  touchCooldown: number;
  touchGlow: number;
  waveGlowPulse: number;

  // Collider
  colliderRadius: number;
}

export class InfiniteBloomLotusField {
  readonly group: Group = new Group();

  private isQuest: boolean;
  private flowers: FlowerData[] = [];
  private heroFlowerIndex = -1;
  private readonly flowerCount: number;

  // Shared Geometries
  private innerPetalGeo!: BufferGeometry;
  private outerPetalGeo!: BufferGeometry;
  private coreGeo!: BufferGeometry;
  private haloGeo!: BufferGeometry;

  // Instanced Meshes
  private instancedInnerPetals!: InstancedMesh;
  private instancedOuterPetals!: InstancedMesh;
  private instancedCores!: InstancedMesh;
  private instancedHalos!: InstancedMesh;

  // Per-instance attributes for Inner Petals
  private innerBloomAttr!: InstancedBufferAttribute;
  private innerTouchAttr!: InstancedBufferAttribute;

  // Per-instance attributes for Outer Petals
  private outerBloomAttr!: InstancedBufferAttribute;
  private outerTouchAttr!: InstancedBufferAttribute;

  // Per-instance attributes for Cores & Halos
  private coreBloomAttr!: InstancedBufferAttribute;
  private haloBloomAttr!: InstancedBufferAttribute;

  // Meteor Particles System
  private meteorPoints!: Points;
  private meteorGeo!: BufferGeometry;
  private meteorPositions!: Float32Array;
  private meteorColors!: Float32Array;
  private meteorSizes!: Float32Array;
  private meteorAlphas!: Float32Array;
  private readonly maxMeteorParticles: number;

  // Sparkle Burst Particle System
  private sparklePoints!: Points;
  private sparkleGeo!: BufferGeometry;
  private sparklePositions!: Float32Array;
  private sparkleVelocities!: Float32Array;
  private sparkleColors!: Float32Array;
  private sparkleAlphas!: Float32Array;
  private sparkleLifetimes!: Float32Array;
  private sparkleMaxLifetimes!: Float32Array;
  private readonly maxSparkles: number;
  private nextSparkleIndex = 0;

  // Cinematic Final Wave of Light
  private waveOrigin = new Vector3(0, 0.08, -0.85);
  private waveActive = false;
  private waveRadius = 0.0;
  private waveSpeed = 4.5; // m/s
  private waveStartTime = -1;

  // XR Session and world references
  private xrWorld: any = null;
  private xrSession: any = null;
  private boundOnSelectStart: ((e: any) => void) | null = null;
  private audioCtx: AudioContext | null = null;

  // Pre-allocated scratch objects for zero per-frame allocation
  private scratchMat4 = new Matrix4();
  private scratchFlowerMat4 = new Matrix4();
  private scratchBaseMat4 = new Matrix4();
  private scratchHingeMat4 = new Matrix4();
  private scratchPetalMat4 = new Matrix4();
  private scratchVec = new Vector3();
  private scratchVec2 = new Vector3();
  private scratchQuat = new Quaternion();
  private scratchRayOrigin = new Vector3();
  private scratchRayDir = new Vector3();
  private scratchClosestPoint = new Vector3();
  private scratchProbePos = new Vector3();

  constructor(isQuest = false) {
    this.isQuest = isQuest;
    this.flowerCount = isQuest ? 48 : 72;
    this.maxMeteorParticles = isQuest ? 480 : 960;
    this.maxSparkles = isQuest ? 280 : 500;

    this.group.name = 'InfiniteBloomLotusField';
    this.group.visible = false;

    this.createGeometries();
    this.initFlowers();
    this.buildInstancedMeshes();
    this.buildMeteorParticleSystem();
    this.buildSparkleParticleSystem();
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

  bindXRSession(session: any): void {
    if (!session || this.boundOnSelectStart) return;
    this.xrSession = session;
    this.boundOnSelectStart = (e: any) => this.handleXRSelect(e);
    session.addEventListener('selectstart', this.boundOnSelectStart);
  }

  /**
   * Generates a curved parametric lotus petal geometry matching GlowingFlower exactly.
   */
  private createCurvedPetalGeometry(width: number, length: number, cupDepth: number): BufferGeometry {
    const uSegs = 5;
    const vSegs = 8;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let j = 0; j <= vSegs; j++) {
      const v = j / vSegs;
      const widthProfile = Math.sin(v * Math.PI) * Math.pow(1.0 - v * 0.35, 0.5);
      const halfW = (width * 0.5) * widthProfile;
      const y = v * length;
      const longCurve = Math.pow(v, 1.8) * cupDepth;

      for (let i = 0; i <= uSegs; i++) {
        const u = i / uSegs;
        const uNorm = (u - 0.5) * 2.0;
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

  private createGeometries(): void {
    // Inner petals: 6 petals per flower
    this.innerPetalGeo = this.createCurvedPetalGeometry(0.034, 0.076, 0.016);
    // Outer petals: 8 petals per flower
    this.outerPetalGeo = this.createCurvedPetalGeometry(0.046, 0.092, 0.022);

    this.coreGeo = new SphereGeometry(0.010, this.isQuest ? 8 : 12, this.isQuest ? 6 : 10);
    this.haloGeo = new SphereGeometry(0.022, 8, 6);
  }

  /**
   * Initializes the field of flowers and their meteor trajectories.
   */
  private initFlowers(): void {
    const palette = [
      { base: 0x1ca3c4, edge: 0x6ee7b7, hi: 0xf472b6 }, // Cyan / Mint / Soft Pink
      { base: 0x0ea5e9, edge: 0x38bdf8, hi: 0xe879f9 }, // Azure / Turquoise / Lavender
      { base: 0x8b5cf6, edge: 0xc084fc, hi: 0x67e8f9 }, // Violet / Lavender / Cyan
      { base: 0x06b6d4, edge: 0xa7f3d0, hi: 0xfbcfe8 }, // Moonlight Cyan / Pale Jade / Rose
      { base: 0xec4899, edge: 0xf472b6, hi: 0xfef08a }, // Blossom Pink / Rose / Soft Gold
      { base: 0x38bdf8, edge: 0xfef08a, hi: 0xffffff }, // Sky Blue / Gold / Moonlight White
    ];

    // Seeded pseudo-random generator for deterministic, beautiful distribution
    let seed = 12345;
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    this.flowers = [];

    // Distribute flowers across 360 degrees around the seated user
    for (let i = 0; i < this.flowerCount; i++) {
      const isHero = i === 0; // Flower 0 is the special Grand Hero Lotus
      let dist: number;
      let angle: number;
      let worldPos: Vector3;
      let scale: number;
      let spawnTime: number;

      if (isHero) {
        this.heroFlowerIndex = 0;
        dist = 0.85;
        angle = -Math.PI * 0.5; // Directly in front (local -Z)
        worldPos = new Vector3(0, 0.08, -0.85);
        scale = 1.25;
        spawnTime = 236.0; // Grand hero meteor spawns at 236.0s
      } else {
        // Staggered rings:
        // Ring 1 (near arm's reach): 0.55m to 1.3m (12 flowers)
        // Ring 2 (mid-distance): 1.5m to 4.5m (20 flowers)
        // Ring 3 (outer field & horizon): 5.0m to 24.0m (remaining flowers)
        if (i <= 12) {
          dist = 0.55 + random() * 0.75;
          scale = 0.85 + random() * 0.25;
        } else if (i <= 32) {
          dist = 1.5 + random() * 3.0;
          scale = 0.95 + random() * 0.40;
        } else {
          dist = 5.0 + random() * 19.0;
          scale = 1.1 + random() * 0.80;
        }

        // 360-degree angle with natural jitter
        angle = (i / (this.flowerCount - 1)) * Math.PI * 2 + (random() - 0.5) * 0.45;
        // Keep clear of initial central Phase 2 lotus corridor (|x| < 0.15 && |z| < 0.80)
        let x = Math.cos(angle) * dist;
        let z = Math.sin(angle) * dist;
        if (Math.abs(x) < 0.22 && z > -0.9 && z < -0.4) {
          x += x >= 0 ? 0.35 : -0.35;
        }
        worldPos = new Vector3(x, 0.06 + (random() - 0.5) * 0.03, z);

        // Meteor spawn times staggered between 165.0s and 232.0s
        spawnTime = 166.0 + random() * 66.0;
      }

      // Meteor origin: high in the 360-degree cosmic sky (y = 14m to 26m)
      const skyAngle = angle + (random() - 0.5) * 0.6;
      const skyDist = Math.max(12.0, dist * 1.5 + 8.0);
      const skyHeight = isHero ? 20.0 : (14.0 + random() * 12.0);
      const meteorStartPos = new Vector3(
        Math.cos(skyAngle) * skyDist,
        skyHeight,
        Math.sin(skyAngle) * skyDist
      );

      // Curved arc trajectory control point
      const meteorControlPos = new Vector3(
        (meteorStartPos.x + worldPos.x) * 0.5 + (random() - 0.5) * 3.0,
        skyHeight * 0.45,
        (meteorStartPos.z + worldPos.z) * 0.5 + (random() - 0.5) * 3.0
      );

      const pal = palette[i % palette.length];

      this.flowers.push({
        id: i,
        worldPos: worldPos.clone(),
        baseY: worldPos.y,
        rotationY: random() * Math.PI * 2,
        scale,
        baseColor: new Color(isHero ? 0xffffff : pal.base),
        edgeColor: new Color(isHero ? 0xffea9f : pal.edge),
        highlightColor: new Color(isHero ? 0xffdf80 : pal.hi),
        lifecycle: 'inactive',
        meteorProgress: 0,
        convergeProgress: 0,
        budFormProgress: 0,
        meteorStartPos,
        meteorControlPos,
        meteorTargetPos: worldPos.clone(),
        meteorSpawnTime: spawnTime,
        meteorFallDuration: isHero ? 8.0 : (3.6 + random() * 2.2),
        meteorCurrentPos: meteorStartPos.clone(),
        isHero,
        isBlooming: false,
        bloomProgress: 0.0,
        targetBloom: 0.0,
        bloomVelocity: 0.0,
        touchCooldown: 0.0,
        touchGlow: 0.0,
        waveGlowPulse: 0.0,
        colliderRadius: 0.16 * scale,
      });
    }
  }

  private buildInstancedMeshes(): void {
    const totalInner = this.flowerCount * 6;
    const totalOuter = this.flowerCount * 8;
    const totalFlowers = this.flowerCount;

    // 1. Petal Material with Instanced Shader
    const createPetalShader = () => new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHigh: { value: 0 },
        uMasterAlpha: { value: 1.0 },
      },
      vertexShader: `
        attribute float aBloom;
        attribute float aTouch;
        attribute vec3 aBaseColor;
        attribute vec3 aEdgeColor;
        attribute vec3 aHiColor;

        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying float vBloom;
        varying float vTouch;
        varying vec3 vBaseColor;
        varying vec3 vEdgeColor;
        varying vec3 vHiColor;

        void main() {
          vUv = uv;
          vBloom = aBloom;
          vTouch = aTouch;
          vBaseColor = aBaseColor;
          vEdgeColor = aEdgeColor;
          vHiColor = aHiColor;

          // Surface flutter
          float flutter = sin(uTime * 3.0 + position.y * 22.0) * (0.0015 + aTouch * 0.003);
          vec3 pos = position + normal * flutter;

          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
          vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vViewDir = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uHigh;
        uniform float uMasterAlpha;

        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying float vBloom;
        varying float vTouch;
        varying vec3 vBaseColor;
        varying vec3 vEdgeColor;
        varying vec3 vHiColor;

        void main() {
          float tip = vUv.y;
          float edge = abs(vUv.x - 0.5) * 2.0;

          // Crystalline veins
          float vein1 = sin(vUv.x * 24.0 + vUv.y * 14.0 + uTime * 1.5) * 0.5 + 0.5;
          float vein2 = cos(vUv.x * 16.0 - vUv.y * 22.0 + uTime * 1.0) * 0.5 + 0.5;
          float crystalVeins = pow(vein1 * vein2, 1.6) * 2.2;
          float veinBloom = mix(0.18, 1.0, vBloom);

          // Fresnel pearlescent rim
          vec3 n = normalize(vNormal);
          vec3 v = normalize(vViewDir);
          float fresnel = pow(1.0 - max(0.0, dot(n, v)), 2.8);

          vec3 color = mix(vBaseColor, vEdgeColor, pow(edge, 1.6));
          color = mix(color, vHiColor, pow(tip, 1.8));

          // Veins & Fresnel additive boost
          color += vEdgeColor * crystalVeins * 0.35 * veinBloom;
          color += mix(vec3(0.5, 0.8, 1.0), vec3(1.0, 0.9, 0.7), vBloom) * fresnel * 0.75;
          color += vec3(1.0, 0.85, 0.6) * vTouch * 0.65;
          color += vec3(0.2, 0.4, 0.6) * uHigh * 0.15;

          float alpha = (0.75 + fresnel * 0.25 + vTouch * 0.2) * uMasterAlpha;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });

    // Inner Petals InstancedMesh
    const innerMat = createPetalShader();
    this.instancedInnerPetals = new InstancedMesh(this.innerPetalGeo, innerMat, totalInner);
    this.instancedInnerPetals.instanceMatrix.setUsage(35048); // Dynamic draw usage

    // Outer Petals InstancedMesh
    const outerMat = createPetalShader();
    this.instancedOuterPetals = new InstancedMesh(this.outerPetalGeo, outerMat, totalOuter);
    this.instancedOuterPetals.instanceMatrix.setUsage(35048);

    // Per-instance custom attributes
    const innerBloom = new Float32Array(totalInner);
    const innerTouch = new Float32Array(totalInner);
    const innerBaseColor = new Float32Array(totalInner * 3);
    const innerEdgeColor = new Float32Array(totalInner * 3);
    const innerHiColor = new Float32Array(totalInner * 3);

    const outerBloom = new Float32Array(totalOuter);
    const outerTouch = new Float32Array(totalOuter);
    const outerBaseColor = new Float32Array(totalOuter * 3);
    const outerEdgeColor = new Float32Array(totalOuter * 3);
    const outerHiColor = new Float32Array(totalOuter * 3);

    for (let f = 0; f < totalFlowers; f++) {
      const fl = this.flowers[f];
      // 6 inner petals
      for (let p = 0; p < 6; p++) {
        const idx = f * 6 + p;
        innerBaseColor[idx * 3] = fl.baseColor.r;
        innerBaseColor[idx * 3 + 1] = fl.baseColor.g;
        innerBaseColor[idx * 3 + 2] = fl.baseColor.b;
        innerEdgeColor[idx * 3] = fl.edgeColor.r;
        innerEdgeColor[idx * 3 + 1] = fl.edgeColor.g;
        innerEdgeColor[idx * 3 + 2] = fl.edgeColor.b;
        innerHiColor[idx * 3] = fl.highlightColor.r;
        innerHiColor[idx * 3 + 1] = fl.highlightColor.g;
        innerHiColor[idx * 3 + 2] = fl.highlightColor.b;
      }
      // 8 outer petals
      for (let p = 0; p < 8; p++) {
        const idx = f * 8 + p;
        outerBaseColor[idx * 3] = fl.baseColor.r;
        outerBaseColor[idx * 3 + 1] = fl.baseColor.g;
        outerBaseColor[idx * 3 + 2] = fl.baseColor.b;
        outerEdgeColor[idx * 3] = fl.edgeColor.r;
        outerEdgeColor[idx * 3 + 1] = fl.edgeColor.g;
        outerEdgeColor[idx * 3 + 2] = fl.edgeColor.b;
        outerHiColor[idx * 3] = fl.highlightColor.r;
        outerHiColor[idx * 3 + 1] = fl.highlightColor.g;
        outerHiColor[idx * 3 + 2] = fl.highlightColor.b;
      }
    }

    this.innerBloomAttr = new InstancedBufferAttribute(innerBloom, 1);
    this.innerTouchAttr = new InstancedBufferAttribute(innerTouch, 1);
    this.innerPetalGeo.setAttribute('aBloom', this.innerBloomAttr);
    this.innerPetalGeo.setAttribute('aTouch', this.innerTouchAttr);
    this.innerPetalGeo.setAttribute('aBaseColor', new InstancedBufferAttribute(innerBaseColor, 3));
    this.innerPetalGeo.setAttribute('aEdgeColor', new InstancedBufferAttribute(innerEdgeColor, 3));
    this.innerPetalGeo.setAttribute('aHiColor', new InstancedBufferAttribute(innerHiColor, 3));

    this.outerBloomAttr = new InstancedBufferAttribute(outerBloom, 1);
    this.outerTouchAttr = new InstancedBufferAttribute(outerTouch, 1);
    this.outerPetalGeo.setAttribute('aBloom', this.outerBloomAttr);
    this.outerPetalGeo.setAttribute('aTouch', this.outerTouchAttr);
    this.outerPetalGeo.setAttribute('aBaseColor', new InstancedBufferAttribute(outerBaseColor, 3));
    this.outerPetalGeo.setAttribute('aEdgeColor', new InstancedBufferAttribute(outerEdgeColor, 3));
    this.outerPetalGeo.setAttribute('aHiColor', new InstancedBufferAttribute(outerHiColor, 3));

    // 2. Cores & Halos
    const coreMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMasterAlpha: { value: 1.0 },
      },
      vertexShader: `
        attribute float aBloom;
        varying vec3 vNormal;
        varying float vBloom;
        void main() {
          vBloom = aBloom;
          vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uMasterAlpha;
        varying vec3 vNormal;
        varying float vBloom;
        void main() {
          float rim = max(0.0, dot(vNormal, vec3(0.0, 1.0, 0.4)));
          vec3 warmCore = mix(vec3(0.95, 0.72, 0.35), vec3(1.0, 0.98, 0.92), vBloom);
          float pulse = 0.92 + 0.08 * sin(uTime * 3.5);
          gl_FragColor = vec4(warmCore * (0.85 + 0.45 * rim) * pulse, 0.95 * uMasterAlpha);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.instancedCores = new InstancedMesh(this.coreGeo, coreMat, totalFlowers);
    this.instancedCores.instanceMatrix.setUsage(35048);

    const haloMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMasterAlpha: { value: 1.0 },
      },
      vertexShader: `
        attribute float aBloom;
        varying vec3 vNormal;
        varying float vBloom;
        void main() {
          vBloom = aBloom;
          vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uMasterAlpha;
        varying vec3 vNormal;
        varying float vBloom;
        void main() {
          float d = 1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
          float pulse = 0.88 + 0.12 * sin(uTime * 2.8);
          vec3 glowColor = mix(vec3(1.0, 0.82, 0.45), vec3(1.0, 0.98, 0.90), vBloom);
          gl_FragColor = vec4(glowColor, pow(d, 2.2) * (0.12 + vBloom * 0.65) * pulse * uMasterAlpha);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });
    this.instancedHalos = new InstancedMesh(this.haloGeo, haloMat, totalFlowers);
    this.instancedHalos.instanceMatrix.setUsage(35048);

    const coreBloom = new Float32Array(totalFlowers);
    const haloBloom = new Float32Array(totalFlowers);
    this.coreBloomAttr = new InstancedBufferAttribute(coreBloom, 1);
    this.haloBloomAttr = new InstancedBufferAttribute(haloBloom, 1);
    this.coreGeo.setAttribute('aBloom', this.coreBloomAttr);
    this.haloGeo.setAttribute('aBloom', this.haloBloomAttr);

    // Initial scale: 0 (invisible until spawned)
    this.scratchMat4.identity().scale(this.scratchVec.set(0, 0, 0));
    for (let i = 0; i < totalInner; i++) {
      this.instancedInnerPetals.setMatrixAt(i, this.scratchMat4);
    }
    for (let i = 0; i < totalOuter; i++) {
      this.instancedOuterPetals.setMatrixAt(i, this.scratchMat4);
    }
    for (let i = 0; i < totalFlowers; i++) {
      this.instancedCores.setMatrixAt(i, this.scratchMat4);
      this.instancedHalos.setMatrixAt(i, this.scratchMat4);
    }
    this.instancedInnerPetals.instanceMatrix.needsUpdate = true;
    this.instancedOuterPetals.instanceMatrix.needsUpdate = true;
    this.instancedCores.instanceMatrix.needsUpdate = true;
    this.instancedHalos.instanceMatrix.needsUpdate = true;

    this.group.add(this.instancedInnerPetals);
    this.group.add(this.instancedOuterPetals);
    this.group.add(this.instancedCores);
    this.group.add(this.instancedHalos);
  }

  private buildMeteorParticleSystem(): void {
    this.meteorPositions = new Float32Array(this.maxMeteorParticles * 3);
    this.meteorColors = new Float32Array(this.maxMeteorParticles * 3);
    this.meteorSizes = new Float32Array(this.maxMeteorParticles);
    this.meteorAlphas = new Float32Array(this.maxMeteorParticles);

    this.meteorGeo = new BufferGeometry();
    this.meteorGeo.setAttribute('position', new Float32BufferAttribute(this.meteorPositions, 3));
    this.meteorGeo.setAttribute('color', new Float32BufferAttribute(this.meteorColors, 3));
    this.meteorGeo.setAttribute('size', new Float32BufferAttribute(this.meteorSizes, 1));
    this.meteorGeo.setAttribute('alpha', new Float32BufferAttribute(this.meteorAlphas, 1));

    const meteorMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        attribute vec3 color;
        attribute float size;
        attribute float alpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(size / -mvPosition.z, 2.0, 36.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          float falloff = pow(1.0 - d * 2.0, 2.2);
          gl_FragColor = vec4(vColor, falloff * vAlpha);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    this.meteorPoints = new Points(this.meteorGeo, meteorMat);
    this.group.add(this.meteorPoints);
  }

  private buildSparkleParticleSystem(): void {
    this.sparklePositions = new Float32Array(this.maxSparkles * 3);
    this.sparkleVelocities = new Float32Array(this.maxSparkles * 3);
    this.sparkleColors = new Float32Array(this.maxSparkles * 3);
    this.sparkleAlphas = new Float32Array(this.maxSparkles);
    this.sparkleLifetimes = new Float32Array(this.maxSparkles);
    this.sparkleMaxLifetimes = new Float32Array(this.maxSparkles);

    this.sparkleGeo = new BufferGeometry();
    this.sparkleGeo.setAttribute('position', new Float32BufferAttribute(this.sparklePositions, 3));
    this.sparkleGeo.setAttribute('color', new Float32BufferAttribute(this.sparkleColors, 3));
    this.sparkleGeo.setAttribute('alpha', new Float32BufferAttribute(this.sparkleAlphas, 1));

    const sparkleMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        attribute vec3 color;
        attribute float alpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(24.0 / -mvPosition.z, 2.0, 22.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          float falloff = pow(1.0 - d * 2.0, 2.0);
          gl_FragColor = vec4(vColor, falloff * vAlpha);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    this.sparklePoints = new Points(this.sparkleGeo, sparkleMat);
    this.group.add(this.sparklePoints);
  }

  private emitSparkles(pos: Vector3, count: number, color: Color): void {
    for (let i = 0; i < count; i++) {
      const idx = this.nextSparkleIndex;
      this.nextSparkleIndex = (this.nextSparkleIndex + 1) % this.maxSparkles;

      const i3 = idx * 3;
      this.sparklePositions[i3] = pos.x + (Math.random() - 0.5) * 0.08;
      this.sparklePositions[i3 + 1] = pos.y + (Math.random() - 0.5) * 0.06;
      this.sparklePositions[i3 + 2] = pos.z + (Math.random() - 0.5) * 0.08;

      const speed = 0.25 + Math.random() * 0.55;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      this.sparkleVelocities[i3] = Math.sin(phi) * Math.cos(theta) * speed;
      this.sparkleVelocities[i3 + 1] = Math.cos(phi) * speed * 0.8 + 0.35;
      this.sparkleVelocities[i3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;

      this.sparkleColors[i3] = color.r;
      this.sparkleColors[i3 + 1] = color.g;
      this.sparkleColors[i3 + 2] = color.b;

      this.sparkleAlphas[idx] = 1.0;
      this.sparkleLifetimes[idx] = 0.0;
      this.sparkleMaxLifetimes[idx] = 0.85 + Math.random() * 0.55;
    }
  }

  private playChime(freqs: number[]): void {
    try {
      if (!this.audioCtx) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (AC) this.audioCtx = new AC();
      }
      if (!this.audioCtx) return;
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') ctx.resume();

      const now = ctx.currentTime;
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.03);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.98, now + idx * 0.03 + 0.35);

        gain.gain.setValueAtTime(0.04, now + idx * 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.03 + 0.38);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.03);
        osc.stop(now + idx * 0.03 + 0.40);
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
   * Triggers touch on a specific flower by id.
   * Toggles blooming open/closed independently.
   */
  triggerTouch(flowerId: number): boolean {
    if (flowerId < 0 || flowerId >= this.flowers.length) return false;
    const fl = this.flowers[flowerId];
    if (fl.lifecycle !== 'active_lotus' || fl.touchCooldown > 0) return false;

    fl.touchCooldown = 0.35; // debounce
    if (fl.targetBloom < 0.5) {
      fl.targetBloom = 1.0;
      fl.isBlooming = true;
      this.playChime([880, 1174, 1760]);
    } else {
      fl.targetBloom = 0.0;
      fl.isBlooming = false;
      this.playChime([1760, 1174, 880]);
    }

    fl.touchGlow = 1.0;
    this.emitSparkles(fl.worldPos, 18, fl.highlightColor);
    return true;
  }

  /**
   * Raycast hit test for controllers and desktop mouse.
   */
  hitTest(rayOrigin: Vector3, rayDir: Vector3): FlowerData | null {
    if (!this.group.visible) return null;

    let closestDist = Infinity;
    let closestFlower: FlowerData | null = null;

    for (let i = 0; i < this.flowers.length; i++) {
      const fl = this.flowers[i];
      if (fl.lifecycle !== 'active_lotus') continue;

      this.scratchVec.copy(fl.worldPos).sub(rayOrigin);
      const proj = this.scratchVec.dot(rayDir);
      if (proj > 0.2 && proj < 35.0) {
        this.scratchClosestPoint.copy(rayOrigin).addScaledVector(rayDir, proj);
        const dist = this.scratchClosestPoint.distanceTo(fl.worldPos);
        const hitThreshold = fl.colliderRadius * (fl.isBlooming ? 1.6 : 1.15);

        if (dist < hitThreshold && proj < closestDist) {
          closestDist = proj;
          closestFlower = fl;
        }
      }
    }

    if (closestFlower) {
      this.triggerTouch(closestFlower.id);
      return closestFlower;
    }
    return null;
  }

  /**
   * Hover test for desktop mouse cursor.
   */
  hoverTest(rayOrigin: Vector3, rayDir: Vector3): void {
    if (!this.group.visible) return;

    for (let i = 0; i < this.flowers.length; i++) {
      const fl = this.flowers[i];
      if (fl.lifecycle !== 'active_lotus') continue;

      this.scratchVec.copy(fl.worldPos).sub(rayOrigin);
      const proj = this.scratchVec.dot(rayDir);
      if (proj > 0.2 && proj < 30.0) {
        this.scratchClosestPoint.copy(rayOrigin).addScaledVector(rayDir, proj);
        if (this.scratchClosestPoint.distanceTo(fl.worldPos) < fl.colliderRadius * 1.5) {
          fl.touchGlow = Math.min(1.0, fl.touchGlow + 0.15);
        }
      }
    }
  }

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

  private processVRProximity(): void {
    if (!this.group.visible || !this.xrWorld) return;
    const p = this.xrWorld.player;
    if (!p) return;

    const probePoints: Vector3[] = [];

    // Hand tracking index fingertips
    const rightIndex = p.indexTipSpaces?.right;
    const leftIndex = p.indexTipSpaces?.left;
    if (rightIndex && (rightIndex.visible || rightIndex.matrixWorld?.elements[15] > 0)) {
      rightIndex.updateMatrixWorld();
      probePoints.push(new Vector3().setFromMatrixPosition(rightIndex.matrixWorld));
    }
    if (leftIndex && (leftIndex.visible || leftIndex.matrixWorld?.elements[15] > 0)) {
      leftIndex.updateMatrixWorld();
      probePoints.push(new Vector3().setFromMatrixPosition(leftIndex.matrixWorld));
    }

    // Controller grips
    const rightGrip = p.gripSpaces?.right;
    const leftGrip = p.gripSpaces?.left;
    if (rightGrip && (rightGrip.visible || rightGrip.matrixWorld?.elements[15] > 0)) {
      rightGrip.updateMatrixWorld();
      probePoints.push(new Vector3().setFromMatrixPosition(rightGrip.matrixWorld));
    }
    if (leftGrip && (leftGrip.visible || leftGrip.matrixWorld?.elements[15] > 0)) {
      leftGrip.updateMatrixWorld();
      probePoints.push(new Vector3().setFromMatrixPosition(leftGrip.matrixWorld));
    }

    for (let f = 0; f < this.flowers.length; f++) {
      const fl = this.flowers[f];
      if (fl.lifecycle !== 'active_lotus') continue;

      for (let i = 0; i < probePoints.length; i++) {
        const d = probePoints[i].distanceTo(fl.worldPos);
        if (d < fl.colliderRadius * 1.8) {
          fl.touchGlow = Math.min(1.0, fl.touchGlow + 0.25);
          if (d < fl.colliderRadius * 1.1) {
            this.triggerTouch(fl.id);
          }
        }
      }
    }
  }

  /**
   * Main per-frame update loop.
   */
  update(deltaSec: number, relativeTime: number, metrics?: AudioMetrics, world?: World, camera?: Camera): void {
    // Phase 3 active: relativeTime >= 165.0s
    if (relativeTime < 165.0) {
      if (this.group.visible) this.group.visible = false;
      return;
    }

    this.group.visible = true;

    const high = metrics ? metrics.high : 0;
    const mid = metrics ? metrics.mid : 0;
    const low = metrics ? metrics.low : 0;

    // Update material time uniforms
    (this.instancedInnerPetals.material as ShaderMaterial).uniforms.uTime.value = relativeTime;
    (this.instancedInnerPetals.material as ShaderMaterial).uniforms.uHigh.value = high;
    (this.instancedOuterPetals.material as ShaderMaterial).uniforms.uTime.value = relativeTime;
    (this.instancedOuterPetals.material as ShaderMaterial).uniforms.uHigh.value = high;
    (this.instancedCores.material as ShaderMaterial).uniforms.uTime.value = relativeTime;
    (this.instancedHalos.material as ShaderMaterial).uniforms.uTime.value = relativeTime;
    (this.meteorPoints.material as ShaderMaterial).uniforms.uTime.value = relativeTime;
    (this.sparklePoints.material as ShaderMaterial).uniforms.uTime.value = relativeTime;

    // 1. Check Final Wave of Light from Hero Lotus (relativeTime >= 250.0s)
    if (relativeTime >= 250.0) {
      if (!this.waveActive) {
        this.waveActive = true;
        this.waveStartTime = relativeTime;
        // Trigger Hero Lotus blooming automatically for the cinematic finale
        const heroFl = this.flowers[this.heroFlowerIndex];
        if (heroFl && heroFl.targetBloom < 0.5) {
          heroFl.targetBloom = 1.0;
          heroFl.isBlooming = true;
          this.emitSparkles(heroFl.worldPos, 35, new Color(0xffdf80));
          this.playChime([1174, 1480, 1760, 2349]);
        }
      }
      this.waveRadius = (relativeTime - this.waveStartTime) * this.waveSpeed;
    }

    // 2. Clear meteor particles buffer for this frame
    for (let p = 0; p < this.maxMeteorParticles; p++) {
      this.meteorAlphas[p] = 0.0;
    }
    let meteorParticleCount = 0;

    // 3. Update each flower lifecycle and transforms
    const innerBloomArr = this.innerBloomAttr.array as Float32Array;
    const innerTouchArr = this.innerTouchAttr.array as Float32Array;
    const outerBloomArr = this.outerBloomAttr.array as Float32Array;
    const outerTouchArr = this.outerTouchAttr.array as Float32Array;
    const coreBloomArr = this.coreBloomAttr.array as Float32Array;
    const haloBloomArr = this.haloBloomAttr.array as Float32Array;

    for (let f = 0; f < this.flowers.length; f++) {
      const fl = this.flowers[f];

      // Update cooldowns
      if (fl.touchCooldown > 0) fl.touchCooldown = Math.max(0, fl.touchCooldown - deltaSec);
      if (fl.touchGlow > 0) fl.touchGlow = Math.max(0, fl.touchGlow - deltaSec * 1.5);
      if (fl.waveGlowPulse > 0) fl.waveGlowPulse = Math.max(0, fl.waveGlowPulse - deltaSec * 1.2);

      // Wave of light response: when wave reaches flower distance, pulse!
      if (this.waveActive && fl.lifecycle === 'active_lotus' && fl.id !== this.heroFlowerIndex) {
        const d = fl.worldPos.distanceTo(this.waveOrigin);
        if (Math.abs(d - this.waveRadius) < 0.75 && fl.waveGlowPulse <= 0.01) {
          fl.waveGlowPulse = 1.0;
          fl.touchGlow = 0.85;
          this.emitSparkles(fl.worldPos, 8, fl.highlightColor);
        }
      }

      // Lifecycle progression:
      // (a) Not spawned yet
      if (relativeTime < fl.meteorSpawnTime) {
        fl.lifecycle = 'inactive';
        this.scratchMat4.identity().scale(this.scratchVec.set(0, 0, 0));
        this.hideFlowerInstances(f);
        continue;
      }

      const timeSinceSpawn = relativeTime - fl.meteorSpawnTime;

      // (b) Meteor Falling (Stage 1 & 2)
      if (timeSinceSpawn < fl.meteorFallDuration) {
        fl.lifecycle = 'meteor_fall';
        fl.meteorProgress = timeSinceSpawn / fl.meteorFallDuration;
        const t = fl.meteorProgress;

        // Quadratic bezier arc trajectory
        const omt = 1.0 - t;
        fl.meteorCurrentPos.set(0, 0, 0)
          .addScaledVector(fl.meteorStartPos, omt * omt)
          .addScaledVector(fl.meteorControlPos, 2 * omt * t)
          .addScaledVector(fl.meteorTargetPos, t * t);

        // Meteor particle head and luminous tail
        const tailSegments = fl.isHero ? 14 : 7;
        for (let s = 0; s < tailSegments && meteorParticleCount < this.maxMeteorParticles; s++) {
          const sT = Math.max(0, t - s * 0.022);
          const sOmt = 1.0 - sT;
          const pIdx = meteorParticleCount++;
          const p3 = pIdx * 3;

          this.meteorPositions[p3] = fl.meteorStartPos.x * sOmt * sOmt + fl.meteorControlPos.x * 2 * sOmt * sT + fl.meteorTargetPos.x * sT * sT;
          this.meteorPositions[p3 + 1] = fl.meteorStartPos.y * sOmt * sOmt + fl.meteorControlPos.y * 2 * sOmt * sT + fl.meteorTargetPos.y * sT * sT;
          this.meteorPositions[p3 + 2] = fl.meteorStartPos.z * sOmt * sOmt + fl.meteorControlPos.z * 2 * sOmt * sT + fl.meteorTargetPos.z * sT * sT;

          const fade = 1.0 - s / tailSegments;
          this.meteorColors[p3] = fl.edgeColor.r * fade + (fl.isHero ? 0.3 : 0.0);
          this.meteorColors[p3 + 1] = fl.edgeColor.g * fade + (fl.isHero ? 0.3 : 0.0);
          this.meteorColors[p3 + 2] = fl.edgeColor.b * fade + (fl.isHero ? 0.3 : 0.0);
          this.meteorSizes[pIdx] = (fl.isHero ? 50.0 : 32.0) * fade;
          this.meteorAlphas[pIdx] = fade * 0.95;
        }

        this.hideFlowerInstances(f);
        continue;
      }

      const timeSinceLand = timeSinceSpawn - fl.meteorFallDuration;

      // (c) Meteor Particles Converging into Orb (Stage 3 & 4: 0.0s to 1.4s)
      if (timeSinceLand < 1.4) {
        fl.lifecycle = 'meteor_converge';
        fl.convergeProgress = timeSinceLand / 1.4;
        const cp = fl.convergeProgress;

        // Converging particles swirling inward to orb center
        const convCount = fl.isHero ? 16 : 8;
        for (let c = 0; c < convCount && meteorParticleCount < this.maxMeteorParticles; c++) {
          const pIdx = meteorParticleCount++;
          const p3 = pIdx * 3;
          const theta = c * (Math.PI * 2 / convCount) + cp * 12.0;
          const r = (1.0 - cp) * (fl.isHero ? 1.2 : 0.65);
          this.meteorPositions[p3] = fl.worldPos.x + Math.cos(theta) * r;
          this.meteorPositions[p3 + 1] = fl.worldPos.y + Math.sin(theta * 2.0) * r * 0.4 + (1.0 - cp) * 0.25;
          this.meteorPositions[p3 + 2] = fl.worldPos.z + Math.sin(theta) * r;

          this.meteorColors[p3] = fl.highlightColor.r;
          this.meteorColors[p3 + 1] = fl.highlightColor.g;
          this.meteorColors[p3 + 2] = fl.highlightColor.b;
          this.meteorSizes[pIdx] = (fl.isHero ? 42.0 : 26.0) * cp;
          this.meteorAlphas[pIdx] = (1.0 - cp * 0.5);
        }

        // Orb emerges at center
        const orbScale = cp * fl.scale * 1.5;
        this.scratchMat4.identity().compose(
          fl.worldPos,
          this.scratchQuat.identity(),
          this.scratchVec.set(orbScale, orbScale, orbScale)
        );
        this.instancedCores.setMatrixAt(f, this.scratchMat4);
        this.instancedHalos.setMatrixAt(f, this.scratchMat4);
        coreBloomArr[f] = cp;
        haloBloomArr[f] = cp;

        // Petals still hidden
        this.hideFlowerPetals(f);
        continue;
      }

      // (d) Orb Transforms into Closed Lotus Bud (Stage 5 & 6: 1.4s to 3.0s)
      if (timeSinceLand < 3.0) {
        fl.lifecycle = 'bud_form';
        fl.budFormProgress = (timeSinceLand - 1.4) / 1.6;
      } else {
        fl.lifecycle = 'active_lotus';
      }

      // (e) Active Lotus / Bud Form:
      // Organic bloom interpolation (critically damped spring)
      const prevBloom = fl.bloomProgress;
      const bloomSpeed = 1.9;
      fl.bloomProgress += (fl.targetBloom - fl.bloomProgress) * (1.0 - Math.exp(-deltaSec * bloomSpeed));
      fl.bloomVelocity = Math.abs(fl.bloomProgress - prevBloom) / Math.max(0.001, deltaSec);

      // Subtle water bobbing on ocean surface
      const bobbing = Math.sin(relativeTime * 1.6 + fl.worldPos.x * 2.0 + fl.worldPos.z * 1.8) * 0.012;
      this.scratchVec.set(fl.worldPos.x, fl.baseY + bobbing, fl.worldPos.z);

      // Growth scale during bud formation (0.35 to 1.0)
      const currentScale = fl.scale * (fl.lifecycle === 'bud_form' ? (0.35 + fl.budFormProgress * 0.65) : 1.0);

      // Flower root matrix
      this.scratchQuat.setFromAxisAngle(this.scratchVec2.set(0, 1, 0), fl.rotationY);
      this.scratchFlowerMat4.compose(this.scratchVec, this.scratchQuat, this.scratchVec2.set(currentScale, currentScale, currentScale));

      // Core & Halo transforms
      const coreScale = (0.80 + fl.bloomProgress * 0.40) * currentScale;
      this.scratchMat4.identity().compose(this.scratchVec, this.scratchQuat, this.scratchVec2.set(coreScale, coreScale, coreScale));
      this.instancedCores.setMatrixAt(f, this.scratchMat4);

      const haloScale = (0.75 + fl.bloomProgress * 0.85 + fl.touchGlow * 0.3) * currentScale;
      this.scratchMat4.identity().compose(this.scratchVec, this.scratchQuat, this.scratchVec2.set(haloScale, haloScale, haloScale));
      this.instancedHalos.setMatrixAt(f, this.scratchMat4);

      coreBloomArr[f] = fl.bloomProgress + fl.touchGlow * 0.5 + fl.waveGlowPulse * 0.6;
      haloBloomArr[f] = fl.bloomProgress + fl.touchGlow * 0.7 + fl.waveGlowPulse * 0.8;

      // Petals bloom radial sequence:
      // Inner petals open first (0.0 -> 0.70)
      // Outer petals open second (0.22 -> 1.0)
      const b = fl.bloomProgress;
      const uInner = Math.max(0.0, Math.min(1.0, b / 0.70));
      const smoothInner = uInner * uInner * (3.0 - 2.0 * uInner);
      const uOuter = Math.max(0.0, Math.min(1.0, (b - 0.22) / (1.0 - 0.22)));
      const smoothOuter = uOuter * uOuter * (3.0 - 2.0 * uOuter);

      const effectiveTouchGlow = fl.touchGlow + fl.waveGlowPulse * 0.8;

      // 6 Inner Petals
      const innerTiers = { count: 6, radius: 0.012, tiltClosed: -0.06, tiltOpen: 0.92 };
      for (let p = 0; p < 6; p++) {
        const instIdx = f * 6 + p;
        const angle = (p / innerTiers.count) * Math.PI * 2;
        const tilt = innerTiers.tiltClosed + (innerTiers.tiltOpen - innerTiers.tiltClosed) * smoothInner;

        this.scratchBaseMat4.identity().compose(
          this.scratchVec2.set(Math.cos(angle) * innerTiers.radius, 0, Math.sin(angle) * innerTiers.radius),
          this.scratchQuat.setFromAxisAngle(this.scratchVec2.set(0, 1, 0), Math.PI * 0.5 - angle),
          this.scratchVec2.set(1, 1, 1)
        );

        this.scratchHingeMat4.identity().makeRotationX(tilt);
        this.scratchPetalMat4.multiplyMatrices(this.scratchFlowerMat4, this.scratchBaseMat4);
        this.scratchPetalMat4.multiply(this.scratchHingeMat4);
        this.instancedInnerPetals.setMatrixAt(instIdx, this.scratchPetalMat4);

        innerBloomArr[instIdx] = fl.bloomProgress;
        innerTouchArr[instIdx] = effectiveTouchGlow;
      }

      // 8 Outer Petals
      const outerTiers = { count: 8, radius: 0.020, tiltClosed: -0.08, tiltOpen: 1.34 };
      for (let p = 0; p < 8; p++) {
        const instIdx = f * 8 + p;
        const angle = (p / outerTiers.count) * Math.PI * 2 + 0.45;
        const tilt = outerTiers.tiltClosed + (outerTiers.tiltOpen - outerTiers.tiltClosed) * smoothOuter;

        this.scratchBaseMat4.identity().compose(
          this.scratchVec2.set(Math.cos(angle) * outerTiers.radius, 0, Math.sin(angle) * outerTiers.radius),
          this.scratchQuat.setFromAxisAngle(this.scratchVec2.set(0, 1, 0), Math.PI * 0.5 - angle),
          this.scratchVec2.set(1, 1, 1)
        );

        this.scratchHingeMat4.identity().makeRotationX(tilt);
        this.scratchPetalMat4.multiplyMatrices(this.scratchFlowerMat4, this.scratchBaseMat4);
        this.scratchPetalMat4.multiply(this.scratchHingeMat4);
        this.instancedOuterPetals.setMatrixAt(instIdx, this.scratchPetalMat4);

        outerBloomArr[instIdx] = fl.bloomProgress;
        outerTouchArr[instIdx] = effectiveTouchGlow;
      }

      // Emit gentle sparkles while actively blooming
      if (fl.bloomVelocity > 0.12 && Math.random() < 0.22) {
        this.emitSparkles(fl.worldPos, 2, fl.highlightColor);
      }
    }

    // 4. Signal instance matrix updates to GPU
    this.instancedInnerPetals.instanceMatrix.needsUpdate = true;
    this.instancedOuterPetals.instanceMatrix.needsUpdate = true;
    this.instancedCores.instanceMatrix.needsUpdate = true;
    this.instancedHalos.instanceMatrix.needsUpdate = true;

    this.innerBloomAttr.needsUpdate = true;
    this.innerTouchAttr.needsUpdate = true;
    this.outerBloomAttr.needsUpdate = true;
    this.outerTouchAttr.needsUpdate = true;
    this.coreBloomAttr.needsUpdate = true;
    this.haloBloomAttr.needsUpdate = true;

    this.meteorGeo.attributes.position.needsUpdate = true;
    this.meteorGeo.attributes.color.needsUpdate = true;
    this.meteorGeo.attributes.size.needsUpdate = true;
    this.meteorGeo.attributes.alpha.needsUpdate = true;

    // 5. Update active sparkles
    this.updateSparkles(deltaSec);

    // 6. Gather VR Proximity / Direct Touch
    this.processVRProximity();
  }

  private hideFlowerInstances(flowerIndex: number): void {
    this.hideFlowerPetals(flowerIndex);
    this.scratchMat4.identity().scale(this.scratchVec.set(0, 0, 0));
    this.instancedCores.setMatrixAt(flowerIndex, this.scratchMat4);
    this.instancedHalos.setMatrixAt(flowerIndex, this.scratchMat4);
  }

  private hideFlowerPetals(flowerIndex: number): void {
    this.scratchMat4.identity().scale(this.scratchVec.set(0, 0, 0));
    for (let p = 0; p < 6; p++) {
      this.instancedInnerPetals.setMatrixAt(flowerIndex * 6 + p, this.scratchMat4);
    }
    for (let p = 0; p < 8; p++) {
      this.instancedOuterPetals.setMatrixAt(flowerIndex * 8 + p, this.scratchMat4);
    }
  }

  private updateSparkles(deltaSec: number): void {
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
      this.sparkleVelocities[p3 + 1] = (this.sparkleVelocities[p3 + 1] + 0.15 * deltaSec) * 0.94;
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
  }

  reset(): void {
    this.group.visible = false;
    this.waveActive = false;
    this.waveRadius = 0.0;
    this.waveStartTime = -1;

    for (let f = 0; f < this.flowers.length; f++) {
      const fl = this.flowers[f];
      fl.lifecycle = 'inactive';
      fl.isBlooming = false;
      fl.bloomProgress = 0.0;
      fl.targetBloom = 0.0;
      fl.bloomVelocity = 0.0;
      fl.touchCooldown = 0.0;
      fl.touchGlow = 0.0;
      fl.waveGlowPulse = 0.0;
      this.hideFlowerInstances(f);
    }

    for (let p = 0; p < this.maxMeteorParticles; p++) {
      this.meteorAlphas[p] = 0.0;
    }
    for (let p = 0; p < this.maxSparkles; p++) {
      this.sparkleAlphas[p] = 0.0;
    }

    this.instancedInnerPetals.instanceMatrix.needsUpdate = true;
    this.instancedOuterPetals.instanceMatrix.needsUpdate = true;
    this.instancedCores.instanceMatrix.needsUpdate = true;
    this.instancedHalos.instanceMatrix.needsUpdate = true;
    this.meteorGeo.attributes.alpha.needsUpdate = true;
    this.sparkleGeo.attributes.alpha.needsUpdate = true;
  }

  dispose(): void {
    this.clearXRWorld();
    this.innerPetalGeo.dispose();
    this.outerPetalGeo.dispose();
    this.coreGeo.dispose();
    this.haloGeo.dispose();
    this.meteorGeo.dispose();
    this.sparkleGeo.dispose();
    (this.instancedInnerPetals.material as ShaderMaterial).dispose();
    (this.instancedOuterPetals.material as ShaderMaterial).dispose();
    (this.instancedCores.material as ShaderMaterial).dispose();
    (this.instancedHalos.material as ShaderMaterial).dispose();
    (this.meteorPoints.material as ShaderMaterial).dispose();
    (this.sparklePoints.material as ShaderMaterial).dispose();
    this.group.clear();
    this.flowers.length = 0;
  }
}
