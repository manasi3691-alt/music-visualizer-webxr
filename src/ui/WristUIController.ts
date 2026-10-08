/**
 * WristUIController: Wires WristUI with the existing application systems.
 * Task 4 — Desktop fallback (Tab key, DOM button, camera mounting).
 * Task 5 — Live data wiring: status, progress, button click actions.
 * Task 6 — XR wrist mounting: left grip space when XR active, camera when desktop.
 */

import { Group, Camera, Raycaster, Vector2 } from '@iwsdk/core';
import type { World } from '@iwsdk/core';
import { WristUI } from './WristUI.js';
import { WRIST_UI_DIMENSIONS } from './WristUIStyles.js';
import { ExperiencePhase, XRLifecycleState } from '../app/ExperienceState.js';

export interface WristUIDependencies {
  audio: {
    play: () => Promise<void>;
    resume: () => void;
    pause: () => void;
    getCurrentTime: () => number;
    isPlaying: () => boolean;
  };
  excerpt: {
    sourceStart: number;
    sourceEnd: number;
    duration: number;
  };
  state: {
    getCurrentPhase: () => ExperiencePhase;
    subscribePhase: (listener: (phase: ExperiencePhase, prev: ExperiencePhase) => void) => () => void;
    subscribeXR?: (listener: (state: XRLifecycleState, prev: XRLifecycleState) => void) => () => void;
  };
  replay: () => void;
  world?: World;
  camera?: Camera;
}

export class WristUIController {
  private wristUI: WristUI | null = null;
  private deps: WristUIDependencies | null = null;
  private readonly rootGroup: Group = new Group();

  // Mounting handles
  private currentParent: Camera | Group | null = null;
  private isXRActive = false;

  // Desktop integration handles
  private domToggleButton: HTMLButtonElement | null = null;
  private boundOnKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private unsubscribeXR: (() => void) | null = null;
  private unsubscribePhase: (() => void) | null = null;

  // Desktop click detection via Raycaster
  private raycaster: Raycaster = new Raycaster();
  private pointer: Vector2 = new Vector2();
  private boundOnPointerDown: ((e: PointerEvent) => void) | null = null;

  // XR select listener reference
  private boundOnXRSelect: ((e: Event) => void) | null = null;
  private xrSession: XRSession | null = null;

  init(deps: WristUIDependencies): void {
    this.deps = deps;
    this.wristUI = new WristUI(this.rootGroup);

    // 1. Desktop mounting: Position ~0.6m in front of camera
    this.setupDesktopMounting();

    // 2. Keyboard shortcut: Bind Tab to toggle open/close
    this.setupKeyboardShortcut();

    // 3. Desktop toggle button in corner
    this.setupDesktopDOMButton();

    // 4. Listen for XR lifecycle to switch mounting and hide DOM button
    if (deps.state.subscribeXR) {
      this.unsubscribeXR = deps.state.subscribeXR((xrState) => {
        if (xrState === 'ACTIVE') {
          this.onXRActive();
        } else if (xrState === 'ENDED' || xrState === 'NONE') {
          this.onXREnded();
        }
        if (this.domToggleButton) {
          this.domToggleButton.style.display = xrState === 'ACTIVE' ? 'none' : 'flex';
        }
      });
    }

    // 5. Subscribe to phase changes to live-update STATUS label
    this.unsubscribePhase = deps.state.subscribePhase((phase) => {
      this.wristUI?.updateStatus(phase);
    });
    // Seed the current phase label immediately
    this.wristUI.updateStatus(deps.state.getCurrentPhase());

    // 6. Desktop pointer click handler for button hit-detection
    this.setupDesktopClickHandler();

    console.log('[WristUIController] Initialized (tasks 4+5+6)');
  }

  getUI(): WristUI | null {
    return this.wristUI;
  }

  getGroup(): Group {
    return this.rootGroup;
  }

  // ─── XR mounting ──────────────────────────────────────────────────────────

