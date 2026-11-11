/**
 * CosmicFireworks: 360° celestial fireworks spectacle for Phase 2 (Crystal Lotus & Cosmic Ocean).
 *
 * Visual & Musical Design:
 *  - Inactive during initial Phase 2 lotus arrival & bubble discovery (t < 82s).
 *  - Introduces gently (82s - 112s), builds into grand multi-burst 360° display during
 *    the musical climax (112s - 158s, peaking 130s - 158s), and dissolves into tiny
 *    lingering sparkling glitter particles after the climax (158s - 175s).
 *  - Covers the full 360° sky (front, behind, left, right, horizon, and high overhead).
 *  - Mixes large detailed explosions (chrysanthemum, willow, double-ring) with smaller starbursts.
 *  - Uses cyan, turquoise, blue, lavender, violet, pink, magenta, and golden-white.
 *  - Three pooled GPU draw calls (glowing cores, curved 3D streamer trails, twinkling glitter embers)
 *    with zero per-frame heap allocations, optimized for Meta Quest 3S & Desktop.
 */

import {
  Group,
  Points,
  LineSegments,
  BufferGeometry,
  BufferAttribute,
  ShaderMaterial,
  Color,
  Vector3,
  AdditiveBlending,
} from '@iwsdk/core';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export interface FireworkFlash {
  position: Vector3;
  color: Color;
  intensity: number;
}

type ShellStyle = 'chrysanthemum' | 'willow' | 'starburst' | 'double_ring';

interface FireworkShell {
  active: boolean;
  style: ShellStyle;
  isLarge: boolean;
  center: Vector3;
  primaryColor: Color;
  secondaryColor: Color;
  age: number;
  maxLife: number;
  coreIntensity: number;
  coreSize: number;
  rayCount: number;
  rayOffset: number;
  glitterStart: number;
  glitterCount: number;
  gravity: number;
  drag: number;
  trailSampleAccum: number;
  glitterSpawned: boolean;
}

const FIREWORK_PALETTE: { primary: Color; secondary: Color; core: Color }[] = [
  { primary: new Color(0x00f2fe), secondary: new Color(0x1de9b6), core: new Color(0xe0ffff) }, // Cyan & Turquoise
  { primary: new Color(0x3b82f6), secondary: new Color(0x00f2fe), core: new Color(0xdbeafe) }, // Electric Blue & Cyan
  { primary: new Color(0x8a2be2), secondary: new Color(0xb39ddb), core: new Color(0xf3e8ff) }, // Violet & Lavender
  { primary: new Color(0xb39ddb), secondary: new Color(0xff77e9), core: new Color(0xfff0fb) }, // Lavender & Pink
  { primary: new Color(0xff77e9), secondary: new Color(0xff2a85), core: new Color(0xffe4f3) }, // Pink & Magenta
  { primary: new Color(0xff2a85), secondary: new Color(0x9d4edd), core: new Color(0xfff5f9) }, // Magenta & Violet
  { primary: new Color(0xfff2b2), secondary: new Color(0x00e5ff), core: new Color(0xffffff) }, // Golden-White & Cyan
  { primary: new Color(0xfff2b2), secondary: new Color(0xff77e9), core: new Color(0xffffff) }, // Golden-White & Pink
];

// Timeline thresholds (relativeTime seconds in Phase 2)
const FIREWORKS_TIMELINE = {
  tStart: 82.0,       // Keep inactive during initial Phase 2 lotus & bubble discovery
  tFullStart: 112.0,  // Ramp completes -> full rich display
  tClimaxStart: 130.0,// Grand multi-shell climax window begins
  tPostClimax: 158.0, // Stop big shells -> dissolve into tiny sparkling particles
  tEnd: 175.0,        // Complete fadeout before Phase 3
};

export class CosmicFireworks {
  readonly group: Group = new Group();

  private isQuest: boolean;
  private maxShells: number;
  private maxRaysPerShell: number;
  private readonly trailPointsPerRay = 8; // 7 connected segments per streamer ray
  private glitterPerShell: number;
  private totalGlitter: number;

  private shells: FireworkShell[] = [];

  // 1. Glowing Core Flashes (1 point per shell)
  private coreGeo: BufferGeometry;
  private coreMat: ShaderMaterial;
  private corePoints: Points;
  private corePositions: Float32Array;
  private coreColors: Float32Array;
  private coreAlphas: Float32Array;
  private coreSizes: Float32Array;

  // 2. Curved Streamer Trails (LineSegments pool)
  private trailGeo: BufferGeometry;
  private trailMat: ShaderMaterial;
  private trailLines: LineSegments;
  private trailPositions: Float32Array;     // Render buffer (2 vertices per segment)
  private trailColors: Float32Array;        // RGB per segment vertex
  private trailAlphas: Float32Array;        // Alpha per segment vertex
  private rayHistoryPos: Float32Array;      // 5 xyz history points per ray
  private rayVel: Float32Array;             // Current velocity per ray
  private rayPrimaryRGB: Float32Array;      // Color per ray
  private raySecondaryRGB: Float32Array;

  // 3. Sparkling Glitter & Trailing Embers (Points pool)
  private glitterGeo: BufferGeometry;
  private glitterMat: ShaderMaterial;
  private glitterPoints: Points;
  private glitterPos: Float32Array;
  private glitterVel: Float32Array;
  private glitterColors: Float32Array;
  private glitterAlphas: Float32Array;
  private glitterSizes: Float32Array;
  private glitterPhases: Float32Array;
  private glitterAges: Float32Array;
  private glitterMaxLives: Float32Array;

