/**
 * WristUIController: Single 3D Holographic Music Interface Manager.
 *
 * Orchestrates ONE sculptural 3D holographic music control interface
 * (FloatingMusicPlayer), cleanly replacing the old dual/wrist panel design.
 *
 * Ergonomics & Input:
 *  - Positioned 45-60 cm in front of the seated user, slightly below eye level,
 *    offset to keep the Crystal Lotus and key visuals unobstructed.
 *  - Supports Meta Quest 3S hand tracking (index fingertip poke & pinch ray),
 *    both controllers (ray targeting + trigger + physical touch), and desktop
 *    mouse hover/click/drag.
 *  - Subtle glowing hover feedback whenever a hand, controller ray, or mouse
 *    targets any control.
 *  - Zero per-frame heap allocations; optimized for 72-90 fps on Meta Quest 3S.
 */

import {
  Camera,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Raycaster,
  Vector2,
  Vector3,
  Color,
} from '@iwsdk/core';
import type { World } from '@iwsdk/core';
import { FloatingMusicPlayer, FloatingControlId } from './FloatingMusicPlayer.js';
import { MUSIC_UI_PALETTE } from './WristUIStyles.js';
import { ExperiencePhase, XRLifecycleState } from '../app/ExperienceState.js';
import { interactionDebugState } from '../interaction/InteractionDebugState.js';

export interface MusicUIDependencies {
  audio: {
    play: () => Promise<void>;
    playOrResume?: () => Promise<void>;
    resume: () => void | Promise<void>;
    pause: () => void;
    skipToEnd?: () => void;
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
  getAudioIntensity?: () => number;
}

export type WristUIDependencies = MusicUIDependencies;

export class WristUIController {
  private floatingPlayer: FloatingMusicPlayer | null = null;
  private deps: MusicUIDependencies | null = null;

  private isXRActive = false;
  private needsInitialXRPlacement = false;
  private _volume = 1.0;

  // Minimal wrist summon star-crystal: ONLY visible in XR after user clicks Close (X)
  private summonBeaconMesh: Mesh | null = null;
  private summonCooldown = 0;

  // Touch & hover state
  private touchCooldown = 0;
  private wasInTouchZone = false;
  private desktopHoveredId: FloatingControlId | null = null;
  private targetedIds: Set<FloatingControlId> = new Set();
  private hitTestObjects: Mesh[] = [];
  private hitTestEntries: { mesh: Mesh; id: FloatingControlId }[] = [];

  // Repositioning drag state
  private isDraggingPlayer = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Gamepad button edge detection for reopening closed UI in VR
  private prevSummonBtnLeft = false;
  private prevSummonBtnRight = false;

  // Listeners & DOM
  private domToggleButton: HTMLButtonElement | null = null;
  private boundOnKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private boundOnPointerDown: ((e: PointerEvent) => void) | null = null;
  private boundOnPointerMove: ((e: PointerEvent) => void) | null = null;
  private boundOnPointerUp: ((e: PointerEvent) => void) | null = null;
  private boundOnXRSelect: ((e: Event) => void) | null = null;
  private unsubscribeXR: (() => void) | null = null;
  private unsubscribePhase: (() => void) | null = null;
  private xrSession: XRSession | null = null;

  // Pre-allocated scratch objects (zero per-frame heap allocations)
  private raycaster: Raycaster = new Raycaster();
  private pointer: Vector2 = new Vector2();
  private scratchHeadPos = new Vector3();
  private scratchForward = new Vector3();
  private scratchButtonPos = new Vector3();
  private scratchBeaconPos = new Vector3();
  private scratchProbePositions: Vector3[] = [
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
  ];
  private scratchProbeCount = 0;
  private scratchRayOrigin = new Vector3();
  private scratchRayDir = new Vector3();
  private audioCtx: AudioContext | null = null;

  init(deps: MusicUIDependencies): void {
    this.deps = deps;

    // Create the SINGLE 3D Holographic Music Interface
    this.floatingPlayer = new FloatingMusicPlayer();

    const worldScene = deps.world?.scene;
    if (worldScene) {
      worldScene.add(this.floatingPlayer.group);
    } else {
      deps.camera?.add(this.floatingPlayer.group);
    }

    // Cache hit-test mesh list cleanly
    this.hitTestEntries = this.floatingPlayer.getHitTestMeshes();
    this.hitTestObjects = this.hitTestEntries.map((entry) => entry.mesh);

    this.setupDesktopMounting();
    this.setupKeyboardShortcuts();
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

    this.unsubscribePhase = deps.state.subscribePhase(() => {
      // Progress pill updates dynamically inside update()
    });

    console.log('[MusicUIController] Initialized Single 3D Holographic Interface');
  }

