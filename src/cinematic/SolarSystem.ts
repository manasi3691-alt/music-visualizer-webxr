/**
 * SolarSystem: Interactive 3D Solar System inside the cosmic universe.
 *
 * Sequence:
 *  - Appears after city-to-universe transition (CINEMATIC_TIMELINE.t4_universe = 34.0s).
 *  - Sun + 8 Planets (Mercury, Venus, Earth, Mars, Jupiter, Saturn with rings, Uranus, Neptune).
 *  - Arranged in an authored arc within comfortable seated field of view (±60° horizontally, 0-35° elevation, 1.6-3.8m distance).
 *  - Interactive grabbing via Raycast or direct grab in WebXR and Desktop click-drag.
 *  - Transform ownership: 'Orbital' | 'UserOwned' | 'Released'.
 *  - Released planets remain at custom placed positions.
 *  - On replay: resets transforms and ownership to 'Orbital', hides without destroying. Zero per-frame allocations.
 */

import {
  Group,
  Mesh,
  SphereGeometry,
  RingGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  LineSegments,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  Vector3,
  Quaternion,
  Matrix4,
  Color,
  Camera,
  World,
  DoubleSide,
  AdditiveBlending,
  MathUtils,
} from '@iwsdk/core';

export type PlanetOwnership = 'Orbital' | 'UserOwned' | 'Released';

export interface PlanetDefinition {
  id: string;
  name: string;
  radius: number;           // Visual radius in meters
  color: number;            // Surface primary color
  emissive?: number;
  emissiveIntensity?: number;
  orbitRadius: number;      // Distance from Sun center in meters
  orbitSpeed: number;       // Radians per second
  initialAngle: number;     // Starting orbital angle in radians
  hasAtmosphere?: boolean;
  atmosphereColor?: number;
  hasRings?: boolean;
  ringInner?: number;
  ringOuter?: number;
  ringColor?: number;
}

export interface PlanetBody {
  id: string;
  name: string;
  definition: PlanetDefinition;
  group: Group;
  mesh: Mesh;
  highlightMesh: Mesh;
  atmosphereMesh?: Mesh;
  ringMesh?: Mesh;
  ownership: PlanetOwnership;
  currentAngle: number;
  worldPosition: Vector3;
  initialLocalPosition: Vector3;
  originalMaterial: MeshStandardMaterial;
}

export class SolarSystem {
  readonly group: Group = new Group();

  private isQuest: boolean;
  private isVisible = false;
  private isRevealed = false;
  private revealProgress = 0; // 0 to 1

  // Sun and Planets
  private sunGroup: Group = new Group();
  private sunMesh!: Mesh; // assigned synchronously in buildSun() from constructor
  private sunGlowMesh!: Mesh; // assigned synchronously in buildSun() from constructor
  private sunLightMesh!: Mesh; // assigned synchronously in buildSun() from constructor
  private readonly sunRadius = 0.32;

  private planetRegistry: Map<string, PlanetBody> = new Map();
  private orbitLineMesh: LineSegments | null = null;

  // Seated arc anchor (computed at transition time using XR camera world matrix)
  private anchorPosition: Vector3 = new Vector3(0, 1.25, -2.4);
  private anchorForward: Vector3 = new Vector3(0, 0, -1);
  private anchorQuaternion: Quaternion = new Quaternion();
  private hasAnchored = false;

  // Active interaction tracking
  // Keyed by controller hand 'left' | 'right' | 'desktop'
  private activeGrabbedPlanet: Map<string, PlanetBody> = new Map();
  private grabOffsets: Map<string, Vector3> = new Map(); // Offset-preserving grab vector
  private grabPlaneDistances: Map<string, number> = new Map();

  // Shared reusable geometries to minimize draw calls & GPU buffers
  private sharedGeometries: Map<string, SphereGeometry> = new Map();

  // Reusable scratch objects to eliminate per-frame allocations
  private scratchVec = new Vector3();
  private scratchHeadPos = new Vector3();
  private scratchHeadQuat = new Quaternion();
  private scratchRayOrigin = new Vector3();
  private scratchRayDir = new Vector3();
  private scratchMat4 = new Matrix4();

