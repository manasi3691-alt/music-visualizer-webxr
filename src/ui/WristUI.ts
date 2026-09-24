/**
 * WristUI: Procedural holographic control panel.
 * Task 2 — Visual panel construction (no interaction yet).
 *
 * Requirements:
 * - Rounded rectangular panel (dimensions ~0.09 x 0.13 x 0.005 m, triangle count < 1500)
 * - Translucent MeshPhysicalMaterial with transparent: true, opacity from WristUIStyles
 * - Thin emissive border (edge loop, not a shader)
 * - Five rounded button meshes with placeholder labels (< 400 triangles per button):
 *     1. PLAY / PAUSE
 *     2. RESTART
 *     3. STATUS (read-only indicator)
 *     4. PROGRESS (read-only bar)
 *     5. CLOSE
 * - Soft gradient via vertex colors or overlay plane (no custom GLSL)
 * - Attach panel to THREE.Group passed into constructor. Do NOT add to scene yet.
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
  PlaneGeometry,
} from '@iwsdk/core';
import { WristUIState } from './WristUIState.js';
import {
  WRIST_UI_DIMENSIONS,
  WRIST_UI_PALETTE,
  WRIST_UI_OPACITY,
  WRIST_UI_EMISSIVE,
} from './WristUIStyles.js';

export interface UIControlMesh {
  id: 'playPause' | 'restart' | 'status' | 'progress' | 'close';
  mesh: Mesh;
  labelTexture: CanvasTexture | null;
}

export class WristUI {
  readonly group: Group;
  private _state: WristUIState = WristUIState.CLOSED;

  // Root container for all procedural panel visual assets
  private panelContainer: Group = new Group();

  // Primary panel geometry & materials
  private panelMesh: Mesh | null = null;
  private panelMaterial: MeshPhysicalMaterial | null = null;
  private borderLine: LineLoop | null = null;
  private borderMaterial: LineBasicMaterial | null = null;
  private gradientOverlay: Mesh | null = null;

  // Control meshes
  private controls: Map<string, UIControlMesh> = new Map();

  // Disposables tracking for clean teardown
  private disposableGeometries: BufferGeometry[] = [];
  private disposableMaterials: (MeshPhysicalMaterial | MeshBasicMaterial | LineBasicMaterial)[] = [];
  private disposableTextures: CanvasTexture[] = [];

  constructor(group: Group) {
    this.group = group;

    // Build the procedural 3D holographic panel
    this.buildPanel();

    // Attach to provided parent group
    this.group.add(this.panelContainer);

    // Initial state: hidden & scaled to min
    this.group.visible = false;
    this.group.scale.set(
      WRIST_UI_DIMENSIONS.minScale,
      WRIST_UI_DIMENSIONS.minScale,
      WRIST_UI_DIMENSIONS.minScale
    );
  }

  get state(): WristUIState {
    return this._state;
  }

  get panelGroup(): Group {
    return this.panelContainer;
  }

  getControl(id: 'playPause' | 'restart' | 'status' | 'progress' | 'close'): UIControlMesh | undefined {
    return this.controls.get(id);
  }

  getAllControls(): UIControlMesh[] {
    return Array.from(this.controls.values());
  }

  open(): void {
    this._state = WristUIState.OPEN;
    this.group.visible = true;
  }

  close(): void {
    this._state = WristUIState.CLOSED;
    this.group.visible = false;
  }

  update(dt: number): void {
    // Animation transitions will be implemented in Task 3
    void dt;
  }

  /**
   * Constructs procedural rounded rectangle shape
   */
  private createRoundedRectShape(w: number, h: number, r: number): Shape {
    const shape = new Shape();
    const x = -w / 2;
    const y = -h / 2;
    shape.moveTo(x + r, y);
    shape.lineTo(x + w - r, y);
    shape.quadraticCurveTo(x + w, y, x + w, y + r);
    shape.lineTo(x + w, y + h - r);
    shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    shape.lineTo(x + r, y + h);
    shape.quadraticCurveTo(x, y + h, x, y + h - r);
    shape.lineTo(x, y + r);
    shape.quadraticCurveTo(x, y, x + r, y);
    return shape;
  }

  /**
   * Generates a 2D canvas texture with text label and optional background/border
   */
  private createLabelTexture(
    widthPx: number,
    heightPx: number,
    drawFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  ): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      drawFn(ctx, widthPx, heightPx);
    }
    const texture = new CanvasTexture(canvas);
    texture.generateMipmaps = true;
    this.disposableTextures.push(texture);
    return texture;
  }

  /**
   * Builds the procedural panel, border, gradient, and 5 control buttons
   */
  private buildPanel(): void {
    const w = WRIST_UI_DIMENSIONS.width;
    const h = WRIST_UI_DIMENSIONS.height;
    const depth = WRIST_UI_DIMENSIONS.depth;
    const r = WRIST_UI_DIMENSIONS.cornerRadius;

    // 1. Base Panel (Extruded rounded rectangle, < 1500 triangles)
    const panelShape = this.createRoundedRectShape(w, h, r);
    const extrudeSettings = {
      depth: depth * 0.7,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.001,
      bevelThickness: 0.001,
      curveSegments: 8,
    };
    const panelGeometry = new ExtrudeGeometry(panelShape, extrudeSettings);
    // Center geometry along Z so front surface is approximately z = 0
    panelGeometry.center();
    this.disposableGeometries.push(panelGeometry);

    this.panelMaterial = new MeshPhysicalMaterial({
      color: new Color(WRIST_UI_PALETTE.deepBackground),
      transparent: true,
      opacity: WRIST_UI_OPACITY.open,
      roughness: 0.25,
      metalness: 0.12,
      transmission: 0.25,
      ior: 1.3,
      reflectivity: 0.4,
    });
    this.disposableMaterials.push(this.panelMaterial);

    this.panelMesh = new Mesh(panelGeometry, this.panelMaterial);
    this.panelMesh.name = 'WristUI_BasePanel';
    this.panelContainer.add(this.panelMesh);

    // 2. Emissive Border (Edge loop line geometry, not a shader)
    const borderPoints = panelShape.getPoints(12);
    const borderGeometry = new BufferGeometry().setFromPoints(borderPoints);
    this.disposableGeometries.push(borderGeometry);

    this.borderMaterial = new LineBasicMaterial({
      color: new Color(WRIST_UI_PALETTE.borderEmissive),
      transparent: true,
      opacity: 0.75,
      linewidth: 1,
    });
    this.disposableMaterials.push(this.borderMaterial);

    this.borderLine = new LineLoop(borderGeometry, this.borderMaterial);
    this.borderLine.name = 'WristUI_EmissiveBorder';
    this.borderLine.position.z = depth * 0.5 + 0.0005; // Slightly in front of front face
    this.panelContainer.add(this.borderLine);

    // 3. Soft Gradient Overlay Plane (Vertex colors: soft lavender -> deep violet)
    const gradW = w - 0.003;
    const gradH = h - 0.003;
    const gradGeometry = new PlaneGeometry(gradW, gradH, 1, 1);
    this.disposableGeometries.push(gradGeometry);

    // Vertex colors: top lavender/pale blue, bottom subtle deep violet
    const colorTop = new Color(WRIST_UI_PALETTE.softLavender);
    const colorBottom = new Color(WRIST_UI_PALETTE.deepBackground);
    const colors = new Float32Array([
      colorTop.r, colorTop.g, colorTop.b,       // top left
      colorTop.r, colorTop.g, colorTop.b,       // top right
      colorBottom.r, colorBottom.g, colorBottom.b, // bottom left
      colorBottom.r, colorBottom.g, colorBottom.b, // bottom right
    ]);
    gradGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

    const gradMaterial = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
    this.disposableMaterials.push(gradMaterial);

    this.gradientOverlay = new Mesh(gradGeometry, gradMaterial);
    this.gradientOverlay.name = 'WristUI_GradientOverlay';
    this.gradientOverlay.position.z = depth * 0.5 + 0.0006;
    this.panelContainer.add(this.gradientOverlay);

    // 4. Five Rounded Button Meshes with placeholder labels (< 400 triangles each)
    const zOffset = depth * 0.5 + 0.0012; // In front of gradient
    this.createControls(zOffset);
  }

  /**
   * Creates the 5 required controls:
   * 1. PLAY / PAUSE
   * 2. RESTART
   * 3. STATUS (read-only indicator)
   * 4. PROGRESS (read-only bar)
   * 5. CLOSE
   */
  private createControls(zPos: number): void {
    // Control 3: STATUS (top left, read-only indicator)
    this.createStatusIndicator(zPos);

    // Control 5: CLOSE (top right, round button)
    this.createCloseButton(zPos);

    // Control 4: PROGRESS (middle-upper, read-only bar)
    this.createProgressBar(zPos);

    // Control 1: PLAY / PAUSE (middle-lower)
    this.createPlayPauseButton(zPos);

    // Control 2: RESTART (bottom)
    this.createRestartButton(zPos);
  }

  /**
   * Control 3: STATUS Indicator (read-only)
   * Position: Top-left (x: -0.013, y: 0.046), Size: 0.054 x 0.018 m
   */
  private createStatusIndicator(zPos: number): void {
    const w = 0.054;
    const h = 0.018;
    const r = 0.004;

    const shape = this.createRoundedRectShape(w, h, r);
    const geom = new ShapeGeometry(shape, 6);
    this.disposableGeometries.push(geom);

    const texture = this.createLabelTexture(256, 80, (ctx, cw, ch) => {
      ctx.fillStyle = 'rgba(167, 139, 250, 0.20)';
      ctx.strokeStyle = 'rgba(196, 181, 253, 0.40)';
      ctx.lineWidth = 2;
      this.roundRectCanvas(ctx, 4, 4, cw - 8, ch - 8, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = WRIST_UI_PALETTE.hex.warmWhite;
      ctx.font = '600 24px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('STATUS: READY', cw / 2, ch / 2);
    });

    const mat = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.disposableMaterials.push(mat);

    const mesh = new Mesh(geom, mat);
    mesh.name = 'WristUI_StatusIndicator';
    mesh.position.set(-0.012, 0.046, zPos);
    this.panelContainer.add(mesh);

    this.controls.set('status', { id: 'status', mesh, labelTexture: texture });
  }

  /**
   * Control 5: CLOSE Button
   * Position: Top-right (x: 0.028, y: 0.046), Size: 0.018 x 0.018 m
   */
  private createCloseButton(zPos: number): void {
    const w = 0.018;
    const h = 0.018;
    const r = 0.005;

    const shape = this.createRoundedRectShape(w, h, r);
    const geom = new ShapeGeometry(shape, 6);
    this.disposableGeometries.push(geom);

    const texture = this.createLabelTexture(128, 128, (ctx, cw, ch) => {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.strokeStyle = 'rgba(216, 180, 254, 0.60)';
      ctx.lineWidth = 3;
      this.roundRectCanvas(ctx, 6, 6, cw - 12, ch - 12, 20);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = WRIST_UI_PALETTE.hex.warmWhite;
      ctx.font = '700 48px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✕', cw / 2, ch / 2);
    });

    const mat = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.disposableMaterials.push(mat);

    const mesh = new Mesh(geom, mat);
    mesh.name = 'WristUI_CloseButton';
    mesh.position.set(0.028, 0.046, zPos);
    this.panelContainer.add(mesh);

    this.controls.set('close', { id: 'close', mesh, labelTexture: texture });
  }

  /**
   * Control 4: PROGRESS Bar (read-only indicator)
   * Position: Middle-upper (x: 0, y: 0.020), Size: 0.076 x 0.018 m
   */
  private createProgressBar(zPos: number): void {
    const w = 0.076;
    const h = 0.018;
    const r = 0.004;

    const shape = this.createRoundedRectShape(w, h, r);
    const geom = new ShapeGeometry(shape, 6);
    this.disposableGeometries.push(geom);

    const texture = this.createLabelTexture(360, 80, (ctx, cw, ch) => {
      // Background track
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.strokeStyle = 'rgba(196, 181, 253, 0.30)';
      ctx.lineWidth = 2;
      this.roundRectCanvas(ctx, 4, 4, cw - 8, ch - 8, 12);
      ctx.fill();
      ctx.stroke();

      // Placeholder progress fill (e.g. 0% initially)
      ctx.fillStyle = WRIST_UI_PALETTE.hex.textMuted;
      ctx.font = '500 22px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PROGRESS: 0%', cw / 2, ch / 2);
    });

    const mat = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.disposableMaterials.push(mat);

    const mesh = new Mesh(geom, mat);
    mesh.name = 'WristUI_ProgressBar';
    mesh.position.set(0, 0.020, zPos);
    this.panelContainer.add(mesh);

    this.controls.set('progress', { id: 'progress', mesh, labelTexture: texture });
  }

  /**
   * Control 1: PLAY / PAUSE Button
   * Position: Middle (x: 0, y: -0.012), Size: 0.076 x 0.026 m
   */
  private createPlayPauseButton(zPos: number): void {
    const w = 0.076;
    const h = 0.026;
    const r = 0.005;

    const shape = this.createRoundedRectShape(w, h, r);
    const geom = new ShapeGeometry(shape, 6);
    this.disposableGeometries.push(geom);

    const texture = this.createLabelTexture(360, 110, (ctx, cw, ch) => {
      // Button background with soft gradient
      const grad = ctx.createLinearGradient(0, 0, cw, ch);
      grad.addColorStop(0, 'rgba(196, 181, 253, 0.22)');
      grad.addColorStop(1, 'rgba(147, 197, 253, 0.18)');
      ctx.fillStyle = grad;
      ctx.strokeStyle = 'rgba(196, 181, 253, 0.50)';
      ctx.lineWidth = 2;
      this.roundRectCanvas(ctx, 4, 4, cw - 8, ch - 8, 16);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = WRIST_UI_PALETTE.hex.warmWhite;
      ctx.font = '600 28px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('▶  PLAY / PAUSE', cw / 2, ch / 2);
    });

    const mat = new MeshPhysicalMaterial({
      map: texture,
      color: new Color(0xffffff),
      transparent: true,
      opacity: 0.95,
      roughness: 0.3,
      emissive: new Color(WRIST_UI_PALETTE.softLavender),
      emissiveIntensity: WRIST_UI_EMISSIVE.buttonNormalIntensity,
    });
    this.disposableMaterials.push(mat);

    const mesh = new Mesh(geom, mat);
    mesh.name = 'WristUI_PlayPauseButton';
    mesh.position.set(0, -0.012, zPos);
    this.panelContainer.add(mesh);

    this.controls.set('playPause', { id: 'playPause', mesh, labelTexture: texture });
  }

  /**
   * Control 2: RESTART Button
   * Position: Bottom (x: 0, y: -0.044), Size: 0.076 x 0.024 m
   */
  private createRestartButton(zPos: number): void {
    const w = 0.076;
    const h = 0.024;
    const r = 0.005;

    const shape = this.createRoundedRectShape(w, h, r);
    const geom = new ShapeGeometry(shape, 6);
    this.disposableGeometries.push(geom);

    const texture = this.createLabelTexture(360, 100, (ctx, cw, ch) => {
      ctx.fillStyle = 'rgba(167, 139, 250, 0.16)';
      ctx.strokeStyle = 'rgba(196, 181, 253, 0.40)';
      ctx.lineWidth = 2;
      this.roundRectCanvas(ctx, 4, 4, cw - 8, ch - 8, 16);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = WRIST_UI_PALETTE.hex.warmWhite;
      ctx.font = '600 26px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↺  RESTART', cw / 2, ch / 2);
    });

    const mat = new MeshPhysicalMaterial({
      map: texture,
      color: new Color(0xffffff),
      transparent: true,
      opacity: 0.95,
      roughness: 0.3,
      emissive: new Color(WRIST_UI_PALETTE.subtleViolet),
      emissiveIntensity: WRIST_UI_EMISSIVE.buttonNormalIntensity,
    });
    this.disposableMaterials.push(mat);

    const mesh = new Mesh(geom, mat);
    mesh.name = 'WristUI_RestartButton';
    mesh.position.set(0, -0.044, zPos);
    this.panelContainer.add(mesh);

    this.controls.set('restart', { id: 'restart', mesh, labelTexture: texture });
  }

  /**
   * Utility for drawing rounded rectangles in HTML5 Canvas 2D
   */
  private roundRectCanvas(
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

  /**
   * Release all GPU geometries, materials, and canvas textures
   */
  dispose(): void {
    for (const geom of this.disposableGeometries) {
      geom.dispose();
    }
    this.disposableGeometries.length = 0;

    for (const mat of this.disposableMaterials) {
      mat.dispose();
    }
    this.disposableMaterials.length = 0;

    for (const tex of this.disposableTextures) {
      tex.dispose();
    }
    this.disposableTextures.length = 0;

    this.controls.clear();
    this.panelContainer.clear();
    this.panelMesh = null;
    this.borderLine = null;
    this.gradientOverlay = null;
  }
}