  getFloatingPlayer(): FloatingMusicPlayer | null {
    return this.floatingPlayer;
  }

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
    if (world && this.floatingPlayer) {
      if (this.floatingPlayer.group.parent) {
        this.floatingPlayer.group.parent.remove(this.floatingPlayer.group);
      }
      world.scene.add(this.floatingPlayer.group);

      // Position 50 cm in front of seated user, chest level, offset right so lotus is clear
      this.updateHeadPos();
      this.floatingPlayer.resetPosition(this.scratchHeadPos, this.scratchForward);
      this.needsInitialXRPlacement = true;

      // Subtle tiny summon crystal ONLY shown on left wrist if user closes the main UI
      if (!this.summonBeaconMesh) {
        const geo = new OctahedronGeometry(0.011, 0);
        geo.scale(0.8, 1.3, 0.8);
        const mat = new MeshBasicMaterial({
          color: new Color(MUSIC_UI_PALETTE.borderCyan),
          transparent: true,
          opacity: 0.78,
        });
        this.summonBeaconMesh = new Mesh(geo, mat);
        this.summonBeaconMesh.name = 'HoloUI_SummonBeacon';
        this.summonBeaconMesh.position.set(0, 0.055, 0);
      }
      this.summonBeaconMesh.visible = !this.floatingPlayer.visible;
      world.player.gripSpaces.left.add(this.summonBeaconMesh);
    }

    interactionDebugState.set({ wristActivationZoneExists: false });

    const session = explicitSession || this.deps?.world?.session || (this.deps?.world?.renderer as any)?.xr?.getSession();
    if (session && !this.boundOnXRSelect) {
      this.boundOnXRSelect = (e: Event) => this.handleXRSelect(e as XRInputSourceEvent);
      session.addEventListener('selectstart', this.boundOnXRSelect);
      this.xrSession = session;
    }

    console.log('[MusicUIController] Single 3D Holographic Interface active in WebXR');
  }

  private onXREnded(): void {
    this.isXRActive = false;

    if (this.summonBeaconMesh?.parent) {
      this.summonBeaconMesh.parent.remove(this.summonBeaconMesh);
    }

    if (this.xrSession && this.boundOnXRSelect) {
      this.xrSession.removeEventListener('selectstart', this.boundOnXRSelect);
      this.boundOnXRSelect = null;
      this.xrSession = null;
    }

    this.setupDesktopMounting();
  }

  // ─── Desktop Mounting ──────────────────────────────────────────────────────

  private setupDesktopMounting(): void {
    const camera = this.deps?.camera || this.deps?.world?.camera;
    if (camera && this.floatingPlayer) {
      if (this.floatingPlayer.group.parent) {
        this.floatingPlayer.group.parent.remove(this.floatingPlayer.group);
      }
      camera.add(this.floatingPlayer.group);
      this.floatingPlayer.group.position.set(0.23, -0.09, -0.52);
      this.floatingPlayer.group.rotation.set(-0.06, -0.24, 0);
    }
  }

  // ─── Keyboard Shortcuts ────────────────────────────────────────────────────

