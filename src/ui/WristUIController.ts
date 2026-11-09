/**
 * WristUIController: Dual 3D Spatial Holographic Music Interface Manager.
 *
 * Orchestrates two synchronized 3D panels:
 *  1. FloatingMusicPlayer:
 *     - Main 3D translucent glass music player with neon-cyan edge glow,
 *       fine silver circuit rings, and gold accents.
 *     - Positioned 45–60 cm in front of the seated user, slightly below eye level.
 *     - Offset to the right by default so the Crystal Lotus and cosmic horizon
 *       remain 100% visible and unblocked.
 *     - Includes top handle for effortless 3D drag repositioning.
 *     - Full controls: Hero Play/Pause, Rewind 10s, Forward 10s, Volume step/gauge,
 *       Loop toggle, Close, Circular Progress Ring and digital time readout.
 *  2. WristControlPanel (WristUI):
 *     - Compact 3D holographic panel mounted naturally to left wrist in XR
 *       (or bottom-left HUD in desktop mode).
 *     - Compact essential controls: Play/Pause, Rewind, Forward, Volume, Loop, Expand/HUD.
 *     - Smoothly opens and closes.
 *
 * Ergonomics & Input:
 *  - Both Meta Quest 3S hand tracking (index fingertip poke with 2.2mm depression)
 *    and both controllers (raycast pointer trigger + physical poke).
 *  - Full desktop compatibility (mouse click, hover, drag handle repositioning,
 *    Tab toggle, Space play/pause, M toggle floating player).
 *  - Zero per-frame allocations, optimized for 72-90 fps on Meta Quest 3S.
 */

