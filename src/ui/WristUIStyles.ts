/**
 * WristUIStyles: Visual styling constants, dimensions, palette, opacity,
 * and emissive intensity definitions for the procedural Wrist UI.
 *
 * NOTE: As per Task 1 specification, no Three.js imports are included.
 */

export const WRIST_UI_DIMENSIONS = {
  // Panel dimensions (~0.09 m wide x 0.13 m tall x 0.005 m deep)
  width: 0.09,
  height: 0.13,
  depth: 0.005,
  cornerRadius: 0.012,

  // Spatial placement and hitboxes
  wristOffset: 0.10,             // ~0.08–0.18 m offset from grip
  activationHitboxSize: 0.12,    // ~0.12 m square activation hitbox
  desktopDistance: 0.60,         // ~0.6 m reading distance from camera

  // Animation scaling and timings
  openDurationSec: 0.22,         // 180–250 ms range
  closeDurationSec: 0.18,        // 150–220 ms range
  minScale: 0.92,
  maxScale: 1.0,
};

export const WRIST_UI_PALETTE = {
  // Hex numbers
  softLavender: 0xc4b5fd,
  paleBlue: 0x93c5fd,
  warmWhite: 0xfffbeb,
  subtleViolet: 0xa78bfa,
  deepBackground: 0x161224,
  borderEmissive: 0xd8b4fe,

  // CSS color strings for 2D canvas drawing / desktop UI
  hex: {
    softLavender: '#c4b5fd',
    paleBlue: '#93c5fd',
    warmWhite: '#fffbeb',
    subtleViolet: '#a78bfa',
    deepBackground: '#161224',
    borderEmissive: '#d8b4fe',
    textMain: '#fdfbf7',
    textMuted: '#cbd5e1',
    buttonBg: 'rgba(196, 181, 253, 0.16)',
    buttonBgHover: 'rgba(147, 197, 253, 0.30)',
    buttonBorder: 'rgba(196, 181, 253, 0.45)',
    progressTrack: 'rgba(255, 255, 255, 0.15)',
    progressFill: '#c4b5fd',
  },
};

export const WRIST_UI_OPACITY = {
  closed: 0.0,
  open: 0.88,
  climaxReduction: 0.20, // Reduced by ~20% during CLIMAX phase to stay subordinate
  climaxOpen: 0.70,
};

export const WRIST_UI_EMISSIVE = {
  borderIntensity: 0.40,
  buttonHoverIntensity: 0.25,
  buttonNormalIntensity: 0.10,
};
