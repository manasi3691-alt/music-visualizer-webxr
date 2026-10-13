/**
 * CityLighting: Atmospheric and architectural lighting for the evolving city.
 * Evolving color temperature and intensity anchored to MusicalConductor.
 * Strictly respects Meta Quest 3S performance budget (max 1 directional accent light).
 */

import { Group, DirectionalLight, PointLight, Color } from '@iwsdk/core';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export class CityLighting {
  readonly group: Group = new Group();

  // Subtle directional city rim light for architectural silhouette
  private cityAccentLight: DirectionalLight;

  // Scratch objects for zero per-frame allocations
  private scratchColor = new Color();

  constructor(isQuest = false) {
    // Soft overhead rim light angled gently across the city geometry
    this.cityAccentLight = new DirectionalLight(0x99aacc, 0.4);
    this.cityAccentLight.position.set(2, 6, -2);
    this.cityAccentLight.castShadow = false;
    this.group.add(this.cityAccentLight);
  }

  update(frameData: ConductorFrameData, metrics: AudioMetrics): void {
    const { interpolatedColor, normalizedProgress } = frameData;

    // 1. Phased base intensity:
    // CALM (0-0.10): soft minimal (0.3)
    // DISCOVERY (0.10-0.26): subtle highlights (0.45)
    // DEVELOPMENT (0.26-0.47): pathways illuminate (0.65)
    // BUILD (0.47-0.81): city glow grows (0.95)
    // CLIMAX (0.81-0.97): brilliant warm bloom (1.5)
    // RELEASE (0.97-1.0): soft peaceful glow (0.4)
    let phaseIntensity = 0.35;
    if (normalizedProgress >= 0.10 && normalizedProgress < 0.26) {
      phaseIntensity = 0.45;
    } else if (normalizedProgress >= 0.26 && normalizedProgress < 0.47) {
      phaseIntensity = 0.65;
    } else if (normalizedProgress >= 0.47 && normalizedProgress < 0.81) {
      phaseIntensity = 0.95;
    } else if (normalizedProgress >= 0.81 && normalizedProgress < 0.97) {
      phaseIntensity = 1.45;
    } else if (normalizedProgress >= 0.97) {
      phaseIntensity = 0.40;
    }

    // 2. Micro FFT pulse (subtle 2-4% shimmer)
    const microPulse = 1.0 + metrics.mid * 0.04 + metrics.high * 0.02;

    this.scratchColor.setRGB(
      interpolatedColor.primaryAccent[0],
      interpolatedColor.primaryAccent[1],
      interpolatedColor.primaryAccent[2]
    );

    this.cityAccentLight.color.copy(this.scratchColor);
    this.cityAccentLight.intensity = phaseIntensity * microPulse;
  }

  reset(): void {
    this.cityAccentLight.intensity = 0.35;
  }

  dispose(): void {
    this.cityAccentLight.dispose?.();
    this.group.clear();
  }
}
