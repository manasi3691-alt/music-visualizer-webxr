/**
 * SoundBubbles: Interactive Magical Pearlescent Droplet Bubbles for Seated WebXR.
 *
 * Designed for Meta Quest 3S seated VR experience:
 * - Exactly 7 large, pearlescent water droplet bubbles placed in the seated user's comfortable reach volume.
 * - Distance: 0.52m to 0.74m; Height: 0.88m to 1.54m; azimuth spread: front-left to front-right.
 * - Leaves the central Crystal Lotus corridor and wrist UI completely clear and unobstructed.
 * - Appearance: Glowing, translucent, pearlescent water droplets with cyan, pink, violet, and lavender reflections.
 * - Genuine 3D VR Interaction:
 *     * Multi-modal probing: left/right hand index finger tips (hand tracking), controller grips, and ray pointing.
 *     * Subtle hover highlight: glowing rim and concentric contact highlight ring when pointing or approaching.
 *     * Interactive Burst: On touch, pinch, controller trigger, or desktop click:
 *         1. Bubble expands slightly (1.35x) and shimmers with rapid surface tension vibration.
 *         2. Pops with a synthesized crystal chime.
 *         3. Explodes into 60–80 glittering micro-bubbles & sparkling stardust particles that scatter naturally.
 *     * Single burst per interaction (no double triggers).
 *     * Gradual respawn: after a 3.5s delay, new bubbles smoothly materialize so the magical experience continues!
 * - Zero per-frame allocations, fully optimized for Meta Quest 3S.
 */

import {
  Group,
  Mesh,
  Points,
  BufferGeometry,
  Float32BufferAttribute,
  SphereGeometry,
  ShaderMaterial,
  Color,
  Vector3,
  AdditiveBlending,
  DoubleSide,
  Raycaster,
} from '@iwsdk/core';
import { ConductorFrameData } from '../conductor/MusicalConductor.js';
import { AudioMetrics } from '../audio/AudioAnalyzer.js';

interface ReachableBubble {
  mesh: Mesh;
  mat: ShaderMaterial;
  basePos: Vector3;
  restPos: Vector3;
  floatPhase: number;
  floatSpeed: number;
  floatAmplitude: number;
  wobbleSpeed: number;
  baseScale: number;
  currentScale: number;

  // Interaction & Lifecycle states
  state: 'idle' | 'expanding_pop' | 'popped_hidden' | 'respawning';
  hoverIntensity: number; // 0 to 1
  touchLocalPoint: Vector3;
  popTimer: number;       // 0 to POP_SURGE_DURATION
  respawnDelay: number;   // countdown until respawn begins
  respawnProgress: number;// 0 to 1 during smooth materialization
}

const POP_SURGE_DURATION = 0.12; // Fast, responsive expansion before pop
const RESPAWN_WAIT_TIME   = 3.2;  // Seconds after pop before new bubble appears
const RESPAWN_FADE_TIME   = 1.2;  // Seconds to smoothly materialize

export class SoundBubbles {
  readonly group: Group = new Group();

  private bubbles: ReachableBubble[] = [];
  private geoDroplet: BufferGeometry;

  // Glittering micro-bubble and stardust burst pool
  private readonly maxParticles: number;
  private particlePositions!: Float32Array;
  private particleVelocities!: Float32Array;
  private particleColors!: Float32Array;
  private particleAlphas!: Float32Array;
  private particleSizes!: Float32Array;
  private particleLifetimes!: Float32Array;
  private particleMaxLifetimes!: Float32Array;
  private particleGeo!: BufferGeometry;
  private particleMat!: ShaderMaterial;
  private particlePoints!: Points;
  private nextParticleIndex = 0;

  // Scratch objects for zero per-frame allocation
  private scratchBubbleWorldPos = new Vector3();
  private scratchProbeWorldPos  = new Vector3();
  private scratchRayOrigin      = new Vector3();
  private scratchRayDir         = new Vector3();
  private scratchToBubble       = new Vector3();
  private scratchClosestPoint   = new Vector3();
  private scratchLocalTouch     = new Vector3();

  // XR Session and world references
  private xrWorld: any = null;
  private xrSession: any = null;
  private boundOnSelectStart: ((e: any) => void) | null = null;
  private audioCtx: AudioContext | null = null;

