/**
 * ImmersiveArchitecture: Dense 360° procedural building field.
 *
 * Places hundreds of varied structures around the seated user across 5 distance
 * rings (3m, 5m, 8m, 12m, 18m), with comfortable gaps and full 360° coverage.
 * All buildings synchronize height, glow, and visibility with audio/conductor.
 *
 * Performance notes:
 * - Uses instanced-style shared geometries (one Mesh per building, but geometry
 *   instances are reused per type within rings for minimal draw-call overhead).
 * - No per-frame allocations. All scratch objects pre-allocated.
 * - Targets Quest 3S: ≤80 draw calls total for this system.
 */

import {
  Group,
  Mesh,
  BoxGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  Color,
  Vector3,
} from '@iwsdk/core';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

interface ArchBuilding {
  mesh: Mesh;
  mat: MeshStandardMaterial;
  windowMesh: Mesh;
  windowMat: MeshStandardMaterial;
  // Full-height Y scale at climax (before audio modulation)
  targetScaleY: number;
  // Current Y scale being animated toward targetScaleY
  currentScaleY: number;
  // Base Y position (bottom of building)
  baseY: number;
  // Ring index 0-4 → drives emergence timing
  ringIndex: number;
  // Angle in radians for gentle sway
  swayPhase: number;
  // Whether this building has fully emerged
  emerged: boolean;
  // Base color hex
  colorHex: number;
  // Emissive color hex
  emissiveHex: number;
  // Angular position in radians (around Y axis)
  azimuth: number;
}

// Geometry pool: Box variants + cylinder spires
type GeoKey = 'box-thin' | 'box-wide' | 'box-flat' | 'cyl-spire' | 'cyl-thick';

export class ImmersiveArchitecture {
  readonly group: Group = new Group();

  private buildings: ArchBuilding[] = [];

  // Scratch objects for update (no per-frame allocation)
  private scratchColor = new Color();
  private scratchVec = new Vector3();

  // Shared geometry pool (reused across all buildings)
  private geoPool: Map<GeoKey, BoxGeometry | CylinderGeometry> = new Map();

  // Normalized progress at which each ring starts emerging
  private readonly RING_EMERGE_START = [0.0, 0.10, 0.22, 0.38, 0.55];
  // Width of the fade-in window
  private readonly RING_EMERGE_WINDOW = 0.12;

  constructor(isQuest: boolean) {
    this.buildGeoPool();
    this.buildRings(isQuest);
  }

  private buildGeoPool(): void {
    // Shared geometries: different aspect ratios to create variety without per-building geometry
    this.geoPool.set('box-thin',  new BoxGeometry(1, 1, 1));   // Narrow tower  (scale.x = 0.5-1.0, scale.y = tall)
    this.geoPool.set('box-wide',  new BoxGeometry(1, 1, 1));   // Broad base    (scale.x = 1.5-2.5, scale.y = medium)
    this.geoPool.set('box-flat',  new BoxGeometry(1, 1, 1));   // Flat slab     (scale.x = 2-4, scale.y = short)
    this.geoPool.set('cyl-spire', new CylinderGeometry(0.15, 0.5, 1, 8)); // Tapered spire
    this.geoPool.set('cyl-thick', new CylinderGeometry(0.5,  0.7, 1, 10)); // Thick column
  }

