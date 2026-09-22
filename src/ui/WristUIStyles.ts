/**
 * WristUIStyles: Visual styling constants, geometry dimensions,
 * and harmonious color palettes for the procedural WebXR Wrist UI.
 *
 * Palette requirements:
 * Soft lavender, pale blue, warm white, subtle violet.
 * Phase-aware subtle lerp. No cyberpunk cyan/black.
 */

import { Color } from '@iwsdk/core';

export const WRIST_UI_DIMENSIONS = {
  // Panel dimensions (~0.09 x 0.13 m, < 1500 triangles)
  width: 0.092,
  height: 0.132,
  cornerRadius: 0.012,
  depth: 0.002,

  // Spatial interaction bounds
  activationHitboxDiameter: 0.12, // ~0.12 m activation trigger hitbox
  desktopDistance: 0.60,          // ~0.6 m in front of camera

  // Animation constants (180 - 250 ms range)
  transitionDurationSec: 0.22,    // 220 ms
  minScale: 0.92,
  maxScale: 1.0,
  closedOpacity: 0.0,
  openOpacity: 0.88,
};

export const WRIST_UI_PALETTE = {
  // Three.js colors
  softLavender: new Color(0xc4b5fd),
  paleBlue: new Color(0x93c5fd),
  warmWhite: new Color(0xfffbeb),
  subtleViolet: new Color(0xa78bfa),
  deepVioletBg: new Color(0x1a162b),
  borderEmissive: new Color(0xd8b4fe),

  // Canvas 2D styles
  css: {
    bgGradientTop: 'rgba(30, 26, 48, 0.92)',
    bgGradientBottom: 'rgba(22, 19, 36, 0.94)',
    panelBorder: 'rgba(216, 180, 254, 0.65)',
    softLavender: '#c4b5fd',
    paleBlue: '#93c5fd',
    warmWhite: '#fffbeb',
    subtleViolet: '#a78bfa',
    textMain: '#fdfbf7',
    textMuted: '#cbd5e1',
    buttonFill: 'rgba(196, 181, 253, 0.16)',
    buttonFillHover: 'rgba(147, 197, 253, 0.28)',
    buttonBorder: 'rgba(196, 181, 253, 0.45)',
    progressTrack: 'rgba(255, 255, 255, 0.14)',
    progressFill: '#c4b5fd',
    statusBadgeBg: 'rgba(167, 139, 250, 0.22)',
    closeButtonBg: 'rgba(255, 255, 255, 0.10)',
  },
};

export const WRIST_UI_MATERIALS = {
  roughness: 0.25,
  metalness: 0.12,
  emissiveIntensity: 0.4,
};