  /**
   * Called when XR session becomes ACTIVE.
   * Detaches panel from camera and attaches to left grip space (wrist).
   * Registers XR select event listener for button clicks.
   */
  private onXRActive(): void {
    this.isXRActive = true;
    const world = this.deps?.world;
    if (world) {
      const leftGrip = world.player.gripSpaces.left;
      if (this.currentParent) {
        this.currentParent.remove(this.rootGroup);
      }
      leftGrip.add(this.rootGroup);
      this.currentParent = leftGrip;

      // Position panel on inner-wrist face, rotated to face the user when palm is up
      this.rootGroup.position.set(0, WRIST_UI_DIMENSIONS.wristOffset, 0);
      this.rootGroup.rotation.set(-Math.PI * 0.5, 0, 0);
    }

    // Register XR select handler on the session
    const session = this.deps?.world?.session;
    if (session && !this.boundOnXRSelect) {
      this.boundOnXRSelect = (e: Event) => this.handleXRSelect(e as XRInputSourceEvent);
      session.addEventListener('selectstart', this.boundOnXRSelect);
      this.xrSession = session;
    }

    console.log('[WristUIController] XR active — panel mounted to left wrist grip');
  }

  /**
   * Called when XR session ends or is not yet active.
   * Re-attaches panel to camera for desktop viewing.
   */
  private onXREnded(): void {
    this.isXRActive = false;

    // Unregister XR select listener
    if (this.xrSession && this.boundOnXRSelect) {
      this.xrSession.removeEventListener('selectstart', this.boundOnXRSelect);
      this.boundOnXRSelect = null;
      this.xrSession = null;
    }

    // Revert to camera mount
    this.setupDesktopMounting();
    console.log('[WristUIController] XR ended — panel reverted to camera mount');
  }

  // ─── Desktop mounting ──────────────────────────────────────────────────────

  /**
   * Positions the panel ~0.6m in front of the camera on desktop (not attached to wrist)
   */
  private setupDesktopMounting(): void {
    const camera = this.deps?.camera || this.deps?.world?.camera;
    if (camera) {
      if (this.currentParent) {
        this.currentParent.remove(this.rootGroup);
      }
      camera.add(this.rootGroup);
      this.currentParent = camera;
      this.rootGroup.position.set(0.0, -0.04, -WRIST_UI_DIMENSIONS.desktopDistance);
      this.rootGroup.rotation.set(0, 0, 0);
    }
  }

  // ─── Input bindings ────────────────────────────────────────────────────────

