/**
 * ExperienceSystem: IWSDK ECS System driving the continuous experience frame updates
 */

import { createSystem } from '@iwsdk/core';
import { experienceApp } from '../app/ExperienceApp.js';

export class ExperienceSystem extends createSystem({}) {
  init(): void {
    experienceApp.init(this.world);
  }

  update(delta: number): void {
    experienceApp.update(delta);
  }
}