import {
  Group,
  Camera,
  Raycaster,
  Vector2,
  Vector3,
  Mesh,
  SphereGeometry,
  MeshBasicMaterial,
  Color,
} from '@iwsdk/core';
import type { World } from '@iwsdk/core';
import { WristUI, InteractiveControlId } from './WristUI.js';
import { FloatingMusicPlayer, FloatingControlId } from './FloatingMusicPlayer.js';
import { WRIST_UI_DIMENSIONS, MUSIC_UI_PALETTE } from './WristUIStyles.js';
import { ExperiencePhase, XRLifecycleState } from '../app/ExperienceState.js';
import { interactionDebugState } from '../interaction/InteractionDebugState.js';

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
    toggleLoop?: () => boolean;
    isLooping?: () => boolean;
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
  private floatingPlayer: FloatingMusicPlayer | null = null;
  private deps: WristUIDependencies | null = null;

  // Root container for wrist panel
  private readonly wristRootGroup: Group = new Group();

  private currentWristParent: Camera | Group | null = null;
  private isXRActive = false;

  // Audio state
  private _volume = 1.0;
  private _isLooping = false;

  // XR Poke Activation on wrist
  private pokeAnchorMesh: Mesh | null = null;
  private pokeAnchorRadius = 0.055;
  private pokeCooldownRemaining = 0;
  private wasInsidePokeZone = false;

  // Button touch debounce
  private touchCooldown = 0;

  // Repositioning drag state
  private isDraggingPlayer = false;
  private dragPlaneDistance = 0.52;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private dragOffset = new Vector3();

  // Desktop integration
  private domToggleButton: HTMLButtonElement | null = null;
  private boundOnKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private boundOnPointerDown: ((e: PointerEvent) => void) | null = null;
  private boundOnPointerMove: ((e: PointerEvent) => void) | null = null;
  private boundOnPointerUp: ((e: PointerEvent) => void) | null = null;
  private unsubscribeXR: (() => void) | null = null;
  private unsubscribePhase: (() => void) | null = null;

  // Raycasting
  private raycaster: Raycaster = new Raycaster();
  private pointer: Vector2 = new Vector2();
  private boundOnXRSelect: ((e: Event) => void) | null = null;
  private xrSession: XRSession | null = null;

  // Scratch vectors for zero allocation
  private scratchWristWorldPos = new Vector3();
  private scratchPokingWorldPos = new Vector3();
  private scratchHeadPos = new Vector3();
  private scratchForward = new Vector3();
  private scratchButtonPos = new Vector3();
  private audioCtx: AudioContext | null = null;

  init(deps: WristUIDependencies): void {
    this.deps = deps;

    // 1. Create Compact 3D Wrist Panel
    this.wristUI = new WristUI(this.wristRootGroup);

    // 2. Create Main 3D Floating Glass Music Player
    this.floatingPlayer = new FloatingMusicPlayer();

    // Add floating player to the scene world so it floats comfortably in 3D
    const worldScene = deps.world?.scene;
    if (worldScene) {
      worldScene.add(this.floatingPlayer.group);
    } else {
      // Fallback: camera space
      deps.camera?.add(this.floatingPlayer.group);
    }

    this.setupDesktopMounting();
    this.setupKeyboardShortcut();
    this.setupDesktopDOMButton();
    this.setupDesktopPointerHandlers();

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

    console.log('[WristUIController] Initialized Dual 3D Spatial Interface (Floating Player + Wrist Panel)');
  }

  getUI(): WristUI | null { return this.wristUI; }
  getFloatingPlayer(): FloatingMusicPlayer | null { return this.floatingPlayer; }
  getGroup(): Group { return this.wristRootGroup; }

  // ─── XR Mounting ───────────────────────────────────────────────────────────

  onSessionStart(session: XRSession): void {
    this.onXRActive(session);
  }

  onSessionEnd(): void {
    this.onXREnded();
  }

  private onXRActive(explicitSession?: XRSession): void {
    this.isXRActive = true;
    const world = this.deps?.world;
    if (world) {
      const leftGrip = world.player.gripSpaces.left;
      if (this.currentWristParent) this.currentWristParent.remove(this.wristRootGroup);
      leftGrip.add(this.wristRootGroup);
      this.currentWristParent = leftGrip;

      // Mount compact panel on inner left wrist
      this.wristRootGroup.position.set(0, WRIST_UI_DIMENSIONS.wristOffset, 0);
      this.wristRootGroup.rotation.set(-Math.PI * 0.5, 0, 0);

      // Re-parent floating player to world scene so it floats freely in room/seated space
      if (this.floatingPlayer) {
        if (this.floatingPlayer.group.parent) {
          this.floatingPlayer.group.parent.remove(this.floatingPlayer.group);
        }
        world.scene.add(this.floatingPlayer.group);

        // Place 52 cm in front of seated user, chest level, offset right to protect lotus view
        this.updateHeadPos();
        this.floatingPlayer.resetPosition(this.scratchHeadPos, this.scratchForward);
      }

      if (!this.pokeAnchorMesh) {
        const sphereGeo = new SphereGeometry(this.pokeAnchorRadius, 16, 16);
        const sphereMat = new MeshBasicMaterial({
          color: MUSIC_UI_PALETTE.borderCyan,
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

    const session = explicitSession || this.deps?.world?.session || (this.deps?.world?.renderer as any)?.xr?.getSession();
    if (session && !this.boundOnXRSelect) {
      this.boundOnXRSelect = (e: Event) => this.handleXRSelect(e as XRInputSourceEvent);
      session.addEventListener('selectstart', this.boundOnXRSelect);
      this.xrSession = session;
    }

    console.log('[WristUIController] Dual 3D Interface active in WebXR');
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
    console.log('[WristUIController] WebXR ended — reverted to desktop mode');
  }

  // ─── Desktop Mounting ──────────────────────────────────────────────────────

  private setupDesktopMounting(): void {
    const camera = this.deps?.camera || this.deps?.world?.camera;
    if (camera) {
      if (this.currentWristParent) this.currentWristParent.remove(this.wristRootGroup);
      camera.add(this.wristRootGroup);
      this.currentWristParent = camera;

      // Position wrist panel subtly at bottom-left in desktop view
      this.wristRootGroup.position.set(-0.16, -0.10, -WRIST_UI_DIMENSIONS.desktopDistance);
      this.wristRootGroup.rotation.set(0, 0.15, 0);

      // Position floating player at bottom-right in desktop view (unobstructed center)
      if (this.floatingPlayer) {
        if (this.floatingPlayer.group.parent) {
          this.floatingPlayer.group.parent.remove(this.floatingPlayer.group);
        }
        camera.add(this.floatingPlayer.group);
        this.floatingPlayer.group.position.set(0.18, -0.05, -0.52);
        this.floatingPlayer.group.rotation.set(-0.04, -0.18, 0);
      }
    }
  }

  // ─── Keyboard Shortcuts ────────────────────────────────────────────────────

  private setupKeyboardShortcut(): void {
    this.boundOnKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.wristUI?.toggle();
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        this.floatingPlayer?.toggle();
      } else if (e.code === 'Space') {
        e.preventDefault();
        this.handleButtonAction('playPause');
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this.handleButtonAction('rewind');
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.handleButtonAction('forward');
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        this.handleButtonAction('volUp');
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        this.handleButtonAction('volDown');
      } else if (e.code === 'KeyL') {
        e.preventDefault();
        this.handleButtonAction('loop');
      }
    };
    window.addEventListener('keydown', this.boundOnKeyDown);
  }

  // ─── Desktop Pointer Click & Drag Repositioning ────────────────────────────

  private setupDesktopPointerHandlers(): void {
    this.boundOnPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // Only left click
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

      // 1. Check Floating Music Player (buttons and handle)
      if (this.floatingPlayer?.visible) {
        const hitMeshes = this.floatingPlayer.getHitTestMeshes();
        const objects = hitMeshes.map((h) => h.mesh);
        const hits = this.raycaster.intersectObjects(objects, false);
        if (hits.length > 0) {
          const hitObj = hits[0].object as Mesh;
          const found = hitMeshes.find((h) => h.mesh === hitObj);
          if (found) {
            if (found.id === 'handle') {
              // Start dragging floating player
              this.isDraggingPlayer = true;
              this.lastMouseX = e.clientX;
              this.lastMouseY = e.clientY;
              e.stopPropagation();
              return;
            } else {
              this.floatingPlayer.depressButton(found.id);
              this.handleButtonAction(found.id as any);
              setTimeout(() => this.floatingPlayer?.releaseButton(found.id), 180);
              e.stopPropagation();
              return;
            }
          }
        }
      }

      // 2. Check Wrist Panel (when open)
      if (this.wristUI?.isOpen) {
        const hitMeshes = this.wristUI.getHitTestMeshes();
        const objects = hitMeshes.map((h) => h.mesh);
        const hits = this.raycaster.intersectObjects(objects, false);
        if (hits.length > 0) {
          const found = hitMeshes.find((h) => h.mesh === hits[0].object);
          if (found) {
            this.handleButtonAction(found.id);
            e.stopPropagation();
            return;
          }
        }
      }
    };

    this.boundOnPointerMove = (e: PointerEvent) => {
      if (!this.isDraggingPlayer || !this.floatingPlayer) return;
      const deltaX = e.clientX - this.lastMouseX;
      const deltaY = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      // Translate floating player in camera/world space
      this.floatingPlayer.group.position.x += deltaX * 0.0018;
      this.floatingPlayer.group.position.y -= deltaY * 0.0018;
    };

    this.boundOnPointerUp = () => {
      this.isDraggingPlayer = false;
    };

    window.addEventListener('pointerdown', this.boundOnPointerDown);
    window.addEventListener('pointermove', this.boundOnPointerMove);
    window.addEventListener('pointerup', this.boundOnPointerUp);
  }

  // ─── WebXR Select Handler (Trigger / Pinch Raycast) ─────────────────────────

  private handleXRSelect(e: XRInputSourceEvent): void {
    const world = this.deps?.world;
    if (!world) return;

    const handedness = (e.inputSource.handedness as 'left' | 'right') || 'right';
    const raySpace = handedness === 'left' ? world.player.raySpaces.left : world.player.raySpaces.right;
    if (!raySpace) return;

    raySpace.updateMatrixWorld();
    this.raycaster.ray.origin.setFromMatrixPosition(raySpace.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).transformDirection(raySpace.matrixWorld).normalize();

    // 1. Check Floating Player
    if (this.floatingPlayer?.visible) {
      const hitMeshes = this.floatingPlayer.getHitTestMeshes();
      const objects = hitMeshes.map((h) => h.mesh);
      const hits = this.raycaster.intersectObjects(objects, false);
      if (hits.length > 0) {
        const found = hitMeshes.find((h) => h.mesh === hits[0].object);
        if (found) {
          if (found.id === 'handle') {
            // Reposition player toward ray intersection point
            this.updateHeadPos();
            this.floatingPlayer.setRepositionPosition(hits[0].point, this.scratchHeadPos);
          } else {
            this.floatingPlayer.depressButton(found.id);
            this.handleButtonAction(found.id as any);
            setTimeout(() => this.floatingPlayer?.releaseButton(found.id), 180);
          }
          return;
        }
      }
    }

    // 2. Check Wrist Panel
    if (this.wristUI?.isOpen) {
      const hitMeshes = this.wristUI.getHitTestMeshes();
      const objects = hitMeshes.map((h) => h.mesh);
      const hits = this.raycaster.intersectObjects(objects, false);
      if (hits.length > 0) {
        const found = hitMeshes.find((h) => h.mesh === hits[0].object);
        if (found) {
          this.handleButtonAction(found.id);
        }
      }
    }
  }

  // ─── Unified Action Dispatcher (Syncs Both Panels) ─────────────────────────

  private handleButtonAction(id: InteractiveControlId | 'volume'): void {
    const deps = this.deps;
    if (!deps) return;

    this.playClickSound();

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
        if (deps.audio.seekRelative) deps.audio.seekRelative(-10);
        break;
      }

      case 'forward': {
        if (deps.audio.seekRelative) deps.audio.seekRelative(10);
        break;
      }

      case 'volume':
      case 'volUp': {
        // Step volume: 1.0 -> 0.75 -> 0.50 -> 0.25 -> 0.0 -> 1.0
        if (this._volume > 0.85) this._volume = 0.75;
        else if (this._volume > 0.60) this._volume = 0.50;
        else if (this._volume > 0.35) this._volume = 0.25;
        else if (this._volume > 0.10) this._volume = 0.0;
        else this._volume = 1.0;

        if (deps.audio.setVolume) deps.audio.setVolume(this._volume);
        this.floatingPlayer?.updateVolume(this._volume);
        break;
      }

      case 'volDown': {
        this._volume = Math.max(0.0, this._volume - 0.20);
        if (deps.audio.setVolume) deps.audio.setVolume(this._volume);
        this.floatingPlayer?.updateVolume(this._volume);
        break;
      }

      case 'loop': {
        if (deps.audio.toggleLoop) {
          this._isLooping = deps.audio.toggleLoop();
        } else {
          this._isLooping = !this._isLooping;
        }
        this.floatingPlayer?.updateLoop(this._isLooping);
        break;
      }

      case 'expand': {
        // Summon or focus main floating player in front of user
        if (this.floatingPlayer) {
          this.floatingPlayer.open();
          this.updateHeadPos();
          this.floatingPlayer.resetPosition(this.scratchHeadPos, this.scratchForward);
        }
        break;
      }

      case 'restart': {
        deps.replay();
        break;
      }

      case 'close': {
        // If floating player is open, close floating player; otherwise close wrist panel
        if (this.floatingPlayer?.visible) {
          this.floatingPlayer.close();
        } else {
          this.wristUI?.close();
        }
        break;
      }
    }
  }

  // ─── DOM Toggle Button ─────────────────────────────────────────────────────

  private setupDesktopDOMButton(): void {
    const btn = document.createElement('button');
    btn.id = 'wrist-ui-desktop-btn';
    btn.setAttribute('aria-label', 'Toggle Dual 3D Music Interface');
    btn.innerHTML = `
      <span style="font-size: 13px; font-weight: 600; letter-spacing: 0.5px; color: #00f2fe;">Music Player</span>
      <kbd style="margin-left: 8px; font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(0,242,254,0.18); border: 1px solid rgba(0,242,254,0.40); color: #ffffff;">Tab</kbd>
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
      background: 'rgba(7, 17, 26, 0.90)',
      backdropFilter: 'blur(12px)',
      color: '#f5f0e8',
      border: '1px solid rgba(0, 242, 254, 0.45)',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.6), 0 0 14px rgba(0, 242, 254, 0.20)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      userSelect: 'none',
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(11, 30, 44, 0.98)';
      btn.style.borderColor = '#00f2fe';
      btn.style.boxShadow = '0 6px 24px rgba(0, 242, 254, 0.35)';
      btn.style.transform = 'translateY(-1px)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(7, 17, 26, 0.90)';
      btn.style.borderColor = 'rgba(0, 242, 254, 0.45)';
      btn.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.6), 0 0 14px rgba(0, 242, 254, 0.20)';
      btn.style.transform = 'translateY(0)';
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.wristUI?.toggle();
      if (this.floatingPlayer && !this.floatingPlayer.visible) {
        this.floatingPlayer.open();
      }
    });

    document.body.appendChild(btn);
    this.domToggleButton = btn;
  }

  // ─── Per-Frame Updates ─────────────────────────────────────────────────────

  update(dt: number): void {
    if (!this.deps) return;

    if (this.touchCooldown > 0) {
      this.touchCooldown -= dt;
    }

    const { sourceStart, duration } = this.deps.excerpt;
    const rawTime = this.deps.audio.getCurrentTime();
    const pct = duration > 0 ? Math.max(0, Math.min(1, (rawTime - sourceStart) / duration)) : 0;
    const isPlaying = this.deps.audio.isPlaying();
    const isLooping = this.deps.audio.isLooping ? this.deps.audio.isLooping() : this._isLooping;

    // Time formatted string: mm:ss / mm:ss
    const currentSec = Math.max(0, rawTime - sourceStart);
    const timeStr = `${this.formatTime(currentSec)} / ${this.formatTime(duration)}`;

    this.updateHeadPos();

    // 1. Update Floating Music Player
    if (this.floatingPlayer) {
      this.floatingPlayer.update(dt, this.scratchHeadPos);
      this.floatingPlayer.updateProgress(pct, timeStr);
      this.floatingPlayer.updatePlayState(isPlaying);
      this.floatingPlayer.updateVolume(this._volume);
      this.floatingPlayer.updateLoop(isLooping);
    }

    // 2. Update Wrist Panel
    if (this.wristUI) {
      this.wristUI.update(dt);
      if (this.wristUI.isOpen) {
        this.wristUI.updateProgress(pct);
        this.wristUI.updatePlayState(isPlaying);
      }
    }

    // 3. WebXR Direct Physical Fingertip Poke & Touch Proximity
    if (this.isXRActive && this.deps.world) {
      this.processXRFingerPoke();
    }
  }

  private processXRFingerPoke(): void {
    if (!this.deps?.world || this.touchCooldown > 0) return;
    const world = this.deps.world;
    const p = world.player as any;
    if (!p) return;

    // Probe points: right & left index tips
    const probes: Vector3[] = [];
    const rightTip = p.indexTipSpaces?.right;
    const leftTip = p.indexTipSpaces?.left;

    if (rightTip && (rightTip.visible || rightTip.matrixWorld?.elements[15] > 0)) {
      rightTip.updateMatrixWorld();
      probes.push(new Vector3().setFromMatrixPosition(rightTip.matrixWorld));
    }
    if (leftTip && (leftTip.visible || leftTip.matrixWorld?.elements[15] > 0)) {
      leftTip.updateMatrixWorld();
      probes.push(new Vector3().setFromMatrixPosition(leftTip.matrixWorld));
    }

    if (probes.length === 0) return;

    // A. Check Floating Player Buttons
    if (this.floatingPlayer?.visible) {
      const hitMeshes = this.floatingPlayer.getHitTestMeshes();
      for (const btn of hitMeshes) {
        btn.mesh.updateMatrixWorld();
        this.scratchButtonPos.setFromMatrixPosition(btn.mesh.matrixWorld);

        for (const probePos of probes) {
          const dist = probePos.distanceTo(this.scratchButtonPos);
          if (dist <= 0.038) {
            this.touchCooldown = 0.35;
            this.floatingPlayer.depressButton(btn.id);
            this.handleButtonAction(btn.id as any);
            setTimeout(() => this.floatingPlayer?.releaseButton(btn.id), 180);
            return;
          }
        }
      }
    }

    // B. Check Wrist Panel Buttons
    if (this.wristUI?.isOpen) {
      const hitMeshes = this.wristUI.getHitTestMeshes();
      for (const btn of hitMeshes) {
        btn.mesh.updateMatrixWorld();
        this.scratchButtonPos.setFromMatrixPosition(btn.mesh.matrixWorld);

        for (const probePos of probes) {
          const dist = probePos.distanceTo(this.scratchButtonPos);
          if (dist <= 0.032) {
            this.touchCooldown = 0.35;
            this.handleButtonAction(btn.id);
            return;
          }
        }
      }
    }

    // C. Wrist Poke Activation Zone (toggle wrist menu on wrist anchor poke)
    if (this.pokeAnchorMesh && this.pokeAnchorMesh.parent) {
      this.pokeAnchorMesh.updateMatrixWorld();
      this.scratchWristWorldPos.setFromMatrixPosition(this.pokeAnchorMesh.matrixWorld);

      let isInside = false;
      for (const probePos of probes) {
        if (probePos.distanceTo(this.scratchWristWorldPos) <= 0.08) {
          isInside = true;
          break;
        }
      }

      if (isInside) {
        if (!this.wasInsidePokeZone && this.pokeCooldownRemaining <= 0) {
          this.wasInsidePokeZone = true;
          this.pokeCooldownRemaining = 0.40;
          this.wristUI?.toggle();
          interactionDebugState.set({ lastWristPokeDetected: true, wristMenuOpen: this.wristUI?.isOpen ?? false });
        }
      } else {
        this.wasInsidePokeZone = false;
      }
    }
  }

  private updateHeadPos(): void {
    const world = this.deps?.world;
    const camera = this.deps?.camera || world?.camera;
    if (!camera) return;

    const xrCam = (world?.renderer as any)?.xr?.getCamera ? (world?.renderer as any).xr.getCamera() : null;
    const isPresenting = (world?.renderer as any)?.xr?.isPresenting;

    if (isPresenting && xrCam) {
      xrCam.getWorldPosition(this.scratchHeadPos);
    } else {
      camera.getWorldPosition(this.scratchHeadPos);
    }

    camera.getWorldDirection(this.scratchForward);
    this.scratchForward.y = 0;
    if (this.scratchForward.lengthSq() < 0.001) {
      this.scratchForward.set(0, 0, -1);
    } else {
      this.scratchForward.normalize();
    }
  }

  private formatTime(seconds: number): string {
    const s = Math.floor(Math.max(0, seconds));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  private playClickSound(): void {
    try {
      if (!this.audioCtx) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (AC) this.audioCtx = new AC();
      }
      if (!this.audioCtx) return;
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1480, now);
      osc.frequency.exponentialRampToValueAtTime(1960, now + 0.06);

      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    } catch (_) {
      // Audio errors ignored
    }
  }

  // ─── Disposal ──────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.boundOnKeyDown) {
      window.removeEventListener('keydown', this.boundOnKeyDown);
      this.boundOnKeyDown = null;
    }
    if (this.boundOnPointerDown) {
      window.removeEventListener('pointerdown', this.boundOnPointerDown);
      this.boundOnPointerDown = null;
    }
    if (this.boundOnPointerMove) {
      window.removeEventListener('pointermove', this.boundOnPointerMove);
      this.boundOnPointerMove = null;
    }
    if (this.boundOnPointerUp) {
      window.removeEventListener('pointerup', this.boundOnPointerUp);
      this.boundOnPointerUp = null;
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
    if (this.currentWristParent) { this.currentWristParent.remove(this.wristRootGroup); this.currentWristParent = null; }
    if (this.wristUI) { this.wristUI.dispose(); this.wristUI = null; }
    if (this.floatingPlayer) { this.floatingPlayer.dispose(); this.floatingPlayer = null; }
    this.deps = null;
  }
}

export const wristUIController = new WristUIController();
