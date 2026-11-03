/**
 * CosmicFireworks: 360° celestial fireworks spectacle for Phase 2 (Crystal Lotus & Cosmic Ocean).
 *
 * Features:
 *  - 360° distribution at varied azimuths, elevations (10° to 75°), and distances (15m to 55m).
 *  - Palette: cyan, turquoise, violet, lavender, pink, rose gold, golden-white.
 *  - Glowing core flashes, detailed radial particle bursts, sparkling fragments, and lingering willow trails.
 *  - Music synchronised:
 *      * Bass kicks trigger powerful bursts and core expansions.
 *      * Musical climaxes trigger grand multi-burst simultaneous fireworks in 360°.
 *      * Quiet passages feature delicate, solitary distant bursts.
 *  - High performance: single pooled BufferGeometry, zero per-frame heap allocations, Quest 3S optimized.
 *  - Feeds active burst positions and colors to OceanOfLight for surface reflections.
 */

import {
  Group,
  Points,
  BufferGeometry,
  Float32BufferAttribute,
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

interface FireworkShell {
  active: boolean;
  type: 'peony' | 'willow' | 'chrysanthemum' | 'double_ring';
  center: Vector3;
  primaryColor: Color;
  secondaryColor: Color;
  age: number;
  maxLife: number;
  coreRadius: number;
  coreIntensity: number;
  particleStartIndex: number;
  particleCount: number;
  gravity: number;
  drag: number;
}

const FIREWORK_PALETTE = [
  { primary: new Color(0x00f2fe), secondary: new Color(0x38ef7d) }, // Cyan & Turquoise
  { primary: new Color(0x1de9b6), secondary: new Color(0xfff2b2) }, // Turquoise & Golden-White
  { primary: new Color(0x8a2be2), secondary: new Color(0xb39ddb) }, // Violet & Lavender
  { primary: new Color(0xb39ddb), secondary: new Color(0xff77e9) }, // Lavender & Pink
  { primary: new Color(0xff77e9), secondary: new Color(0xf4a4a8) }, // Pink & Rose Gold
  { primary: new Color(0xf4a4a8), secondary: new Color(0xfff2b2) }, // Rose Gold & Golden-White
  { primary: new Color(0xfff2b2), secondary: new Color(0x00e5ff) }, // Golden-White & Cyan
];

export class CosmicFireworks {
  readonly group: Group = new Group();

  private isQuest: boolean;
  private maxShells: number;
  private particlesPerShell: number;
  private totalParticles: number;

  private shells: FireworkShell[] = [];

  // Pooled geometry & buffers
  private particleGeo: BufferGeometry;
  private particleMat: ShaderMaterial;
  private particlePoints: Points;

  private positions: Float32Array;
  private velocities: Float32Array;
  private colors: Float32Array;
  private alphas: Float32Array;
  private sizes: Float32Array;
  private sparklePhases: Float32Array;

  // Music timing & trigger state
  private lastLaunchTime = 0;
  private launchInterval = 1.8;
  private lastBeatPulse = 0;
  private masterAlpha = 0;

  // Active flash highlights for ocean reflection
  private activeFlashes: FireworkFlash[] = [
    { position: new Vector3(0, 15, -25), color: new Color(0x00f2fe), intensity: 0 },
    { position: new Vector3(-20, 18, -15), color: new Color(0xff77e9), intensity: 0 },
    { position: new Vector3(20, 16, -20), color: new Color(0x8a2be2), intensity: 0 },
    { position: new Vector3(0, 22, 25), color: new Color(0xfff2b2), intensity: 0 },
  ];

  // Scratch objects for zero allocation
  private scratchVec = new Vector3();

  constructor(isQuest = false) {
    this.isQuest = isQuest;
    this.maxShells = isQuest ? 8 : 14;
    this.particlesPerShell = isQuest ? 80 : 130;
    this.totalParticles = this.maxShells * this.particlesPerShell;

    this.positions = new Float32Array(this.totalParticles * 3);
    this.velocities = new Float32Array(this.totalParticles * 3);
    this.colors = new Float32Array(this.totalParticles * 3);
    this.alphas = new Float32Array(this.totalParticles);
    this.sizes = new Float32Array(this.totalParticles);
    this.sparklePhases = new Float32Array(this.totalParticles);

    // Initialize shells pool
    for (let s = 0; s < this.maxShells; s++) {
      this.shells.push({
        active: false,
        type: 'peony',
        center: new Vector3(),
        primaryColor: new Color(),
        secondaryColor: new Color(),
        age: 0,
        maxLife: 2.5,
        coreRadius: 0.8,
        coreIntensity: 0,
        particleStartIndex: s * this.particlesPerShell,
        particleCount: this.particlesPerShell,
        gravity: 0.6,
        drag: 0.94,
      });
    }

    // Initialize all particles hidden
    for (let i = 0; i < this.totalParticles; i++) {
      this.alphas[i] = 0;
      this.sizes[i] = isQuest ? 0.08 : 0.12;
      this.sparklePhases[i] = Math.random() * Math.PI * 2;
    }

    this.particleGeo = new BufferGeometry();
    this.particleGeo.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    this.particleGeo.setAttribute('customColor', new Float32BufferAttribute(this.colors, 3));
    this.particleGeo.setAttribute('alpha', new Float32BufferAttribute(this.alphas, 1));
    this.particleGeo.setAttribute('size', new Float32BufferAttribute(this.sizes, 1));
    this.particleGeo.setAttribute('sparklePhase', new Float32BufferAttribute(this.sparklePhases, 1));

    this.particleMat = new ShaderMaterial({
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
        varying float vSparkle;

        void main() {
          vColor = customColor;
          // Sparkle twinkle factor
          float twinkle = 0.75 + 0.25 * sin(uTime * 14.0 + sparklePhase);
          vAlpha = alpha * uMasterAlpha * twinkle;
          vSparkle = sparklePhase;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (260.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 1.5, 48.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSparkle;

        void main() {
          if (vAlpha <= 0.01) discard;

          vec2 coord = gl_PointCoord - vec2(0.5);
          float dist = length(coord);
          if (dist > 0.5) discard;

          // Glowing round star particle with brilliant white-hot core
          float glow = pow(1.0 - dist * 2.0, 1.8);
          float coreHot = pow(max(0.0, 1.0 - dist * 3.5), 2.5);

          vec3 finalColor = mix(vColor, vec3(1.0, 1.0, 1.0), coreHot * 0.7);
          gl_FragColor = vec4(finalColor, vAlpha * glow);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    this.particlePoints = new Points(this.particleGeo, this.particleMat);
    this.group.add(this.particlePoints);

    this.group.visible = false;
  }

  /**
   * Main per-frame update.
   */
  update(deltaSec: number, relativeTime: number, metrics?: AudioMetrics): void {
    // Phase 2 timing: 55.0s to 165.0s (dissolves to cosmos at 165.0s - 175.0s)
    if (relativeTime < 55.0 || relativeTime >= 175.0) {
      if (this.group.visible) {
        this.reset();
      }
      return;
    }

    this.group.visible = true;

    // Smooth emergence during 55s - 65s, full during 65s - 165s, fade out during 165s - 175s
    if (relativeTime >= 55.0 && relativeTime <= 65.0) {
      this.masterAlpha = (relativeTime - 55.0) / 10.0;
    } else if (relativeTime > 65.0 && relativeTime < 165.0) {
      this.masterAlpha = 1.0;
    } else if (relativeTime >= 165.0) {
      this.masterAlpha = Math.max(0, 1.0 - (relativeTime - 165.0) / 10.0);
    }
    this.particleMat.uniforms.uMasterAlpha.value = this.masterAlpha;
    this.particleMat.uniforms.uTime.value = relativeTime;

    const low = metrics?.low ?? 0;
    const mid = metrics?.mid ?? 0;
    const high = metrics?.high ?? 0;
    const energy = metrics?.energy ?? 0;
    const beat = metrics?.beat ?? 0;

    // Determine launch rhythm based on music structure
    const isClimaxPrep = relativeTime >= 130.0 && relativeTime <= 165.0;
    const isClimax = isClimaxPrep || energy > 0.72;
    const isQuiet = energy < 0.38 && !isClimaxPrep;

    // Dynamic launch cadence
    if (isClimax) {
      this.launchInterval = 0.55 - energy * 0.25; // Rapid, grand celebration
    } else if (isQuiet) {
      this.launchInterval = 3.2; // Gentle, occasional solitary bursts
    } else {
      this.launchInterval = 1.6 - energy * 0.6; // Steady lyrical cadence
    }

    // Trigger launches on beat or timer
    const timeSinceLast = relativeTime - this.lastLaunchTime;
    const beatTriggered = beat > 0.58 && relativeTime - this.lastBeatPulse > 0.45;

    if (timeSinceLast >= this.launchInterval || (beatTriggered && low > 0.45 && timeSinceLast > 0.35)) {
      this.lastLaunchTime = relativeTime;
      if (beatTriggered) this.lastBeatPulse = relativeTime;

      if (isClimax) {
        // Multi-burst simultaneous salvo in 2 to 4 distinct directions
        const burstCount = this.isQuest ? 2 : 3;
        for (let b = 0; b < burstCount; b++) {
          this.spawnFirework(relativeTime, b, isClimax, low, high);
        }
      } else {
        // Single focused firework
        this.spawnFirework(relativeTime, 0, false, low, high);
      }
    }

    // Update active shells & particles
    let activeFlashIdx = 0;
    for (let s = 0; s < this.maxShells; s++) {
      const shell = this.shells[s];
      if (!shell.active) continue;

      shell.age += deltaSec;
      const progress = shell.age / shell.maxLife;

      if (progress >= 1.0) {
        shell.active = false;
        // Clear particles
        for (let p = 0; p < shell.particleCount; p++) {
          const pIdx = shell.particleStartIndex + p;
          this.alphas[pIdx] = 0;
        }
        continue;
      }

      // Record flash for ocean reflections
      if (activeFlashIdx < this.activeFlashes.length) {
        const flash = this.activeFlashes[activeFlashIdx];
        flash.position.copy(shell.center);
        flash.color.copy(shell.primaryColor);
        // Bright flash early, then fades
        flash.intensity = (1.0 - progress) * shell.coreIntensity * this.masterAlpha;
        activeFlashIdx++;
      }

      // Update particles for this shell
      const start = shell.particleStartIndex;
      const count = shell.particleCount;
      const speedDecay = Math.pow(shell.drag, deltaSec * 60.0);

      for (let p = 0; p < count; p++) {
        const pIdx = start + p;
        const i3 = pIdx * 3;

        // Apply velocity with air drag
        this.velocities[i3] *= speedDecay;
        this.velocities[i3 + 1] = (this.velocities[i3 + 1] - shell.gravity * deltaSec) * speedDecay;
        this.velocities[i3 + 2] *= speedDecay;

        this.positions[i3] += this.velocities[i3] * deltaSec;
        this.positions[i3 + 1] += this.velocities[i3 + 1] * deltaSec;
        this.positions[i3 + 2] += this.velocities[i3 + 2] * deltaSec;

        // Particle fade profile: sharp rise, prolonged glimmer, gentle dissolve
        let alpha = 1.0;
        if (progress < 0.1) {
          alpha = progress / 0.1;
        } else {
          alpha = Math.pow(1.0 - (progress - 0.1) / 0.9, 1.4);
        }

        // High frequency sparkle modulation
        this.alphas[pIdx] = alpha * (0.85 + high * 0.35);
      }
    }

    // Zero out unused reflection flashes
    for (let f = activeFlashIdx; f < this.activeFlashes.length; f++) {
      this.activeFlashes[f].intensity = 0;
    }

    this.particleGeo.attributes.position.needsUpdate = true;
    this.particleGeo.attributes.alpha.needsUpdate = true;
  }

  /**
   * Spawns a new firework shell in the 360° celestial sphere.
   */
  private spawnFirework(
    relativeTime: number,
    subIndex: number,
    isClimax: boolean,
    bassBoost: number,
    sparkleBoost: number
  ): void {
    // Find an inactive shell
    let targetShell: FireworkShell | null = null;
    for (let s = 0; s < this.maxShells; s++) {
      if (!this.shells[s].active) {
        targetShell = this.shells[s];
        break;
      }
    }
    if (!targetShell) return; // Pool full

    // Choose 360° position around seated viewer
    // Azimuth: full 360° with slight offset per subIndex
    const baseAngle = (relativeTime * 0.85 + subIndex * (Math.PI * 0.65) + Math.random() * 0.5) % (Math.PI * 2);
    // Elevation: 12° to 70° (skyward)
    const elevation = 0.22 + Math.random() * 0.75;
    // Distance: varied between 16m and 48m
    const distance = 16.0 + Math.random() * 32.0;

    const cosElev = Math.cos(elevation);
    const x = Math.sin(baseAngle) * distance * cosElev;
    const y = 8.0 + Math.sin(elevation) * distance;
    const z = Math.cos(baseAngle) * distance * cosElev;

    targetShell.center.set(x, y, z);
    targetShell.age = 0;
    targetShell.active = true;

    // Shell type selection
    const typeRoll = Math.random();
    if (typeRoll < 0.35) {
      targetShell.type = 'peony';
      targetShell.maxLife = 2.0 + Math.random() * 0.6;
      targetShell.gravity = 0.5;
      targetShell.drag = 0.93;
    } else if (typeRoll < 0.65) {
      targetShell.type = 'willow';
      targetShell.maxLife = 2.8 + Math.random() * 0.8;
      targetShell.gravity = 0.85;
      targetShell.drag = 0.95; // Lingering trails
    } else if (typeRoll < 0.85) {
      targetShell.type = 'chrysanthemum';
      targetShell.maxLife = 2.4 + Math.random() * 0.5;
      targetShell.gravity = 0.6;
      targetShell.drag = 0.94;
    } else {
      targetShell.type = 'double_ring';
      targetShell.maxLife = 2.2 + Math.random() * 0.5;
      targetShell.gravity = 0.45;
      targetShell.drag = 0.92;
    }

    // Palette selection from user-specified colors
    const palettePair = FIREWORK_PALETTE[Math.floor(Math.random() * FIREWORK_PALETTE.length)];
    targetShell.primaryColor.copy(palettePair.primary);
    targetShell.secondaryColor.copy(palettePair.secondary);

    targetShell.coreIntensity = 1.0 + (isClimax ? 0.8 : 0) + bassBoost * 0.6;

    // Distribute particles radiating outward from center
    const start = targetShell.particleStartIndex;
    const count = targetShell.particleCount;
    const explosionSpeed = (7.5 + Math.random() * 5.0 + bassBoost * 3.5) * (targetShell.type === 'willow' ? 0.85 : 1.0);

    for (let p = 0; p < count; p++) {
      const pIdx = start + p;
      const i3 = pIdx * 3;

      // Start at explosion center
      this.positions[i3] = x;
      this.positions[i3 + 1] = y;
      this.positions[i3 + 2] = z;

      // Radial distribution (Fibonacci sphere or ring)
      let dirX = 0;
      let dirY = 0;
      let dirZ = 0;

      if (targetShell.type === 'double_ring') {
        const isOuterRing = p % 2 === 0;
        const ringAngle = (p / (count * 0.5)) * Math.PI * 2;
        const ringRad = isOuterRing ? 1.0 : 0.65;
        // Tilted ring plane
        dirX = Math.cos(ringAngle) * ringRad;
        dirY = Math.sin(ringAngle) * 0.4 * ringRad + (Math.random() - 0.5) * 0.2;
        dirZ = Math.sin(ringAngle) * ringRad;
      } else {
        // Uniform spherical burst
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2.0 * Math.random() - 1.0);
        dirX = Math.sin(phi) * Math.cos(theta);
        dirY = Math.sin(phi) * Math.sin(theta);
        dirZ = Math.cos(phi);
      }

      const speedVariation = 0.75 + Math.random() * 0.5;
      this.velocities[i3] = dirX * explosionSpeed * speedVariation;
      this.velocities[i3 + 1] = dirY * explosionSpeed * speedVariation;
      this.velocities[i3 + 2] = dirZ * explosionSpeed * speedVariation;

      // Color assignment (blend primary and secondary, or tip with golden-white)
      const colorRatio = Math.random();
      const col = colorRatio < 0.65 ? targetShell.primaryColor : targetShell.secondaryColor;
      this.colors[i3] = col.r;
      this.colors[i3 + 1] = col.g;
      this.colors[i3 + 2] = col.b;

      this.alphas[pIdx] = 1.0;
      this.sizes[pIdx] = (this.isQuest ? 0.09 : 0.13) * (0.8 + Math.random() * 0.6 + sparkleBoost * 0.4);
      this.sparklePhases[pIdx] = Math.random() * Math.PI * 2;
    }

    this.particleGeo.attributes.customColor.needsUpdate = true;
    this.particleGeo.attributes.size.needsUpdate = true;
    this.particleGeo.attributes.sparklePhase.needsUpdate = true;
  }

  /**
   * Returns current active firework flashes for ocean water reflections.
   */
  getActiveFlashes(): FireworkFlash[] {
    return this.activeFlashes;
  }

  reset(): void {
    this.masterAlpha = 0;
    this.group.visible = false;
    for (let s = 0; s < this.maxShells; s++) {
      this.shells[s].active = false;
    }
    for (let i = 0; i < this.totalParticles; i++) {
      this.alphas[i] = 0;
    }
    for (let f = 0; f < this.activeFlashes.length; f++) {
      this.activeFlashes[f].intensity = 0;
    }
    if (this.particleGeo.attributes.alpha) {
      this.particleGeo.attributes.alpha.needsUpdate = true;
    }
  }

  dispose(): void {
    this.group.clear();
    this.particleGeo.dispose();
    this.particleMat.dispose();
  }
}
