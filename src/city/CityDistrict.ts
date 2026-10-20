/**
 * CityDistrict: Authored spatial districts surrounding the seated user.
 * Organizes buildings, roads, bridges, and pathways into coherent 360-degree neighborhoods.
 * Activates progressively with the MusicalConductor timeline.
 */

import {
  Group,
  Mesh,
  BoxGeometry,
  PlaneGeometry,
  CylinderGeometry,
  TorusGeometry,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  LineSegments,
  EdgesGeometry,
  LineBasicMaterial,
  Color,
  Vector3,
  DoubleSide,
} from '@iwsdk/core';
import { CityBuilding } from './CityBuilding.js';
import { CityBlock } from './CityBlock.js';
import { CITY_ZONES, CITY_PALETTE, CityZoneName } from './CityConfig.js';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export interface DistrictConfig {
  id: string;
  name: string;
  zone: CityZoneName;
  activationPhase: 'CALM' | 'DISCOVERY' | 'DEVELOPMENT' | 'BUILD' | 'CLIMAX';
  buildings: {
    type: 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D' | 'TYPE_E';
    relPos: [number, number, number];
    rotY?: number;
    scale?: number;
    color?: number;
  }[];
  hasPlatform?: boolean;
  platformRadius?: number;
  connections?: {
    from: [number, number, number];
    to: [number, number, number];
    width?: number;
  }[];
}

export class CityDistrict {
  readonly id: string;
  readonly name: string;
  readonly zone: CityZoneName;
  readonly activationPhase: 'CALM' | 'DISCOVERY' | 'DEVELOPMENT' | 'BUILD' | 'CLIMAX';
  readonly group: Group = new Group();

  private buildings: CityBuilding[] = [];
  private connectionMeshes: Mesh[] = [];
  private connectionMaterials: MeshStandardMaterial[] = [];
  private platformMesh: Mesh | null = null;
  private platformMaterial: MeshPhysicalMaterial | null = null;

  private isActivated = false;
  private activationProgress = 0; // 0 to 1

  // Scratch objects
  private scratchColor = new Color();

  constructor(cfg: DistrictConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.zone = cfg.zone;
    this.activationPhase = cfg.activationPhase;

    const zoneDef = CITY_ZONES[this.zone];
    this.group.position.copy(zoneDef.center);

    // 1. Procedural District Platform / Base Terrace
    if (cfg.hasPlatform) {
      const radius = cfg.platformRadius ?? 1.1;
      const platGeo = new CylinderGeometry(radius, radius * 1.08, 0.06, 24);
      this.platformMaterial = new MeshPhysicalMaterial({
        color: 0x2e3a5c,
        emissive: 0x121a30,
        emissiveIntensity: 0.4,
        roughness: 0.25,
        metalness: 0.15,
        transparent: true,
        opacity: 0.85,
        depthWrite: true,
      });
      this.platformMesh = new Mesh(platGeo, this.platformMaterial);
      this.platformMesh.position.y = -0.03;
      this.group.add(this.platformMesh);

      // Glowing border ring
      const ringGeo = new TorusGeometry(radius, 0.012, 8, 32);
      const ringMat = new MeshStandardMaterial({
        color: CITY_PALETTE.pathwayGlow,
        emissive: CITY_PALETTE.pathwayGlow,
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0.9,
      });
      const ringMesh = new Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = Math.PI / 2;
      ringMesh.position.y = 0.0;
      this.group.add(ringMesh);
    }

    // 2. Procedural Pathways / Roads connecting buildings within this district
    if (cfg.connections) {
      cfg.connections.forEach((conn, idx) => {
        const p1 = new Vector3(...conn.from);
        const p2 = new Vector3(...conn.to);
        const distance = p1.distanceTo(p2);
        const width = conn.width ?? 0.14;

        const pathGeo = new PlaneGeometry(width, distance);
        const pathMat = new MeshStandardMaterial({
          color: CITY_PALETTE.pathwayGlow,
          emissive: CITY_PALETTE.pathwayGlow,
          emissiveIntensity: 1.0,
          transparent: true,
          opacity: 0.0,
          depthWrite: false,
          side: DoubleSide,
        });
        const pathMesh = new Mesh(pathGeo, pathMat);

        // Position at midpoint between p1 and p2
        const mid = new Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        pathMesh.position.copy(mid);
        pathMesh.position.y = 0.01; // Just above platform

        // Orient along path direction
        pathMesh.rotation.x = -Math.PI / 2;
        const angle = Math.atan2(p2.x - p1.x, p2.z - p1.z);
        pathMesh.rotation.z = -angle;

        this.group.add(pathMesh);
        this.connectionMeshes.push(pathMesh);
        this.connectionMaterials.push(pathMat);
      });
    }

    // 3. Buildings in district
    cfg.buildings.forEach((bCfg, idx) => {
      const bld = new CityBuilding({
        id: `${this.id}-bld-${idx}`,
        type: bCfg.type,
        position: new Vector3(...bCfg.relPos),
        rotationY: bCfg.rotY ?? 0,
        scale: bCfg.scale ?? 1.0,
        isConstructed: false,
        primaryColor: bCfg.color,
      });
      this.group.add(bld.group);
      this.buildings.push(bld);
    });

    this.group.visible = true;
  }

