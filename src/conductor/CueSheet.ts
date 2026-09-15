/**
 * CueSheet: Authored cinematic cue events anchored to the real audio excerpt
 * Audio excerpt: 240.0s - 278.0s (38.0s duration)
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
  relativeTime: number; // Seconds from excerpt start (0 to 38.0)
  absoluteTime: number; // Seconds in audio.currentTime (240.0 to 278.0)
  event: CinematicEventType;
  duration: number;     // Active duration for transition
  description: string;
}

export const CUE_SHEET: CinematicCue[] = [
  {
    id: 'cue-arrival',
    relativeTime: 0.0,
    absoluteTime: 240.0,
    event: 'ARRIVAL',
    duration: 4.0,
    description: 'Calm initial state. Pale blue and cool lavender atmosphere. Gentle environmental presence.',
  },
  {
    id: 'cue-discovery',
    relativeTime: 4.0,
    absoluteTime: 244.0,
    event: 'DISCOVERY',
    duration: 6.0,
    description: 'First organic luminous ribbon emerges in front of user. Touch/poke interaction becomes available.',
  },
  {
    id: 'cue-development',
    relativeTime: 10.0,
    absoluteTime: 250.0,
    event: 'DEVELOPMENT',
    duration: 8.0,
    description: 'Secondary architectural arcs unfold. Color evolves to violet & turquoise. Grab interaction becomes available.',
  },
  {
    id: 'cue-build',
    relativeTime: 18.0,
    absoluteTime: 258.0,
    event: 'BUILD',
    duration: 10.0,
    description: 'Luminous particle flow ascends. Energy swells across the world. Pull and scale interactions become available.',
  },
  {
    id: 'cue-climax-prep',
    relativeTime: 28.0,
    absoluteTime: 268.0,
    event: 'CLIMAX_PREP',
    duration: 3.0,
    description: 'Rapid harmonic tension. Gold accents intensify. Geometries expand and breathe deeply.',
  },
  {
    id: 'cue-climax',
    relativeTime: 31.0,
    absoluteTime: 271.0,
    event: 'CLIMAX',
    duration: 6.0,
    description: 'Emotional peak of the piece. Brilliant warm white, gold, and violet. Full visual bloom and expansive resonant waves.',
  },
  {
    id: 'cue-release',
    relativeTime: 37.0,
    absoluteTime: 277.0,
    event: 'RELEASE',
    duration: 1.0,
    description: 'Sudden audio decrescendo! Geometry softly dissolves into gentle mist. Soft lavender, pale peach, warm white.',
  },
  {
    id: 'cue-complete',
    relativeTime: 38.0,
    absoluteTime: 278.0,
    event: 'COMPLETE',
    duration: 0.5,
    description: 'The journey rests. Replay prompt appears gracefully. World remains peaceful and stable.',
  },
];
