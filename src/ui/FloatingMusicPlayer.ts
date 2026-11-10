/**
 * FloatingMusicPlayer: One Sculptural 3D Holographic Music Control Interface.
 *
 * Design:
 *  - Not a flat panel or dark disc: built from layered translucent curved crystal glass,
 *    swept metallic silver filigree rails, glowing cyan/teal holographic edge tubes,
 *    sculptural side fins, counter-precessing 3D gimbal rings, and dimensional lighting.
 *  - Controls arranged cleanly around the central Hero Play/Pause core:
 *      * Play / Pause (center hero crystal core)
 *      * Start / Restart Track (upper-left wing)
 *      * Rewind 10s (mid-left)
 *      * Forward 10s (mid-right)
 *      * Skip to End (upper-right wing)
 *      * Volume Control (lower-left: cycles 100% -> 75% -> 50% -> 25% -> 0% with 4-bar gauge)
 *      * Close (X) (lower-right)
 *      * Bottom ergonomic Reposition Grip
 *  - Top curved 3D holographic progress ribbon with orbiting crystal bead & time telemetry.
 *  - Genuine hover/target glow feedback for Quest 3S hand tracking, both controllers, and mouse.
 *  - Zero per-frame heap allocations; optimized for 72-90 fps on Meta Quest 3S.
 */

import {
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  MeshBasicMaterial,
  ShaderMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Shape,
  ExtrudeGeometry,
  CircleGeometry,
  RingGeometry,
  TorusGeometry,
  TubeGeometry,
  OctahedronGeometry,
  PlaneGeometry,
  CatmullRomCurve3,
  CanvasTexture,
  Color,
  Vector3,
  PointLight,
  DoubleSide,
  AdditiveBlending,
} from '@iwsdk/core';
import { HOLOGRAPHIC_UI_DIMENSIONS, MUSIC_UI_PALETTE } from './WristUIStyles.js';

export type FloatingControlId =
  | 'playPause'
  | 'restart'
  | 'rewind'
  | 'forward'
  | 'skipToEnd'
  | 'volume'
  | 'close'
  | 'handle';

export interface FloatingButton {
  id: FloatingControlId;
  podGroup: Group;
  hitMesh: Mesh;
  faceMesh: Mesh;
  collarMesh: Mesh;
  haloMesh: Mesh;
  collarMat: MeshStandardMaterial;
  haloMat: MeshBasicMaterial;
  capMat: MeshPhysicalMaterial;
  baseZ: number;
  currentZ: number;
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  depressed: boolean;
  hoverAmount: number;
  isTargeted: boolean;
  baseColorHex: number;
}

export class FloatingMusicPlayer {
  readonly group: Group = new Group();
  private panelContainer: Group = new Group();

  private isOpen = true;
  private targetOpen = true;
  private transitionProgress = 1.0;

  // Disposables for clean teardown
  private disposables: { dispose: () => void }[] = [];

  // Glass shader uniforms (updated smoothly each frame without allocations)
  private glassUniforms: {
    uTime: { value: number };
    uPulse: { value: number };
    uOpacityScale: { value: number };
  }[] = [];

  // Precessing 3D gimbal rings & nodes around center core
  private silverGimbalRing!: Mesh;
  private cyanGimbalRing!: Mesh;
  private crystalNodes: Mesh[] = [];
  private localLight!: PointLight;

  // Progress ribbon + orbiting crystal bead + telemetry pill
  private progressCanvas!: HTMLCanvasElement;
  private progressTexture!: CanvasTexture;
  private progressBead!: Mesh;
  private telemetryCanvas!: HTMLCanvasElement;
  private telemetryTexture!: CanvasTexture;
  private lastProgressPct = -1;
  private lastTimeStr = '';
  private lastStatusText = '';

  // Drag / Reposition handle
  readonly handleMesh: Mesh;
  private defaultPos = new Vector3(
    HOLOGRAPHIC_UI_DIMENSIONS.defaultOffsetRight,
    HOLOGRAPHIC_UI_DIMENSIONS.defaultHeight,
    -HOLOGRAPHIC_UI_DIMENSIONS.defaultDistance
  );

  // Interactive control pods
  private buttons: Map<FloatingControlId, FloatingButton> = new Map();
  private playPauseButton!: FloatingButton;
  private volumeButton!: FloatingButton;
  private lastIsPlaying: boolean | null = null;
  private lastVolume = 1.0;

  // Animated state
  private elapsedTime = 0;

  // Scratch vectors (zero per-frame heap allocations)
  private scratchPos = new Vector3();
  private scratchLook = new Vector3();

  constructor() {
    this.group.name = 'HolographicMusicUI_Root';
    this.group.add(this.panelContainer);

    this.group.position.copy(this.defaultPos);
    this.group.rotation.set(-0.08, -0.22, 0);

    // 1. Dimensional local holographic light
    this.localLight = new PointLight(0x38f2ff, 0.85, 0.65, 2.0);
    this.localLight.position.set(0, 0.02, 0.12);
    this.panelContainer.add(this.localLight);

    // 2. Sculptural curved layered glass architecture + silver filigree
    this.buildSculpturalGlassLayers();

    // 3. Curved 3D holographic progress arch, bead & telemetry pill
    this.buildCurvedProgressRibbon();
    this.buildTelemetryPill();

    // 4. Seven floating 3D crystal control pods + bottom drag handle
    this.buildControlPods();
    this.handleMesh = this.buildDragHandle();
  }

  get visible(): boolean {
    return this.group.visible && this.isOpen;
  }

  get position(): Vector3 {
    return this.group.position;
  }

  // ─── Parametric Cockpit Curvature Helper ───────────────────────────────────

  private cockpitZOffset(x: number, y: number, curveRadius = HOLOGRAPHIC_UI_DIMENSIONS.curveRadius): number {
    const r2 = curveRadius * curveRadius;
    const xClamped = Math.min(Math.abs(x), curveRadius * 0.9);
    const zHoriz = curveRadius - Math.sqrt(Math.max(0.001, r2 - xClamped * xClamped));
    const zVert = 0.045 * (y * y);
    return zHoriz + zVert;
  }

