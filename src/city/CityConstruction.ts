/**
 * CityConstruction: Manages authored user construction zones, placement previews,
 * bounded snap validation, and timeline failsafe auto-completion.
 */

import {
  Group,
  Mesh,
  CylinderGeometry,
  TorusGeometry,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  Vector3,
  Color,
} from '@iwsdk/core';
import { CityBuilding } from './CityBuilding.js';
import { BuildingType, CITY_PALETTE, CONSTRUCTION_ANIMATION_DURATION } from './CityConfig.js';

export type ConstructionZoneState = 'INACTIVE' | 'AVAILABLE' | 'PROXIMITY_ACTIVE' | 'OCCUPIED';

export interface ConstructionZoneConfig {
  id: string;
  position: Vector3;
  defaultBuildingType: BuildingType;
  radius?: number;
  label?: string;
}

export class ConstructionZone {
  readonly id: string;
  readonly group: Group = new Group();
  readonly position: Vector3 = new Vector3();
  readonly defaultBuildingType: BuildingType;
  readonly snapRadius: number;

  state: ConstructionZoneState = 'INACTIVE';

  // Visuals
  private padMesh: Mesh;
  private ringMesh: Mesh;
  private padMaterial: MeshPhysicalMaterial;
  private ringMaterial: MeshStandardMaterial;

  // Placed / Built building instance
  placedBuilding: CityBuilding | null = null;

  // Auto-complete failsafe tracking
  private availableTimestamp = -1;
  private isAutoCompleted = false;

  // Scratch objects
  private scratchColor = new Color();

  constructor(cfg: ConstructionZoneConfig) {
    this.id = cfg.id;
    this.position.copy(cfg.position);
    this.defaultBuildingType = cfg.defaultBuildingType;
    this.snapRadius = cfg.radius ?? 0.38;

    this.group.position.copy(this.position);

    // 1. Holographic landing pad
    const padGeo = new CylinderGeometry(this.snapRadius * 0.9, this.snapRadius, 0.03, 24);
    this.padMaterial = new MeshPhysicalMaterial({
      color: 0x4a6cb0,
      emissive: 0x22386a,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.1,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.padMesh = new Mesh(padGeo, this.padMaterial);
    this.padMesh.position.y = 0.015;
    this.group.add(this.padMesh);

    // 2. Glowing pulse boundary ring
    const ringGeo = new TorusGeometry(this.snapRadius, 0.012, 8, 32);
    this.ringMaterial = new MeshStandardMaterial({
      color: CITY_PALETTE.pathwayGlow,
      emissive: CITY_PALETTE.pathwayGlow,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.ringMesh = new Mesh(ringGeo, this.ringMaterial);
    this.ringMesh.rotation.x = Math.PI / 2;
    this.ringMesh.position.y = 0.03;
    this.group.add(this.ringMesh);

    this.group.visible = false;
  }

  setAvailable(available: boolean): void {
    if (this.state === 'OCCUPIED') return;

    if (available) {
      this.state = 'AVAILABLE';
      this.group.visible = true;
      this.padMaterial.opacity = 0.6;
      this.ringMaterial.opacity = 0.85;
      this.ringMaterial.color.setHex(CITY_PALETTE.pathwayGlow);
      this.ringMaterial.emissive.setHex(CITY_PALETTE.pathwayGlow);
    } else {
      this.state = 'INACTIVE';
      this.group.visible = false;
      this.padMaterial.opacity = 0.0;
      this.ringMaterial.opacity = 0.0;
    }
  }

  /**
   * Tests if a given world position is within this zone's snap radius
   */
  isPositionInside(pos: Vector3): boolean {
    if (this.state !== 'AVAILABLE' && this.state !== 'PROXIMITY_ACTIVE') return false;
    const distSq = (pos.x - this.position.x) ** 2 + (pos.z - this.position.z) ** 2;
    const dy = Math.abs(pos.y - this.position.y);
    return distSq <= this.snapRadius * this.snapRadius && dy <= 0.45;
  }

  setProximityHover(inProximity: boolean): void {
    if (this.state !== 'AVAILABLE' && this.state !== 'PROXIMITY_ACTIVE') return;

    if (inProximity) {
      this.state = 'PROXIMITY_ACTIVE';
      this.padMaterial.opacity = 0.85;
      this.ringMaterial.opacity = 1.0;
      this.ringMaterial.color.setHex(CITY_PALETTE.previewValid);
      this.ringMaterial.emissive.setHex(CITY_PALETTE.previewValid);
      this.ringMaterial.emissiveIntensity = 2.2;
    } else {
      this.state = 'AVAILABLE';
      this.padMaterial.opacity = 0.6;
      this.ringMaterial.opacity = 0.85;
      this.ringMaterial.color.setHex(CITY_PALETTE.pathwayGlow);
      this.ringMaterial.emissive.setHex(CITY_PALETTE.pathwayGlow);
      this.ringMaterial.emissiveIntensity = 1.0;
    }
  }

  /**
   * Completes building placement into this zone (either user-driven or timeline failsafe)
   */
  constructBuilding(type?: BuildingType): CityBuilding {
    this.state = 'OCCUPIED';
    this.isAutoCompleted = true;

    // Fade out construction guide ring
    this.padMaterial.opacity = 0.2;
    this.ringMaterial.opacity = 0.3;

    const buildingType = type ?? this.defaultBuildingType;
    const building = new CityBuilding({
      id: `${this.id}-placed`,
      type: buildingType,
      position: this.position.clone(),
      scale: 1.0,
      isConstructed: false,
    });

    this.placedBuilding = building;
    building.startConstruction();
    return building;
  }

  update(deltaSec: number, currentTime: number): void {
    if (this.state === 'AVAILABLE' || this.state === 'PROXIMITY_ACTIVE') {
      // Gentle breathing pulse on ring
      const pulse = 1.0 + Math.sin(currentTime * 3.5) * 0.15;
      this.ringMesh.scale.set(pulse, pulse, pulse);
    }
  }

  reset(): void {
    this.state = 'INACTIVE';
    this.isAutoCompleted = false;
    this.availableTimestamp = -1;
    this.group.visible = false;
    this.padMaterial.opacity = 0.0;
    this.ringMaterial.opacity = 0.0;
    if (this.placedBuilding) {
      this.placedBuilding.dispose();
      this.placedBuilding = null;
    }
  }

  dispose(): void {
    this.padMesh.geometry.dispose();
    this.padMaterial.dispose();
    this.ringMesh.geometry.dispose();
    this.ringMaterial.dispose();
    if (this.placedBuilding) {
      this.placedBuilding.dispose();
      this.placedBuilding = null;
    }
    this.group.clear();
  }
}
