/**
 * MusicalConductor: The central cinematic clock and progression manager.
 * Driven strictly by audio.currentTime.
 */

import { audioEngine } from '../audio/AudioEngine.js';
import { musicExcerpt } from '../audio/MusicExcerpt.js';
import { CUE_SHEET, CinematicCue, CinematicEventType } from './CueSheet.js';
import { cueExecutor } from './CueExecutor.js';
import { EXPERIENCE_CONFIG, ColorStop } from '../app/ExperienceConfig.js';
import { experienceState } from '../app/ExperienceState.js';

export interface ConductorFrameData {
  relativeTime: number;      // 0 to 38.0s
  normalizedProgress: number; // 0.0 to 1.0
  activeCue: CinematicCue;
  nextCue: CinematicCue | null;
  cueProgress: number;       // Progress within current cue [0, 1]
  interpolatedColor: {
    sky: [number, number, number];
    equator: [number, number, number];
    ground: [number, number, number];
    primaryAccent: [number, number, number];
    warmAccent: [number, number, number];
    intensity: number;
  };
}

export class MusicalConductor {
  private activeCueIndex = 0;
  private lastCheckedAudioTime = -1;

  // Cached frame data
  private frameData: ConductorFrameData;

  constructor() {
    const firstCue = CUE_SHEET[0];
    const initialColors = EXPERIENCE_CONFIG.colors.arrival;
    this.frameData = {
      relativeTime: 0,
      normalizedProgress: 0,
      activeCue: firstCue,
      nextCue: CUE_SHEET[1] || null,
      cueProgress: 0,
      interpolatedColor: {
        sky: [...initialColors.sky],
        equator: [...initialColors.equator],
        ground: [...initialColors.ground],
        primaryAccent: [...initialColors.primaryAccent],
        warmAccent: [...initialColors.warmAccent],
        intensity: initialColors.intensity,
      },
    };
  }

  /**
   * Called every frame in the main render loop.
   * Samples audio.currentTime directly.
   */
  update(): ConductorFrameData {
    const audioTime = audioEngine.currentTime;
    const relTime = musicExcerpt.toRelativeTime(audioTime);
    const normProgress = musicExcerpt.toNormalizedProgress(audioTime);

    // Check completion
    if (audioEngine.isPlaying && musicExcerpt.isComplete(audioTime)) {
      if (experienceState.phase !== 'COMPLETE') {
        experienceState.setPhase('COMPLETE');
        audioEngine.stop();
      }
    }

    // Identify active cue based on relative time
    let cueIndex = 0;
    for (let i = CUE_SHEET.length - 1; i >= 0; i--) {
      if (relTime >= CUE_SHEET[i].relativeTime) {
        cueIndex = i;
        break;
      }
    }

    // Cue transition triggers
    if (cueIndex !== this.activeCueIndex) {
      if (this.activeCueIndex < CUE_SHEET.length) {
        cueExecutor.onCueExit(CUE_SHEET[this.activeCueIndex]);
      }
      this.activeCueIndex = cueIndex;
      cueExecutor.onCueEnter(CUE_SHEET[this.activeCueIndex]);
    }

    const activeCue = CUE_SHEET[this.activeCueIndex];
    const nextCue = this.activeCueIndex + 1 < CUE_SHEET.length ? CUE_SHEET[this.activeCueIndex + 1] : null;

    // Calculate progress within active cue
    const cueDuration = nextCue ? (nextCue.relativeTime - activeCue.relativeTime) : activeCue.duration;
    const cueProgress = cueDuration > 0
      ? Math.max(0, Math.min(1, (relTime - activeCue.relativeTime) / cueDuration))
      : 1;

    cueExecutor.onCueUpdate(activeCue, cueProgress);

    // Color theme interpolation
    const interpolatedColor = this.computeInterpolatedColors(activeCue.event, nextCue?.event ?? null, cueProgress);

    this.frameData.relativeTime = relTime;
    this.frameData.normalizedProgress = normProgress;
    this.frameData.activeCue = activeCue;
    this.frameData.nextCue = nextCue;
    this.frameData.cueProgress = cueProgress;
    this.frameData.interpolatedColor = interpolatedColor;

    this.lastCheckedAudioTime = audioTime;
    return this.frameData;
  }

  private getColorStopForEvent(event: CinematicEventType): ColorStop {
    const cfg = EXPERIENCE_CONFIG.colors;
    switch (event) {
      case 'ARRIVAL': return cfg.arrival;
      case 'DISCOVERY': return cfg.discovery;
      case 'DEVELOPMENT': return cfg.development;
      case 'BUILD': return cfg.build;
      case 'CLIMAX_PREP': return cfg.build;
      case 'CLIMAX': return cfg.climax;
      case 'RELEASE': return cfg.release;
      case 'COMPLETE': return cfg.release;
    }
  }

  private computeInterpolatedColors(
    currEvent: CinematicEventType,
    nextEvent: CinematicEventType | null,
    progress: number
  ) {
    const curr = this.getColorStopForEvent(currEvent);
    const next = nextEvent ? this.getColorStopForEvent(nextEvent) : curr;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const lerp3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
      lerp(a[0], b[0], t),
      lerp(a[1], b[1], t),
      lerp(a[2], b[2], t),
    ];

    // Smoothstep interpolation for soft visual transitions
    const smoothT = progress * progress * (3 - 2 * progress);

    return {
      sky: lerp3(curr.sky, next.sky, smoothT),
      equator: lerp3(curr.equator, next.equator, smoothT),
      ground: lerp3(curr.ground, next.ground, smoothT),
      primaryAccent: lerp3(curr.primaryAccent, next.primaryAccent, smoothT),
      warmAccent: lerp3(curr.warmAccent, next.warmAccent, smoothT),
      intensity: lerp(curr.intensity, next.intensity, smoothT),
    };
  }

  getFrameData(): ConductorFrameData {
    return this.frameData;
  }

  reset(): void {
    this.activeCueIndex = 0;
    this.lastCheckedAudioTime = -1;
    cueExecutor.reset();
  }
}

export const musicalConductor = new MusicalConductor();
