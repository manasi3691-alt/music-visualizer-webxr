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
    const { interpolatedColor, relativeTime } = frameData;

    // Phase 1 progression (0.0s to 55.0s):
    // 0-18s: Calm piano intro (soft minimal illumination ~0.35)
    // 18-36s: Vocals enter (warm architectural highlights ~0.65)
    // 36-55s: Full groove build (vibrant expansive illumination ~1.10)
    let phaseIntensity = 0.35;
    if (relativeTime >= 18.0 && relativeTime < 36.0) {
      const p = (relativeTime - 18.0) / 18.0;
      phaseIntensity = 0.35 + p * 0.30;
    } else if (relativeTime >= 36.0 && relativeTime < 55.0) {
      const p = (relativeTime - 36.0) / 19.0;
      phaseIntensity = 0.65 + p * 0.45;
    } else if (relativeTime >= 55.0) {
      // Transition dissolve
      const dissolveP = Math.min(1.0, (relativeTime - 55.0) / 10.0);
      phaseIntensity = Math.max(0.0, 1.10 * (1.0 - dissolveP));
    }

    const mid = metrics?.mid ?? 0;
    const high = metrics?.high ?? 0;
    const energy = metrics?.energy ?? 0;
    const beat = metrics?.beat ?? 0;

    // Musical dynamics: vocal & piano chords add warm light; beats give subtle punch
    const musicMod = 0.85 + mid * 0.25 + energy * 0.25 + beat * 0.15;

    this.scratchColor.setRGB(
      interpolatedColor.primaryAccent[0],
      interpolatedColor.primaryAccent[1],
      interpolatedColor.primaryAccent[2]
    );

    this.cityAccentLight.color.copy(this.scratchColor);
    this.cityAccentLight.intensity = phaseIntensity * musicMod;
  }

  reset(): void {
    this.cityAccentLight.intensity = 0.35;
  }

  dispose(): void {
    this.cityAccentLight.dispose?.();
    this.group.clear();
  }
}
