/**
 * WristUIController: Wires WristUI with the existing application systems.
 * Compilable stub for Task 1.
 */

import { Group } from '@iwsdk/core';
import { WristUI } from './WristUI.js';
import { ExperiencePhase } from '../app/ExperienceState.js';

export interface WristUIDependencies {
  audio: {
    play: () => Promise<void>;
    resume: () => void;
    pause: () => void;
    getCurrentTime: () => number;
    isPlaying: () => boolean;
  };
  excerpt: {
    sourceStart: number;
    sourceEnd: number;
    duration: number;
  };
  state: {
    getCurrentPhase: () => ExperiencePhase;
    subscribePhase: (listener: (phase: ExperiencePhase) => void) => () => void;
  };
  replay: () => void;
}

export class WristUIController {
  private wristUI: WristUI | null = null;
  private deps: WristUIDependencies | null = null;
  private readonly rootGroup: Group = new Group();

  init(deps: WristUIDependencies): void {
    this.deps = deps;
    this.wristUI = new WristUI(this.rootGroup);
  }

  getUI(): WristUI | null {
    return this.wristUI;
  }

  dispose(): void {
    if (this.wristUI) {
      this.wristUI.dispose();
      this.wristUI = null;
    }
    this.deps = null;
  }
}

export const wristUIController = new WristUIController();