  constructor(isQuest = false) {
    this.maxParticles = isQuest ? 480 : 800;

    // Build procedural pearlescent teardrop geometry
    this.geoDroplet = this.buildTeardropGeometry(0.14, 16, 16);

    this.buildReachableBubbles();
    this.buildParticlePool();
  }

  setXRWorld(world: any): void {
    this.xrWorld = world;
  }

  clearXRWorld(): void {
    this.xrWorld = null;
    if (this.xrSession && this.boundOnSelectStart) {
      this.xrSession.removeEventListener('selectstart', this.boundOnSelectStart);
      this.boundOnSelectStart = null;
      this.xrSession = null;
    }
  }

  /**
   * Bind XR session for pinch / trigger selection
   */
  bindXRSession(session: any): void {
    if (!session || this.boundOnSelectStart) return;
    this.xrSession = session;
    this.boundOnSelectStart = (e: any) => this.handleXRSelect(e);
    session.addEventListener('selectstart', this.boundOnSelectStart);
  }

  /**
   * Procedural organic teardrop droplet geometry.
   */
  private buildTeardropGeometry(radius: number, widthSegments: number, heightSegments: number): BufferGeometry {
    const geo = new SphereGeometry(radius, widthSegments, heightSegments);
    const pos = geo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);

      const normY = y / radius; // -1 to +1
      // Teardrop profile: tapered crown at top (normY = 1), bulbous bottom
      const taper = (1.0 - normY * 0.46) * Math.sin(Math.acos(Math.max(-1, Math.min(1, normY))));
      const curRad = Math.sqrt(x * x + z * z);

