/**
 * CityInteraction: Orchestrates user grab, preview snapping, placement,
 * and transform ownership between User, Timeline, and Animation states.
 * Fully supports desktop fallback mouse dragging and WebXR controller input.
 */

import { Vector3, Vector2, Camera, Raycaster, Object3D, MathUtils } from '@iwsdk/core';
import { CityBlock } from './CityBlock.js';
import { ConstructionZone } from './CityConstruction.js';
import { CityBuilding } from './CityBuilding.js';
import { BuildingType, TransformOwnership } from './CityConfig.js';

export interface CityInteractionDelegate {
  onBuildingConstructed: (building: CityBuilding, zone: ConstructionZone) => void;
  onPlacementRipple: (pos: Vector3) => void;
}

export class CityInteraction {
  private interactiveBlocks: CityBlock[] = [];
  private constructionZones: ConstructionZone[] = [];
  private delegate: CityInteractionDelegate | null = null;

  // Active interaction tracking
  private activeGrabbedBlock: CityBlock | null = null;
  private hoveredBlock: CityBlock | null = null;
  private activeHoverZone: ConstructionZone | null = null;

  // Grab displacement reference points
  private grabStartPointer = new Vector3();
  private grabBlockStartPos = new Vector3();
  private currentPointerPos = new Vector3();

  // Desktop raycasting support
  private raycaster = new Raycaster();
  private scratchPointer = new Vector2();

  constructor() {}

  setDelegate(delegate: CityInteractionDelegate): void {
    this.delegate = delegate;
  }

  registerBlock(block: CityBlock): void {
    if (!this.interactiveBlocks.includes(block)) {
      this.interactiveBlocks.push(block);
    }
  }

  getAvailableBlocks(): CityBlock[] {
    return this.interactiveBlocks.filter(
      (b) => b.isInteractive && b.ownership !== 'Locked' && b.group.visible
    );
  }

  registerZone(zone: ConstructionZone): void {
    if (!this.constructionZones.includes(zone)) {
      this.constructionZones.push(zone);
    }
  }

  /**
   * Called on desktop pointer down or XR trigger/grip to begin grabbing a city block
   */
  startGrab(blockId: string, worldPos: Vector3): boolean {
    const block = this.interactiveBlocks.find((b) => b.id === blockId);
    if (!block || block.ownership === 'Locked') return false;

    this.activeGrabbedBlock = block;
    this.grabStartPointer.copy(worldPos);
    this.grabBlockStartPos.copy(block.group.position);
    this.currentPointerPos.copy(worldPos);

    block.setGrabbed(true);
    return true;
  }

  /**
   * Called each frame during dragging to update block position and check zone preview
   */
  updateGrab(deltaPointer: Vector3): void {
    if (!this.activeGrabbedBlock) return;

    // Constrain motion to comfortable seated reach
    const newPos = new Vector3()
      .copy(this.grabBlockStartPos)
      .add(deltaPointer);

    // Clamp Y to safe seated heights (0.6m to 1.6m) and radial reach (0.4m to 1.6m)
    newPos.y = MathUtils.clamp(newPos.y, 0.6, 1.5);
    const planarDist = Math.sqrt(newPos.x * newPos.x + newPos.z * newPos.z);
    if (planarDist < 0.45) {
      const scale = 0.45 / (planarDist || 1);
      newPos.x *= scale;
      newPos.z *= scale;
    } else if (planarDist > 1.6) {
      const scale = 1.6 / planarDist;
      newPos.x *= scale;
      newPos.z *= scale;
    }

    this.activeGrabbedBlock.group.position.copy(newPos);

    // Test proximity against active construction zones
    let matchedZone: ConstructionZone | null = null;
    for (const zone of this.constructionZones) {
      if (zone.isPositionInside(newPos)) {
        matchedZone = zone;
        break;
      }
    }

    if (matchedZone !== this.activeHoverZone) {
      if (this.activeHoverZone) {
        this.activeHoverZone.setProximityHover(false);
      }
      this.activeHoverZone = matchedZone;
      if (this.activeHoverZone) {
        this.activeHoverZone.setProximityHover(true);
      }
    }
  }

  /**
   * Called on pointer up / release to snap into zone or spring-back
   */
  endGrab(): boolean {
    if (!this.activeGrabbedBlock) return false;

    const block = this.activeGrabbedBlock;
    const currentPos = block.group.position.clone();

    let placedSuccess = false;

    // Check if released inside a valid construction zone
    if (this.activeHoverZone && this.activeHoverZone.isPositionInside(currentPos)) {
      // 1. Success! Lock block, trigger construction animation
      this.activeHoverZone.setProximityHover(false);
      const zone = this.activeHoverZone;
      block.lockInPlace(zone.position);
      block.setVisibility(false); // Hide the preview block as the building emerges

      const building = zone.constructBuilding();
      if (this.delegate) {
        this.delegate.onBuildingConstructed(building, zone);
        this.delegate.onPlacementRipple(zone.position);
      }

      placedSuccess = true;
      this.activeHoverZone = null;
    } else {
      // 2. Released outside valid zone: spring back safely to home position
      if (this.activeHoverZone) {
        this.activeHoverZone.setProximityHover(false);
        this.activeHoverZone = null;
      }
      block.setGrabbed(false);
      block.startSpringBack(currentPos);
    }

    this.activeGrabbedBlock = null;
    return placedSuccess;
  }

  /**
   * Checks if any interactive block is hit by a camera ray (desktop fallback)
   */
  hitTest(camera: Camera, pointerNdc: { x: number; y: number }): CityBlock | null {
    this.scratchPointer.set(pointerNdc.x, pointerNdc.y);
    this.raycaster.setFromCamera(this.scratchPointer, camera);
    const meshes = this.interactiveBlocks
      .filter((b) => b.isInteractive && b.ownership !== 'Locked')
      .map((b) => b.baseMesh);

    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const hitMesh = hits[0].object;
      const found = this.interactiveBlocks.find((b) => b.baseMesh === hitMesh);
      return found ?? null;
    }
    return null;
  }

  setHoveredBlock(block: CityBlock | null): void {
    if (this.hoveredBlock && this.hoveredBlock !== block) {
      this.hoveredBlock.setHover(false);
    }
    this.hoveredBlock = block;
    if (this.hoveredBlock) {
      this.hoveredBlock.setHover(true);
    }
  }

  isGrabbing(): boolean {
    return this.activeGrabbedBlock !== null;
  }

  getActiveGrabbedBlock(): CityBlock | null {
    return this.activeGrabbedBlock;
  }

  update(deltaSec: number, currentTime: number): void {
    // Update all blocks and zones
    for (const block of this.interactiveBlocks) {
      block.update(deltaSec);
    }
    for (const zone of this.constructionZones) {
      zone.update(deltaSec, currentTime);
    }
  }

  reset(): void {
    if (this.activeGrabbedBlock) {
      this.activeGrabbedBlock.setGrabbed(false);
      this.activeGrabbedBlock = null;
    }
    if (this.activeHoverZone) {
      this.activeHoverZone.setProximityHover(false);
      this.activeHoverZone = null;
    }
    this.setHoveredBlock(null);
    for (const block of this.interactiveBlocks) {
      block.ownership = 'TimelineOwned';
      block.group.position.copy(block.homePosition);
      block.setVisibility(true);
    }
  }
}
