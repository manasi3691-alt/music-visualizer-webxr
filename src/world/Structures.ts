/**
 * Structures: Soft architectural arcs and portal rings.
 * Delicately frames the seated user's peripheral space.
 * Includes interactive grab node anchor.
 */

import {
  Group,
  Mesh,
  TorusGeometry,
  MeshStandardMaterial,
  Color,
  AdditiveBlending,
  DoubleSide,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export class Structures {
  readonly group: Group = new Group();

  // Three concentric celestial framing arcs
  private arcMeshes: Mesh[] = [];
  private arcMaterials: MeshStandardMaterial[] = [];

  // Interactive grab anchor orb on the middle right arc
  readonly grabOrbMesh: Mesh;
  private grabOrbMaterial: MeshStandardMaterial;
  private grabBasePosition = new Vector3(0.55, 1.15, -0.9);
  private grabUserOffset = new Vector3(0, 0, 0);

  private scratchColor = new Color();
  private scratchEmissive = new Color();

  constructor() {
    // Cosmic celestial framing arcs — scale-matched to the enlarged world
    const arcConfigs = [
      { radius: 3.5,  tube: 0.018, arc: Math.PI * 0.70, pos: [0, 1.3, -2.5],  rot: [0.08, 0, 0],  color: 0x2a6878 },  // Inner teal arc
      { radius: 5.5,  tube: 0.022, arc: Math.PI * 0.85, pos: [0, 1.6, -3.8],  rot: [-0.12, 0, 0], color: 0x1a4a5a },  // Mid arc
      { radius: 8.5,  tube: 0.028, arc: Math.PI * 1.05, pos: [0, 2.0, -5.5],  rot: [0.15, 0, 0],  color: 0xa88030 },  // Outer gold arc
      { radius: 12.0, tube: 0.034, arc: Math.PI * 1.25, pos: [0, 2.8, -8.0],  rot: [0.20, 0, 0],  color: 0x123040 },  // Distant silhouette arc
    ];

    arcConfigs.forEach((cfg) => {
      const geo = new TorusGeometry(cfg.radius, cfg.tube, 16, 64, cfg.arc);
      const mat = new MeshStandardMaterial({
        color: cfg.color,
        emissive: cfg.color,
        emissiveIntensity: 0.08,
        roughness: 0.15,
        metalness: 0.25,
        transparent: true,
        opacity: 0.0,
        side: DoubleSide,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new Mesh(geo, mat);
      mesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      mesh.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2]);
      mesh.scale.set(0.001, 0.001, 0.001);
      this.group.add(mesh);
      this.arcMeshes.push(mesh);
      this.arcMaterials.push(mat);
    });

    // Luminous grab node orb (interactive anchor) — muted teal-gold
    const orbGeo = new SphereGeometry(0.065, 24, 24);
    this.grabOrbMaterial = new MeshStandardMaterial({
      color: 0x6aaa88,     // Muted teal-green
      emissive: 0x2a5a40,
      emissiveIntensity: 0.55,
      roughness: 0.18,
      metalness: 0.12,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.grabOrbMesh = new Mesh(orbGeo, this.grabOrbMaterial);
    this.grabOrbMesh.position.copy(this.grabBasePosition);
    this.grabOrbMesh.scale.set(0.001, 0.001, 0.001);
    this.group.add(this.grabOrbMesh);
  }

  setGrabDisplacement(dx: number, dy: number, dz: number): void {
    // Authored safe bounds: max 0.35m from base position
    const maxDist = 0.35;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > maxDist && len > 0) {
      const scale = maxDist / len;
      this.grabUserOffset.set(dx * scale, dy * scale, dz * scale);
    } else {
      this.grabUserOffset.set(dx, dy, dz);
    }
  }

  resetGrabDisplacement(): void {
    this.grabUserOffset.set(0, 0, 0);
  }

  update(frameData: ConductorFrameData, metrics: AudioMetrics, deltaSec: number): void {
    const { normalizedProgress, interpolatedColor } = frameData;

    // Arcs are the primary framing element — emerge earlier than buildings (from DISCOVERY)
    // Outer arcs (higher index) emerge later for layered depth effect
    const arcVisibilities = [
      // Inner teal arc: emerges at 10%, full by 25%
      Math.max(0, Math.min(1, (normalizedProgress - 0.10) / 0.15)),
      // Mid arc: emerges at 20%, full by 38%
      Math.max(0, Math.min(1, (normalizedProgress - 0.20) / 0.18)),
      // Outer gold arc: emerges at 32%
      Math.max(0, Math.min(1, (normalizedProgress - 0.32) / 0.20)),
      // Distant silhouette: emerges at 50% (BUILD phase)
      Math.max(0, Math.min(1, (normalizedProgress - 0.50) / 0.22)),
    ];
    // All arcs dissolve after 97%
    const dissolve = normalizedProgress >= 0.97 ? Math.max(0, (1.0 - normalizedProgress) / 0.03) : 1.0;

    const lowPulse  = 1.0 + metrics.low  * 0.025;
    const midPulse  = 1.0 + metrics.mid  * 0.015;

    // Per-arc cosmically-keyed colors: teal inner, teal mid, gold outer, charcoal distant
    const arcBaseColors = [0x2a6878, 0x1a4a5a, 0xa88030, 0x123040] as const;
    const arcOpacities  = [0.45, 0.38, 0.30, 0.20] as const;

    this.arcMeshes.forEach((arc, i) => {
      const vis = arcVisibilities[i] * dissolve;
      if (vis <= 0.001) {
        arc.scale.set(0.001, 0.001, 0.001);
        this.arcMaterials[i].opacity = 0;
      } else {
        const pulsed = vis * (i < 2 ? lowPulse : midPulse);
        arc.scale.set(pulsed, pulsed, pulsed);
        this.arcMaterials[i].opacity = vis * arcOpacities[i];
        // Let conductor color subtly tint emissive (only 20% blend, rest stays cosmic)
        this.scratchEmissive.setHex(arcBaseColors[i]);
        this.arcMaterials[i].emissive.copy(this.scratchEmissive);
        this.arcMaterials[i].emissiveIntensity = 0.10 + (i < 3 ? metrics.mid : metrics.low) * 0.12;
      }
      // Extremely gentle sway (motion budget < 0.04 rad/s)
      arc.rotation.z += deltaSec * (0.012 * (i % 2 === 0 ? 1 : -1));
    });

    // Grab Orb: visible from Development phase onward
    const orbVis = Math.max(0, Math.min(1, (normalizedProgress - 0.26) / 0.12)) * dissolve;
    if (orbVis > 0.01) {
      const orbScale = orbVis * (1.0 + metrics.mid * 0.04);
      this.grabOrbMesh.scale.set(orbScale, orbScale, orbScale);
      this.grabOrbMesh.position.copy(this.grabBasePosition).add(this.grabUserOffset);
      this.grabOrbMaterial.opacity = orbVis * 0.88;
      this.grabOrbMaterial.emissiveIntensity = 0.55 + metrics.high * 0.25;
    } else {
      this.grabOrbMesh.scale.set(0.001, 0.001, 0.001);
      this.grabOrbMaterial.opacity = 0;
    }
  }

  dispose(): void {
    this.arcMeshes.forEach((m) => m.geometry.dispose());
    this.arcMaterials.forEach((m) => m.dispose());
    this.grabOrbMesh.geometry.dispose();
    this.grabOrbMaterial.dispose();
    this.group.clear();
  }
}
