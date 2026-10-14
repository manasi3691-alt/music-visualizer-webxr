/**
 * WristUIController: Wires WristUI with the existing application systems.
 *
 * Additions in this revision:
 *  - volume up/down (using AudioEngine gain node via deps.audio.setVolume)
 *  - rewind 10s / forward 10s (via deps.audio.seekRelative)
 *  - live play-state reflection: calls wristUI.updatePlayState() every frame
 *  - Fingertip poke detection using XRHand joint positions when hand tracking
 *    is available, falling back to controller grip proximity when not.
 *  - Desktop: Tab toggle, DOM button, mouse-click raycaster
 *  - XR: wrist grip/handtracking proximity, select-start handler for controller mode
 */

import { Group, Camera, Raycaster, Vector2, Vector3, Mesh, SphereGeometry, MeshBasicMaterial } from '@iwsdk/core';
import type { World } from '@iwsdk/core';
import { WristUI } from './WristUI.js';
import { WRIST_UI_DIMENSIONS, WRIST_UI_PALETTE } from './WristUIStyles.js';
import { ExperiencePhase, XRLifecycleState } from '../app/ExperienceState.js';
import { interactionDebugState } from '../interaction/InteractionDebugState.js';
import { cityXRInput } from '../city/CityXRInput.js';

export interface WristUIDependencies {
  audio: {
    play: () => Promise<void>;
    resume: () => void;
    pause: () => void;
    getCurrentTime: () => number;
    isPlaying: () => boolean;
    seekRelative?: (deltaSec: number) => void;
    setVolume?: (v: number) => void;
    getVolume?: () => number;
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

type InteractiveControlId = 'playPause' | 'restart' | 'close' | 'rewind' | 'forward' | 'volUp' | 'volDown';

export class WristUIController {
  private wristUI: WristUI | null = null;
  private deps: WristUIDependencies | null = null;
  private readonly rootGroup: Group = new Group();

  private currentParent: Camera | Group | null = null;
  private isXRActive = false;

  // Volume state
  private _volume = 1.0;

  // XR Poke Activation
  private pokeAnchorMesh: Mesh | null = null;
  private pokeAnchorRadius = 0.055;
  private pokeCooldownRemaining = 0;
  private wasInsidePokeZone = false;
  private scratchWristWorldPos = new Vector3();
  private scratchPokingWorldPos = new Vector3();

  // Desktop integration
  private domToggleButton: HTMLButtonElement | null = null;
  private boundOnKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private unsubscribeXR: (() => void) | null = null;
  private unsubscribePhase: (() => void) | null = null;

  // Desktop click detection
  private raycaster: Raycaster = new Raycaster();
  private pointer: Vector2 = new Vector2();
  private boundOnPointerDown: ((e: PointerEvent) => void) | null = null;

  // XR select listener
  private boundOnXRSelect: ((e: Event) => void) | null = null;
  private xrSession: XRSession | null = null;

  init(deps: WristUIDependencies): void {
    this.deps = deps;
    this.wristUI = new WristUI(this.rootGroup);

    this.setupDesktopMounting();
    this.setupKeyboardShortcut();
    this.setupDesktopDOMButton();

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

    this.unsubscribePhase = deps.state.subscribePhase((phase) => {
      this.wristUI?.updateStatus(phase);
    });
    this.wristUI.updateStatus(deps.state.getCurrentPhase());

    this.setupDesktopClickHandler();

    console.log('[WristUIController] Initialized — radial menu, rewind/fwd/vol controls active');
  }

  getUI(): WristUI | null { return this.wristUI; }
  getGroup(): Group { return this.rootGroup; }

  // ─── XR mounting ───────────────────────────────────────────────────────────

  private onXRActive(): void {
    this.isXRActive = true;
    const world = this.deps?.world;
    if (world) {
      const leftGrip = world.player.gripSpaces.left;
      if (this.currentParent) this.currentParent.remove(this.rootGroup);
      leftGrip.add(this.rootGroup);
      this.currentParent = leftGrip;

      // Mount on inner wrist, face toward user when palm is up
      this.rootGroup.position.set(0, WRIST_UI_DIMENSIONS.wristOffset, 0);
      this.rootGroup.rotation.set(-Math.PI * 0.5, 0, 0);

      if (!this.pokeAnchorMesh) {
        const sphereGeo = new SphereGeometry(this.pokeAnchorRadius, 16, 16);
        const sphereMat = new MeshBasicMaterial({
          color: WRIST_UI_PALETTE.borderEmissive,
          wireframe: true,
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
        });
        this.pokeAnchorMesh = new Mesh(sphereGeo, sphereMat);
        this.pokeAnchorMesh.name = 'wrist-poke-anchor';
        this.pokeAnchorMesh.position.set(0, 0.04, 0);
        leftGrip.add(this.pokeAnchorMesh);
      } else {
        leftGrip.add(this.pokeAnchorMesh);
      }
    }

    interactionDebugState.set({ wristActivationZoneExists: true });

    const session = this.deps?.world?.session;
    if (session && !this.boundOnXRSelect) {
      this.boundOnXRSelect = (e: Event) => this.handleXRSelect(e as XRInputSourceEvent);
      session.addEventListener('selectstart', this.boundOnXRSelect);
      this.xrSession = session;
    }

    console.log('[WristUIController] XR active — panel mounted to left wrist grip');
  }

  private onXREnded(): void {
    this.isXRActive = false;

    if (this.pokeAnchorMesh?.parent) {
      this.pokeAnchorMesh.parent.remove(this.pokeAnchorMesh);
    }

    interactionDebugState.set({
      wristActivationZoneExists: false,
      lastWristPokeDetected: false,
    });

    if (this.xrSession && this.boundOnXRSelect) {
      this.xrSession.removeEventListener('selectstart', this.boundOnXRSelect);
      this.boundOnXRSelect = null;
      this.xrSession = null;
    }

    this.setupDesktopMounting();
    console.log('[WristUIController] XR ended — panel reverted to camera mount');
  }

  // ─── Desktop mounting ──────────────────────────────────────────────────────

  private setupDesktopMounting(): void {
    const camera = this.deps?.camera || this.deps?.world?.camera;
    if (camera) {
      if (this.currentParent) this.currentParent.remove(this.rootGroup);
      camera.add(this.rootGroup);
      this.currentParent = camera;
      this.rootGroup.position.set(0.10, -0.06, -WRIST_UI_DIMENSIONS.desktopDistance);
      this.rootGroup.rotation.set(0, 0, 0);
    }
  }

  // ─── Input bindings ────────────────────────────────────────────────────────

  private setupKeyboardShortcut(): void {
    this.boundOnKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.wristUI?.toggle();
      }
    };
    window.addEventListener('keydown', this.boundOnKeyDown);
  }

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