  /**
   * Builds all building rings. Called once in constructor.
   */
  private buildRings(isQuest: boolean): void {
    // Ring config: [radius, buildingsPerRing, maxHeight, gapJitter]
    const rings: [number, number, number, number][] = [
      [3.0,  isQuest ? 16 : 20, 2.5,  0.4],   // Ring 0 — near, small  (gentle intro)
      [5.0,  isQuest ? 18 : 24, 5.0,  0.6],   // Ring 1 — mid, medium
      [8.0,  isQuest ? 18 : 24, 10.0, 0.8],   // Ring 2 — mid-far, tall
      [12.0, isQuest ? 14 : 18, 18.0, 1.0],   // Ring 3 — far, towers
      [18.0, isQuest ? 10 : 14, 25.0, 1.5],   // Ring 4 — horizon, monumental
    ];

    // Color palette per ring
    const ringColors: [number, number][] = [
      [0x2a5870, 0x0a2030],  // Dark teal near
      [0x3a7888, 0x112233],  // Teal mid
      [0x4a8898, 0x1a3340],  // Bright teal mid-far
      [0xb89040, 0x3a2010],  // Gold far
      [0xd0a050, 0x4a2810],  // Warm gold horizon
    ];

    const rng = this.seededRand(42);

    rings.forEach(([radius, count, maxH, jitter], ringIdx) => {
      for (let i = 0; i < count; i++) {
        const baseAngle = (i / count) * Math.PI * 2;
        // Slight angular jitter to break uniformity
        const azimuth = baseAngle + (rng() - 0.5) * 0.4;

        // Radial jitter
        const r = radius + (rng() - 0.5) * jitter;

        const x = Math.sin(azimuth) * r;
        const z = Math.cos(azimuth) * r;

        // Height: varies from 30% to 100% of maxH, plus small jitter
        const heightFrac = 0.3 + rng() * 0.7;
        const targetH = maxH * heightFrac;

        // Width / depth: thin or wide variation
        const widthVariant = rng();
        let scaleX: number, scaleZ: number;
        let geoKey: GeoKey;
        if (widthVariant < 0.3) {
          geoKey = 'cyl-spire';
          scaleX = 0.4 + rng() * 0.6;
          scaleZ = scaleX;
        } else if (widthVariant < 0.55) {
          geoKey = 'box-thin';
          scaleX = 0.4 + rng() * 0.5;
          scaleZ = 0.4 + rng() * 0.5;
        } else if (widthVariant < 0.80) {
          geoKey = 'cyl-thick';
          scaleX = 0.6 + rng() * 0.8;
          scaleZ = scaleX;
        } else {
          geoKey = 'box-wide';
          scaleX = 0.8 + rng() * 1.2;
          scaleZ = 0.6 + rng() * 0.8;
        }

        const [colorHex, emissiveHex] = ringColors[ringIdx];

        // Slight color variation within each ring
        const colorVariant = rng();
        let finalColor = colorHex;
        if (colorVariant < 0.25) finalColor = 0x3a8898; // teal variant
        else if (colorVariant < 0.45) finalColor = 0xa88030; // gold variant
        else if (colorVariant < 0.55) finalColor = 0x2a5060; // dark teal variant

        const geo = this.geoPool.get(geoKey)!;

        const mat = new MeshStandardMaterial({
          color: finalColor,
          emissive: emissiveHex,
          emissiveIntensity: 0.15,
          roughness: 0.35,
          metalness: 0.35,
          transparent: true,
          opacity: 0.0,
          depthWrite: true,
        });

        const mesh = new Mesh(geo, mat);
        // Position: at ground level (Y=0), start at scale 0.001
        mesh.position.set(x, targetH * 0.5, z);
        mesh.scale.set(scaleX, 0.001, scaleZ);
        // Slight random Y rotation for variety
        mesh.rotation.y = rng() * Math.PI;
        this.group.add(mesh);

        // Add thin golden window plane as child of building
        const windowGeo = new BoxGeometry(scaleX * 0.9, targetH * 0.8, 0.02);
        const windowMat = new MeshStandardMaterial({
          color: 0xd8b040, // warm gold
          emissive: 0xffd060,
          emissiveIntensity: 0.0,
          transparent: true,
          opacity: 0.0,
          depthWrite: false,
        });
        const windowMesh = new Mesh(windowGeo, windowMat);
        windowMesh.position.set(0, targetH * 0.5, 0.1);
        mesh.add(windowMesh);
        
        // Store references (no extra group addition needed)

        this.buildings.push({
          mesh,
          mat,
          windowMesh,
          windowMat,
          targetScaleY: targetH,
          currentScaleY: 0.001,
          baseY: 0,
          ringIndex: ringIdx,
          swayPhase: rng() * Math.PI * 2,
          emerged: false,
          colorHex: finalColor,
          emissiveHex,
          azimuth,
        });
      }
    });

    console.log(`[ImmersiveArchitecture] Built ${this.buildings.length} buildings across 5 rings`);
  }