  activate(staggerIndex = 0): void {
    if (this.isActivated) return;
    this.isActivated = true;
    this.group.visible = true;

    // Stagger building emergence slightly for a rich organic growth effect
    this.buildings.forEach((bld, idx) => {
      const delay = (staggerIndex * 0.4 + idx * 0.25) * 1000;
      setTimeout(() => {
        if (this.isActivated) {
          bld.startConstruction();
        }
      }, delay);
    });
  }

  update(
    frameData: ConductorFrameData,
    metrics: AudioMetrics,
    deltaSec: number
  ): void {
    if (!this.group.visible) return;

    // 1. Advance connection road opacity
    if (this.isActivated && this.activationProgress < 1.0) {
      this.activationProgress = Math.min(1.0, this.activationProgress + deltaSec * 0.8);
      const roadOpacity = this.activationProgress * 0.75;
      for (let i = 0; i < this.connectionMaterials.length; i++) {
        this.connectionMaterials[i].opacity = roadOpacity;
      }
    }

    // 2. Modulate pathway glow with music
    const pathPulse = 0.8 + metrics.mid * 0.3;
    for (let i = 0; i < this.connectionMaterials.length; i++) {
      this.connectionMaterials[i].emissiveIntensity = pathPulse;
    }

    // 3. Update all buildings
    for (let i = 0; i < this.buildings.length; i++) {
      this.buildings[i].update(frameData, metrics, deltaSec);
    }
  }

  reset(): void {
    this.isActivated = false;
    this.activationProgress = 0;
    this.group.visible = true;
    for (let i = 0; i < this.connectionMaterials.length; i++) {
      this.connectionMaterials[i].opacity = 0;
    }
    for (let i = 0; i < this.buildings.length; i++) {
      this.buildings[i].reset();
    }
  }

  forceImmediateBuild(): void {
    this.isActivated = true;
    this.activationProgress = 1.0;
    this.group.visible = true;
    for (let i = 0; i < this.connectionMaterials.length; i++) {
      this.connectionMaterials[i].opacity = 0.8;
    }
    for (let i = 0; i < this.buildings.length; i++) {
      this.buildings[i].setConstructedImmediate();
    }
  }

  dispose(): void {
    this.buildings.forEach((b) => b.dispose());
    this.buildings = [];
    this.connectionMaterials.forEach((m) => m.dispose());
    this.connectionMeshes.forEach((m) => m.geometry.dispose());
    this.connectionMaterials = [];
    this.connectionMeshes = [];
    if (this.platformMesh) {
      this.platformMesh.geometry.dispose();
      this.platformMaterial?.dispose();
    }
    this.group.clear();
  }
}
