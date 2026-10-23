/**
 * SoundBubbles: Translucent floating spheres distributed throughout the 360° environment.
 *
 * Features:
 * - 40 pooled bubbles (small/medium/large) at varied distances and heights
 * - Beautiful translucent glass material with subtle reflections
 * - Gentle unique float animation per bubble (sine wave)
 * - XR proximity-based pop interaction (same pattern as WristUIController poke)
 * - Pleasant synthesized pop sound via Web Audio API (soft sine chirp)
 * - Pop animation: scale surge → fade, 0.35s total
 * - Cooldown per bubble prevents rapid re-triggering
 * - Bubble sounds much softer than main music
 *
 * Performance: pooled, no per-frame allocations, geometries shared per size class.
 */

import {
  Group,
  Mesh,
  SphereGeometry,
  MeshPhysicalMaterial,
  Color,
  Vector3,
} from '@iwsdk/core';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

interface Bubble {
  mesh: Mesh;
  mat: MeshPhysicalMaterial;
  // Resting position (before float offset)
  restPos: Vector3;
  // Float animation parameters
  floatPhase: number;
  floatSpeed: number;
  floatAmplitude: number;
  // Size category for popping pitch selection
  sizeCategory: 'small' | 'medium' | 'large';
  // Pop state
  isPopping: boolean;
  popProgress: number;   // 0→1 over POP_DURATION
  popCooldown: number;   // seconds remaining until re-poppable
  // Base scale before pop animation
  baseScale: number;
  // Whether visible yet (visibility driven by normalizedProgress)
  active: boolean;
  // Emergence threshold (normalized progress)
  emergeAt: number;
}

const POP_DURATION = 0.35;
const POP_COOLDOWN = 2.5;   // Seconds before same bubble can pop again
const POP_VOLUME   = 0.07;  // Much softer than main music

export class SoundBubbles {
  readonly group: Group = new Group();

  private bubbles: Bubble[] = [];

  // Shared geometries per size class
  private geoSmall:  SphereGeometry;
  private geoMedium: SphereGeometry;
  private geoLarge:  SphereGeometry;

  // Scratch objects
  private scratchBubbleWorldPos = new Vector3();
  private scratchPokerWorldPos  = new Vector3();
  private scratchRayPoint       = new Vector3();
  private scratchToBubble       = new Vector3();

  // Web Audio for pop sounds — created lazily on first pop
  private audioCtx: AudioContext | null = null;

  // XR references (set by ExperienceWorld after XR session starts)
  private xrWorld: any = null; // World reference (typed loosely to avoid circular deps)

  constructor() {
    // Shared geometries
    this.geoSmall  = new SphereGeometry(0.08, 12, 12);
    this.geoMedium = new SphereGeometry(0.16, 14, 14);
    this.geoLarge  = new SphereGeometry(0.28, 16, 16);

    this.buildBubbles();
  }

  /**
   * Set the World reference for XR hand tracking (called when XR becomes active).
   */
  setXRWorld(world: any): void {
    this.xrWorld = world;
  }

  clearXRWorld(): void {
    this.xrWorld = null;
  }

