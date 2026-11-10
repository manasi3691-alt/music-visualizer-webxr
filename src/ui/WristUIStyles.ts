/**
 * WristUIStyles: Visual styling constants, sculptural geometry dimensions,
 * and cosmic cyan/teal/silver palette for the single 3D Holographic Music Interface.
 */

export const HOLOGRAPHIC_UI_DIMENSIONS = {
  width: 0.34,                 // 34 cm sculpted curved glass canopy span
  height: 0.21,                // 21 cm height
  thickness: 0.006,            // 6 mm solid beveled glass thickness
  curveRadius: 0.54,           // Concave ergonomic cockpit curvature radius
  defaultDistance: 0.50,       // 50 cm in front of seated user (within 45-60 cm reach)
  defaultHeight: 0.94,         // Chest level, comfortably below eye level (1.20m)
  defaultOffsetRight: 0.25,    // Offset right by 25 cm so center lotus stays 100% unobstructed
  desktopOffsetX: 0.23,        // Desktop lower-right framing (clear of center lotus)
  desktopOffsetY: -0.09,
  desktopDistance: 0.52,
  centerButtonRadius: 0.032,   // 6.4 cm hero Play/Pause crystal core
  radialButtonRadius: 0.023,   // 4.6 cm mid radial controls
  wingButtonRadius: 0.021,     // 4.2 cm wing controls
  handleWidth: 0.092,          // Bottom drag handle width
  handleHeight: 0.015,         // Bottom drag handle height
};

export const MUSIC_UI_PALETTE = {
  // Translucent cosmic glass & fine metallic silver
  glassTint: 0x0b3a52,         // Sheer icy cyan-teal crystal tint
  innerGlassTint: 0x104c68,    // Mid floating glass bridge tint
  borderCyan: 0x00f2fe,        // Electric cyan glowing edge
  borderTeal: 0x1de9b6,        // Luminous aquamarine-teal accent
  silverMetallic: 0xd8ecff,    // Brushed metallic silver rails & collars
  silverWarm: 0xe6f2ff,        // Specular silver highlight
  goldMicro: 0xd4af37,         // Subtle restrained star-gold node glint
  playActive: 0x00f2fe,        // Radiant cyan when playing
  playPaused: 0x2a7a9e,        // Calm crystal teal when paused
  hoverGlow: 0x7df9ff,         // Luminous hover halo
  closeAccent: 0xff7597,       // Subtle rose-coral highlight for close
  ivoryText: 0xf4f9ff,         // Crisp starlight-white readout

  hex: {
    borderCyan: '#00f2fe',
    borderTeal: '#1de9b6',
    silverAccent: '#d8ecff',
    hoverGlow: '#7df9ff',
    ivoryText: '#f4f9ff',
    textMuted: '#a2cbe0',
    closeAccent: '#ff7597',
  },
};

// Backwards-compatible exports for any external references
export const FLOATING_PLAYER_DIMENSIONS = HOLOGRAPHIC_UI_DIMENSIONS;
