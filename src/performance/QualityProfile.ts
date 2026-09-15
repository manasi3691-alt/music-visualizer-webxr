/**
 * QualityProfile: Budget definitions for Quest standalone vs Desktop WebXR
 */

export interface QualityBudget {
  name: 'quest' | 'desktop';
  targetFPS: number;
  maxParticles: number;
  tubeSegments: number;
  drawCallsBudget: number;
  useBloom: boolean;
}

export const QUALITY_QUEST: QualityBudget = {
  name: 'quest',
  targetFPS: 72,
  maxParticles: 800,
  tubeSegments: 48,
  drawCallsBudget: 65,
  useBloom: false,
};

export const QUALITY_DESKTOP: QualityBudget = {
  name: 'desktop',
  targetFPS: 60,
  maxParticles: 2000,
  tubeSegments: 64,
  drawCallsBudget: 120,
  useBloom: false,
};

export function detectQualityProfile(): QualityBudget {
  const isQuest = /Quest|OculusBrowser/i.test(navigator.userAgent);
  return isQuest ? QUALITY_QUEST : QUALITY_DESKTOP;
}
