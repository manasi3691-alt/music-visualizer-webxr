/**
 * ScaleElement: Controlled two-hand or mouse-wheel scaling archetype.
 * Enforces strict lower (0.75x) and upper (1.5x) bounds.
 */

import { EXPERIENCE_CONFIG } from '../app/ExperienceConfig.js';
import { experienceWorld } from '../app/ExperienceApp.js';

export class ScaleElement {
  private currentScale = 1.0;
  private minScale = EXPERIENCE_CONFIG.interaction.minScaleFactor;
  private maxScale = EXPERIENCE_CONFIG.interaction.maxScaleFactor;

  applyScaleDelta(factor: number): number {
    this.currentScale = Math.max(this.minScale, Math.min(this.maxScale, this.currentScale * factor));
    return this.currentScale;
  }

  resetScale(): void {
    this.currentScale = 1.0;
  }

  getScale(): number {
    return this.currentScale;
  }
}
