/**
 * LightingSystem: Procedural diffuse environmental lighting and warm accent highlights.
 * All Three.js objects imported from '@iwsdk/core'.
 * Zero allocations in update().
 */

import { AmbientLight, DirectionalLight, Group, Color } from '@iwsdk/core';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export class LightingSystem {
  readonly group: Group = new Group();

  private ambientLight: AmbientLight;
  private primaryLight: DirectionalLight;
  private warmAccentLight: DirectionalLight;

  // Pre-allocated Color scratch objects to avoid per-frame allocations
  private ambientColor = new Color();
  private primaryColor = new Color();
  private warmColor = new Color();

  constructor() {
    // Soft diffuse ambient light
    this.ambientLight = new AmbientLight(0x222a44, 0.6);
    this.group.add(this.ambientLight);

    // Primary directional light representing celestial/horizon glow
    this.primaryLight = new DirectionalLight(0xa0b0e0, 0.8);
    this.primaryLight.position.set(0, 5, -3);
    this.group.add(this.primaryLight);

    // Warm accent light providing soft rim highlights
    this.warmAccentLight = new DirectionalLight(0xffe2b8, 0.4);
    this.warmAccentLight.position.set(3, 2, 2);
    this.group.add(this.warmAccentLight);
  }

  update(frameData: ConductorFrameData, metrics: AudioMetrics): void {
    const { interpolatedColor } = frameData;

    // Level B phrase-level light colors
    this.ambientColor.setRGB(
      interpolatedColor.equator[0],
      interpolatedColor.equator[1],
      interpolatedColor.equator[2]
    );

    this.primaryColor.setRGB(
      interpolatedColor.primaryAccent[0],
      interpolatedColor.primaryAccent[1],
      interpolatedColor.primaryAccent[2]
    );

    this.warmColor.setRGB(
      interpolatedColor.warmAccent[0],
      interpolatedColor.warmAccent[1],
      interpolatedColor.warmAccent[2]
    );

    // Level C micro FFT subtle modulation (2-4% intensity change)
    const microPulse = 1.0 + (metrics.mid * 0.04 + metrics.high * 0.03);

    this.ambientLight.color.copy(this.ambientColor);
    this.ambientLight.intensity = (0.5 + interpolatedColor.intensity * 0.3) * microPulse;

    this.primaryLight.color.copy(this.primaryColor);
    this.primaryLight.intensity = (0.7 + interpolatedColor.intensity * 0.4) * microPulse;

    this.warmAccentLight.color.copy(this.warmColor);
    this.warmAccentLight.intensity = (0.3 + interpolatedColor.intensity * 0.3) * (1.0 + metrics.low * 0.05);
  }

  dispose(): void {
    this.ambientLight.dispose?.();
    this.primaryLight.dispose?.();
    this.warmAccentLight.dispose?.();
    this.group.clear();
  }
}
