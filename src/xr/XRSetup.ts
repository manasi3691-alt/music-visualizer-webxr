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

    // Listen to real Three.js WebXR session lifecycle events
    world.renderer.xr.addEventListener('sessionstart', () => {
      if (!world.session) {
        world.session = world.renderer.xr.getSession() ?? undefined;
      }
      console.log('[XRSetup] WebXR session started, active session:', !!world.session);
      experienceState.setXRState('ACTIVE');
    });

    world.renderer.xr.addEventListener('sessionend', () => {
      console.log('[XRSetup] WebXR session ended');
      world.session = undefined;
      experienceState.setXRState('ENDED');
    });

    console.log(`[XRSetup] WebXR immersive-vr supported: ${xrState.isSupported}`);
  }

  launchXR(): void {
    if (!this.world) return;
    if (this.world.session) {
      console.log('[XRSetup] Session already active');
      experienceState.setXRState('ACTIVE');
      return;
    }

    try {
      experienceState.setXRState('REQUESTING');
      this.world.launchXR();

      setTimeout(() => {
        if (experienceState.xrState === 'REQUESTING' && !this.world?.session) {
          console.warn('[XRSetup] Session request timed out or was dismissed');
          experienceState.setXRState('NONE');
        }
      }, 5000);
    } catch (err) {
      console.error('[XRSetup] Launch XR failed:', err);
      experienceState.setXRState('ENDED');
      experienceState.setError(`Failed to launch WebXR: ${(err as Error)?.message || err}`);
    }
  }

  async exitXR(): Promise<void> {
    if (!this.world) return;
    try {
      this.world.exitXR();
      experienceState.setXRState('ENDED');
    } catch (err) {
      console.error('[XRSetup] Exit XR failed:', err);
    }
  }
}

export const xrSetup = new XRSetup();