  private canopyHalfHeightAtU(u: number): number {
    const absU = Math.abs(u);
    const halfH = HOLOGRAPHIC_UI_DIMENSIONS.height * 0.5;
    // Sculptural winged taper: fuller arched center, sleek tapered wings
    return halfH * (1.0 - 0.36 * Math.pow(absU, 1.35));
  }

  // ─── Layer 0 & 1: Layered Curved Translucent Glass & Silver Architecture ───

  private buildSculpturalGlassLayers(): void {
    const W = HOLOGRAPHIC_UI_DIMENSIONS.width;
    const H = HOLOGRAPHIC_UI_DIMENSIONS.height;
    const R = HOLOGRAPHIC_UI_DIMENSIONS.curveRadius;

    // Layer 0: Outer curved translucent crystal canopy (6 mm beveled thickness)
    const canopyGeo = this.createCurvedWingedGlassGeometry(W, H, 0.006, R, 28, 12);
    this.disposables.push(canopyGeo);

    const canopyMat = this.createCrystalGlassMaterial(
      new Color(0x0c425c),
      new Color(MUSIC_UI_PALETTE.borderCyan),
      0.13, // ultra-sheer center so stars/lotus/ocean remain visible
      0.78  // bright cyan-aqua curved Fresnel edge
    );
    this.disposables.push(canopyMat);

    const canopyMesh = new Mesh(canopyGeo, canopyMat);
    canopyMesh.name = 'HoloUI_OuterCrystalCanopy';
    canopyMesh.position.set(0, 0, -0.014);
    canopyMesh.renderOrder = 10;
    this.panelContainer.add(canopyMesh);

    // Layer 1: Secondary mid floating glass bridge (creates 1.3 cm 3D parallax depth)
    const bridgeGeo = this.createCurvedWingedGlassGeometry(W * 0.62, H * 0.66, 0.004, R * 0.94, 20, 10);
    this.disposables.push(bridgeGeo);

    const bridgeMat = this.createCrystalGlassMaterial(
      new Color(0x115874),
      new Color(MUSIC_UI_PALETTE.borderTeal),
      0.16,
      0.70
    );
    this.disposables.push(bridgeMat);

    const bridgeMesh = new Mesh(bridgeGeo, bridgeMat);
    bridgeMesh.name = 'HoloUI_InnerGlassBridge';
    bridgeMesh.position.set(0, -0.002, -0.001);
    bridgeMesh.renderOrder = 11;
    this.panelContainer.add(bridgeMesh);

    // Swept Top & Bottom 3D Silver Metallic Rails + Cyan Edge Filaments
    const silverMat = new MeshStandardMaterial({
      color: new Color(MUSIC_UI_PALETTE.silverMetallic),
      metalness: 0.92,
      roughness: 0.16,
      emissive: new Color(0x183d52),
      emissiveIntensity: 0.35,
    });
    this.disposables.push(silverMat);

    const cyanGlowMat = new MeshBasicMaterial({
      color: new Color(MUSIC_UI_PALETTE.borderCyan),
      transparent: true,
      opacity: 0.85,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(cyanGlowMat);

    const tealGlowMat = new MeshBasicMaterial({
      color: new Color(MUSIC_UI_PALETTE.borderTeal),
      transparent: true,
      opacity: 0.65,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(tealGlowMat);

    for (const signY of [1, -1]) {
      const silverPoints: Vector3[] = [];
      const glowPoints: Vector3[] = [];
      const steps = 28;

      for (let i = 0; i <= steps; i++) {
        const u = (i / steps) * 2 - 1;
        const x = u * (W * 0.505);
        const halfH = this.canopyHalfHeightAtU(u);
        const crestOffset = 0.007 * (1.0 - u * u);
        const y = signY * halfH + crestOffset;
        const zBase = this.cockpitZOffset(x, y, R) - 0.011;
        silverPoints.push(new Vector3(x, y, zBase + 0.002));
        glowPoints.push(new Vector3(x, y, zBase - 0.001));
      }

      const silverCurve = new CatmullRomCurve3(silverPoints);
      const silverTubeGeo = new TubeGeometry(silverCurve, 36, 0.0015, 8, false);
      this.disposables.push(silverTubeGeo);
      const silverRail = new Mesh(silverTubeGeo, silverMat);
      this.panelContainer.add(silverRail);

      const glowCurve = new CatmullRomCurve3(glowPoints);
      const glowTubeGeo = new TubeGeometry(glowCurve, 36, 0.0021, 8, false);
      this.disposables.push(glowTubeGeo);
      const glowRail = new Mesh(glowTubeGeo, signY > 0 ? cyanGlowMat : tealGlowMat);
      this.panelContainer.add(glowRail);
    }

    // Left & Right Sculpted Curved Side-Wing Fins
    for (const side of [-1, 1]) {
      const wingPoints: Vector3[] = [];
      const finSteps = 12;
      for (let i = 0; i <= finSteps; i++) {
        const t = i / finSteps; // 0 bottom -> 1 top
        const v = t * 2 - 1;
        const x = side * (W * 0.515 + 0.010 * (1.0 - v * v));
        const y = v * (H * 0.34);
        const z = this.cockpitZOffset(x, y, R) - 0.006 + 0.008 * (1.0 - v * v);
        wingPoints.push(new Vector3(x, y, z));
      }
      const wingCurve = new CatmullRomCurve3(wingPoints);
      const wingSilverGeo = new TubeGeometry(wingCurve, 18, 0.0016, 8, false);
      this.disposables.push(wingSilverGeo);
      const wingSilver = new Mesh(wingSilverGeo, silverMat);
      this.panelContainer.add(wingSilver);

      const wingGlowGeo = new TubeGeometry(wingCurve, 18, 0.0026, 8, false);
      this.disposables.push(wingGlowGeo);
      const wingGlow = new Mesh(wingGlowGeo, cyanGlowMat);
      this.panelContainer.add(wingGlow);

      // Decorative curved glass side vane
      const vaneShape = new Shape();
      vaneShape.moveTo(0, -0.044);
      vaneShape.quadraticCurveTo(side * 0.016, 0, 0, 0.044);
      vaneShape.quadraticCurveTo(side * 0.006, 0, 0, -0.044);
      const vaneGeo = new ExtrudeGeometry(vaneShape, {
        depth: 0.003,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: 0.0005,
        bevelThickness: 0.0005,
        curveSegments: 14,
      });
      vaneGeo.center();
      this.disposables.push(vaneGeo);

      const vaneMat = this.createCrystalGlassMaterial(
        new Color(0x115874),
        new Color(MUSIC_UI_PALETTE.borderCyan),
        0.22,
        0.82
      );
      this.disposables.push(vaneMat);
      const vaneMesh = new Mesh(vaneGeo, vaneMat);
      const edgeX = side * (W * 0.525);
      vaneMesh.position.set(edgeX, 0.002, this.cockpitZOffset(edgeX, 0, R) - 0.004);
      vaneMesh.rotation.y = -side * 0.48;
      vaneMesh.renderOrder = 12;
      this.panelContainer.add(vaneMesh);
    }

    // Four Floating Silver-Cyan Crystal Prism Nodes at inflection corners
    const nodeGeo = new OctahedronGeometry(0.0055, 0);
    nodeGeo.scale(0.85, 1.45, 0.85);
    this.disposables.push(nodeGeo);

    const nodeMat = new MeshPhysicalMaterial({
      color: new Color(0x88f7ff),
      metalness: 0.35,
      roughness: 0.1,
      transparent: true,
      opacity: 0.88,
      emissive: new Color(MUSIC_UI_PALETTE.borderCyan),
      emissiveIntensity: 0.45,
      clearcoat: 1.0,
    });
    this.disposables.push(nodeMat);

    const nodeCoords: [number, number][] = [
      [-0.125, 0.068],
      [0.125, 0.068],
      [-0.125, -0.066],
      [0.125, -0.066],
    ];
    for (const [nx, ny] of nodeCoords) {
      const node = new Mesh(nodeGeo, nodeMat);
      node.position.set(nx, ny, this.cockpitZOffset(nx, ny, R) + 0.008);
      this.panelContainer.add(node);
      this.crystalNodes.push(node);
    }

    // Central 3D Precessing Silver & Cyan Gimbal Rings around Play/Pause Hero Core
    const silverGimbalGeo = new TorusGeometry(0.043, 0.0012, 10, 48);
    this.disposables.push(silverGimbalGeo);
    this.silverGimbalRing = new Mesh(silverGimbalGeo, silverMat);
    this.silverGimbalRing.position.set(0, -0.002, 0.022);
    this.silverGimbalRing.rotation.set(0.24, -0.18, 0);
    this.panelContainer.add(this.silverGimbalRing);

    const cyanGimbalGeo = new TorusGeometry(0.049, 0.0015, 10, 48);
    this.disposables.push(cyanGimbalGeo);
    this.cyanGimbalRing = new Mesh(cyanGimbalGeo, cyanGlowMat);
    this.cyanGimbalRing.position.set(0, -0.002, 0.020);
    this.cyanGimbalRing.rotation.set(-0.20, 0.25, 0);
    this.panelContainer.add(this.cyanGimbalRing);
  }

  private createCurvedWingedGlassGeometry(
    width: number,
    height: number,
    thickness: number,
    curveRadius: number,
    nx: number,
    ny: number
  ): BufferGeometry {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const halfW = width * 0.5;
    const halfD = thickness * 0.5;
    const cols = nx + 1;
    const rows = ny + 1;
    const vertPerFace = cols * rows;

    // Generate front (+halfD) and back (-halfD) curved grid vertices
    for (let face = 0; face < 2; face++) {
      const zSign = face === 0 ? 1 : -1;
      for (let j = 0; j < rows; j++) {
        const vNorm = (j / ny) * 2 - 1; // -1..+1
        for (let i = 0; i < cols; i++) {
          const uNorm = (i / nx) * 2 - 1; // -1..+1
          const x = uNorm * halfW;
          // Slight vertical corner chamfer near wing tips
          const profileH = (height * 0.5) * (1.0 - 0.36 * Math.pow(Math.abs(uNorm), 1.35));
          const crestOffset = 0.007 * (1.0 - uNorm * uNorm);
          const y = vNorm * profileH + crestOffset;
          const z = this.cockpitZOffset(x, y, curveRadius) + zSign * halfD;

          positions.push(x, y, z);
          uvs.push(i / nx, j / ny);
        }
      }
    }

    // Front face triangles (CCW toward +Z)
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }

    // Back face triangles (CCW toward -Z)
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = vertPerFace + j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, d, b, a, c, d);
      }
    }

    // Perimeter side bevel walls for solid 3D glass thickness
    const addEdgeStrip = (getIdx: (k: number) => number, count: number, flip: boolean) => {
      for (let k = 0; k < count - 1; k++) {
        const f0 = getIdx(k);
        const f1 = getIdx(k + 1);
        const b0 = vertPerFace + f0;
        const b1 = vertPerFace + f1;
        if (flip) {
          indices.push(f0, b0, b1, f0, b1, f1);
        } else {
          indices.push(f0, b1, b0, f0, f1, b1);
        }
      }
    };

    // Bottom edge (j = 0)
    addEdgeStrip((i) => i, cols, false);
    // Top edge (j = ny)
    addEdgeStrip((i) => ny * cols + i, cols, true);
    // Left edge (i = 0)
    addEdgeStrip((j) => j * cols, rows, true);
    // Right edge (i = nx)
    addEdgeStrip((j) => j * cols + nx, rows, false);

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  private createCrystalGlassMaterial(
    baseColor: Color,
    rimColor: Color,
    centerAlpha: number,
    edgeAlpha: number
  ): ShaderMaterial {
    const uniforms = {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uOpacityScale: { value: 1.0 },
      uBaseColor: { value: baseColor },
      uRimColor: { value: rimColor },
      uCenterAlpha: { value: centerAlpha },
      uEdgeAlpha: { value: edgeAlpha },
    };
    this.glassUniforms.push(uniforms);

    return new ShaderMaterial({
      uniforms,
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uPulse;
        uniform float uOpacityScale;
        uniform vec3 uBaseColor;
        uniform vec3 uRimColor;
        uniform float uCenterAlpha;
        uniform float uEdgeAlpha;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec2 vUv;

        void main() {
          vec3 N = normalize(vNormal);
          vec3 V = normalize(vViewDir);
          float ndotv = abs(dot(N, V));
          float fresnel = pow(clamp(1.0 - ndotv, 0.0, 1.0), 2.1);

          // Dimensional glass specular highlights from dual angles
          float spec1 = pow(max(0.0, dot(N, normalize(vec3(0.35, 0.55, 0.76)))), 14.0) * 0.42;
          float spec2 = pow(max(0.0, dot(N, normalize(vec3(-0.45, -0.25, 0.85)))), 18.0) * 0.24;

          // Subtle holographic harmonic lines
          float scan = (sin(vUv.y * 44.0 - uTime * 1.4) * 0.5 + 0.5) * 0.05;

          vec3 col = mix(uBaseColor, uRimColor, clamp(fresnel * 0.88 + 0.10, 0.0, 1.0));
          col += vec3(0.86, 0.96, 1.0) * (spec1 + spec2);
          col += uRimColor * (scan + uPulse * 0.14);

          float alpha = mix(uCenterAlpha, uEdgeAlpha, fresnel) + spec1 * 0.35 + spec2 * 0.25 + scan;
          gl_FragColor = vec4(col, clamp(alpha * uOpacityScale, 0.0, 0.92));
        }
      `,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
  }

  // ─── Curved 3D Progress Ribbon & Telemetry Readout ─────────────────────────

  private buildCurvedProgressRibbon(): void {
    const segs = 32;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const R = HOLOGRAPHIC_UI_DIMENSIONS.curveRadius;

    for (let j = 0; j < 2; j++) {
      const stripV = j === 0 ? -1 : 1;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs; // 0..1 left to right
        const angle = (t - 0.5) * (Math.PI * 0.54);
        const x = Math.sin(angle) * 0.145;
        const archY = 0.075 + Math.cos(angle) * 0.015 + stripV * 0.008;
        const z = this.cockpitZOffset(x, archY, R) + 0.012;
        positions.push(x, archY, z);
        uvs.push(t, j);
      }
    }

    for (let i = 0; i < segs; i++) {
      const a = i;
      const b = i + 1;
      const c = segs + 1 + i;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }

    const ribbonGeo = new BufferGeometry();
    ribbonGeo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    ribbonGeo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    ribbonGeo.setIndex(indices);
    ribbonGeo.computeVertexNormals();
    this.disposables.push(ribbonGeo);

    this.progressCanvas = document.createElement('canvas');
    this.progressCanvas.width = 512;
    this.progressCanvas.height = 64;
    this.redrawProgressRibbon(0);

    this.progressTexture = new CanvasTexture(this.progressCanvas);
    this.progressTexture.generateMipmaps = true;
    this.disposables.push(this.progressTexture);

    const ribbonMat = new MeshBasicMaterial({
      map: this.progressTexture,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      side: DoubleSide,
    });
    this.disposables.push(ribbonMat);

    const ribbonMesh = new Mesh(ribbonGeo, ribbonMat);
    ribbonMesh.name = 'HoloUI_ProgressRibbon';
    ribbonMesh.renderOrder = 14;
    this.panelContainer.add(ribbonMesh);

    // 3D Orbiting Crystal Progress Bead
    const beadGeo = new OctahedronGeometry(0.0055, 0);
    beadGeo.scale(1.0, 1.3, 0.9);
    this.disposables.push(beadGeo);
    const beadMat = new MeshBasicMaterial({
      color: new Color(0xffffff),
      transparent: true,
      opacity: 0.95,
    });
    this.disposables.push(beadMat);

    this.progressBead = new Mesh(beadGeo, beadMat);
    this.progressBead.name = 'HoloUI_ProgressBead';
    this.updateBeadPosition(0);
    this.panelContainer.add(this.progressBead);
  }

  private redrawProgressRibbon(pct: number): void {
    const ctx = this.progressCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, 512, 64);

    // Translucent groove
    ctx.beginPath();
    ctx.roundRect(14, 22, 484, 20, 10);
    ctx.fillStyle = 'rgba(18, 82, 110, 0.48)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.62)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Active glowing cyan-teal fill
    const fillW = Math.max(0, Math.min(484, pct * 484));
    if (fillW > 2) {
      const grad = ctx.createLinearGradient(14, 0, 498, 0);
      grad.addColorStop(0, '#1de9b6');
      grad.addColorStop(0.5, '#00f2fe');
      grad.addColorStop(1, '#b8fbff');

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(14, 22, fillW, 20, 10);
      ctx.fillStyle = grad;
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.restore();
    }
  }

  private updateBeadPosition(pct: number): void {
    const angle = (pct - 0.5) * (Math.PI * 0.54);
    const x = Math.sin(angle) * 0.145 * 0.945; // matches 14..498 padding inside 512px
    const y = 0.075 + Math.cos(angle) * 0.015;
    const z = this.cockpitZOffset(x, y, HOLOGRAPHIC_UI_DIMENSIONS.curveRadius) + 0.015;
    this.progressBead.position.set(x, y, z);
  }

  private buildTelemetryPill(): void {
    this.telemetryCanvas = document.createElement('canvas');
    this.telemetryCanvas.width = 512;
    this.telemetryCanvas.height = 96;
    this.redrawTelemetryPill('00:00 / 04:27', 0, 'READY');

    this.telemetryTexture = new CanvasTexture(this.telemetryCanvas);
    this.telemetryTexture.generateMipmaps = true;
    this.disposables.push(this.telemetryTexture);

    const pillGeo = new PlaneGeometry(0.118, 0.023);
    this.disposables.push(pillGeo);

    const pillMat = new MeshBasicMaterial({
      map: this.telemetryTexture,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
    });
    this.disposables.push(pillMat);

    const pillMesh = new Mesh(pillGeo, pillMat);
    pillMesh.name = 'HoloUI_TelemetryPill';
    pillMesh.position.set(0, 0.056, 0.015);
    pillMesh.renderOrder = 15;
    this.panelContainer.add(pillMesh);
  }

  private redrawTelemetryPill(timeStr: string, pct: number, statusText: string): void {
    const ctx = this.telemetryCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, 512, 96);

    // Subtle frosted glass capsule
    ctx.beginPath();
    ctx.roundRect(12, 10, 488, 76, 38);
    ctx.fillStyle = 'rgba(10, 48, 72, 0.38)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.52)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Time & percent readout
    ctx.fillStyle = '#f4f9ff';
    ctx.font = '600 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pctStr = `${Math.round(pct * 100)}%`;
    ctx.fillText(`${timeStr}   •   ${pctStr}`, 256, 40);

    ctx.fillStyle = '#7df9ff';
    ctx.font = '700 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(statusText, 256, 68);
  }

  // ─── Layer 2: Seven 3D Floating Crystal Control Pods ───────────────────────

  private buildControlPods(): void {
    // 1. Center Hero Play / Pause Core
    this.playPauseButton = this.createControlPod(
      'playPause',
      0, -0.002,
      HOLOGRAPHIC_UI_DIMENSIONS.centerButtonRadius,
      MUSIC_UI_PALETTE.playPaused,
      true
    );

    // 2. Previous / Rewind 10s (Mid-Left)
    this.createControlPod(
      'rewind',
      -0.088, 0.002,
      HOLOGRAPHIC_UI_DIMENSIONS.radialButtonRadius,
      MUSIC_UI_PALETTE.glassTint
    );

    // 3. Forward 10s (Mid-Right)
    this.createControlPod(
      'forward',
      0.088, 0.002,
      HOLOGRAPHIC_UI_DIMENSIONS.radialButtonRadius,
      MUSIC_UI_PALETTE.glassTint
    );

    // 4. Start / Restart Track (Upper-Left Wing)
    this.createControlPod(
      'restart',
      -0.142, 0.044,
      HOLOGRAPHIC_UI_DIMENSIONS.wingButtonRadius,
      MUSIC_UI_PALETTE.glassTint
    );

    // 5. Skip to End (Upper-Right Wing)
    this.createControlPod(
      'skipToEnd',
      0.142, 0.044,
      HOLOGRAPHIC_UI_DIMENSIONS.wingButtonRadius,
      MUSIC_UI_PALETTE.glassTint
    );

    // 6. Volume Control (Lower-Left)
    this.volumeButton = this.createControlPod(
      'volume',
      -0.068, -0.064,
      HOLOGRAPHIC_UI_DIMENSIONS.radialButtonRadius,
      MUSIC_UI_PALETTE.glassTint
    );

    // 7. Close (X) Button (Lower-Right)
    this.createControlPod(
      'close',
      0.068, -0.064,
      HOLOGRAPHIC_UI_DIMENSIONS.wingButtonRadius,
      MUSIC_UI_PALETTE.closeAccent
    );

    // Draw initial crisp vector icons
    this.drawControlFace('playPause', false, 1.0);
    this.drawControlFace('rewind', false, 1.0);
    this.drawControlFace('forward', false, 1.0);
    this.drawControlFace('restart', false, 1.0);
    this.drawControlFace('skipToEnd', false, 1.0);
    this.drawControlFace('volume', false, 1.0);
    this.drawControlFace('close', false, 1.0);
  }

  private createControlPod(
    id: FloatingControlId,
    x: number,
    y: number,
    radius: number,
    baseColorHex: number,
    isHero = false
  ): FloatingButton {
    const R = HOLOGRAPHIC_UI_DIMENSIONS.curveRadius;
    const podZ = this.cockpitZOffset(x, y, R) + (isHero ? 0.016 : 0.014);

    const podGroup = new Group();
    podGroup.name = `HoloUI_Pod_${id}`;
    podGroup.position.set(x, y, podZ);
    // Curve inward subtly toward the seated user's eyes
    podGroup.rotation.y = -Math.atan2(x, R);
    this.panelContainer.add(podGroup);

    // 1. Metallic Silver Floating Collar Ring behind crystal cap
    const collarGeo = new TorusGeometry(radius * 1.06, 0.0014, 10, 32);
    this.disposables.push(collarGeo);
    const collarMat = new MeshStandardMaterial({
      color: new Color(MUSIC_UI_PALETTE.silverMetallic),
      metalness: 0.90,
      roughness: 0.16,
      emissive: new Color(MUSIC_UI_PALETTE.borderCyan),
      emissiveIntensity: isHero ? 0.45 : 0.18,
    });
    this.disposables.push(collarMat);
    const collarMesh = new Mesh(collarGeo, collarMat);
    collarMesh.position.z = -0.004;
    podGroup.add(collarMesh);

    // 2. Additive Hover Target Glow Halo Ring
    const haloGeo = new RingGeometry(radius * 1.04, radius * 1.32, 32);
    this.disposables.push(haloGeo);
    const haloMat = new MeshBasicMaterial({
      color: new Color(id === 'close' ? MUSIC_UI_PALETTE.closeAccent : MUSIC_UI_PALETTE.hoverGlow),
      transparent: true,
      opacity: isHero ? 0.22 : 0.0,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });
    this.disposables.push(haloMat);
    const haloMesh = new Mesh(haloGeo, haloMat);
    haloMesh.position.z = -0.002;
    podGroup.add(haloMesh);

    // 3. 3D Sculpted Beveled Crystal Prism Cap
    const sides = isHero ? 16 : 8;
    const capShape = new Shape();
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2 + (isHero ? 0 : Math.PI / sides);
      const px = Math.cos(a) * radius;
      const py = Math.sin(a) * radius;
      if (i === 0) capShape.moveTo(px, py);
      else capShape.lineTo(px, py);
    }
    const capGeo = new ExtrudeGeometry(capShape, {
      depth: isHero ? 0.008 : 0.006,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize: 0.0015,
      bevelThickness: 0.0015,
      curveSegments: 16,
    });
    capGeo.center();
    this.disposables.push(capGeo);

    const capMat = new MeshPhysicalMaterial({
      color: new Color(0x0f4966),
      transparent: true,
      opacity: 0.78,
      roughness: 0.10,
      metalness: 0.18,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      emissive: new Color(baseColorHex),
      emissiveIntensity: isHero ? 0.35 : 0.20,
    });
    this.disposables.push(capMat);

    const hitMesh = new Mesh(capGeo, capMat);
    hitMesh.name = `HoloUI_Btn_${id}`;
    const baseZ = isHero ? 0.004 : 0.003;
    hitMesh.position.z = baseZ;
    podGroup.add(hitMesh);

    // 4. Crisp Vector Icon + Label Glass Face mounted cleanly on front of cap
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const texture = new CanvasTexture(canvas);
    texture.generateMipmaps = true;
    this.disposables.push(texture);

    const faceGeo = new CircleGeometry(radius * 0.94, 32);
    this.disposables.push(faceGeo);
    const faceMat = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
    });
    this.disposables.push(faceMat);

    const faceMesh = new Mesh(faceGeo, faceMat);
    faceMesh.position.z = (isHero ? 0.0056 : 0.0046);
    faceMesh.renderOrder = 20;
    hitMesh.add(faceMesh);

    const btn: FloatingButton = {
      id,
      podGroup,
      hitMesh,
      faceMesh,
      collarMesh,
      haloMesh,
      collarMat,
      haloMat,
      capMat,
      baseZ,
      currentZ: baseZ,
      canvas,
      texture,
      depressed: false,
      hoverAmount: 0,
      isTargeted: false,
      baseColorHex,
    };
    this.buttons.set(id, btn);
    return btn;
  }

  private drawControlFace(id: FloatingControlId, isPlaying: boolean, volume: number): void {
    const btn = this.buttons.get(id);
    if (!btn) return;
    const ctx = btn.canvas.getContext('2d');
    if (!ctx) return;

    const cx = 128;
    const cy = 128;
    ctx.clearRect(0, 0, 256, 256);

    // Subtle crisp glass rim
    const isClose = id === 'close';
    const accent = isClose ? '#ff7597' : '#00f2fe';
    ctx.beginPath();
    ctx.arc(cx, cy, 114, 0, Math.PI * 2);
    ctx.strokeStyle = isPlaying && id === 'playPause' ? '#ffffff' : 'rgba(0, 242, 254, 0.72)';
    ctx.lineWidth = id === 'playPause' ? 5 : 3.5;
    ctx.stroke();

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = accent;
    ctx.shadowBlur = 10;

    if (id === 'playPause') {
      if (isPlaying) {
        // Crisp Pause Bars
        ctx.beginPath();
        ctx.roundRect(cx - 32, cy - 42, 22, 72, 6);
        ctx.roundRect(cx + 10, cy - 42, 22, 72, 6);
        ctx.fill();
      } else {
        // Crisp Play Triangle
        ctx.beginPath();
        ctx.moveTo(cx - 22, cy - 44);
        ctx.lineTo(cx + 38, cy - 6);
        ctx.lineTo(cx - 22, cy + 32);
        ctx.closePath();
        ctx.fill();
      }
      this.drawLabel(ctx, isPlaying ? 'PAUSE' : 'PLAY', cx, 194, 24, '#b8fbff');
    } else if (id === 'restart') {
      // |◀◀ Start / Restart Vector Icon
      ctx.beginPath();
      ctx.roundRect(cx - 46, cy - 38, 11, 56, 4);
      ctx.fill();
      this.fillTriangle(ctx, cx - 30, cy - 10, cx + 6, cy - 36, cx + 6, cy + 16);
      this.fillTriangle(ctx, cx + 8, cy - 10, cx + 44, cy - 36, cx + 44, cy + 16);
      this.drawLabel(ctx, 'RESTART', cx, 188, 22, '#d8ecff');
    } else if (id === 'skipToEnd') {
      // ▶▶| Skip to End Vector Icon
      this.fillTriangle(ctx, cx - 8, cy - 10, cx - 44, cy - 36, cx - 44, cy + 16);
      this.fillTriangle(ctx, cx + 30, cy - 10, cx - 6, cy - 36, cx - 6, cy + 16);
      ctx.beginPath();
      ctx.roundRect(cx + 35, cy - 38, 11, 56, 4);
      ctx.fill();
      this.drawLabel(ctx, 'SKIP END', cx, 188, 22, '#d8ecff');
    } else if (id === 'rewind') {
      // Counter-clockwise 10s jump arc + arrowhead
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(cx, cy - 10, 36, -Math.PI * 0.72, Math.PI * 0.85, false);
      ctx.stroke();
      // Arrowhead pointing left-down
      this.fillTriangle(ctx, cx - 44, cy - 28, cx - 18, cy - 48, cx - 16, cy - 20);
      ctx.font = 'bold 28px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('10', cx, cy - 8);
      this.drawLabel(ctx, 'REWIND', cx, 188, 22, '#d8ecff');
    } else if (id === 'forward') {
      // Clockwise 10s jump arc + arrowhead
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(cx, cy - 10, 36, Math.PI * 0.15, Math.PI * 1.72, false);
      ctx.stroke();
      // Arrowhead pointing right-down
      this.fillTriangle(ctx, cx + 44, cy - 28, cx + 18, cy - 48, cx + 16, cy - 20);
      ctx.font = 'bold 28px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('10', cx, cy - 8);
      this.drawLabel(ctx, 'FORWARD', cx, 188, 22, '#d8ecff');
    } else if (id === 'volume') {
      // Crisp Speaker Body
      ctx.beginPath();
      ctx.moveTo(cx - 44, cy - 22);
      ctx.lineTo(cx - 24, cy - 22);
      ctx.lineTo(cx - 4, cy - 40);
      ctx.lineTo(cx - 4, cy + 18);
      ctx.lineTo(cx - 24, cy);
      ctx.lineTo(cx - 44, cy);
      ctx.closePath();
      ctx.fill();

      // Volume wave arcs / mute X
      ctx.lineWidth = 7;
      if (volume <= 0.01) {
        ctx.strokeStyle = '#ff7597';
        ctx.beginPath();
        ctx.moveTo(cx + 12, cy - 26);
        ctx.lineTo(cx + 38, cy);
        ctx.moveTo(cx + 38, cy - 26);
        ctx.lineTo(cx + 12, cy);
        ctx.stroke();
      } else {
        const bars = volume > 0.8 ? 3 : (volume > 0.4 ? 2 : 1);
        for (let b = 0; b < 3; b++) {
          ctx.strokeStyle = b < bars ? '#00f2fe' : 'rgba(216, 236, 255, 0.22)';
          ctx.beginPath();
          ctx.arc(cx + 4, cy - 11, 16 + b * 14, -Math.PI * 0.34, Math.PI * 0.34);
          ctx.stroke();
        }
      }
      const pct = Math.round(volume * 100);
      this.drawLabel(ctx, pct <= 0 ? 'MUTED' : `VOL ${pct}%`, cx, 188, 22, '#d8ecff');
    } else if (id === 'close') {
      ctx.strokeStyle = '#ffd0dc';
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(cx - 28, cy - 38);
      ctx.lineTo(cx + 28, cy + 18);
      ctx.moveTo(cx + 28, cy - 38);
      ctx.lineTo(cx - 28, cy + 18);
      ctx.stroke();
      this.drawLabel(ctx, 'CLOSE', cx, 188, 22, '#ffb6c8');
    }

    ctx.restore();
    btn.texture.needsUpdate = true;
  }

  private fillTriangle(
    ctx: CanvasRenderingContext2D,
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fill();
  }

  private drawLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    size: number,
    color: string
  ): void {
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.font = `700 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  // ─── Bottom Sculptural Drag Grip Handle ────────────────────────────────────

  private buildDragHandle(): Mesh {
    const hw = HOLOGRAPHIC_UI_DIMENSIONS.handleWidth;
    const hh = HOLOGRAPHIC_UI_DIMENSIONS.handleHeight;
    const hr = hh * 0.5;

    const handleShape = new Shape();
    handleShape.moveTo(-hw * 0.5 + hr, -hh * 0.5);
    handleShape.lineTo(hw * 0.5 - hr, -hh * 0.5);
    handleShape.absarc(hw * 0.5 - hr, 0, hr, -Math.PI * 0.5, Math.PI * 0.5, false);
    handleShape.lineTo(-hw * 0.5 + hr, hh * 0.5);
    handleShape.absarc(-hw * 0.5 + hr, 0, hr, Math.PI * 0.5, Math.PI * 1.5, false);

    const handleGeo = new ExtrudeGeometry(handleShape, {
      depth: 0.004,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.0008,
      bevelThickness: 0.0008,
      curveSegments: 16,
    });
    handleGeo.center();
    this.disposables.push(handleGeo);

    const handleCanvas = document.createElement('canvas');
    handleCanvas.width = 256;
    handleCanvas.height = 64;
    const hctx = handleCanvas.getContext('2d')!;
    hctx.fillStyle = 'rgba(11, 58, 82, 0.72)';
    hctx.roundRect(4, 4, 248, 56, 28);
    hctx.fill();
    hctx.strokeStyle = 'rgba(0, 242, 254, 0.75)';
    hctx.lineWidth = 3;
    hctx.stroke();
    hctx.fillStyle = '#d8ecff';
    hctx.font = '700 20px -apple-system, BlinkMacSystemFont, sans-serif';
    hctx.textAlign = 'center';
    hctx.textBaseline = 'middle';
    hctx.fillText('⠿  MOVE', 128, 32);

    const handleTex = new CanvasTexture(handleCanvas);
    this.disposables.push(handleTex);

    const handleMat = new MeshPhysicalMaterial({
      color: new Color(0x0d4662),
      transparent: true,
      opacity: 0.80,
      roughness: 0.14,
      metalness: 0.25,
      emissive: new Color(MUSIC_UI_PALETTE.borderCyan),
      emissiveIntensity: 0.22,
    });
    this.disposables.push(handleMat);

    const podGroup = new Group();
    podGroup.position.set(0, -0.114, 0.006);
    this.panelContainer.add(podGroup);

    const handleMesh = new Mesh(handleGeo, handleMat);
    handleMesh.name = 'HoloUI_Handle';
    podGroup.add(handleMesh);

    const facePlaneGeo = new PlaneGeometry(hw * 0.92, hh * 0.86);
    this.disposables.push(facePlaneGeo);
    const facePlaneMat = new MeshBasicMaterial({
      map: handleTex,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
    });
    this.disposables.push(facePlaneMat);
    const facePlaneMesh = new Mesh(facePlaneGeo, facePlaneMat);
    facePlaneMesh.position.z = 0.0032;
    facePlaneMesh.renderOrder = 20;
    handleMesh.add(facePlaneMesh);

    const dummyGeo = new RingGeometry(0.001, 0.002, 4);
    this.disposables.push(dummyGeo);
    const dummyCollarMat = new MeshStandardMaterial({ visible: false });
    const dummyHaloMat = new MeshBasicMaterial({ visible: false });
    this.disposables.push(dummyCollarMat, dummyHaloMat);
    const dummyCollar = new Mesh(dummyGeo, dummyCollarMat);
    const dummyHalo = new Mesh(dummyGeo, dummyHaloMat);
    const dummyFace = new Mesh(dummyGeo, dummyHaloMat);

    this.buttons.set('handle', {
      id: 'handle',
      podGroup,
      hitMesh: handleMesh,
      faceMesh: dummyFace,
      collarMesh: dummyCollar,
      haloMesh: dummyHalo,
      collarMat: dummyCollarMat,
      haloMat: dummyHaloMat,
      capMat: handleMat,
      baseZ: 0,
      currentZ: 0,
      canvas: handleCanvas,
      texture: handleTex,
      depressed: false,
      hoverAmount: 0,
      isTargeted: false,
      baseColorHex: MUSIC_UI_PALETTE.borderCyan,
    });

    return handleMesh;
  }

  // ─── Live State & Hover Updates ────────────────────────────────────────────

  updateProgress(pct: number, formattedTime: string, statusText: string): void {
    const clamped = Math.max(0, Math.min(1, pct));
    if (Math.abs(clamped - this.lastProgressPct) >= 0.002) {
      this.lastProgressPct = clamped;
      this.redrawProgressRibbon(clamped);
      this.progressTexture.needsUpdate = true;
      this.updateBeadPosition(clamped);
    }

    if (formattedTime !== this.lastTimeStr || statusText !== this.lastStatusText || Math.abs(clamped - this.lastProgressPct) >= 0.01) {
      this.lastTimeStr = formattedTime;
      this.lastStatusText = statusText;
      this.redrawTelemetryPill(formattedTime, clamped, statusText);
      this.telemetryTexture.needsUpdate = true;
    }
  }

  updatePlayState(isPlaying: boolean): void {
    if (isPlaying === this.lastIsPlaying) return;
    this.lastIsPlaying = isPlaying;
    this.playPauseButton.baseColorHex = isPlaying ? MUSIC_UI_PALETTE.playActive : MUSIC_UI_PALETTE.playPaused;
    this.drawControlFace('playPause', isPlaying, this.lastVolume);
  }

  updateVolume(volume: number): void {
    if (Math.abs(volume - this.lastVolume) < 0.01) return;
    this.lastVolume = volume;
    this.drawControlFace('volume', Boolean(this.lastIsPlaying), volume);
  }

  setTargetedControls(targetedIds: Set<FloatingControlId>): void {
    for (const [id, btn] of this.buttons) {
      btn.isTargeted = targetedIds.has(id);
    }
  }

  depressButton(id: FloatingControlId): void {
    const btn = this.buttons.get(id);
    if (!btn) return;
    btn.depressed = true;
  }

  releaseButton(id: FloatingControlId): void {
    const btn = this.buttons.get(id);
    if (!btn) return;
    btn.depressed = false;
  }

  // ─── Open / Close Lifecycle ────────────────────────────────────────────────

  open(): void {
    this.targetOpen = true;
    this.group.visible = true;
  }

  close(): void {
    this.targetOpen = false;
  }

  toggle(): void {
    if (this.targetOpen) this.close();
    else this.open();
  }

  update(dt: number, audioIntensity = 0): void {
    this.elapsedTime += dt;

    // Smooth open / close scale transition (compact 0.80 ergonomics leaves center lotus wide open)
    const target = this.targetOpen ? 1.0 : 0.0;
    this.transitionProgress += (target - this.transitionProgress) * Math.min(1.0, dt * 10.0);
    const s = Math.max(0.001, this.transitionProgress * 0.80);
    this.panelContainer.scale.set(s, s, s);

    if (this.transitionProgress <= 0.03 && !this.targetOpen) {
      this.transitionProgress = 0;
      this.isOpen = false;
      this.group.visible = false;
      this.localLight.intensity = 0;
      return;
    } else {
      this.isOpen = true;
      this.group.visible = true;
    }

    // Update glass Fresnel shaders & dimensional lighting
    const pulse = this.lastIsPlaying ? (0.35 + audioIntensity * 0.65) : 0.12;
    for (let i = 0; i < this.glassUniforms.length; i++) {
      const u = this.glassUniforms[i];
      u.uTime.value = this.elapsedTime;
      u.uPulse.value = pulse;
      u.uOpacityScale.value = this.transitionProgress;
    }
    this.localLight.intensity = (0.65 + pulse * 0.45) * this.transitionProgress;

    // Subtle 3D gimbal rotation & crystal node shimmer
    const gimbalRate = this.lastIsPlaying ? 0.45 : 0.12;
    this.silverGimbalRing.rotation.z += dt * gimbalRate;
    this.cyanGimbalRing.rotation.z -= dt * gimbalRate * 0.72;
    this.progressBead.rotation.y += dt * 1.5;

    for (let i = 0; i < this.crystalNodes.length; i++) {
      this.crystalNodes[i].rotation.y += dt * (0.6 + i * 0.12);
    }

    // Smooth tactile float/depress & targeting glow feedback per control pod
    for (const [id, btn] of this.buttons) {
      const targetHover = btn.isTargeted ? 1.0 : 0.0;
      btn.hoverAmount += (targetHover - btn.hoverAmount) * Math.min(1.0, dt * 14.0);

      // Float +2.5mm forward on hover, depress -4.0mm on click/poke
      const hoverLift = btn.hoverAmount * 0.0025;
      const pressSink = btn.depressed ? -0.0040 : 0.0;
      const desiredZ = btn.baseZ + hoverLift + pressSink;
      btn.currentZ += (desiredZ - btn.currentZ) * Math.min(1.0, dt * 18.0);
      btn.hitMesh.position.z = btn.currentZ;

      if (id !== 'handle') {
        const isHero = id === 'playPause';
        const baseEmissive = isHero ? (this.lastIsPlaying ? 0.48 : 0.25) : 0.18;
        btn.capMat.emissiveIntensity = baseEmissive + btn.hoverAmount * 0.55;

        const baseHalo = isHero ? (this.lastIsPlaying ? 0.34 : 0.16) : 0.0;
        btn.haloMat.opacity = Math.min(0.92, baseHalo + btn.hoverAmount * 0.78);
        const haloScale = 1.0 + btn.hoverAmount * 0.14 + (isHero && this.lastIsPlaying ? Math.sin(this.elapsedTime * 3.2) * 0.04 : 0);
        btn.haloMesh.scale.set(haloScale, haloScale, 1);

        btn.collarMat.emissiveIntensity = (isHero ? 0.40 : 0.18) + btn.hoverAmount * 0.75;
        btn.collarMesh.scale.setScalar(1.0 + btn.hoverAmount * 0.05);
      } else {
        btn.capMat.emissiveIntensity = 0.20 + btn.hoverAmount * 0.55;
      }
    }
  }

  // ─── Hit-Testing & Repositioning ───────────────────────────────────────────

  getHitTestMeshes(): { mesh: Mesh; id: FloatingControlId }[] {
    const result: { mesh: Mesh; id: FloatingControlId }[] = [];
    for (const [id, btn] of this.buttons) {
      result.push({ mesh: btn.hitMesh, id });
    }
    return result;
  }

  setRepositionPosition(pos: Vector3, userHeadPos?: Vector3): void {
    this.group.position.copy(pos);
    if (userHeadPos) {
      this.scratchLook.copy(userHeadPos);
      this.group.lookAt(this.scratchLook);
    }
  }

  resetPosition(userHeadPos?: Vector3, cameraForward?: Vector3): void {
    if (userHeadPos && cameraForward) {
      this.scratchLook.copy(cameraForward).setY(0).normalize();
      if (this.scratchLook.lengthSq() < 0.001) this.scratchLook.set(0, 0, -1);

      const right = this.scratchPos.set(-this.scratchLook.z, 0, this.scratchLook.x).normalize();
      this.group.position
        .copy(userHeadPos)
        .addScaledVector(this.scratchLook, HOLOGRAPHIC_UI_DIMENSIONS.defaultDistance)
        .addScaledVector(right, HOLOGRAPHIC_UI_DIMENSIONS.defaultOffsetRight);
      this.group.position.y = userHeadPos.y - 0.20;

      this.group.lookAt(userHeadPos);
    } else {
      this.group.position.copy(this.defaultPos);
      this.group.rotation.set(-0.08, -0.22, 0);
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    this.glassUniforms.length = 0;
    this.crystalNodes.length = 0;
    this.buttons.clear();
    this.group.clear();
  }
}