  private setupKeyboardShortcuts(): void {
    this.boundOnKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Tab' || e.code === 'KeyM') {
        e.preventDefault();
        this.floatingPlayer?.toggle();
        this.syncDOMToggleLabel();
      } else if (e.code === 'Space') {
        e.preventDefault();
        this.handleControlAction('playPause');
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this.handleControlAction('rewind');
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.handleControlAction('forward');
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        this.adjustVolume(0.25);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        this.adjustVolume(-0.25);
      }
    };
    window.addEventListener('keydown', this.boundOnKeyDown);
  }

  // ─── Desktop Pointer Hover, Click & Drag (Capture Phase) ───────────────────

  private setupDesktopPointerHandlers(): void {
    this.boundOnPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !this.floatingPlayer?.visible) return;
      const canvas = document.querySelector('canvas');
      if (!canvas || e.target !== canvas) return;

      const rect = canvas.getBoundingClientRect();
      this.pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      const camera = this.deps?.camera || this.deps?.world?.camera;
      if (!camera) return;

      this.raycaster.setFromCamera(this.pointer, camera);
      const hits = this.raycaster.intersectObjects(this.hitTestObjects, false);
      if (hits.length > 0) {
        const hitObj = hits[0].object as Mesh;
        const found = this.hitTestEntries.find((entry) => entry.mesh === hitObj);
        if (found) {
          e.stopPropagation();
          if (found.id === 'handle') {
            this.isDraggingPlayer = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            canvas.style.cursor = 'grabbing';
          } else {
            this.floatingPlayer.depressButton(found.id);
            this.handleControlAction(found.id);
            setTimeout(() => this.floatingPlayer?.releaseButton(found.id), 180);
          }
        }
      }
    };

    this.boundOnPointerMove = (e: PointerEvent) => {
      if (!this.floatingPlayer?.visible) {
        this.desktopHoveredId = null;
        return;
      }

      if (this.isDraggingPlayer) {
        const deltaX = e.clientX - this.lastMouseX;
        const deltaY = e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;

        this.floatingPlayer.group.position.x += deltaX * 0.0016;
        this.floatingPlayer.group.position.y -= deltaY * 0.0016;
        e.stopPropagation();
        return;
      }

      const canvas = document.querySelector('canvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      this.pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      const camera = this.deps?.camera || this.deps?.world?.camera;
      if (!camera) return;

      this.raycaster.setFromCamera(this.pointer, camera);
      const hits = this.raycaster.intersectObjects(this.hitTestObjects, false);
      if (hits.length > 0) {
        const hitObj = hits[0].object as Mesh;
        const found = this.hitTestEntries.find((entry) => entry.mesh === hitObj);
        this.desktopHoveredId = found ? found.id : null;
        canvas.style.cursor = found?.id === 'handle' ? 'grab' : 'pointer';
      } else {
        if (this.desktopHoveredId !== null) {
          canvas.style.cursor = '';
        }
        this.desktopHoveredId = null;
      }
    };

    this.boundOnPointerUp = () => {
      if (this.isDraggingPlayer) {
        this.isDraggingPlayer = false;
        const canvas = document.querySelector('canvas');
        if (canvas) canvas.style.cursor = '';
      }
    };

    window.addEventListener('pointerdown', this.boundOnPointerDown, { capture: true });
    window.addEventListener('pointermove', this.boundOnPointerMove);
    window.addEventListener('pointerup', this.boundOnPointerUp);
  }

  // ─── WebXR Select Handler (Controller Trigger & Hand Tracking Pinch) ──────

  private handleXRSelect(e: XRInputSourceEvent): void {
    const world = this.deps?.world;
    if (!world || !this.floatingPlayer) return;

    const handedness = (e.inputSource.handedness as 'left' | 'right') || 'right';
    const raySpace = handedness === 'left' ? world.player.raySpaces.left : world.player.raySpaces.right;
    if (!raySpace) return;

    raySpace.updateMatrixWorld();
    this.raycaster.ray.origin.setFromMatrixPosition(raySpace.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).transformDirection(raySpace.matrixWorld).normalize();

    if (!this.floatingPlayer.visible) {
      // Allow pointing & pinching/selecting the wrist summon crystal to reopen
      if (this.summonBeaconMesh?.visible) {
        const beaconHits = this.raycaster.intersectObject(this.summonBeaconMesh, false);
        if (beaconHits.length > 0) {
          this.summonUI();
        }
      }
      return;
    }

    const hits = this.raycaster.intersectObjects(this.hitTestObjects, false);
    if (hits.length > 0) {
      const hitObj = hits[0].object as Mesh;
      const found = this.hitTestEntries.find((entry) => entry.mesh === hitObj);
      if (found) {
        if (found.id === 'handle') {
          this.updateHeadPos();
          this.floatingPlayer.setRepositionPosition(hits[0].point, this.scratchHeadPos);
        } else {
          this.floatingPlayer.depressButton(found.id);
          this.handleControlAction(found.id);
          setTimeout(() => this.floatingPlayer?.releaseButton(found.id), 180);
        }
      }
    }
  }

  // ─── Control Action Dispatcher ─────────────────────────────────────────────

  private handleControlAction(id: FloatingControlId): void {
    const deps = this.deps;
    if (!deps) return;

    this.playClickSound();

    switch (id) {
      case 'playPause': {
        if (deps.audio.isPlaying()) {
          deps.audio.pause();
        } else if (deps.audio.playOrResume) {
          deps.audio.playOrResume().catch((err: unknown) => {
            console.warn('[MusicUIController] playOrResume() failed:', err);
          });
        } else {
          deps.audio.play().catch((err: unknown) => {
            console.warn('[MusicUIController] play() failed:', err);
          });
        }
        break;
      }

      case 'restart': {
        deps.replay();
        break;
      }

      case 'rewind': {
        deps.audio.seekRelative?.(-10);
        break;
      }

      case 'forward': {
        deps.audio.seekRelative?.(10);
        break;
      }

      case 'skipToEnd': {
        if (deps.audio.skipToEnd) {
          deps.audio.skipToEnd();
        } else if (deps.audio.seekRelative) {
          deps.audio.seekRelative(deps.excerpt.duration);
        }
        break;
      }

      case 'volume': {
        // Intuitive single-tap cycle: 100% -> 75% -> 50% -> 25% -> 0% -> 100%
        if (this._volume > 0.85) this._volume = 0.75;
        else if (this._volume > 0.60) this._volume = 0.50;
        else if (this._volume > 0.35) this._volume = 0.25;
        else if (this._volume > 0.10) this._volume = 0.0;
        else this._volume = 1.0;

        deps.audio.setVolume?.(this._volume);
        this.floatingPlayer?.updateVolume(this._volume);
        break;
      }

      case 'close': {
        this.floatingPlayer?.close();
        this.syncDOMToggleLabel();
        break;
      }
    }
  }

  private adjustVolume(delta: number): void {
    this._volume = Math.max(0, Math.min(1, Math.round((this._volume + delta) * 100) / 100));
    this.deps?.audio.setVolume?.(this._volume);
    this.floatingPlayer?.updateVolume(this._volume);
    this.playClickSound();
  }

  private summonUI(): void {
    if (!this.floatingPlayer || this.summonCooldown > 0) return;
    this.summonCooldown = 0.5;
    this.playClickSound();
    this.floatingPlayer.open();
    if (this.isXRActive) {
      this.updateHeadPos();
      this.floatingPlayer.resetPosition(this.scratchHeadPos, this.scratchForward);
    }
    this.syncDOMToggleLabel();
  }

  // ─── Subtle Desktop Toggle Pill ────────────────────────────────────────────

  private setupDesktopDOMButton(): void {
    const btn = document.createElement('button');
    btn.id = 'wrist-ui-desktop-btn';
    btn.setAttribute('aria-label', 'Toggle 3D Holographic Music Controls');

    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '20px',
      left: '20px',
      zIndex: '999',
      display: 'flex',
      alignItems: 'center',
      padding: '8px 16px',
      borderRadius: '24px',
      background: 'rgba(10, 40, 62, 0.75)',
      backdropFilter: 'blur(12px)',
      color: '#f4f9ff',
      border: '1px solid rgba(0, 242, 254, 0.52)',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.45), 0 0 14px rgba(0, 242, 254, 0.22)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      userSelect: 'none',
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(15, 58, 86, 0.92)';
      btn.style.borderColor = '#00f2fe';
      btn.style.boxShadow = '0 6px 24px rgba(0, 242, 254, 0.35)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(10, 40, 62, 0.75)';
      btn.style.borderColor = 'rgba(0, 242, 254, 0.52)';
      btn.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.45), 0 0 14px rgba(0, 242, 254, 0.22)';
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.floatingPlayer?.toggle();
      this.syncDOMToggleLabel();
    });

    document.body.appendChild(btn);
    this.domToggleButton = btn;
    this.syncDOMToggleLabel();
  }

  private syncDOMToggleLabel(): void {
    if (!this.domToggleButton) return;
    const isOpen = this.floatingPlayer ? this.floatingPlayer.visible : true;
    const label = isOpen ? 'Hide Controls' : 'Show Music UI';
    this.domToggleButton.innerHTML = `
      <span style="font-size: 13px; font-weight: 600; letter-spacing: 0.4px; color: #00f2fe;">${label}</span>
      <kbd style="margin-left: 8px; font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(0,242,254,0.18); border: 1px solid rgba(0,242,254,0.40); color: #ffffff;">M</kbd>
    `;
  }

  // ─── Per-Frame Updates (Zero Allocations) ──────────────────────────────────

  update(dt: number): void {
    if (!this.deps || !this.floatingPlayer) return;

    if (this.touchCooldown > 0) this.touchCooldown -= dt;
    if (this.summonCooldown > 0) this.summonCooldown -= dt;

    const { sourceStart, duration } = this.deps.excerpt;
    const rawTime = this.deps.audio.getCurrentTime();
    const pct = duration > 0 ? Math.max(0, Math.min(1, (rawTime - sourceStart) / duration)) : 0;
    const isPlaying = this.deps.audio.isPlaying();
    const currentPhase = this.deps.state.getCurrentPhase();

    const currentSec = Math.max(0, rawTime - sourceStart);
    const timeStr = `${this.formatTime(currentSec)} / ${this.formatTime(duration)}`;

    let statusText = 'PAUSED';
    if (currentPhase === 'COMPLETE') statusText = 'COMPLETE';
    else if (isPlaying) statusText = 'PLAYING';
    else if (currentPhase === 'READY') statusText = 'READY';

    const audioIntensity = this.deps.getAudioIntensity ? this.deps.getAudioIntensity() : (isPlaying ? 0.5 : 0.1);

    this.floatingPlayer.update(dt, audioIntensity);
    this.floatingPlayer.updateProgress(pct, timeStr, statusText);
    this.floatingPlayer.updatePlayState(isPlaying);
    this.floatingPlayer.updateVolume(this._volume);

    // Sync subtle XR summon beacon visibility (ONLY visible when main UI is closed)
    if (this.summonBeaconMesh) {
      this.summonBeaconMesh.visible = this.isXRActive && !this.floatingPlayer.visible;
      if (this.summonBeaconMesh.visible) {
        this.summonBeaconMesh.rotation.y += dt * 1.4;
      }
    }

    // Update hover/targeting glow & XR hand/controller interaction
    this.targetedIds.clear();
    if (this.desktopHoveredId) {
      this.targetedIds.add(this.desktopHoveredId);
    }

    if (this.isXRActive && this.deps.world) {
      if (this.needsInitialXRPlacement && (this.deps.world.renderer as any)?.xr?.isPresenting) {
        this.needsInitialXRPlacement = false;
        this.updateHeadPos();
        this.floatingPlayer.resetPosition(this.scratchHeadPos, this.scratchForward);
      }
      this.processXRTargetingAndTouch();
      this.checkXRGamepadSummon();
    }

    this.floatingPlayer.setTargetedControls(this.targetedIds);
  }

  private processXRTargetingAndTouch(): void {
    if (!this.deps?.world || !this.floatingPlayer) return;
    const p = this.deps.world.player as any;
    if (!p) return;

    // 1. Gather active hand index tips & controller grips into pre-allocated scratch vectors
    this.scratchProbeCount = 0;

    const addProbeIfActive = (space: any) => {
      if (space && (space.visible || space.matrixWorld?.elements[15] > 0) && this.scratchProbeCount < 4) {
        space.updateMatrixWorld();
        this.scratchProbePositions[this.scratchProbeCount++].setFromMatrixPosition(space.matrixWorld);
      }
    };

    addProbeIfActive(p.indexTipSpaces?.right);
    addProbeIfActive(p.indexTipSpaces?.left);
    addProbeIfActive(p.gripSpaces?.right);
    addProbeIfActive(p.gripSpaces?.left);

    // If UI is closed, allow direct physical poke of the tiny wrist beacon to summon
    if (!this.floatingPlayer.visible) {
      if (this.summonBeaconMesh?.visible && this.summonCooldown <= 0) {
        this.summonBeaconMesh.updateMatrixWorld();
        this.scratchBeaconPos.setFromMatrixPosition(this.summonBeaconMesh.matrixWorld);
        for (let i = 0; i < this.scratchProbeCount; i++) {
          if (this.scratchProbePositions[i].distanceTo(this.scratchBeaconPos) <= 0.055) {
            this.summonUI();
            return;
          }
        }
      }
      return;
    }

    // 2. Controller & Hand Pinch Ray Targeting Glow (Left & Right rays)
    const checkRayHover = (raySpace: any) => {
      if (!raySpace || (!raySpace.visible && !(raySpace.matrixWorld?.elements[15] > 0))) return;
      raySpace.updateMatrixWorld();
      this.scratchRayOrigin.setFromMatrixPosition(raySpace.matrixWorld);
      this.scratchRayDir.set(0, 0, -1).transformDirection(raySpace.matrixWorld).normalize();
      this.raycaster.ray.origin.copy(this.scratchRayOrigin);
      this.raycaster.ray.direction.copy(this.scratchRayDir);

      const hits = this.raycaster.intersectObjects(this.hitTestObjects, false);
      if (hits.length > 0) {
        const hitObj = hits[0].object as Mesh;
        for (let j = 0; j < this.hitTestEntries.length; j++) {
          if (this.hitTestEntries[j].mesh === hitObj) {
            this.targetedIds.add(this.hitTestEntries[j].id);
            break;
          }
        }
      }
    };

    checkRayHover(p.raySpaces?.right);
    checkRayHover(p.raySpaces?.left);

    // 3. Hand & Controller Proximity Targeting + Direct Poke
    let closestTouchId: FloatingControlId | null = null;
    let closestTouchDist = Infinity;
    let anyProbeInsideTouchRadius = false;

    for (let j = 0; j < this.hitTestEntries.length; j++) {
      const entry = this.hitTestEntries[j];
      entry.mesh.updateMatrixWorld();
      this.scratchButtonPos.setFromMatrixPosition(entry.mesh.matrixWorld);

      for (let i = 0; i < this.scratchProbeCount; i++) {
        const dist = this.scratchProbePositions[i].distanceTo(this.scratchButtonPos);

        // Hover glow radius: 8.5 cm
        if (dist <= 0.085) {
          this.targetedIds.add(entry.id);
        }

        // Direct poke trigger radius: 3.8 cm
        if (dist <= 0.038) {
          anyProbeInsideTouchRadius = true;
          if (dist < closestTouchDist) {
            closestTouchDist = dist;
            closestTouchId = entry.id;
          }
        }
      }
    }

    // Touch hysteresis: only activate once per approach-poke-withdraw cycle
    if (closestTouchId && closestTouchId !== 'handle') {
      if (!this.wasInTouchZone && this.touchCooldown <= 0) {
        this.wasInTouchZone = true;
        this.touchCooldown = 0.35;
        this.floatingPlayer.depressButton(closestTouchId);
        this.handleControlAction(closestTouchId);
        const pressedId = closestTouchId;
        setTimeout(() => this.floatingPlayer?.releaseButton(pressedId), 180);
      }
    } else if (!anyProbeInsideTouchRadius) {
      this.wasInTouchZone = false;
    }
  }

  private checkXRGamepadSummon(): void {
    const session = this.xrSession || (this.deps?.world?.renderer as any)?.xr?.getSession();
    if (!session || !session.inputSources || !this.floatingPlayer) return;

    const sources = session.inputSources;
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      const gp = src.gamepad;
      if (!gp || !gp.buttons || gp.buttons.length <= 4) continue;

      // Button 4 on standard XR gamepad mapping is B (right) / Y (left)
      const pressed = Boolean(gp.buttons[4]?.pressed);
      if (src.handedness === 'left') {
        if (pressed && !this.prevSummonBtnLeft && !this.floatingPlayer.visible) {
          this.summonUI();
        }
        this.prevSummonBtnLeft = pressed;
      } else if (src.handedness === 'right') {
        if (pressed && !this.prevSummonBtnRight && !this.floatingPlayer.visible) {
          this.summonUI();
        }
        this.prevSummonBtnRight = pressed;
      }
    }
  }

  private updateHeadPos(): void {
    const world = this.deps?.world;
    const camera = this.deps?.camera || world?.camera;
    if (!camera) return;

    const xrCam = (world?.renderer as any)?.xr?.getCamera ? (world?.renderer as any).xr.getCamera() : null;
    const isPresenting = (world?.renderer as any)?.xr?.isPresenting;

    const activeCam = isPresenting && xrCam ? xrCam : camera;
    activeCam.getWorldPosition(this.scratchHeadPos);
    activeCam.getWorldDirection(this.scratchForward);
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
      // Ignore audio cue failures
    }
  }

  // ─── Disposal ──────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.boundOnKeyDown) {
      window.removeEventListener('keydown', this.boundOnKeyDown);
      this.boundOnKeyDown = null;
    }
    if (this.boundOnPointerDown) {
      window.removeEventListener('pointerdown', this.boundOnPointerDown, { capture: true });
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
    if (this.unsubscribeXR) { this.unsubscribeXR(); this.unsubscribeXR = null; }
    if (this.unsubscribePhase) { this.unsubscribePhase(); this.unsubscribePhase = null; }

    if (this.domToggleButton?.parentNode) {
      this.domToggleButton.parentNode.removeChild(this.domToggleButton);
      this.domToggleButton = null;
    }

    if (this.summonBeaconMesh) {
      this.summonBeaconMesh.geometry.dispose();
      (this.summonBeaconMesh.material as MeshBasicMaterial).dispose();
      this.summonBeaconMesh.parent?.remove(this.summonBeaconMesh);
      this.summonBeaconMesh = null;
    }

    if (this.floatingPlayer) {
      this.floatingPlayer.dispose();
      this.floatingPlayer = null;
    }
  }
}

export const wristUIController = new WristUIController();
