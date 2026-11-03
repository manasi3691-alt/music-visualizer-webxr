/**
 * SoundBubbles: Magical translucent, iridescent water droplets and floating bubbles for Phase 2.
 *
 * Enhanced Features:
 * - Organic teardrop/water-droplet geometries (avoiding plain repetitive spheres).
 * - Translucent iridescent shader with Fresnel rainbow chromatic sheen and surface tension breathing.
 * - Droplets float, sway, and expand with music intensity.
 * - On popping (or climactic burst), bursts into hundreds of tiny glittering micro-bubbles
 *   that scatter radially and gradually fade.
 * - High frequencies amplify micro-bubble sparkle and glitter shimmer.
 * - Full XR proximity poke interaction and desktop click hit-testing preserved.
 * - Pleasant synthesized Web Audio pop chirp.
 * - Zero per-frame allocations, fully optimized for Meta Quest 3S.
 */

import {
  Group,
  Mesh,
  Points,
  BufferGeometry,
  Float32BufferAttribute,
  SphereGeometry,
  ShaderMaterial,
  Color,
  Vector3,
  AdditiveBlending,
  DoubleSide,
} from '@iwsdk/core';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

interface DropletBubble {
  mesh: Mesh;
  mat: ShaderMaterial;
  restPos: Vector3;
  floatPhase: number;
  floatSpeed: number;
  floatAmplitude: number;
  wobbleSpeed: number;
  sizeCategory: 'small' | 'medium' | 'large';
  isPopping: boolean;
  popProgress: number;
  popCooldown: number;
  baseScale: number;
  expansionPhase: number;
  emergeAt: number;
}

const POP_DURATION = 0.35;
const POP_COOLDOWN = 2.5;
const POP_VOLUME   = 0.07;

export class SoundBubbles {
  readonly group: Group = new Group();

  private bubbles: DropletBubble[] = [];

  // Shared organic droplet geometries
  private geoSmall:  BufferGeometry;
  private geoMedium: BufferGeometry;
  private geoLarge:  BufferGeometry;

  // Glittering micro-bubbles burst pool
  private maxMicroBubbles: number;
  private microPositions!: Float32Array;
  private microVelocities!: Float32Array;
  private microColors!: Float32Array;
  private microAlphas!: Float32Array;
  private microSizes!: Float32Array;
  private microLifetimes!: Float32Array;
  private microMaxLifetimes!: Float32Array;
  private microGeo!: BufferGeometry;
  private microMat!: ShaderMaterial;
  private microPoints!: Points;
  private nextMicroIndex = 0;

  // Scratch objects for zero heap allocation
  private scratchBubbleWorldPos = new Vector3();
  private scratchPokerWorldPos  = new Vector3();
  private scratchRayPoint       = new Vector3();
  private scratchToBubble       = new Vector3();

  // Web Audio for pop sounds
  private audioCtx: AudioContext | null = null;
  private xrWorld: any = null;

  constructor(isQuest = false) {
    this.maxMicroBubbles = isQuest ? 500 : 1000;

    // Build procedural organic teardrop geometries
    this.geoSmall  = this.buildTeardropGeometry(0.09, 12, 12);
    this.geoMedium = this.buildTeardropGeometry(0.18, 14, 14);
    this.geoLarge  = this.buildTeardropGeometry(0.32, 16, 16);

    this.buildBubbles();
    this.buildMicroBubblePool(isQuest);
  }

  setXRWorld(world: any): void {
    this.xrWorld = world;
  }

  clearXRWorld(): void {
    this.xrWorld = null;
  }

  /**
   * Builds an authentic organic teardrop/water-droplet geometry.
   */
  private buildTeardropGeometry(radius: number, widthSegments: number, heightSegments: number): BufferGeometry {
    const geo = new SphereGeometry(radius, widthSegments, heightSegments);
    const pos = geo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);

      const normY = y / radius; // -1 to +1
      // Teardrop profile: width tapers smoothly to a graceful point at the top (normY = 1),
      // and expands into a full, rounded bulbous water drop at the bottom.
      const taper = (1.0 - normY * 0.45) * Math.sin(Math.acos(Math.max(-1, Math.min(1, normY))));
      const curRad = Math.sqrt(x * x + z * z);

