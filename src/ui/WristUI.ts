/**
 * WristUI: Procedural Three.js UI panel for WebXR and Desktop.
 *
 * Requirements:
 * - Rounded rect procedural panel (~0.09 x 0.13 m, < 1500 tris)
 * - Translucent material with thin emissive border
 * - Methods: open(), close(), update(dt), dispose()
 * - Animate opacity 0<->1 and scale 0.92<->1.0 over 180-250 ms using render loop delta (no setTimeout)
 * - Exactly 5 controls: PLAY/PAUSE, RESTART, STATUS, PROGRESS, CLOSE
 * - Harmonious palette: soft lavender, pale blue, warm white, subtle violet
 * - Phase-aware subtle lerp, no cyberpunk cyan/black
 */

import {
  Group,
  Shape,
  ShapeGeometry,
  Mesh,
  MeshPhysicalMaterial,
  LineLoop,
  LineBasicMaterial,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Color,
  Vector2,
} from '@iwsdk/core';
import { WristUIState } from './WristUIState.js';
import { WRIST_UI_DIMENSIONS, WRIST_UI_PALETTE, WRIST_UI_MATERIALS } from './WristUIStyles.js';
import { audioEngine } from '../audio/AudioEngine.js';
import { musicExcerpt } from '../audio/MusicExcerpt.js';
import { experienceApp } from '../app/ExperienceApp.js';
import { experienceState, ExperiencePhase } from '../app/ExperienceState.js';
import { EXPERIENCE_CONFIG } from '../app/ExperienceConfig.js';

export interface ButtonBounds {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class WristUI {
  readonly group: Group = new Group();
  private panelMesh: Mesh | null = null;
  private borderLine: LineLoop | null = null;
  private panelMaterial: MeshPhysicalMaterial | null = null;
  private borderMaterial: LineBasicMaterial | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private canvasTexture: CanvasTexture | null = null;

  private _state: WristUIState = WristUIState.CLOSED;
  private targetOpen = false;
  private transitionProgress = 0.0; // 0.0 = closed, 1.0 = open
  private progress = 0.0;

  // Phase-aware color tint
  private currentAccentColor: Color = new Color(0xc4b5fd);
  private targetAccentColor: Color = new Color(0xc4b5fd);

  // Hit test buttons in canvas pixel coordinates
  private readonly buttonBounds: ButtonBounds[] = [
    { id: 'close', x: 430, y: 24, w: 56, h: 56 },
    { id: 'playPause', x: 36, y: 270, w: 210, h: 72 },
    { id: 'restart', x: 266, y: 270, w: 210, h: 72 },
  ];

  // Redraw rate limiting
  private lastDrawnTime = -1;
  private lastDrawnPhase = '';
  private lastDrawnProgress = -1;

  constructor() {
    this.initPanel();
    // Initially closed and hidden
    this.group.visible = false;
    this.group.scale.set(WRIST_UI_DIMENSIONS.minScale, WRIST_UI_DIMENSIONS.minScale, WRIST_UI_DIMENSIONS.minScale);
  }

  get state(): WristUIState {
    return this._state;
  }

  get isOpen(): boolean {
    return this._state === WristUIState.OPEN || (this._state === WristUIState.TRANSITIONING && this.targetOpen);
  }

  get mesh(): Mesh | null {
    return this.panelMesh;
  }