  /**
   * Binds Tab key to toggle panel open/close
   */
  private setupKeyboardShortcut(): void {
    this.boundOnKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.wristUI?.toggle();
      }
    };
    window.addEventListener('keydown', this.boundOnKeyDown);
  }

  /**
   * Desktop pointer-down handler.
   * Casts a ray from the mouse position into the scene and checks if any
   * interactive WristUI button was hit. Only fires when the panel is open.
   */
  private setupDesktopClickHandler(): void {
    this.boundOnPointerDown = (e: PointerEvent) => {
      if (!this.wristUI?.isOpen) return;
      const canvas = document.querySelector('canvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      this.pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const camera = this.deps?.camera || this.deps?.world?.camera;
      if (!camera) return;
      this.raycaster.setFromCamera(this.pointer, camera);

      const hitMeshes = this.wristUI.getHitTestMeshes();
      const objects = hitMeshes.map((h) => h.mesh);
      const hits = this.raycaster.intersectObjects(objects, false);
      if (hits.length > 0) {
        const hitMesh = hits[0].object;
        const found = hitMeshes.find((h) => h.mesh === hitMesh);
        if (found) this.handleButtonAction(found.id);
      }
    };
    window.addEventListener('pointerdown', this.boundOnPointerDown);
  }

  /**
   * XR select-start handler.
   * Uses the right-hand ray space to cast against WristUI button meshes.
   * We use the right controller so the user can tap their left wrist with right hand.
   */
  private handleXRSelect(e: XRInputSourceEvent): void {
    if (!this.wristUI?.isOpen) return;
    // Only handle right-hand selects (the left hand holds the panel)
    if (e.inputSource.handedness !== 'right') return;

    const world = this.deps?.world;
    if (!world) return;

    // Use the right ray space's world-space position+direction
    const rightRay = world.player.raySpaces.right;
    this.raycaster.ray.origin.setFromMatrixPosition(rightRay.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).transformDirection(rightRay.matrixWorld).normalize();

    const hitMeshes = this.wristUI.getHitTestMeshes();
    const objects = hitMeshes.map((h) => h.mesh);
    const hits = this.raycaster.intersectObjects(objects, false);
    if (hits.length > 0) {
      const found = hitMeshes.find((h) => h.mesh === hits[0].object);
      if (found) this.handleButtonAction(found.id);
    }
  }

  /**
   * Dispatches the action for the given button ID to the existing application systems.
   */
  private handleButtonAction(id: 'playPause' | 'restart' | 'close'): void {
    const deps = this.deps;
    if (!deps) return;

    switch (id) {
      case 'playPause': {
        if (deps.audio.isPlaying()) {
          deps.audio.pause();
        } else {
          // Resume AudioContext if suspended (required on first gesture)
          deps.audio.resume();
          deps.audio.play().catch((err: unknown) => {
            console.warn('[WristUIController] play() failed:', err);
          });
        }
        break;
      }
      case 'restart': {
        deps.replay();
        break;
      }
      case 'close': {
        this.wristUI?.close();
        break;
      }
    }
  }

  // ─── DOM toggle button ─────────────────────────────────────────────────────

  /**
   * Creates a small, elegant glassmorphic DOM button in the corner for desktop mode
   */
  private setupDesktopDOMButton(): void {
    const btn = document.createElement('button');
    btn.id = 'wrist-ui-desktop-btn';
    btn.setAttribute('aria-label', 'Toggle Wrist Control Panel');
    btn.innerHTML = `
      <span style="font-size: 13px; font-weight: 600; letter-spacing: 0.5px;">Controls</span>
      <kbd style="margin-left: 8px; font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.18); border: 1px solid rgba(255,255,255,0.25);">Tab</kbd>
    `;

    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '24px',
      left: '24px',
      zIndex: '999',
      display: 'flex',
      alignItems: 'center',
      padding: '8px 16px',
      borderRadius: '24px',
      background: 'rgba(26, 22, 43, 0.85)',
      backdropFilter: 'blur(10px)',
      color: '#fffbeb',
      border: '1px solid rgba(196, 181, 253, 0.45)',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
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
      btn.style.background = 'rgba(26, 22, 43, 0.85)';
      btn.style.borderColor = 'rgba(196, 181, 253, 0.45)';
      btn.style.transform = 'translateY(0)';
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.wristUI?.toggle();
    });

    document.body.appendChild(btn);
    this.domToggleButton = btn;
  }

  // ─── Per-frame update ──────────────────────────────────────────────────────

  /**
   * Called every frame from ExperienceApp.update().
   * Drives WristUI animation and live-updates progress display.
   */
  update(dt: number): void {
    if (!this.wristUI || !this.deps) return;

    // Advance open/close animation
    this.wristUI.update(dt);

    // Live-update PROGRESS bar from audio time (only when panel is visible)
    if (this.wristUI.isOpen) {
      const { sourceStart, duration } = this.deps.excerpt;
      const rawTime = this.deps.audio.getCurrentTime();
      const pct = duration > 0 ? Math.max(0, Math.min(1, (rawTime - sourceStart) / duration)) : 0;
      this.wristUI.updateProgress(pct);
    }
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.boundOnKeyDown) {
      window.removeEventListener('keydown', this.boundOnKeyDown);
      this.boundOnKeyDown = null;
    }

    if (this.boundOnPointerDown) {
      window.removeEventListener('pointerdown', this.boundOnPointerDown);
      this.boundOnPointerDown = null;
    }

    if (this.xrSession && this.boundOnXRSelect) {
      this.xrSession.removeEventListener('selectstart', this.boundOnXRSelect);
      this.boundOnXRSelect = null;
      this.xrSession = null;
    }

    if (this.domToggleButton && this.domToggleButton.parentElement) {
      this.domToggleButton.parentElement.removeChild(this.domToggleButton);
      this.domToggleButton = null;
    }

    if (this.unsubscribeXR) {
      this.unsubscribeXR();
      this.unsubscribeXR = null;
    }

    if (this.unsubscribePhase) {
      this.unsubscribePhase();
      this.unsubscribePhase = null;
    }

    if (this.currentParent) {
      this.currentParent.remove(this.rootGroup);
      this.currentParent = null;
    }

    if (this.wristUI) {
      this.wristUI.dispose();
      this.wristUI = null;
    }

    this.deps = null;
  }
}

export const wristUIController = new WristUIController();
