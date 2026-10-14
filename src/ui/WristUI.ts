/**
 * WristUI: Circular radial holographic control panel.
 *
 * Layout:
 *   Center:           PLAY / PAUSE  (large circular button)
 *   Top:              PROGRESS arc
 *   Top-Left  30°:    REWIND 10s
 *   Top-Right 330°:   FORWARD 10s
 *   Right     90°:    VOLUME +
 *   Left      270°:   VOLUME -
 *   Bottom-Left 210°: RESTART
 *   Bottom-Right 150°: CLOSE
 *
 * Animation: ease-out cubic scale+opacity 0↔1 over 180-220ms.
 * All materials/geometries tracked for clean disposal.
 */

import {
  Group,
  Shape,
  ShapeGeometry,
  ExtrudeGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshBasicMaterial,
  LineLoop,
  LineBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  CanvasTexture,
  Color,
  RingGeometry,
  CircleGeometry,
  TorusGeometry,
} from '@iwsdk/core';
import { WristUIState } from './WristUIState.js';
import {
  WRIST_UI_DIMENSIONS,
  WRIST_UI_PALETTE,
  WRIST_UI_OPACITY,
  WRIST_UI_EMISSIVE,
} from './WristUIStyles.js';

export interface UIControlMesh {
  id: 'playPause' | 'restart' | 'status' | 'progress' | 'close' | 'rewind' | 'forward' | 'volUp' | 'volDown';
  mesh: Mesh;
  labelTexture: CanvasTexture | null;
}

// Interactive button IDs (exclude read-only: status, progress)
type InteractiveControlId = 'playPause' | 'restart' | 'close' | 'rewind' | 'forward' | 'volUp' | 'volDown';

export class WristUI {
  readonly group: Group;
  private _state: WristUIState = WristUIState.CLOSED;

  private targetOpen = false;
  private transitionProgress = 0.0;

  private panelContainer: Group = new Group();

  // Panel geometry & materials
  private panelMesh: Mesh | null = null;
  private panelMaterial: MeshPhysicalMaterial | null = null;
  private borderLine: Mesh | null = null;
  private borderMaterial: MeshBasicMaterial | null = null;

  // Inner glow ring
  private glowRingMesh: Mesh | null = null;
  private glowRingMaterial: MeshBasicMaterial | null = null;

  // Progress arc canvas
  private progressCanvas: HTMLCanvasElement | null = null;
  private progressTexture: CanvasTexture | null = null;
  private progressMesh: Mesh | null = null;
  private _lastProgressPct = -1;

  // Status canvas
  private statusCanvas: HTMLCanvasElement | null = null;
  private statusTexture: CanvasTexture | null = null;
  private _lastStatusLabel = '';

  // Play/pause canvas (live-updated for play state)
  private playPauseCanvas: HTMLCanvasElement | null = null;
  private playPauseTexture: CanvasTexture | null = null;
  private _lastIsPlaying: boolean | null = null;

  // Controls
  private controls: Map<string, UIControlMesh> = new Map();
  private controlMaterials: { material: MeshPhysicalMaterial | MeshBasicMaterial; baseOpacity: number }[] = [];

  // Disposal tracking
  private disposableGeometries: BufferGeometry[] = [];
  private disposableMaterials: (MeshPhysicalMaterial | MeshBasicMaterial | LineBasicMaterial)[] = [];
  private disposableTextures: CanvasTexture[] = [];

  constructor(group: Group) {
    this.group = group;
    this.buildPanel();
    this.group.add(this.panelContainer);
    this.applyTransition(0.0);
    this.group.visible = false;
  }

  get state(): WristUIState { return this._state; }
  get isOpen(): boolean {
    return this._state === WristUIState.OPEN || (this._state === WristUIState.TRANSITIONING && this.targetOpen);
  }
  get isClosed(): boolean {
    return this._state === WristUIState.CLOSED || (this._state === WristUIState.TRANSITIONING && !this.targetOpen);
  }
  get panelGroup(): Group { return this.panelContainer; }

  getControl(id: UIControlMesh['id']): UIControlMesh | undefined {
    return this.controls.get(id);
  }

  getAllControls(): UIControlMesh[] {
    return Array.from(this.controls.values());
  }

  getHitTestMeshes(): { mesh: Mesh; id: InteractiveControlId }[] {
    const result: { mesh: Mesh; id: InteractiveControlId }[] = [];
    const ids: InteractiveControlId[] = ['playPause', 'restart', 'close', 'rewind', 'forward', 'volUp', 'volDown'];
    for (const id of ids) {
      const ctrl = this.controls.get(id);
      if (ctrl) result.push({ mesh: ctrl.mesh, id });
    }
    return result;
  }

