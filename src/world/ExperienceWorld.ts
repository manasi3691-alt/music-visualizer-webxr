/**
 * ExperienceWorld: Central Three.js scene root for the visual systems.
 * Manages one continuous world, coordinating atmosphere, forms,
 * structures, waves, particles, lighting, dense architecture, and bubbles.
 */

import { Group, Vector3 } from '@iwsdk/core';
import { Atmosphere } from './Atmosphere.js';
import { OrganicForms } from './OrganicForms.js';
import { Structures } from './Structures.js';
import { Waves } from './Waves.js';
import { Particles } from './Particles.js';
import { LightingSystem } from './LightingSystem.js';
import { CitySystem } from '../city/CitySystem.js';
import { ImmersiveArchitecture } from './ImmersiveArchitecture.js';
import { SoundBubbles } from './SoundBubbles.js';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

import { ShootingStarUniverse } from '../cinematic/ShootingStarUniverse.js';
import { SolarSystem } from '../cinematic/SolarSystem.js';
import { GlowingFlower } from './GlowingFlower.js';
import { OceanOfLight } from './OceanOfLight.js';
import { Camera, World } from '@iwsdk/core';

export class ExperienceWorld {
  readonly rootGroup: Group = new Group();

  readonly atmosphere: Atmosphere;
  readonly organicForms: OrganicForms;
  readonly structures: Structures;
  readonly waves: Waves;
  readonly particles: Particles;
  readonly lighting: LightingSystem;
  readonly citySystem: CitySystem;
  readonly glowingFlower: GlowingFlower;
  readonly oceanOfLight: OceanOfLight;
  readonly shootingStarUniverse: ShootingStarUniverse;
  readonly solarSystem: SolarSystem;
  readonly immersiveArchitecture: ImmersiveArchitecture;
  readonly soundBubbles: SoundBubbles;

  private waveOrigin = new Vector3(0, 1.1, -1.0);

  constructor(isQuest = false) {
    this.atmosphere = new Atmosphere();
    this.organicForms = new OrganicForms();
    this.structures = new Structures();
    this.waves = new Waves();
    this.particles = new Particles(isQuest);
    this.lighting = new LightingSystem();
    this.citySystem = new CitySystem(isQuest);
    this.glowingFlower = new GlowingFlower(isQuest);
    this.oceanOfLight = new OceanOfLight(isQuest);
    this.shootingStarUniverse = new ShootingStarUniverse(isQuest);
    this.shootingStarUniverse.setCityRef(this.citySystem.group);
    this.solarSystem = new SolarSystem(isQuest);
    this.immersiveArchitecture = new ImmersiveArchitecture(isQuest);
    this.soundBubbles = new SoundBubbles();

    // Assemble single persistent scene graph
    this.rootGroup.add(this.atmosphere.group);
    this.rootGroup.add(this.lighting.group);
    this.rootGroup.add(this.oceanOfLight.group);
    this.rootGroup.add(this.citySystem.group);
    this.rootGroup.add(this.structures.group);
    this.rootGroup.add(this.organicForms.group);
    this.rootGroup.add(this.glowingFlower.group);
    this.rootGroup.add(this.particles.group);
    this.rootGroup.add(this.waves.group);
    this.rootGroup.add(this.shootingStarUniverse.group);
    this.rootGroup.add(this.solarSystem.group);
    this.rootGroup.add(this.immersiveArchitecture.group);
    this.rootGroup.add(this.soundBubbles.group);
  }

  /**
   * Called when user touches/pokes an element
   */
  handleTouch(targetPos?: Vector3): void {
    this.organicForms.triggerTouchRipple();
    const pos = targetPos || this.waveOrigin;
    this.waves.emitWave(pos, 3.8, 3.0);
  }

  /**
   * Called when user grabs/drags an element
   */
  handleGrab(dx: number, dy: number, dz: number): void {
    this.structures.setGrabDisplacement(dx, dy, dz);
    if (this.citySystem.interaction.isGrabbing()) {
      this.citySystem.interaction.updateGrab(new Vector3(dx, dy, dz));
    }
  }

  /**
   * Called when grab is released
   */
  handleGrabRelease(): void {
    this.structures.resetGrabDisplacement();
    if (this.citySystem.interaction.isGrabbing()) {
      this.citySystem.interaction.endGrab();
    }
    this.waves.emitWave(this.structures.grabOrbMesh.position, 4.0, 2.5);
  }

  /**
   * Wire XR world into SoundBubbles for proximity detection
   */
  onXRSessionStart(world: World): void {
    this.soundBubbles.setXRWorld(world);
  }

  onXRSessionEnd(): void {
    this.soundBubbles.clearXRWorld();
  }

  /**
   * Update visual systems in strict order (Section 41)
   */
  update(frameData: ConductorFrameData, metrics: AudioMetrics, deltaSec: number, world?: World, camera?: Camera): void {
    // 1. Environmental lighting & atmosphere
    this.lighting.update(frameData, metrics);
    this.atmosphere.update(frameData, metrics);

    // 2. City procedural evolution (music-driven)
    this.citySystem.update(frameData, metrics, deltaSec);

<<<<<<< HEAD
    // 3. Dense immersive architecture (music-synchronized)
    this.immersiveArchitecture.update(frameData, metrics, deltaSec);

    // 4. Primary & secondary geometry
=======
    // 2.5 Flower approach and touch interaction
    this.glowingFlower.update(deltaSec, frameData.relativeTime, metrics, world, camera);

    // 2.6 Living Ocean of Light
    this.oceanOfLight.update(deltaSec, frameData.relativeTime, metrics);

    // 3. Primary & secondary geometry
>>>>>>> origin/main
    this.organicForms.update(frameData, metrics, deltaSec);
    this.structures.update(frameData, metrics, deltaSec);

    // 5. Dynamic effects: particles & waves
    this.particles.update(frameData, metrics, deltaSec);
    this.waves.update(frameData, metrics, deltaSec);

    // 6. Sound bubbles (float + pop interaction)
    this.soundBubbles.update(frameData, metrics, deltaSec);

    // 7. Climax event: Shooting star & Universe transition
    this.shootingStarUniverse.update(deltaSec, frameData.relativeTime, world, camera);

    // 8. Interactive 3D Solar System (reveals after universe transition)
    this.solarSystem.update(deltaSec, frameData.relativeTime, world, camera);
  }

  reset(): void {
    this.citySystem.reset();
    this.glowingFlower.reset();
    this.oceanOfLight.reset();
    this.shootingStarUniverse.reset();
    this.solarSystem.reset();
    this.immersiveArchitecture.reset();
    this.soundBubbles.reset();
  }

  dispose(): void {
    this.atmosphere.dispose();
    this.organicForms.dispose();
    this.structures.dispose();
    this.citySystem.dispose();
    this.glowingFlower.dispose();
    this.oceanOfLight.dispose();
    this.waves.dispose();
    this.particles.dispose();
    this.lighting.dispose();
    this.shootingStarUniverse.dispose();
    this.solarSystem.dispose();
    this.immersiveArchitecture.dispose();
    this.soundBubbles.dispose();
    this.rootGroup.clear();
  }
}
