/**
 * OrganicForms: Primary visual elements — flowing translucent ribbons,
 * blooming petals, and resonant harmonic spirals.
 * State-driven transitions with zero per-frame allocations.
 */

import {
  Group,
  Mesh,
  CatmullRomCurve3,
  TubeGeometry,
  MeshStandardMaterial,
  Vector3,
  Color,
  AdditiveBlending,
  DoubleSide,
} from '@iwsdk/core';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export type VisualLifeState =
  | 'HIDDEN'
  | 'EMERGING'
  | 'ACTIVE'
  | 'RESTING'
  | 'RESPONDING'
  | 'TRANSFORMING'
  | 'DISSOLVING';

export class OrganicForms {
  readonly group: Group = new Group();

  // Primary ribbon mesh (front central focal element)
  readonly primaryRibbon: Mesh;
  private primaryMaterial: MeshStandardMaterial;
  private primaryBaseScale = new Vector3(1, 1, 1);

  // Secondary harmonic ribbons (surrounding gentle arcs)
  private secondaryRibbons: Mesh[] = [];
  private secondaryMaterials: MeshStandardMaterial[] = [];

  // Life state
  private lifeState: VisualLifeState = 'HIDDEN';
  private lifeProgress = 0; // 0 to 1

  // Interactive poke ripple energy [0 to 1]
  private touchRippleEnergy = 0;

  // Scratch colors
  private scratchColor = new Color();
  private scratchEmissive = new Color();

