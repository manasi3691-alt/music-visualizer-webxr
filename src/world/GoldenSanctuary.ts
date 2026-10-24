// src/world/GoldenSanctuary.ts
/**
 * GoldenSanctuary: Stage A visual system.
 * Creates tall curved organic towers with warm gold lighting and luminous strands.
 * Reacts to existing audio analyzer: bass drives movement, mids drive illumination,
 * highs drive particle-like strand flicker.
 */
import { Group, Mesh, MeshStandardMaterial, CylinderGeometry, Color, Vector3 } from '@iwsdk/core';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export class GoldenSanctuary {
  readonly group: Group = new Group();
  private towers: { mesh: Mesh; mat: MeshStandardMaterial; baseScaleY: number }[] = [];
  private strandMaterial: MeshStandardMaterial;

  constructor(isQuest: boolean) {
    this.buildTowers(isQuest);
    this.strandMaterial = new MeshStandardMaterial({
      color: 0xffd060,
      emissive: 0xffe080,
      emissiveIntensity: 0.0,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
  }

  private buildTowers(isQuest: boolean) {
    const count = isQuest ? 12 : 20;
    const radius = 6.0;
    const geo = new CylinderGeometry(0.2, 0.5, 1, 8, 1, true);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      const mat = new MeshStandardMaterial({
        color: 0xd0a050,
        emissive: 0xffc040,
        emissiveIntensity: 0.0,
        roughness: 0.4,
        metalness: 0.3,
        transparent: true,
        opacity: 0.0,
        depthWrite: true,
      });
      const mesh = new Mesh(geo, mat);
      mesh.position.set(x, 0.5, z);
      mesh.rotation.y = angle;
      this.group.add(mesh);
      this.towers.push({ mesh, mat, baseScaleY: 1 });
    }
  }

  update(frameData: ConductorFrameData, metrics: AudioMetrics, deltaSec: number): void {
    const { low, mid, high } = metrics;
    // Bass drives slight sway/movement
    const sway = low * 0.05 * Math.sin(frameData.relativeTime * 1.5);
    // Mids drive illumination intensity
    const illum = 0.1 + mid * 0.4;
    // Highs drive strand flicker
    const strandGlow = high * 0.6;

    for (const t of this.towers) {
      t.mesh.position.y = 0.5 + sway;
      t.mat.emissiveIntensity = Math.min(1.0, illum);
    }
    this.strandMaterial.emissiveIntensity = Math.min(1.0, strandGlow);
  }

  reset(): void {
    for (const t of this.towers) {
      t.mesh.position.y = 0.5;
      t.mat.emissiveIntensity = 0.0;
    }
    this.strandMaterial.emissiveIntensity = 0.0;
  }

  dispose(): void {
    for (const t of this.towers) {
      t.mat.dispose();
    }
    this.towers.length = 0;
    this.strandMaterial.dispose();
    this.group.clear();
  }
}
