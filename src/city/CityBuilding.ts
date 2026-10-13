/**
 * CityBuilding: Procedural building generator supporting Types A, B, C, D, and E.
 * Implements smooth 0.8-1.5s construction animations, soft organic architectural aesthetics,
 * and subtle FFT music breathing.
 */

import {
  Group,
  Mesh,
  BoxGeometry,
  CylinderGeometry,
  TorusGeometry,
  RingGeometry,
  PlaneGeometry,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  LineSegments,
  EdgesGeometry,
  LineBasicMaterial,
  Color,
  Vector3,
  MathUtils,
  DoubleSide,
} from '@iwsdk/core';
import { BuildingType, CITY_PALETTE, CONSTRUCTION_ANIMATION_DURATION } from './CityConfig.js';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export interface CityBuildingOptions {
  id: string;
  type: BuildingType;
  position: Vector3;
  rotationY?: number;
  scale?: number;
  isConstructed?: boolean; // If false, awaits construction animation
  primaryColor?: number;
}

export class CityBuilding {
  readonly id: string;
  readonly type: BuildingType;
  readonly group: Group = new Group();

  // Child structural sub-groups for staged construction animation
  private foundationGroup: Group = new Group();
  private lowerStructureGroup: Group = new Group();
  private upperStructureGroup: Group = new Group();
  private detailsGroup: Group = new Group();

  // Materials for color and glow animation
  private bodyMaterials: MeshPhysicalMaterial[] = [];
  private windowMaterials: MeshStandardMaterial[] = [];
  private edgeMaterials: LineBasicMaterial[] = [];

  // Geometries for disposal
  private geometries: (BoxGeometry | CylinderGeometry | TorusGeometry | RingGeometry | EdgesGeometry | PlaneGeometry)[] = [];

  // Construction animation state
  private isConstructed: boolean;
  private isAnimatingConstruction = false;
  private constructionProgress = 0; // 0 to 1
  private baseScale = 1.0;

  // Scratch objects for zero per-frame allocations
  private scratchColor = new Color();
  private scratchEmissive = new Color();

  constructor(options: CityBuildingOptions) {
    this.id = options.id;
    this.type = options.type;
    this.baseScale = options.scale ?? 1.0;
    this.isConstructed = options.isConstructed ?? true;
    this.constructionProgress = this.isConstructed ? 1.0 : 0.0;

    this.group.position.copy(options.position);
    if (options.rotationY) {
      this.group.rotation.y = options.rotationY;
    }

    this.group.add(this.foundationGroup);
    this.group.add(this.lowerStructureGroup);
    this.group.add(this.upperStructureGroup);
    this.group.add(this.detailsGroup);

    this.buildProceduralGeometry(options.primaryColor);

    if (!this.isConstructed) {
      this.applyConstructionProgress(0);
    }
  }

  private buildProceduralGeometry(primaryColorHex?: number): void {
    const mainColor = primaryColorHex ?? CITY_PALETTE.translucentGlass;

    switch (this.type) {
      case 'TYPE_A':
        this.buildTypeA_Small(mainColor);
        break;
      case 'TYPE_B':
        this.buildTypeB_Medium(mainColor);
        break;
      case 'TYPE_C':
        this.buildTypeC_Tower(mainColor);
        break;
      case 'TYPE_D':
        this.buildTypeD_Organic(mainColor);
        break;
      case 'TYPE_E':
        this.buildTypeE_Connector(mainColor);
        break;
    }
  }