  constructor() {
    // 1. Primary Ribbon: Catmull-Rom parametric tube curving elegantly in front of user
    const primaryPoints = [
      new Vector3(-0.45, 0.9, -1.2),
      new Vector3(-0.25, 1.25, -1.0),
      new Vector3(0.0, 1.45, -0.9),
      new Vector3(0.25, 1.25, -1.0),
      new Vector3(0.45, 0.9, -1.2),
      new Vector3(0.15, 0.75, -1.35),
      new Vector3(-0.2, 0.8, -1.3),
    ];
    const primaryCurve = new CatmullRomCurve3(primaryPoints, true);
    const primaryGeo = new TubeGeometry(primaryCurve, 64, 0.035, 16, true);

    this.primaryMaterial = new MeshStandardMaterial({
      color: 0x99aaff,
      emissive: 0x334488,
      roughness: 0.25,
      metalness: 0.1,
      transparent: true,
      opacity: 0.0,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    this.primaryRibbon = new Mesh(primaryGeo, this.primaryMaterial);
    this.primaryRibbon.position.set(0, 0, 0);
    this.primaryRibbon.scale.set(0.001, 0.001, 0.001);
    this.group.add(this.primaryRibbon);

    // 2. Secondary Harmonic Ribbons (2 surrounding spirals)
    const secondaryConfigs = [
      {
        pts: [
          new Vector3(-0.9, 0.7, -1.5),
          new Vector3(-0.6, 1.5, -1.3),
          new Vector3(-0.1, 1.8, -1.5),
          new Vector3(-0.5, 1.1, -1.7),
        ],
        radius: 0.022,
      },
      {
        pts: [
          new Vector3(0.9, 0.7, -1.5),
          new Vector3(0.6, 1.5, -1.3),
          new Vector3(0.1, 1.8, -1.5),
          new Vector3(0.5, 1.1, -1.7),
        ],
        radius: 0.022,
      },
    ];

    secondaryConfigs.forEach((cfg) => {
      const curve = new CatmullRomCurve3(cfg.pts, false);
      const geo = new TubeGeometry(curve, 48, cfg.radius, 12, false);
      const mat = new MeshStandardMaterial({
        color: 0x8899dd,
        emissive: 0x223366,
        roughness: 0.3,
        metalness: 0.15,
        transparent: true,
        opacity: 0.0,
        side: DoubleSide,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new Mesh(geo, mat);
      mesh.scale.set(0.001, 0.001, 0.001);
      this.group.add(mesh);
      this.secondaryRibbons.push(mesh);
      this.secondaryMaterials.push(mat);
    });
  }

  triggerTouchRipple(): void {
    this.touchRippleEnergy = 1.0;
  }

  update(frameData: ConductorFrameData, metrics: AudioMetrics, deltaSec: number): void {
    const { activeCue, normalizedProgress, interpolatedColor } = frameData;

    // Decay touch ripple energy smoothly
    if (this.touchRippleEnergy > 0) {
      this.touchRippleEnergy = Math.max(0, this.touchRippleEnergy - deltaSec * 1.8);
    }

    // Determine state based on cue
    switch (activeCue.event) {
      case 'ARRIVAL':
        this.lifeState = 'HIDDEN';
        this.lifeProgress = 0;
        break;

      case 'DISCOVERY':
        this.lifeState = 'EMERGING';
        this.lifeProgress = frameData.cueProgress;
        break;

      case 'DEVELOPMENT':
        this.lifeState = 'ACTIVE';
        this.lifeProgress = 1.0;
        break;

      case 'BUILD':
      case 'CLIMAX_PREP':
        this.lifeState = 'RESPONDING';
        this.lifeProgress = 1.0;
        break;

      case 'CLIMAX':
        this.lifeState = 'TRANSFORMING';
        this.lifeProgress = 1.0;
        break;

      case 'RELEASE':
      case 'COMPLETE':
        this.lifeState = 'DISSOLVING';
        this.lifeProgress = 1.0 - frameData.cueProgress;
        break;
    }

    // Colors
    this.scratchColor.setRGB(...interpolatedColor.primaryAccent);
    this.scratchEmissive.setRGB(
      interpolatedColor.primaryAccent[0] * 0.5,
      interpolatedColor.primaryAccent[1] * 0.5,
      interpolatedColor.primaryAccent[2] * 0.5
    );

    // Level C: subtle micro-breathing (2-4% scale oscillation with audio)
    const microScale = 1.0 + (metrics.mid * 0.035 + metrics.low * 0.025);
    const touchBoost = 1.0 + this.touchRippleEnergy * 0.12;

    // Apply visibility and scale based on lifeState
    if (this.lifeState === 'HIDDEN') {
      this.primaryRibbon.scale.set(0.001, 0.001, 0.001);
      this.primaryMaterial.opacity = 0;
      this.secondaryRibbons.forEach((m) => m.scale.set(0.001, 0.001, 0.001));
      this.secondaryMaterials.forEach((m) => (m.opacity = 0));
    } else if (this.lifeState === 'EMERGING') {
      // Primary unfolds first
      const ease = this.lifeProgress * this.lifeProgress * (3 - 2 * this.lifeProgress);
      const targetScale = ease * microScale * touchBoost;
      this.primaryRibbon.scale.set(targetScale, targetScale, targetScale);
      this.primaryMaterial.opacity = ease * 0.85;

      this.secondaryRibbons.forEach((m) => m.scale.set(0.001, 0.001, 0.001));
      this.secondaryMaterials.forEach((m) => (m.opacity = 0));
    } else if (this.lifeState === 'ACTIVE') {
      // Primary fully active, secondary emerging
      const pScale = microScale * touchBoost;
      this.primaryRibbon.scale.set(pScale, pScale, pScale);
      this.primaryMaterial.opacity = 0.85;

      const secProgress = Math.min(1, (normalizedProgress - 0.26) / 0.15);
      const secEase = Math.max(0, secProgress);
      this.secondaryRibbons.forEach((m) => {
        const s = secEase * microScale;
        m.scale.set(s, s, s);
      });
      this.secondaryMaterials.forEach((m) => (m.opacity = secEase * 0.7));
    } else if (this.lifeState === 'RESPONDING') {
      // Swelling in build
      const buildScale = (1.05 + normalizedProgress * 0.15) * microScale * touchBoost;
      this.primaryRibbon.scale.set(buildScale, buildScale, buildScale);
      this.primaryMaterial.opacity = Math.min(0.95, 0.85 + metrics.overall * 0.1);

      this.secondaryRibbons.forEach((m) => {
        const s = (1.0 + normalizedProgress * 0.12) * microScale;
        m.scale.set(s, s, s);
      });
      this.secondaryMaterials.forEach((m) => (m.opacity = 0.8));
    } else if (this.lifeState === 'TRANSFORMING') {
      // Climax: Maximum blooming expansion and radiant warmth
      const climaxScale = (1.25 + metrics.high * 0.05) * touchBoost;
      this.primaryRibbon.scale.set(climaxScale, climaxScale, climaxScale);
      this.primaryMaterial.opacity = 0.95;

      this.secondaryRibbons.forEach((m) => {
        const s = 1.2 * microScale;
        m.scale.set(s, s, s);
      });
      this.secondaryMaterials.forEach((m) => (m.opacity = 0.85));
    } else if (this.lifeState === 'DISSOLVING') {
      // Soft decrescendo dissolve
      const dissolve = Math.max(0.001, this.lifeProgress);
      this.primaryRibbon.scale.set(dissolve, dissolve, dissolve);
      this.primaryMaterial.opacity = dissolve * 0.7;

      this.secondaryRibbons.forEach((m) => {
        m.scale.set(dissolve * 0.8, dissolve * 0.8, dissolve * 0.8);
      });
      this.secondaryMaterials.forEach((m) => (m.opacity = dissolve * 0.5));
    }

    // Update material colors & emissive highlights
    this.primaryMaterial.color.copy(this.scratchColor);
    this.primaryMaterial.emissive.copy(this.scratchEmissive);
    this.primaryMaterial.emissiveIntensity = 0.5 + this.touchRippleEnergy * 0.5 + metrics.mid * 0.3;

    this.secondaryMaterials.forEach((mat) => {
      mat.color.copy(this.scratchColor);
      mat.emissive.copy(this.scratchEmissive);
      mat.emissiveIntensity = 0.4 + metrics.high * 0.25;
    });

    // Gentle slow rotation of primary ribbon (respects motion budget: max 0.08 rad/s)
    this.primaryRibbon.rotation.y += deltaSec * 0.04;
  }

  dispose(): void {
    this.primaryRibbon.geometry.dispose();
    this.primaryMaterial.dispose();
    this.secondaryRibbons.forEach((m) => m.geometry.dispose());
    this.secondaryMaterials.forEach((m) => m.dispose());
    this.group.clear();
  }
}
