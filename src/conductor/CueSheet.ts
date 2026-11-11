/**
 * CueSheet: Authored cinematic cue events anchored to the real 266.92s audio track.
 * Three-Phase Journey Timeline:
 *   Phase 1: Rising City (0s – 55s)
 *   Phase 2: Aurora, Crystal Lotus and Cosmic Ocean (55s – 165s, ~1m50s dedicated progression)
 *   Phase 3: Cosmic Ascent & Interactive Solar System (165s – 266.92s)
 */

export type CinematicEventType =
  | 'ARRIVAL'
  | 'DISCOVERY'
  | 'DEVELOPMENT'
  | 'BUILD'
  | 'CLIMAX_PREP'
  | 'CLIMAX'
  | 'RELEASE'
  | 'COMPLETE';

export interface CinematicCue {
  id: string;
  relativeTime: number; // Seconds from track start (0 to 266.92)
  absoluteTime: number; // Seconds in audio.currentTime (0 to 266.92)
  event: CinematicEventType;
  duration: number;     // Active duration for transition
  description: string;
}

export const CUE_SHEET: CinematicCue[] = [
  {
    id: 'cue-city-arrival',
    relativeTime: 0.0,
    absoluteTime: 0.0,
    event: 'ARRIVAL',
    duration: 18.0,
    description: 'Phase 1: Piano chord intro. City foundation and calm buildings gently emerge from the ground.',
  },
  {
    id: 'cue-city-discovery',
    relativeTime: 18.0,
    absoluteTime: 18.0,
    event: 'DISCOVERY',
    duration: 18.0,
    description: 'Phase 1: Vocals enter. Structures rise as the music develops; interactive block available.',
  },
  {
    id: 'cue-city-build',
    relativeTime: 36.0,
    absoluteTime: 36.0,
    event: 'DEVELOPMENT',
    duration: 19.0,
    description: 'Phase 1: Groove builds. Architecture reaches full heights and illumination before the transition.',
  },
  {
    id: 'cue-aurora-transition',
    relativeTime: 55.0,
    absoluteTime: 55.0,
    event: 'BUILD',
    duration: 10.0,
    description: 'Transition: City dissolves into thousands of luminous particles and flowing Icelandic aurora ribbons.',
  },
  {
    id: 'cue-crystal-lotus-ocean',
    relativeTime: 65.0,
    absoluteTime: 65.0,
    event: 'DISCOVERY',
    duration: 65.0,
    description: 'Phase 2: Living Cosmic Ocean of light, reflective water, translucent Crystal Lotus, and floating sound bubbles.',
  },
  {
    id: 'cue-ocean-climax-prep',
    relativeTime: 130.0,
    absoluteTime: 130.0,
    event: 'CLIMAX_PREP',
    duration: 35.0,
    description: 'Phase 2 Build: Dynamic harmonic tension. Ocean waves, glowing lotus veins, and aurora ribbons build in intensity.',
  },
  {
    id: 'cue-cosmic-ascent',
    relativeTime: 165.0,
    absoluteTime: 165.0,
    event: 'CLIMAX',
    duration: 10.0,
    description: 'Transition: Climax downbeat. Ocean currents rise upward into flowing light trails and disperse into stars.',
  },
  {
    id: 'cue-solar-system',
    relativeTime: 175.0,
    absoluteTime: 175.0,
    event: 'CLIMAX',
    duration: 75.0,
    description: 'Phase 3: Interactive Solar System emerges in deep cosmos with full hand grabbing and orbital interaction.',
  },
  {
    id: 'cue-release',
    relativeTime: 250.0,
    absoluteTime: 250.0,
    event: 'RELEASE',
    duration: 16.92,
    description: 'Outro: Music gently releases into serene piano chords. Planets settle in tranquil final orbits.',
  },
  {
    id: 'cue-complete',
    relativeTime: 266.92,
    absoluteTime: 266.92,
    event: 'COMPLETE',
    duration: 1.0,
    description: 'The journey rests. Replay prompt appears gracefully.',
  },
];
