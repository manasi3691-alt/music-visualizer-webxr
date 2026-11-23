/**
 * InfiniteBloomLotusField: Grand Finale for EXPERIENCE — "A Sky Full of Stars: The Infinite Bloom"
 *
 * Requirements:
 * 1. THE METEOR STORM:
 *    - Perseid-inspired meteor shower across the full 360° sky (100+ meteors).
 *    - Descends towards the cosmic ocean with luminous trails.
 *    - Brilliant white, icy blue, cyan, and soft golden tails.
 * 2. REAL METEOR-TO-LOTUS TRANSFORMATION (ONE METEOR = ONE LOTUS):
 *    - Moving 3D Meteor Head Mesh (instanced sphere with starlight shader).
 *    - Deceleration: Decelerates and hovers ~0.28m above ocean destination.
 *    - Particle Convergence: Trail particles visibly stream forward into the core.
 *    - Progressive Petal Emergence: Real 3D petals emerge from the core:
 *      inner 6 petals sprout from stamen, outer 8 petals emerge and wrap into a closed bud.
 *    - Completion: Bud gently settles onto the ocean surface as a floating closed lotus.
 * 3. THE INFINITE LOTUS FIELD:
 *    - 80-110 floating lotuses distributed across 360° on the cosmic ocean.
 *    - Gentle water bobbing and ocean reflections.
 * 4. EVERY LOTUS IS INDEPENDENTLY INTERACTIVE:
 *    - Starts completely closed.
 *    - Opens when touched or selected; closes when touched or selected again.
 *    - Supports Meta Quest 3S hand tracking (fingertip poke), Touch controllers (grip & ray),
 *      and desktop mouse click & hover.
 *    - Opening one flower NEVER affects any other flower.
 * 5. THE FINAL CINEMATIC MOMENT:
 *    - Grand hero meteor descends at ~234s in front of the seated user (0, 0.08, -0.85).
 *    - Transforms into special central closed lotus bud by ~244s.
 *    - At 250s (outro downbeat), it slowly blooms, sending a wave of light across the ocean.
 *    - Surrounding flowers pulse in response; settles into serene cosmic lotus ocean.
 * 6. ZERO PER-FRAME ALLOCATIONS & QUEST 3S OPTIMIZATION:
 *    - InstancedMesh for meteor heads, inner petals, outer petals, cores, and halos.
 *    - All transforms, blooms, and colors driven via InstancedBufferAttributes.
 */

