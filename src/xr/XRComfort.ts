/**
 * XRComfort: Enforces comfort laws for seated WebXR.
 * Non-negotiable principles:
 * - Seated stationary experience
 * - Zero artificial camera movement
 * - Zero locomotion
 * - Environment remains spatially stable
 */

import { EXPERIENCE_CONFIG } from '../app/ExperienceConfig.js';

export class XRComfort {
  static readonly SEATED_HEIGHT = EXPERIENCE_CONFIG.comfort.seatedHeadHeight; // 1.2m
  static readonly SAFE_NEAR = EXPERIENCE_CONFIG.comfort.safeNearDistance; // 0.4m
  static readonly SAFE_FAR = EXPERIENCE_CONFIG.comfort.safeFarDistance; // 12.0m

  /**
   * Validates that an object position complies with comfort zones
   */
  static isPositionComfortable(x: number, y: number, z: number): boolean {
    const distSq = x * x + z * z;
    const dist = Math.sqrt(distSq);
    return dist >= this.SAFE_NEAR && dist <= this.SAFE_FAR;
  }
}