  // ─── Live updates ──────────────────────────────────────────────────────────

  updateStatus(label: string): void {
    if (label === this._lastStatusLabel) return;
    this._lastStatusLabel = label;
    if (!this.statusCanvas || !this.statusTexture) return;
    this.redrawStatus(this.statusCanvas, label);
    this.statusTexture.needsUpdate = true;
  }

  updateProgress(pct: number): void {
    const clamped = Math.max(0, Math.min(1, pct));
    if (Math.abs(clamped - this._lastProgressPct) < 0.004) return;
    this._lastProgressPct = clamped;
    if (!this.progressCanvas || !this.progressTexture) return;
    this.redrawProgress(this.progressCanvas, clamped);
    this.progressTexture.needsUpdate = true;
  }

  /** Updates the central play/pause button to reflect actual playback state */
  updatePlayState(isPlaying: boolean): void {
    if (isPlaying === this._lastIsPlaying) return;
    this._lastIsPlaying = isPlaying;
    if (!this.playPauseCanvas || !this.playPauseTexture) return;
    this.redrawPlayPause(this.playPauseCanvas, isPlaying);
    this.playPauseTexture.needsUpdate = true;
  }

  // ─── Panel lifecycle ───────────────────────────────────────────────────────

  open(): void {
    if (this._state === WristUIState.OPEN && this.transitionProgress >= 1.0) return;
    this.targetOpen = true;
    this._state = WristUIState.TRANSITIONING;
    this.group.visible = true;
  }

  close(): void {
    if (this._state === WristUIState.CLOSED && this.transitionProgress <= 0.0) return;
    this.targetOpen = false;
    this._state = WristUIState.TRANSITIONING;
  }

  toggle(): void {
    if (this.isOpen) this.close(); else this.open();
  }

  update(dt: number): void {
    if (this._state === WristUIState.TRANSITIONING) {
      if (this.targetOpen) {
        this.transitionProgress += dt / WRIST_UI_DIMENSIONS.openDurationSec;
        if (this.transitionProgress >= 1.0) {
          this.transitionProgress = 1.0;
          this._state = WristUIState.OPEN;
        }
      } else {
        this.transitionProgress -= dt / WRIST_UI_DIMENSIONS.closeDurationSec;
        if (this.transitionProgress <= 0.0) {
          this.transitionProgress = 0.0;
          this._state = WristUIState.CLOSED;
          this.group.visible = false;
        }
      }
      this.applyTransition(this.transitionProgress);
    }
  }

  // ─── Transition ────────────────────────────────────────────────────────────

  private applyTransition(t: number): void {
    const cT = Math.max(0, Math.min(1, t));
    const inv = 1 - cT;
    const eased = 1 - inv * inv * inv; // ease-out cubic

    const minS = WRIST_UI_DIMENSIONS.minScale;
    const maxS = WRIST_UI_DIMENSIONS.maxScale;
    const s = minS + (maxS - minS) * eased;
    this.group.scale.set(s, s, s);

    if (this.panelMaterial) this.panelMaterial.opacity = WRIST_UI_OPACITY.open * eased;
    if (this.borderMaterial) this.borderMaterial.opacity = 0.80 * eased;
    if (this.glowRingMaterial) this.glowRingMaterial.opacity = 0.35 * eased;

    for (const entry of this.controlMaterials) {
      entry.material.opacity = entry.baseOpacity * eased;
    }
  }

  // ─── Panel construction ────────────────────────────────────────────────────

