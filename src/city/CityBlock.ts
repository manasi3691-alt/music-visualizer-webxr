/**
 * CityBlock: Modular foundation block and interactive building block.
 * Uses procedural Three.js geometry with elegant translucent materials.
 * Supports transform ownership states and spring-back animation.
 */

import {
  Group,
  Mesh,
  BoxGeometry,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  LineSegments,
  EdgesGeometry,
  LineBasicMaterial,
  Color,
  Vector3,
  MathUtils,
} from '@iwsdk/core';
import { TransformOwnership, CITY_PALETTE } from './CityConfig.js';

export interface CityBlockOptions {
  id: string;
  width?: number;
  height?: number;
  depth?: number;
  isInteractive?: boolean;
  color?: number;
  emissive?: number;
  opacity?: number;
  position?: Vector3;
}

export class CityBlock {
  readonly id: string;
  readonly group: Group = new Group();
  readonly isInteractive: boolean;

  // Visual meshes
  readonly baseMesh: Mesh;
  readonly edges: LineSegments;
  private readonly baseMaterial: MeshPhysicalMaterial;
  private readonly edgeMaterial: LineBasicMaterial;

  // Transform ownership
  ownership: TransformOwnership = 'TimelineOwned';

  // Authored home position for spring-back
  readonly homePosition: Vector3 = new Vector3();
  readonly targetPosition: Vector3 = new Vector3();

  // Animation & interaction state
  private hoverProgress = 0; // 0 to 1
  private grabProgress = 0;  // 0 to 1
  private springBackProgress = 1; // 1 = reached target
  private springBackStartPos = new Vector3();

  // Scratch objects
  private scratchColor = new Color();
  private scratchEmissive = new Color();

  constructor(options: CityBlockOptions) {
    this.id = options.id;
    this.isInteractive = options.isInteractive ?? false;

    const w = options.width ?? 0.32;
    const h = options.height ?? 0.18;
    const d = options.depth ?? 0.32;

    if (options.position) {
      this.homePosition.copy(options.position);
      this.targetPosition.copy(options.position);
      this.group.position.copy(options.position);
    }

    // 1. Procedural translucent block geometry
    const geo = new BoxGeometry(w, h, d);
    this.baseMaterial = new MeshPhysicalMaterial({
      color: options.color ?? CITY_PALETTE.translucentGlass,
      emissive: options.emissive ?? 0x1a264a,
      emissiveIntensity: 0.5,
      roughness: 0.15,
      metalness: 0.1,
      transmission: 0.45,
      transparent: true,
      opacity: options.opacity ?? 0.75,
      depthWrite: true,
    });
    this.baseMesh = new Mesh(geo, this.baseMaterial);
    this.baseMesh.castShadow = false;
    this.baseMesh.receiveShadow = false;
    this.group.add(this.baseMesh);

    // 2. Soft luminous wireframe edges
    const edgeGeo = new EdgesGeometry(geo);
    this.edgeMaterial = new LineBasicMaterial({
      color: options.color ? options.color : CITY_PALETTE.borderGlow,
      transparent: true,
      opacity: 0.8,
    });
    this.edges = new LineSegments(edgeGeo, this.edgeMaterial);
    this.group.add(this.edges);

    // Tag the mesh so raycasters can recognize it
    this.baseMesh.userData = { blockId: this.id, isCityBlock: true };
  }

  setHover(isHovered: boolean): void {
    if (!this.isInteractive || this.ownership === 'Locked') return;
    this.hoverProgress = isHovered ? 1 : 0;
  }

  setGrabbed(isGrabbed: boolean): void {
    if (!this.isInteractive || this.ownership === 'Locked') return;
    if (isGrabbed) {
      this.ownership = 'UserOwned';
      this.grabProgress = 1;
    } else {
      this.grabProgress = 0;
    }
  }

  startSpringBack(fromPos: Vector3): void {
    this.ownership = 'Animating';
    this.springBackStartPos.copy(fromPos);
    this.springBackProgress = 0;
  }

  lockInPlace(placedPosition: Vector3): void {
    this.ownership = 'Locked';
    this.homePosition.copy(placedPosition);
    this.group.position.copy(placedPosition);
  }

  update(deltaSec: number, accentColor?: [number, number, number]): void {
    // 1. Handle spring-back return animation if dropped outside valid zone
    if (this.ownership === 'Animating') {
      this.springBackProgress += deltaSec * 3.2; // ~300ms return
      if (this.springBackProgress >= 1.0) {
        this.springBackProgress = 1.0;
        this.group.position.copy(this.homePosition);
        this.ownership = 'TimelineOwned';
      } else {
        const t = this.springBackProgress;
        const ease = 1 - Math.pow(1 - t, 3); // Cubic ease out
        this.group.position.lerpVectors(this.springBackStartPos, this.homePosition, ease);
      }
    }

    // 2. Interactive feedback (scale & emissive highlight)
    if (this.isInteractive && this.ownership !== 'Locked') {
      const targetScale = 1.0 + this.hoverProgress * 0.06 + this.grabProgress * 0.12;
      this.baseMesh.scale.set(targetScale, targetScale, targetScale);
      this.edges.scale.set(targetScale, targetScale, targetScale);

      const targetEmissive = 0.5 + this.hoverProgress * 0.5 + this.grabProgress * 1.2;
      this.baseMaterial.emissiveIntensity = targetEmissive;

      if (this.grabProgress > 0) {
        this.edgeMaterial.color.setHex(CITY_PALETTE.goldAccent);
      } else if (this.hoverProgress > 0) {
        this.edgeMaterial.color.setHex(CITY_PALETTE.previewValid);
      } else if (accentColor) {
        this.scratchColor.setRGB(accentColor[0], accentColor[1], accentColor[2]);
        this.edgeMaterial.color.copy(this.scratchColor);
      }
    } else if (accentColor) {
      this.scratchColor.setRGB(accentColor[0], accentColor[1], accentColor[2]);
      this.edgeMaterial.color.copy(this.scratchColor);
    }
  }

  setVisibility(visible: boolean, opacity = 0.75): void {
    this.group.visible = visible;
    this.baseMaterial.opacity = opacity;
    this.edgeMaterial.opacity = opacity;
  }

  dispose(): void {
    this.baseMesh.geometry.dispose();
    this.baseMaterial.dispose();
    this.edges.geometry.dispose();
    this.edgeMaterial.dispose();
    this.group.clear();
  }
}
