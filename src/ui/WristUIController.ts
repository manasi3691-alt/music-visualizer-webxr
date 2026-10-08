/**
 * WristUIController: Wires WristUI with the existing application systems.
 * Implements Task 4 — Desktop fallback (Tab key, DOM button, camera mounting).
 */

import { Group, Camera } from '@iwsdk/core';
import type { World } from '@iwsdk/core';
import { WristUI } from './WristUI.js';
import { WristUIState } from './WristUIState.js';
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
    subscribePhase: (listener: (phase: ExperiencePhase) => void) => () => void;
    subscribeXR?: (listener: (state: XRLifecycleState) => void) => () => void;
  };
  replay: () => void;
  world?: World;
  camera?: Camera;
}

export class WristUIController {
  private wristUI: WristUI | null = null;
  private deps: WristUIDependencies | null = null;
  private readonly rootGroup: Group = new Group();

  // Desktop integration handles
  private currentParent: Camera | Group | null = null;
  private domToggleButton: HTMLButtonElement | null = null;
  private boundOnKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private unsubscribeXR: (() => void) | null = null;

  init(deps: WristUIDependencies): void {
    this.deps = deps;
    this.wristUI = new WristUI(this.rootGroup);

    // 1. Desktop mounting: Position ~0.6m in front of camera
    this.setupDesktopMounting();

    // 2. Keyboard shortcut: Bind Tab to toggle open/close
    this.setupKeyboardShortcut();

    // 3. Desktop toggle button in corner
    this.setupDesktopDOMButton();

    // 4. Listen for XR lifecycle transitions to hide/show DOM toggle button
    if (deps.state.subscribeXR) {
      this.unsubscribeXR = deps.state.subscribeXR((xrState) => {
        if (this.domToggleButton) {
          this.domToggleButton.style.display = xrState === 'ACTIVE' ? 'none' : 'flex';
        }
      });
    }

    console.log('[WristUIController] Initialized with desktop fallback');
  }

  getUI(): WristUI | null {
    return this.wristUI;
  }

  getGroup(): Group {
    return this.rootGroup;
  }

  /**
   * Positions the panel ~0.6m in front of the camera on desktop (not attached to wrist)
   */
  private setupDesktopMounting(): void {
    const camera = this.deps?.camera || this.deps?.world?.camera;
    if (camera) {
      // Detach from previous parent if any
      if (this.currentParent) {
        this.currentParent.remove(this.rootGroup);
      }

      // Add to camera space: ~0.6m in front, slightly below eye level for comfortable reading
      camera.add(this.rootGroup);
      this.currentParent = camera;

      this.rootGroup.position.set(0.0, -0.04, -WRIST_UI_DIMENSIONS.desktopDistance);
      this.rootGroup.rotation.set(0, 0, 0);
    }
  }

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

  /**
   * Called every frame from ExperienceApp.update()
   */
  update(dt: number): void {
    if (this.wristUI) {
      this.wristUI.update(dt);
    }
  }

  dispose(): void {
    if (this.boundOnKeyDown) {
      window.removeEventListener('keydown', this.boundOnKeyDown);
      this.boundOnKeyDown = null;
    }

    if (this.domToggleButton && this.domToggleButton.parentElement) {
      this.domToggleButton.parentElement.removeChild(this.domToggleButton);
      this.domToggleButton = null;
    }

    if (this.unsubscribeXR) {
      this.unsubscribeXR();
      this.unsubscribeXR = null;
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
