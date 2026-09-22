/**
 * WristUIController: Manages attachment, spatial hitboxes, and input routing
 * for the WristUI panel across WebXR and Desktop environments.
 *
 * Responsibilities:
 * - Attach ONE panel to controller grip group (prefer left if available; NEVER two panels)
 * - Invisible activation hitbox (~0.12 m) triggered via poke/ray
 * - Wire buttons to existing systems only (AudioEngine, ExperienceApp, ExperienceState, MusicExcerpt)
 * - Desktop fallback: Tab key binding, small DOM button, positioned ~0.6 m in front of camera
 * - Ensure existing Touch/Poke/Grab/Pull/Scale and desktop mouse interactions keep working
 */

import {
  World,
  Camera,
  Raycaster,
  Vector2,
  Vector3,
  Mesh,
  SphereGeometry,
  MeshBasicMaterial,
  Object3D,
} from '@iwsdk/core';
import { WristUI } from './WristUI.js';
import { WRIST_UI_DIMENSIONS } from './WristUIStyles.js';
import { WristUIState } from './WristUIState.js';
import { experienceState } from '../app/ExperienceState.js';

export class WristUIController {
  readonly wristUI: WristUI = new WristUI();

  private world: World | null = null;
  private camera: Camera | null = null;
  private currentParent: Object3D | null = null;
  private isXRMode = false;

  // Activation hitbox (~0.12 m)
  private activationHitbox: Mesh | null = null;
  private hitboxWorldPos = new Vector3();
  private indexTipWorldPos = new Vector3();

  // Raycasting for desktop & XR selection
  private raycaster: Raycaster = new Raycaster();
  private pointerCoords: Vector2 = new Vector2();

  // Desktop DOM fallback toggle button
  private domToggleButton: HTMLButtonElement | null = null;

  private isAttachedToController = false;

  constructor() {
    this.initActivationHitbox();
  }

  get isOpen(): boolean {
    return this.wristUI.isOpen;
  }

