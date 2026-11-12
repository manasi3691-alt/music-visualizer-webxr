/**
 * ShootingStarUniverse: Authored cinematic climax event for EXPERIENCE WebXR.
 *
 * Sequence:
 *  1. Climax trigger at authored time (CLIMAX cue: relativeTime 31.0s, absoluteTime 271.0s).
 *  2. Shooting star spawns high above at t0 (28.5s during CLIMAX_PREP), travels toward user's head-safe focal point.
 *  3. Star reaches focal point at t1 (31.0s - exact climax downbeat!).
 *  4. Burst of radiant additive sparkles, expanding ring, and subtle light at t2 (31.0s).
 *  5. City smoothly dissolves and scales down into the universe at t3 (31.5s - 34.0s).
 *  6. Deep cosmic universe (stars, nebula clouds, dust, cosmic horizon) fully reveals at t4 (33.0s).
 *  7. Full cleanup and disposal on replay/reset.
 */

import {
  Group,
  Mesh,
  Points,
  BufferGeometry,
  Float32BufferAttribute,
  PointsMaterial,
  MeshBasicMaterial,
  SphereGeometry,
  RingGeometry,
  PlaneGeometry,
  Color,
  Vector3,
  Quaternion,
  AdditiveBlending,
  DoubleSide,
  Camera,
  World,
} from '@iwsdk/core';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

export interface ShootingStarTimelineConfig {
  t0_spawn: number;      // Seconds in relative time: star spawns & travels (28.5s)
  t1_impact: number;     // Seconds in relative time: star reaches focal point (31.0s - CLIMAX downbeat)
  t2_burst: number;      // Burst sparkles expand (31.0s)
  t3_dissolve: number;   // City dissolve begins (31.5s)
  t4_universe: number;   // Universe fully unveiled (34.0s)
  t5_settle: number;     // Burst settles into gentle starfield (36.0s)
}

export const CINEMATIC_TIMELINE: ShootingStarTimelineConfig = {
  t0_spawn: 161.0,     // Ocean light trails ascend at 161.0s
  t1_impact: 165.0,    // Climax impact at 165.0s (massive musical drop)
  t2_burst: 165.0,     // Burst of radiant celestial sparkles
  t3_dissolve: 55.0,   // City begins dissolving to aurora particles at 55.0s
  t4_universe: 175.0,  // Deep cosmos & Solar System fully revealed at 175.0s
  t5_settle: 178.0,    // Sparkle burst settles into background cosmos
};

export class ShootingStarUniverse {
  readonly group: Group = new Group();

  private isQuest: boolean;
  private hasTriggeredThisCycle = false;
  private isEventActive = false;

  // Star visual elements
  private starGroup: Group = new Group();
  private starCoreMesh: Mesh;
  private starGlowMesh: Mesh;
  private starHaloMesh: Mesh;
  private starTrailPoints: Points;
  private starTrailGeo: BufferGeometry;
  private starTrailPositions: Float32Array;
  private readonly trailLength = 36;
  private trailHistory: Vector3[] = [];

  // Star trajectory curve parameters
  private starSpawnPos: Vector3 = new Vector3(8.0, 32.0, -38.0);
  private starControlPos: Vector3 = new Vector3(3.0, 14.0, -14.0);
  private starTargetPos: Vector3 = new Vector3(0.0, 1.4, -2.0); // Computed dynamically at runtime

  // Sparkle burst elements (Single pooled Points cloud)
  private burstGroup: Group = new Group();
  private burstPoints: Points;
  private burstGeo: BufferGeometry;
  private burstPositions: Float32Array;
  private burstVelocities: Float32Array;
  private burstColors: Float32Array;
  private burstMaterial: PointsMaterial;
  private burstCount: number;

  // Expanding shockwave ring
  private shockwaveMesh: Mesh;
  private shockwaveMaterial: MeshBasicMaterial;

  // Universe Environment elements
  private universeGroup: Group = new Group();
  private universeStars: Points | null = null;
  private nebulaPlanes: Mesh[] = [];
  private universeDust: Points | null = null;
  private universeAlpha = 0; // 0 to 1

