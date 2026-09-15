/**
 * TouchElement: Handles ray and poke interactions with subtle hover highlights
 * and momentary ripple reactions.
 */

import { Vector3 } from '@iwsdk/core';
import { interactionRegistry } from './InteractionRegistry.js';

export class TouchElement {
  readonly id: string;

  constructor(id = 'primary-ribbon') {
    this.id = id;
  }

  onPointerEnter(): void {
    interactionRegistry.onHover(this.id, true);
  }

  onPointerLeave(): void {
    interactionRegistry.onHover(this.id, false);
  }

  onSelect(hitPoint?: Vector3): void {
    interactionRegistry.onTouch(this.id, hitPoint);
  }
}