  constructor(isQuest = false) {
    this.isQuest = isQuest;
    this.group.name = 'SolarSystem';

    // 1. Build Shared Geometries
    const segs = isQuest ? 16 : 24;
    this.sharedGeometries.set('small', new SphereGeometry(0.045, segs, segs));
    this.sharedGeometries.set('medium', new SphereGeometry(0.08, segs, segs));
    this.sharedGeometries.set('large', new SphereGeometry(0.14, segs, segs));
    this.sharedGeometries.set('giant', new SphereGeometry(0.20, segs, segs));

    // 2. Build Sun Core & Additive Glow Shells
    this.buildSun();

    // 3. Build Planets
    this.buildPlanets();

    // 4. Build Subtle Orbit Paths
    this.buildOrbitPaths();

    // Start hidden
    this.group.visible = false;
  }

  private buildSun(): void {
    const sunGeo = new SphereGeometry(this.sunRadius, this.isQuest ? 20 : 32, this.isQuest ? 20 : 32);
    const sunMat = new MeshBasicMaterial({
      color: 0xfff3a0,
      depthWrite: true,
    });
    this.sunMesh = new Mesh(sunGeo, sunMat);
    this.sunMesh.name = 'sun-core';
    this.sunGroup.add(this.sunMesh);

    // Inner fiery corona glow (additive)
    const glowGeo = new SphereGeometry(this.sunRadius * 1.22, 16, 16);
    const glowMat = new MeshBasicMaterial({
      color: 0xff9900,
      blending: AdditiveBlending,
      transparent: true,
      opacity: 0.7,
      side: DoubleSide,
      depthWrite: false,
    });
    this.sunGlowMesh = new Mesh(glowGeo, glowMat);
    this.sunGroup.add(this.sunGlowMesh);

    // Outer soft atmospheric corona
    const outerGlowGeo = new SphereGeometry(this.sunRadius * 1.55, 16, 16);
    const outerGlowMat = new MeshBasicMaterial({
      color: 0xff5500,
      blending: AdditiveBlending,
      transparent: true,
      opacity: 0.35,
      side: DoubleSide,
      depthWrite: false,
    });
    this.sunLightMesh = new Mesh(outerGlowGeo, outerGlowMat);
    this.sunGroup.add(this.sunLightMesh);

    this.group.add(this.sunGroup);
  }

