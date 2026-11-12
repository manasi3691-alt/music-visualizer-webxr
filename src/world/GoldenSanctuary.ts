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
    const relTime = frameData.relativeTime;

    if (relTime >= 65.0) {
      if (this.group.visible) {
        this.group.visible = false;
      }
      return;
    }
    this.group.visible = true;

    // Phase 1 emergence (0s - 18s) and dissolve (55s - 65s)
    const emerge = Math.min(1.0, relTime / 18.0);
    const dissolve = relTime >= 55.0 ? Math.max(0, 1.0 - (relTime - 55.0) / 10.0) : 1.0;
    const targetAlpha = emerge * dissolve * 0.75;

    const { low, mid, high, energy } = metrics;
    // Bass drives gentle organic sway
    const sway = low * 0.04 * Math.sin(frameData.relativeTime * 1.5);
    // Mids and energy drive warm gold illumination
    const illum = 0.15 + mid * 0.35 + energy * 0.25;
    // Highs drive subtle strand radiance
    const strandGlow = high * 0.5 + energy * 0.2;

    for (const t of this.towers) {
      t.mesh.position.y = 0.5 + sway;
      t.mat.opacity = targetAlpha;
      t.mat.emissiveIntensity = Math.min(1.0, illum * dissolve);
    }
    this.strandMaterial.opacity = targetAlpha;
    this.strandMaterial.emissiveIntensity = Math.min(1.0, strandGlow * dissolve);
  }

  reset(): void {
    this.group.visible = true;
    for (const t of this.towers) {
      t.mesh.position.y = 0.5;
      t.mat.opacity = 0.0;
      t.mat.emissiveIntensity = 0.0;
    }
    this.strandMaterial.opacity = 0.0;
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
