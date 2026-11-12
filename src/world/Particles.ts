/**
 * Particles: Fine luminous dust floating in the seated user's ambient space.
 * Enforces particle budgets and zero-allocation per-frame updates.
 */

import {
  Group,
  Points,
  BufferGeometry,
  BufferAttribute,
  PointsMaterial,
  Color,
  AdditiveBlending,
} from '@iwsdk/core';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';
import { EXPERIENCE_CONFIG } from '../app/ExperienceConfig.js';

export class Particles {
  readonly group: Group = new Group();

  private pointsMesh: Points;
  private geometry: BufferGeometry;
  private material: PointsMaterial;

  private particleCount: number;
  private positions: Float32Array;
  private velocities: Float32Array;
  private baseAlpha: Float32Array;

  private scratchColor = new Color();

  constructor(isQuest = false) {
    this.particleCount = isQuest
      ? EXPERIENCE_CONFIG.quality.quest.maxParticles
      : EXPERIENCE_CONFIG.quality.desktop.maxParticles;

    this.positions = new Float32Array(this.particleCount * 3);
    this.velocities = new Float32Array(this.particleCount * 3);
    this.baseAlpha = new Float32Array(this.particleCount);

    // Distribute particles in a cylindrical hemisphere around seated user
    for (let i = 0; i < this.particleCount; i++) {
      const idx = i * 3;
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.8 + Math.random() * 3.5;
      const height = 0.2 + Math.random() * 2.8;

      this.positions[idx] = Math.cos(angle) * radius;
      this.positions[idx + 1] = height;
      this.positions[idx + 2] = Math.sin(angle) * radius - 0.5; // Centered slightly forward

      // Slow upward & gentle rotational velocity
      this.velocities[idx] = (-Math.sin(angle) * 0.04) * (0.5 + Math.random() * 0.5);
      this.velocities[idx + 1] = 0.05 + Math.random() * 0.08;
      this.velocities[idx + 2] = (Math.cos(angle) * 0.04) * (0.5 + Math.random() * 0.5);

      this.baseAlpha[i] = 0.3 + Math.random() * 0.7;
    }

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));

    this.material = new PointsMaterial({
      color: 0xbbccff,
      size: 0.035,
      transparent: true,
      opacity: 0.0,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    this.pointsMesh = new Points(this.geometry, this.material);
    this.group.add(this.pointsMesh);
  }

  update(frameData: ConductorFrameData, metrics: AudioMetrics, deltaSec: number): void {
    const { normalizedProgress, interpolatedColor } = frameData;

    const relTime = frameData.relativeTime;

    this.scratchColor.setRGB(...interpolatedColor.primaryAccent);

    // Transition 1 boost (55s -> 65s): particles swirl as city dissolves into aurora ribbons & ocean
    const isTransition1 = relTime >= 55.0 && relTime <= 65.0;
    const t1Factor = isTransition1 ? Math.sin(((relTime - 55.0) / 10.0) * Math.PI) : 0;

    // Transition 2 boost (161s -> 175s): currents rise into star trails
    const isTransition2 = relTime >= 161.0 && relTime <= 175.0;
    const t2Factor = isTransition2 ? Math.sin(((relTime - 161.0) / 14.0) * Math.PI) : 0;

    if (t1Factor > 0) {
      // Blend toward bioluminescent aurora cyan/emerald
      this.scratchColor.r = this.scratchColor.r * (1.0 - t1Factor * 0.5) + 0.15 * t1Factor * 0.5;
      this.scratchColor.g = this.scratchColor.g * (1.0 - t1Factor * 0.5) + 0.95 * t1Factor * 0.5;
      this.scratchColor.b = this.scratchColor.b * (1.0 - t1Factor * 0.5) + 0.98 * t1Factor * 0.5;
    } else if (t2Factor > 0) {
      // Blend toward radiant celestial white-cyan star trail glow
      this.scratchColor.r = this.scratchColor.r * (1.0 - t2Factor * 0.4) + 0.90 * t2Factor * 0.4;
      this.scratchColor.g = this.scratchColor.g * (1.0 - t2Factor * 0.4) + 0.95 * t2Factor * 0.4;
      this.scratchColor.b = this.scratchColor.b * (1.0 - t2Factor * 0.4) + 1.00 * t2Factor * 0.4;
    }

    this.material.color.copy(this.scratchColor);

    // Particle visibility ramps smoothly with experience progression
    let overallOpacity = 0.25;
    if (normalizedProgress > 0.08) {
      overallOpacity = Math.min(0.85, 0.25 + normalizedProgress * 0.6);
    }
    if (normalizedProgress >= 0.96) {
      // Release fade out
      overallOpacity = Math.max(0.15, (1.0 - normalizedProgress) / 0.04 * 0.85);
    }

    // Highs and mids excite particle opacity and scale smoothly without jitter
    const microJitter = 1.0 + metrics.high * 0.12 + t1Factor * 0.25 + t2Factor * 0.35;
    this.material.opacity = Math.min(0.95, overallOpacity * (0.8 + metrics.mid * 0.25 + t1Factor * 0.2 + t2Factor * 0.25));
    this.material.size = 0.034 * microJitter;

    // Upward flow speed increases during transitions, musical builds, and climaxes
    const transitionSpeed = 1.0 + t1Factor * 0.85 + t2Factor * 1.5;
    const speedMultiplier = (1.0 + (normalizedProgress > 0.45 ? 0.4 : 0.0) + metrics.energy * 0.45) * transitionSpeed;

    const posAttr = this.geometry.getAttribute('position') as BufferAttribute;
    const array = posAttr.array as Float32Array;

    for (let i = 0; i < this.particleCount; i++) {
      const idx = i * 3;

      // Update positions
      array[idx] += this.velocities[idx] * speedMultiplier * deltaSec;
      array[idx + 1] += (this.velocities[idx + 1] * speedMultiplier + t2Factor * 0.2) * deltaSec;
      array[idx + 2] += this.velocities[idx + 2] * speedMultiplier * deltaSec;

      // Wrap around gently if floated too high or drifted too far
      if (array[idx + 1] > 3.8) {
        array[idx + 1] = 0.15;
      }
    }

    posAttr.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.group.clear();
  }
}