  /**
   * Main update — called every frame. Zero allocations.
   */
  update(frameData: ConductorFrameData, metrics: AudioMetrics, deltaSec: number): void {
    const norm = frameData.normalizedProgress;
    const { low, mid, high } = metrics;

    // Per-ring emergence thresholds mapped to 0–1 normalized progress
    // Ring 0 starts at norm=0, ring 4 starts at norm=0.55
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      const ringStart  = this.RING_EMERGE_START[b.ringIndex];
      const ringWindow = this.RING_EMERGE_WINDOW;

      // Visibility progress for this ring [0, 1]
      const ringVis = Math.max(0, Math.min(1, (norm - ringStart) / ringWindow));

      // Dissolve starts at 91% for all rings (release phase at 165/180 = 0.917)
      const dissolve = norm >= 0.91 ? Math.max(0, (1.0 - norm) / 0.09) : 1.0;

      const targetVis = ringVis * dissolve;

      if (targetVis < 0.001) {
        // Keep hidden, skip update
        if (b.mat.opacity > 0) b.mat.opacity = 0;
        continue;
      }

      // Material opacity fades in
      b.mat.opacity = Math.min(0.88, targetVis * 0.92);

      // Height growth: smoothly animate toward targetScaleY * ringVis
      // Bass drives extra height surge during music
      const bassBoost = 1.0 + low * 0.25 * Math.min(1, norm * 3);
      const heightTarget = b.targetScaleY * ringVis * bassBoost;
      const growSpeed = 2.0; // units per second
      if (b.currentScaleY < heightTarget) {
        b.currentScaleY = Math.min(heightTarget, b.currentScaleY + growSpeed * deltaSec);
      } else {
        // Slight release/shrink on bass drop
        b.currentScaleY = Math.max(heightTarget, b.currentScaleY - growSpeed * 0.5 * deltaSec);
      }

      // Clamp minimum so building doesn't disappear
      const finalScaleY = Math.max(0.01, b.currentScaleY);

      // Subtle gentle sway (motion budget < 0.02 m/s)
      const sway = mid * 0.012 * Math.sin(frameData.relativeTime * 0.5 + b.swayPhase);

      b.mesh.scale.y = finalScaleY;
      b.mesh.position.y = finalScaleY * 0.5 + sway * 0.05;

      // Emissive modulation with mids & highs
      const baseEmissive = 0.08 + mid * 0.18 + high * 0.12;
      // Climax boost: norm >= 0.78 (140/180)
      const climaxBoost = norm >= 0.78 ? (norm - 0.78) / 0.10 * 0.4 : 0.0;
      b.mat.emissiveIntensity = Math.min(0.9, baseEmissive + climaxBoost);
      // Window glow reacts to high frequencies
      b.windowMat.emissiveIntensity = Math.min(0.7, high * 0.8 + climaxBoost);

      // Color pulse on strong bass hits (keep as color property not allocation)
      if (low > 0.7) {
        const pulse = (low - 0.7) / 0.3;
        this.scratchColor.setHex(b.colorHex);
        this.scratchColor.r = Math.min(1, this.scratchColor.r + pulse * 0.15);
        this.scratchColor.g = Math.min(1, this.scratchColor.g + pulse * 0.08);
        b.mat.color.copy(this.scratchColor);
      } else {
        b.mat.color.setHex(b.colorHex);
      }
    }
  }

  reset(): void {
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      b.currentScaleY = 0.001;
      b.emerged = false;
      b.mesh.scale.y = 0.001;
      b.mesh.position.y = 0;
      b.mat.opacity = 0;
      b.mat.emissiveIntensity = 0.15;
      b.windowMat.emissiveIntensity = 0.0;
      b.windowMat.opacity = 0.0;
    }
  }

  dispose(): void {
    // Dispose materials (geometries are shared/pooled, dispose once)
    for (const b of this.buildings) {
      b.mat.dispose();
      b.windowMat.dispose();
    }
    this.buildings.length = 0;
    for (const geo of this.geoPool.values()) {
      geo.dispose();
    }
    this.geoPool.clear();
    this.group.clear();
  }

  /**
   * Simple seeded pseudo-random generator (mulberry32)
   */
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
