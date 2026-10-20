/**
 * ExperienceSystem: IWSDK ECS System driving the continuous experience frame updates
 */

import { createSystem } from '@iwsdk/core';
import { experienceApp } from '../app/ExperienceApp.js';

export class ExperienceSystem extends createSystem({}) {
  private frameCount = 0;
  private lastDebugLogTime = 0;

  init(): void {
    experienceApp.init(this.world);
  }

  update(delta: number): void {
    this.frameCount++;
    const isPresenting = !!this.world?.renderer?.xr?.isPresenting;

    // Optional minimal diagnostic gated by ?xrdebug=1
    if (window.location.search.includes('xrdebug=1')) {
      const now = performance.now();
      if (now - this.lastDebugLogTime >= 1000) {
        this.lastDebugLogTime = now;
        console.log('[XRDebug]', {
          isPresenting,
          sessionMode: (this.world?.renderer?.xr?.getSession() as any)?.mode,
          frameCountLastSec: this.frameCount,
          audioContextState: (window as any).audioEngine?.context?.state,
        });
      }
    }

    try {
      experienceApp.update(delta);
    } catch (err) {
      console.error(`[ExperienceSystem] Error during frame update (frame: ${this.frameCount}, isPresenting: ${isPresenting}):`, err);
    }
  }
}
