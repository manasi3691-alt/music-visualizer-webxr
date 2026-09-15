/**
 * Custom ECS components for the EXPERIENCE project
 */

import { createComponent } from '@iwsdk/core';

export const ExperienceInteractive = createComponent('ExperienceInteractive', {
  interactionType: { type: 'String', default: 'touch' },
});
