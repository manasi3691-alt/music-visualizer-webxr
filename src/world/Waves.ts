/**
 * Waves: Concentric expansion waves / ripples.
 * Emitted deterministically during musical accents and user interaction.
 * Object pooling ensures zero allocations in update().
 */

import {
  Group,
  Mesh,
  RingGeometry,
  MeshBasicMaterial,
  Color,
  AdditiveBlending,
  DoubleSide,
  Vector3,
} from '@iwsdk/core';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

interface WaveInstance {
  mesh: Mesh;
  material: MeshBasicMaterial;
  active: boolean;
  radius: number;
  maxRadius: number;
  expansionSpeed: number;
  opacity: number;
  initialOpacity: number;
}

export class Waves {
  readonly group: Group = new Group();

  private poolSize = 8;
  private wavePool: WaveInstance[] = [];
  private scratchColor = new Color();
  private sharedGeometry: RingGeometry;

  constructor() {
    // Shared ring geometry (innerRadius = 0.95, outerRadius = 1.0, 48 segments)
    this.sharedGeometry = new RingGeometry(0.95, 1.0, 48);

    for (let i = 0; i < this.poolSize; i++) {
      const mat = new MeshBasicMaterial({
        color: 0x99bbff,
        transparent: true,
        opacity: 0,
        side: DoubleSide,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new Mesh(this.sharedGeometry, mat);
      mesh.rotation.x = Math.PI * 0.5;
      mesh.visible = false;
      this.group.add(mesh);

      this.wavePool.push({
        mesh,
        material: mat,
        active: false,
        radius: 0.1,
        maxRadius: 5.0,
        expansionSpeed: 2.2,
        opacity: 0,
        initialOpacity: 0.6,
      });
    }
  }

  emitWave(origin: Vector3, maxRadius = 5.0, speed = 2.4, color?: [number, number, number]): void {
    const wave = this.wavePool.find((w) => !w.active);
    if (!wave) return;

    wave.active = true;
    wave.radius = 0.2;
    wave.maxRadius = maxRadius;
    wave.expansionSpeed = speed;
    wave.initialOpacity = 0.65;
    wave.opacity = wave.initialOpacity;
    wave.mesh.position.copy(origin);
    wave.mesh.scale.set(0.2, 0.2, 0.2);
    wave.mesh.visible = true;

    if (color) {
      wave.material.color.setRGB(...color);
    }
  }

  update(frameData: ConductorFrameData, metrics: AudioMetrics, deltaSec: number): void {
    const { interpolatedColor } = frameData;
    this.scratchColor.setRGB(...interpolatedColor.primaryAccent);

    // Subtle audio-triggered wave emission on musical accents (Level C/B)
    if (metrics.low > 0.45 && Math.random() < 0.08) {
      this.emitWave(
        new Vector3(0, 0.05, -1.0),
        4.5,
        2.5,
        interpolatedColor.warmAccent
      );
    }

    this.wavePool.forEach((w) => {
      if (!w.active) return;

      w.radius += w.expansionSpeed * deltaSec;
      const progress = w.radius / w.maxRadius;

      if (progress >= 1.0) {
        w.active = false;
        w.mesh.visible = false;
        w.material.opacity = 0;
      } else {
        const scale = w.radius;
        w.mesh.scale.set(scale, scale, scale);
        // Fade out as it expands
        w.material.opacity = w.initialOpacity * (1.0 - progress);
      }
    });
  }

  dispose(): void {
    this.sharedGeometry.dispose();
    this.wavePool.forEach((w) => w.material.dispose());
    this.group.clear();
  }
}
