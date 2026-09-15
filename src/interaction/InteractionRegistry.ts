/**
 * InteractionRegistry: Central coordinator for user interactions across
 * Touch, Grab, Pull, and Scale archetypes.
 * Enforces authored constraints, progressive availability, and fallback inputs.
 */

import { Vector3 } from '@iwsdk/core';
import { experienceWorld } from '../app/ExperienceApp.js';

export type InteractionType = 'TOUCH' | 'GRAB' | 'PULL' | 'SCALE';

export interface InteractionTargetState {
  id: string;
  type: InteractionType;
  isAvailable: boolean;
  isHovered: boolean;
  isInteracting: boolean;
}

export class InteractionRegistry {
  private targets: Map<string, InteractionTargetState> = new Map();

  // Active interaction tracking
  private activeGrabTarget: string | null = null;
  private grabStartPos = new Vector3();
  private currentDisplacement = new Vector3();

  // Progressive availability based on cinematic progression
  private touchEnabled = false;
  private grabEnabled = false;
  private pullScaleEnabled = false;

  constructor() {
    this.registerDefaultTargets();
  }

  private registerDefaultTargets(): void {
    this.targets.set('primary-ribbon', {
      id: 'primary-ribbon',
      type: 'TOUCH',
      isAvailable: false,
      isHovered: false,
      isInteracting: false,
    });

    this.targets.set('grab-orb', {
      id: 'grab-orb',
      type: 'GRAB',
      isAvailable: false,
      isHovered: false,
      isInteracting: false,
    });
  }

  setAvailability(touch: boolean, grab: boolean, pullScale: boolean): void {
    this.touchEnabled = touch;
    this.grabEnabled = grab;
    this.pullScaleEnabled = pullScale;

    const touchTarget = this.targets.get('primary-ribbon');
    if (touchTarget) touchTarget.isAvailable = touch;

    const grabTarget = this.targets.get('grab-orb');
    if (grabTarget) grabTarget.isAvailable = grab;
  }

  onHover(targetId: string, isHovered: boolean): void {
    const target = this.targets.get(targetId);
    if (!target || !target.isAvailable) return;
    target.isHovered = isHovered;
  }

  onTouch(targetId: string, hitPoint?: Vector3): void {
    const target = this.targets.get(targetId);
    if (!target || !target.isAvailable) return;

    target.isInteracting = true;
    experienceWorld?.handleTouch(hitPoint);

    setTimeout(() => {
      if (target) target.isInteracting = false;
    }, 300);
  }

  onGrabStart(targetId: string, controllerPos: Vector3): void {
    const target = this.targets.get(targetId);
    if (!target || !target.isAvailable) return;

    this.activeGrabTarget = targetId;
    this.grabStartPos.copy(controllerPos);
    target.isInteracting = true;
  }

  onGrabUpdate(controllerPos: Vector3): void {
    if (!this.activeGrabTarget) return;

    this.currentDisplacement.subVectors(controllerPos, this.grabStartPos);
    experienceWorld?.handleGrab(
      this.currentDisplacement.x,
      this.currentDisplacement.y,
      this.currentDisplacement.z
    );
  }

  onGrabEnd(): void {
    if (!this.activeGrabTarget) return;

    const target = this.targets.get(this.activeGrabTarget);
    if (target) {
      target.isInteracting = false;
    }
    this.activeGrabTarget = null;
    this.currentDisplacement.set(0, 0, 0);
    experienceWorld?.handleGrabRelease();
  }

  isTouchAvailable(): boolean {
    return this.touchEnabled;
  }

  isGrabAvailable(): boolean {
    return this.grabEnabled;
  }

  isPullScaleAvailable(): boolean {
    return this.pullScaleEnabled;
  }

  reset(): void {
    this.activeGrabTarget = null;
    this.setAvailability(false, false, false);
    this.targets.forEach((t) => {
      t.isHovered = false;
      t.isInteracting = false;
    });
  }
}

export const interactionRegistry = new InteractionRegistry();