  private buildPanel(): void {
    const r = WRIST_UI_DIMENSIONS.radius;
    const d = WRIST_UI_DIMENSIONS.depth;
    const zFront = d * 0.5 + 0.001;

    // 1. Base circular panel (disc extrusion)
    const discShape = new Shape();
    discShape.absarc(0, 0, r, 0, Math.PI * 2, false);
    const extrudeSettings = {
      depth: d,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.0008,
      bevelThickness: 0.0008,
      curveSegments: 32,
    };
    const panelGeo = new ExtrudeGeometry(discShape, extrudeSettings);
    panelGeo.center();
    this.disposableGeometries.push(panelGeo);

    this.panelMaterial = new MeshPhysicalMaterial({
      color: new Color(WRIST_UI_PALETTE.panelBase),
      transparent: true,
      opacity: WRIST_UI_OPACITY.open,
      roughness: 0.08,
      metalness: 0.20,
      transmission: 0.35,
      ior: 1.4,
      reflectivity: 0.5,
    });
    this.disposableMaterials.push(this.panelMaterial);

    this.panelMesh = new Mesh(panelGeo, this.panelMaterial);
    this.panelMesh.name = 'WristUI_BasePanel';
    this.panelContainer.add(this.panelMesh);

    // 2. Border torus ring (glowing outer edge)
    const torusGeo = new TorusGeometry(r, 0.0015, 8, 48);
    this.disposableGeometries.push(torusGeo);
    this.borderMaterial = new MeshBasicMaterial({
      color: new Color(WRIST_UI_PALETTE.borderEmissive),
      transparent: true,
      opacity: 0.80,
    });
    this.disposableMaterials.push(this.borderMaterial);
    this.borderLine = new Mesh(torusGeo, this.borderMaterial);
    this.borderLine.name = 'WristUI_Border';
    this.borderLine.position.z = d * 0.5 + 0.0005;
    this.panelContainer.add(this.borderLine);

    // 3. Inner glow ring (subtle, smaller torus)
    const innerTorusGeo = new TorusGeometry(r * 0.75, 0.001, 8, 48);
    this.disposableGeometries.push(innerTorusGeo);
    this.glowRingMaterial = new MeshBasicMaterial({
      color: new Color(WRIST_UI_PALETTE.tealAccent),
      transparent: true,
      opacity: 0.35,
    });
    this.disposableMaterials.push(this.glowRingMaterial);
    this.glowRingMesh = new Mesh(innerTorusGeo, this.glowRingMaterial);
    this.glowRingMesh.position.z = zFront;
    this.panelContainer.add(this.glowRingMesh);

    // 4. Build all controls
    this.buildCenterPlayPause(zFront + 0.001);
    this.buildProgressArc(zFront + 0.001);
    this.buildRadialButtons(zFront + 0.001);
    this.buildStatusLabel(zFront + 0.001);
  }

  // ─── Center: Play/Pause ────────────────────────────────────────────────────

  private buildCenterPlayPause(z: number): void {
    const br = WRIST_UI_DIMENSIONS.centerButtonRadius;
    const geo = new CircleGeometry(br, 32);
    this.disposableGeometries.push(geo);

    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    this.playPauseCanvas = canvas;
    this.redrawPlayPause(canvas, false);
    const texture = new CanvasTexture(canvas);
    texture.generateMipmaps = true;
    this.playPauseTexture = texture;
    this.disposableTextures.push(texture);

    const mat = new MeshPhysicalMaterial({
      map: texture,
      color: new Color(0xffffff),
      transparent: true,
      opacity: 0.98,
      roughness: 0.15,
      metalness: 0.1,
      emissive: new Color(WRIST_UI_PALETTE.tealAccent),
      emissiveIntensity: WRIST_UI_EMISSIVE.buttonNormalIntensity,
    });
    this.disposableMaterials.push(mat);
    this.controlMaterials.push({ material: mat, baseOpacity: 0.98 });

    const mesh = new Mesh(geo, mat);
    mesh.name = 'WristUI_PlayPause';
    mesh.position.set(0, 0, z);
    this.panelContainer.add(mesh);
    this.controls.set('playPause', { id: 'playPause', mesh, labelTexture: texture });
  }

  // ─── Progress arc ──────────────────────────────────────────────────────────

  private buildProgressArc(z: number): void {
    const r = WRIST_UI_DIMENSIONS.radius;
    // Progress ring: thin arc around 270° of the panel (leaves gap at bottom for thumb comfort)
    const arcRadius = r * 0.88;
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    this.progressCanvas = canvas;
    this.redrawProgress(canvas, 0);
    const texture = new CanvasTexture(canvas);
    texture.generateMipmaps = true;
    this.progressTexture = texture;
    this.disposableTextures.push(texture);

    // Use a flat disc as the blit target for the arc (displayed behind buttons)
    const arcGeo = new RingGeometry(arcRadius - 0.004, arcRadius + 0.004, 64);
    this.disposableGeometries.push(arcGeo);

    // We overlay a full-disc texture with transparency
    const fullDiscGeo = new CircleGeometry(r * 0.97, 64);
    this.disposableGeometries.push(fullDiscGeo);

    const mat = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.disposableMaterials.push(mat);
    this.controlMaterials.push({ material: mat, baseOpacity: 0.95 });

    this.progressMesh = new Mesh(fullDiscGeo, mat);
    this.progressMesh.name = 'WristUI_ProgressArc';
    this.progressMesh.position.set(0, 0, z - 0.0005); // just behind buttons
    this.panelContainer.add(this.progressMesh);

    // Progress is read-only, not interactive
    this.controls.set('progress', { id: 'progress', mesh: this.progressMesh, labelTexture: texture });
  }