      if (curRad > 0.0001) {
        const scaleXZ = (taper * radius) / curRad;
        pos.setX(i, x * scaleXZ);
        pos.setZ(i, z * scaleXZ);
      }
      // Gentle vertical elongation for authentic suspended liquid droplet
      pos.setY(i, y * 1.22);
    }
    geo.computeVertexNormals();
    return geo;
  }

  private buildBubbles(): void {
    const rng = this.seededRand(99);

    const placements: {
      dist: number;
      heightMin: number;
      heightMax: number;
      count: number;
      size: 'small' | 'medium' | 'large';
      emergeAtMin: number;
      emergeAtMax: number;
    }[] = [
      { dist: 1.4, heightMin: 0.8, heightMax: 2.2, count: 6,  size: 'small',  emergeAtMin: 0.05, emergeAtMax: 0.20 },
      { dist: 2.4, heightMin: 0.6, heightMax: 3.0, count: 8,  size: 'medium', emergeAtMin: 0.10, emergeAtMax: 0.30 },
      { dist: 3.8, heightMin: 1.0, heightMax: 4.0, count: 8,  size: 'large',  emergeAtMin: 0.18, emergeAtMax: 0.40 },
      { dist: 5.5, heightMin: 1.5, heightMax: 5.5, count: 8,  size: 'large',  emergeAtMin: 0.28, emergeAtMax: 0.55 },
      { dist: 8.5, heightMin: 2.0, heightMax: 7.0, count: 6,  size: 'large',  emergeAtMin: 0.40, emergeAtMax: 0.65 },
      { dist: 12.0,heightMin: 3.0, heightMax: 9.0, count: 4,  size: 'medium', emergeAtMin: 0.55, emergeAtMax: 0.78 },
    ];

    // Iridescent droplet color stops: cyan, turquoise, lavender, pink, rose gold
    const baseColors = [
      new Color(0x38b6ff),
      new Color(0x00f2fe),
      new Color(0xb39ddb),
      new Color(0xff77e9),
      new Color(0xf4a4a8),
      new Color(0x1de9b6),
    ];

    for (const p of placements) {
      for (let i = 0; i < p.count; i++) {
        const angle = ((i + rng() * 0.5) / p.count) * Math.PI * 2;
        const r = p.dist + (rng() - 0.5) * 0.8;
        const x = Math.sin(angle) * r;
        const z = Math.cos(angle) * r;
        const y = p.heightMin + rng() * (p.heightMax - p.heightMin);

        const geo = p.size === 'small' ? this.geoSmall : p.size === 'medium' ? this.geoMedium : this.geoLarge;
        const baseScale = p.size === 'small' ? 0.8 + rng() * 0.3 : p.size === 'medium' ? 0.85 + rng() * 0.4 : 1.0 + rng() * 0.5;
        const col = baseColors[Math.floor(rng() * baseColors.length)];

        // Custom Iridescent Water Droplet Material
        const mat = new ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uAlpha: { value: 0 },
            uHigh: { value: 0 },
            uBaseColor: { value: col },
          },
          vertexShader: `
            uniform float uTime;
            varying vec3 vNormal;
            varying vec3 vViewDir;

            void main() {
              vNormal = normalize(normalMatrix * normal);
              vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
              vViewDir = -mvPosition.xyz;

              // Subtle surface tension breathing
              vec3 pos = position;
              float wobble = sin(uTime * 3.2 + pos.y * 6.0) * 0.04;
              pos += normal * wobble;

              gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
          `,
          fragmentShader: `
            uniform float uTime;
            uniform float uAlpha;
            uniform float uHigh;
            uniform vec3 uBaseColor;

            varying vec3 vNormal;
            varying vec3 vViewDir;

            void main() {
              vec3 N = normalize(vNormal);
              vec3 V = normalize(vViewDir);

              float NdotV = max(0.0, dot(N, V));
              // Fresnel rim factor
              float fresnel = pow(1.0 - NdotV, 2.5);

              // Iridescent thin-film chromatic dispersion ramp
              float irid = fract(fresnel * 1.5 + uTime * 0.12);
              vec3 rainbow = 0.5 + 0.5 * cos(6.28318 * (vec3(1.0) * irid + vec3(0.0, 0.33, 0.67)));

              vec3 dropletCol = mix(uBaseColor, rainbow, 0.65);

              // Specular highlights (sun & celestial fireworks glint)
              vec3 L = normalize(vec3(0.4, 0.8, 0.4));
              vec3 H = normalize(L + V);
              float spec = pow(max(0.0, dot(N, H)), 24.0) * (0.8 + uHigh * 0.4);

              vec3 finalColor = dropletCol + vec3(spec * 0.75);
              float alpha = clamp((fresnel * 0.72 + 0.15 + spec * 0.5) * uAlpha, 0.0, 0.94);

              gl_FragColor = vec4(finalColor, alpha);
            }
          `,
          transparent: true,
          side: DoubleSide,
          depthWrite: false,
        });

        const mesh = new Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.scale.setScalar(0.001);
        this.group.add(mesh);

        this.bubbles.push({
          mesh,
          mat,
          restPos: new Vector3(x, y, z),
          floatPhase: rng() * Math.PI * 2,
          floatSpeed: 0.35 + rng() * 0.35,
          floatAmplitude: 0.05 + rng() * 0.09,
          wobbleSpeed: 1.5 + rng() * 1.5,
          sizeCategory: p.size,
          isPopping: false,
          popProgress: 0,
          popCooldown: 0,
          baseScale,
          expansionPhase: rng() * Math.PI * 2,
          emergeAt: p.emergeAtMin + rng() * (p.emergeAtMax - p.emergeAtMin),
        });
      }
    }
  }

  /**
   * Builds the pre-allocated pooled particle system for glittering micro-bubbles.
   */
  private buildMicroBubblePool(isQuest: boolean): void {
    this.microPositions = new Float32Array(this.maxMicroBubbles * 3);
    this.microVelocities = new Float32Array(this.maxMicroBubbles * 3);
    this.microColors = new Float32Array(this.maxMicroBubbles * 3);
    this.microAlphas = new Float32Array(this.maxMicroBubbles);
    this.microSizes = new Float32Array(this.maxMicroBubbles);
    this.microLifetimes = new Float32Array(this.maxMicroBubbles);
    this.microMaxLifetimes = new Float32Array(this.maxMicroBubbles);

    for (let i = 0; i < this.maxMicroBubbles; i++) {
      this.microAlphas[i] = 0;
      this.microSizes[i] = isQuest ? 0.04 : 0.06;
      this.microLifetimes[i] = 0;
      this.microMaxLifetimes[i] = 1.6;
    }

    this.microGeo = new BufferGeometry();
    this.microGeo.setAttribute('position', new Float32BufferAttribute(this.microPositions, 3));
    this.microGeo.setAttribute('customColor', new Float32BufferAttribute(this.microColors, 3));
    this.microGeo.setAttribute('alpha', new Float32BufferAttribute(this.microAlphas, 1));
    this.microGeo.setAttribute('size', new Float32BufferAttribute(this.microSizes, 1));

    this.microMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        attribute vec3 customColor;
        attribute float alpha;
        attribute float size;

        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vColor = customColor;
          vAlpha = alpha;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (200.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 1.0, 28.0);
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

          // Glassy bubble sphere profile: bright rim, hollow translucent center
          float rim = pow(dist * 2.0, 2.5);
          float core = pow(1.0 - dist * 2.0, 2.0);

          vec3 col = mix(vColor, vec3(1.0, 1.0, 1.0), rim * 0.8 + core * 0.3);
          gl_FragColor = vec4(col, vAlpha * (rim * 0.85 + 0.15));
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    this.microPoints = new Points(this.microGeo, this.microMat);
    this.group.add(this.microPoints);
  }

  /**
   * Main per-frame update.
   */
  update(frameData: ConductorFrameData, metrics: AudioMetrics, deltaSec: number): void {
    const t = frameData.relativeTime;

    // Phase 2 window: 55.0s -> 165.0s, dissolving 165s -> 175s
    if (t < 55.0 || t >= 175.0) {
      if (this.group.visible) {
        this.group.visible = false;
      }
      return;
    }
    this.group.visible = true;

    const emergeProgress = Math.min(1.0, Math.max(0, (t - 55.0) / 10.0));
    const dissolve = t >= 165.0 ? Math.max(0, 1.0 - (t - 165.0) / 10.0) : 1.0;
    const vis = emergeProgress * dissolve;

    // Determine XR poking position
    let pokerPos: Vector3 | null = null;
    if (this.xrWorld) {
      const w = this.xrWorld;
      const rightIndexTip = w.player?.indexTipSpaces?.right;
      const rightGrip = w.player?.gripSpaces?.right;

      if (rightIndexTip) {
        rightIndexTip.updateMatrixWorld();
        this.scratchPokerWorldPos.setFromMatrixPosition(rightIndexTip.matrixWorld);
        pokerPos = this.scratchPokerWorldPos;
      } else if (rightGrip) {
        rightGrip.updateMatrixWorld();
        this.scratchPokerWorldPos.setFromMatrixPosition(rightGrip.matrixWorld);
        pokerPos = this.scratchPokerWorldPos;
      }
    }

    const { mid, high, energy, beat } = metrics;
    this.microMat.uniforms.uTime.value = t;

    // Update droplet bubbles
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];

      if (b.popCooldown > 0) b.popCooldown -= deltaSec;

      b.mat.uniforms.uTime.value = t;
      b.mat.uniforms.uHigh.value = high;

      if (!b.isPopping) {
        // Floating motion with gentle horizontal sway
        const liftBonus = t >= 165.0 ? (t - 165.0) * 0.45 : 0;
        const floatY = Math.sin(t * b.floatSpeed + b.floatPhase) * b.floatAmplitude + liftBonus;
        const floatX = Math.cos(t * b.floatSpeed * 0.7 + b.floatPhase + 1.2) * b.floatAmplitude * 0.35;

        b.mesh.position.x = b.restPos.x + floatX;
        b.mesh.position.y = b.restPos.y + floatY;
        b.mesh.position.z = b.restPos.z;

        // Gentle orientation wobble
        b.mesh.rotation.z = Math.sin(t * b.wobbleSpeed + b.floatPhase) * 0.12;
        b.mesh.rotation.x = Math.cos(t * b.wobbleSpeed * 0.8 + b.floatPhase) * 0.08;

        // Music-synchronized breathing and expansion
        const musicExpansion = 1.0 + Math.sin(t * 1.5 + b.expansionPhase) * 0.08 + energy * 0.22 + (b.sizeCategory === 'large' ? mid * 0.15 : 0);
        const currentScale = b.baseScale * vis * musicExpansion;
        b.mesh.scale.setScalar(Math.max(0.001, currentScale));

        b.mat.uniforms.uAlpha.value = vis * 0.75;

        // Natural burst on high energy climaxes or XR poke
        const isClimaxWindow = t >= 130.0 && t <= 165.0;
        if (isClimaxWindow && beat > 0.72 && b.popCooldown <= 0 && b.sizeCategory === 'large' && Math.random() < 0.035) {
          this.triggerPop(b, high);
        }

        // XR proximity pop check
        if (pokerPos && b.popCooldown <= 0 && vis > 0.4) {
          b.mesh.updateMatrixWorld();
          this.scratchBubbleWorldPos.setFromMatrixPosition(b.mesh.matrixWorld);
          const dist = pokerPos.distanceTo(this.scratchBubbleWorldPos);
          const popRadius = b.sizeCategory === 'small' ? 0.18 : b.sizeCategory === 'medium' ? 0.28 : 0.45;
          if (dist < popRadius) {
            this.triggerPop(b, high);
          }
        }
      } else {
        // Pop surge & burst sequence
        b.popProgress += deltaSec / POP_DURATION;
        if (b.popProgress >= 1.0) {
          b.isPopping = false;
          b.popProgress = 0;
          b.popCooldown = POP_COOLDOWN;
          b.mesh.scale.setScalar(Math.max(0.001, b.baseScale * vis));
          b.mat.uniforms.uAlpha.value = vis * 0.75;
        } else {
          // Rapid expansion surge right before dissolution
          const pt = b.popProgress;
          let popScale: number;
          let popAlpha: number;
          if (pt < 0.3) {
            // Surface tension expands dramatically
            const s = pt / 0.3;
            popScale = b.baseScale * (1.0 + s * 0.65);
            popAlpha = 0.9;
          } else {
            // Droplet membrane shatters into micro-bubbles
            const s = (pt - 0.3) / 0.7;
            popScale = b.baseScale * 1.65 * (1.0 - s);
            popAlpha = 0.9 * (1.0 - s * 1.4);
          }
          b.mesh.scale.setScalar(Math.max(0.001, popScale));
          b.mat.uniforms.uAlpha.value = Math.max(0, popAlpha);
        }
      }
    }

    // Update glittering micro-bubbles
    for (let m = 0; m < this.maxMicroBubbles; m++) {
      if (this.microAlphas[m] <= 0.001) continue;

      this.microLifetimes[m] += deltaSec;
      const progress = this.microLifetimes[m] / this.microMaxLifetimes[m];

      if (progress >= 1.0) {
        this.microAlphas[m] = 0;
        continue;
      }

      const m3 = m * 3;
      // Upward buoyancy with air drag
      this.microVelocities[m3] *= 0.94;
      this.microVelocities[m3 + 1] = (this.microVelocities[m3 + 1] + 0.35 * deltaSec) * 0.95;
      this.microVelocities[m3 + 2] *= 0.94;

      this.microPositions[m3] += this.microVelocities[m3] * deltaSec;
      this.microPositions[m3 + 1] += this.microVelocities[m3 + 1] * deltaSec;
      this.microPositions[m3 + 2] += this.microVelocities[m3 + 2] * deltaSec;

      // Glitter sparkle fade
      const sparkle = 0.75 + 0.25 * Math.sin(t * 22.0 + m * 1.8);
      const alphaFade = Math.sin(progress * Math.PI);
      this.microAlphas[m] = alphaFade * sparkle * (0.85 + high * 0.45);
    }

    this.microGeo.attributes.position.needsUpdate = true;
    this.microGeo.attributes.alpha.needsUpdate = true;
  }

  /**
   * Hit-test for desktop clicks or ray-based popping.
   */
  hitTest(rayOrigin: Vector3, rayDir: Vector3): boolean {
    if (!this.group.visible) return false;
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      if (b.popCooldown <= 0 && b.mesh.scale.x > 0.02 && !b.isPopping) {
        b.mesh.updateMatrixWorld();
        this.scratchBubbleWorldPos.setFromMatrixPosition(b.mesh.matrixWorld);

        this.scratchToBubble.copy(this.scratchBubbleWorldPos).sub(rayOrigin);
        const projection = this.scratchToBubble.dot(rayDir);
        if (projection > 0 && projection < 20.0) {
          this.scratchRayPoint.copy(rayOrigin).addScaledVector(rayDir, projection);
          const dist = this.scratchRayPoint.distanceTo(this.scratchBubbleWorldPos);
          const hitRadius = (b.sizeCategory === 'small' ? 0.22 : b.sizeCategory === 'medium' ? 0.35 : 0.52) * (b.mesh.scale.x / b.baseScale);
          if (dist < hitRadius) {
            this.triggerPop(b, 0.5);
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Triggers the burst of a water droplet into dozens of glittering micro-bubbles.
   */
  private triggerPop(b: DropletBubble, highFreq = 0.5): void {
    b.isPopping = true;
    b.popProgress = 0;
    this.playPopSound(b.sizeCategory);

    // Spawn spray of glittering micro-bubbles
    b.mesh.updateMatrixWorld();
    this.scratchBubbleWorldPos.setFromMatrixPosition(b.mesh.matrixWorld);

    const count = b.sizeCategory === 'small' ? 35 : b.sizeCategory === 'medium' ? 65 : 110;
    const burstSpeed = b.sizeCategory === 'small' ? 1.6 : b.sizeCategory === 'medium' ? 2.4 : 3.4;

    const baseCol = b.mat.uniforms.uBaseColor.value as Color;

    for (let p = 0; p < count; p++) {
      const mIdx = this.nextMicroIndex;
      this.nextMicroIndex = (this.nextMicroIndex + 1) % this.maxMicroBubbles;
      const m3 = mIdx * 3;

      this.microPositions[m3] = this.scratchBubbleWorldPos.x + (Math.random() - 0.5) * 0.08;
      this.microPositions[m3 + 1] = this.scratchBubbleWorldPos.y + (Math.random() - 0.5) * 0.08;
      this.microPositions[m3 + 2] = this.scratchBubbleWorldPos.z + (Math.random() - 0.5) * 0.08;

      // Radial scatter velocity
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2.0 * Math.random() - 1.0);
      const spd = burstSpeed * (0.5 + Math.random() * 0.7);

      this.microVelocities[m3] = Math.sin(phi) * Math.cos(theta) * spd;
      this.microVelocities[m3 + 1] = Math.sin(phi) * Math.sin(theta) * spd + 0.5; // Slight upward buoyancy
      this.microVelocities[m3 + 2] = Math.cos(phi) * spd;

      // Color variation (mix base color with rainbow glitter or white diamond spark)
      const colorMix = Math.random();
      if (colorMix < 0.4) {
        this.microColors[m3] = baseCol.r;
        this.microColors[m3 + 1] = baseCol.g;
        this.microColors[m3 + 2] = baseCol.b;
      } else if (colorMix < 0.75) {
        // Cyan / Lavender rainbow
        this.microColors[m3] = 0.55;
        this.microColors[m3 + 1] = 0.85;
        this.microColors[m3 + 2] = 1.0;
      } else {
        // Diamond white spark
        this.microColors[m3] = 1.0;
        this.microColors[m3 + 1] = 0.98;
        this.microColors[m3 + 2] = 0.85;
      }

      this.microAlphas[mIdx] = 1.0;
      this.microSizes[mIdx] = (0.04 + Math.random() * 0.04) * (0.8 + highFreq * 0.4);
      this.microLifetimes[mIdx] = 0;
      this.microMaxLifetimes[mIdx] = 1.2 + Math.random() * 1.0;
    }

    this.microGeo.attributes.customColor.needsUpdate = true;
    this.microGeo.attributes.size.needsUpdate = true;
  }

  private playPopSound(size: 'small' | 'medium' | 'large'): void {
    try {
      if (!this.audioCtx) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (AC) this.audioCtx = new AC();
      }
      if (!this.audioCtx) return;

      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') ctx.resume();

      const freq = size === 'small' ? 1100 + Math.random() * 300
                 : size === 'medium' ? 700 + Math.random() * 200
                 : 350 + Math.random() * 150;

      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      const now  = ctx.currentTime;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.4, now + 0.18);

      gain.gain.setValueAtTime(POP_VOLUME, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.20);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);

      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    } catch (_) {
      // Audio errors ignored silently
    }
  }

  reset(): void {
    this.group.visible = false;
    for (const b of this.bubbles) {
      b.isPopping = false;
      b.popProgress = 0;
      b.popCooldown = 0;
      b.mesh.scale.setScalar(0.001);
      b.mat.uniforms.uAlpha.value = 0;
    }
    for (let m = 0; m < this.maxMicroBubbles; m++) {
      this.microAlphas[m] = 0;
    }
    if (this.microGeo.attributes.alpha) {
      this.microGeo.attributes.alpha.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const b of this.bubbles) {
      b.mat.dispose();
    }
    this.geoSmall.dispose();
    this.geoMedium.dispose();
    this.geoLarge.dispose();
    this.microGeo.dispose();
    this.microMat.dispose();
    this.group.clear();
    this.bubbles.length = 0;
  }

  private seededRand(seed: number): () => number {
    let s = seed;
    return () => {
      s += 0x6d2b79f5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 0xffffffff;
    };
  }
}
