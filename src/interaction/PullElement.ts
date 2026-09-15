/**
 * PullElement: Organic pull mechanic mapping controller displacement
 * to an authored reveal/unfold progress [0, 1].
 */

import { EXPERIENCE_CONFIG } from '../app/ExperienceConfig.js';
import { experienceWorld } from '../app/ExperienceApp.js';

export class PullElement {
  private pullProgress = 0; // 0 to 1
  private maxDistance = EXPERIENCE_CONFIG.interaction.maxPullDisplacement;

  updatePull(currentDistance: number): number {
    this.pullProgress = Math.max(0, Math.min(1, currentDistance / this.maxDistance));
    // Trigger visual reveal response
    if (experienceWorld) {
      experienceWorld.handleGrab(0, this.pullProgress * 0.25, 0);
    }
    return this.pullProgress;
  }

  release(): void {
    this.pullProgress = 0;
    if (experienceWorld) {
      experienceWorld.handleGrabRelease();
    }
  }

  getProgress(): number {
    return this.pullProgress;
  }
}