  private buildPlanets(): void {
    const definitions: PlanetDefinition[] = [
      {
        id: 'mercury',
        name: 'Mercury',
        radius: 0.04,
        color: 0xa8a8a8,
        emissive: 0x222222,
        orbitRadius: 0.58,
        orbitSpeed: 0.52,
        initialAngle: 0.25,
      },
      {
        id: 'venus',
        name: 'Venus',
        radius: 0.065,
        color: 0xe3bb76,
        emissive: 0x332211,
        orbitRadius: 0.78,
        orbitSpeed: 0.40,
        initialAngle: 1.1,
        hasAtmosphere: true,
        atmosphereColor: 0xffd180,
      },
      {
        id: 'earth',
        name: 'Earth',
        radius: 0.075,
        color: 0x2277bb,
        emissive: 0x052244,
        orbitRadius: 1.05,
        orbitSpeed: 0.32,
        initialAngle: 2.1,
        hasAtmosphere: true,
        atmosphereColor: 0x66ccff,
      },
      {
        id: 'mars',
        name: 'Mars',
        radius: 0.052,
        color: 0xc1440e,
        emissive: 0x331005,
        orbitRadius: 1.32,
        orbitSpeed: 0.26,
        initialAngle: 3.2,
      },
      {
        id: 'jupiter',
        name: 'Jupiter',
        radius: 0.165,
        color: 0xc89e6c,
        emissive: 0x2a1e12,
        orbitRadius: 1.72,
        orbitSpeed: 0.16,
        initialAngle: 4.0,
      },
      {
        id: 'saturn',
        name: 'Saturn',
        radius: 0.135,
        color: 0xdfd194,
        emissive: 0x2e2815,
        orbitRadius: 2.15,
        orbitSpeed: 0.12,
        initialAngle: 4.8,
        hasRings: true,
        ringInner: 0.18,
        ringOuter: 0.36,
        ringColor: 0xb5a374,
      },
      {
        id: 'uranus',
        name: 'Uranus',
        radius: 0.095,
        color: 0x70d6db,
        emissive: 0x123035,
        orbitRadius: 2.55,
        orbitSpeed: 0.09,
        initialAngle: 5.6,
        hasAtmosphere: true,
        atmosphereColor: 0x99ffff,
      },
      {
        id: 'neptune',
        name: 'Neptune',
        radius: 0.092,
        color: 0x274687,
        emissive: 0x07153b,
        orbitRadius: 2.92,
        orbitSpeed: 0.07,
        initialAngle: 0.7,
        hasAtmosphere: true,
        atmosphereColor: 0x4d79ff,
      },
    ];

    const segs = this.isQuest ? 16 : 24;

    for (const def of definitions) {
      const pGroup = new Group();
      pGroup.name = `planet-group-${def.id}`;

      // Pick geometry size
      let geo: SphereGeometry;
      if (def.radius <= 0.05) geo = this.sharedGeometries.get('small')!;
      else if (def.radius <= 0.08) geo = this.sharedGeometries.get('medium')!;
      else if (def.radius <= 0.11) geo = this.sharedGeometries.get('large')!;
      else geo = this.sharedGeometries.get('giant')!;

      // Planet surface material
      const mat = new MeshStandardMaterial({
        color: def.color,
        emissive: def.emissive || 0x000000,
        emissiveIntensity: 0.35,
        roughness: 0.65,
        metalness: 0.1,
      });

      const mesh = new Mesh(geo, mat);
      mesh.name = `planet-mesh-${def.id}`;
      // Scale to exact desired radius
      const currentRadius = geo.parameters.radius;
      const s = def.radius / currentRadius;
      mesh.scale.set(s, s, s);
      pGroup.add(mesh);

      // Soft additive highlight mesh for held/hover state
      const highlightGeo = new SphereGeometry(def.radius * 1.25, 16, 16);
      const highlightMat = new MeshBasicMaterial({
        color: 0x00ffff,
        blending: AdditiveBlending,
        transparent: true,
        opacity: 0,
        side: DoubleSide,
        depthWrite: false,
      });
      const highlightMesh = new Mesh(highlightGeo, highlightMat);
      highlightMesh.name = `highlight-${def.id}`;
      pGroup.add(highlightMesh);

      // Optional atmosphere glow
      let atmosphereMesh: Mesh | undefined;
      if (def.hasAtmosphere && def.atmosphereColor) {
        const atmoGeo = new SphereGeometry(def.radius * 1.15, 16, 16);
        const atmoMat = new MeshBasicMaterial({
          color: def.atmosphereColor,
          blending: AdditiveBlending,
          transparent: true,
          opacity: 0.3,
          side: DoubleSide,
          depthWrite: false,
        });
        atmosphereMesh = new Mesh(atmoGeo, atmoMat);
        atmosphereMesh.name = `atmosphere-${def.id}`;
        pGroup.add(atmosphereMesh);
      }

      // Optional Saturn rings (Single flat ring geometry with alphaTest)
      let ringMesh: Mesh | undefined;
      if (def.hasRings && def.ringInner && def.ringOuter) {
        const ringGeo = new RingGeometry(def.ringInner, def.ringOuter, this.isQuest ? 28 : 44);
        const ringMat = new MeshStandardMaterial({
          color: def.ringColor || 0xd0c090,
          side: DoubleSide,
          roughness: 0.7,
          metalness: 0.15,
        });
        ringMesh = new Mesh(ringGeo, ringMat);
        ringMesh.name = `rings-${def.id}`;
        ringMesh.rotation.x = Math.PI * 0.42; // Tilted rings
        pGroup.add(ringMesh);
      }

      // Initial orbital position relative to Sun
      const initX = Math.cos(def.initialAngle) * def.orbitRadius;
      const initZ = Math.sin(def.initialAngle) * def.orbitRadius;
      pGroup.position.set(initX, 0, initZ);

      this.group.add(pGroup);

      const planetBody: PlanetBody = {
        id: def.id,
        name: def.name,
        definition: def,
        group: pGroup,
        mesh,
        highlightMesh,
        atmosphereMesh,
        ringMesh,
        ownership: 'Orbital',
        currentAngle: def.initialAngle,
        worldPosition: new Vector3(),
        initialLocalPosition: new Vector3(initX, 0, initZ),
        originalMaterial: mat,
      };

      this.planetRegistry.set(def.id, planetBody);
    }
  }

