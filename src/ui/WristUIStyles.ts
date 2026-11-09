/**
 * WristUIStyles: Visual styling constants, dimensions, palette, opacity,
 * and emissive intensity definitions for the Dual 3D Spatial Music Interface:
 *  1. FloatingMusicPlayer: Main 3D translucent glass music player
 *  2. WristControlPanel: Compact 3D wrist holographic panel
 */

export const FLOATING_PLAYER_DIMENSIONS = {
  radius: 0.115,               // 11.5 cm radius -> 23 cm total diameter
  depth: 0.007,                // 7 mm glass slab
  handleWidth: 0.11,           // Top grab handle width
  handleHeight: 0.016,         // Top grab handle height
  defaultDistance: 0.52,       // 52 cm in front of user (within 45–60 cm reach)
  defaultHeight: 0.98,         // Chest level, slightly below eye level (1.10–1.20m)
  defaultOffsetRight: 0.22,    // Offset to right by 22 cm to keep center lotus unblocked
  centerButtonRadius: 0.025,   // Large 5 cm center play/pause button
  radialButtonRadius: 0.018,   // 3.6 cm outer buttons
  smallButtonRadius: 0.014,    // Close button
  radialOrbitRadius: 0.068,    // Radial spacing
  progressRadius: 0.096,       // Progress ring radius
};

export const WRIST_UI_DIMENSIONS = {
  radius: 0.052,               // 5.2 cm radius -> 10.4 cm diameter compact panel
  depth: 0.004,
  wristOffset: 0.075,          // Offset from left wrist grip
  desktopDistance: 0.50,
  openDurationSec: 0.22,
  closeDurationSec: 0.18,
  minScale: 0.85,
  maxScale: 1.0,
  centerButtonRadius: 0.015,   // Center play/pause on wrist
  radialButtonRadius: 0.011,   // Compact outer buttons on wrist
  radialOrbitRadius: 0.035,
};

export const MUSIC_UI_PALETTE = {
  // 3D Three.js hex colors: cyan, teal, translucent glass & fine silver glowing details
  glassBase: 0x07111a,         // Midnight translucent glass base
  panelBase: 0x07111a,         // Compatibility alias
  glassTint: 0x0b1e2c,         // Deep navy-teal tint
  panelTint: 0x0b1e2c,         // Compatibility alias
  borderCyan: 0x00f2fe,        // Radiant cyan holographic edge
  borderEmissive: 0x00f2fe,    // Compatibility alias
  borderTeal: 0x1de9b6,        // Vibrant aquamarine/teal
  tealAccent: 0x1de9b6,        // Compatibility alias
  buttonBase: 0x122a3c,        // Compatibility alias
  silverAccent: 0xd0e6f5,      // Fine silver circuit rings & ticks
  goldAccent: 0xd4af37,        // Warm restrained gold accent
  playActive: 0x00e5ff,        // Luminous cyan play button
  playPaused: 0x0d3b56,        // Deep teal-navy play button
  loopActive: 0x00e676,        // Vivid neon emerald when loop enabled
  loopInactive: 0x1a3a4a,      // Charcoal-teal when loop disabled
  closeButton: 0x4a1820,       // Deep rose-charcoal
  ivoryText: 0xf5f0e8,         // Soft ivory text
  progressCyan: 0x00f2fe,      // Glowing cyan progress arc
  progressTrack: 0x122535,     // Track groove

  hex: {
    glassBase: 'rgba(7, 17, 26, 0.88)',
    glassGlassy: 'rgba(11, 30, 44, 0.75)',
    borderCyan: '#00f2fe',
    borderTeal: '#1de9b6',
    silverAccent: '#d0e6f5',
    goldAccent: '#d4af37',
    playActive: '#00e5ff',
    playInactive: '#0e3a5c',
    loopActive: '#00e676',
    loopInactive: '#8fa8b8',
    buttonBase: 'rgba(18, 42, 60, 0.82)',
    buttonBorder: 'rgba(0, 242, 254, 0.55)',
    ivoryText: '#f5f0e8',
    textMuted: '#94b4c8',
    progressTrack: 'rgba(255, 255, 255, 0.12)',
    handleBg: 'rgba(0, 242, 254, 0.18)',
    handleBorder: 'rgba(0, 242, 254, 0.65)',
  },
};

// Aliased backwards compatibility
export const WRIST_UI_PALETTE = MUSIC_UI_PALETTE;

export const WRIST_UI_OPACITY = {
  closed: 0.0,
  open: 0.94,
  climaxReduction: 0.10,
  climaxOpen: 0.84,
};

export const WRIST_UI_EMISSIVE = {
  borderIntensity: 0.65,
  buttonHoverIntensity: 0.55,
  buttonNormalIntensity: 0.22,
};
