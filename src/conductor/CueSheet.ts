/**
 * CueSheet: Authored cinematic cue events anchored to the real audio excerpt.
 * 3-Minute (180s) visual experience timeline:
 *
 *   0–30s   ARRIVAL    — Calm intro; buildings gently emerge
 *   30–60s  DISCOVERY  — More structures rise; environment develops
 *   60–100s DEVELOPMENT — Architecture grows taller; movement richer
 *   100–140s BUILD      — Coordinated visual build; expressive audio reactions
 *   140–165s CLIMAX_PREP/CLIMAX — Densest, tallest architecture; visual peak
 *   165–180s RELEASE   — Gradual beautiful release into calm ending
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
  relativeTime: number; // Seconds from excerpt start (0 to 180.0)
  absoluteTime: number; // Seconds in audio.currentTime (0 to 180.0)
  event: CinematicEventType;
  duration: number;     // Active duration for transition
  description: string;
}

export const CUE_SHEET: CinematicCue[] = [
  {
    id: 'cue-arrival',
    relativeTime: 0.0,
    absoluteTime: 0.0,
    event: 'ARRIVAL',
    duration: 30.0,
    description: 'Calm introduction. Buildings gently emerge from the ground. Deep midnight atmosphere.',
  },
  {
    id: 'cue-discovery',
    relativeTime: 30.0,
    absoluteTime: 30.0,
    event: 'DISCOVERY',
    duration: 30.0,
    description: 'First wave of structures rises as the music develops. Touch interaction available.',
  },
  {
    id: 'cue-development',
    relativeTime: 60.0,
    absoluteTime: 60.0,
    event: 'DEVELOPMENT',
    duration: 40.0,
    description: 'Architecture grows taller and movement becomes richer. Grab interaction available.',
  },
  {
    id: 'cue-build',
    relativeTime: 100.0,
    absoluteTime: 100.0,
    event: 'BUILD',
    duration: 40.0,
    description: 'Coordinated visual build with increasingly expressive audio reactions. Full 360° world active.',
  },
  {
    id: 'cue-climax-prep',
    relativeTime: 140.0,
    absoluteTime: 140.0,
    event: 'CLIMAX_PREP',
    duration: 10.0,
    description: 'Rapid harmonic tension. Gold accents intensify. Full architecture revealed.',
  },
  {
    id: 'cue-climax',
    relativeTime: 150.0,
    absoluteTime: 150.0,
    event: 'CLIMAX',
    duration: 15.0,
    description: 'Main visual climax. Densest, tallest architecture. Peak emotional and visual bloom.',
  },
  {
    id: 'cue-release',
    relativeTime: 165.0,
    absoluteTime: 165.0,
    event: 'RELEASE',
    duration: 15.0,
    description: 'Gradual beautiful release. Geometry softly dissolves into gentle mist.',
  },
  {
    id: 'cue-complete',
    relativeTime: 180.0,
    absoluteTime: 180.0,
    event: 'COMPLETE',
    duration: 1.0,
    description: 'The journey rests. Replay prompt appears gracefully.',
  },
];
