/**
 * FloatingMusicPlayer: Main 3D translucent glass holographic music player.
 *
 * Ergonomics & Aesthetics:
 *  - Translucent deep midnight glass slab with frosted cyan edge glow,
 *    beveled silver circuit rings, and gold tick accents.
 *  - Floating 45–60 cm in front of the seated user, slightly below eye level.
 *  - Offset to the right by default so the Crystal Lotus at (0, 1.12, -0.68)
 *    and cosmic ocean horizon remain 100% visible and unblocked.
 *  - Top glowing handle bar for effortless 3D repositioning via ray drag,
 *    controller grab, or desktop mouse drag.
 *  - Large, clearly visible 3D interactive controls:
 *      * Central Hero Play/Pause button with breathing cyan illumination
 *      * Rewind 10s and Fast Forward 10s
 *      * Volume step / level indicator with percentage gauge
 *      * Loop toggle with glowing emerald/cyan indicator
 *      * Close/minimize button
 *      * Circular music progress ring with leading luminous bead and time readout.
 *  - Zero per-frame allocations, optimized for 72-90 fps on Meta Quest 3S.
 */

import {
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshBasicMaterial,
  BufferGeometry,
  Shape,
  ExtrudeGeometry,
  CircleGeometry,
  RingGeometry,
  TorusGeometry,
  CanvasTexture,
  Color,
  Vector3,
  Raycaster,
} from '@iwsdk/core';
import { FLOATING_PLAYER_DIMENSIONS, MUSIC_UI_PALETTE } from './WristUIStyles.js';

export type FloatingControlId = 'playPause' | 'rewind' | 'forward' | 'volume' | 'loop' | 'close' | 'handle';

export interface FloatingButton {
  id: FloatingControlId;
  mesh: Mesh;
  baseZ: number;
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  material: MeshPhysicalMaterial | MeshBasicMaterial;
  depressed: boolean;
}

export class FloatingMusicPlayer {
  readonly group: Group = new Group();
  private panelContainer: Group = new Group();

  private isOpen = true;
  private transitionProgress = 1.0;
  private targetOpen = true;

  // Materials & Geometries for disposal
  private disposables: { dispose: () => void }[] = [];

  // Drag & repositioning
  readonly handleMesh: Mesh;
  private isBeingDragged = false;
  private defaultPos = new Vector3(
    FLOATING_PLAYER_DIMENSIONS.defaultOffsetRight,
    FLOATING_PLAYER_DIMENSIONS.defaultHeight,
    -FLOATING_PLAYER_DIMENSIONS.defaultDistance
  );

  // Buttons & Controls
  private buttons: Map<FloatingControlId, FloatingButton> = new Map();
  private progressMesh!: Mesh;
  private progressCanvas!: HTMLCanvasElement;
  private progressTexture!: CanvasTexture;
  private lastProgressPct = -1;
  private lastTimeStr = '';

  // Center play/pause
  private playPauseButton!: FloatingButton;
  private lastIsPlaying: boolean | null = null;

  // Volume
  private volumeButton!: FloatingButton;
  private lastVolume = 1.0;

  // Loop
  private loopButton!: FloatingButton;
  private lastIsLooping = false;

  // Scratch vectors
  private scratchPos = new Vector3();
  private scratchLook = new Vector3();

  constructor() {
    this.group.name = 'FloatingMusicPlayer_Root';
    this.group.add(this.panelContainer);

    // Initial position: 52 cm in front of user, chest height, offset right
    this.group.position.copy(this.defaultPos);
    this.group.rotation.set(-0.06, -0.22, 0); // Angled slightly inward toward user's head

    // Build glass slab, decorative rings, handle, progress arc, and 3D buttons
    this.handleMesh = this.buildGlassPanel();
    this.buildProgressRing();
    this.buildControls();
  }

  get visible(): boolean {
    return this.group.visible && this.isOpen;
  }

  get position(): Vector3 {
    return this.group.position;
  }

