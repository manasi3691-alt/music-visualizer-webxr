/**
 * WristUIStyles: Visual styling constants, dimensions, palette, opacity,
 * and emissive intensity definitions for the procedural circular radial Wrist UI.
 *
 * Cosmic palette: midnight blue, deep charcoal, muted teal, ivory, soft gold.
 */

export const WRIST_UI_DIMENSIONS = {
  // Radial menu dimensions — circular panel ~0.13 m diameter, 0.005 m deep
  radius: 0.065,            // 6.5 cm radius → 13 cm total diameter
  depth: 0.005,
  cornerRadius: 0.065,      // Full-round (equals radius for circular look)

  // Spatial placement and hitboxes
  wristOffset: 0.08,             // ~0.08 m offset from grip space origin (inner wrist)
  activationHitboxSize: 0.12,    // 12 cm activation zone
  desktopDistance: 0.55,         // Reading distance from camera in desktop mode

  // Animation scaling and timings
  openDurationSec: 0.22,         // 180–250 ms
  closeDurationSec: 0.18,        // 150–220 ms
  minScale: 0.88,
  maxScale: 1.0,

  // Button radii (world-space, for circular layout on the panel face)
  centerButtonRadius: 0.018,    // Central play/pause
  radialButtonRadius: 0.014,    // Outer ring buttons
  radialOrbitRadius: 0.045,     // Distance from panel center to radial buttons
};

export const WRIST_UI_PALETTE = {
  // Three.js hex numbers — cosmic / dark theme
  panelBase: 0x0d1520,          // Midnight blue-black
  panelTint: 0x112233,          // Deep navy
  borderEmissive: 0x3d8faa,     // Muted teal glow
  buttonBase: 0x1a3a4a,         // Deep charcoal-teal
  playButton: 0x0e3a5c,         // Ocean navy for center play/pause
  playActive: 0x1a5a3c,         // Deep emerald when playing
  closeButton: 0x3a1a1a,        // Deep rose-charcoal
  goldAccent: 0xb8962a,         // Restrained gold
  tealAccent: 0x1a8a8a,         // Muted teal
  ivoryText: 0xf5f0e8,          // Soft ivory
  progressFill: 0x2a7a6a,       // Muted teal for progress

  hex: {
    panelBase: '#0d1520',
    borderEmissive: '#3d8faa',
    playActive: '#1a5a3c',
    playInactive: '#0e3a5c',
    buttonBase: '#1a3a4a',
    goldAccent: '#b8962a',
    tealAccent: '#1a8a8a',
    ivoryText: '#f5f0e8',
    textMuted: '#8fa8b8',
    progressFill: '#2a7a6a',
    progressTrack: 'rgba(255,255,255,0.10)',
    warmWhite: '#f5f0e8',
    buttonBorder: 'rgba(61,143,170,0.50)',
    buttonBg: 'rgba(26,58,74,0.70)',
    softLavender: '#4a7a9a',
    deepBackground: '#0d1520',
  },
};

export const WRIST_UI_OPACITY = {
  closed: 0.0,
  open: 0.92,
  climaxReduction: 0.15,
  climaxOpen: 0.78,
};

export const WRIST_UI_EMISSIVE = {
  borderIntensity: 0.55,
  buttonHoverIntensity: 0.40,
  buttonNormalIntensity: 0.18,
};
