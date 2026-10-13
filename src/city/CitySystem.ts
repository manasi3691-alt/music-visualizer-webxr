/**
 * CitySystem: Master coordinator for the music-built evolving organic city.
 * Drives procedural districts, construction zones, interactive blocks,
 * and cinematic progression strictly synchronized with MusicalConductor.
 */

import { Group, Vector3 } from '@iwsdk/core';
import { CITY_ZONES, CITY_PALETTE } from './CityConfig.js';
import { CityBlock } from './CityBlock.js';
import { CityBuilding } from './CityBuilding.js';
import { CityDistrict, DistrictConfig } from './CityDistrict.js';
import { ConstructionZone } from './CityConstruction.js';
import { CityInteraction } from './CityInteraction.js';
import { CityLighting } from './CityLighting.js';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';
import { CinematicEventType } from '../conductor/CueSheet.js';

export class CitySystem {
  readonly group: Group = new Group();

  // Subsystems
  readonly interaction: CityInteraction = new CityInteraction();
  readonly lighting: CityLighting;

  // Districts
  private districts: CityDistrict[] = [];

  // Construction zones
  private constructionZone1: ConstructionZone;
  private constructionZone2: ConstructionZone;

  // Interactive building blocks
  private grabbableBlock1: CityBlock;
  private grabbableBlock2: CityBlock;

  // Initial calm foundation blocks
  private calmBlocks: CityBlock[] = [];

  // User-created placed buildings
  private userBuildings: CityBuilding[] = [];

  // Phase transition state tracking
  private currentEvent: CinematicEventType = 'ARRIVAL';
  private hasActivatedDiscovery = false;
  private hasActivatedDevelopment = false;
  private hasActivatedBuild = false;
  private hasActivatedClimax = false;

  constructor(isQuest = false) {
    this.lighting = new CityLighting(isQuest);
    this.group.add(this.lighting.group);

    // 1. Initial Calm Foundation: Minimal peaceful platform and blocks (Section 6 - CALM)
    this.setupCalmFoundations();

    // 2. Interactive Building Blocks (Sections 7, 8, 9, 16)
    // Block 1: Type B Medium architectural block placed on front-right podium
    this.grabbableBlock1 = new CityBlock({
      id: 'city-block-alpha',
      width: 0.28,
      height: 0.22,
      depth: 0.28,
      isInteractive: true,
      color: 0x9fbaff,
      emissive: 0x22386a,
      opacity: 0.85,
      position: new Vector3(0.42, 0.95, -0.85), // Seated comfortable arm reach ~0.95m
    });
    this.group.add(this.grabbableBlock1.group);
    this.interaction.registerBlock(this.grabbableBlock1);

    // Block 2: Type D Organic architectural block placed on front-left podium (for Development phase)
    this.grabbableBlock2 = new CityBlock({
      id: 'city-block-beta',
      width: 0.26,
      height: 0.24,
      depth: 0.26,
      isInteractive: true,
      color: 0xb599ea,
      emissive: 0x332066,
      opacity: 0.85,
      position: new Vector3(-0.42, 0.95, -0.85),
    });
    this.grabbableBlock2.setVisibility(false);
    this.group.add(this.grabbableBlock2.group);
    this.interaction.registerBlock(this.grabbableBlock2);

    // 3. Authored Construction Zones (Sections 7, 8, 10)
    // Zone 1: Front-Right interactive terrace
    this.constructionZone1 = new ConstructionZone({
      id: 'zone-front-right',
      position: new Vector3(0.68, 0.85, -1.05), // ~1.3m radial distance, seated reach
      defaultBuildingType: 'TYPE_B',
      radius: 0.36,
      label: 'Terrace Haven',
    });
    this.group.add(this.constructionZone1.group);
    this.interaction.registerZone(this.constructionZone1);

    // Zone 2: Front-Left interactive terrace
    this.constructionZone2 = new ConstructionZone({
      id: 'zone-front-left',
      position: new Vector3(-0.68, 0.85, -1.05),
      defaultBuildingType: 'TYPE_D',
      radius: 0.36,
      label: 'Crystal Arc',
    });
    this.group.add(this.constructionZone2.group);
    this.interaction.registerZone(this.constructionZone2);

    // 4. Wire Interaction Delegate
    this.interaction.setDelegate({
      onBuildingConstructed: (building, zone) => {
        this.group.add(building.group);
        this.userBuildings.push(building);
        console.log(`[CitySystem] User placed building in ${zone.id}`);
      },
      onPlacementRipple: (pos) => {
        // Can emit gentle wave ripple through ExperienceWorld if available
      },
    });

    // 5. Authored Spatial Districts (Section 3 & Section 6)
    this.setupDistricts();
  }