import {
  Group,
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
  World,
  Camera,
} from '@iwsdk/core';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export type FlowerLifecycle =
  | 'inactive'
  | 'meteor_fall'
  | 'meteor_decelerate'
  | 'particle_converge'
  | 'petal_emergence'
  | 'lotus_settle'
  | 'active_lotus';

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
  lifecycle: FlowerLifecycle;
  meteorProgress: number; // 0 to 1
  decelerateProgress: number; // 0 to 1
  convergeProgress: number; // 0 to 1
  emergenceProgress: number; // 0 to 1
  settleProgress: number; // 0 to 1

  // Meteor trajectory
  meteorStartPos: Vector3;
  meteorControlPos: Vector3;
  meteorHoverPos: Vector3;
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
  private meteorHeadGeo!: BufferGeometry;

  // Instanced Meshes
  private instancedMeteorHeads!: InstancedMesh;
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

  // Meteor Particles System (for dynamic luminous trailing particles)
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

  constructor(isQuest = false) {
    this.isQuest = isQuest;
    this.flowerCount = isQuest ? 80 : 110;
    this.maxMeteorParticles = isQuest ? 850 : 1600;
    this.maxSparkles = isQuest ? 320 : 600;

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
   * Generates a curved parametric lotus petal geometry matching GlowingFlower.
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

    this.coreGeo = new SphereGeometry(0.012, this.isQuest ? 8 : 12, this.isQuest ? 6 : 10);
    this.haloGeo = new SphereGeometry(0.024, 8, 6);
    this.meteorHeadGeo = new SphereGeometry(0.040, this.isQuest ? 8 : 12, this.isQuest ? 6 : 10);
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

    let seed = 12345;
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    this.flowers = [];

    for (let i = 0; i < this.flowerCount; i++) {
      const isHero = i === 0;
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
        spawnTime = 234.0; // Hero meteor descends at 234.0s
      } else {
        // Multi-ring 360° distribution:
        // Ring 1 (arm reach): 0.60m to 1.4m (14 flowers)
        // Ring 2 (mid-distance): 1.5m to 4.8m (30 flowers)
        // Ring 3 (outer field & horizon): 5.0m to 24.0m (remaining flowers)
        if (i <= 14) {
          dist = 0.60 + random() * 0.80;
          scale = 0.85 + random() * 0.25;
        } else if (i <= 44) {
          dist = 1.5 + random() * 3.3;
          scale = 0.95 + random() * 0.40;
        } else {
          dist = 5.0 + random() * 19.0;
          scale = 1.1 + random() * 0.85;
        }

        angle = (i / (this.flowerCount - 1)) * Math.PI * 2 + (random() - 0.5) * 0.45;
        let x = Math.cos(angle) * dist;
        let z = Math.sin(angle) * dist;
        // Keep clear of initial central Phase 2 lotus corridor
        if (Math.abs(x) < 0.22 && z > -0.9 && z < -0.4) {
          x += x >= 0 ? 0.35 : -0.35;
        }
        worldPos = new Vector3(x, 0.06 + (random() - 0.5) * 0.03, z);

        // Meteor spawn times staggered continuously from 165.5s to 233.0s
        spawnTime = 165.5 + (i / this.flowerCount) * 67.5 + (random() - 0.5) * 2.0;
      }

      // Meteor origin: high in the 360-degree cosmic sky (y = 15m to 28m)
      const skyAngle = angle + (random() - 0.5) * 0.7;
      const skyDist = Math.max(12.0, dist * 1.6 + 8.0);
      const skyHeight = isHero ? 22.0 : (15.0 + random() * 13.0);
      const meteorStartPos = new Vector3(
        Math.cos(skyAngle) * skyDist,
        skyHeight,
        Math.sin(skyAngle) * skyDist
      );

      // Deceleration hover position: ~0.28m above ocean destination
      const meteorHoverPos = new Vector3(worldPos.x, worldPos.y + 0.28 * scale, worldPos.z);

      // Curved arc trajectory control point
      const meteorControlPos = new Vector3(
        (meteorStartPos.x + worldPos.x) * 0.5 + (random() - 0.5) * 3.0,
        skyHeight * 0.42,
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
        decelerateProgress: 0,
        convergeProgress: 0,
        emergenceProgress: 0,
        settleProgress: 0,
        meteorStartPos,
        meteorControlPos,
        meteorHoverPos,
        meteorTargetPos: worldPos.clone(),
        meteorSpawnTime: spawnTime,
        meteorFallDuration: isHero ? 4.8 : (3.2 + random() * 1.5),
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

          // Subtle organic petal fluttering
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
          vec3 norm = normalize(vNormal);
          vec3 view = normalize(vViewDir);

          // Dual-rim luminous fresnel
          float fresnel = 1.0 - abs(dot(norm, view));
          float rimGlow = pow(fresnel, 2.4);
          float outerRim = pow(fresnel, 4.0);

          // Translucent gradient along petal length
          vec3 petalGrad = mix(vBaseColor, vEdgeColor, pow(vUv.y, 1.2));
          petalGrad = mix(petalGrad, vHiColor, pow(vUv.y, 2.5) * 0.65);

          // Touch and sound energy
          vec3 touchTint = vec3(1.0, 0.95, 0.8) * vTouch * 0.65;
          vec3 soundEnergy = vHiColor * uHigh * 0.25;

          // Base crystal luminescence
          vec3 finalColor = petalGrad + touchTint + soundEnergy;
          finalColor += vEdgeColor * rimGlow * (0.8 + 0.4 * sin(uTime * 2.0));
          finalColor += vec3(1.0, 0.98, 0.9) * outerRim * 0.9;

          float alpha = (0.75 + 0.25 * rimGlow + vTouch * 0.2) * uMasterAlpha;
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    this.instancedInnerPetals = new InstancedMesh(this.innerPetalGeo, createPetalShader(), totalInner);
    this.instancedOuterPetals = new InstancedMesh(this.outerPetalGeo, createPetalShader(), totalOuter);
    this.instancedInnerPetals.instanceMatrix.setUsage(35048); // DYNAMIC_DRAW
    this.instancedOuterPetals.instanceMatrix.setUsage(35048);

    // Color and dynamic attributes
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
          float distFromEdge = max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
          float glow = pow(distFromEdge, 1.8);
          vec3 col = mix(vec3(0.4, 0.85, 1.0), vec3(1.0, 0.9, 0.6), vBloom);
          gl_FragColor = vec4(col * glow * 1.5, glow * 0.75 * uMasterAlpha);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
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

    // 3. Moving 3D Meteor Head Mesh (Instanced Mesh for 3D Meteor Bodies)
    const meteorHeadMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMasterAlpha: { value: 1.0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vViewDir = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uMasterAlpha;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vec3 norm = normalize(vNormal);
          vec3 view = normalize(vViewDir);
          float fresnel = 1.0 - max(0.0, dot(norm, view));
          float rim = pow(fresnel, 2.0);
          // Radiant white core with glowing cyan/golden starlight aura
          vec3 coreCol = vec3(1.0, 0.98, 0.92);
          vec3 haloCol = vec3(0.45, 0.90, 1.0);
          float pulse = 0.90 + 0.10 * sin(uTime * 8.0);
          vec3 col = (coreCol * (1.1 - 0.5 * rim) + haloCol * rim * 1.8) * pulse;
          gl_FragColor = vec4(col, (0.95 + 0.05 * rim) * uMasterAlpha);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.instancedMeteorHeads = new InstancedMesh(this.meteorHeadGeo, meteorHeadMat, totalFlowers);
    this.instancedMeteorHeads.instanceMatrix.setUsage(35048);

    // Initialise all instance matrices collapsed to origin
    const zeroMat = new Matrix4().scale(new Vector3(0, 0, 0));
    for (let f = 0; f < totalFlowers; f++) {
      this.instancedMeteorHeads.setMatrixAt(f, zeroMat);
      this.instancedCores.setMatrixAt(f, zeroMat);
      this.instancedHalos.setMatrixAt(f, zeroMat);
      for (let p = 0; p < 6; p++) this.instancedInnerPetals.setMatrixAt(f * 6 + p, zeroMat);
      for (let p = 0; p < 8; p++) this.instancedOuterPetals.setMatrixAt(f * 8 + p, zeroMat);
    }
    this.instancedMeteorHeads.instanceMatrix.needsUpdate = true;
    this.instancedCores.instanceMatrix.needsUpdate = true;
    this.instancedHalos.instanceMatrix.needsUpdate = true;
    this.instancedInnerPetals.instanceMatrix.needsUpdate = true;
    this.instancedOuterPetals.instanceMatrix.needsUpdate = true;

    this.group.add(this.instancedMeteorHeads);
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
        attribute float size;
        attribute float alpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (28.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 1.0, 90.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.001) discard;
          vec2 coord = gl_PointCoord - vec2(0.5);
          float d = length(coord);
          if (d > 0.5) discard;
          float falloff = pow(1.0 - d * 2.0, 1.8);
          gl_FragColor = vec4(vColor * falloff, vAlpha * falloff);
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
        attribute float alpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 18.0 * (15.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 1.0, 50.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.001) discard;
          vec2 coord = gl_PointCoord - vec2(0.5);
          float d = length(coord);
          if (d > 0.5) discard;
          float star = pow(1.0 - d * 2.0, 2.2);
          gl_FragColor = vec4(vColor * star, vAlpha * star);
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
    (this.instancedMeteorHeads.material as ShaderMaterial).uniforms.uTime.value = relativeTime;
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
          this.emitSparkles(heroFl.worldPos, 40, new Color(0xffdf80));
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

    const zeroMat = this.scratchMat4.identity().scale(this.scratchVec.set(0, 0, 0));

    for (let f = 0; f < this.flowers.length; f++) {
      const fl = this.flowers[f];

      // Update cooldowns & glow decay
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

      // =========================================================================
      // LIFECYCLE STATE MACHINE (6 EXPLICIT SEQUENTIAL STAGES)
      // =========================================================================

      // STAGE 0: Inactive (not spawned yet)
      if (relativeTime < fl.meteorSpawnTime) {
        fl.lifecycle = 'inactive';
        this.instancedMeteorHeads.setMatrixAt(f, zeroMat);
        this.hideFlowerInstances(f);
        continue;
      }

      const timeSinceSpawn = relativeTime - fl.meteorSpawnTime;

      // STAGE 1: METEOR DESCENT (Physical 3D moving meteor head with trailing particles)
      if (timeSinceSpawn < fl.meteorFallDuration) {
        fl.lifecycle = 'meteor_fall';
        fl.meteorProgress = timeSinceSpawn / fl.meteorFallDuration;
        const t = fl.meteorProgress;

        // Quadratic bezier arc trajectory towards hover position above water
        const omt = 1.0 - t;
        fl.meteorCurrentPos.set(0, 0, 0)
          .addScaledVector(fl.meteorStartPos, omt * omt)
          .addScaledVector(fl.meteorControlPos, 2 * omt * t)
          .addScaledVector(fl.meteorHoverPos, t * t);

        // Position 3D meteor head mesh
        const headScale = (fl.isHero ? 1.4 : 1.0) * fl.scale;
        this.scratchMat4.identity().compose(
          fl.meteorCurrentPos,
          this.scratchQuat.identity(),
          this.scratchVec.set(headScale, headScale, headScale)
        );
        this.instancedMeteorHeads.setMatrixAt(f, this.scratchMat4);

        // Trailing luminous particles along historical path
        const tailSegments = fl.isHero ? 16 : 8;
        for (let s = 0; s < tailSegments && meteorParticleCount < this.maxMeteorParticles; s++) {
          const sT = Math.max(0, t - s * 0.024);
          const sOmt = 1.0 - sT;
          const pIdx = meteorParticleCount++;
          const p3 = pIdx * 3;

          this.meteorPositions[p3] =
            fl.meteorStartPos.x * sOmt * sOmt + fl.meteorControlPos.x * 2 * sOmt * sT + fl.meteorHoverPos.x * sT * sT;
          this.meteorPositions[p3 + 1] =
            fl.meteorStartPos.y * sOmt * sOmt + fl.meteorControlPos.y * 2 * sOmt * sT + fl.meteorHoverPos.y * sT * sT;
          this.meteorPositions[p3 + 2] =
            fl.meteorStartPos.z * sOmt * sOmt + fl.meteorControlPos.z * 2 * sOmt * sT + fl.meteorHoverPos.z * sT * sT;

          const fade = 1.0 - s / tailSegments;
          this.meteorColors[p3] = fl.edgeColor.r * fade + (fl.isHero ? 0.35 : 0.0);
          this.meteorColors[p3 + 1] = fl.edgeColor.g * fade + (fl.isHero ? 0.35 : 0.0);
          this.meteorColors[p3 + 2] = fl.edgeColor.b * fade + (fl.isHero ? 0.35 : 0.0);
          this.meteorSizes[pIdx] = (fl.isHero ? 55.0 : 36.0) * fade;
          this.meteorAlphas[pIdx] = fade * 0.95;
        }

        this.hideFlowerInstances(f);
        continue;
      }

      const timeSinceFall = timeSinceSpawn - fl.meteorFallDuration;
      const decelDuration = 1.2;

      // STAGE 2: DECELERATION (Smoothly decelerates and comes to a hover above the ocean)
      if (timeSinceFall < decelDuration) {
        fl.lifecycle = 'meteor_decelerate';
        fl.decelerateProgress = timeSinceFall / decelDuration;
        const dp = fl.decelerateProgress;

        // Smooth cubic ease-out to gentle hover
        const smoothDecel = 1.0 - Math.pow(1.0 - dp, 3);
        fl.meteorCurrentPos.copy(fl.meteorHoverPos);

        // Meteor head hovers and pulses slightly
        const headScale = (fl.isHero ? 1.4 : 1.0) * fl.scale * (1.0 + 0.15 * Math.sin(dp * Math.PI));
        this.scratchMat4.identity().compose(
          fl.meteorCurrentPos,
          this.scratchQuat.identity(),
          this.scratchVec.set(headScale, headScale, headScale)
        );
        this.instancedMeteorHeads.setMatrixAt(f, this.scratchMat4);

        // Trail particles begin curving forward and condensing toward the hovering core
        const tailSegments = fl.isHero ? 14 : 7;
        for (let s = 0; s < tailSegments && meteorParticleCount < this.maxMeteorParticles; s++) {
          const pIdx = meteorParticleCount++;
          const p3 = pIdx * 3;
          const curveRatio = (s / tailSegments) * (1.0 - dp * 0.6);
          const offsetDist = curveRatio * (fl.isHero ? 1.8 : 1.1);

          this.scratchVec.copy(fl.meteorStartPos).sub(fl.meteorHoverPos).normalize();
          this.meteorPositions[p3] = fl.meteorHoverPos.x + this.scratchVec.x * offsetDist;
          this.meteorPositions[p3 + 1] = fl.meteorHoverPos.y + this.scratchVec.y * offsetDist;
          this.meteorPositions[p3 + 2] = fl.meteorHoverPos.z + this.scratchVec.z * offsetDist;

          const fade = (1.0 - s / tailSegments) * (1.0 - dp * 0.35);
          this.meteorColors[p3] = fl.highlightColor.r;
          this.meteorColors[p3 + 1] = fl.highlightColor.g;
          this.meteorColors[p3 + 2] = fl.highlightColor.b;
          this.meteorSizes[pIdx] = (fl.isHero ? 45.0 : 30.0) * fade;
          this.meteorAlphas[pIdx] = fade * 0.90;
        }

        this.hideFlowerInstances(f);
        continue;
      }

      const timeSinceDecel = timeSinceFall - decelDuration;
      const convergeDuration = 1.2;

      // STAGE 3: PARTICLE CONVERGENCE (Trail particles stream into core, creating glowing orb)
      if (timeSinceDecel < convergeDuration) {
        fl.lifecycle = 'particle_converge';
        fl.convergeProgress = timeSinceDecel / convergeDuration;
        const cp = fl.convergeProgress;

        // Trail particles visibly spiral and stream directly into the meteor core
        const convCount = fl.isHero ? 20 : 10;
        for (let c = 0; c < convCount && meteorParticleCount < this.maxMeteorParticles; c++) {
          const pIdx = meteorParticleCount++;
          const p3 = pIdx * 3;
          const theta = c * (Math.PI * 2 / convCount) + cp * 14.0;
          const r = (1.0 - cp) * (fl.isHero ? 1.4 : 0.85);

          this.meteorPositions[p3] = fl.meteorHoverPos.x + Math.cos(theta) * r;
          this.meteorPositions[p3 + 1] = fl.meteorHoverPos.y + Math.sin(theta * 2.0) * r * 0.35 + (1.0 - cp) * 0.15;
          this.meteorPositions[p3 + 2] = fl.meteorHoverPos.z + Math.sin(theta) * r;

          this.meteorColors[p3] = fl.highlightColor.r;
          this.meteorColors[p3 + 1] = fl.highlightColor.g;
          this.meteorColors[p3 + 2] = fl.highlightColor.b;
          this.meteorSizes[pIdx] = (fl.isHero ? 48.0 : 30.0) * (0.4 + 0.6 * cp);
          this.meteorAlphas[pIdx] = 1.0 - cp * 0.3;
        }

        // Concentrated glowing orb pulses at hover height
        const orbPulse = 1.0 + 0.25 * Math.sin(cp * Math.PI * 4.0);
        const orbScale = (fl.isHero ? 1.4 : 1.0) * fl.scale * orbPulse * (0.8 + 0.4 * cp);
        this.scratchMat4.identity().compose(
          fl.meteorHoverPos,
          this.scratchQuat.identity(),
          this.scratchVec.set(orbScale, orbScale, orbScale)
        );
        this.instancedMeteorHeads.setMatrixAt(f, this.scratchMat4);

        // Core and halo begin softly activating inside the orb
        this.instancedCores.setMatrixAt(f, this.scratchMat4);
        this.instancedHalos.setMatrixAt(f, this.scratchMat4);
        coreBloomArr[f] = cp * 0.6;
        haloBloomArr[f] = cp * 0.8;

        this.hideFlowerPetals(f);
        continue;
      }

      const timeSinceConverge = timeSinceDecel - convergeDuration;
      const emergenceDuration = 2.0;

      // STAGE 4: PROGRESSIVE 3D PETAL EMERGENCE (Petals emerge from glowing core to form closed bud)
      if (timeSinceConverge < emergenceDuration) {
        fl.lifecycle = 'petal_emergence';
        fl.emergenceProgress = timeSinceConverge / emergenceDuration;
        const pe = fl.emergenceProgress;

        // Meteor head seamlessly shrinks as lotus core takes over (continuous transition)
        const meteorHeadRemain = Math.max(0.0, 1.0 - pe * 1.4);
        const headScale = (fl.isHero ? 1.4 : 1.0) * fl.scale * meteorHeadRemain;
        this.scratchMat4.identity().compose(
          fl.meteorHoverPos,
          this.scratchQuat.identity(),
          this.scratchVec.set(headScale, headScale, headScale)
        );
        this.instancedMeteorHeads.setMatrixAt(f, this.scratchMat4);

        // Lotus root at hover position
        this.scratchQuat.setFromAxisAngle(this.scratchVec2.set(0, 1, 0), fl.rotationY);
        this.scratchFlowerMat4.compose(
          fl.meteorHoverPos,
          this.scratchQuat,
          this.scratchVec2.set(fl.scale, fl.scale, fl.scale)
        );

        // Central stamen core & halo take full form
        const coreScale = fl.scale * (0.75 + pe * 0.25);
        this.scratchMat4.identity().compose(
          fl.meteorHoverPos,
          this.scratchQuat,
          this.scratchVec2.set(coreScale, coreScale, coreScale)
        );
        this.instancedCores.setMatrixAt(f, this.scratchMat4);
        this.instancedHalos.setMatrixAt(f, this.scratchMat4);
        coreBloomArr[f] = 0.5 + pe * 0.5;
        haloBloomArr[f] = 0.7 + pe * 0.3;

        // PROGRESSIVE PETAL EMERGENCE:
        // Inner 6 petals emerge first (pe: 0.0 -> 0.65)
        // Outer 8 petals emerge second (pe: 0.30 -> 1.00)
        const innerEmergence = Math.max(0.0, Math.min(1.0, pe / 0.65));
        const smoothInner = innerEmergence * innerEmergence * (3.0 - 2.0 * innerEmergence);

        const outerEmergence = Math.max(0.0, Math.min(1.0, (pe - 0.30) / 0.70));
        const smoothOuter = outerEmergence * outerEmergence * (3.0 - 2.0 * outerEmergence);

        // 6 Inner Petals sprout outward from core and curl into inner bud
        const innerTiers = { count: 6, radius: 0.012, tiltClosed: -0.06 };
        for (let p = 0; p < 6; p++) {
          const instIdx = f * 6 + p;
          if (smoothInner <= 0.001) {
            this.instancedInnerPetals.setMatrixAt(instIdx, zeroMat);
            continue;
          }
          const angle = (p / innerTiers.count) * Math.PI * 2;
          const petalScale = smoothInner;
          // Petals emerge from central core and wrap into closed bud angle
          const tilt = innerTiers.tiltClosed + (1.0 - smoothInner) * 0.45;

          this.scratchBaseMat4.identity().compose(
            this.scratchVec2.set(Math.cos(angle) * innerTiers.radius * smoothInner, 0, Math.sin(angle) * innerTiers.radius * smoothInner),
            this.scratchQuat.setFromAxisAngle(this.scratchVec2.set(0, 1, 0), Math.PI * 0.5 - angle),
            this.scratchVec2.set(petalScale, petalScale, petalScale)
          );

          this.scratchHingeMat4.identity().makeRotationX(tilt);
          this.scratchPetalMat4.multiplyMatrices(this.scratchFlowerMat4, this.scratchBaseMat4);
          this.scratchPetalMat4.multiply(this.scratchHingeMat4);
          this.instancedInnerPetals.setMatrixAt(instIdx, this.scratchPetalMat4);

          innerBloomArr[instIdx] = 0.0;
          innerTouchArr[instIdx] = (1.0 - pe) * 0.8;
        }

        // 8 Outer Petals sprout from base ring and wrap tightly around inner petals
        const outerTiers = { count: 8, radius: 0.020, tiltClosed: -0.08 };
        for (let p = 0; p < 8; p++) {
          const instIdx = f * 8 + p;
          if (smoothOuter <= 0.001) {
            this.instancedOuterPetals.setMatrixAt(instIdx, zeroMat);
            continue;
          }
          const angle = (p / outerTiers.count) * Math.PI * 2 + 0.45;
          const petalScale = smoothOuter;
          const tilt = outerTiers.tiltClosed + (1.0 - smoothOuter) * 0.55;

          this.scratchBaseMat4.identity().compose(
            this.scratchVec2.set(Math.cos(angle) * outerTiers.radius * smoothOuter, 0, Math.sin(angle) * outerTiers.radius * smoothOuter),
            this.scratchQuat.setFromAxisAngle(this.scratchVec2.set(0, 1, 0), Math.PI * 0.5 - angle),
            this.scratchVec2.set(petalScale, petalScale, petalScale)
          );

          this.scratchHingeMat4.identity().makeRotationX(tilt);
          this.scratchPetalMat4.multiplyMatrices(this.scratchFlowerMat4, this.scratchBaseMat4);
          this.scratchPetalMat4.multiply(this.scratchHingeMat4);
          this.instancedOuterPetals.setMatrixAt(instIdx, this.scratchPetalMat4);

          outerBloomArr[instIdx] = 0.0;
          outerTouchArr[instIdx] = (1.0 - pe) * 0.8;
        }

        // Emit formative sparkles as petals curl together
        if (Math.random() < 0.18) {
          this.emitSparkles(fl.meteorHoverPos, 2, fl.highlightColor);
        }

        continue;
      }

      const timeSinceEmergence = timeSinceConverge - emergenceDuration;
      const settleDuration = 0.9;

      // STAGE 5: LOTUS SETTLE (Newly formed bud gently settles down to the water surface)
      if (timeSinceEmergence < settleDuration) {
        fl.lifecycle = 'lotus_settle';
        fl.settleProgress = timeSinceEmergence / settleDuration;
        const sp = fl.settleProgress;

        // Meteor head is now fully transformed and inactive
        this.instancedMeteorHeads.setMatrixAt(f, zeroMat);

        // Smoothstep interpolation from hover height down to baseY on the ocean surface
        const smoothSettle = sp * sp * (3.0 - 2.0 * sp);
        const currentY = fl.meteorHoverPos.y + (fl.baseY - fl.meteorHoverPos.y) * smoothSettle;
        this.scratchVec.set(fl.worldPos.x, currentY, fl.worldPos.z);

        // Lotus root matrix during settle
        this.scratchQuat.setFromAxisAngle(this.scratchVec2.set(0, 1, 0), fl.rotationY);
        this.scratchFlowerMat4.compose(
          this.scratchVec,
          this.scratchQuat,
          this.scratchVec2.set(fl.scale, fl.scale, fl.scale)
        );

        // Core and halo at settle position
        const coreScale = fl.scale * 0.80;
        this.scratchMat4.identity().compose(
          this.scratchVec,
          this.scratchQuat,
          this.scratchVec2.set(coreScale, coreScale, coreScale)
        );
        this.instancedCores.setMatrixAt(f, this.scratchMat4);
        this.instancedHalos.setMatrixAt(f, this.scratchMat4);
        coreBloomArr[f] = 0.0;
        haloBloomArr[f] = 0.0;

        // Petals remain tightly closed bud
        const innerTiers = { count: 6, radius: 0.012, tiltClosed: -0.06 };
        for (let p = 0; p < 6; p++) {
          const instIdx = f * 6 + p;
          const angle = (p / innerTiers.count) * Math.PI * 2;
          this.scratchBaseMat4.identity().compose(
            this.scratchVec2.set(Math.cos(angle) * innerTiers.radius, 0, Math.sin(angle) * innerTiers.radius),
            this.scratchQuat.setFromAxisAngle(this.scratchVec2.set(0, 1, 0), Math.PI * 0.5 - angle),
            this.scratchVec2.set(1, 1, 1)
          );
          this.scratchHingeMat4.identity().makeRotationX(innerTiers.tiltClosed);
          this.scratchPetalMat4.multiplyMatrices(this.scratchFlowerMat4, this.scratchBaseMat4);
          this.scratchPetalMat4.multiply(this.scratchHingeMat4);
          this.instancedInnerPetals.setMatrixAt(instIdx, this.scratchPetalMat4);
          innerBloomArr[instIdx] = 0.0;
          innerTouchArr[instIdx] = 0.0;
        }

        const outerTiers = { count: 8, radius: 0.020, tiltClosed: -0.08 };
        for (let p = 0; p < 8; p++) {
          const instIdx = f * 8 + p;
          const angle = (p / outerTiers.count) * Math.PI * 2 + 0.45;
          this.scratchBaseMat4.identity().compose(
            this.scratchVec2.set(Math.cos(angle) * outerTiers.radius, 0, Math.sin(angle) * outerTiers.radius),
            this.scratchQuat.setFromAxisAngle(this.scratchVec2.set(0, 1, 0), Math.PI * 0.5 - angle),
            this.scratchVec2.set(1, 1, 1)
          );
          this.scratchHingeMat4.identity().makeRotationX(outerTiers.tiltClosed);
          this.scratchPetalMat4.multiplyMatrices(this.scratchFlowerMat4, this.scratchBaseMat4);
          this.scratchPetalMat4.multiply(this.scratchHingeMat4);
          this.instancedOuterPetals.setMatrixAt(instIdx, this.scratchPetalMat4);
          outerBloomArr[instIdx] = 0.0;
          outerTouchArr[instIdx] = 0.0;
        }

        // On touching water (sp near 1.0), emit a soft ocean ripple sparkle
        if (sp > 0.88 && sp - deltaSec / settleDuration <= 0.88) {
          this.emitSparkles(fl.worldPos, 6, fl.edgeColor);
        }

        continue;
      }

      // STAGE 6: ACTIVE LOTUS (Floating on ocean, starts closed, independently interactive!)
      fl.lifecycle = 'active_lotus';
      this.instancedMeteorHeads.setMatrixAt(f, zeroMat);

      // Organic bloom interpolation (critically damped spring)
      const prevBloom = fl.bloomProgress;
      const bloomSpeed = 1.9;
      fl.bloomProgress += (fl.targetBloom - fl.bloomProgress) * (1.0 - Math.exp(-deltaSec * bloomSpeed));
      fl.bloomVelocity = Math.abs(fl.bloomProgress - prevBloom) / Math.max(0.001, deltaSec);

      // Subtle water bobbing on ocean surface
      const bobbing = Math.sin(relativeTime * 1.6 + fl.worldPos.x * 2.0 + fl.worldPos.z * 1.8) * 0.012;
      this.scratchVec.set(fl.worldPos.x, fl.baseY + bobbing, fl.worldPos.z);

      // Flower root matrix
      this.scratchQuat.setFromAxisAngle(this.scratchVec2.set(0, 1, 0), fl.rotationY);
      this.scratchFlowerMat4.compose(
        this.scratchVec,
        this.scratchQuat,
        this.scratchVec2.set(fl.scale, fl.scale, fl.scale)
      );

      // Core & Halo transforms
      const coreScale = (0.80 + fl.bloomProgress * 0.40) * fl.scale;
      this.scratchMat4.identity().compose(
        this.scratchVec,
        this.scratchQuat,
        this.scratchVec2.set(coreScale, coreScale, coreScale)
      );
      this.instancedCores.setMatrixAt(f, this.scratchMat4);

      const haloScale = (0.75 + fl.bloomProgress * 0.85 + fl.touchGlow * 0.3) * fl.scale;
      this.scratchMat4.identity().compose(
        this.scratchVec,
        this.scratchQuat,
        this.scratchVec2.set(haloScale, haloScale, haloScale)
      );
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
    this.instancedMeteorHeads.instanceMatrix.needsUpdate = true;
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

    const zeroMat = this.scratchMat4.identity().scale(this.scratchVec.set(0, 0, 0));

    for (let f = 0; f < this.flowers.length; f++) {
      const fl = this.flowers[f];
      fl.lifecycle = 'inactive';
      fl.meteorProgress = 0;
      fl.decelerateProgress = 0;
      fl.convergeProgress = 0;
      fl.emergenceProgress = 0;
      fl.settleProgress = 0;
      fl.isBlooming = false;
      fl.bloomProgress = 0.0;
      fl.targetBloom = 0.0;
      fl.bloomVelocity = 0.0;
      fl.touchCooldown = 0.0;
      fl.touchGlow = 0.0;
      fl.waveGlowPulse = 0.0;
      this.instancedMeteorHeads.setMatrixAt(f, zeroMat);
      this.hideFlowerInstances(f);
    }

    for (let p = 0; p < this.maxMeteorParticles; p++) {
      this.meteorAlphas[p] = 0.0;
    }
    for (let p = 0; p < this.maxSparkles; p++) {
      this.sparkleAlphas[p] = 0.0;
    }

    this.instancedMeteorHeads.instanceMatrix.needsUpdate = true;
    this.instancedInnerPetals.instanceMatrix.needsUpdate = true;
    this.instancedOuterPetals.instanceMatrix.needsUpdate = true;
    this.instancedCores.instanceMatrix.needsUpdate = true;
    this.instancedHalos.instanceMatrix.needsUpdate = true;
    this.meteorGeo.attributes.alpha.needsUpdate = true;
    this.sparkleGeo.attributes.alpha.needsUpdate = true;
  }

  dispose(): void {
    this.clearXRWorld();
    this.meteorHeadGeo.dispose();
    this.innerPetalGeo.dispose();
    this.outerPetalGeo.dispose();
    this.coreGeo.dispose();
    this.haloGeo.dispose();
    this.meteorGeo.dispose();
    this.sparkleGeo.dispose();
    (this.instancedMeteorHeads.material as ShaderMaterial).dispose();
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