  private buildBubbles(): void {
    const rng = this.seededRand(99);

    // Distribution: rings at varied distances with angular variety
    const placements: { dist: number; heightMin: number; heightMax: number; count: number; size: 'small' | 'medium' | 'large'; emergeAtMin: number; emergeAtMax: number }[] = [
      { dist: 1.5, heightMin: 0.8, heightMax: 2.2, count: 6,  size: 'small',  emergeAtMin: 0.05, emergeAtMax: 0.20 },
      { dist: 2.5, heightMin: 0.5, heightMax: 3.0, count: 8,  size: 'small',  emergeAtMin: 0.10, emergeAtMax: 0.30 },
      { dist: 4.0, heightMin: 1.0, heightMax: 4.0, count: 8,  size: 'medium', emergeAtMin: 0.18, emergeAtMax: 0.40 },
      { dist: 6.0, heightMin: 1.5, heightMax: 5.5, count: 8,  size: 'medium', emergeAtMin: 0.28, emergeAtMax: 0.55 },
      { dist: 9.0, heightMin: 2.0, heightMax: 7.0, count: 6,  size: 'large',  emergeAtMin: 0.40, emergeAtMax: 0.65 },
      { dist: 13.0,heightMin: 3.0, heightMax: 9.0, count: 4,  size: 'large',  emergeAtMin: 0.55, emergeAtMax: 0.78 },
    ];

    // Color palette: translucent blues, teals, soft lavender
    const colors = [0x4488cc, 0x44aaaa, 0x6688bb, 0x4499bb, 0x5577cc, 0x44bbcc];

    for (const p of placements) {
      for (let i = 0; i < p.count; i++) {
        const angle = ((i + rng() * 0.5) / p.count) * Math.PI * 2;
        const r = p.dist + (rng() - 0.5) * 0.8;
        const x = Math.sin(angle) * r;
        const z = Math.cos(angle) * r;
        const y = p.heightMin + rng() * (p.heightMax - p.heightMin);

        const geo = p.size === 'small' ? this.geoSmall : p.size === 'medium' ? this.geoMedium : this.geoLarge;
        const baseScale = p.size === 'small' ? 0.8 + rng() * 0.4 : p.size === 'medium' ? 0.7 + rng() * 0.6 : 0.6 + rng() * 0.8;
        const colorHex = colors[Math.floor(rng() * colors.length)];

        const mat = new MeshPhysicalMaterial({
          color: colorHex,
          emissive: colorHex,
          emissiveIntensity: 0.08,
          roughness: 0.0,
          metalness: 0.0,
          transparent: true,
          opacity: 0.0,
          depthWrite: false,
          // reflectivity helps catch scene light beautifully
          reflectivity: 0.9,
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
          floatSpeed: 0.3 + rng() * 0.4,
          floatAmplitude: 0.04 + rng() * 0.08,
          sizeCategory: p.size,
          isPopping: false,
          popProgress: 0,
          popCooldown: 0,
          baseScale,
          active: false,
          emergeAt: p.emergeAtMin + rng() * (p.emergeAtMax - p.emergeAtMin),
        });
      }
    }

    console.log(`[SoundBubbles] Created ${this.bubbles.length} bubbles`);
  }

  /**
   * Main update — called every frame. Zero heap allocations.
   */
  update(frameData: ConductorFrameData, metrics: AudioMetrics, deltaSec: number): void {
    const norm = frameData.normalizedProgress;
    const t = frameData.relativeTime;

    // Determine XR poking point (right hand index tip or right grip)
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

    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];

      // Cooldown tick
      if (b.popCooldown > 0) b.popCooldown -= deltaSec;

      // Emergence check
      const targetOpacity = norm >= b.emergeAt && norm < 0.95
        ? Math.min(0.55, (norm - b.emergeAt) / 0.08 * 0.55)
        : 0;