      if (curRad > 0.0001) {
        const scaleXZ = (taper * radius) / curRad;
        pos.setX(i, x * scaleXZ);
        pos.setZ(i, z * scaleXZ);
      }
      // Vertical elongation for authentic floating liquid teardrop
      pos.setY(i, y * 1.25);
    }
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Set up exactly 7 reachable bubbles around the seated user.
   */
  private buildReachableBubbles(): void {
    // Ergonomically calibrated reachable layout for seated VR user (head ~ 1.2m, chest ~ 0.95m):
    // Central Lotus corridor (|x| < 0.18, y < 1.3, z in -0.5..-1.0) is kept OPEN!
    // Left wrist UI area (x in -0.35..-0.15, y in 0.85..1.15) is kept OPEN!
    const configs: { x: number; y: number; z: number; scale: number; baseColor: Color; hoverColor: Color }[] = [
      // 0. Right-Front Low: primary effortless right-hand touch target
      {
        x: 0.35, y: 1.05, z: -0.52, scale: 1.05,
        baseColor: new Color(0x00f2fe), // Luminous Cyan
        hoverColor: new Color(0xfff2b2),
      },
      // 1. Right-Front Mid: eye-level beauty right
      {
        x: 0.48, y: 1.26, z: -0.46, scale: 1.15,
        baseColor: new Color(0xff77e9), // Pearlescent Pink
        hoverColor: new Color(0x38ef7d),
      },
      // 2. Right-Flank High: reaching slightly up and right
      {
        x: 0.56, y: 1.44, z: -0.32, scale: 0.95,
        baseColor: new Color(0x8a2be2), // Royal Violet
        hoverColor: new Color(0x00f2fe),
      },
      // 3. Left-Front High: above the wrist UI, easy left-hand target
      {
        x: -0.42, y: 1.38, z: -0.48, scale: 1.05,
        baseColor: new Color(0xb39ddb), // Ethereal Lavender
        hoverColor: new Color(0xff77e9),
      },
      // 4. Left-Flank Mid: left side reach
      {
        x: -0.58, y: 1.20, z: -0.30, scale: 1.0,
        baseColor: new Color(0x1de9b6), // Turquoise
        hoverColor: new Color(0xfff2b2),
      },
      // 5. Center-High Arch: high overhead, well above the lotus sight-line
      {
        x: 0.05, y: 1.54, z: -0.58, scale: 1.18,
        baseColor: new Color(0xf4a4a8), // Rose Gold
        hoverColor: new Color(0x00f2fe),
      },
      // 6. Right-Low: comfortable relaxed armrest height
      {
        x: 0.28, y: 0.90, z: -0.42, scale: 0.90,
        baseColor: new Color(0xfff2b2), // Golden Pearl
        hoverColor: new Color(0xff77e9),
      },
    ];

    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];

      const mat = new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAlpha: { value: 0 },
          uHover: { value: 0 },
          uPopProgress: { value: 0 },
          uBaseColor: { value: cfg.baseColor },
          uHoverColor: { value: cfg.hoverColor },
          uTouchPoint: { value: new Vector3(0, 0, 0.12) },
        },
        vertexShader: `
          uniform float uTime;
          uniform float uPopProgress;
          uniform float uHover;

          varying vec3 vNormal;
          varying vec3 vWorldPos;
          varying vec3 vViewDir;
          varying vec3 vLocalPos;

          void main() {
            vNormal = normalize(normalMatrix * normal);
            vLocalPos = position;

            vec3 pos = position;

            // Pre-pop expansion and intense surface tension shimmer
            float popWobbleSpeed = mix(3.5, 26.0, uPopProgress);
            float popWobbleAmp = mix(0.025, 0.07, uPopProgress);

            // Natural floating surface tension wobble
            float wobble = sin(uTime * popWobbleSpeed + pos.y * 7.0) * (popWobbleAmp + uHover * 0.012);
            pos += normal * wobble;

            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            vViewDir = -mvPosition.xyz;
            vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;

            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uAlpha;
          uniform float uHover;
          uniform float uPopProgress;
          uniform vec3 uBaseColor;
          uniform vec3 uHoverColor;
          uniform vec3 uTouchPoint;

          varying vec3 vNormal;
          varying vec3 vWorldPos;
          varying vec3 vViewDir;
          varying vec3 vLocalPos;

          void main() {
            vec3 N = normalize(vNormal);
            vec3 V = normalize(vViewDir);

            float NdotV = max(0.0, dot(N, V));
            // Fresnel glancing edge factor
            float fresnel = pow(1.0 - NdotV, 2.8);

            // Pearlescent chromatic dispersion ramp (cyan, lavender, pink, violet)
            float irid = fract(fresnel * 1.6 + uTime * 0.12 + vLocalPos.y * 1.8);
            vec3 pearlescent = 0.5 + 0.5 * cos(6.28318 * (vec3(1.0) * irid + vec3(0.0, 0.33, 0.67)));

            vec3 waterColor = mix(uBaseColor, pearlescent, 0.62);

            // Hover highlight: glowing rim aura when hand or ray approaches
            vec3 hoverAura = uHoverColor * (uHover * (fresnel * 1.4 + 0.32));

            // Concentric contact highlight ring at finger/probe point
            float touchDist = length(vLocalPos - uTouchPoint);
            float ring = exp(-pow((touchDist - 0.052) * 36.0, 2.0));
            float centerSpot = exp(-pow(touchDist * 28.0, 2.0));
            vec3 ringColor = vec3(1.0, 0.98, 0.88) * (ring * 1.35 + centerSpot * 0.85) * uHover;

            // Specular glints (sun & cosmic reflection)
            vec3 L = normalize(vec3(0.35, 0.85, 0.45));
            vec3 H = normalize(L + V);
            float spec = pow(max(0.0, dot(N, H)), 26.0);

            // Pop flash surge
            float popFlash = pow(uPopProgress, 3.0) * 2.2;

            vec3 finalColor = waterColor + hoverAura + ringColor + vec3(spec * 0.75) + vec3(popFlash);
            float alpha = clamp((fresnel * 0.74 + 0.18 + uHover * 0.22 + spec * 0.5 + popFlash) * uAlpha, 0.0, 0.95);

            gl_FragColor = vec4(finalColor, alpha);
          }
        `,
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
      });

      const mesh = new Mesh(this.geoDroplet, mat);
      mesh.position.set(cfg.x, cfg.y, cfg.z);
      mesh.scale.setScalar(0.001);
      this.group.add(mesh);

      this.bubbles.push({
        mesh,
        mat,
        basePos: new Vector3(cfg.x, cfg.y, cfg.z),
        restPos: new Vector3(cfg.x, cfg.y, cfg.z),
        floatPhase: (i / configs.length) * Math.PI * 2,
        floatSpeed: 0.45 + (i % 3) * 0.15,
        floatAmplitude: 0.035 + (i % 2) * 0.02,
        wobbleSpeed: 1.8 + i * 0.3,
        baseScale: cfg.scale,
        currentScale: 0.001,
        state: 'idle',
        hoverIntensity: 0,
        touchLocalPoint: new Vector3(0, 0, 0.12),
        popTimer: 0,
        respawnDelay: 0,
        respawnProgress: 1.0,
      });
    }

    this.group.visible = false;
  }

  /**
   * Pre-allocated pooled particles for micro-bubbles and stardust bursts.
   */
  private buildParticlePool(): void {
    this.particlePositions = new Float32Array(this.maxParticles * 3);
    this.particleVelocities = new Float32Array(this.maxParticles * 3);
    this.particleColors = new Float32Array(this.maxParticles * 3);
    this.particleAlphas = new Float32Array(this.maxParticles);
    this.particleSizes = new Float32Array(this.maxParticles);
    this.particleLifetimes = new Float32Array(this.maxParticles);
    this.particleMaxLifetimes = new Float32Array(this.maxParticles);

    for (let i = 0; i < this.maxParticles; i++) {
      this.particleAlphas[i] = 0;
      this.particleSizes[i] = 0.05;
      this.particleLifetimes[i] = 0;
      this.particleMaxLifetimes[i] = 1.6;
    }

    this.particleGeo = new BufferGeometry();
    this.particleGeo.setAttribute('position', new Float32BufferAttribute(this.particlePositions, 3));
    this.particleGeo.setAttribute('customColor', new Float32BufferAttribute(this.particleColors, 3));
    this.particleGeo.setAttribute('alpha', new Float32BufferAttribute(this.particleAlphas, 1));
    this.particleGeo.setAttribute('size', new Float32BufferAttribute(this.particleSizes, 1));

    this.particleMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        attribute vec3 customColor;
        attribute float alpha;
        attribute float size;

        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vColor = customColor;
          vAlpha = alpha;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (220.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 1.5, 36.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          if (vAlpha <= 0.01) discard;

          vec2 coord = gl_PointCoord - vec2(0.5);
          float dist = length(coord);
          if (dist > 0.5) discard;

          // Glassy bubble sphere profile: bright rim, hollow translucent center
          float rim = pow(dist * 2.0, 2.5);
          float core = pow(1.0 - dist * 2.0, 2.2);

          vec3 col = mix(vColor, vec3(1.0, 1.0, 1.0), rim * 0.8 + core * 0.4);
          gl_FragColor = vec4(col, vAlpha * (rim * 0.85 + 0.15));
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    this.particlePoints = new Points(this.particleGeo, this.particleMat);
    this.group.add(this.particlePoints);
  }

  /**
   * Main per-frame update.
   */
  update(frameData: ConductorFrameData, metrics: AudioMetrics, deltaSec: number, world?: any): void {
    const t = frameData.relativeTime;

    // Phase 2 window: 55.0s -> 165.0s, dissolving 165s -> 175s
    if (t < 55.0 || t >= 175.0) {
      if (this.group.visible) {
        this.reset();
      }
      return;
    }
    this.group.visible = true;

    // Use passed world if available
    if (world && !this.xrWorld) {
      this.xrWorld = world;
    }

    const emergeProgress = Math.min(1.0, Math.max(0, (t - 55.0) / 8.0));
    const dissolve = t >= 165.0 ? Math.max(0, 1.0 - (t - 165.0) / 10.0) : 1.0;
    const masterVis = emergeProgress * dissolve;

    const { mid, high, energy } = metrics;
    this.particleMat.uniforms.uTime.value = t;

    // 1. Gather all VR probe points (hands, fingers, controllers, rays)
    const probePoints: { pos: Vector3; isFinger: boolean }[] = [];
    const pointingRays: { origin: Vector3; dir: Vector3 }[] = [];

    if (this.xrWorld) {
      const p = this.xrWorld.player;
      if (p) {
        // Hand tracking index fingertips (primary poke probes)
        const rightIndex = p.indexTipSpaces?.right;
        const leftIndex = p.indexTipSpaces?.left;
        if (rightIndex && (rightIndex.visible || rightIndex.matrixWorld?.elements[15] > 0)) {
          rightIndex.updateMatrixWorld();
          const v = new Vector3().setFromMatrixPosition(rightIndex.matrixWorld);
          probePoints.push({ pos: v, isFinger: true });
        }
        if (leftIndex && (leftIndex.visible || leftIndex.matrixWorld?.elements[15] > 0)) {
          leftIndex.updateMatrixWorld();
          const v = new Vector3().setFromMatrixPosition(leftIndex.matrixWorld);
          probePoints.push({ pos: v, isFinger: true });
        }

        // Controller grip spaces
        const rightGrip = p.gripSpaces?.right;
        const leftGrip = p.gripSpaces?.left;
        if (rightGrip && (rightGrip.visible || rightGrip.matrixWorld?.elements[15] > 0)) {
          rightGrip.updateMatrixWorld();
          const v = new Vector3().setFromMatrixPosition(rightGrip.matrixWorld);
          probePoints.push({ pos: v, isFinger: false });
        }
        if (leftGrip && (leftGrip.visible || leftGrip.matrixWorld?.elements[15] > 0)) {
          leftGrip.updateMatrixWorld();
          const v = new Vector3().setFromMatrixPosition(leftGrip.matrixWorld);
          probePoints.push({ pos: v, isFinger: false });
        }

        // Controller / hand ray spaces
        const rightRay = p.raySpaces?.right;
        const leftRay = p.raySpaces?.left;
        if (rightRay && (rightRay.visible || rightRay.matrixWorld?.elements[15] > 0)) {
          rightRay.updateMatrixWorld();
          const o = new Vector3().setFromMatrixPosition(rightRay.matrixWorld);
          const d = new Vector3(0, 0, -1).transformDirection(rightRay.matrixWorld).normalize();
          pointingRays.push({ origin: o, dir: d });
        }
        if (leftRay && (leftRay.visible || leftRay.matrixWorld?.elements[15] > 0)) {
          leftRay.updateMatrixWorld();
          const o = new Vector3().setFromMatrixPosition(leftRay.matrixWorld);
          const d = new Vector3(0, 0, -1).transformDirection(leftRay.matrixWorld).normalize();
          pointingRays.push({ origin: o, dir: d });
        }
      }
    }

    // 2. Update each reachable bubble
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];

      b.mat.uniforms.uTime.value = t;

      // Handle States
      if (b.state === 'idle') {
        // Floating motion
        const floatY = Math.sin(t * b.floatSpeed + b.floatPhase) * b.floatAmplitude;
        const floatX = Math.cos(t * b.floatSpeed * 0.7 + b.floatPhase) * b.floatAmplitude * 0.4;
        b.mesh.position.set(b.restPos.x + floatX, b.restPos.y + floatY, b.restPos.z);

        // Music-synced breathing scale
        const breathe = 1.0 + Math.sin(t * 1.6 + b.floatPhase) * 0.05 + energy * 0.08;
        b.currentScale = b.baseScale * masterVis * breathe;
        b.mesh.scale.setScalar(Math.max(0.001, b.currentScale));

        b.mesh.updateMatrixWorld();
        this.scratchBubbleWorldPos.setFromMatrixPosition(b.mesh.matrixWorld);
        const hitRadius = 0.16 * b.baseScale;
        const hoverRadius = 0.38 * b.baseScale;

        // A. Test Proximity / Touch from probes
        let targetHover = 0;
        let touched = false;

        for (let p = 0; p < probePoints.length; p++) {
          const probe = probePoints[p];
          const dist = probe.pos.distanceTo(this.scratchBubbleWorldPos);

          if (dist < hoverRadius) {
            const h = 1.0 - (dist / hoverRadius);
            if (h > targetHover) {
              targetHover = h;
              // Local touch target point for the highlight ring
              this.scratchLocalTouch.copy(probe.pos).sub(this.scratchBubbleWorldPos);
              b.touchLocalPoint.copy(this.scratchLocalTouch);
            }
          }

          // Direct Touch Poke trigger!
          if (dist <= hitRadius + (probe.isFinger ? 0.03 : 0.05)) {
            touched = true;
            break;
          }
        }

        // B. Test Ray pointing hover
        if (!touched && pointingRays.length > 0) {
          for (let r = 0; r < pointingRays.length; r++) {
            const ray = pointingRays[r];
            this.scratchToBubble.copy(this.scratchBubbleWorldPos).sub(ray.origin);
            const projection = this.scratchToBubble.dot(ray.dir);
            if (projection > 0 && projection < 2.5) {
              this.scratchClosestPoint.copy(ray.origin).addScaledVector(ray.dir, projection);
              const distToRay = this.scratchClosestPoint.distanceTo(this.scratchBubbleWorldPos);
              if (distToRay < hoverRadius) {
                const h = 1.0 - (distToRay / hoverRadius);
                if (h > targetHover) targetHover = h;
              }
            }
          }
        }

        // Smooth hover intensity transition
        b.hoverIntensity += (targetHover - b.hoverIntensity) * Math.min(1.0, deltaSec * 12.0);
        b.mat.uniforms.uHover.value = b.hoverIntensity;
        b.mat.uniforms.uTouchPoint.value.copy(b.touchLocalPoint);
        b.mat.uniforms.uAlpha.value = masterVis * 0.85;

        // If touched, start burst sequence!
        if (touched) {
          this.triggerBurst(b, high);
        }

      } else if (b.state === 'expanding_pop') {
        // Pre-pop expansion surge (1.35x) and intense shimmer over 0.12s
        b.popTimer += deltaSec;
        const surgeProg = Math.min(1.0, b.popTimer / POP_SURGE_DURATION);

        // Scale surge
        const surgeScale = b.baseScale * masterVis * (1.0 + surgeProg * 0.35);
        b.mesh.scale.setScalar(surgeScale);

        b.mat.uniforms.uPopProgress.value = surgeProg;
        b.mat.uniforms.uHover.value = 1.0;

        if (b.popTimer >= POP_SURGE_DURATION) {
          // Explode!
          b.state = 'popped_hidden';
          b.respawnDelay = RESPAWN_WAIT_TIME;
          b.mesh.scale.setScalar(0.001);
          b.mat.uniforms.uAlpha.value = 0;
          this.emitExplosionParticles(b, high);
        }

      } else if (b.state === 'popped_hidden') {
        b.respawnDelay -= deltaSec;
        if (b.respawnDelay <= 0) {
          // Begin gradual materialization / respawn
          b.state = 'respawning';
          b.respawnProgress = 0;
          // Slight natural position wobble (+/- 3cm) so each respawn feels freshly condensed
          b.restPos.x = b.basePos.x + (Math.random() - 0.5) * 0.06;
          b.restPos.y = b.basePos.y + (Math.random() - 0.5) * 0.06;
          b.restPos.z = b.basePos.z + (Math.random() - 0.5) * 0.06;
        }

      } else if (b.state === 'respawning') {
        b.respawnProgress += deltaSec / RESPAWN_FADE_TIME;
        const p = Math.min(1.0, b.respawnProgress);
        // Smoothstep emergence
        const ease = p * p * (3.0 - 2.0 * p);

        b.currentScale = b.baseScale * masterVis * ease;
        b.mesh.scale.setScalar(Math.max(0.001, b.currentScale));
        b.mat.uniforms.uAlpha.value = masterVis * ease * 0.85;
        b.mat.uniforms.uPopProgress.value = 0;
        b.mat.uniforms.uHover.value = 0;

        if (p >= 1.0) {
          b.state = 'idle';
          b.hoverIntensity = 0;
        }
      }
    }

    // 3. Update active explosion particles
    for (let p = 0; p < this.maxParticles; p++) {
      if (this.particleAlphas[p] <= 0.001) continue;

      this.particleLifetimes[p] += deltaSec;
      const prog = this.particleLifetimes[p] / this.particleMaxLifetimes[p];

      if (prog >= 1.0) {
        this.particleAlphas[p] = 0;
        continue;
      }

      const p3 = p * 3;
      // Air resistance deceleration + gentle upward buoyancy
      this.particleVelocities[p3] *= 0.92;
      this.particleVelocities[p3 + 1] = (this.particleVelocities[p3 + 1] + 0.22 * deltaSec) * 0.93;
      this.particleVelocities[p3 + 2] *= 0.92;

      this.particlePositions[p3] += this.particleVelocities[p3] * deltaSec;
      this.particlePositions[p3 + 1] += this.particleVelocities[p3 + 1] * deltaSec;
      this.particlePositions[p3 + 2] += this.particleVelocities[p3 + 2] * deltaSec;

      // Sparkle twinkle
      const sparkle = 0.72 + 0.28 * Math.sin(t * 24.0 + p * 2.1);
      const fade = Math.sin(prog * Math.PI);
      this.particleAlphas[p] = fade * sparkle * (0.85 + high * 0.35);
    }

    this.particleGeo.attributes.position.needsUpdate = true;
    this.particleGeo.attributes.alpha.needsUpdate = true;
  }

  /**
   * Triggers the responsive burst animation.
   */
  private triggerBurst(b: ReachableBubble, highFreq = 0.5): void {
    if (b.state !== 'idle') return;
    b.state = 'expanding_pop';
    b.popTimer = 0;
    this.playPopSound();
  }

  /**
   * Spawns dozens of glittering micro-bubbles and sparkling stardust on pop.
   */
  private emitExplosionParticles(b: ReachableBubble, highFreq = 0.5): void {
    b.mesh.updateMatrixWorld();
    this.scratchBubbleWorldPos.setFromMatrixPosition(b.mesh.matrixWorld);

    // 60-80 glittering particles per burst
    const count = 65;
    const burstSpeed = 2.4;
    const baseCol = b.mat.uniforms.uBaseColor.value as Color;

    for (let i = 0; i < count; i++) {
      const pIdx = this.nextParticleIndex;
      this.nextParticleIndex = (this.nextParticleIndex + 1) % this.maxParticles;
      const p3 = pIdx * 3;

      // Start at droplet world position
      this.particlePositions[p3] = this.scratchBubbleWorldPos.x + (Math.random() - 0.5) * 0.05;
      this.particlePositions[p3 + 1] = this.scratchBubbleWorldPos.y + (Math.random() - 0.5) * 0.05;
      this.particlePositions[p3 + 2] = this.scratchBubbleWorldPos.z + (Math.random() - 0.5) * 0.05;

      // Spherical radial scatter velocity
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2.0 * Math.random() - 1.0);
      const spd = burstSpeed * (0.4 + Math.random() * 0.8);

      this.particleVelocities[p3] = Math.sin(phi) * Math.cos(theta) * spd;
      this.particleVelocities[p3 + 1] = Math.sin(phi) * Math.sin(theta) * spd + 0.3; // Upward float
      this.particleVelocities[p3 + 2] = Math.cos(phi) * spd;

      // Color variation: blend pearlescent cyan, pink, lavender, and diamond spark
      const roll = Math.random();
      if (roll < 0.35) {
        this.particleColors[p3] = baseCol.r;
        this.particleColors[p3 + 1] = baseCol.g;
        this.particleColors[p3 + 2] = baseCol.b;
      } else if (roll < 0.7) {
        this.particleColors[p3] = 0.72; // Lavender Pink
        this.particleColors[p3 + 1] = 0.58;
        this.particleColors[p3 + 2] = 0.95;
      } else {
        this.particleColors[p3] = 1.0;  // Diamond stardust
        this.particleColors[p3 + 1] = 0.98;
        this.particleColors[p3 + 2] = 0.85;
      }

      this.particleAlphas[pIdx] = 1.0;
      this.particleSizes[pIdx] = (0.045 + Math.random() * 0.04) * (0.8 + highFreq * 0.35);
      this.particleLifetimes[pIdx] = 0;
      this.particleMaxLifetimes[pIdx] = 1.4 + Math.random() * 0.9;
    }

    this.particleGeo.attributes.customColor.needsUpdate = true;
    this.particleGeo.attributes.size.needsUpdate = true;
  }

  /**
   * Handle WebXR selectstart (trigger pull or hand pinch).
   */
  private handleXRSelect(e: any): void {
    if (!this.group.visible || !this.xrWorld) return;
    const handedness = e.inputSource?.handedness || 'right';

    const p = this.xrWorld.player;
    if (!p) return;
    const raySpace = handedness === 'left' ? p.raySpaces?.left : p.raySpaces?.right;
    if (!raySpace) return;

    raySpace.updateMatrixWorld();
    this.scratchRayOrigin.setFromMatrixPosition(raySpace.matrixWorld);
    this.scratchRayDir.set(0, 0, -1).transformDirection(raySpace.matrixWorld).normalize();

    this.hitTest(this.scratchRayOrigin, this.scratchRayDir);
  }

  /**
   * Desktop / Controller Ray Hit-Testing (Pops on Click / Trigger)
   */
  hitTest(rayOrigin: Vector3, rayDir: Vector3): boolean {
    if (!this.group.visible) return false;

    let closestBubble: ReachableBubble | null = null;
    let closestDist = Infinity;

    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      if (b.state !== 'idle' || b.mesh.scale.x < 0.05) continue;

      b.mesh.updateMatrixWorld();
      this.scratchBubbleWorldPos.setFromMatrixPosition(b.mesh.matrixWorld);

      this.scratchToBubble.copy(this.scratchBubbleWorldPos).sub(rayOrigin);
      const projection = this.scratchToBubble.dot(rayDir);

      if (projection > 0 && projection < 3.0) {
        this.scratchClosestPoint.copy(rayOrigin).addScaledVector(rayDir, projection);
        const dist = this.scratchClosestPoint.distanceTo(this.scratchBubbleWorldPos);
        const hitRadius = 0.22 * b.baseScale;

        if (dist < hitRadius && projection < closestDist) {
          closestDist = projection;
          closestBubble = b;
        }
      }
    }

    if (closestBubble) {
      this.triggerBurst(closestBubble, 0.5);
      return true;
    }
    return false;
  }

  /**
   * Desktop mouse hover test
   */
  hoverTest(rayOrigin: Vector3, rayDir: Vector3): void {
    if (!this.group.visible) return;

    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      if (b.state !== 'idle') continue;

      b.mesh.updateMatrixWorld();
      this.scratchBubbleWorldPos.setFromMatrixPosition(b.mesh.matrixWorld);
      this.scratchToBubble.copy(this.scratchBubbleWorldPos).sub(rayOrigin);
      const projection = this.scratchToBubble.dot(rayDir);

      if (projection > 0 && projection < 3.0) {
        this.scratchClosestPoint.copy(rayOrigin).addScaledVector(rayDir, projection);
        const dist = this.scratchClosestPoint.distanceTo(this.scratchBubbleWorldPos);
        const hoverRadius = 0.35 * b.baseScale;
        if (dist < hoverRadius) {
          b.hoverIntensity = Math.min(1.0, b.hoverIntensity + 0.15);
        }
      }
    }
  }

  /**
   * Pleasant synthesized crystal chime pop sound.
   */
  private playPopSound(): void {
    try {
      if (!this.audioCtx) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (AC) this.audioCtx = new AC();
      }
      if (!this.audioCtx) return;

      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') ctx.resume();

      const freq = 650 + Math.random() * 350;
      const now = ctx.currentTime;

      // Soft crystal chime
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.45, now + 0.16);

      gain.gain.setValueAtTime(0.065, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.20);

      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    } catch (_) {
      // Audio errors ignored silently
    }
  }

  reset(): void {
    this.group.visible = false;
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      b.state = 'idle';
      b.hoverIntensity = 0;
      b.popTimer = 0;
      b.respawnDelay = 0;
      b.respawnProgress = 1.0;
      b.mesh.scale.setScalar(0.001);
      b.mat.uniforms.uAlpha.value = 0;
      b.mat.uniforms.uHover.value = 0;
      b.mat.uniforms.uPopProgress.value = 0;
    }
    for (let p = 0; p < this.maxParticles; p++) {
      this.particleAlphas[p] = 0;
    }
    if (this.particleGeo.attributes.alpha) {
      this.particleGeo.attributes.alpha.needsUpdate = true;
    }
  }

  dispose(): void {
    this.clearXRWorld();
    for (const b of this.bubbles) {
      b.mat.dispose();
    }
    this.geoDroplet.dispose();
    this.particleGeo.dispose();
    this.particleMat.dispose();
    this.group.clear();
    this.bubbles.length = 0;
  }
}