  // ─── 3D Glass Slab & Aesthetic Rings ────────────────────────────────────────

  private buildGlassPanel(): Mesh {
    const r = FLOATING_PLAYER_DIMENSIONS.radius;
    const d = FLOATING_PLAYER_DIMENSIONS.depth;
    const zFront = d * 0.5;

    // 1. Dark Shadow / Depth Backing
    const shadowShape = new Shape();
    shadowShape.absarc(0, 0, r * 1.04, 0, Math.PI * 2, false);
    const shadowGeo = new ExtrudeGeometry(shadowShape, { depth: d * 0.3, bevelEnabled: false, curveSegments: 48 });
    shadowGeo.center();
    this.disposables.push(shadowGeo);

    const shadowMat = new MeshBasicMaterial({
      color: new Color(0x020509),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.disposables.push(shadowMat);

    const shadowMesh = new Mesh(shadowGeo, shadowMat);
    shadowMesh.position.z = -d * 0.5 - 0.002;
    this.panelContainer.add(shadowMesh);

    // 2. Translucent Frosted Glass Base Slab
    const discShape = new Shape();
    discShape.absarc(0, 0, r, 0, Math.PI * 2, false);
    const extrudeSettings = {
      depth: d,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize: 0.0016,
      bevelThickness: 0.0016,
      curveSegments: 48,
    };
    const panelGeo = new ExtrudeGeometry(discShape, extrudeSettings);
    panelGeo.center();
    this.disposables.push(panelGeo);

    const panelMat = new MeshPhysicalMaterial({
      color: new Color(MUSIC_UI_PALETTE.glassBase),
      transparent: true,
      opacity: 0.88,
      roughness: 0.12,
      metalness: 0.25,
      reflectivity: 0.6,
      clearcoat: 0.3,
    });
    this.disposables.push(panelMat);

    const panelMesh = new Mesh(panelGeo, panelMat);
    panelMesh.name = 'FloatingPlayer_GlassPanel';
    this.panelContainer.add(panelMesh);

    // 3. Glowing Neon Cyan Outer Edge Ring
    const cyanRingGeo = new TorusGeometry(r, 0.0024, 8, 64);
    this.disposables.push(cyanRingGeo);
    const cyanRingMat = new MeshBasicMaterial({
      color: new Color(MUSIC_UI_PALETTE.borderCyan),
      transparent: true,
      opacity: 0.92,
    });
    this.disposables.push(cyanRingMat);
    const cyanRingMesh = new Mesh(cyanRingGeo, cyanRingMat);
    cyanRingMesh.position.z = zFront + 0.0006;
    this.panelContainer.add(cyanRingMesh);

    // 4. Fine Silver Metallic Orbit Ring with Clock Ticks
    const silverRingGeo = new TorusGeometry(r * 0.88, 0.0012, 8, 48);
    this.disposables.push(silverRingGeo);
    const silverRingMat = new MeshBasicMaterial({
      color: new Color(MUSIC_UI_PALETTE.silverAccent),
      transparent: true,
      opacity: 0.65,
    });
    this.disposables.push(silverRingMat);
    const silverRingMesh = new Mesh(silverRingGeo, silverRingMat);
    silverRingMesh.position.z = zFront + 0.0004;
    this.panelContainer.add(silverRingMesh);

    // 5. Twelve Silver Circuit Tick Markers (Cosmic Audio Clock aesthetic)
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const isMajor = i % 3 === 0;
      const tickGeo = new RingGeometry(
        r * (isMajor ? 0.84 : 0.86),
        r * 0.90,
        4
      );
      this.disposables.push(tickGeo);
      const tickMat = new MeshBasicMaterial({
        color: new Color(isMajor ? MUSIC_UI_PALETTE.goldAccent : MUSIC_UI_PALETTE.silverAccent),
        transparent: true,
        opacity: isMajor ? 0.85 : 0.40,
      });
      this.disposables.push(tickMat);
      const tickMesh = new Mesh(tickGeo, tickMat);
      tickMesh.rotation.z = angle;
      tickMesh.position.z = zFront + 0.0008;
      this.panelContainer.add(tickMesh);
    }

    // 6. Top Reposition Handle Bar (pill header with "⠿ DRAG TO REPOSITION")
    const hw = FLOATING_PLAYER_DIMENSIONS.handleWidth;
    const hh = FLOATING_PLAYER_DIMENSIONS.handleHeight;
    const handleShape = new Shape();
    const hr = hh * 0.5;
    handleShape.moveTo(-hw * 0.5 + hr, -hh * 0.5);
    handleShape.lineTo(hw * 0.5 - hr, -hh * 0.5);
    handleShape.absarc(hw * 0.5 - hr, 0, hr, -Math.PI * 0.5, Math.PI * 0.5, false);
    handleShape.lineTo(-hw * 0.5 + hr, hh * 0.5);
    handleShape.absarc(-hw * 0.5 + hr, 0, hr, Math.PI * 0.5, Math.PI * 1.5, false);

    const handleGeo = new ExtrudeGeometry(handleShape, { depth: 0.004, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.0008, bevelThickness: 0.0008, curveSegments: 16 });
    handleGeo.center();
    this.disposables.push(handleGeo);

    const handleCanvas = document.createElement('canvas');
    handleCanvas.width = 256; handleCanvas.height = 64;
    const hctx = handleCanvas.getContext('2d')!;
    hctx.fillStyle = MUSIC_UI_PALETTE.hex.handleBg;
    hctx.roundRect(4, 4, 248, 56, 28);
    hctx.fill();
    hctx.strokeStyle = MUSIC_UI_PALETTE.hex.handleBorder;
    hctx.lineWidth = 3;
    hctx.stroke();
    hctx.fillStyle = MUSIC_UI_PALETTE.hex.ivoryText;
    hctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, sans-serif';
    hctx.textAlign = 'center';
    hctx.textBaseline = 'middle';
    hctx.fillText('⠿ REPOSITION', 128, 32);

    const handleTex = new CanvasTexture(handleCanvas);
    this.disposables.push(handleTex);

    const handleMat = new MeshPhysicalMaterial({
      map: handleTex,
      color: new Color(0xffffff),
      transparent: true,
      opacity: 0.95,
      roughness: 0.20,
      metalness: 0.15,
      emissive: new Color(MUSIC_UI_PALETTE.borderCyan),
      emissiveIntensity: 0.25,
    });
    this.disposables.push(handleMat);

    const handleMesh = new Mesh(handleGeo, handleMat);
    handleMesh.name = 'FloatingPlayer_Handle';
    handleMesh.position.set(0, r + 0.016, zFront + 0.001);
    this.panelContainer.add(handleMesh);

    this.buttons.set('handle', {
      id: 'handle',
      mesh: handleMesh,
      baseZ: zFront + 0.001,
      canvas: handleCanvas,
      texture: handleTex,
      material: handleMat,
      depressed: false,
    });

    return handleMesh;
  }

  // ─── Progress Ring & Live Digital Display ───────────────────────────────────

  private buildProgressRing(): void {
    const r = FLOATING_PLAYER_DIMENSIONS.radius;
    const zFront = FLOATING_PLAYER_DIMENSIONS.depth * 0.5 + 0.0012;

    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    this.progressCanvas = canvas;
    this.redrawProgress(canvas, 0, '00:00 / 00:00');

    const texture = new CanvasTexture(canvas);
    texture.generateMipmaps = true;
    this.progressTexture = texture;
    this.disposables.push(texture);

    const discGeo = new CircleGeometry(r * 0.98, 48);
    this.disposables.push(discGeo);

    const mat = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
    });
    this.disposables.push(mat);

