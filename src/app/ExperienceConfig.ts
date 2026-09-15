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
  projectTitle: 'EXPERIENCE',
  composer: 'Ludovico Einaudi',
  audioPath: './audio/experience.mp3',

  // Authored musical excerpt from the real recording (38.0s duration)
  // 240.0s (4:00) downbeat through 278.0s (4:38) sudden release and piano decay
  excerpt: {
    sourceStart: 240.0,
    sourceEnd: 278.0,
    duration: 38.0,
  },

  // Color progression per musical movement
  colors: {
    arrival: {
      sky: [0.12, 0.18, 0.32],
      equator: [0.22, 0.28, 0.44],
      ground: [0.08, 0.10, 0.18],
      primaryAccent: [0.65, 0.72, 0.95], // Pale blue / cool lavender
      warmAccent: [0.95, 0.88, 0.75],
      intensity: 0.8,
    } as ColorStop,

    discovery: {
      sky: [0.18, 0.22, 0.42],
      equator: [0.35, 0.35, 0.58],
      ground: [0.12, 0.14, 0.24],
      primaryAccent: [0.75, 0.68, 0.98], // Lavender & sky blue
      warmAccent: [1.0, 0.82, 0.65],
      intensity: 1.0,
    } as ColorStop,

    development: {
      sky: [0.25, 0.20, 0.48],
      equator: [0.45, 0.30, 0.65],
      ground: [0.15, 0.12, 0.28],
      primaryAccent: [0.85, 0.45, 0.82], // Violet & pink & turquoise
      warmAccent: [0.35, 0.85, 0.82],
      intensity: 1.2,
    } as ColorStop,

    build: {
      sky: [0.35, 0.22, 0.55],
      equator: [0.60, 0.35, 0.70],
      ground: [0.20, 0.15, 0.32],
      primaryAccent: [0.98, 0.55, 0.75], // Richer saturation, warm highlights
      warmAccent: [1.0, 0.78, 0.45],
      intensity: 1.5,
    } as ColorStop,

    climax: {
      sky: [0.55, 0.45, 0.75],
      equator: [0.85, 0.70, 0.90],
      ground: [0.35, 0.28, 0.45],
      primaryAccent: [1.0, 0.95, 0.90], // Bright warm white, soft gold, violet
      warmAccent: [1.0, 0.88, 0.50],
      intensity: 2.2,
    } as ColorStop,

    release: {
      sky: [0.20, 0.22, 0.38],
      equator: [0.40, 0.38, 0.52],
      ground: [0.12, 0.12, 0.20],
      primaryAccent: [0.88, 0.82, 0.92], // Soft lavender, pale peach, warm white
      warmAccent: [0.95, 0.80, 0.70],
      intensity: 0.9,
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
