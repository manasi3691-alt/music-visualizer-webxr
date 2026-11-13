/**
 * FinalCinematic: Handles the official ending sequence for "A Sky Full of Stars".
 * Triggered automatically when the audio playback has 30 seconds remaining.
 * Implements a star canopy, falling stars, and transformation into lotus flowers over the ocean.
 * Integrates minimally without altering existing systems.
 */

import {
  Group,
  Points,
  PointsMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  MeshBasicMaterial,
  SphereGeometry,
  Color,
  Vector3,
} from '@iwsdk/core';
import { audioEngine } from '../audio/AudioEngine';
import { musicExcerpt } from '../audio/MusicExcerpt.js';
import { experienceState } from '../app/ExperienceState.js';

// Simple utility to create a golden lotus-like mesh (placeholder).
function createLotus(): Mesh {
  const geometry = new SphereGeometry(0.06, 8, 8);
  const material = new MeshStandardMaterial({
    color: new Color(0xffd700), // golden
    emissive: new Color(0xffd700),
    emissiveIntensity: 0.6,
    metalness: 0.2,
    roughness: 0.4,
  });
  return new Mesh(geometry, material);
}

export class FinalCinematic {
  readonly group: Group = new Group();

  private started = false;
  private finished = false;
  private starCount = 200;
  private starPoints: Points | null = null;
  private starPositions: Float32Array = new Float32Array(0);
  private starVelocities: Float32Array = new Float32Array(0);
  private lotusMeshes: Mesh[] = [];

  constructor() {
    this.group.name = 'FinalCinematicRoot';
  }

  /** Called each frame from ExperienceWorld.update */
  update(deltaSec: number): void {
    if (this.finished) return;
    const remaining = musicExcerpt.sourceEnd - audioEngine.currentTime;
    if (!this.started && remaining <= 30) {
      this.startSequence();
    }
    if (this.started) {
      this.updateStars(deltaSec);
      this.checkCompletion();
    }
  }

  private startSequence(): void {
    this.started = true;
    console.log('[FinalCinematic] Starting ending sequence');
    const geo = new BufferGeometry();
    const positions = new Float32Array(this.starCount * 3);
    const velocities = new Float32Array(this.starCount * 3);
    for (let i = 0; i < this.starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 30 + Math.random() * 5;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      velocities[i * 3] = 0;
      velocities[i * 3 + 1] = -0.2 - Math.random() * 0.1;
      velocities[i * 3 + 2] = 0;
    }
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.starPositions = positions;
    this.starVelocities = velocities;
    const material = new PointsMaterial({
      size: 0.12,
      color: new Color(0xffd700),
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
    });
    const pts = new Points(geo, material);
    pts.name = 'FinalCinematicStars';
    this.starPoints = pts;
    this.group.add(pts);
  }

  private updateStars(deltaSec: number): void {
    if (!this.starPoints) return;
    const pos = this.starPositions;
    const vel = this.starVelocities;
    const count = this.starCount;
    const hoverY = 0.2;
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      pos[idx] += vel[idx] * deltaSec;
      pos[idx + 1] += vel[idx + 1] * deltaSec;
      pos[idx + 2] += vel[idx + 2] * deltaSec;
      if (pos[idx + 1] < hoverY) {
        pos[idx + 1] = hoverY;
        vel[idx + 1] = 0;
        if (!this.lotusMeshes[i]) {
          const lotus = createLotus();
          lotus.position.set(pos[idx], hoverY, pos[idx + 2]);
          this.group.add(lotus);
          this.lotusMeshes[i] = lotus;
        }
      }
    }
    (this.starPoints.geometry as BufferGeometry).attributes.position.needsUpdate = true;
  }

  private checkCompletion(): void {
    const allLotus = this.lotusMeshes.length === this.starCount && this.lotusMeshes.every((m) => !!m);
    const remaining = musicExcerpt.sourceEnd - audioEngine.currentTime;
    if (allLotus && remaining <= 5) {
      this.lotusMeshes.forEach((m) => {
        m.scale.set(1.5, 1.5, 1.5);
        const mat = m.material as MeshStandardMaterial;
        mat.emissiveIntensity = 1.2;
      });
      this.finished = true;
      console.log('[FinalCinematic] Ending sequence complete');
      if (experienceState.phase !== 'COMPLETE') {
        experienceState.setPhase('COMPLETE');
      }
    }
  }
}
