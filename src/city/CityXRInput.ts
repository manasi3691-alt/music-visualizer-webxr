/**
 * CityXRInput: WebXR controller interaction manager for grabbing city building blocks.
 * Supports distance raycast targeting + proximity sphere grabbing with squeeze (grip) or select (trigger).
 * Preserves seated comfort, enforces explicit transform ownership states, and validates placement.
 */

import { Vector3, Raycaster, Matrix4, Group, Camera, Mesh, SphereGeometry, MeshBasicMaterial } from '@iwsdk/core';
import type { World } from '@iwsdk/core';
import { CityInteraction } from './CityInteraction.js';
import { CityBlock } from './CityBlock.js';
import { interactionDebugState } from '../interaction/InteractionDebugState.js';
import { experienceWorld } from '../app/ExperienceApp.js';

export class CityXRInput {
  private world: World | null = null;
  private interaction: CityInteraction | null = null;

  // Active XR tracking
  private isXRActive = false;
  private activeHand: 'left' | 'right' | null = null;
  private _activeGrabbedBlock: CityBlock | null = null;

  get activeGrabbedBlock(): CityBlock | null {
    return this._activeGrabbedBlock;
  }

  // Controller transformation tracking
  private controllerWorldPos = new Vector3();
  private prevControllerWorldPos = new Vector3();
  private deltaPos = new Vector3();
  private rayOrigin = new Vector3();
  private rayDirection = new Vector3();
  private raycaster = new Raycaster();

  // Reusable scratch objects
  private scratchMat4 = new Matrix4();
  private scratchVec = new Vector3();
  private scratchPos2 = new Vector3();

  // Bound listeners
  private boundOnSelectStart: ((e: Event) => void) | null = null;
  private boundOnSelectEnd: ((e: Event) => void) | null = null;
  private boundOnSqueezeStart: ((e: Event) => void) | null = null;
  private boundOnSqueezeEnd: ((e: Event) => void) | null = null;
  private xrSession: XRSession | null = null;

  init(world: World, interaction: CityInteraction): void {
    this.world = world;
    this.interaction = interaction;
  }

  onXRActive(session: XRSession): void {
    this.isXRActive = true;
    this.xrSession = session;

    // Remove any previous stale listeners
    if (this.boundOnSelectStart) {
      session.removeEventListener('selectstart', this.boundOnSelectStart);
      session.removeEventListener('selectend', this.boundOnSelectEnd!);
      session.removeEventListener('squeezestart', this.boundOnSqueezeStart!);
      session.removeEventListener('squeezeend', this.boundOnSqueezeEnd!);
    }

    this.boundOnSelectStart = (e) => this.handleXRInputStart(e as XRInputSourceEvent, 'select');
    this.boundOnSelectEnd = (e) => this.handleXRInputEnd(e as XRInputSourceEvent, 'select');
    this.boundOnSqueezeStart = (e) => this.handleXRInputStart(e as XRInputSourceEvent, 'squeeze');
    this.boundOnSqueezeEnd = (e) => this.handleXRInputEnd(e as XRInputSourceEvent, 'squeeze');

    session.addEventListener('selectstart', this.boundOnSelectStart);
    session.addEventListener('selectend', this.boundOnSelectEnd);
    session.addEventListener('squeezestart', this.boundOnSqueezeStart);
    session.addEventListener('squeezeend', this.boundOnSqueezeEnd);

    interactionDebugState.set({ xrActive: true });
    console.log('[CityXRInput] XR input listeners registered (select + squeeze)');
  }

  onXREnded(): void {
    this.isXRActive = false;
    if (this.xrSession) {
      if (this.boundOnSelectStart) this.xrSession.removeEventListener('selectstart', this.boundOnSelectStart);
      if (this.boundOnSelectEnd) this.xrSession.removeEventListener('selectend', this.boundOnSelectEnd);
      if (this.boundOnSqueezeStart) this.xrSession.removeEventListener('squeezestart', this.boundOnSqueezeStart);
      if (this.boundOnSqueezeEnd) this.xrSession.removeEventListener('squeezeend', this.boundOnSqueezeEnd);
      this.xrSession = null;
    }

    if (this._activeGrabbedBlock && this.interaction) {
      this.interaction.endGrab();
      this._activeGrabbedBlock = null;
      this.activeHand = null;
    }

    interactionDebugState.set({
      xrActive: false,
      blockGrabbed: false,
      leftControllerDetected: false,
      rightControllerDetected: false,
    });
  }