  // ─── Status label ──────────────────────────────────────────────────────────

  private buildStatusLabel(z: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = 200; canvas.height = 40;
    this.statusCanvas = canvas;
    this.redrawStatus(canvas, 'READY');
    const texture = new CanvasTexture(canvas);
    texture.generateMipmaps = true;
    this.statusTexture = texture;
    this.disposableTextures.push(texture);

    const w = WRIST_UI_DIMENSIONS.radius * 0.8;
    const h = w * 0.18;
    const geo = new Shape();
    geo.absarc(0, 0, 0, 0, 0, false); // We'll use a PlaneGeometry equivalent
    // Use CircleGeometry-based plane
    const planeShape = new Shape();
    planeShape.moveTo(-w/2, -h/2);
    planeShape.lineTo( w/2, -h/2);
    planeShape.lineTo( w/2,  h/2);
    planeShape.lineTo(-w/2,  h/2);
    planeShape.closePath();
    const planeGeo = new ShapeGeometry(planeShape, 1);
    this.disposableGeometries.push(planeGeo);

    const mat = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.90,
      depthWrite: false,
    });
    this.disposableMaterials.push(mat);
    this.controlMaterials.push({ material: mat, baseOpacity: 0.90 });

    const mesh = new Mesh(planeGeo, mat);
    mesh.name = 'WristUI_Status';
    // Place status at bottom of panel (below center button)
    mesh.position.set(0, -WRIST_UI_DIMENSIONS.radius * 0.55, z + 0.001);
    this.panelContainer.add(mesh);
    this.controls.set('status', { id: 'status', mesh, labelTexture: texture });
  }

  // ─── Radial buttons ────────────────────────────────────────────────────────

  private buildRadialButtons(z: number): void {
    type RadialConfig = {
      id: InteractiveControlId;
      label: string;
      icon: string;
      angleDeg: number;
      color: number;
    };

    const configs: RadialConfig[] = [
      { id: 'rewind',  label: 'REWIND',   icon: '⏮ 10',  angleDeg: 150, color: WRIST_UI_PALETTE.tealAccent },
      { id: 'forward', label: 'FORWARD',  icon: '10 ⏭',  angleDeg: 30,  color: WRIST_UI_PALETTE.tealAccent },
      { id: 'volUp',   label: 'VOL +',    icon: '🔊+',   angleDeg: 330, color: WRIST_UI_PALETTE.goldAccent },
      { id: 'volDown', label: 'VOL -',    icon: '🔉-',   angleDeg: 210, color: WRIST_UI_PALETTE.goldAccent },
      { id: 'restart', label: 'RESTART',  icon: '↺',     angleDeg: 250, color: WRIST_UI_PALETTE.buttonBase },
      { id: 'close',   label: 'CLOSE',    icon: '✕',     angleDeg: 110, color: WRIST_UI_PALETTE.closeButton },
    ];

    const orbit = WRIST_UI_DIMENSIONS.radialOrbitRadius;
    const br    = WRIST_UI_DIMENSIONS.radialButtonRadius;

    for (const cfg of configs) {
      const angleRad = (cfg.angleDeg * Math.PI) / 180;
      const bx = Math.cos(angleRad) * orbit;
      const by = Math.sin(angleRad) * orbit;

      const geo = new CircleGeometry(br, 24);
      this.disposableGeometries.push(geo);

      const texture = this.createButtonTexture(cfg.icon, cfg.label, cfg.color);

      const mat = new MeshPhysicalMaterial({
        map: texture,
        color: new Color(0xffffff),
        transparent: true,
        opacity: 0.96,
        roughness: 0.20,
        metalness: 0.08,
        emissive: new Color(cfg.color),
        emissiveIntensity: WRIST_UI_EMISSIVE.buttonNormalIntensity,
      });
      this.disposableMaterials.push(mat);
      this.controlMaterials.push({ material: mat, baseOpacity: 0.96 });

      const mesh = new Mesh(geo, mat);
      mesh.name = `WristUI_${cfg.id}`;
      mesh.position.set(bx, by, z);
      this.panelContainer.add(mesh);

      this.controls.set(cfg.id, { id: cfg.id, mesh, labelTexture: texture });
    }
  }

  // ─── Canvas drawing helpers ────────────────────────────────────────────────

  private createButtonTexture(icon: string, label: string, colorHex: number): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    // Extract RGB from hex
    const r = ((colorHex >> 16) & 0xff) / 255;
    const g = ((colorHex >> 8) & 0xff) / 255;
    const b = (colorHex & 0xff) / 255;

    // Background circle with subtle glow
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)}, 0.60)`;
    ctx.fill();

    // Border ring
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${Math.round(r*255+40)}, ${Math.round(g*255+40)}, ${Math.round(b*255+40)}, 0.85)`;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Icon
    ctx.fillStyle = WRIST_UI_PALETTE.hex.ivoryText;
    ctx.font = 'bold 32px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, 64, 58);

    // Label (small, below icon)
    ctx.fillStyle = WRIST_UI_PALETTE.hex.textMuted;
    ctx.font = '500 16px -apple-system, sans-serif';
    ctx.fillText(label, 64, 96);

    const texture = new CanvasTexture(canvas);
    texture.generateMipmaps = true;
    this.disposableTextures.push(texture);
    return texture;
  }

  private redrawPlayPause(canvas: HTMLCanvasElement, isPlaying: boolean): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    const cx = cw / 2, cy = ch / 2, r = 56;

    // Outer ring gradient
    const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
    if (isPlaying) {
      grad.addColorStop(0, 'rgba(20, 100, 80, 0.90)');
      grad.addColorStop(1, 'rgba(10, 60, 50, 0.70)');
    } else {
      grad.addColorStop(0, 'rgba(14, 58, 92, 0.90)');
      grad.addColorStop(1, 'rgba(8, 30, 50, 0.70)');
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Border
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = isPlaying ? 'rgba(40, 160, 120, 0.85)' : 'rgba(61, 143, 170, 0.85)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Icon
    ctx.fillStyle = WRIST_UI_PALETTE.hex.ivoryText;
    ctx.font = 'bold 42px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isPlaying ? '⏸' : '▶', cx, cy);
  }

  private redrawProgress(canvas: HTMLCanvasElement, pct: number): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    const cx = cw / 2, cy = ch / 2;
    const arcR = cw * 0.43;
    const arcWidth = cw * 0.04;

    // Track arc (full 270° from -225° to 45°)
    const startAngle = (225 * Math.PI) / 180;
    const endAngle   = startAngle - Math.PI * 1.5; // 270° sweep CCW

    ctx.beginPath();
    ctx.arc(cx, cy, arcR, startAngle, endAngle, true);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = arcWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Fill arc
    if (pct > 0.01) {
      const fillAngle = endAngle + (1 - pct) * Math.PI * 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, arcR, startAngle, fillAngle, true);
      const fg = ctx.createLinearGradient(cx - arcR, cy, cx + arcR, cy);
      fg.addColorStop(0, 'rgba(42, 122, 106, 0.90)');
      fg.addColorStop(1, 'rgba(61, 143, 170, 0.90)');
      ctx.strokeStyle = fg;
      ctx.lineWidth = arcWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Percent text
    const pctStr = `${Math.round(pct * 100)}%`;
    ctx.fillStyle = 'rgba(245, 240, 232, 0.70)';
    ctx.font = '600 28px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pctStr, cx, cy + cw * 0.30);
  }

  private redrawStatus(canvas: HTMLCanvasElement, label: string): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(245, 240, 232, 0.60)';
    ctx.font = '500 16px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
  }

  // ─── Disposal ──────────────────────────────────────────────────────────────

  dispose(): void {
    for (const geom of this.disposableGeometries) geom.dispose();
    this.disposableGeometries.length = 0;
    for (const mat of this.disposableMaterials) mat.dispose();
    this.disposableMaterials.length = 0;
    for (const tex of this.disposableTextures) tex.dispose();
    this.disposableTextures.length = 0;
    this.controlMaterials.length = 0;
    this.controls.clear();
    this.panelContainer.clear();
    this.panelMesh = null;
    this.borderLine = null;
    this.glowRingMesh = null;
    this.progressMesh = null;
    this.statusCanvas = null;
    this.statusTexture = null;
    this.progressCanvas = null;
    this.progressTexture = null;
    this.playPauseCanvas = null;
    this.playPauseTexture = null;
  }
}
