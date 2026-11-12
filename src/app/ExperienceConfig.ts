/**
 * Central configuration for EXPERIENCE — Immersive WebXR Music Journey
 * Ludovico Einaudi - "Experience"
 */

export interface ColorStop {
  sky: [number, number, number];
  equator: [number, number, number];
  ground: [number, number, number];
  primaryAccent: [number, number, number];
  warmAccent: [number, number, number];
  intensity: number;
}

export const EXPERIENCE_CONFIG = {
  projectTitle: 'A SKY FULL OF STARS',
  composer: 'The Hit Crew Kids / Coldplay',
  audioPath: './audio/sky_full_of_stars.mp3',

  // Full continuous audio track journey (266.92s / ~4m 27s):
  // Phase 1 (Rising City): 0s – 55s
  // Phase 2 (Aurora, Lotus & Cosmic Ocean): 55s – 165s (~1m50s)
  // Phase 3 (Cosmic Ascent & Interactive Solar System): 165s – 266.92s
  excerpt: {
    sourceStart: 0.0,
    sourceEnd: 266.92,
    duration: 266.92,
  },

  // Cosmic color progression per musical movement
  // Palette: midnight blue · deep charcoal · muted teal · ivory · restrained gold
  colors: {
    arrival: {
      sky:           [0.04, 0.07, 0.15],   // Deep midnight blue — quieter than before
      equator:       [0.06, 0.11, 0.22],   // Indigo horizon
      ground:        [0.02, 0.04, 0.08],   // Near-black charcoal
      primaryAccent: [0.38, 0.52, 0.72],   // Dusty blue-ivory
      warmAccent:    [0.68, 0.62, 0.52],   // Muted warm ivory
      intensity: 0.55,
    } as ColorStop,

    discovery: {
      sky:           [0.07, 0.12, 0.24],   // Midnight indigo lightening
      equator:       [0.12, 0.22, 0.36],   // Deep teal-blue horizon
      ground:        [0.04, 0.07, 0.12],   // Dark charcoal
      primaryAccent: [0.40, 0.68, 0.72],   // Muted teal
      warmAccent:    [0.82, 0.74, 0.55],   // Muted gold-ivory
      intensity: 0.92,
    } as ColorStop,

    development: {
      sky:           [0.08, 0.14, 0.28],   // Rich midnight blue
      equator:       [0.15, 0.28, 0.40],   // Deep teal horizon
      ground:        [0.05, 0.08, 0.14],   // Charcoal
      primaryAccent: [0.35, 0.70, 0.68],   // Muted teal-green
      warmAccent:    [0.85, 0.78, 0.52],   // Soft gold
      intensity: 1.05,
    } as ColorStop,

    build: {
      sky:           [0.09, 0.16, 0.30],   // Deep navy blue
      equator:       [0.18, 0.32, 0.44],   // Teal-blue horizon brightening
      ground:        [0.06, 0.10, 0.16],   // Deep charcoal
      primaryAccent: [0.55, 0.78, 0.75],   // Bright muted teal
      warmAccent:    [0.90, 0.82, 0.55],   // Restrained warm gold
      intensity: 1.20,
    } as ColorStop,

    climax: {
      sky:           [0.12, 0.20, 0.38],   // Deep but luminous navy
      equator:       [0.22, 0.38, 0.52],   // Pale teal horizon
      ground:        [0.08, 0.12, 0.20],   // Dark charcoal-blue
      primaryAccent: [0.80, 0.88, 0.85],   // Near-white soft ivory
      warmAccent:    [0.95, 0.88, 0.62],   // Warm gold highlight
      intensity: 1.65,
    } as ColorStop,

    release: {
      sky:           [0.06, 0.10, 0.20],   // Returning to midnight
      equator:       [0.10, 0.18, 0.28],   // Quiet indigo
      ground:        [0.03, 0.05, 0.10],   // Near-black
      primaryAccent: [0.50, 0.62, 0.70],   // Cool blue-grey
      warmAccent:    [0.75, 0.70, 0.58],   // Warm parchment
      intensity: 0.82,
    } as ColorStop,
  },

  // Seated comfort & spatial bounds
  comfort: {
    seatedHeadHeight: 1.2,
    safeNearDistance: 0.4,
    safeFarDistance: 12.0,
    primaryInteractionRadius: 0.7, // within comfortable arm reach
    secondaryVisualRadius: 2.5,
  },

  // Interaction limits
  interaction: {
    maxGrabDistance: 1.2,
    minScaleFactor: 0.75,
    maxScaleFactor: 1.5,
    maxPullDisplacement: 0.45,
    hoverHighlightIntensity: 0.35,
  },

  // Performance limits
  quality: {
    quest: {
      maxParticles: 800,
      drawCallsBudget: 65,
      targetFPS: 72,
    },
    desktop: {
      maxParticles: 2000,
      drawCallsBudget: 120,
      targetFPS: 60,
    },
  },
};