  /**
   * Builds the minimal peaceful foundation blocks for CALM phase (0 - 4s)
   */
  private setupCalmFoundations(): void {
    // Central primary foundation slab
    const centerSlab = new CityBlock({
      id: 'calm-center-slab',
      width: 1.1,
      height: 0.08,
      depth: 0.9,
      isInteractive: false,
      color: 0x3a4870,
      emissive: 0x141e38,
      opacity: 0.8,
      position: new Vector3(0, 0.65, -1.2),
    });
    this.group.add(centerSlab.group);
    this.calmBlocks.push(centerSlab);

    // 2 small accent blocks flanking the center
    const accent1 = new CityBlock({
      id: 'calm-accent-1',
      width: 0.22,
      height: 0.16,
      depth: 0.22,
      isInteractive: false,
      color: 0x6e88d0,
      emissive: 0x1a2850,
      opacity: 0.75,
      position: new Vector3(-0.35, 0.77, -1.25),
    });
    this.group.add(accent1.group);
    this.calmBlocks.push(accent1);

    const accent2 = new CityBlock({
      id: 'calm-accent-2',
      width: 0.22,
      height: 0.16,
      depth: 0.22,
      isInteractive: false,
      color: 0x6e88d0,
      emissive: 0x1a2850,
      opacity: 0.75,
      position: new Vector3(0.35, 0.77, -1.25),
    });
    this.group.add(accent2.group);
    this.calmBlocks.push(accent2);
  }