  private initPanel(): void {
    const w = WRIST_UI_DIMENSIONS.width;
    const h = WRIST_UI_DIMENSIONS.height;
    const r = WRIST_UI_DIMENSIONS.cornerRadius;
    const x = -w / 2;
    const y = -h / 2;

    // 1. Procedural rounded rectangle shape (< 100 triangles)
    const shape = new Shape();
    shape.moveTo(x + r, y);
    shape.lineTo(x + w - r, y);
    shape.quadraticCurveTo(x + w, y, x + w, y + r);
    shape.lineTo(x + w, y + h - r);
    shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    shape.lineTo(x + r, y + h);
    shape.quadraticCurveTo(x, y + h, x, y + h - r);
    shape.lineTo(x, y + r);
    shape.quadraticCurveTo(x, y, x + r, y);

    const geometry = new ShapeGeometry(shape, 8);
    geometry.computeVertexNormals();

    // Map planar UV coordinates [0, 1] for canvas texture
    const pos = geometry.attributes.position;
    const uvs: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      uvs.push((px - x) / w, (py - y) / h);
    }
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));

    // 2. Offscreen Canvas for crisp high-density UI rendering
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 720;
    this.ctx = this.canvas.getContext('2d');

    this.canvasTexture = new CanvasTexture(this.canvas);
    this.canvasTexture.colorSpace = 'srgb';

    // 3. Translucent physical material with thin emissive border
    this.panelMaterial = new MeshPhysicalMaterial({
      map: this.canvasTexture,
      transparent: true,
      opacity: WRIST_UI_DIMENSIONS.closedOpacity,
      roughness: WRIST_UI_MATERIALS.roughness,
      metalness: WRIST_UI_MATERIALS.metalness,
      emissive: WRIST_UI_PALETTE.deepVioletBg,
      emissiveIntensity: WRIST_UI_MATERIALS.emissiveIntensity,
      depthWrite: false,
    });

    this.panelMesh = new Mesh(geometry, this.panelMaterial);
    this.panelMesh.name = 'WristUIPanel';
    this.group.add(this.panelMesh);

    // 4. Thin emissive border outline
    const borderPoints = shape.getPoints(32);
    const borderGeometry = new BufferGeometry().setFromPoints(borderPoints);
    this.borderMaterial = new LineBasicMaterial({
      color: WRIST_UI_PALETTE.borderEmissive,
      transparent: true,
      opacity: 0.0,
      linewidth: 1,
    });

    this.borderLine = new LineLoop(borderGeometry, this.borderMaterial);
    this.borderLine.position.z = 0.001; // slightly in front to prevent z-fighting
    this.borderLine.name = 'WristUIBorder';
    this.group.add(this.borderLine);

    this.drawCanvas();
  }

  /**
   * Open the Wrist UI panel with smooth 180-250 ms animation
   */
  open(): void {
    this.targetOpen = true;
    this._state = WristUIState.TRANSITIONING;
    this.group.visible = true;
  }

  /**
   * Close the Wrist UI panel. Does NOT pause audio.
   */
  close(): void {
    this.targetOpen = false;
    this._state = WristUIState.TRANSITIONING;
  }

  /**
   * Toggle between open and closed
   */
  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Per-frame update driven by the existing render loop's delta (in seconds).
   * Strictly no setTimeout used.
   */
  update(dtSec: number): void {
    const dt = Math.max(0.0001, Math.min(0.1, dtSec));

    // 1. Animate transition progress 0 <-> 1 over authored duration
    if (this.targetOpen) {
      this.transitionProgress = Math.min(1.0, this.transitionProgress + dt / WRIST_UI_DIMENSIONS.transitionDurationSec);
      if (this.transitionProgress >= 1.0) {
        this._state = WristUIState.OPEN;
      }
    } else {
      this.transitionProgress = Math.max(0.0, this.transitionProgress - dt / WRIST_UI_DIMENSIONS.transitionDurationSec);
      if (this.transitionProgress <= 0.0) {
        this._state = WristUIState.CLOSED;
        this.group.visible = false;
      }
    }

    if (this._state === WristUIState.CLOSED) {
      return;
    }

    this.group.visible = true;

    // Smooth cubic ease-out
    const t = this.transitionProgress;
    const ease = 1 - Math.pow(1 - t, 3);

    // Scale 0.92 <-> 1.0
    const scale = WRIST_UI_DIMENSIONS.minScale + (WRIST_UI_DIMENSIONS.maxScale - WRIST_UI_DIMENSIONS.minScale) * ease;
    this.group.scale.set(scale, scale, scale);

    // Opacity 0.0 <-> 0.88
    const opacity = WRIST_UI_DIMENSIONS.openOpacity * ease;
    if (this.panelMaterial) {
      this.panelMaterial.opacity = opacity;
    }
    if (this.borderMaterial) {
      this.borderMaterial.opacity = 0.85 * ease;
    }

    // 2. Read existing audio clock and clamp progress
    const start = musicExcerpt.sourceStart;
    const end = musicExcerpt.sourceEnd;
    const current = audioEngine.currentTime;
    const rawProgress = (current - start) / (end - start);
    this.progress = Math.max(0.0, Math.min(1.0, rawProgress));

    // 3. Phase-aware subtle accent color lerp
    this.updateAccentColor(dt);

    // 4. Update canvas contents
    const curTimeSec = Math.floor(current * 10) / 10;
    const currentPhase = experienceState.phase;
    if (
      Math.abs(curTimeSec - this.lastDrawnTime) >= 0.08 ||
      currentPhase !== this.lastDrawnPhase ||
      Math.abs(this.progress - this.lastDrawnProgress) >= 0.005
    ) {
      this.drawCanvas();
      this.lastDrawnTime = curTimeSec;
      this.lastDrawnPhase = currentPhase;
      this.lastDrawnProgress = this.progress;
    }
  }

  private updateAccentColor(dt: number): void {
    const phase = experienceState.phase;
    let target = WRIST_UI_PALETTE.softLavender;

    if (phase === 'CLIMAX') {
      target = WRIST_UI_PALETTE.warmWhite;
    } else if (phase === 'PLAYING') {
      target = WRIST_UI_PALETTE.paleBlue;
    } else if (phase === 'RELEASE') {
      target = WRIST_UI_PALETTE.subtleViolet;
    }

    this.targetAccentColor = target;
    this.currentAccentColor.lerp(this.targetAccentColor, dt * 2.5);

    if (this.borderMaterial) {
      this.borderMaterial.color.copy(this.currentAccentColor);
    }
  }

  /**
   * Handle raycast or pointer hit on the panel UV coordinates [0..1, 0..1]
   * @returns true if an interactive button was activated
   */
  handleUVClick(uv: Vector2 | { x: number; y: number }): boolean {
    if (!this.isOpen && this.transitionProgress < 0.5) return false;

    const canvasX = uv.x * 512;
    const canvasY = (1 - uv.y) * 720; // Invert Y for canvas coordinate system

    for (const btn of this.buttonBounds) {
      if (
        canvasX >= btn.x &&
        canvasX <= btn.x + btn.w &&
        canvasY >= btn.y &&
        canvasY <= btn.y + btn.h
      ) {
        this.executeControl(btn.id);
        return true;
      }
    }
    return false;
  }

  /**
   * Execute the exact 5 controls wired to existing systems
   */
  private executeControl(id: string): void {
    switch (id) {
      case 'playPause': {
        // Control 1: PLAY/PAUSE -> call existing play/pause. Resume if suspended. Preserve currentTime.
        if (experienceState.phase === 'PLAYING') {
          audioEngine.pause();
        } else if (experienceState.phase === 'PAUSED') {
          audioEngine.resume();
        } else {
          experienceApp.start();
        }
        this.drawCanvas();
        break;
      }
      case 'restart': {
        // Control 2: RESTART -> call existing reset/replay function by name. Do NOT reimplement.
        experienceApp.replay();
        this.drawCanvas();
        break;
      }
      case 'close': {
        // Control 5: CLOSE -> WristUI.close(). Do not pause audio.
        this.close();
        break;
      }
    }
  }

  /**
   * Render dynamic 2D canvas texture with rich aesthetics and exact palette
   */
  private drawCanvas(): void {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;

    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // 1. Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, WRIST_UI_PALETTE.css.bgGradientTop);
    bgGrad.addColorStop(1, WRIST_UI_PALETTE.css.bgGradientBottom);
    this.roundRect(ctx, 0, 0, w, h, 36);
    ctx.fillStyle = bgGrad;
    ctx.fill();

    // Subtle inner glowing border
    ctx.lineWidth = 4;
    ctx.strokeStyle = WRIST_UI_PALETTE.css.panelBorder;
    ctx.stroke();

    // 2. Header: Title & Composer
    ctx.fillStyle = WRIST_UI_PALETTE.css.textMain;
    ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('EXPERIENCE', 36, 52);

    ctx.fillStyle = WRIST_UI_PALETTE.css.textMuted;
    ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('Ludovico Einaudi • WebXR', 36, 78);

    // Close Button (top-right)
    const closeBtn = this.buttonBounds.find((b) => b.id === 'close')!;
    this.roundRect(ctx, closeBtn.x, closeBtn.y, closeBtn.w, closeBtn.h, 16);
    ctx.fillStyle = WRIST_UI_PALETTE.css.closeButtonBg;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = WRIST_UI_PALETTE.css.buttonBorder;
    ctx.stroke();

    ctx.fillStyle = WRIST_UI_PALETTE.css.warmWhite;
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', closeBtn.x + closeBtn.w / 2, closeBtn.y + closeBtn.h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // 3. Control 3: STATUS -> read existing ExperienceState (Read-only)
    const phase: ExperiencePhase = experienceState.phase;
    const statusY = 124;

    this.roundRect(ctx, 36, statusY, 220, 38, 19);
    ctx.fillStyle = WRIST_UI_PALETTE.css.statusBadgeBg;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = WRIST_UI_PALETTE.css.buttonBorder;
    ctx.stroke();

    ctx.fillStyle = this.getPhaseColor(phase);
    ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`● STATUS: ${phase}`, 50, statusY + 24);

    // 4. Control 4: PROGRESS -> clamp((audio.currentTime - excerptStart)/(excerptEnd - excerptStart), 0, 1)
    const start = musicExcerpt.sourceStart;
    const duration = musicExcerpt.duration;
    const elapsed = Math.max(0, Math.min(duration, audioEngine.currentTime - start));
    const elapsedStr = this.formatTime(elapsed);
    const totalStr = this.formatTime(duration);

    ctx.fillStyle = WRIST_UI_PALETTE.css.textMuted;
    ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('TIMELINE PROGRESS', 36, 192);

    ctx.fillStyle = WRIST_UI_PALETTE.css.textMain;
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${elapsedStr} / ${totalStr}`, 476, 192);
    ctx.textAlign = 'left';

    // Progress track & fill
    const trackX = 36;
    const trackY = 206;
    const trackW = 440;
    const trackH = 14;

    this.roundRect(ctx, trackX, trackY, trackW, trackH, 7);
    ctx.fillStyle = WRIST_UI_PALETTE.css.progressTrack;
    ctx.fill();

    const fillW = Math.max(0, Math.min(trackW, trackW * this.progress));
    if (fillW > 0) {
      const progGrad = ctx.createLinearGradient(trackX, 0, trackX + trackW, 0);
      progGrad.addColorStop(0, WRIST_UI_PALETTE.css.softLavender);
      progGrad.addColorStop(1, WRIST_UI_PALETTE.css.paleBlue);

      this.roundRect(ctx, trackX, trackY, fillW, trackH, 7);
      ctx.fillStyle = progGrad;
      ctx.fill();
    }

    // 5. Control 1: PLAY/PAUSE Button
    const playBtn = this.buttonBounds.find((b) => b.id === 'playPause')!;
    const isPlaying = phase === 'PLAYING';

    this.roundRect(ctx, playBtn.x, playBtn.y, playBtn.w, playBtn.h, 20);
    ctx.fillStyle = isPlaying ? WRIST_UI_PALETTE.css.buttonFillHover : WRIST_UI_PALETTE.css.buttonFill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = WRIST_UI_PALETTE.css.softLavender;
    ctx.stroke();

    ctx.fillStyle = WRIST_UI_PALETTE.css.warmWhite;
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      isPlaying ? '❚❚  PAUSE' : '▶  PLAY',
      playBtn.x + playBtn.w / 2,
      playBtn.y + playBtn.h / 2
    );

    // 6. Control 2: RESTART Button
    const restartBtn = this.buttonBounds.find((b) => b.id === 'restart')!;

    this.roundRect(ctx, restartBtn.x, restartBtn.y, restartBtn.w, restartBtn.h, 20);
    ctx.fillStyle = WRIST_UI_PALETTE.css.buttonFill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = WRIST_UI_PALETTE.css.subtleViolet;
    ctx.stroke();

    ctx.fillStyle = WRIST_UI_PALETTE.css.warmWhite;
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(
      '↺  RESTART',
      restartBtn.x + restartBtn.w / 2,
      restartBtn.y + restartBtn.h / 2
    );

    // 7. Information card / Footer
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    const cardY = 380;
    this.roundRect(ctx, 36, cardY, 440, 280, 22);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();

    ctx.fillStyle = WRIST_UI_PALETTE.css.softLavender;
    ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('SPATIAL JOURNEY CONTROLS', 56, cardY + 40);

    ctx.fillStyle = WRIST_UI_PALETTE.css.textMuted;
    ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('• Left Wrist: Tap or poke activation hitbox to open', 56, cardY + 76);
    ctx.fillText('• Right Controller: Poke with index finger or raycast', 56, cardY + 106);
    ctx.fillText('• Desktop: Press [Tab] to toggle UI overlay', 56, cardY + 136);
    ctx.fillText('• Interactive ribbons and celestial orb active', 56, cardY + 166);

    // Ambient status bar at bottom of card
    this.roundRect(ctx, 56, cardY + 200, 400, 46, 12);
    ctx.fillStyle = 'rgba(196, 181, 253, 0.10)';
    ctx.fill();

    ctx.fillStyle = WRIST_UI_PALETTE.css.paleBlue;
    ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`Target: Meta Horizon VR • 72 FPS • Level C Audio`, 72, cardY + 228);

    if (this.canvasTexture) {
      this.canvasTexture.needsUpdate = true;
    }
  }

  private getPhaseColor(phase: ExperiencePhase): string {
    switch (phase) {
      case 'PLAYING':
      case 'CLIMAX':
        return WRIST_UI_PALETTE.css.softLavender;
      case 'READY':
        return WRIST_UI_PALETTE.css.paleBlue;
      case 'PAUSED':
        return WRIST_UI_PALETTE.css.subtleViolet;
      case 'ERROR':
        return '#f87171';
      default:
        return WRIST_UI_PALETTE.css.warmWhite;
    }
  }

  private formatTime(sec: number): string {
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  dispose(): void {
    if (this.panelMesh) {
      this.panelMesh.geometry.dispose();
      this.panelMesh = null;
    }
    if (this.panelMaterial) {
      this.panelMaterial.dispose();
      this.panelMaterial = null;
    }
    if (this.borderLine) {
      this.borderLine.geometry.dispose();
      this.borderLine = null;
    }
    if (this.borderMaterial) {
      this.borderMaterial.dispose();
      this.borderMaterial = null;
    }
    if (this.canvasTexture) {
      this.canvasTexture.dispose();
      this.canvasTexture = null;
    }
    this.canvas = null;
    this.ctx = null;
    this.group.clear();
  }
}
