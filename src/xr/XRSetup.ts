/**
 * XRSetup: Integrates IWSDK World XR launch / exit lifecycle
 */

import { World } from '@iwsdk/core';
import { experienceState } from '../app/ExperienceState.js';
import { xrState } from './XRState.js';

export class XRSetup {
  private world: World | null = null;

  init(world: World): void {
    this.world = world;
    xrState.checkSupport().then((supported) => {
      console.log(`[XRSetup] WebXR immersive-vr supported: ${supported}`);
    });
  }

  async launchXR(): Promise<void> {
    if (!this.world) return;
    try {
      experienceState.setXRState('REQUESTING');
      await this.world.launchXR();
      experienceState.setXRState('ACTIVE');
    } catch (err) {
      console.error('[XRSetup] Launch XR failed:', err);
      experienceState.setXRState('ENDED');
    }
  }

  async exitXR(): Promise<void> {
    if (!this.world) return;
    try {
      await this.world.exitXR();
      experienceState.setXRState('ENDED');
    } catch (err) {
      console.error('[XRSetup] Exit XR failed:', err);
    }
  }
}

export const xrSetup = new XRSetup();