  /**
   * Configures all 360-degree procedural districts around seated user
   */
  private setupDistricts(): void {
    const districtConfigs: DistrictConfig[] = [
      // 1. FRONT: Core Haven (Discovery)
      {
        id: 'dist-front',
        name: 'Core Haven',
        zone: 'FRONT',
        activationPhase: 'DISCOVERY',
        hasPlatform: true,
        platformRadius: 0.95,
        buildings: [
          { type: 'TYPE_A', relPos: [0, 0.0, -0.15], scale: 1.0, color: 0x8aa8e8 },
          { type: 'TYPE_A', relPos: [-0.42, 0.0, 0.15], scale: 0.85, color: 0x9dbbf5 },
        ],
        connections: [
          { from: [-0.42, 0, 0.15], to: [0, 0, -0.15], width: 0.12 },
        ],
      },

      // 2. FRONT_RIGHT: Sunrise Terrace (Discovery -> Development)
      {
        id: 'dist-front-right',
        name: 'Sunrise Terrace',
        zone: 'FRONT_RIGHT',
        activationPhase: 'DEVELOPMENT',
        hasPlatform: true,
        platformRadius: 1.1,
        buildings: [
          { type: 'TYPE_B', relPos: [0.15, 0.0, -0.2], scale: 1.05, color: 0x9080e0 },
          { type: 'TYPE_A', relPos: [-0.35, 0.0, 0.2], scale: 0.9, color: 0x70d8d0 },
          { type: 'TYPE_E', relPos: [0.4, 0.0, 0.3], rotY: Math.PI * 0.25, scale: 0.9 },
        ],
        connections: [
          { from: [-0.35, 0, 0.2], to: [0.15, 0, -0.2], width: 0.14 },
          { from: [0.15, 0, -0.2], to: [0.4, 0, 0.3], width: 0.12 },
        ],
      },

      // 3. FRONT_LEFT: Celestial Quarter (Development)
      {
        id: 'dist-front-left',
        name: 'Celestial Quarter',
        zone: 'FRONT_LEFT',
        activationPhase: 'DEVELOPMENT',
        hasPlatform: true,
        platformRadius: 1.1,
        buildings: [
          { type: 'TYPE_C', relPos: [-0.15, 0.0, -0.25], scale: 1.0, color: 0x9560d8 },
          { type: 'TYPE_D', relPos: [0.35, 0.0, 0.15], scale: 0.95, color: 0x75d5e5 },
        ],
        connections: [
          { from: [-0.15, 0, -0.25], to: [0.35, 0, 0.15], width: 0.14 },
        ],
      },

      // 4. RIGHT: Harmonic Promenade (Build)
      {
        id: 'dist-right',
        name: 'Harmonic Promenade',
        zone: 'RIGHT',
        activationPhase: 'BUILD',
        hasPlatform: true,
        platformRadius: 1.35,
        buildings: [
          { type: 'TYPE_C', relPos: [0.2, 0.0, -0.4], scale: 1.2, color: 0xaa70e5 },
          { type: 'TYPE_B', relPos: [-0.3, 0.0, 0.3], scale: 1.1, color: 0xda85b5 },
          { type: 'TYPE_E', relPos: [0.0, 0.0, 0.0], rotY: Math.PI * 0.5, scale: 1.0 },
        ],
        connections: [
          { from: [-0.3, 0, 0.3], to: [0.2, 0, -0.4], width: 0.16 },
        ],
      },

      // 5. LEFT: Whisper Sanctuary (Build)
      {
        id: 'dist-left',
        name: 'Whisper Sanctuary',
        zone: 'LEFT',
        activationPhase: 'BUILD',
        hasPlatform: true,
        platformRadius: 1.35,
        buildings: [
          { type: 'TYPE_D', relPos: [-0.2, 0.0, -0.35], scale: 1.15, color: 0x62cce0 },
          { type: 'TYPE_B', relPos: [0.3, 0.0, 0.35], scale: 1.05, color: 0x9a75dd },
          { type: 'TYPE_A', relPos: [-0.35, 0.0, 0.4], scale: 0.95, color: 0x82b4ff },
        ],
        connections: [
          { from: [-0.35, 0, 0.4], to: [0.3, 0, 0.35], width: 0.14 },
        ],
      },

      // 6. BACK_RIGHT: Starlight Viaduct (Build)
      {
        id: 'dist-back-right',
        name: 'Starlight Viaduct',
        zone: 'BACK_RIGHT',
        activationPhase: 'BUILD',
        hasPlatform: true,
        platformRadius: 1.4,
        buildings: [
          { type: 'TYPE_C', relPos: [0.3, 0.0, 0.2], scale: 1.3, color: 0xc882e0 },
          { type: 'TYPE_E', relPos: [-0.2, 0.0, -0.3], rotY: Math.PI * 0.35, scale: 1.1 },
        ],
      },

      // 7. BACK_LEFT: Horizon Cascades (Build)
      {
        id: 'dist-back-left',
        name: 'Horizon Cascades',
        zone: 'BACK_LEFT',
        activationPhase: 'BUILD',
        hasPlatform: true,
        platformRadius: 1.4,
        buildings: [
          { type: 'TYPE_D', relPos: [-0.2, 0.0, 0.2], scale: 1.25, color: 0x58bce8 },
          { type: 'TYPE_B', relPos: [0.3, 0.0, -0.2], scale: 1.1, color: 0x9070d8 },
        ],
      },

      // 8. BACK: Monumental Horizon Towers (Climax)
      {
        id: 'dist-back',
        name: 'Monumental Horizon',
        zone: 'BACK',
        activationPhase: 'CLIMAX',
        hasPlatform: true,
        platformRadius: 1.8,
        buildings: [
          { type: 'TYPE_C', relPos: [0.0, 0.0, 0.0], scale: 1.8, color: 0xffd080 }, // Grand Spire
          { type: 'TYPE_C', relPos: [-0.85, 0.0, -0.3], scale: 1.45, color: 0xcca0ff },
          { type: 'TYPE_C', relPos: [0.85, 0.0, -0.3], scale: 1.45, color: 0xcca0ff },
        ],
      },

      // 9. UPPER_FIELD: Celestial Canopy Arches (Climax)
      {
        id: 'dist-upper',
        name: 'Celestial Canopy',
        zone: 'UPPER_FIELD',
        activationPhase: 'CLIMAX',
        hasPlatform: false,
        buildings: [
          { type: 'TYPE_E', relPos: [-1.2, 0.0, 0.0], rotY: 0.2, scale: 1.8, color: 0xffe2a0 },
          { type: 'TYPE_E', relPos: [1.2, 0.0, 0.0], rotY: -0.2, scale: 1.8, color: 0xffe2a0 },
        ],
      },
    ];

    districtConfigs.forEach((cfg) => {
      const dist = new CityDistrict(cfg);
      this.group.add(dist.group);
      this.districts.push(dist);
    });
  }

  /**
   * Main per-frame update driving city growth, lighting, and interaction.
   * Strictly synchronized with MusicalConductor. Zero per-frame allocations.
   */
  update(
    frameData: ConductorFrameData,
    metrics: AudioMetrics,
    deltaSec: number
  ): void {
    const { activeCue, relativeTime, normalizedProgress, interpolatedColor } = frameData;
    this.currentEvent = activeCue.event;

    // 1. Phased cinematic progression & district activation
    this.updatePhasedProgression(activeCue.event, relativeTime);

    // 2. Update all districts
    for (let i = 0; i < this.districts.length; i++) {
      this.districts[i].update(frameData, metrics, deltaSec);
    }

    // 3. Update user-created buildings
    for (let i = 0; i < this.userBuildings.length; i++) {
      this.userBuildings[i].update(frameData, metrics, deltaSec);
    }

    // 4. Update calm foundation blocks
    for (let i = 0; i < this.calmBlocks.length; i++) {
      this.calmBlocks[i].update(deltaSec, interpolatedColor.primaryAccent);
    }

    // 5. Update interaction & construction zones
    this.interaction.update(deltaSec, relativeTime);

    // 6. Update city lighting
    this.lighting.update(frameData, metrics);
  }

