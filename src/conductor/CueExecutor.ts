/**
 * CueExecutor: Dispatches deterministic event actions to visual and interaction systems
 */

import { CinematicCue, CinematicEventType } from './CueSheet.js';
import { experienceState } from '../app/ExperienceState.js';

export type CueListener = (cue: CinematicCue, progressInCue: number) => void;

export class CueExecutor {
  private activeCue: CinematicCue | null = null;
  private listeners: Set<CueListener> = new Set();
  private eventHandlers: Map<CinematicEventType, (cue: CinematicCue) => void> = new Map();

  constructor() {
    this.registerDefaultHandlers();
  }

  private registerDefaultHandlers(): void {
    this.eventHandlers.set('ARRIVAL', () => {
      // Calm entry
    });

    this.eventHandlers.set('DISCOVERY', () => {
      // Touch interaction unlocked
    });

    this.eventHandlers.set('DEVELOPMENT', () => {
      // Grab interaction unlocked
    });

    this.eventHandlers.set('BUILD', () => {
      // Pull & Scale unlocked
    });

    this.eventHandlers.set('CLIMAX_PREP', () => {
      // Prepare climax
    });

    this.eventHandlers.set('CLIMAX', () => {
      experienceState.setPhase('CLIMAX');
    });

    this.eventHandlers.set('RELEASE', () => {
      experienceState.setPhase('RELEASE');
    });

    this.eventHandlers.set('COMPLETE', () => {
      experienceState.setPhase('COMPLETE');
    });
  }

  onCueEnter(cue: CinematicCue): void {
    this.activeCue = cue;
    console.log(`[CueExecutor] Enter: ${cue.id} (${cue.event}) at ${cue.relativeTime.toFixed(1)}s`);
    const handler = this.eventHandlers.get(cue.event);
    if (handler) {
      handler(cue);
    }
  }

  onCueUpdate(cue: CinematicCue, progressInCue: number): void {
    this.listeners.forEach((listener) => {
      try {
        listener(cue, progressInCue);
      } catch (err) {
        console.error('[CueExecutor] Listener error:', err);
      }
    });
  }

  onCueExit(cue: CinematicCue): void {
    console.log(`[CueExecutor] Exit: ${cue.id}`);
  }

  subscribe(listener: CueListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getActiveCue(): CinematicCue | null {
    return this.activeCue;
  }

  reset(): void {
    this.activeCue = null;
  }
}

export const cueExecutor = new CueExecutor();