  /**
   * Called every frame in ExperienceApp.update() to test controller hover targeting and update grabbed block position
   */
  update(deltaSec: number): void {
    if (!this.isXRActive || !this.world || !this.interaction) return;

    // Check if session became available asynchronously
    if (!this.xrSession) {
      const activeSession = (this.world.renderer as any)?.xr?.getSession() || this.world.session;
      if (activeSession) {
        this.onXRActive(activeSession);
      }
    }

    const leftGrip = this.world.player.gripSpaces.left;
    const rightGrip = this.world.player.gripSpaces.right;
    const leftRay = this.world.player.raySpaces.left;
    const rightRay = this.world.player.raySpaces.right;

    // Force matrix update to ensure fresh world coordinates (HEAD: required on Quest
    // where IWSDK may not update grip spaces every frame before the app reads them)
    leftGrip.updateMatrixWorld();
    rightGrip.updateMatrixWorld();
    leftRay.updateMatrixWorld();
    rightRay.updateMatrixWorld();

    // Controller presence: visible flag + matrix position guard (HEAD) with XRSession
    // inputSources as additional fallback when grip space is tracked but not yet visible (incoming)
    const inputSources = this.xrSession?.inputSources ? Array.from(this.xrSession.inputSources) : [];
    const hasLeft = (leftGrip.visible !== false && (leftGrip.matrixWorld.elements[15] > 0 || leftGrip.position.lengthSq() > 0.0001))
      || inputSources.some(s => s.handedness === 'left');
    const hasRight = (rightGrip.visible !== false && (rightGrip.matrixWorld.elements[15] > 0 || rightGrip.position.lengthSq() > 0.0001))
      || inputSources.some(s => s.handedness === 'right');

    interactionDebugState.set({
      leftControllerDetected: hasLeft,
      rightControllerDetected: hasRight,
    });

    // Check GlowingFlower poke/touch in WebXR
    if (experienceWorld?.glowingFlower?.group.visible && !experienceWorld.glowingFlower.touched) {
      const flowerPos = experienceWorld.glowingFlower.collisionSphere.position;
      const flowerWorldPos = this.scratchVec.setFromMatrixPosition(experienceWorld.glowingFlower.collisionSphere.matrixWorld);

      // Check proximity with index tip (hand tracking) or grip (controller)
      const player = this.world.player as any;
      const rightIndexTip = player?.indexTipSpaces?.right;
      const leftIndexTip = player?.indexTipSpaces?.left;

      let touching = false;
      const testProximity = (space: any, threshold: number) => {
        if (!space) return false;
        space.updateMatrixWorld();
        this.scratchPos2.setFromMatrixPosition(space.matrixWorld);
        return this.scratchPos2.distanceTo(flowerWorldPos) <= threshold;
      };

      // 1. Hand tracking index tip proximity (18cm radius)
      if (testProximity(rightIndexTip, 0.18) || testProximity(leftIndexTip, 0.18)) {
        touching = true;
      }
      // 2. Controller grip proximity (24cm radius)
      else if (testProximity(rightGrip, 0.24) || testProximity(leftGrip, 0.24)) {
        touching = true;
      }

      if (touching && experienceWorld.glowingFlower.triggerTouch()) {
        experienceWorld.handleTouch(flowerWorldPos);
      }
    }

    // 1. If currently grabbing, follow the holding controller's grip space
    if (this._activeGrabbedBlock && this.activeHand) {
      const grip = this.activeHand === 'left' ? leftGrip : rightGrip;
      this.controllerWorldPos.setFromMatrixPosition(grip.matrixWorld);

      this.deltaPos.subVectors(this.controllerWorldPos, this.prevControllerWorldPos);
      this.prevControllerWorldPos.copy(this.controllerWorldPos);

      // Pass incremental movement delta to interaction system
      this.interaction.updateGrab(this.deltaPos);
      return;
    }

    // 1.5 If currently grabbing a planet in the SolarSystem
    if (experienceWorld?.solarSystem) {
      if (experienceWorld.solarSystem.isHoldingPlanet('left') && hasLeft) {
        this.controllerWorldPos.setFromMatrixPosition(leftGrip.matrixWorld);
        const headPos = this.world.camera ? this.world.camera.getWorldPosition(new Vector3()) : undefined;
        experienceWorld.solarSystem.handleGrabUpdate('left', this.controllerWorldPos, headPos);
      }
      if (experienceWorld.solarSystem.isHoldingPlanet('right') && hasRight) {
        this.controllerWorldPos.setFromMatrixPosition(rightGrip.matrixWorld);
        const headPos = this.world.camera ? this.world.camera.getWorldPosition(new Vector3()) : undefined;
        experienceWorld.solarSystem.handleGrabUpdate('right', this.controllerWorldPos, headPos);
      }
    }

    // 2. Otherwise, perform targeting/hover detection using controller ray or proximity
    // Check right controller first (preferred dominant hand), then left controller
    let targetedBlock: CityBlock | null = null;

    if (hasRight) {
      targetedBlock = this.findTargetBlock(rightGrip, rightRay);
    }
    if (!targetedBlock && hasLeft) {
      targetedBlock = this.findTargetBlock(leftGrip, leftRay);
    }

    this.interaction.setHoveredBlock(targetedBlock);
    interactionDebugState.set({
      currentlyTargetedBlock: targetedBlock ? targetedBlock.id : 'none',
    });
  }