  /**
   * Handles phased city emergence strictly mapped to conductor cues
   */
  private updatePhasedProgression(event: CinematicEventType, relativeTime: number): void {
    switch (event) {
      case 'ARRIVAL': {
        // CALM: Only calm foundation blocks and 1 grabbable block available
        this.constructionZone1.setAvailable(false);
        this.constructionZone2.setAvailable(false);
        break;
      }

      case 'DISCOVERY': {
        // DISCOVERY (4s+): First buildings emerge; Zone 1 becomes available
        if (!this.hasActivatedDiscovery) {
          this.hasActivatedDiscovery = true;
          this.activateDistrictsForPhase('DISCOVERY');
          this.constructionZone1.setAvailable(true);
        }
        break;
      }

      case 'DEVELOPMENT': {
        // DEVELOPMENT (10s+): More buildings & connecting structures; Zone 2 available
        if (!this.hasActivatedDevelopment) {
          this.hasActivatedDevelopment = true;
          this.activateDistrictsForPhase('DEVELOPMENT');

          // Failsafe: auto-complete Zone 1 if user hasn't placed it yet
          if (this.constructionZone1.state === 'AVAILABLE') {
            const b = this.constructionZone1.constructBuilding('TYPE_B');
            this.group.add(b.group);
            this.userBuildings.push(b);
            this.grabbableBlock1.setVisibility(false);
          }

          // Activate block 2 and zone 2
          this.grabbableBlock2.setVisibility(true);
          this.constructionZone2.setAvailable(true);
        }
        break;
      }

      case 'BUILD':
      case 'CLIMAX_PREP': {
        // BUILD (18s+): Higher buildings, extensive districts
        if (!this.hasActivatedBuild) {
          this.hasActivatedBuild = true;
          this.activateDistrictsForPhase('BUILD');

          // Failsafe: auto-complete Zone 2 if user hasn't placed it yet
          if (this.constructionZone2.state === 'AVAILABLE') {
            const b = this.constructionZone2.constructBuilding('TYPE_D');
            this.group.add(b.group);
            this.userBuildings.push(b);
            this.grabbableBlock2.setVisibility(false);
          }
        }
        break;
      }

      case 'CLIMAX': {
        // CLIMAX (31s+): Complete 360-degree city composition fully revealed
        if (!this.hasActivatedClimax) {
          this.hasActivatedClimax = true;
          this.activateDistrictsForPhase('CLIMAX');
        }
        break;
      }

      case 'RELEASE':
      case 'COMPLETE': {
        // RELEASE (37s+): City settles into peaceful tranquil final glow
        break;
      }
    }
  }

  private activateDistrictsForPhase(phase: 'DISCOVERY' | 'DEVELOPMENT' | 'BUILD' | 'CLIMAX'): void {
    let stagger = 0;
    for (let i = 0; i < this.districts.length; i++) {
      if (this.districts[i].activationPhase === phase) {
        this.districts[i].activate(stagger);
        stagger++;
      }
    }
  }

  /**
   * Resets all city elements back to pristine initial state for replay (Section 22)
   */
  reset(): void {
    this.hasActivatedDiscovery = false;
    this.hasActivatedDevelopment = false;
    this.hasActivatedBuild = false;
    this.hasActivatedClimax = false;

    // Reset interaction & blocks
    this.interaction.reset();
    this.grabbableBlock1.setVisibility(true);
    this.grabbableBlock2.setVisibility(false);

    // Reset construction zones
    this.constructionZone1.reset();
    this.constructionZone2.reset();

    // Reset all districts
    for (let i = 0; i < this.districts.length; i++) {
      this.districts[i].reset();
    }

    // Clean up user buildings
    for (let i = 0; i < this.userBuildings.length; i++) {
      this.userBuildings[i].dispose();
      this.group.remove(this.userBuildings[i].group);
    }
    this.userBuildings = [];

    // Reset lighting
    this.lighting.reset();

    console.log('[CitySystem] Reset successfully to initial CALM state');
  }

  dispose(): void {
    this.districts.forEach((d) => d.dispose());
    this.districts = [];
    this.userBuildings.forEach((b) => b.dispose());
    this.userBuildings = [];
    this.calmBlocks.forEach((b) => b.dispose());
    this.calmBlocks = [];
    this.grabbableBlock1.dispose();
    this.grabbableBlock2.dispose();
    this.constructionZone1.dispose();
    this.constructionZone2.dispose();
    this.lighting.dispose();
    this.group.clear();
  }
}