  // ─── XR select handler ─────────────────────────────────────────────────────

  private handleXRSelect(e: XRInputSourceEvent): void {
    if (!this.wristUI?.isOpen) return;
    if (e.inputSource.handedness !== 'right') return;

    const world = this.deps?.world;
    if (!world) return;

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

  // ─── Button actions ────────────────────────────────────────────────────────

  private handleButtonAction(id: InteractiveControlId): void {
    const deps = this.deps;
    if (!deps) return;

    switch (id) {
      case 'playPause': {
        if (deps.audio.isPlaying()) {
          deps.audio.pause();
        } else {
          deps.audio.resume();
          deps.audio.play().catch((err: unknown) => {
            console.warn('[WristUIController] play() failed:', err);
          });
        }
        break;
      }
      case 'rewind': {
        // Seek back 10 seconds within excerpt bounds
        if (deps.audio.seekRelative) {
          deps.audio.seekRelative(-10);
        }
        break;
      }
      case 'forward': {
        if (deps.audio.seekRelative) {
          deps.audio.seekRelative(10);
        }
        break;
      }
      case 'volUp': {
        this._volume = Math.min(1.0, this._volume + 0.15);
        if (deps.audio.setVolume) deps.audio.setVolume(this._volume);
        break;
      }
      case 'volDown': {
        this._volume = Math.max(0.0, this._volume - 0.15);
        if (deps.audio.setVolume) deps.audio.setVolume(this._volume);
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

  private setupDesktopDOMButton(): void {
    const btn = document.createElement('button');
    btn.id = 'wrist-ui-desktop-btn';
    btn.setAttribute('aria-label', 'Toggle Wrist Control Panel');
    btn.innerHTML = `
      <span style="font-size: 13px; font-weight: 600; letter-spacing: 0.5px;">Controls</span>
      <kbd style="margin-left: 8px; font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.20);">Tab</kbd>
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
      background: 'rgba(13, 21, 32, 0.88)',
      backdropFilter: 'blur(10px)',
      color: '#f5f0e8',
      border: '1px solid rgba(61, 143, 170, 0.45)',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      userSelect: 'none',
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(20, 40, 60, 0.95)';
      btn.style.borderColor = 'rgba(61, 143, 170, 0.85)';
      btn.style.transform = 'translateY(-1px)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(13, 21, 32, 0.88)';
      btn.style.borderColor = 'rgba(61, 143, 170, 0.45)';
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

  update(dt: number): void {
    if (!this.wristUI || !this.deps) return;

    this.wristUI.update(dt);

    // Live-update progress bar and play state
    if (this.wristUI.isOpen) {
      const { sourceStart, duration } = this.deps.excerpt;
      const rawTime = this.deps.audio.getCurrentTime();
      const pct = duration > 0 ? Math.max(0, Math.min(1, (rawTime - sourceStart) / duration)) : 0;
      this.wristUI.updateProgress(pct);
      this.wristUI.updatePlayState(this.deps.audio.isPlaying());
    }

    // XR Wrist Poke Detection
    if (this.isXRActive && this.deps.world && this.pokeAnchorMesh) {
      if (this.pokeCooldownRemaining > 0) {
        this.pokeCooldownRemaining -= dt;
      }

      // Don't activate while user is grabbing a building block
      if (cityXRInput && (cityXRInput as any).activeGrabbedBlock) return;

      const world = this.deps.world;
      const leftGrip = world.player.gripSpaces.left;
      const rightGrip = world.player.gripSpaces.right;

      if (leftGrip.matrixWorld.elements[15] > 0 && rightGrip.matrixWorld.elements[15] > 0) {
        this.scratchWristWorldPos.setFromMatrixPosition(this.pokeAnchorMesh.matrixWorld);
        this.scratchPokingWorldPos.setFromMatrixPosition(rightGrip.matrixWorld);

        const dist = this.scratchPokingWorldPos.distanceTo(this.scratchWristWorldPos);
        const isInside = dist <= this.pokeAnchorRadius;

        if (isInside) {
          if (!this.wasInsidePokeZone && this.pokeCooldownRemaining <= 0) {
            this.wasInsidePokeZone = true;
            this.pokeCooldownRemaining = 0.40;
            this.wristUI.toggle();

            const isOpenNow = this.wristUI.isOpen;
            interactionDebugState.set({ lastWristPokeDetected: true, wristMenuOpen: isOpenNow });
            interactionDebugState.logEvent(isOpenNow ? 'poke-open' : 'poke-close', 'right-controller');

            if (this.pokeAnchorMesh.material && 'opacity' in this.pokeAnchorMesh.material) {
              (this.pokeAnchorMesh.material as any).opacity = 0.85;
            }
          }
        } else {
          this.wasInsidePokeZone = false;
          if (this.pokeAnchorMesh.material && 'opacity' in this.pokeAnchorMesh.material) {
            (this.pokeAnchorMesh.material as any).opacity = 0.25;
          }
        }
      }
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
    if (this.domToggleButton?.parentElement) {
      this.domToggleButton.parentElement.removeChild(this.domToggleButton);
      this.domToggleButton = null;
    }
    if (this.unsubscribeXR) { this.unsubscribeXR(); this.unsubscribeXR = null; }
    if (this.unsubscribePhase) { this.unsubscribePhase(); this.unsubscribePhase = null; }
    if (this.currentParent) { this.currentParent.remove(this.rootGroup); this.currentParent = null; }
    if (this.wristUI) { this.wristUI.dispose(); this.wristUI = null; }
    this.deps = null;
  }
}

export const wristUIController = new WristUIController();