  // References to external targets for coordination
  private cityGroupRef: Group | null = null;
  private originalCityScale: Vector3 = new Vector3(1, 1, 1);
  private isCityDissolved = false;

  // Temporary scratch variables to avoid per-frame allocations
  private scratchHeadPos = new Vector3();
  private scratchHeadQuat = new Quaternion();
  private scratchForward = new Vector3();
  private scratchStarCurrentPos = new Vector3();

  constructor(isQuest = false) {
    this.isQuest = isQuest;
    this.burstCount = isQuest ? 320 : 1200;

    this.group.name = 'ShootingStarUniverse';
    this.group.add(this.starGroup);
    this.group.add(this.burstGroup);
    this.group.add(this.universeGroup);

    // 1. Build Star Meshes
    // Star core (bright white-cyan)
    const coreGeo = new SphereGeometry(0.09, 16, 16);
    const coreMat = new MeshBasicMaterial({
      color: 0xe0ffff,
      blending: AdditiveBlending,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.starCoreMesh = new Mesh(coreGeo, coreMat);
    this.starGroup.add(this.starCoreMesh);

    // Outer glow (electric blue/violet)
    const glowGeo = new SphereGeometry(0.24, 16, 16);
    const glowMat = new MeshBasicMaterial({
      color: 0x4d94ff,
      blending: AdditiveBlending,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.starGlowMesh = new Mesh(glowGeo, glowMat);
    this.starGroup.add(this.starGlowMesh);

    // Soft outer halo plane (facing camera)
    const haloGeo = new PlaneGeometry(0.9, 0.9);
    const haloMat = new MeshBasicMaterial({
      color: 0x8a2be2,
      blending: AdditiveBlending,
      transparent: true,
      opacity: 0,
      side: DoubleSide,
      depthWrite: false,
    });
    this.starHaloMesh = new Mesh(haloGeo, haloMat);
    this.starGroup.add(this.starHaloMesh);

    // Star Trail Points
    this.starTrailPositions = new Float32Array(this.trailLength * 3);
    this.starTrailGeo = new BufferGeometry();
    this.starTrailGeo.setAttribute('position', new Float32BufferAttribute(this.starTrailPositions, 3));
    const trailMat = new PointsMaterial({
      color: 0x00e5ff,
      size: isQuest ? 0.08 : 0.12,
      blending: AdditiveBlending,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.starTrailPoints = new Points(this.starTrailGeo, trailMat);
    this.starGroup.add(this.starTrailPoints);

    // Initial trail history
    for (let i = 0; i < this.trailLength; i++) {
      this.trailHistory.push(new Vector3().copy(this.starSpawnPos));
    }

    // 2. Build Explosion Sparkles (Single Pooled Points Cloud)
    this.burstPositions = new Float32Array(this.burstCount * 3);
    this.burstVelocities = new Float32Array(this.burstCount * 3);
    this.burstColors = new Float32Array(this.burstCount * 3);
    this.initBurstParticles();

    this.burstGeo = new BufferGeometry();
    this.burstGeo.setAttribute('position', new Float32BufferAttribute(this.burstPositions, 3));
    this.burstGeo.setAttribute('color', new Float32BufferAttribute(this.burstColors, 3));

    this.burstMaterial = new PointsMaterial({
      size: isQuest ? 0.07 : 0.09,
      vertexColors: true,
      blending: AdditiveBlending,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.burstPoints = new Points(this.burstGeo, this.burstMaterial);
    this.burstGroup.add(this.burstPoints);

    // Shockwave Ring
    const shockRingGeo = new RingGeometry(0.1, 0.28, 32);
    this.shockwaveMaterial = new MeshBasicMaterial({
      color: 0x80d8ff,
      blending: AdditiveBlending,
      side: DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.shockwaveMesh = new Mesh(shockRingGeo, this.shockwaveMaterial);
    this.shockwaveMesh.rotation.x = Math.PI * 0.5;
    this.burstGroup.add(this.shockwaveMesh);

    // 3. Pre-build Universe Environment
    this.initUniverse();

    // Hide everything by default
    this.starGroup.visible = false;
    this.burstGroup.visible = false;
    this.universeGroup.visible = false;
  }

  /**
   * Pre-initializes burst particles with radial randomized 3D directions and palettes.
   */
  private initBurstParticles(): void {
    const palette = [
      new Color(0xffffff), // Radiant white
      new Color(0x7df9ff), // Electric cyan
      new Color(0x38b6ff), // Sky blue
      new Color(0x9d4edd), // Cosmic violet
      new Color(0xffd166), // Subtle warm star gold
    ];

    for (let i = 0; i < this.burstCount; i++) {
      const i3 = i * 3;
      // Start at origin
      this.burstPositions[i3] = 0;
      this.burstPositions[i3 + 1] = 0;
      this.burstPositions[i3 + 2] = 0;

      // Spherical distribution with slight forward bias
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const speed = 1.2 + Math.random() * 4.8;

      this.burstVelocities[i3] = Math.sin(phi) * Math.cos(theta) * speed;
      this.burstVelocities[i3 + 1] = Math.cos(phi) * speed * 0.9;
      this.burstVelocities[i3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;

      const col = palette[Math.floor(Math.random() * palette.length)];
      this.burstColors[i3] = col.r;
      this.burstColors[i3 + 1] = col.g;
      this.burstColors[i3 + 2] = col.b;
    }
  }

  /**
   * Pre-allocates procedural deep space universe starfield and nebula layers.
   */
  private initUniverse(): void {
    const starCount = this.isQuest ? 1400 : 3600;
    const starGeo = new BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    const starCols = new Float32Array(starCount * 3);

    const starPalettes = [
      new Color(0xffffff),
      new Color(0xd0e8ff),
      new Color(0xb3c5ff),
      new Color(0xffe6b3),
      new Color(0x99ffff),
    ];

    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      // Distribute on sphere shell radius 45 - 90m
      const rad = 45 + Math.random() * 45;
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);

      starPos[i3] = rad * Math.sin(phi) * Math.cos(theta);
      starPos[i3 + 1] = Math.max(0.5, rad * Math.cos(phi)); // Keep mostly above ground plane
      starPos[i3 + 2] = rad * Math.sin(phi) * Math.sin(theta);

      const c = starPalettes[Math.floor(Math.random() * starPalettes.length)];
      starCols[i3] = c.r;
      starCols[i3 + 1] = c.g;
      starCols[i3 + 2] = c.b;
    }

    starGeo.setAttribute('position', new Float32BufferAttribute(starPos, 3));
    starGeo.setAttribute('color', new Float32BufferAttribute(starCols, 3));

    const starMat = new PointsMaterial({
      size: this.isQuest ? 0.35 : 0.45,
      vertexColors: true,
      blending: AdditiveBlending,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.universeStars = new Points(starGeo, starMat);
    this.universeGroup.add(this.universeStars);

    // Add 4 large soft nebula planes at varied distance
    const nebulaColors = [0x1f1a52, 0x092b47, 0x3d1052, 0x0b3c5d];
    const nebulaTransforms = [
      { pos: [0, 18, -35], scale: 40, rotZ: 0.2 },
      { pos: [-25, 14, -28], scale: 35, rotZ: -0.4 },
      { pos: [22, 16, -26], scale: 32, rotZ: 0.6 },
      { pos: [0, 24, 25], scale: 42, rotZ: 0.0 },
    ];

    for (let i = 0; i < nebulaTransforms.length; i++) {
      const t = nebulaTransforms[i];
      const nebGeo = new PlaneGeometry(t.scale, t.scale);
      const nebMat = new MeshBasicMaterial({
        color: nebulaColors[i],
        blending: AdditiveBlending,
        transparent: true,
        opacity: 0,
        side: DoubleSide,
        depthWrite: false,
      });
      const mesh = new Mesh(nebGeo, nebMat);
      mesh.position.set(t.pos[0], t.pos[1], t.pos[2]);
      mesh.lookAt(0, 1.2, 0);
      mesh.rotation.z = t.rotZ;
      this.nebulaPlanes.push(mesh);
      this.universeGroup.add(mesh);
    }
  }

  /**
   * Links city group so the dissolve can fade & scale it down safely.
   */
  setCityRef(cityGroup: Group): void {
    this.cityGroupRef = cityGroup;
    this.originalCityScale.copy(cityGroup.scale);
  }

  /**
   * Computes the head-safe focal target point in front of the seated user.
   * Uses world matrix / WebXR getCamera, never camera.position directly.
   */
  private updateHeadFocalTarget(world?: World, camera?: Camera): void {
    if (!camera) return;

    if (world?.renderer?.xr?.isPresenting) {
      // In WebXR, obtain the actual XR camera (takes 0 arguments in Three.js WebXRManager)
      const xrCam = world.renderer.xr.getCamera();
      xrCam.getWorldPosition(this.scratchHeadPos);
      xrCam.getWorldQuaternion(this.scratchHeadQuat);
    } else {
      camera.getWorldPosition(this.scratchHeadPos);
      camera.getWorldQuaternion(this.scratchHeadQuat);
    }

    // Seated forward direction projected onto XZ plane
    this.scratchForward.set(0, 0, -1).applyQuaternion(this.scratchHeadQuat);
    this.scratchForward.y = 0;
    if (this.scratchForward.lengthSq() < 0.001) {
      this.scratchForward.set(0, 0, -1);
    } else {
      this.scratchForward.normalize();
    }

    // Focal point: 2.1m in front of user, with slight 14° upward angle
    const targetDistance = 2.1; // Safely within [1.0m, 3.5m] bound
    const elevation = 0.52;     // Slight upward tilt (~14°)

    this.starTargetPos.copy(this.scratchHeadPos)
      .addScaledVector(this.scratchForward, targetDistance);
    this.starTargetPos.y = Math.max(1.3, this.scratchHeadPos.y + elevation);

    // RETARGET: Shooting star fires from the ocean water surface/horizon and arcs upward into the sky
    this.starSpawnPos.set(
      this.starTargetPos.x + 4.5,
      0.08,                          // At ocean water level (fires from ocean)
      this.starTargetPos.z - 28.0    // Distant ocean horizon
    );

    // Mid control point for graceful upward ascending arc
    this.starControlPos.set(
      this.starTargetPos.x + 2.0,
      this.starTargetPos.y + 4.5,    // Ascending upward through ocean sky
      this.starTargetPos.z - 12.0
    );
  }

  /**
   * Main cinematic update driven by audio time.
   * Uses relativeTime [0.0 - 38.0s].
   */
  update(deltaSec: number, relativeTime: number, metrics?: AudioMetrics, world?: World, camera?: Camera): void {
    // Check trigger condition
    if (relativeTime >= CINEMATIC_TIMELINE.t0_spawn && !this.hasTriggeredThisCycle) {
      this.trigger(relativeTime, world, camera);
    }

    if (!this.isEventActive) return;

    // --- PHASE 1: SHOOTING STAR FLIGHT (t0 -> t1) ---
    if (relativeTime >= CINEMATIC_TIMELINE.t0_spawn && relativeTime <= CINEMATIC_TIMELINE.t1_impact) {
      this.starGroup.visible = true;
      const flightDuration = CINEMATIC_TIMELINE.t1_impact - CINEMATIC_TIMELINE.t0_spawn;
      const rawT = (relativeTime - CINEMATIC_TIMELINE.t0_spawn) / flightDuration;
      const t = Math.max(0, Math.min(1, rawT));

      // Ease-out deceleration curve: fast arrival then smooth slowdown at focal point
      const easeT = 1 - Math.pow(1 - t, 2.4);

      // Quadratic Bezier interpolation: B(t) = (1-t)^2 P0 + 2(1-t)t P1 + t^2 P2
      const omt = 1 - easeT;
      this.scratchStarCurrentPos.set(0, 0, 0)
        .addScaledVector(this.starSpawnPos, omt * omt)
        .addScaledVector(this.starControlPos, 2 * omt * easeT)
        .addScaledVector(this.starTargetPos, easeT * easeT);

      // Update core, glow, halo positions
      this.starCoreMesh.position.copy(this.scratchStarCurrentPos);
      this.starGlowMesh.position.copy(this.scratchStarCurrentPos);
      this.starHaloMesh.position.copy(this.scratchStarCurrentPos);

      if (camera) {
        this.starHaloMesh.lookAt(camera.position);
      }

      // Fade opacities in smoothly
      const coreMat = this.starCoreMesh.material as MeshBasicMaterial;
      const glowMat = this.starGlowMesh.material as MeshBasicMaterial;
      const haloMat = this.starHaloMesh.material as MeshBasicMaterial;
      const alpha = Math.min(1.0, t * 2.5);

      coreMat.opacity = alpha * 0.95;
      glowMat.opacity = alpha * 0.75;
      haloMat.opacity = alpha * 0.60;

      // Update trail history
      this.trailHistory.pop();
      this.trailHistory.unshift(this.scratchStarCurrentPos.clone());

      for (let i = 0; i < this.trailLength; i++) {
        const i3 = i * 3;
        const pos = this.trailHistory[i];
        this.starTrailPositions[i3] = pos.x;
        this.starTrailPositions[i3 + 1] = pos.y;
        this.starTrailPositions[i3 + 2] = pos.z;
      }
      this.starTrailGeo.attributes.position.needsUpdate = true;
      (this.starTrailPoints.material as PointsMaterial).opacity = alpha * 0.8;
    } else if (relativeTime > CINEMATIC_TIMELINE.t1_impact) {
      // Star has reached destination; hide star body
      this.starGroup.visible = false;
    }

    // --- PHASE 2: BURST & SHOCKWAVE (t1 -> t4) ---
    if (relativeTime >= CINEMATIC_TIMELINE.t1_impact && relativeTime <= CINEMATIC_TIMELINE.t5_settle) {
      this.burstGroup.visible = true;
      const burstAge = relativeTime - CINEMATIC_TIMELINE.t1_impact;
      const burstDuration = CINEMATIC_TIMELINE.t5_settle - CINEMATIC_TIMELINE.t1_impact;
      const burstProgress = Math.max(0, Math.min(1, burstAge / burstDuration));

      // Expand burst particles outward
      const expansion = Math.pow(burstProgress, 0.45) * 5.5;
      const drag = Math.max(0, 1.0 - burstProgress * 0.7);

      for (let i = 0; i < this.burstCount; i++) {
        const i3 = i * 3;
        this.burstPositions[i3] = this.starTargetPos.x + this.burstVelocities[i3] * burstAge * drag;
        this.burstPositions[i3 + 1] = this.starTargetPos.y + this.burstVelocities[i3 + 1] * burstAge * drag;
        this.burstPositions[i3 + 2] = this.starTargetPos.z + this.burstVelocities[i3 + 2] * burstAge * drag;
      }
      this.burstGeo.attributes.position.needsUpdate = true;

      // Burst fade curve (sharp flash onset, slow graceful decay)
      const burstAlpha = Math.max(0, 1.0 - Math.pow(burstProgress, 1.6));
      this.burstMaterial.opacity = burstAlpha * 0.95;

      // Shockwave ring expansion
      this.shockwaveMesh.position.copy(this.starTargetPos);
      const ringScale = 0.5 + burstAge * 7.0;
      this.shockwaveMesh.scale.set(ringScale, ringScale, ringScale);
      this.shockwaveMaterial.opacity = Math.max(0, (1.0 - burstProgress * 2.2) * 0.65);
    } else if (relativeTime > CINEMATIC_TIMELINE.t5_settle) {
      this.burstGroup.visible = false;
    }

    // --- PHASE 3: UNIVERSE REVEAL (t2 -> t4 and onward) ---
    if (relativeTime >= CINEMATIC_TIMELINE.t2_burst) {
      this.universeGroup.visible = true;
      const revealDuration = CINEMATIC_TIMELINE.t4_universe - CINEMATIC_TIMELINE.t2_burst;
      const revealT = Math.max(0, Math.min(1, (relativeTime - CINEMATIC_TIMELINE.t2_burst) / revealDuration));

      // Smoothstep fade for universe
      this.universeAlpha = revealT * revealT * (3 - 2 * revealT);

      const high = metrics?.high ?? 0;
      const energy = metrics?.energy ?? 0;

      if (this.universeStars) {
        (this.universeStars.material as PointsMaterial).opacity = this.universeAlpha * (0.80 + high * 0.20 + energy * 0.15);
      }

      for (let i = 0; i < this.nebulaPlanes.length; i++) {
        (this.nebulaPlanes[i].material as MeshBasicMaterial).opacity = this.universeAlpha * (0.28 + energy * 0.22);
      }

      // Gentle continuous cosmic drift
      if (this.universeStars) {
        this.universeStars.rotation.y += deltaSec * (0.008 + energy * 0.012);
      }
    }
  }

  /**
   * Triggers the shooting star event cycle.
   */
  trigger(audioTime: number, world?: World, camera?: Camera): void {
    if (this.hasTriggeredThisCycle) return;
    this.hasTriggeredThisCycle = true;
    this.isEventActive = true;

    // Compute user's head-safe focal target using runtime XR camera
    this.updateHeadFocalTarget(world, camera);

    console.log(`[ShootingStarUniverse] Climax Event Triggered at relative time ${audioTime.toFixed(2)}s`);
    console.log(`[ShootingStarUniverse] Focal Target Point: (${this.starTargetPos.x.toFixed(2)}, ${this.starTargetPos.y.toFixed(2)}, ${this.starTargetPos.z.toFixed(2)})`);
  }

  /**
   * Resets the event completely for replay or seek-to-zero.
   * Restores city scale and visibility, hides universe, and resets triggers.
   */
  reset(): void {
    this.hasTriggeredThisCycle = false;
    this.isEventActive = false;

    // 1. Reset Star elements
    this.starGroup.visible = false;
    (this.starCoreMesh.material as MeshBasicMaterial).opacity = 0;
    (this.starGlowMesh.material as MeshBasicMaterial).opacity = 0;
    (this.starHaloMesh.material as MeshBasicMaterial).opacity = 0;
    (this.starTrailPoints.material as PointsMaterial).opacity = 0;

    // 2. Reset Burst elements
    this.burstGroup.visible = false;
    this.burstMaterial.opacity = 0;
    this.shockwaveMaterial.opacity = 0;
    this.shockwaveMesh.scale.set(1, 1, 1);

    // 3. Reset Universe elements
    this.universeGroup.visible = false;
    this.universeAlpha = 0;
    if (this.universeStars) {
      (this.universeStars.material as PointsMaterial).opacity = 0;
      this.universeStars.rotation.y = 0;
    }
    for (let i = 0; i < this.nebulaPlanes.length; i++) {
      (this.nebulaPlanes[i].material as MeshBasicMaterial).opacity = 0;
    }

    // 4. Restore City Environment
    if (this.cityGroupRef) {
      this.cityGroupRef.visible = true;
      this.cityGroupRef.scale.copy(this.originalCityScale);
      this.isCityDissolved = false;
    }

    console.log('[ShootingStarUniverse] Reset successfully to pristine state');
  }

  /**
   * Fully disposes all geometries and materials.
   */
  dispose(): void {
    this.reset();

    this.starCoreMesh.geometry.dispose();
    (this.starCoreMesh.material as MeshBasicMaterial).dispose();

    this.starGlowMesh.geometry.dispose();
    (this.starGlowMesh.material as MeshBasicMaterial).dispose();

    this.starHaloMesh.geometry.dispose();
    (this.starHaloMesh.material as MeshBasicMaterial).dispose();

    this.starTrailGeo.dispose();
    (this.starTrailPoints.material as PointsMaterial).dispose();

    this.burstGeo.dispose();
    this.burstMaterial.dispose();

    this.shockwaveMesh.geometry.dispose();
    this.shockwaveMaterial.dispose();

    if (this.universeStars) {
      this.universeStars.geometry.dispose();
      (this.universeStars.material as PointsMaterial).dispose();
    }

    for (let i = 0; i < this.nebulaPlanes.length; i++) {
      this.nebulaPlanes[i].geometry.dispose();
      (this.nebulaPlanes[i].material as MeshBasicMaterial).dispose();
    }

    this.group.clear();
  }
}