  private findTargetBlock(gripSpace: Group, raySpace: Group): CityBlock | null {
    if (!this.interaction) return null;
    const availableBlocks = this.interaction.getAvailableBlocks();
    if (availableBlocks.length === 0) return null;

    // A. Proximity check first: is controller within 0.45m of block?
    this.controllerWorldPos.setFromMatrixPosition(gripSpace.matrixWorld);
    for (const block of availableBlocks) {
      const dist = this.controllerWorldPos.distanceTo(block.group.position);
      if (dist <= 0.45) {
        return block;
      }
    }

    // B. Raycast check: is controller pointing at the block?
    this.rayOrigin.setFromMatrixPosition(raySpace.matrixWorld);
    this.rayDirection.set(0, 0, -1).transformDirection(raySpace.matrixWorld).normalize();
    this.raycaster.ray.origin.copy(this.rayOrigin);
    this.raycaster.ray.direction.copy(this.rayDirection);
    this.raycaster.far = 4.0; // Comfortable seated reach

    const meshes = availableBlocks.map((b) => b.baseMesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const hitMesh = hits[0].object;
      return availableBlocks.find((b) => b.baseMesh === hitMesh) || null;
    }

    return null;
  }

  private handleXRInputStart(e: XRInputSourceEvent, eventType: 'select' | 'squeeze'): void {
    if (!this.world || !this.interaction) return;
    const handedness = (e.inputSource.handedness as 'left' | 'right') || 'right';
    interactionDebugState.logEvent(`${eventType}Start (${handedness})`, 'XRInput');

    const grip = handedness === 'left' ? this.world.player.gripSpaces.left : this.world.player.gripSpaces.right;
    const ray = handedness === 'left' ? this.world.player.raySpaces.left : this.world.player.raySpaces.right;

    grip.updateMatrixWorld();
    ray.updateMatrixWorld();

    // Check SolarSystem planet interaction first if SolarSystem is active
    if (experienceWorld?.solarSystem?.group.visible) {
      this.rayOrigin.setFromMatrixPosition(ray.matrixWorld);
      this.rayDirection.set(0, 0, -1).transformDirection(ray.matrixWorld).normalize();
      // Test up to 6.5 meters with generous sphere tolerance
      const hitPlanet = experienceWorld.solarSystem.hitTest(this.rayOrigin, this.rayDirection, 6.5);
      if (hitPlanet) {
        this.controllerWorldPos.setFromMatrixPosition(grip.matrixWorld);
        const grabbed = experienceWorld.solarSystem.handleGrabStart(handedness, hitPlanet, this.controllerWorldPos);
        if (grabbed) {
          interactionDebugState.logEvent(`planetGrabbed (${hitPlanet.name})`, handedness);
          return;
        }
      }
    }

    // If already grabbing city block, ignore additional presses
    if (this._activeGrabbedBlock) return;

    const target = this.findTargetBlock(grip, ray);
    if (target) {
      this.activeHand = handedness;
      this._activeGrabbedBlock = target;
      this.controllerWorldPos.setFromMatrixPosition(grip.matrixWorld);
      this.prevControllerWorldPos.copy(this.controllerWorldPos);

      const success = this.interaction.startGrab(target.id, this.controllerWorldPos);
      if (success) {
        interactionDebugState.set({
          blockGrabbed: true,
          grabbedBlockId: target.id,
        });
        interactionDebugState.logEvent(`grabbed (${target.id})`, handedness);
      } else {
        this._activeGrabbedBlock = null;
        this.activeHand = null;
      }
    }
  }

  private handleXRInputEnd(e: XRInputSourceEvent, eventType: 'select' | 'squeeze'): void {
    const handedness = (e.inputSource.handedness as 'left' | 'right') || 'right';
    interactionDebugState.logEvent(`${eventType}End (${handedness})`, 'XRInput');

    // Check if releasing a grabbed planet
    if (experienceWorld?.solarSystem?.isHoldingPlanet(handedness)) {
      experienceWorld.solarSystem.handleGrabEnd(handedness);
      interactionDebugState.logEvent(`planetReleased`, handedness);
      return;
    }

    if (!this._activeGrabbedBlock || !this.interaction) return;

    // Only release if the event came from the hand holding the block
    if (this.activeHand === handedness) {
      const grabbedId = this._activeGrabbedBlock.id;
      const placed = this.interaction.endGrab();
      const resultText = placed ? `placed (${grabbedId})` : `returned (${grabbedId})`;

      interactionDebugState.set({
        blockGrabbed: false,
        grabbedBlockId: 'none',
        lastReleaseEvent: resultText,
      });
      interactionDebugState.logEvent(resultText, handedness);

      this._activeGrabbedBlock = null;
      this.activeHand = null;
    }
  }
}

export const cityXRInput = new CityXRInput();
