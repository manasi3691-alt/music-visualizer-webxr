/**
 * DesktopInput: Full desktop fallback interaction support.
 * Implements mouse look (clamped seated field), click-to-touch,
 * drag-to-grab, and scroll-to-scale.
 */

import { Vector3, Raycaster, Camera, Object3D } from '@iwsdk/core';
import { interactionRegistry } from '../interaction/InteractionRegistry.js';
import { ScaleElement } from '../interaction/ScaleElement.js';

export class DesktopInput {
  private camera: Camera | null = null;
  private domElement: HTMLElement | null = null;
  private isPointerDown = false;
  private isDraggingGrab = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Clamped head rotation angles (radians)
  private yaw = 0;
  private pitch = 0;
  private readonly maxPitch = Math.PI * 0.35;
  private readonly minPitch = -Math.PI * 0.25;
  private readonly maxYaw = Math.PI * 0.65;
  private readonly minYaw = -Math.PI * 0.65;

  private raycaster = new Raycaster();
  private mouseVec = { x: 0, y: 0 };
  private scaleElement = new ScaleElement();

  private boundOnMouseDown: (e: MouseEvent) => void;
  private boundOnMouseMove: (e: MouseEvent) => void;
  private boundOnMouseUp: (e: MouseEvent) => void;
  private boundOnWheel: (e: WheelEvent) => void;

  constructor() {
    this.boundOnMouseDown = this.onMouseDown.bind(this);
    this.boundOnMouseMove = this.onMouseMove.bind(this);
    this.boundOnMouseUp = this.onMouseUp.bind(this);
    this.boundOnWheel = this.onWheel.bind(this);
  }

  attach(camera: Camera, domElement: HTMLElement, interactiveObjects: Object3D[]): void {
    this.camera = camera;
    this.domElement = domElement;

    domElement.addEventListener('mousedown', this.boundOnMouseDown);
    window.addEventListener('mousemove', this.boundOnMouseMove);
    window.addEventListener('mouseup', this.boundOnMouseUp);
    domElement.addEventListener('wheel', this.boundOnWheel, { passive: true });
  }

  detach(): void {
    if (this.domElement) {
      this.domElement.removeEventListener('mousedown', this.boundOnMouseDown);
      this.domElement.removeEventListener('wheel', this.boundOnWheel);
    }
    window.removeEventListener('mousemove', this.boundOnMouseMove);
    window.removeEventListener('mouseup', this.boundOnMouseUp);
  }

  private onMouseDown(e: MouseEvent): void {
    // Only left click
    if (e.button !== 0) return;
    this.isPointerDown = true;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    if (!this.domElement || !this.camera) return;

    const rect = this.domElement.getBoundingClientRect();
    this.mouseVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    // Trigger touch ripple on forward click
    if (interactionRegistry.isTouchAvailable()) {
      interactionRegistry.onTouch('primary-ribbon');
    }

    if (interactionRegistry.isGrabAvailable()) {
      this.isDraggingGrab = true;
      interactionRegistry.onGrabStart('grab-orb', new Vector3(this.mouseVec.x * 0.5, this.mouseVec.y * 0.5, -1.0));
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isPointerDown) return;

    const deltaX = e.clientX - this.lastMouseX;
    const deltaY = e.clientY - this.lastMouseY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    if (this.isDraggingGrab) {
      // Map mouse drag to grab displacement
      const dummyControllerPos = new Vector3(
        deltaX * 0.002,
        -deltaY * 0.002,
        0
      );
      interactionRegistry.onGrabUpdate(dummyControllerPos);
    } else {
      // Rotate camera within seated limits
      const sensitivity = 0.003;
      this.yaw = Math.max(this.minYaw, Math.min(this.maxYaw, this.yaw - deltaX * sensitivity));
      this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch - deltaY * sensitivity));

      if (this.camera) {
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = this.yaw;
        this.camera.rotation.x = this.pitch;
      }
    }
  }

  private onMouseUp(): void {
    this.isPointerDown = false;
    if (this.isDraggingGrab) {
      this.isDraggingGrab = false;
      interactionRegistry.onGrabEnd();
    }
  }

  private onWheel(e: WheelEvent): void {
    if (!interactionRegistry.isPullScaleAvailable()) return;

    const zoomFactor = e.deltaY > 0 ? 0.96 : 1.04;
    this.scaleElement.applyScaleDelta(zoomFactor);
  }
}

export const desktopInput = new DesktopInput();