  // Timing & 360° spawn balancing
  private lastLaunchTime = 0;
  private lastBeatPulse = 0;
  private postClimaxSparkleAccum = 0;
  private nextAmbientGlitterCursor = 0;
  private spawnRegionCursor = 0;
  private masterAlpha = 0;

  // Ocean reflection flashes
  private activeFlashes: FireworkFlash[] = [
    { position: new Vector3(0, 15, -25), color: new Color(0x00f2fe), intensity: 0 },
    { position: new Vector3(-20, 18, -15), color: new Color(0xff77e9), intensity: 0 },
    { position: new Vector3(20, 16, -20), color: new Color(0x8a2be2), intensity: 0 },
    { position: new Vector3(0, 22, 25), color: new Color(0xfff2b2), intensity: 0 },
  ];

  // Scratch vectors (zero per-frame heap allocations)
  private scratchPos = new Vector3();

  constructor(isQuest = false) {
    this.isQuest = isQuest;
    this.maxShells = isQuest ? 10 : 16;
    this.maxRaysPerShell = isQuest ? 52 : 84;
    this.glitterPerShell = isQuest ? 150 : 280;
    this.totalGlitter = this.maxShells * this.glitterPerShell;

    const totalRays = this.maxShells * this.maxRaysPerShell;
    const segsPerRay = this.trailPointsPerRay - 1;
    const totalLineVerts = totalRays * segsPerRay * 2;

    // ─── Allocate Buffers ──────────────────────────────────────────────────
    this.corePositions = new Float32Array(this.maxShells * 3);
    this.coreColors = new Float32Array(this.maxShells * 3);
    this.coreAlphas = new Float32Array(this.maxShells);
    this.coreSizes = new Float32Array(this.maxShells);

    this.trailPositions = new Float32Array(totalLineVerts * 3);
    this.trailColors = new Float32Array(totalLineVerts * 3);
    this.trailAlphas = new Float32Array(totalLineVerts);
    this.rayHistoryPos = new Float32Array(totalRays * this.trailPointsPerRay * 3);
    this.rayVel = new Float32Array(totalRays * 3);
    this.rayPrimaryRGB = new Float32Array(totalRays * 3);
    this.raySecondaryRGB = new Float32Array(totalRays * 3);

    this.glitterPos = new Float32Array(this.totalGlitter * 3);
    this.glitterVel = new Float32Array(this.totalGlitter * 3);
    this.glitterColors = new Float32Array(this.totalGlitter * 3);
    this.glitterAlphas = new Float32Array(this.totalGlitter);
    this.glitterSizes = new Float32Array(this.totalGlitter);
    this.glitterPhases = new Float32Array(this.totalGlitter);
    this.glitterAges = new Float32Array(this.totalGlitter);
    this.glitterMaxLives = new Float32Array(this.totalGlitter);

    for (let s = 0; s < this.maxShells; s++) {
      this.shells.push({
        active: false,
        style: 'chrysanthemum',
        isLarge: true,
        center: new Vector3(),
        primaryColor: new Color(),
        secondaryColor: new Color(),
        age: 0,
        maxLife: 2.8,
        coreIntensity: 1.0,
        coreSize: 1.0,
        rayCount: this.maxRaysPerShell,
        rayOffset: s * this.maxRaysPerShell,
        glitterStart: s * this.glitterPerShell,
        glitterCount: this.glitterPerShell,
        gravity: 0.7,
        drag: 0.94,
        trailSampleAccum: 0,
        glitterSpawned: false,
      });
    }

    for (let i = 0; i < this.totalGlitter; i++) {
      this.glitterPhases[i] = Math.random() * Math.PI * 2;
      this.glitterMaxLives[i] = 2.0;
    }

    // ─── 1. Core Flashes Points ────────────────────────────────────────────
    this.coreGeo = new BufferGeometry();
    this.coreGeo.setAttribute('position', new BufferAttribute(this.corePositions, 3));
    this.coreGeo.setAttribute('customColor', new BufferAttribute(this.coreColors, 3));
    this.coreGeo.setAttribute('alpha', new BufferAttribute(this.coreAlphas, 1));
    this.coreGeo.setAttribute('size', new BufferAttribute(this.coreSizes, 1));

    this.coreMat = new ShaderMaterial({
      uniforms: { uMasterAlpha: { value: 0 } },
      vertexShader: `
        attribute vec3 customColor;
        attribute float alpha;
        attribute float size;
        uniform float uMasterAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = customColor;
          vAlpha = alpha * uMasterAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(size * (1600.0 / max(1.0, -mvPosition.z)), 4.0, 180.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.005) discard;
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;

          // Radiant starburst center flare with vivid hue halo & fine cross-diffraction rays
          float halo = pow(max(0.0, 1.0 - d * 2.0), 2.1);
          float hotCore = exp(-d * 20.0) * 1.25;
          float rayH = max(0.0, 1.0 - abs(c.y) * 22.0) * max(0.0, 1.0 - abs(c.x) * 2.1);
          float rayV = max(0.0, 1.0 - abs(c.x) * 22.0) * max(0.0, 1.0 - abs(c.y) * 2.1);
          float rays = (rayH + rayV) * 0.45;

          vec3 col = mix(vColor, vec3(1.0, 0.98, 0.92), clamp(hotCore * 0.72, 0.0, 1.0));
          float intensity = clamp(halo * 0.70 + hotCore + rays, 0.0, 1.0);
          gl_FragColor = vec4(col, vAlpha * intensity);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.corePoints = new Points(this.coreGeo, this.coreMat);
    this.corePoints.frustumCulled = false;
    this.group.add(this.corePoints);

    // ─── 2. Long Curved Streamer Trails LineSegments ────────────────────────
    this.trailGeo = new BufferGeometry();
    this.trailGeo.setAttribute('position', new BufferAttribute(this.trailPositions, 3));
    this.trailGeo.setAttribute('customColor', new BufferAttribute(this.trailColors, 3));
    this.trailGeo.setAttribute('alpha', new BufferAttribute(this.trailAlphas, 1));

    this.trailMat = new ShaderMaterial({
      uniforms: { uMasterAlpha: { value: 0 } },
      vertexShader: `
        attribute vec3 customColor;
        attribute float alpha;
        uniform float uMasterAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = customColor;
          vAlpha = alpha * uMasterAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.005) discard;
          gl_FragColor = vec4(vColor, vAlpha);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.trailLines = new LineSegments(this.trailGeo, this.trailMat);
    this.trailLines.frustumCulled = false;
    this.group.add(this.trailLines);

    // ─── 3. Sparkling Glitter Embers Points ────────────────────────────────
    this.glitterGeo = new BufferGeometry();
    this.glitterGeo.setAttribute('position', new BufferAttribute(this.glitterPos, 3));
    this.glitterGeo.setAttribute('customColor', new BufferAttribute(this.glitterColors, 3));
    this.glitterGeo.setAttribute('alpha', new BufferAttribute(this.glitterAlphas, 1));
    this.glitterGeo.setAttribute('size', new BufferAttribute(this.glitterSizes, 1));
    this.glitterGeo.setAttribute('sparklePhase', new BufferAttribute(this.glitterPhases, 1));

    this.glitterMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMasterAlpha: { value: 0 },
      },
      vertexShader: `
        attribute vec3 customColor;
        attribute float alpha;
        attribute float size;
        attribute float sparklePhase;

        uniform float uTime;
        uniform float uMasterAlpha;

        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vColor = customColor;
          float twinkle = 0.55 + 0.45 * sin(uTime * 16.0 + sparklePhase);
          vAlpha = alpha * uMasterAlpha * twinkle;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(size * (850.0 / max(1.0, -mvPosition.z)), 2.0, 48.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          if (vAlpha <= 0.005) discard;
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;

          // Crisp 4-point star glitter diamond + bright center
          float starX = max(0.0, 1.0 - abs(c.x) * 5.0) * max(0.0, 1.0 - abs(c.y) * 1.9);
          float starY = max(0.0, 1.0 - abs(c.y) * 5.0) * max(0.0, 1.0 - abs(c.x) * 1.9);
          float core = exp(-d * 13.0) * 1.5;
          float glow = pow(1.0 - d * 2.0, 2.0) * 0.6;
          float a = clamp(max(starX, starY) * 1.1 + core + glow, 0.0, 1.0);

          vec3 col = mix(vColor, vec3(1.0, 0.99, 0.96), clamp(core * 0.75, 0.0, 1.0));
          gl_FragColor = vec4(col, vAlpha * a);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.glitterPoints = new Points(this.glitterGeo, this.glitterMat);
    this.glitterPoints.frustumCulled = false;
    this.group.add(this.glitterPoints);

    this.group.visible = false;
  }

  /**
   * Main per-frame update synchronized with song progression & audio FFT.
   */
  update(deltaSec: number, relativeTime: number, metrics?: AudioMetrics): void {
    // Inactive during Phase 1 and initial Phase 2 lotus + bubble discovery (t < 82s)
    if (relativeTime < FIREWORKS_TIMELINE.tStart || relativeTime >= FIREWORKS_TIMELINE.tEnd) {
      if (this.group.visible) {
        this.reset();
      }
      return;
    }

    this.group.visible = true;

    const dt = Math.min(0.05, Math.max(0.001, deltaSec));

    // Gradual introduction (82s-112s), full display (112s-158s), gentle fade into sparkles (158s-175s)
    let introFactor = 1.0;
    if (relativeTime < FIREWORKS_TIMELINE.tFullStart) {
      introFactor = (relativeTime - FIREWORKS_TIMELINE.tStart) / (FIREWORKS_TIMELINE.tFullStart - FIREWORKS_TIMELINE.tStart);
      this.masterAlpha = Math.min(1.0, introFactor * 1.35);
    } else if (relativeTime < FIREWORKS_TIMELINE.tPostClimax) {
      this.masterAlpha = 1.0;
    } else {
      const fadeOut = 1.0 - (relativeTime - FIREWORKS_TIMELINE.tPostClimax) / (FIREWORKS_TIMELINE.tEnd - FIREWORKS_TIMELINE.tPostClimax);
      this.masterAlpha = Math.max(0, fadeOut);
    }

    this.coreMat.uniforms.uMasterAlpha.value = this.masterAlpha;
    this.trailMat.uniforms.uMasterAlpha.value = relativeTime >= FIREWORKS_TIMELINE.tPostClimax
      ? this.masterAlpha * Math.max(0, 1.0 - (relativeTime - FIREWORKS_TIMELINE.tPostClimax) / 5.0)
      : this.masterAlpha;
    this.glitterMat.uniforms.uMasterAlpha.value = this.masterAlpha;
    this.glitterMat.uniforms.uTime.value = relativeTime;

    const low = metrics?.low ?? 0;
    const high = metrics?.high ?? 0;
    const energy = metrics?.energy ?? 0;
    const beat = metrics?.beat ?? 0;

    // ─── Spawning Logic (stopped after climax at 158s) ──────────────────────
    const isClimaxWindow = relativeTime >= FIREWORKS_TIMELINE.tClimaxStart && relativeTime < FIREWORKS_TIMELINE.tPostClimax;
    const isPostClimax = relativeTime >= FIREWORKS_TIMELINE.tPostClimax;

    if (!isPostClimax) {
      // Handle backward seeking gracefully
      if (relativeTime < this.lastLaunchTime) {
        this.lastLaunchTime = relativeTime - 1.5;
        this.lastBeatPulse = relativeTime - 1.0;
      }

      const isPeak = isClimaxWindow || (introFactor > 0.65 && energy > 0.66);
      const launchInterval = isClimaxWindow
        ? Math.max(0.42, 0.72 - energy * 0.28)
        : (3.6 - introFactor * 2.0 - energy * 0.45);

      const timeSinceLast = relativeTime - this.lastLaunchTime;
      const beatReady = beat > 0.54 && low > 0.40 && (relativeTime - this.lastBeatPulse) > (isClimaxWindow ? 0.38 : 0.65);

      if (timeSinceLast >= launchInterval || (beatReady && timeSinceLast > 0.32)) {
        this.lastLaunchTime = relativeTime;
        if (beatReady) this.lastBeatPulse = relativeTime;

        if (isPeak) {
          // Biggest display during musical climax: 2 to 4 simultaneous 360° bursts
          const salvoCount = isClimaxWindow ? (this.isQuest ? 2 : 3) : 2;
          for (let b = 0; b < salvoCount; b++) {
            const large = b === 0 || Math.random() < 0.65;
            this.spawnFirework(relativeTime, large, low, high);
          }
        } else {
          // Gradual intro / lyrical verses: alternate smaller starbursts with occasional large bursts
          const large = introFactor > 0.35 && Math.random() < (0.25 + introFactor * 0.45);
          this.spawnFirework(relativeTime, large, low, high);
        }
      }
    } else {
      // Post-climax (158s-175s): seed delicate drifting 360° sparkling particles as shells fade out
      this.postClimaxSparkleAccum += dt;
      if (this.postClimaxSparkleAccum >= 0.08 && this.masterAlpha > 0.06) {
        this.postClimaxSparkleAccum = 0;
        this.spawnPostClimaxSparkles(this.isQuest ? 6 : 10);
      }
    }

    // ─── Update Active Shells, Trails, Cores & Ocean Reflection Flashes ────
    const segsPerRay = this.trailPointsPerRay - 1;
    let activeFlashIdx = 0;

    for (let s = 0; s < this.maxShells; s++) {
      const shell = this.shells[s];
      if (!shell.active) {
        this.coreAlphas[s] = 0;
        continue;
      }

      shell.age += dt;
      const progress = shell.age / shell.maxLife;

      if (progress >= 1.0) {
        shell.active = false;
        this.coreAlphas[s] = 0;
        this.clearShellTrails(s);
        continue;
      }

      // 1. Core Flash update (rapid initial bloom, soft glow fade)
      const s3 = s * 3;
      this.corePositions[s3] = shell.center.x;
      this.corePositions[s3 + 1] = shell.center.y;
      this.corePositions[s3 + 2] = shell.center.z;

      let coreFade = 0;
      if (progress < 0.08) {
        coreFade = progress / 0.08;
      } else {
        coreFade = Math.pow(1.0 - (progress - 0.08) / 0.92, 2.3);
      }
      this.coreAlphas[s] = coreFade * shell.coreIntensity;
      this.coreSizes[s] = shell.coreSize * (0.6 + Math.min(1.0, progress * 3.5) * 0.65);

      // Record top active flashes for OceanOfLight water surface reflections
      if (activeFlashIdx < this.activeFlashes.length) {
        const flash = this.activeFlashes[activeFlashIdx];
        flash.position.copy(shell.center);
        flash.color.copy(shell.primaryColor);
        flash.intensity = coreFade * shell.coreIntensity * this.masterAlpha;
        activeFlashIdx++;
      }

      // Spawn trailing glitter cluster right as rays blossom (progress ~ 0.14)
      if (!shell.glitterSpawned && progress >= 0.14) {
        shell.glitterSpawned = true;
        this.activateShellGlitter(shell, high, isPostClimax || relativeTime >= 153.0);
      }

      // 2. Integrate Streamer Ray Heads & Shift History Trail Buffer
      shell.trailSampleAccum += dt;
      const shouldShiftHistory = shell.trailSampleAccum >= 0.048;
      if (shouldShiftHistory) {
        shell.trailSampleAccum = 0;
      }

      const speedDecay = Math.exp(-shell.drag * dt);
      // Streamer trails brighten rapidly, linger cleanly, then fade into lingering glitter
      let trailFade = 1.0;
      if (progress < 0.07) {
        trailFade = progress / 0.07;
      } else if (progress > 0.65) {
        trailFade = Math.max(0, 1.0 - (progress - 0.65) / 0.35);
      }
      if (isPostClimax) {
        trailFade *= 0.45; // Emphasize tiny sparkling embers over long streamers post-climax
      }

      for (let r = 0; r < shell.rayCount; r++) {
        const globalRay = shell.rayOffset + r;
        const r3 = globalRay * 3;

        this.rayVel[r3] *= speedDecay;
        this.rayVel[r3 + 1] = (this.rayVel[r3 + 1] - shell.gravity * dt) * speedDecay;
        this.rayVel[r3 + 2] *= speedDecay;

        const hBase = globalRay * this.trailPointsPerRay * 3;

        // Shift trail history points backward on sample interval
        if (shouldShiftHistory) {
          for (let k = this.trailPointsPerRay - 1; k >= 1; k--) {
            const dst = hBase + k * 3;
            const src = hBase + (k - 1) * 3;
            this.rayHistoryPos[dst] = this.rayHistoryPos[src];
            this.rayHistoryPos[dst + 1] = this.rayHistoryPos[src + 1];
            this.rayHistoryPos[dst + 2] = this.rayHistoryPos[src + 2];
          }
        }

        // Advance leading ray tip [0]
        this.rayHistoryPos[hBase] += this.rayVel[r3] * dt;
        this.rayHistoryPos[hBase + 1] += this.rayVel[r3 + 1] * dt;
        this.rayHistoryPos[hBase + 2] += this.rayVel[r3 + 2] * dt;

        // Write connected line segments into trailPositions / trailColors / trailAlphas
        const lineBaseVert = globalRay * segsPerRay * 2;
        const pR = this.rayPrimaryRGB[r3];
        const pG = this.rayPrimaryRGB[r3 + 1];
        const pB = this.rayPrimaryRGB[r3 + 2];
        const sR = this.raySecondaryRGB[r3];
        const sG = this.raySecondaryRGB[r3 + 1];
        const sB = this.raySecondaryRGB[r3 + 2];

        for (let seg = 0; seg < segsPerRay; seg++) {
          const v0 = lineBaseVert + seg * 2;
          const v1 = v0 + 1;
          const v03 = v0 * 3;
          const v13 = v1 * 3;

          const p0 = hBase + seg * 3;
          const p1 = hBase + (seg + 1) * 3;

          this.trailPositions[v03] = this.rayHistoryPos[p0];
          this.trailPositions[v03 + 1] = this.rayHistoryPos[p0 + 1];
          this.trailPositions[v03 + 2] = this.rayHistoryPos[p0 + 2];

          this.trailPositions[v13] = this.rayHistoryPos[p1];
          this.trailPositions[v13 + 1] = this.rayHistoryPos[p1 + 1];
          this.trailPositions[v13 + 2] = this.rayHistoryPos[p1 + 2];

          const t0 = seg / segsPerRay;
          const t1 = (seg + 1) / segsPerRay;

          // Tip starts bright primary/white-hot, trailing tail shifts into secondary hue and fades
          this.trailColors[v03] = pR + (sR - pR) * t0;
          this.trailColors[v03 + 1] = pG + (sG - pG) * t0;
          this.trailColors[v03 + 2] = pB + (sB - pB) * t0;

          this.trailColors[v13] = pR + (sR - pR) * t1;
          this.trailColors[v13 + 1] = pG + (sG - pG) * t1;
          this.trailColors[v13 + 2] = pB + (sB - pB) * t1;

          this.trailAlphas[v0] = (1.0 - t0 * 0.72) * trailFade * 0.92;
          this.trailAlphas[v1] = (1.0 - t1 * 0.85) * trailFade * 0.92;
        }
      }
    }

    for (let f = activeFlashIdx; f < this.activeFlashes.length; f++) {
      this.activeFlashes[f].intensity = 0;
    }

    // ─── 3. Update Sparkling Glitter & Post-Climax Drifting Embers ──────────
    for (let g = 0; g < this.totalGlitter; g++) {
      if (this.glitterAlphas[g] <= 0.002 && this.glitterAges[g] <= 0) continue;

      this.glitterAges[g] += dt;
      const gProg = this.glitterAges[g] / this.glitterMaxLives[g];
      if (gProg >= 1.0) {
        this.glitterAlphas[g] = 0;
        this.glitterAges[g] = 0;
        continue;
      }

      const g3 = g * 3;
      const gDrag = Math.exp((isPostClimax ? -0.90 : -1.35) * dt);
      const gGrav = isPostClimax ? 0.28 : 0.62;

      this.glitterVel[g3] *= gDrag;
      this.glitterVel[g3 + 1] = (this.glitterVel[g3 + 1] - gGrav * dt) * gDrag;
      this.glitterVel[g3 + 2] *= gDrag;

      this.glitterPos[g3] += this.glitterVel[g3] * dt;
      this.glitterPos[g3 + 1] += this.glitterVel[g3 + 1] * dt;
      this.glitterPos[g3 + 2] += this.glitterVel[g3 + 2] * dt;

      let gAlpha = 1.0;
      if (gProg < 0.12) {
        gAlpha = gProg / 0.12;
      } else {
        gAlpha = Math.pow(1.0 - (gProg - 0.12) / 0.88, 1.35);
      }
      this.glitterAlphas[g] = gAlpha * (0.85 + high * 0.35);
    }

    this.coreGeo.attributes.position.needsUpdate = true;
    this.coreGeo.attributes.alpha.needsUpdate = true;
    this.coreGeo.attributes.size.needsUpdate = true;

    this.trailGeo.attributes.position.needsUpdate = true;
    this.trailGeo.attributes.customColor.needsUpdate = true;
    this.trailGeo.attributes.alpha.needsUpdate = true;

    this.glitterGeo.attributes.position.needsUpdate = true;
    this.glitterGeo.attributes.alpha.needsUpdate = true;
  }

  /**
   * Spawns a new 360° firework shell (large detailed explosion or compact crisp starburst).
   */
  private spawnFirework(
    relativeTime: number,
    isLarge: boolean,
    bassBoost: number,
    sparkleBoost: number
  ): void {
    let shellIdx = -1;
    for (let s = 0; s < this.maxShells; s++) {
      if (!this.shells[s].active) {
        shellIdx = s;
        break;
      }
    }
    if (shellIdx === -1) return;

    const shell = this.shells[shellIdx];

    // Rotate systematically across 6 distinct 360° sky regions (front, back, left, right, overhead, horizon)
    const region = this.spawnRegionCursor % 6;
    this.spawnRegionCursor++;

    let azimuth = 0;
    let elevation = 0.45;
    let distance = 30.0;

    if (region === 0) {
      // Front-Left Sky (frames Crystal Lotus & horizon clearly)
      azimuth = -Math.PI * (0.08 + Math.random() * 0.26);
      elevation = 0.12 + Math.random() * 0.24;
      distance = 22.0 + Math.random() * 18.0;
    } else if (region === 1) {
      // Front-Right Sky (frames Crystal Lotus & horizon clearly)
      azimuth = Math.PI * (0.08 + Math.random() * 0.26);
      elevation = 0.12 + Math.random() * 0.24;
      distance = 22.0 + Math.random() * 18.0;
    } else if (region === 2) {
      // Behind-Left Sky (discoverable when turning seated chair!)
      azimuth = -Math.PI * (0.60 + Math.random() * 0.36);
      elevation = 0.14 + Math.random() * 0.28;
      distance = 20.0 + Math.random() * 20.0;
    } else if (region === 3) {
      // Behind-Right Sky
      azimuth = Math.PI * (0.60 + Math.random() * 0.36);
      elevation = 0.14 + Math.random() * 0.28;
      distance = 20.0 + Math.random() * 20.0;
    } else if (region === 4) {
      // High Overhead Canopy
      azimuth = Math.random() * Math.PI * 2;
      elevation = 0.55 + Math.random() * 0.58; // ~32° to 65° upward
      distance = 16.0 + Math.random() * 14.0;
    } else {
      // Wide Horizon Panorama (360° low sky rim)
      azimuth = (relativeTime * 1.1 + Math.random() * 1.8) % (Math.PI * 2);
      elevation = 0.10 + Math.random() * 0.14; // ~6° to 14° above horizon
      distance = 25.0 + Math.random() * 18.0;
    }

    const cosE = Math.cos(elevation);
    const cx = Math.sin(azimuth) * distance * cosE;
    const cy = 2.0 + Math.sin(elevation) * distance;
    const cz = -Math.cos(azimuth) * distance * cosE; // -Z is forward

    shell.center.set(cx, cy, cz);
    shell.active = true;
    shell.age = 0;
    shell.isLarge = isLarge;
    shell.trailSampleAccum = 0;
    shell.glitterSpawned = false;

    // Choose style
    if (!isLarge) {
      shell.style = 'starburst';
      shell.maxLife = 1.9 + Math.random() * 0.5;
      shell.gravity = 0.55;
      shell.drag = 0.92;
      shell.rayCount = Math.min(this.maxRaysPerShell, this.isQuest ? 24 : 32);
      shell.coreSize = 1.65;
    } else {
      const roll = Math.random();
      if (roll < 0.42) {
        shell.style = 'chrysanthemum';
        shell.maxLife = 2.6 + Math.random() * 0.7;
        shell.gravity = 0.75;
        shell.drag = 0.945;
      } else if (roll < 0.78) {
        shell.style = 'willow';
        shell.maxLife = 3.2 + Math.random() * 0.8;
        shell.gravity = 1.05;
        shell.drag = 0.955;
      } else {
        shell.style = 'double_ring';
        shell.maxLife = 2.5 + Math.random() * 0.6;
        shell.gravity = 0.65;
        shell.drag = 0.935;
      }
      shell.rayCount = this.maxRaysPerShell;
      shell.coreSize = 2.4 + Math.random() * 0.75;
    }

    const palette = FIREWORK_PALETTE[Math.floor(Math.random() * FIREWORK_PALETTE.length)];
    shell.primaryColor.copy(palette.primary);
    shell.secondaryColor.copy(palette.secondary);
    shell.coreIntensity = (isLarge ? 1.25 : 0.95) + bassBoost * 0.5;

    // Set core color
    const s3 = shellIdx * 3;
    this.coreColors[s3] = palette.core.r;
    this.coreColors[s3 + 1] = palette.core.g;
    this.coreColors[s3 + 2] = palette.core.b;
    this.corePositions[s3] = cx;
    this.corePositions[s3 + 1] = cy;
    this.corePositions[s3 + 2] = cz;
    this.coreAlphas[shellIdx] = 1.0;

    // Clear unused rays if shell uses fewer rays (smaller starburst)
    if (shell.rayCount < this.maxRaysPerShell) {
      this.clearTrailingRaysRange(shell.rayOffset + shell.rayCount, shell.rayOffset + this.maxRaysPerShell);
    }

    // Initialize streamer rays using spherical Fibonacci / double-ring distribution
    const baseSpeed = isLarge
      ? (10.5 + Math.random() * 4.5 + bassBoost * 3.0) * (shell.style === 'willow' ? 0.85 : 1.0)
      : (6.5 + Math.random() * 3.0);

    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    // View-facing orthonormal basis from seated origin (0, 1.2, 0) -> shell.center for rosette rings
    let fx = cx;
    let fy = cy - 1.2;
    let fz = cz;
    const fLen = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
    fx /= fLen; fy /= fLen; fz /= fLen;
    let rx = -fz;
    let ry = 0;
    let rz = fx;
    const rLen = Math.hypot(rx, rz);
    if (rLen > 0.01) {
      rx /= rLen; rz /= rLen;
    } else {
      rx = 1; ry = 0; rz = 0;
    }
    const ux = fy * rz - fz * ry;
    const uy = fz * rx - fx * rz;
    const uz = fx * ry - fy * rx;

    for (let r = 0; r < shell.rayCount; r++) {
      const globalRay = shell.rayOffset + r;
      const r3 = globalRay * 3;

      let dirX = 0;
      let dirY = 0;
      let dirZ = 0;
      let speedMul = 1.0;

      if (shell.style === 'double_ring') {
        const isInner = r % 3 === 0;
        const ringIdx = isInner ? Math.floor(r / 3) : r - Math.floor(r / 3);
        const ringTotal = isInner ? Math.ceil(shell.rayCount / 3) : shell.rayCount - Math.ceil(shell.rayCount / 3);
        const angle = (ringIdx / Math.max(1, ringTotal)) * Math.PI * 2;
        const cA = Math.cos(angle);
        const sA = Math.sin(angle);
        const depthJitter = (Math.random() - 0.5) * 0.30;
        dirX = rx * cA + ux * sA + fx * depthJitter + (Math.random() - 0.5) * 0.06;
        dirY = ry * cA + uy * sA + fy * depthJitter + (Math.random() - 0.5) * 0.06;
        dirZ = rz * cA + uz * sA + fz * depthJitter + (Math.random() - 0.5) * 0.06;
        const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
        dirX /= len; dirY /= len; dirZ /= len;
        speedMul = isInner ? 0.56 : 1.0;
      } else {
        // Uniform Fibonacci sphere with organic jitter for crisp flower-petal starbursts
        const y = 1 - (r / Math.max(1, shell.rayCount - 1)) * 2;
        const rad = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = goldenAngle * r + (Math.random() - 0.5) * 0.18;
        dirX = Math.cos(theta) * rad;
        dirY = y + (Math.random() - 0.5) * 0.10;
        dirZ = Math.sin(theta) * rad;
        const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
        dirX /= len; dirY /= len; dirZ /= len;
        speedMul = 0.85 + Math.random() * 0.30;
      }

      const speed = baseSpeed * speedMul;
      this.rayVel[r3] = dirX * speed;
      this.rayVel[r3 + 1] = dirY * speed;
      this.rayVel[r3 + 2] = dirZ * speed;

      // Initialize all 5 trail history points at explosion center
      const hBase = globalRay * this.trailPointsPerRay * 3;
      for (let k = 0; k < this.trailPointsPerRay; k++) {
        this.rayHistoryPos[hBase + k * 3] = cx;
        this.rayHistoryPos[hBase + k * 3 + 1] = cy;
        this.rayHistoryPos[hBase + k * 3 + 2] = cz;
      }

      // Tip leans slightly golden-white/bright primary, tail flows into secondary color
      const tipBlend = Math.random() < 0.25 ? 0.45 : 0.18;
      this.rayPrimaryRGB[r3] = palette.primary.r + (1.0 - palette.primary.r) * tipBlend;
      this.rayPrimaryRGB[r3 + 1] = palette.primary.g + (1.0 - palette.primary.g) * tipBlend;
      this.rayPrimaryRGB[r3 + 2] = palette.primary.b + (1.0 - palette.primary.b) * tipBlend;

      this.raySecondaryRGB[r3] = palette.secondary.r;
      this.raySecondaryRGB[r3 + 1] = palette.secondary.g;
      this.raySecondaryRGB[r3 + 2] = palette.secondary.b;
    }

    this.coreGeo.attributes.customColor.needsUpdate = true;
    this.coreGeo.attributes.size.needsUpdate = true;
    this.coreGeo.attributes.alpha.needsUpdate = true;
  }

  /**
   * Emits sparkling trailing glitter embers along the expanding firework shell rays.
   */
  private activateShellGlitter(shell: FireworkShell, highFreq: number, isPostClimax: boolean): void {
    const count = shell.isLarge ? shell.glitterCount : Math.floor(shell.glitterCount * 0.55);

    for (let i = 0; i < count; i++) {
      const gIdx = shell.glitterStart + i;
      const g3 = gIdx * 3;

      // Distribute glitter beads along the streamer ray length from 30% to 105% of tip distance
      const rayPick = i % shell.rayCount;
      const globalRay = shell.rayOffset + rayPick;
      const hBase = globalRay * this.trailPointsPerRay * 3;
      const r3 = globalRay * 3;
      const armFraction = 0.28 + ((Math.floor(i / shell.rayCount) + Math.random() * 0.65) / Math.max(1, Math.ceil(count / shell.rayCount))) * 0.78;

      this.glitterPos[g3] = shell.center.x + (this.rayHistoryPos[hBase] - shell.center.x) * armFraction + (Math.random() - 0.5) * 0.35;
      this.glitterPos[g3 + 1] = shell.center.y + (this.rayHistoryPos[hBase + 1] - shell.center.y) * armFraction + (Math.random() - 0.5) * 0.35;
      this.glitterPos[g3 + 2] = shell.center.z + (this.rayHistoryPos[hBase + 2] - shell.center.z) * armFraction + (Math.random() - 0.5) * 0.35;

      const velScale = armFraction * (0.78 + Math.random() * 0.25);
      this.glitterVel[g3] = this.rayVel[r3] * velScale + (Math.random() - 0.5) * 0.9;
      this.glitterVel[g3 + 1] = this.rayVel[r3 + 1] * velScale + (Math.random() - 0.5) * 0.9;
      this.glitterVel[g3 + 2] = this.rayVel[r3 + 2] * velScale + (Math.random() - 0.5) * 0.9;

      // Mix golden-white sparkles with shell primary & secondary colors
      const roll = Math.random();
      if (roll < 0.35) {
        // Golden-white shimmer
        this.glitterColors[g3] = 1.0;
        this.glitterColors[g3 + 1] = 0.96;
        this.glitterColors[g3 + 2] = 0.76;
      } else if (roll < 0.70) {
        this.glitterColors[g3] = shell.primaryColor.r;
        this.glitterColors[g3 + 1] = shell.primaryColor.g;
        this.glitterColors[g3 + 2] = shell.primaryColor.b;
      } else {
        this.glitterColors[g3] = shell.secondaryColor.r;
        this.glitterColors[g3 + 1] = shell.secondaryColor.g;
        this.glitterColors[g3 + 2] = shell.secondaryColor.b;
      }

      this.glitterAlphas[gIdx] = 1.0;
      this.glitterSizes[gIdx] = (this.isQuest ? 0.11 : 0.14) * (isPostClimax ? 0.72 : (0.78 + Math.random() * 0.68 + highFreq * 0.35));
      this.glitterAges[gIdx] = 0.001;
      this.glitterMaxLives[gIdx] = (isPostClimax ? 5.2 : 2.3) + Math.random() * 1.4;
    }

    this.glitterGeo.attributes.customColor.needsUpdate = true;
    this.glitterGeo.attributes.size.needsUpdate = true;
  }

  /**
   * Seeds gentle 360° dissolving glitter sparkles during post-climax (158s-175s).
   */
  private spawnPostClimaxSparkles(count: number): void {
    for (let i = 0; i < count; i++) {
      const gIdx = this.nextAmbientGlitterCursor % this.totalGlitter;
      this.nextAmbientGlitterCursor++;
      if (this.glitterAlphas[gIdx] > 0.15) continue;

      const az = Math.random() * Math.PI * 2;
      const el = 0.08 + Math.random() * 0.72;
      const dist = 14.0 + Math.random() * 22.0;
      const cosE = Math.cos(el);
      const g3 = gIdx * 3;

      this.glitterPos[g3] = Math.sin(az) * dist * cosE;
      this.glitterPos[g3 + 1] = 2.5 + Math.sin(el) * dist;
      this.glitterPos[g3 + 2] = -Math.cos(az) * dist * cosE;

      this.glitterVel[g3] = (Math.random() - 0.5) * 0.6;
      this.glitterVel[g3 + 1] = -0.25 - Math.random() * 0.45;
      this.glitterVel[g3 + 2] = (Math.random() - 0.5) * 0.6;

      const palette = FIREWORK_PALETTE[Math.floor(Math.random() * FIREWORK_PALETTE.length)];
      const col = Math.random() < 0.4 ? palette.core : palette.primary;
      this.glitterColors[g3] = col.r;
      this.glitterColors[g3 + 1] = col.g;
      this.glitterColors[g3 + 2] = col.b;

      this.glitterAlphas[gIdx] = 0.85;
      this.glitterSizes[gIdx] = (this.isQuest ? 0.09 : 0.11) * (0.65 + Math.random() * 0.6);
      this.glitterAges[gIdx] = 0.001;
      this.glitterMaxLives[gIdx] = 2.8 + Math.random() * 1.8;
    }

    this.glitterGeo.attributes.customColor.needsUpdate = true;
    this.glitterGeo.attributes.size.needsUpdate = true;
  }

  private clearShellTrails(shellIdx: number): void {
    const startRay = shellIdx * this.maxRaysPerShell;
    this.clearTrailingRaysRange(startRay, startRay + this.maxRaysPerShell);
  }

  private clearTrailingRaysRange(startRay: number, endRay: number): void {
    const segsPerRay = this.trailPointsPerRay - 1;
    for (let r = startRay; r < endRay; r++) {
      const lineBaseVert = r * segsPerRay * 2;
      for (let k = 0; k < segsPerRay * 2; k++) {
        this.trailAlphas[lineBaseVert + k] = 0;
      }
    }
  }

  /**
   * Returns current active firework flashes for ocean water reflections.
   */
  getActiveFlashes(): FireworkFlash[] {
    return this.activeFlashes;
  }

  reset(): void {
    this.masterAlpha = 0;
    this.lastLaunchTime = 0;
    this.lastBeatPulse = 0;
    this.postClimaxSparkleAccum = 0;
    this.group.visible = false;

    for (let s = 0; s < this.maxShells; s++) {
      this.shells[s].active = false;
      this.coreAlphas[s] = 0;
    }
    for (let i = 0; i < this.trailAlphas.length; i++) {
      this.trailAlphas[i] = 0;
    }
    for (let g = 0; g < this.totalGlitter; g++) {
      this.glitterAlphas[g] = 0;
      this.glitterAges[g] = 0;
    }
    for (let f = 0; f < this.activeFlashes.length; f++) {
      this.activeFlashes[f].intensity = 0;
    }

    if (this.coreGeo.attributes.alpha) this.coreGeo.attributes.alpha.needsUpdate = true;
    if (this.trailGeo.attributes.alpha) this.trailGeo.attributes.alpha.needsUpdate = true;
    if (this.glitterGeo.attributes.alpha) this.glitterGeo.attributes.alpha.needsUpdate = true;
  }

  dispose(): void {
    this.group.clear();
    this.coreGeo.dispose();
    this.coreMat.dispose();
    this.trailGeo.dispose();
    this.trailMat.dispose();
    this.glitterGeo.dispose();
    this.glitterMat.dispose();
  }
}
