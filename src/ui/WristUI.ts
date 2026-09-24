/**
 * WristUI: Procedural holographic control panel attached to a THREE.Group.
 * Compilable stub for Task 1 (no meshes yet).
 */

import { Group } from '@iwsdk/core';
import { WristUIState } from './WristUIState.js';

export class WristUI {
  readonly group: Group;
  private _state: WristUIState = WristUIState.CLOSED;

  constructor(group: Group) {
    this.group = group;
    this.group.visible = false;
  }

  get state(): WristUIState {
    return this._state;
  }

  open(): void {
    this._state = WristUIState.OPEN;
    this.group.visible = true;
  }

  close(): void {
    this._state = WristUIState.CLOSED;
    this.group.visible = false;
  }

  update(dt: number): void {
    // Animation and visual updates will be added in Tasks 2 and 3
    void dt;
  }

  dispose(): void {
    // Geometry/material disposal will be added with mesh creation
  }
}
