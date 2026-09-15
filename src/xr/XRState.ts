/**
 * XRState: Tracks WebXR session readiness and device controllers
 */

import { experienceState, XRLifecycleState } from '../app/ExperienceState.js';

export class XRState {
  private _isSupported = false;

  async checkSupport(): Promise<boolean> {
    if ('xr' in navigator && (navigator as any).xr?.isSessionSupported) {
      try {
        this._isSupported = await (navigator as any).xr.isSessionSupported('immersive-vr');
      } catch {
        this._isSupported = false;
      }
    } else {
      this._isSupported = false;
    }
    return this._isSupported;
  }

  get isSupported(): boolean {
    return this._isSupported;
  }

  get lifecycle(): XRLifecycleState {
    return experienceState.xrState;
  }
}

export const xrState = new XRState();
