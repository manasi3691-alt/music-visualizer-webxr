/**
 * Entry point for EXPERIENCE — Immersive WebXR Music Journey
 * Ludovico Einaudi - "Experience"
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ExperienceSystem } from './world/ExperienceSystem.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(ExperienceSystem);
  console.log('[EXPERIENCE] World initialized and ExperienceSystem registered');
}).catch((err) => {
  console.error('[EXPERIENCE] Failed to initialize world:', err);
});