  // TYPE A — Small Building: 1-2 floors, simple geometry, soft illumination
  private buildTypeA_Small(mainColor: number): void {
    // Foundation slab
    const fGeo = new BoxGeometry(0.44, 0.06, 0.44);
    this.geometries.push(fGeo);
    const fMat = this.createBodyMaterial(0x35446e, 0.85);
    const fMesh = new Mesh(fGeo, fMat);
    fMesh.position.y = 0.03;
    this.foundationGroup.add(fMesh);
    this.addEdges(fGeo, this.foundationGroup, 0x6e88d0);

    // Floor 1
    const b1Geo = new BoxGeometry(0.38, 0.28, 0.38);
    this.geometries.push(b1Geo);
    const b1Mat = this.createBodyMaterial(mainColor, 0.75);
    const b1Mesh = new Mesh(b1Geo, b1Mat);
    b1Mesh.position.y = 0.20;
    this.lowerStructureGroup.add(b1Mesh);
    this.addEdges(b1Geo, this.lowerStructureGroup, 0x9fbaff);

    // Floor 2
    const b2Geo = new BoxGeometry(0.28, 0.22, 0.28);
    this.geometries.push(b2Geo);
    const b2Mat = this.createBodyMaterial(mainColor, 0.70);
    const b2Mesh = new Mesh(b2Geo, b2Mat);
    b2Mesh.position.y = 0.45;
    this.upperStructureGroup.add(b2Mesh);
    this.addEdges(b2Geo, this.upperStructureGroup, 0xc4d8ff);

    // Soft horizontal window light strips
    const wGeo = new BoxGeometry(0.30, 0.03, 0.30);
    this.geometries.push(wGeo);
    const wMat = this.createWindowMaterial(CITY_PALETTE.windowGlow, 1.2);
    const wMesh = new Mesh(wGeo, wMat);
    wMesh.position.y = 0.34;
    this.detailsGroup.add(wMesh);
  }

  // TYPE B — Medium Building: 3-5 floors, architectural details, windows/light strips
  private buildTypeB_Medium(mainColor: number): void {
    // Plinth
    const fGeo = new BoxGeometry(0.55, 0.08, 0.55);
    this.geometries.push(fGeo);
    const fMat = this.createBodyMaterial(0x324068, 0.9);
    const fMesh = new Mesh(fGeo, fMat);
    fMesh.position.y = 0.04;
    this.foundationGroup.add(fMesh);
    this.addEdges(fGeo, this.foundationGroup, 0x5a78c0);

    // Tier 1 Base
    const t1Geo = new BoxGeometry(0.48, 0.42, 0.48);
    this.geometries.push(t1Geo);
    const t1Mat = this.createBodyMaterial(mainColor, 0.78);
    const t1Mesh = new Mesh(t1Geo, t1Mat);
    t1Mesh.position.y = 0.29;
    this.lowerStructureGroup.add(t1Mesh);
    this.addEdges(t1Geo, this.lowerStructureGroup, 0x90b0ff);

    // Tier 2 Mid
    const t2Geo = new BoxGeometry(0.38, 0.45, 0.38);
    this.geometries.push(t2Geo);
    const t2Mat = this.createBodyMaterial(mainColor, 0.72);
    const t2Mesh = new Mesh(t2Geo, t2Mat);
    t2Mesh.position.y = 0.725;
    this.upperStructureGroup.add(t2Mesh);
    this.addEdges(t2Geo, this.upperStructureGroup, 0xb8d0ff);

    // Tier 3 Spire top
    const t3Geo = new BoxGeometry(0.26, 0.36, 0.26);
    this.geometries.push(t3Geo);
    const t3Mat = this.createBodyMaterial(mainColor, 0.68);
    const t3Mesh = new Mesh(t3Geo, t3Mat);
    t3Mesh.position.y = 1.13;
    this.upperStructureGroup.add(t3Mesh);
    this.addEdges(t3Geo, this.upperStructureGroup, 0xe0ecff);

    // Luminous vertical window columns
    const winGeo = new BoxGeometry(0.40, 0.85, 0.04);
    this.geometries.push(winGeo);
    const winMat = this.createWindowMaterial(CITY_PALETTE.windowViolet, 1.4);
    const winMesh1 = new Mesh(winGeo, winMat);
    winMesh1.position.set(0, 0.65, 0.22);
    this.detailsGroup.add(winMesh1);

    const winMesh2 = new Mesh(winGeo, winMat);
    winMesh2.position.set(0, 0.65, -0.22);
    this.detailsGroup.add(winMesh2);
  }