  private buildOrbitPaths(): void {
    const orbitPoints: number[] = [];
    const segments = this.isQuest ? 36 : 64;

    for (const [, planet] of this.planetRegistry) {
      const r = planet.definition.orbitRadius;
      for (let i = 0; i < segments; i++) {
        const theta1 = (i / segments) * Math.PI * 2;
        const theta2 = ((i + 1) / segments) * Math.PI * 2;
        orbitPoints.push(Math.cos(theta1) * r, 0, Math.sin(theta1) * r);
        orbitPoints.push(Math.cos(theta2) * r, 0, Math.sin(theta2) * r);
      }
    }

    const orbitGeo = new BufferGeometry();
    orbitGeo.setAttribute('position', new Float32BufferAttribute(orbitPoints, 3));
    const orbitMat = new LineBasicMaterial({
      color: 0x335577,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    this.orbitLineMesh = new LineSegments(orbitGeo, orbitMat);
    this.orbitLineMesh.name = 'orbit-paths';
    this.group.add(this.orbitLineMesh);
  }

  /**
   * Anchors the Solar System in front of the seated user at transition time.
   * Uses XR camera world position & forward orientation.
   */
  anchorToSeatedUser(world?: World, camera?: Camera): void {
    if (this.hasAnchored) return;
    this.hasAnchored = true;

    if (!camera) return;

    if (world?.renderer?.xr?.isPresenting) {
      const xrCam = world.renderer.xr.getCamera();
      xrCam.getWorldPosition(this.scratchHeadPos);
      xrCam.getWorldQuaternion(this.scratchHeadQuat);
    } else {
      camera.getWorldPosition(this.scratchHeadPos);
      camera.getWorldQuaternion(this.scratchHeadQuat);
    }

    // Seated forward vector projected on XZ plane
    this.anchorForward.set(0, 0, -1).applyQuaternion(this.scratchHeadQuat);
    this.anchorForward.y = 0;
    if (this.anchorForward.lengthSq() < 0.001) {
      this.anchorForward.set(0, 0, -1);
    } else {
      this.anchorForward.normalize();
    }

    // Anchor center: 2.6m in front of user, slightly elevated (~12°) for comfortable seated viewing
    const centerDistance = 2.6; // Safely within [1.5m, 4.0m] seated VR arc
    const elevation = 0.35;

    this.anchorPosition.copy(this.scratchHeadPos)
      .addScaledVector(this.anchorForward, centerDistance);
    this.anchorPosition.y = Math.max(1.15, this.scratchHeadPos.y + elevation);

    this.group.position.copy(this.anchorPosition);

    // Orient solar system plane tilted slightly toward the user (15°) for optimal 3D visibility
    this.group.rotation.set(0, 0, 0);
    this.group.quaternion.copy(this.scratchHeadQuat);
    this.group.rotateX(0.18); // Gentle 10-15° tilt toward seated eye level
  }

  /**
   * Main update driven by existing audio clock.
   */
  update(deltaSec: number, relativeTime: number, world?: World, camera?: Camera): void {
    // Reveal solar system at t4_universe (34.0s)
    const REVEAL_START = 34.0;
    const REVEAL_END = 36.5;

    if (relativeTime >= REVEAL_START && !this.isRevealed) {
      this.isRevealed = true;
      this.group.visible = true;
      this.anchorToSeatedUser(world, camera);
      console.log(`[SolarSystem] Revealed at relative time ${relativeTime.toFixed(2)}s`);
    }

    if (!this.group.visible) return;

    // Smooth entry scale & opacity animation
    if (this.revealProgress < 1.0) {
      this.revealProgress = Math.min(1.0, (relativeTime - REVEAL_START) / (REVEAL_END - REVEAL_START));
      const eased = Math.sin(this.revealProgress * Math.PI * 0.5);
      this.group.scale.set(eased, eased, eased);
    }

    // Rotate Sun coronas gently
    this.sunGlowMesh.rotation.y += deltaSec * 0.25;
    this.sunLightMesh.rotation.z += deltaSec * 0.12;

    // Update Planetary Orbits
    for (const [, planet] of this.planetRegistry) {
      // If planet is currently held by user or released to custom position, do NOT move it along orbit
      if (planet.ownership === 'UserOwned' || planet.ownership === 'Released') {
        // Still gently spin planet on its own axis
        planet.mesh.rotation.y += deltaSec * 0.6;
        continue;
      }

      // Orbital motion
      planet.currentAngle += planet.definition.orbitSpeed * deltaSec;
      const r = planet.definition.orbitRadius;
      planet.group.position.x = Math.cos(planet.currentAngle) * r;
      planet.group.position.z = Math.sin(planet.currentAngle) * r;

      // Spin planet on its own axis
      planet.mesh.rotation.y += deltaSec * 0.8;
    }
  }

  // ─── INTERACTION HANDLING (WebXR & Desktop) ────────────────────────────────

  /**
   * Tests Raycaster intersection against all interactive planet meshes.
   * Sun is excluded so it never blocks planet selection.
   */
  hitTest(rayOrigin: Vector3, rayDirection: Vector3, maxDistance = 5.0): PlanetBody | null {
    if (!this.group.visible) return null;

    let closestPlanet: PlanetBody | null = null;
    let closestDist = Infinity;

    // Sphere intersection check per planet
    for (const [, planet] of this.planetRegistry) {
      planet.group.getWorldPosition(this.scratchVec);

      // Ray to sphere distance test
      const toCenter = new Vector3().subVectors(this.scratchVec, rayOrigin);
      const proj = toCenter.dot(rayDirection);

      if (proj <= 0 || proj > maxDistance) continue;

      const perpSq = toCenter.lengthSq() - proj * proj;
      // Hit radius: planet radius + generous 0.12m margin for effortless ray grab
      const hitRadius = planet.definition.radius + 0.12;

      if (perpSq <= hitRadius * hitRadius) {
        if (proj < closestDist) {
          closestDist = proj;
          closestPlanet = planet;
        }
      }
    }

    return closestPlanet;
  }

  /**
   * Begins moving a planet. Uses offset-preserving grab model.
   * @param handIdentifier 'left' | 'right' | 'desktop'
   */
  handleGrabStart(handIdentifier: string, planet: PlanetBody, controllerWorldPos: Vector3): boolean {
    if (!this.group.visible) return false;

    // Only one planet per controller hand
    if (this.activeGrabbedPlanet.has(handIdentifier)) return false;

    // Transition ownership: prevents orbital system from modifying transform
    planet.ownership = 'UserOwned';

    // Store planet world position before reparenting math
    planet.group.getWorldPosition(planet.worldPosition);

    // Offset-preserving vector from controller to planet
    const offset = new Vector3().subVectors(planet.worldPosition, controllerWorldPos);
    this.grabOffsets.set(handIdentifier, offset);
    this.grabPlaneDistances.set(handIdentifier, planet.worldPosition.distanceTo(controllerWorldPos));
    this.activeGrabbedPlanet.set(handIdentifier, planet);

    // Visual highlight: boost emissive & show soft cyan outline
    planet.originalMaterial.emissiveIntensity = 1.3;
    (planet.highlightMesh.material as MeshBasicMaterial).opacity = 0.55;

    console.log(`[SolarSystem] Grabbed planet: ${planet.name} by ${handIdentifier}`);
    return true;
  }

  /**
   * Updates grabbed planet position preserving initial grab offset.
   * Clamps motion to bounded safe seated volume and prevents overlapping Sun core.
   */
  handleGrabUpdate(handIdentifier: string, currentControllerWorldPos: Vector3, userHeadWorldPos?: Vector3): void {
    const planet = this.activeGrabbedPlanet.get(handIdentifier);
    const offset = this.grabOffsets.get(handIdentifier);
    if (!planet || !offset) return;

    // New target world position
    const targetWorldPos = new Vector3().copy(currentControllerWorldPos).add(offset);

    // Bounded Volume Clamping (relative to seated user head):
    // - Distance: 0.5m to 6.0m
    // - Elevation: -0.5m below to +2.0m above eye level
    if (userHeadWorldPos) {
      const fromHead = new Vector3().subVectors(targetWorldPos, userHeadWorldPos);
      const dist = fromHead.length();
      if (dist < 0.5) {
        fromHead.setLength(0.5);
        targetWorldPos.copy(userHeadWorldPos).add(fromHead);
      } else if (dist > 6.0) {
        fromHead.setLength(6.0);
        targetWorldPos.copy(userHeadWorldPos).add(fromHead);
      }

      // Height clamping
      const relY = targetWorldPos.y - userHeadWorldPos.y;
      targetWorldPos.y = userHeadWorldPos.y + MathUtils.clamp(relY, -0.5, 2.0);
    }

    // Prevent planet from penetrating the Sun core radius
    this.sunGroup.getWorldPosition(this.scratchVec);
    const distToSun = targetWorldPos.distanceTo(this.scratchVec);
    const minSunDist = this.sunRadius + planet.definition.radius + 0.10;
    if (distToSun < minSunDist) {
      const awayFromSun = new Vector3().subVectors(targetWorldPos, this.scratchVec).normalize();
      targetWorldPos.copy(this.scratchVec).addScaledVector(awayFromSun, minSunDist);
    }

    // Convert world target back to solar system group's local coordinates
    planet.group.parent?.worldToLocal(targetWorldPos);
    planet.group.position.copy(targetWorldPos);
  }

  /**
   * Releases planet. Planet remains at custom placed position ('Released').
   */
  handleGrabEnd(handIdentifier: string): void {
    const planet = this.activeGrabbedPlanet.get(handIdentifier);
    if (!planet) return;

    // Transition ownership to 'Released' (stays where user placed it, does not snap back)
    planet.ownership = 'Released';

    // Revert visual highlights (keep size & rotation untouched)
    planet.originalMaterial.emissiveIntensity = 0.35;
    (planet.highlightMesh.material as MeshBasicMaterial).opacity = 0;

    this.activeGrabbedPlanet.delete(handIdentifier);
    this.grabOffsets.delete(handIdentifier);
    this.grabPlaneDistances.delete(handIdentifier);

    console.log(`[SolarSystem] Released planet: ${planet.name}`);
  }

  isHoldingPlanet(handIdentifier: string): boolean {
    return this.activeGrabbedPlanet.has(handIdentifier);
  }

  getActivePlanet(handIdentifier: string): PlanetBody | null {
    return this.activeGrabbedPlanet.get(handIdentifier) || null;
  }

  // ─── REPLAY / RESET & DISPOSAL ─────────────────────────────────────────────

  /**
   * Resets all planets to original orbital positions and hides the solar system for replay.
   * Does NOT destroy geometries, materials, or buffers.
   */
  reset(): void {
    // 1. Release any active grabs
    for (const [hand] of this.activeGrabbedPlanet) {
      this.handleGrabEnd(hand);
    }
    this.activeGrabbedPlanet.clear();
    this.grabOffsets.clear();
    this.grabPlaneDistances.clear();

    // 2. Reset every planet transform & ownership
    for (const [, planet] of this.planetRegistry) {
      planet.ownership = 'Orbital';
      planet.currentAngle = planet.definition.initialAngle;
      planet.group.position.copy(planet.initialLocalPosition);
      planet.group.rotation.set(0, 0, 0);

      // Reset material highlight
      planet.originalMaterial.emissiveIntensity = 0.35;
      (planet.highlightMesh.material as MeshBasicMaterial).opacity = 0;
    }

    // 3. Hide solar system without destroying it
    this.group.visible = false;
    this.isRevealed = false;
    this.hasAnchored = false;
    this.revealProgress = 0;
    this.group.scale.set(0.001, 0.001, 0.001);

    console.log('[SolarSystem] Reset cleanly to initial orbital state');
  }

  /**
   * Complete GPU memory teardown on final app unmount.
   */
  dispose(): void {
    this.reset();

    for (const [, geo] of this.sharedGeometries) {
      geo.dispose();
    }
    this.sharedGeometries.clear();

    this.sunMesh.geometry.dispose();
    (this.sunMesh.material as MeshBasicMaterial).dispose();
    this.sunGlowMesh.geometry.dispose();
    (this.sunGlowMesh.material as MeshBasicMaterial).dispose();
    this.sunLightMesh.geometry.dispose();
    (this.sunLightMesh.material as MeshBasicMaterial).dispose();

    for (const [, planet] of this.planetRegistry) {
      planet.mesh.geometry.dispose();
      planet.originalMaterial.dispose();
      planet.highlightMesh.geometry.dispose();
      (planet.highlightMesh.material as MeshBasicMaterial).dispose();
      if (planet.atmosphereMesh) {
        planet.atmosphereMesh.geometry.dispose();
        (planet.atmosphereMesh.material as MeshBasicMaterial).dispose();
      }
      if (planet.ringMesh) {
        planet.ringMesh.geometry.dispose();
        (planet.ringMesh.material as MeshStandardMaterial).dispose();
      }
    }
    this.planetRegistry.clear();

    if (this.orbitLineMesh) {
      this.orbitLineMesh.geometry.dispose();
      (this.orbitLineMesh.material as LineBasicMaterial).dispose();
    }

    this.group.clear();
  }
}
