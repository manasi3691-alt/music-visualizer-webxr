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
    // Soft diffuse ambient — deep midnight blue-teal
    this.ambientLight = new AmbientLight(0x0e1c2e, 0.55);
    this.group.add(this.ambientLight);

    // Primary directional: cool blue-white from above-front, representing starlight
    this.primaryLight = new DirectionalLight(0x8ab8cc, 0.65);
    this.primaryLight.position.set(0, 6, -4);
    this.group.add(this.primaryLight);

    // Warm accent: restrained gold from the side, replaces the harsh warm-white rim
    this.warmAccentLight = new DirectionalLight(0xc8a84a, 0.28);
    this.warmAccentLight.position.set(4, 2, 3);
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

    // Level C micro FFT subtle modulation (2-3% intensity change — restrained)
    const microPulse = 1.0 + (metrics.mid * 0.025 + metrics.high * 0.015);

    this.ambientLight.color.copy(this.ambientColor);
    // Cap ambient: max intensity 0.70 to avoid bright grey-wash at climax
    this.ambientLight.intensity = Math.min(0.70, (0.45 + interpolatedColor.intensity * 0.18) * microPulse);

    this.primaryLight.color.copy(this.primaryColor);
    // Cap primary: max 0.85, keep cool starlight quality
    this.primaryLight.intensity = Math.min(0.85, (0.55 + interpolatedColor.intensity * 0.22) * microPulse);

    // Warm gold accent driven by low-frequency energy — gentle breathing warmth
    this.warmAccentLight.color.copy(this.warmColor);
    this.warmAccentLight.intensity = Math.min(0.45, (0.20 + interpolatedColor.intensity * 0.14) * (1.0 + metrics.low * 0.06));
  }

  dispose(): void {
    this.ambientLight.dispose?.();
    this.primaryLight.dispose?.();
    this.warmAccentLight.dispose?.();
    this.group.clear();
  }
}
