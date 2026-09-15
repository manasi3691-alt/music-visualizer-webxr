/**
 * GrabElement: Manages one-hand grabbing with spatial constraints.
 * Ensures the user shapes the environment without throwing or losing objects.
 */

import { Vector3 } from '@iwsdk/core';
import { interactionRegistry } from './InteractionRegistry.js';

export class GrabElement {
  readonly id: string;

  constructor(id = 'grab-orb') {
    this.id = id;
  }

  onGrabStart(pos: Vector3): void {
    interactionRegistry.onGrabStart(this.id, pos);
  }

  onGrabUpdate(pos: Vector3): void {
    interactionRegistry.onGrabUpdate(pos);
  }

  onGrabEnd(): void {
    interactionRegistry.onGrabEnd();
  }
}
