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
    // 1. Arc frames: soft partial toruses curved around user's forward hemisphere
    const arcConfigs = [
      { radius: 2.2, tube: 0.015, arc: Math.PI * 0.75, pos: [0, 1.2, -1.8], rot: [0.1, 0, 0] },
      { radius: 3.4, tube: 0.020, arc: Math.PI * 0.9, pos: [0, 1.4, -2.4], rot: [-0.15, 0, 0] },
      { radius: 4.8, tube: 0.025, arc: Math.PI * 1.1, pos: [0, 1.6, -3.2], rot: [0.2, 0, 0] },
    ];

    arcConfigs.forEach((cfg) => {
      const geo = new TorusGeometry(cfg.radius, cfg.tube, 16, 48, cfg.arc);
      const mat = new MeshStandardMaterial({
        color: 0x7788cc,
        emissive: 0x112244,
        roughness: 0.2,
        metalness: 0.2,
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

    // 2. Luminous grab node orb (interactive anchor)
    const orbGeo = new SphereGeometry(0.065, 24, 24);
    this.grabOrbMaterial = new MeshStandardMaterial({
      color: 0xffddaa,
      emissive: 0xffaa44,
      emissiveIntensity: 0.6,
      roughness: 0.15,
      metalness: 0.1,
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
    const { activeCue, normalizedProgress, interpolatedColor } = frameData;

    this.scratchColor.setRGB(...interpolatedColor.warmAccent);
    this.scratchEmissive.setRGB(
      interpolatedColor.warmAccent[0] * 0.4,
      interpolatedColor.warmAccent[1] * 0.4,
      interpolatedColor.warmAccent[2] * 0.4
    );

    // Development (normalizedProgress >= 0.26, t = 10s) through Climax
    let visibility = 0;
    if (normalizedProgress >= 0.26 && normalizedProgress < 0.97) {
      if (normalizedProgress < 0.38) {
        // Emerging
        visibility = (normalizedProgress - 0.26) / 0.12;
      } else {
        visibility = 1.0;
      }
    } else if (normalizedProgress >= 0.97) {
      // Dissolving in release
      visibility = Math.max(0, (1.0 - normalizedProgress) / 0.03);
    }

    const microPulse = 1.0 + metrics.low * 0.03;
    const targetScale = visibility * microPulse;

    this.arcMeshes.forEach((arc, i) => {
      if (visibility <= 0.001) {
        arc.scale.set(0.001, 0.001, 0.001);
        this.arcMaterials[i].opacity = 0;
      } else {
        arc.scale.set(targetScale, targetScale, targetScale);
        this.arcMaterials[i].opacity = visibility * (0.4 + i * 0.12);
        this.arcMaterials[i].color.copy(this.scratchColor);
        this.arcMaterials[i].emissive.copy(this.scratchEmissive);
        this.arcMaterials[i].emissiveIntensity = 0.3 + metrics.mid * 0.2;
      }
      // Extremely gentle sway (motion budget < 0.05 rad/s)
      arc.rotation.z += deltaSec * (0.015 * (i % 2 === 0 ? 1 : -1));
    });

    // Grab Orb positioning & state
    if (visibility > 0.1) {
      const orbScale = visibility * (1.0 + metrics.mid * 0.05);
      this.grabOrbMesh.scale.set(orbScale, orbScale, orbScale);
      this.grabOrbMesh.position.copy(this.grabBasePosition).add(this.grabUserOffset);
      this.grabOrbMaterial.opacity = visibility * 0.9;
      this.grabOrbMaterial.color.copy(this.scratchColor);
      this.grabOrbMaterial.emissive.copy(this.scratchEmissive);
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