  // TYPE C — Tall Tower: taller structure, curved or tapered form, subtle glowing accents
  private buildTypeC_Tower(mainColor: number): void {
    // Stepped Base
    const fGeo = new CylinderGeometry(0.38, 0.44, 0.12, 16);
    this.geometries.push(fGeo);
    const fMat = this.createBodyMaterial(0x28355a, 0.95);
    const fMesh = new Mesh(fGeo, fMat);
    fMesh.position.y = 0.06;
    this.foundationGroup.add(fMesh);

    // Lower tapered shaft
    const lGeo = new CylinderGeometry(0.30, 0.38, 0.85, 16);
    this.geometries.push(lGeo);
    const lMat = this.createBodyMaterial(mainColor, 0.75);
    const lMesh = new Mesh(lGeo, lMat);
    lMesh.position.y = 0.545;
    this.lowerStructureGroup.add(lMesh);

    // Upper slender shaft
    const uGeo = new CylinderGeometry(0.20, 0.29, 0.95, 16);
    this.geometries.push(uGeo);
    const uMat = this.createBodyMaterial(mainColor, 0.70);
    const uMesh = new Mesh(uGeo, uMat);
    uMesh.position.y = 1.445;
    this.upperStructureGroup.add(uMesh);

    // Pinnacle Spire Needle
    const sGeo = new CylinderGeometry(0.02, 0.18, 0.65, 12);
    this.geometries.push(sGeo);
    const sMat = this.createBodyMaterial(0xffeedd, 0.85);
    const sMesh = new Mesh(sGeo, sMat);
    sMesh.position.y = 2.245;
    this.upperStructureGroup.add(sMesh);

    // Glowing halo ring around tower neck
    const ringGeo = new TorusGeometry(0.32, 0.015, 8, 32);
    this.geometries.push(ringGeo);
    const ringMat = this.createWindowMaterial(CITY_PALETTE.goldAccent, 2.0);
    const ringMesh = new Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = 1.0;
    this.detailsGroup.add(ringMesh);

    // Glowing vertical light ribs
    const ribGeo = new BoxGeometry(0.02, 1.2, 0.44);
    this.geometries.push(ribGeo);
    const ribMat = this.createWindowMaterial(CITY_PALETTE.windowTurquoise, 1.2);
    const ribMesh = new Mesh(ribGeo, ribMat);
    ribMesh.position.y = 1.0;
    this.detailsGroup.add(ribMesh);
  }

  // TYPE D — Organic Building: curved structure, translucent surfaces, artistic appearance
  private buildTypeD_Organic(mainColor: number): void {
    // Petal platform base
    const fGeo = new CylinderGeometry(0.42, 0.48, 0.08, 24);
    this.geometries.push(fGeo);
    const fMat = this.createBodyMaterial(0x303b60, 0.9);
    const fMesh = new Mesh(fGeo, fMat);
    fMesh.position.y = 0.04;
    this.foundationGroup.add(fMesh);

    // Curving lobed lower dome
    const d1Geo = new CylinderGeometry(0.36, 0.24, 0.55, 24);
    this.geometries.push(d1Geo);
    const d1Mat = this.createBodyMaterial(mainColor, 0.65);
    const d1Mesh = new Mesh(d1Geo, d1Mat);
    d1Mesh.position.y = 0.355;
    d1Mesh.rotation.y = Math.PI * 0.15;
    this.lowerStructureGroup.add(d1Mesh);

    // Intertwined celestial curved arc
    const arcGeo = new TorusGeometry(0.36, 0.035, 12, 32, Math.PI * 1.2);
    this.geometries.push(arcGeo);
    const arcMat = this.createBodyMaterial(0xa070e0, 0.70);
    const arcMesh = new Mesh(arcGeo, arcMat);
    arcMesh.position.set(0, 0.65, 0);
    arcMesh.rotation.set(0.4, 0.3, 0.2);
    this.upperStructureGroup.add(arcMesh);

    // Upper blooming crystalline crown
    const cGeo = new CylinderGeometry(0.28, 0.12, 0.45, 16);
    this.geometries.push(cGeo);
    const cMat = this.createBodyMaterial(0x95e2df, 0.60);
    const cMesh = new Mesh(cGeo, cMat);
    cMesh.position.y = 0.85;
    this.upperStructureGroup.add(cMesh);

    // Soft luminous internal nucleus
    const nGeo = new CylinderGeometry(0.12, 0.12, 0.65, 12);
    this.geometries.push(nGeo);
    const nMat = this.createWindowMaterial(CITY_PALETTE.windowViolet, 1.8);
    const nMesh = new Mesh(nGeo, nMat);
    nMesh.position.y = 0.55;
    this.detailsGroup.add(nMesh);
  }

