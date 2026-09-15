/**
 * ExperienceWorld: Central Three.js scene root for the visual systems.
 * Manages one continuous world, coordinating atmosphere, forms,
 * structures, waves, particles, and lighting.
 */

import { Group, Vector3 } from '@iwsdk/core';
import { Atmosphere } from './Atmosphere.js';
import { OrganicForms } from './OrganicForms.js';
import { Structures } from './Structures.js';
import { Waves } from './Waves.js';
import { Particles } from './Particles.js';
import { LightingSystem } from './LightingSystem.js';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export class ExperienceWorld {
  readonly rootGroup: Group = new Group();

  readonly atmosphere: Atmosphere;
  readonly organicForms: OrganicForms;
  readonly structures: Structures;
  readonly waves: Waves;
  readonly particles: Particles;
  readonly lighting: LightingSystem;

  private waveOrigin = new Vector3(0, 1.1, -1.0);

  constructor(isQuest = false) {
    this.atmosphere = new Atmosphere();
    this.organicForms = new OrganicForms();
    this.structures = new Structures();
    this.waves = new Waves();
    this.particles = new Particles(isQuest);
    this.lighting = new LightingSystem();

    // Assemble single persistent scene graph
    this.rootGroup.add(this.atmosphere.group);
    this.rootGroup.add(this.lighting.group);
    this.rootGroup.add(this.structures.group);
    this.rootGroup.add(this.organicForms.group);
    this.rootGroup.add(this.particles.group);
    this.rootGroup.add(this.waves.group);
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
  }

  /**
   * Called when grab is released
   */
  handleGrabRelease(): void {
    this.structures.resetGrabDisplacement();
    this.waves.emitWave(this.structures.grabOrbMesh.position, 4.0, 2.5);
  }

  /**
   * Update visual systems in strict order (Section 41)
   */
  update(frameData: ConductorFrameData, metrics: AudioMetrics, deltaSec: number): void {
    // 1. Environmental lighting & atmosphere
    this.lighting.update(frameData, metrics);
    this.atmosphere.update(frameData, metrics);

    // 2. Primary & secondary geometry
    this.organicForms.update(frameData, metrics, deltaSec);
    this.structures.update(frameData, metrics, deltaSec);

    // 3. Dynamic effects: particles & waves
    this.particles.update(frameData, metrics, deltaSec);
    this.waves.update(frameData, metrics, deltaSec);
  }

  dispose(): void {
    this.atmosphere.dispose();
    this.organicForms.dispose();
    this.structures.dispose();
    this.waves.dispose();
    this.particles.dispose();
    this.lighting.dispose();
    this.rootGroup.clear();
  }
}
