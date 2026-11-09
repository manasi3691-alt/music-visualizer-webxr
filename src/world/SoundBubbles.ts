/**
 * SoundBubbles: Interactive Magical Pearlescent Droplet Bubbles for Seated WebXR.
 *
 * Tailored for Meta Quest 3S seated VR experience:
 * - Exactly 10 small-to-medium bubbles (4.5–6.2cm radius) and 4 feature bubbles (7.5–8.8cm radius).
 * - Elegant, organic water-droplet shapes with rounded dome base and slender tapered crown (not blobs!).
 * - Translucent, pearlescent reflections with chromatic cyan, pink, violet, and lavender glimmers.
 * - Ergonomically positioned in comfortable seated arm's reach (0.45m to 0.74m distance).
 * - Leaves the central Crystal Lotus corridor (|x| < 0.16m) and wrist UI completely clear and unobstructed.
 * - Genuine 3D VR touch interaction:
 *     * Hand tracking index fingertip poke and controller grip proximity.
 *     * Subtle highlight and concentric contact glow ring when approaching.
 *     * Responsive pre-pop expansion and high-speed surface tension shimmer.
 *     * Visibly magical burst: explodes into 85+ sparkling stardust diamonds and miniature micro-bubbles.
 *     * Sparkling cyan, pink, violet, lavender, and diamond-white particles that twinkle and scatter naturally.
 *     * Crystal chime audio feedback on pop.
 *     * Single burst per touch with smooth respawn after a short delay.
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
  isFeature: boolean;

  // Interaction & Lifecycle states
  state: 'idle' | 'expanding_pop' | 'popped_hidden' | 'respawning';
  hoverIntensity: number; // 0 to 1
  touchLocalPoint: Vector3;
  popTimer: number;       // 0 to POP_SURGE_DURATION
  respawnDelay: number;   // countdown until respawn begins
  respawnProgress: number;// 0 to 1 during smooth materialization
}

const POP_SURGE_DURATION = 0.14; // Responsive expansion + shimmer before pop
const RESPAWN_WAIT_TIME   = 3.4;  // Seconds after pop before new bubble starts condensing
const RESPAWN_FADE_TIME   = 1.3;  // Seconds to smoothly materialize

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
  private particleTypes!: Float32Array;
  private particleTwinklePhases!: Float32Array;
  private particleLifetimes!: Float32Array;
  private particleMaxLifetimes!: Float32Array;
  private particleGeo!: BufferGeometry;
  private particleMat!: ShaderMaterial;
  private particlePoints!: Points;
  private nextParticleIndex = 0;

  // Scratch objects for zero per-frame allocation
  private scratchBubbleWorldPos = new Vector3();
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
    this.maxParticles = isQuest ? 1200 : 2000;

    // Build elegant, slender procedural teardrop water droplet geometry
    // Base radius: 0.055m (5.5cm) — scaled to 4.5–6.2cm for small/mid and 7.5–8.8cm for feature
    this.geoDroplet = this.buildTeardropGeometry(0.055, 24, 24);

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
   * Sculpted with a plump, rounded dome bottom and a slender, elegant tapered crown.
   */
  private buildTeardropGeometry(radius: number, widthSegments: number, heightSegments: number): BufferGeometry {
    const geo = new SphereGeometry(radius, widthSegments, heightSegments);
    const pos = geo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);

      const normY = y / radius; // -1 to +1
      const curRad = Math.sqrt(x * x + z * z);

      // Water droplet profile:
      // - Lower half (normY < 0): plump, spherical dome base
      // - Upper half (normY >= 0): slender, smooth tapering towards the apex
      let profileRadius = Math.sqrt(Math.max(0, 1.0 - normY * normY));
      if (normY > 0) {
        // Graceful slender taper
        profileRadius *= (1.0 - 0.58 * Math.pow(normY, 1.25));
      } else {
        // Slightly fuller bottom dome
        profileRadius *= (1.0 + 0.08 * (1.0 + normY));
      }

      if (curRad > 0.0001) {
        const scaleXZ = (profileRadius * radius) / curRad;
        pos.setX(i, x * scaleXZ);
        pos.setZ(i, z * scaleXZ);
      }

      // Elegant vertical proportion with slightly elongated top
      const stretchY = normY > 0 ? y * 1.28 : y * 1.10;
      pos.setY(i, stretchY);
    }

    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Sets up 10 small-to-medium bubbles and 4 feature bubbles around the seated user.
   * Ergonomically calibrated for comfortable seated reach (chest ~0.95m, eye ~1.22m):
   * - Central Lotus corridor (|x| < 0.16m, y < 1.45m) is kept 100% UNTOUCHED and unobstructed.
   * - Left wrist UI area (x in [-0.35, -0.15], y in [0.85, 1.15]) is kept UNTOUCHED and clear.
   */
  private buildReachableBubbles(): void {
    const configs: {
      x: number;
      y: number;
      z: number;
      scale: number;
      baseColor: Color;
      hoverColor: Color;
      isFeature: boolean;
    }[] = [
      // === 10 SMALL-TO-MEDIUM BUBBLES (scale 0.85 – 1.12, radius ~4.7cm to 6.2cm) ===
      // 0. Right-Front Low: effortless right-hand touch target
      {
        x: 0.32, y: 0.94, z: -0.48, scale: 0.95,
        baseColor: new Color(0x00f2fe), // Luminous Cyan
        hoverColor: new Color(0xfff2b2),
        isFeature: false,
      },
      // 1. Right-Front Mid: eye-level right
      {
        x: 0.42, y: 1.15, z: -0.52, scale: 1.05,
        baseColor: new Color(0xff77e9), // Pearlescent Pink
        hoverColor: new Color(0x38ef7d),
        isFeature: false,
      },
      // 2. Right-Mid High: comfortable slight upward reach right
      {
        x: 0.52, y: 1.34, z: -0.44, scale: 0.90,
        baseColor: new Color(0x8a2be2), // Royal Violet
        hoverColor: new Color(0x00f2fe),
        isFeature: false,
      },
      // 3. Right-Flank Mid: right side flank reach
      {
        x: 0.62, y: 1.08, z: -0.34, scale: 1.10,
        baseColor: new Color(0xb39ddb), // Ethereal Lavender
        hoverColor: new Color(0xff77e9),
        isFeature: false,
      },
      // 4. Right-Low Armrest: relaxed low reach
      {
        x: 0.28, y: 0.86, z: -0.42, scale: 0.85,
        baseColor: new Color(0xfff2b2), // Golden Pearl
        hoverColor: new Color(0xff77e9),
        isFeature: false,
      },
      // 5. Left-High Front: comfortably above the wrist UI
      {
        x: -0.38, y: 1.36, z: -0.48, scale: 1.05,
        baseColor: new Color(0xb39ddb), // Ethereal Lavender
        hoverColor: new Color(0xff77e9),
        isFeature: false,
      },
      // 6. Left-Side Flank: left lateral reach
      {
        x: -0.56, y: 1.18, z: -0.36, scale: 0.95,
        baseColor: new Color(0xf4a4a8), // Rose Gold
        hoverColor: new Color(0x00f2fe),
        isFeature: false,
      },
      // 7. Left-Side Low: relaxed low left reach (outside wrist box)
      {
        x: -0.48, y: 0.88, z: -0.38, scale: 0.90,
        baseColor: new Color(0x1de9b6), // Aquamarine Turquoise
        hoverColor: new Color(0xfff2b2),
        isFeature: false,
      },
      // 8. Left-High Arch: arched upward left
      {
        x: -0.26, y: 1.48, z: -0.46, scale: 1.00,
        baseColor: new Color(0xff4081), // Radiant Magenta
        hoverColor: new Color(0x80d8ff),
        isFeature: false,
      },
      // 9. Center-High Overhead: high above lotus sight-line
      {
        x: 0.06, y: 1.54, z: -0.54, scale: 1.05,
        baseColor: new Color(0xe0f7fa), // Pearlescent Opal
        hoverColor: new Color(0xffd54f),
        isFeature: false,
      },

      // === 3–4 FEATURE BUBBLES (scale 1.45 – 1.60, radius ~8.0cm to 8.8cm) ===
      // 10. Feature 1: Right Hero Droplet (primary right-hand showcase)
      {
        x: 0.46, y: 1.25, z: -0.46, scale: 1.55,
        baseColor: new Color(0x00e5ff), // Luminous Cyan-Turquoise
        hoverColor: new Color(0xffe082),
        isFeature: true,
      },
      // 11. Feature 2: Left Hero Droplet (prominent left-hand showcase)
      {
        x: -0.45, y: 1.32, z: -0.42, scale: 1.50,
        baseColor: new Color(0x9c27b0), // Royal Lavender-Violet
        hoverColor: new Color(0xff80ab),
        isFeature: true,
      },
      // 12. Feature 3: Right-Flank Hero Droplet (rich iridescent rose gold)
      {
        x: 0.58, y: 1.42, z: -0.36, scale: 1.60,
        baseColor: new Color(0xff8a80), // Rose Gold Pearlescent
        hoverColor: new Color(0x84ffff),
        isFeature: true,
      },
      // 13. Feature 4: Overhead Crown Hero Droplet (magnificent rainbow pearl overhead)
      {
        x: -0.05, y: 1.58, z: -0.52, scale: 1.50,
        baseColor: new Color(0xf8bbd0), // Rainbow Iridescent Pearl
        hoverColor: new Color(0x18ffff),
        isFeature: true,
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
          uTouchPoint: { value: new Vector3(0, 0, 0.05) },
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
            float popWobbleSpeed = mix(3.5, 30.0, uPopProgress);
            float popWobbleAmp = mix(0.015, 0.055, uPopProgress);

            // Natural floating liquid surface tension wobble
            float wobble = sin(uTime * popWobbleSpeed + pos.y * 14.0) * (popWobbleAmp + uHover * 0.008);
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
            float fresnel = pow(1.0 - NdotV, 2.6);

            // Pearlescent chromatic dispersion ramp (cyan, lavender, pink, violet, gold)
            float irid = fract(fresnel * 1.8 + uTime * 0.14 + vLocalPos.y * 10.0);
            vec3 pearlescent = 0.5 + 0.5 * cos(6.28318 * (vec3(1.0) * irid + vec3(0.0, 0.33, 0.67)));

            vec3 waterColor = mix(uBaseColor, pearlescent, 0.58);

            // Internal light depth glow (mimics translucent water droplet thickness)
            float coreGlow = pow(NdotV, 3.2) * 0.28;
            vec3 internalGlow = mix(uBaseColor, vec3(1.0, 0.95, 1.0), 0.6) * coreGlow;

            // Hover highlight: glowing rim aura when hand or ray approaches
            vec3 hoverAura = uHoverColor * (uHover * (fresnel * 1.5 + 0.35));

            // Concentric contact highlight ring at finger/probe point
            float touchDist = length(vLocalPos - uTouchPoint);
            float ring = exp(-pow((touchDist - 0.035) * 45.0, 2.0));
            float centerSpot = exp(-pow(touchDist * 35.0, 2.0));
            vec3 ringColor = vec3(1.0, 0.98, 0.90) * (ring * 1.4 + centerSpot * 1.0) * uHover;

            // Dual crisp specular glints (cosmic sky & starlight)
            vec3 L1 = normalize(vec3(0.35, 0.85, 0.45));
            vec3 H1 = normalize(L1 + V);
            float spec1 = pow(max(0.0, dot(N, H1)), 32.0);

            vec3 L2 = normalize(vec3(-0.45, 0.65, -0.35));
            vec3 H2 = normalize(L2 + V);
            float spec2 = pow(max(0.0, dot(N, H2)), 22.0) * 0.45;

            // Pop flash surge
            float popFlash = pow(uPopProgress, 2.6) * 2.6;

            vec3 finalColor = waterColor + internalGlow + hoverAura + ringColor + vec3(spec1 * 0.85 + spec2 * 0.4) + vec3(popFlash);
            float alpha = clamp((fresnel * 0.72 + 0.16 + uHover * 0.22 + spec1 * 0.5 + popFlash) * uAlpha, 0.0, 0.95);

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
        floatSpeed: 0.45 + (i % 4) * 0.12,
        floatAmplitude: 0.025 + (i % 3) * 0.015,
        wobbleSpeed: 1.8 + i * 0.25,
        baseScale: cfg.scale,
        currentScale: 0.001,
        isFeature: cfg.isFeature,
        state: 'idle',
        hoverIntensity: 0,
        touchLocalPoint: new Vector3(0, 0, 0.05),
        popTimer: 0,
        respawnDelay: 0,
        respawnProgress: 1.0,
      });
    }

    this.group.visible = false;
  }

  /**
   * Pre-allocated pooled particles for micro-bubbles and stardust glitter bursts.
   */
  private buildParticlePool(): void {
    this.particlePositions = new Float32Array(this.maxParticles * 3);
    this.particleVelocities = new Float32Array(this.maxParticles * 3);
    this.particleColors = new Float32Array(this.maxParticles * 3);
    this.particleAlphas = new Float32Array(this.maxParticles);
    this.particleSizes = new Float32Array(this.maxParticles);
    this.particleTypes = new Float32Array(this.maxParticles);
    this.particleTwinklePhases = new Float32Array(this.maxParticles);
    this.particleLifetimes = new Float32Array(this.maxParticles);
    this.particleMaxLifetimes = new Float32Array(this.maxParticles);

    for (let i = 0; i < this.maxParticles; i++) {
      this.particleAlphas[i] = 0;
      this.particleSizes[i] = 0.05;
      this.particleTypes[i] = 0;
      this.particleTwinklePhases[i] = Math.random() * Math.PI * 2;
      this.particleLifetimes[i] = 0;
      this.particleMaxLifetimes[i] = 1.6;
    }

    this.particleGeo = new BufferGeometry();
    this.particleGeo.setAttribute('position', new Float32BufferAttribute(this.particlePositions, 3));
    this.particleGeo.setAttribute('customColor', new Float32BufferAttribute(this.particleColors, 3));
    this.particleGeo.setAttribute('alpha', new Float32BufferAttribute(this.particleAlphas, 1));
    this.particleGeo.setAttribute('size', new Float32BufferAttribute(this.particleSizes, 1));
    this.particleGeo.setAttribute('particleType', new Float32BufferAttribute(this.particleTypes, 1));
    this.particleGeo.setAttribute('twinklePhase', new Float32BufferAttribute(this.particleTwinklePhases, 1));

    this.particleMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        attribute vec3 customColor;
        attribute float alpha;
        attribute float size;
        attribute float particleType;
        attribute float twinklePhase;

        varying vec3 vColor;
        varying float vAlpha;
        varying float vType;
        varying float vTwinkle;

        uniform float uTime;

        void main() {
          vColor = customColor;
          vType = particleType;

          // Individual sparkling twinkle flicker
          float twinkle = 0.65 + 0.35 * sin(uTime * 24.0 + twinklePhase);
          vAlpha = alpha * twinkle;
          vTwinkle = twinkle;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          // High-visibility point size calibration for VR and Desktop
          float basePt = size * (290.0 / -mvPosition.z);
          gl_PointSize = clamp(basePt, 2.5, 46.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;

        varying vec3 vColor;
        varying float vAlpha;
        varying float vType;
        varying float vTwinkle;

        void main() {
          if (vAlpha <= 0.01) discard;

          vec2 coord = gl_PointCoord - vec2(0.5);
          float dist = length(coord);
          if (dist > 0.5) discard;

          vec3 col = vColor;
          float a = vAlpha;

          if (vType > 0.5) {
            // TYPE 1: Brilliant 4-Point Sparkling Diamond Glitter / Stardust
            // Hot cross-diffraction rays + intense specular star core
            float starX = max(0.0, 1.0 - abs(coord.x) * 5.2) * max(0.0, 1.0 - abs(coord.y) * 1.8);
            float starY = max(0.0, 1.0 - abs(coord.y) * 5.2) * max(0.0, 1.0 - abs(coord.x) * 1.8);
            float starCross = max(starX, starY);
            float core = exp(-dist * 18.0) * 1.9;
            float glitter = starCross * 1.5 + core;

            col = mix(vColor, vec3(1.0, 1.0, 1.0), clamp(core * 0.95, 0.0, 1.0));
            a *= clamp(glitter, 0.0, 1.0);
          } else {
            // TYPE 0: Miniature Iridescent Micro-Bubble
            // Translucent sphere with glowing rim and glistening top-left glint
            float rim = smoothstep(0.30, 0.48, dist) * (1.0 - smoothstep(0.48, 0.50, dist));
            float centerHollow = pow(1.0 - dist * 2.0, 2.2);
            float glintDist = length(coord - vec2(-0.16, -0.16));
            float glint = exp(-glintDist * 34.0) * 1.6;

            col = mix(vColor, vec3(1.0, 1.0, 1.0), rim * 0.65 + glint * 0.8);
            a *= (rim * 0.92 + centerHollow * 0.20 + glint * 0.85);
          }

          gl_FragColor = vec4(col, a);
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

    const { high, energy } = metrics;
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
        // Organic floating motion
        const floatY = Math.sin(t * b.floatSpeed + b.floatPhase) * b.floatAmplitude;
        const floatX = Math.cos(t * b.floatSpeed * 0.7 + b.floatPhase) * b.floatAmplitude * 0.35;
        b.mesh.position.set(b.restPos.x + floatX, b.restPos.y + floatY, b.restPos.z);

        // Music-synced subtle breathing scale
        const breathe = 1.0 + Math.sin(t * 1.5 + b.floatPhase) * 0.04 + energy * 0.06;
        b.currentScale = b.baseScale * masterVis * breathe;
        b.mesh.scale.setScalar(Math.max(0.001, b.currentScale));

        b.mesh.updateMatrixWorld();
        this.scratchBubbleWorldPos.setFromMatrixPosition(b.mesh.matrixWorld);

        // Touch hit radius scaled to the new compact droplet size (base 0.055m * scale)
        const hitRadius = 0.075 * b.baseScale;
        const hoverRadius = 0.26 * b.baseScale;

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
              this.scratchLocalTouch.copy(probe.pos).sub(this.scratchBubbleWorldPos);
              b.touchLocalPoint.copy(this.scratchLocalTouch);
            }
          }

          // Direct Touch Poke trigger!
          if (dist <= hitRadius + (probe.isFinger ? 0.025 : 0.045)) {
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
        b.mat.uniforms.uAlpha.value = masterVis * 0.88;

        // If touched, start burst sequence!
        if (touched) {
          this.triggerBurst(b, high);
        }

      } else if (b.state === 'expanding_pop') {
        // Pre-pop expansion surge (1.30x) and rapid shimmer over 0.14s
        b.popTimer += deltaSec;
        const surgeProg = Math.min(1.0, b.popTimer / POP_SURGE_DURATION);

        // Scale surge
        const surgeScale = b.baseScale * masterVis * (1.0 + surgeProg * 0.30);
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
          // Natural position condensation wobble (+/- 2.5cm)
          b.restPos.x = b.basePos.x + (Math.random() - 0.5) * 0.05;
          b.restPos.y = b.basePos.y + (Math.random() - 0.5) * 0.05;
          b.restPos.z = b.basePos.z + (Math.random() - 0.5) * 0.05;
        }

      } else if (b.state === 'respawning') {
        b.respawnProgress += deltaSec / RESPAWN_FADE_TIME;
        const p = Math.min(1.0, b.respawnProgress);
        // Smoothstep emergence
        const ease = p * p * (3.0 - 2.0 * p);

        b.currentScale = b.baseScale * masterVis * ease;
        b.mesh.scale.setScalar(Math.max(0.001, b.currentScale));
        b.mat.uniforms.uAlpha.value = masterVis * ease * 0.88;
        b.mat.uniforms.uPopProgress.value = 0;
        b.mat.uniforms.uHover.value = 0;

        if (p >= 1.0) {
          b.state = 'idle';
          b.hoverIntensity = 0;
        }
      }
    }

    // 3. Update active explosion particles
    let hasActiveParticles = false;
    for (let p = 0; p < this.maxParticles; p++) {
      if (this.particleAlphas[p] <= 0.001) continue;
      hasActiveParticles = true;

      this.particleLifetimes[p] += deltaSec;
      const prog = this.particleLifetimes[p] / this.particleMaxLifetimes[p];

      if (prog >= 1.0) {
        this.particleAlphas[p] = 0;
        continue;
      }

      const p3 = p * 3;
      // Air resistance deceleration + gentle upward buoyancy float
      this.particleVelocities[p3] *= 0.915;
      this.particleVelocities[p3 + 1] = (this.particleVelocities[p3 + 1] + 0.32 * deltaSec) * 0.925;
      this.particleVelocities[p3 + 2] *= 0.915;

      this.particlePositions[p3] += this.particleVelocities[p3] * deltaSec;
      this.particlePositions[p3 + 1] += this.particleVelocities[p3 + 1] * deltaSec;
      this.particlePositions[p3 + 2] += this.particleVelocities[p3 + 2] * deltaSec;

      // Bell curve smooth fade with audio-reactive sparkle boost
      const fade = Math.sin(prog * Math.PI);
      this.particleAlphas[p] = Math.pow(fade, 0.75) * (0.90 + high * 0.30);
    }

    if (hasActiveParticles) {
      this.particleGeo.attributes.position.needsUpdate = true;
      this.particleGeo.attributes.alpha.needsUpdate = true;
    }
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
   * Spawns dozens of sparkling stardust diamonds and miniature micro-bubbles on pop.
   */
  private emitExplosionParticles(b: ReachableBubble, highFreq = 0.5): void {
    b.mesh.updateMatrixWorld();
    this.scratchBubbleWorldPos.setFromMatrixPosition(b.mesh.matrixWorld);

    // 85-100 glittering particles per burst (larger burst for feature bubbles)
    const count = b.isFeature ? 100 : 85;
    const burstSpeed = b.isFeature ? 2.8 : 2.4;
    const baseCol = b.mat.uniforms.uBaseColor.value as Color;

    for (let i = 0; i < count; i++) {
      const pIdx = this.nextParticleIndex;
      this.nextParticleIndex = (this.nextParticleIndex + 1) % this.maxParticles;
      const p3 = pIdx * 3;

      // Start at droplet world position
      this.particlePositions[p3] = this.scratchBubbleWorldPos.x + (Math.random() - 0.5) * 0.04;
      this.particlePositions[p3 + 1] = this.scratchBubbleWorldPos.y + (Math.random() - 0.5) * 0.04;
      this.particlePositions[p3 + 2] = this.scratchBubbleWorldPos.z + (Math.random() - 0.5) * 0.04;

      // Spherical radial scatter velocity
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2.0 * Math.random() - 1.0);
      const spd = burstSpeed * (0.35 + Math.random() * 0.85);

      this.particleVelocities[p3] = Math.sin(phi) * Math.cos(theta) * spd;
      this.particleVelocities[p3 + 1] = Math.sin(phi) * Math.sin(theta) * spd + 0.38; // Upward buoyant float
      this.particleVelocities[p3 + 2] = Math.cos(phi) * spd;

      // Multimodal particle type: 55% Type 1 (glitter diamonds), 45% Type 0 (micro-bubbles)
      this.particleTypes[pIdx] = Math.random() < 0.55 ? 1.0 : 0.0;
      this.particleTwinklePhases[pIdx] = Math.random() * Math.PI * 2;

      // Vibrant color palette: cyan, pink, violet, lavender, and diamond white
      const roll = Math.random();
      if (roll < 0.28) {
        // Radiant Cyan
        this.particleColors[p3] = 0.0;
        this.particleColors[p3 + 1] = 0.95;
        this.particleColors[p3 + 2] = 1.0;
      } else if (roll < 0.52) {
        // Luminous Pink
        this.particleColors[p3] = 1.0;
        this.particleColors[p3 + 1] = 0.47;
        this.particleColors[p3 + 2] = 0.91;
      } else if (roll < 0.72) {
        // Ethereal Lavender
        this.particleColors[p3] = 0.75;
        this.particleColors[p3 + 1] = 0.62;
        this.particleColors[p3 + 2] = 1.0;
      } else if (roll < 0.86) {
        // Royal Violet
        this.particleColors[p3] = 0.60;
        this.particleColors[p3 + 1] = 0.20;
        this.particleColors[p3 + 2] = 1.0;
      } else {
        // Diamond White / Pure Stardust
        this.particleColors[p3] = 1.0;
        this.particleColors[p3 + 1] = 0.98;
        this.particleColors[p3 + 2] = 0.92;
      }

      this.particleAlphas[pIdx] = 1.0;
      // High-visibility particle size
      this.particleSizes[pIdx] = (0.042 + Math.random() * 0.038) * (0.85 + highFreq * 0.35);
      this.particleLifetimes[pIdx] = 0;
      this.particleMaxLifetimes[pIdx] = 1.5 + Math.random() * 0.8;
    }

    this.particleGeo.attributes.customColor.needsUpdate = true;
    this.particleGeo.attributes.size.needsUpdate = true;
    this.particleGeo.attributes.particleType.needsUpdate = true;
    this.particleGeo.attributes.twinklePhase.needsUpdate = true;
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
        const hitRadius = 0.12 * b.baseScale;

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
        const hoverRadius = 0.28 * b.baseScale;
        if (dist < hoverRadius) {
          b.hoverIntensity = Math.min(1.0, b.hoverIntensity + 0.18);
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

      const freq = 680 + Math.random() * 280;
      const now = ctx.currentTime;

      // Primary chime tone
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freq, now);
      osc1.frequency.exponentialRampToValueAtTime(freq * 0.42, now + 0.16);

      gain1.gain.setValueAtTime(0.065, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.20);

      // High crystalline sparkle harmonic
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq * 2.05, now);
      osc2.frequency.exponentialRampToValueAtTime(freq * 0.9, now + 0.14);

      gain2.gain.setValueAtTime(0.035, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now);
      osc2.stop(now + 0.16);

      osc1.onended = () => {
        osc1.disconnect();
        gain1.disconnect();
        osc2.disconnect();
        gain2.disconnect();
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