  // TYPE E — Connector: bridge, arch, elevated pathway
  private buildTypeE_Connector(mainColor: number): void {
    // Twin anchor pylons
    const p1Geo = new BoxGeometry(0.12, 0.35, 0.24);
    this.geometries.push(p1Geo);
    const p1Mat = this.createBodyMaterial(0x354060, 0.85);
    const p1Mesh = new Mesh(p1Geo, p1Mat);
    p1Mesh.position.set(-0.45, 0.175, 0);
    this.foundationGroup.add(p1Mesh);

    const p2Mesh = new Mesh(p1Geo, p1Mat);
    p2Mesh.position.set(0.45, 0.175, 0);
    this.foundationGroup.add(p2Mesh);

    // Elevated bridge span platform
    const spanGeo = new BoxGeometry(1.05, 0.05, 0.22);
    this.geometries.push(spanGeo);
    const spanMat = this.createBodyMaterial(mainColor, 0.75);
    const spanMesh = new Mesh(spanGeo, spanMat);
    spanMesh.position.set(0, 0.35, 0);
    this.lowerStructureGroup.add(spanMesh);
    this.addEdges(spanGeo, this.lowerStructureGroup, 0x88b0ff);

    // Architectural curved support arch
    const archGeo = new TorusGeometry(0.46, 0.025, 8, 32, Math.PI);
    this.geometries.push(archGeo);
    const archMat = this.createBodyMaterial(0xb095e0, 0.8);
    const archMesh = new Mesh(archGeo, archMat);
    archMesh.position.set(0, 0.18, 0);
    this.upperStructureGroup.add(archMesh);

    // Luminous pathway light strip along bridge deck
    const stripGeo = new PlaneGeometry(0.98, 0.04);
    this.geometries.push(stripGeo);
    const stripMat = this.createWindowMaterial(CITY_PALETTE.pathwayGlow, 1.6);
    stripMat.side = DoubleSide;
    const stripMesh = new Mesh(stripGeo, stripMat);
    stripMesh.rotation.x = -Math.PI / 2;
    stripMesh.position.set(0, 0.38, 0);
    this.detailsGroup.add(stripMesh);
  }

  private createBodyMaterial(colorHex: number, opacity: number): MeshPhysicalMaterial {
    const mat = new MeshPhysicalMaterial({
      color: colorHex,
      emissive: 0x141f38,
      emissiveIntensity: 0.4,
      roughness: 0.18,
      metalness: 0.12,
      transmission: 0.4,
      transparent: true,
      opacity,
      depthWrite: true,
    });
    this.bodyMaterials.push(mat);
    return mat;
  }

  private createWindowMaterial(colorHex: number, intensity: number): MeshStandardMaterial {
    const mat = new MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: intensity,
      roughness: 0.1,
      metalness: 0.05,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.windowMaterials.push(mat);
    return mat;
  }