  /**
   * Initializes controller with the IWSDK World and binds input listeners
   */
  init(world: World): void {
    this.world = world;
    this.camera = world.camera;

    // Listen for XR session state transitions
    experienceState.subscribeXR((xrState) => {
      this.isXRMode = xrState === 'ACTIVE';
      this.syncAttachment();
    });

    // Setup initial placement (Desktop fallback by default)
    this.syncAttachment();

    // Desktop Tab key toggle
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.wristUI.toggle();
      }
    });

    // Create desktop DOM toggle button
    this.createDesktopToggleButton();
  }

  private initActivationHitbox(): void {
    // ~0.12 m invisible activation hitbox
    const radius = WRIST_UI_DIMENSIONS.activationHitboxDiameter / 2;
    const geometry = new SphereGeometry(radius, 8, 8);
    const material = new MeshBasicMaterial({
      visible: false,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.activationHitbox = new Mesh(geometry, material);
    this.activationHitbox.name = 'WristUIActivationHitbox';
  }

  /**
   * Syncs panel parenting between Left Controller Grip (XR) and Camera (Desktop)
   */
  syncAttachment(): void {
    if (!this.world) return;

    if (this.isXRMode) {
      this.attachToController();
      if (this.domToggleButton) {
        this.domToggleButton.style.display = 'none';
      }
    } else {
      this.attachToDesktopCamera();
      if (this.domToggleButton) {
        this.domToggleButton.style.display = 'flex';
      }
    }
  }

  /**
   * Attach ONE panel to left controller grip space (prefer left; NEVER two panels)
   */
  private attachToController(): void {
    const player = (this.world as any)?.player;
    if (!player || !player.gripSpaces) return;

    // Prefer left controller grip space; fallback to right only if left missing
    const targetGrip = player.gripSpaces.left || player.gripSpaces.right;
    if (!targetGrip) return;

    if (this.currentParent === targetGrip && this.isAttachedToController) {
      return;
    }

    // Detach from previous parent
    if (this.currentParent) {
      this.currentParent.remove(this.wristUI.group);
      if (this.activationHitbox) {
        this.currentParent.remove(this.activationHitbox);
      }
    }

    // Attach to controller grip group
    targetGrip.add(this.wristUI.group);
    if (this.activationHitbox) {
      targetGrip.add(this.activationHitbox);
    }
    this.currentParent = targetGrip;
    this.isAttachedToController = true;

    // Position naturally on the dorsal/inner wrist facing the user
    this.wristUI.group.position.set(0.02, 0.05, -0.06);
    this.wristUI.group.rotation.set(-Math.PI * 0.35, Math.PI * 0.25, -Math.PI * 0.15);

    // Hitbox positioned on the wrist joint
    if (this.activationHitbox) {
      this.activationHitbox.position.set(0.02, 0.03, -0.04);
    }

    console.log('[WristUIController] Attached panel to controller grip group');
  }

  /**
   * Attach panel ~0.6 m in front of camera for Desktop Fallback
   */
  private attachToDesktopCamera(): void {
    const cam = this.camera || this.world?.camera;
    if (!cam) return;

    if (this.currentParent === cam && !this.isAttachedToController) {
      return;
    }

    // Detach from previous parent
    if (this.currentParent) {
      this.currentParent.remove(this.wristUI.group);
      if (this.activationHitbox) {
        this.currentParent.remove(this.activationHitbox);
      }
    }

    // Position ~0.6 m in front of camera, slightly below line of sight
    cam.add(this.wristUI.group);
    this.currentParent = cam;
    this.isAttachedToController = false;

    this.wristUI.group.position.set(0.0, -0.06, -WRIST_UI_DIMENSIONS.desktopDistance);
    this.wristUI.group.rotation.set(0, 0, 0);

    console.log('[WristUIController] Attached panel ~0.6m in front of Desktop camera');
  }

  /**
   * Update called every frame from the render loop
   */
  update(dtSec: number): void {
    // 1. Update procedural panel animation and canvas
    this.wristUI.update(dtSec);

    // 2. Check XR controller proximity poke if in XR mode
    if (this.isXRMode && this.isAttachedToController) {
      this.checkXRPoke();
    }
  }

  /**
   * Check poke interactions using emulated or physical controllers
   */
  private checkXRPoke(): void {
    const player = (this.world as any)?.player;
    if (!player) return;

    // Right index tip space or right grip space pokes left wrist
    const rightTip = player.indexTipSpaces?.right || player.gripSpaces?.right;
    if (!rightTip || !this.activationHitbox) return;

    this.activationHitbox.getWorldPosition(this.hitboxWorldPos);
    rightTip.getWorldPosition(this.indexTipWorldPos);

    const dist = this.hitboxWorldPos.distanceTo(this.indexTipWorldPos);

    // If within ~0.12 m hitbox threshold and closed, trigger open
    const threshold = WRIST_UI_DIMENSIONS.activationHitboxDiameter;
    if (dist <= threshold && this.wristUI.state === WristUIState.CLOSED) {
      this.wristUI.open();
    }
  }

  /**
   * Desktop click hit testing.
   * @returns true if the click intersected and was handled by the Wrist UI panel.
   */
  handleDesktopPointer(clientX: number, clientY: number): boolean {
    if (!this.wristUI.isOpen || !this.camera || !this.wristUI.mesh) {
      return false;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    this.pointerCoords.x = (clientX / w) * 2 - 1;
    this.pointerCoords.y = -(clientY / h) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerCoords, this.camera);
    const intersects = this.raycaster.intersectObject(this.wristUI.mesh, false);

    if (intersects.length > 0) {
      const hit = intersects[0];
      if (hit.uv) {
        return this.wristUI.handleUVClick(hit.uv);
      }
    }

    return false;
  }

  /**
   * Creates minimal elegant desktop DOM toggle button
   */
  private createDesktopToggleButton(): void {
    const btn = document.createElement('button');
    btn.id = 'wrist-ui-toggle-btn';
    btn.setAttribute('aria-label', 'Toggle Wrist Control Panel');
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
      </svg>
      <span>Controls</span>
      <kbd style="margin-left: 8px; font-size: 11px; padding: 2px 6px; background: rgba(255,255,255,0.18); border-radius: 4px; border: 1px solid rgba(255,255,255,0.25);">Tab</kbd>
    `;

    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '24px',
      left: '24px',
      zIndex: '1000',
      display: 'flex',
      alignItems: 'center',
      padding: '10px 16px',
      borderRadius: '24px',
      background: 'rgba(30, 26, 48, 0.85)',
      backdropFilter: 'blur(10px)',
      color: '#fdfbf7',
      border: '1px solid rgba(196, 181, 253, 0.45)',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      userSelect: 'none',
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(45, 38, 72, 0.95)';
      btn.style.borderColor = '#c4b5fd';
      btn.style.transform = 'translateY(-1px)';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(30, 26, 48, 0.85)';
      btn.style.borderColor = 'rgba(196, 181, 253, 0.45)';
      btn.style.transform = 'translateY(0)';
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.wristUI.toggle();
    });

    document.body.appendChild(btn);
    this.domToggleButton = btn;
  }

  dispose(): void {
    if (this.currentParent) {
      this.currentParent.remove(this.wristUI.group);
      if (this.activationHitbox) {
        this.currentParent.remove(this.activationHitbox);
      }
    }
    if (this.activationHitbox) {
      this.activationHitbox.geometry.dispose();
      (this.activationHitbox.material as MeshBasicMaterial).dispose();
      this.activationHitbox = null;
    }
    if (this.domToggleButton && this.domToggleButton.parentElement) {
      this.domToggleButton.parentElement.removeChild(this.domToggleButton);
      this.domToggleButton = null;
    }
    this.wristUI.dispose();
  }
}

export const wristUIController = new WristUIController();