      if (!b.isPopping) {
        // Float animation
        const floatY = Math.sin(t * b.floatSpeed + b.floatPhase) * b.floatAmplitude;
        const floatX = Math.cos(t * b.floatSpeed * 0.7 + b.floatPhase + 1.2) * b.floatAmplitude * 0.3;

        b.mesh.position.x = b.restPos.x + floatX;
        b.mesh.position.y = b.restPos.y + floatY;
        b.mesh.position.z = b.restPos.z;

        // Scale
        const vis = Math.max(0, Math.min(1, (norm - b.emergeAt) / 0.08));
        const currentScale = b.baseScale * vis;
        b.mesh.scale.setScalar(Math.max(0.001, currentScale));
        b.mat.opacity = targetOpacity;

        // Subtle emissive pulse with mid frequencies
        b.mat.emissiveIntensity = 0.05 + metrics.mid * 0.15;

        // XR proximity pop check
        if (pokerPos && b.popCooldown <= 0 && vis > 0.5) {
          b.mesh.updateMatrixWorld();
          this.scratchBubbleWorldPos.setFromMatrixPosition(b.mesh.matrixWorld);
          const dist = pokerPos.distanceTo(this.scratchBubbleWorldPos);
          const popRadius = b.sizeCategory === 'small' ? 0.15 : b.sizeCategory === 'medium' ? 0.22 : 0.34;
          if (dist < popRadius) {
            this.triggerPop(b);
          }
        }
      } else {
        // Pop animation: scale surge to 1.8x then shrink to 0
        b.popProgress += deltaSec / POP_DURATION;
        if (b.popProgress >= 1.0) {
          // Pop complete — reset to pre-pop size with cooldown
          b.isPopping = false;
          b.popProgress = 0;
          b.popCooldown = POP_COOLDOWN;
          const vis = Math.max(0, Math.min(1, (norm - b.emergeAt) / 0.08));
          b.mesh.scale.setScalar(Math.max(0.001, b.baseScale * vis));
          b.mat.opacity = targetOpacity;
        } else {
          // Eased pop curve: fast surge then rapid collapse
          const pt = b.popProgress;
          let popScale: number;
          let popOpacity: number;
          if (pt < 0.35) {
            // Surge up
            const s = pt / 0.35;
            popScale = b.baseScale * (1.0 + s * 0.8);
            popOpacity = 0.65;
          } else {
            // Collapse
            const s = (pt - 0.35) / 0.65;
            popScale = b.baseScale * 1.8 * (1.0 - s);
            popOpacity = 0.65 * (1.0 - s * 1.2);
          }
          b.mesh.scale.setScalar(Math.max(0.001, popScale));
          b.mat.opacity = Math.max(0, popOpacity);
        }
      }
    }
  }

  /**
   * Hit-test for desktop clicks or ray-based popping. Zero heap allocations.
   */
  hitTest(rayOrigin: Vector3, rayDir: Vector3): boolean {
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      if (b.popCooldown <= 0 && b.mesh.scale.x > 0.02 && !b.isPopping) {
        b.mesh.updateMatrixWorld();
        this.scratchBubbleWorldPos.setFromMatrixPosition(b.mesh.matrixWorld);

        // Vector from ray origin to bubble center
        this.scratchToBubble.copy(this.scratchBubbleWorldPos).sub(rayOrigin);
        const projection = this.scratchToBubble.dot(rayDir);
        if (projection > 0 && projection < 18.0) {
          // Closest point on ray to bubble
          this.scratchRayPoint.copy(rayOrigin).addScaledVector(rayDir, projection);
          const dist = this.scratchRayPoint.distanceTo(this.scratchBubbleWorldPos);
          const hitRadius = (b.sizeCategory === 'small' ? 0.18 : b.sizeCategory === 'medium' ? 0.28 : 0.42) * (b.mesh.scale.x / b.baseScale);
          if (dist < hitRadius) {
            this.triggerPop(b);
            return true;
          }
        }
      }
    }
    return false;
  }

  private triggerPop(b: Bubble): void {
    b.isPopping = true;
    b.popProgress = 0;
    this.playPopSound(b.sizeCategory);
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

      // Pitch: small = high, large = low
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
      // Ignore audio errors silently
    }
  }

  reset(): void {
    for (const b of this.bubbles) {
      b.isPopping = false;
      b.popProgress = 0;
      b.popCooldown = 0;
      b.active = false;
      b.mesh.scale.setScalar(0.001);
      b.mat.opacity = 0;
    }
  }

  dispose(): void {
    for (const b of this.bubbles) b.mat.dispose();
    this.geoSmall.dispose();
    this.geoMedium.dispose();
    this.geoLarge.dispose();
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