    this.progressMesh = new Mesh(discGeo, mat);
    this.progressMesh.name = 'FloatingPlayer_ProgressRing';
    this.progressMesh.position.set(0, 0, zFront);
    this.panelContainer.add(this.progressMesh);
  }

  private redrawProgress(canvas: HTMLCanvasElement, pct: number, timeStr: string): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cx = 256, cy = 256;
    const radius = 224;

    ctx.clearRect(0, 0, 512, 512);

    // Outer subtle track groove
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 6;
    ctx.stroke();

    // Glowing cyan/teal active progress arc
    if (pct > 0.001) {
      const startAngle = -Math.PI * 0.5; // Top 12 o'clock
      const endAngle = startAngle + pct * Math.PI * 2;

      // Outer glow pass
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.35)';
      ctx.lineWidth = 14;
      ctx.stroke();

      // Sharp bright arc
      const grad = ctx.createLinearGradient(0, 0, 512, 512);
      grad.addColorStop(0, '#1de9b6');
      grad.addColorStop(0.5, '#00f2fe');
      grad.addColorStop(1, '#6ee7b7');

      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 6;
      ctx.stroke();

      // Leading luminous stardust bead
      const beadX = cx + Math.cos(endAngle) * radius;
      const beadY = cy + Math.sin(endAngle) * radius;
      ctx.beginPath();
      ctx.arc(beadX, beadY, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Digital percentage text (bottom center)
    const pctStr = `${Math.round(pct * 100)}%`;
    ctx.fillStyle = '#00f2fe';
    ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pctStr, cx, cy + 130);

    // Track time readout
    ctx.fillStyle = '#94b4c8';
    ctx.font = '500 20px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(timeStr, cx, cy + 164);
  }

  // ─── 3D Interactive Buttons ────────────────────────────────────────────────

  private buildControls(): void {
    const z = FLOATING_PLAYER_DIMENSIONS.depth * 0.5 + 0.003;

    // 1. Central Hero Play/Pause Button
    this.playPauseButton = this.createButton(
      'playPause',
      0, 0, z,
      FLOATING_PLAYER_DIMENSIONS.centerButtonRadius,
      '▶', 'PLAY',
      MUSIC_UI_PALETTE.playPaused,
      true
    );

    // 2. Rewind 10s Button (Left)
    this.createButton(
      'rewind',
      -0.056, 0.018, z,
      FLOATING_PLAYER_DIMENSIONS.radialButtonRadius,
      '⏮', '10s',
      MUSIC_UI_PALETTE.glassTint
    );

    // 3. Forward 10s Button (Right)
    this.createButton(
      'forward',
      0.056, 0.018, z,
      FLOATING_PLAYER_DIMENSIONS.radialButtonRadius,
      '⏭', '10s',
      MUSIC_UI_PALETTE.glassTint
    );

    // 4. Volume Button (Bottom-Left)
    this.volumeButton = this.createButton(
      'volume',
      -0.048, -0.046, z,
      FLOATING_PLAYER_DIMENSIONS.radialButtonRadius,
      '🔊', '100%',
      MUSIC_UI_PALETTE.glassTint
    );

    // 5. Loop Button (Bottom-Right)
    this.loopButton = this.createButton(
      'loop',
      0.048, -0.046, z,
      FLOATING_PLAYER_DIMENSIONS.radialButtonRadius,
      '🔁', 'OFF',
      MUSIC_UI_PALETTE.glassTint
    );

    // 6. Close Button (Top Center)
    this.createButton(
      'close',
      0, 0.066, z,
      FLOATING_PLAYER_DIMENSIONS.smallButtonRadius,
      '✕', 'CLOSE',
      MUSIC_UI_PALETTE.closeButton
    );
  }

  private createButton(
    id: FloatingControlId,
    x: number, y: number, z: number,
    radius: number,
    icon: string, label: string,
    colorHex: number,
    isHero = false
  ): FloatingButton {
    const shape = new Shape();
    shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
    const extrudeGeo = new ExtrudeGeometry(shape, {
      depth: 0.003,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.0006,
      bevelThickness: 0.0006,
      curveSegments: 32,
    });
    extrudeGeo.center();
    this.disposables.push(extrudeGeo);

    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    this.drawButtonCanvas(canvas, icon, label, colorHex, isHero, false);

    const texture = new CanvasTexture(canvas);
    texture.generateMipmaps = true;
    this.disposables.push(texture);

    const mat = new MeshPhysicalMaterial({
      map: texture,
      color: new Color(0xffffff),
      transparent: true,
      opacity: 0.98,
      roughness: 0.15,
      metalness: 0.15,
      emissive: new Color(colorHex),
      emissiveIntensity: 0.20,
    });
    this.disposables.push(mat);

    const mesh = new Mesh(extrudeGeo, mat);
    mesh.name = `FloatingPlayer_${id}`;
    mesh.position.set(x, y, z);
    this.panelContainer.add(mesh);

    const btn: FloatingButton = {
      id,
      mesh,
      baseZ: z,
      canvas,
      texture,
      material: mat,
      depressed: false,
    };
    this.buttons.set(id, btn);
    return btn;
  }

  private drawButtonCanvas(
    canvas: HTMLCanvasElement,
    icon: string, label: string,
    colorHex: number,
    isHero = false,
    activeHighlight = false
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cx = 64, cy = 64;

    ctx.clearRect(0, 0, 128, 128);

    // Extract color
    const r = ((colorHex >> 16) & 0xff);
    const g = ((colorHex >> 8) & 0xff);
    const b = (colorHex & 0xff);

    // Background circle
    ctx.beginPath();
    ctx.arc(cx, cy, 58, 0, Math.PI * 2);
    ctx.fillStyle = activeHighlight
      ? 'rgba(0, 242, 254, 0.75)'
      : `rgba(${r}, ${g}, ${b}, ${isHero ? 0.75 : 0.60})`;
    ctx.fill();

    // Glowing border ring
    ctx.beginPath();
    ctx.arc(cx, cy, 58, 0, Math.PI * 2);
    ctx.strokeStyle = activeHighlight
      ? '#ffffff'
      : (isHero ? '#00f2fe' : 'rgba(0, 242, 254, 0.65)');
    ctx.lineWidth = isHero ? 4 : 3;
    ctx.stroke();

    // Icon
    ctx.fillStyle = '#ffffff';
    ctx.font = isHero ? 'bold 36px -apple-system, sans-serif' : 'bold 28px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, cx, isHero ? cy - 2 : cy - 8);

    // Subtitle label
    if (label) {
      ctx.fillStyle = activeHighlight ? '#ffffff' : '#d0e6f5';
      ctx.font = isHero ? '600 13px -apple-system, sans-serif' : '600 12px -apple-system, sans-serif';
      ctx.fillText(label, cx, isHero ? cy + 28 : cy + 24);
    }
  }

  // ─── Live Updates ──────────────────────────────────────────────────────────

  updateProgress(pct: number, formattedTime: string): void {
    const clamped = Math.max(0, Math.min(1, pct));
    if (Math.abs(clamped - this.lastProgressPct) < 0.003 && formattedTime === this.lastTimeStr) return;
    this.lastProgressPct = clamped;
    this.lastTimeStr = formattedTime;
    this.redrawProgress(this.progressCanvas, clamped, formattedTime);
    this.progressTexture.needsUpdate = true;
  }

  updatePlayState(isPlaying: boolean): void {
    if (isPlaying === this.lastIsPlaying) return;
    this.lastIsPlaying = isPlaying;
    const icon = isPlaying ? '❚❚' : '▶';
    const label = isPlaying ? 'PAUSE' : 'PLAY';
    const color = isPlaying ? MUSIC_UI_PALETTE.playActive : MUSIC_UI_PALETTE.playPaused;
    this.drawButtonCanvas(this.playPauseButton.canvas, icon, label, color, true, isPlaying);
    this.playPauseButton.texture.needsUpdate = true;
  }

  updateVolume(volume: number): void {
    if (Math.abs(volume - this.lastVolume) < 0.01) return;
    this.lastVolume = volume;
    const pct = Math.round(volume * 100);
    const icon = volume <= 0.01 ? '🔇' : (volume < 0.5 ? '🔉' : '🔊');
    const label = `${pct}%`;
    this.drawButtonCanvas(this.volumeButton.canvas, icon, label, MUSIC_UI_PALETTE.glassTint, false, false);
    this.volumeButton.texture.needsUpdate = true;
  }

  updateLoop(isLooping: boolean): void {
    if (isLooping === this.lastIsLooping) return;
    this.lastIsLooping = isLooping;
    const icon = '🔁';
    const label = isLooping ? 'LOOP ON' : 'LOOP OFF';
    const color = isLooping ? MUSIC_UI_PALETTE.loopActive : MUSIC_UI_PALETTE.loopInactive;
    this.drawButtonCanvas(this.loopButton.canvas, icon, label, color, false, isLooping);
    this.loopButton.texture.needsUpdate = true;
  }

  // ─── Button Tactile Feedback & Depress ──────────────────────────────────────

  depressButton(id: FloatingControlId): void {
    const btn = this.buttons.get(id);
    if (!btn) return;
    btn.depressed = true;
    btn.mesh.position.z = btn.baseZ - 0.0022; // Physical 2.2mm depression
  }

  releaseButton(id: FloatingControlId): void {
    const btn = this.buttons.get(id);
    if (!btn) return;
    btn.depressed = false;
    btn.mesh.position.z = btn.baseZ;
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
    if (this.targetOpen) this.close(); else this.open();
  }

  update(dt: number, userHeadPos?: Vector3): void {
    // Smooth opening / closing transition
    const speed = 6.0;
    const target = this.targetOpen ? 1.0 : 0.0;
    this.transitionProgress += (target - this.transitionProgress) * Math.min(1.0, dt * speed);

    const s = this.transitionProgress;
    this.panelContainer.scale.set(s, s, s);

    if (this.transitionProgress <= 0.01 && !this.targetOpen) {
      this.isOpen = false;
      this.group.visible = false;
    } else {
      this.isOpen = true;
      this.group.visible = true;
    }

    // Recover button depression smoothly
    for (const btn of this.buttons.values()) {
      if (!btn.depressed && Math.abs(btn.mesh.position.z - btn.baseZ) > 0.0001) {
        btn.mesh.position.z += (btn.baseZ - btn.mesh.position.z) * Math.min(1.0, dt * 16.0);
      }
    }
  }

  // ─── Raycast & Touch Hit-Testing ───────────────────────────────────────────

  getHitTestMeshes(): { mesh: Mesh; id: FloatingControlId }[] {
    const result: { mesh: Mesh; id: FloatingControlId }[] = [];
    for (const [id, btn] of this.buttons) {
      result.push({ mesh: btn.mesh, id });
    }
    return result;
  }

  // ─── Repositioning ─────────────────────────────────────────────────────────

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

      // 52 cm distance, slightly below eye level, offset right by 22 cm
      const right = this.scratchPos.set(-this.scratchLook.z, 0, this.scratchLook.x).normalize();
      this.group.position.copy(userHeadPos)
        .addScaledVector(this.scratchLook, FLOATING_PLAYER_DIMENSIONS.defaultDistance)
        .addScaledVector(right, FLOATING_PLAYER_DIMENSIONS.defaultOffsetRight);
      this.group.position.y = Math.max(0.85, userHeadPos.y - 0.16);

      this.group.lookAt(userHeadPos);
    } else {
      this.group.position.copy(this.defaultPos);
      this.group.rotation.set(-0.06, -0.22, 0);
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    this.buttons.clear();
    this.group.clear();
  }
}