  private addEdges(geo: BoxGeometry, parent: Group, colorHex: number): void {
    const edgeGeo = new EdgesGeometry(geo);
    this.geometries.push(edgeGeo);
    const edgeMat = new LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.75,
    });
    this.edgeMaterials.push(edgeMat);
    const edges = new LineSegments(edgeGeo, edgeMat);
    parent.add(edges);
  }

  startConstruction(): void {
    this.isConstructed = false;
    this.isAnimatingConstruction = true;
    this.constructionProgress = 0;
    this.group.visible = true;
    this.applyConstructionProgress(0);
  }

  private applyConstructionProgress(p: number): void {
    // Staged emergence:
    // 0.00 - 0.25: Foundation slab scales in
    // 0.25 - 0.60: Lower structure rises up
    // 0.60 - 0.85: Upper structure rises & develops
    // 0.85 - 1.00: Windows illuminate with soft glow bloom

    // Foundation
    const fProgress = MathUtils.clamp(p / 0.25, 0, 1);
    this.foundationGroup.scale.set(fProgress, fProgress, fProgress);
    this.foundationGroup.visible = fProgress > 0.01;

    // Lower structure
    const lProgress = MathUtils.clamp((p - 0.25) / 0.35, 0, 1);
    this.lowerStructureGroup.scale.set(lProgress, lProgress, lProgress);
    this.lowerStructureGroup.visible = lProgress > 0.01;

    // Upper structure
    const uProgress = MathUtils.clamp((p - 0.60) / 0.25, 0, 1);
    this.upperStructureGroup.scale.set(uProgress, uProgress, uProgress);
    this.upperStructureGroup.visible = uProgress > 0.01;

    // Windows / details
    const dProgress = MathUtils.clamp((p - 0.85) / 0.15, 0, 1);
    this.detailsGroup.scale.set(dProgress, dProgress, dProgress);
    this.detailsGroup.visible = dProgress > 0.01;

    // Emissive intensity ramps up during illumination stage
    const glowScale = 0.3 + dProgress * 0.7;
    for (let i = 0; i < this.windowMaterials.length; i++) {
      this.windowMaterials[i].opacity = 0.2 + dProgress * 0.75;
      this.windowMaterials[i].emissiveIntensity = 1.0 * glowScale;
    }
  }

  update(
    frameData: ConductorFrameData,
    metrics: AudioMetrics,
    deltaSec: number
  ): void {
    // 1. Advance construction animation if currently building
    if (this.isAnimatingConstruction) {
      this.constructionProgress += deltaSec / CONSTRUCTION_ANIMATION_DURATION;
      if (this.constructionProgress >= 1.0) {
        this.constructionProgress = 1.0;
        this.isAnimatingConstruction = false;
        this.isConstructed = true;
      }
      this.applyConstructionProgress(this.constructionProgress);
    }

    if (!this.isConstructed && !this.isAnimatingConstruction) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;

    // 2. Subtle FFT breathing (Section 19: 1-3% gentle scale, window brightness)
    // Low frequency drives microscopic scale breathing
    const scaleBreath = 1.0 + metrics.low * 0.025;
    const finalScale = this.baseScale * scaleBreath;
    this.group.scale.set(finalScale, finalScale, finalScale);

    // Mid/high frequencies modulate luminous windows & light strips
    const windowPulse = 1.0 + metrics.mid * 0.15 + metrics.high * 0.1;
    for (let i = 0; i < this.windowMaterials.length; i++) {
      this.windowMaterials[i].emissiveIntensity = 1.2 * windowPulse;
    }

    // Adapt body emissive to current conductor accent color
    const accent = frameData.interpolatedColor.primaryAccent;
    this.scratchEmissive.setRGB(accent[0] * 0.2, accent[1] * 0.2, accent[2] * 0.2);
    for (let i = 0; i < this.bodyMaterials.length; i++) {
      this.bodyMaterials[i].emissive.copy(this.scratchEmissive);
    }
  }

  reset(): void {
    this.isConstructed = false;
    this.isAnimatingConstruction = false;
    this.constructionProgress = 0;
    this.applyConstructionProgress(0);
    this.group.visible = false;
  }

  setConstructedImmediate(): void {
    this.isConstructed = true;
    this.isAnimatingConstruction = false;
    this.constructionProgress = 1.0;
    this.applyConstructionProgress(1.0);
    this.group.visible = true;
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.bodyMaterials.forEach((m) => m.dispose());
    this.windowMaterials.forEach((m) => m.dispose());
    this.edgeMaterials.forEach((m) => m.dispose());
    this.geometries = [];
    this.bodyMaterials = [];
    this.windowMaterials = [];
    this.edgeMaterials = [];
    this.group.clear();
  }
}
