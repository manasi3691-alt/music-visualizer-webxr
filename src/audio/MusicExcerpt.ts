/**
 * Authored music excerpt definitions and time mapping
 * For Ludovico Einaudi - "Experience"
 */

import { EXPERIENCE_CONFIG } from '../app/ExperienceConfig.js';

export class MusicExcerpt {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly duration: number;

  constructor(
    sourceStart: number = EXPERIENCE_CONFIG.excerpt.sourceStart,
    sourceEnd: number = EXPERIENCE_CONFIG.excerpt.sourceEnd
  ) {
    this.sourceStart = sourceStart;
    this.sourceEnd = sourceEnd;
    this.duration = sourceEnd - sourceStart;
  }

  /**
   * Convert absolute audio.currentTime to relative excerpt time [0, duration]
   */
  toRelativeTime(audioTime: number): number {
    return Math.max(0, Math.min(this.duration, audioTime - this.sourceStart));
  }

  /**
   * Convert absolute audio.currentTime to normalized progression [0, 1]
   */
  toNormalizedProgress(audioTime: number): number {
    if (this.duration <= 0) return 0;
    const rel = audioTime - this.sourceStart;
    return Math.max(0, Math.min(1, rel / this.duration));
  }

  /**
   * Check if current audio time has reached or exceeded excerpt end
   */
  isComplete(audioTime: number): boolean {
    return audioTime >= this.sourceEnd - 0.05;
  }

  /**
   * Check if audio time is currently within the active excerpt window
   */
  isWithinExcerpt(audioTime: number): boolean {
    return audioTime >= this.sourceStart && audioTime <= this.sourceEnd;
  }
}

export const musicExcerpt = new MusicExcerpt();
