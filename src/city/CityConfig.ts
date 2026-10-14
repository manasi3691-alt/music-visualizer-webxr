/**
 * CityConfig: Constants, authored spatial zones, building archetypes,
 * and visual parameters for the procedural music-built organic city.
 */

import { Vector3 } from '@iwsdk/core';

export type TransformOwnership = 'TimelineOwned' | 'UserOwned' | 'Animating' | 'Locked';

export type BuildingType =
  | 'TYPE_A' // Small Building: 1-2 floors, simple geometry, soft illumination
  | 'TYPE_B' // Medium Building: 3-5 floors, architectural details, windows/light strips
  | 'TYPE_C' // Tall Tower: taller structure, curved or tapered form, subtle glowing accents
  | 'TYPE_D' // Organic Building: curved structure, translucent surfaces, artistic appearance
  | 'TYPE_E'; // Connector: bridge, arch, elevated pathway

export type CityZoneName =
  | 'FRONT'
  | 'FRONT_LEFT'
  | 'LEFT'
  | 'BACK_LEFT'
  | 'BACK'
  | 'BACK_RIGHT'
  | 'RIGHT'
  | 'FRONT_RIGHT'
  | 'UPPER_FIELD'
  | 'LOWER_FIELD';

export interface CityZoneDefinition {
  name: CityZoneName;
  center: Vector3;
  azimuthDeg: number; // Angle around seated user (0 = front, 90 = right, etc.)
  distance: number;   // Radial distance from user origin (0, 1.2, 0)
  elevation: number;  // Base Y height
  description: string;
}

export const SEATED_USER_ORIGIN = new Vector3(0, 1.2, 0);

// Interaction reach thresholds for seated VR comfort (Section 3)
export const CITY_INTERACTION_DISTANCES = {
  directTouchMin: 0.4,
  directTouchMax: 0.9,
  grabPlacementMin: 0.6,
  grabPlacementMax: 1.5,
  secondaryElementMin: 1.5,
  secondaryElementMax: 4.0,
  distantBackdropMin: 4.0,
  distantBackdropMax: 20.0,
};

// Authored spatial zones — spread across the full 360° at generous distances
// Ranges: near interactive (1–2m), mid-world (3–6m), distant backdrop (8–14m)
export const CITY_ZONES: Record<CityZoneName, CityZoneDefinition> = {
  FRONT: {
    name: 'FRONT',
    center: new Vector3(0, 0.75, -2.2),
    azimuthDeg: 0,
    distance: 2.2,
    elevation: 0.75,
    description: 'Central plaza & core haven in front of seated user',
  },
  FRONT_RIGHT: {
    name: 'FRONT_RIGHT',
    center: new Vector3(1.6, 0.8, -1.9),
    azimuthDeg: 40,
    distance: 2.5,
    elevation: 0.8,
    description: 'Primary interactive construction terrace & sunrise sanctuary',
  },
  FRONT_LEFT: {
    name: 'FRONT_LEFT',
    center: new Vector3(-1.6, 0.8, -1.9),
    azimuthDeg: -40,
    distance: 2.5,
    elevation: 0.8,
    description: 'Secondary interactive construction zone & celestial towers',
  },
  RIGHT: {
    name: 'RIGHT',
    center: new Vector3(4.5, 0.9, 0.0),
    azimuthDeg: 90,
    distance: 4.5,
    elevation: 0.9,
    description: 'Harmonic promenade & crystalline architectural tier',
  },
  LEFT: {
    name: 'LEFT',
    center: new Vector3(-4.5, 0.9, 0.0),
    azimuthDeg: -90,
    distance: 4.5,
    elevation: 0.9,
    description: 'Whispering terraces & curved organic spires',
  },
  BACK_RIGHT: {
    name: 'BACK_RIGHT',
    center: new Vector3(5.0, 1.0, 4.0),
    azimuthDeg: 135,
    distance: 6.4,
    elevation: 1.0,
    description: 'Elevated bridges and luminous transit arcs',
  },
  BACK_LEFT: {
    name: 'BACK_LEFT',
    center: new Vector3(-5.0, 1.0, 4.0),
    azimuthDeg: -135,
    distance: 6.4,
    elevation: 1.0,
    description: 'Soft cascading water-platforms and terrace gardens',
  },
  BACK: {
    name: 'BACK',
    center: new Vector3(0, 1.2, 8.0),
    azimuthDeg: 180,
    distance: 8.0,
    elevation: 1.2,
    description: 'Monumental horizon towers — visible far above the seated viewer',
  },
  UPPER_FIELD: {
    name: 'UPPER_FIELD',
    center: new Vector3(0, 5.5, -3.5),
    azimuthDeg: 0,
    distance: 6.5,
    elevation: 5.5,
    description: 'Celestial sky arches — floating high above in the deep distance',
  },
  LOWER_FIELD: {
    name: 'LOWER_FIELD',
    center: new Vector3(0, 0.05, -2.5),
    azimuthDeg: 0,
    distance: 2.5,
    elevation: 0.05,
    description: 'Foundational glowing pathways and tranquil base ground',
  },
};

// Construction animation duration: 0.8 - 1.5 seconds (Section 11)
export const CONSTRUCTION_ANIMATION_DURATION = 1.2;

// Auto-complete window in seconds (Section 14)
export const CONSTRUCTION_AUTO_COMPLETE_DELAY = 12.0;

// Cosmic styling palette — midnight blue, muted teal, restrained gold
export const CITY_PALETTE = {
  foundation:       0x1a2840,   // Deep navy-charcoal foundation
  translucentGlass: 0x2a5870,   // Deep ocean teal glass
  windowGlow:       0xc8a84a,   // Restrained warm gold (window glow)
  windowViolet:     0x3a8899,   // Muted teal (replaces violet)
  windowTurquoise:  0x45aabb,   // Bright muted teal
  goldAccent:       0xb89040,   // Restrained gold
  pathwayGlow:      0x3a7888,   // Muted teal path glow
  borderGlow:       0x4a8898,   // Cool teal border
  previewValid:     0x50c8a0,   // Muted emerald
  previewInvalid:   0xc05060,   // Muted rose
};
