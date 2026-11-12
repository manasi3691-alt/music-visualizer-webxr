/**
 * ExperienceApp: Master application manager connecting audio, conductor,
 * visual world, interaction registry, and UI presentation.
 */

import { World, Entity } from '@iwsdk/core';
import { EXPERIENCE_CONFIG } from './ExperienceConfig.js';
import { audioEngine } from '../audio/AudioEngine.js';
import { audioAnalyzer } from '../audio/AudioAnalyzer.js';
import { musicalConductor } from '../conductor/MusicalConductor.js';
import { ExperienceWorld } from '../world/ExperienceWorld.js';
import { experienceState, ExperiencePhase } from './ExperienceState.js';
import { interactionRegistry } from '../interaction/InteractionRegistry.js';
import { desktopInput } from '../desktop/DesktopInput.js';
import { xrSetup } from '../xr/XRSetup.js';
import { xrState } from '../xr/XRState.js';
import { detectQualityProfile } from '../performance/QualityProfile.js';
import { wristUIController } from '../ui/WristUIController.js';
import { musicExcerpt } from '../audio/MusicExcerpt.js';
import { cityXRInput } from '../city/CityXRInput.js';
import { interactionDebugState } from '../interaction/InteractionDebugState.js';
import { performanceMonitor } from '../performance/PerformanceMonitor.js';

export let experienceWorld: ExperienceWorld | null = null;

export class ExperienceApp {
  private world: World | null = null;
  private uiContainer: HTMLDivElement | null = null;
  private debugOverlay: HTMLDivElement | null = null;
  private showDebug = false;
  private isInitialized = false;

  async init(world: World): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.world = world;

    const profile = detectQualityProfile();
    const isQuest = profile.name === 'quest';

    // 1. Instantiate procedural visual world
    experienceWorld = new ExperienceWorld(isQuest);

    // Attach to IWSDK root transform entity (marked persistent to stay on scene root)
    const rootEntity = world.createTransformEntity(undefined, { persistent: true });
    if (rootEntity.object3D) {
      rootEntity.object3D.add(experienceWorld.rootGroup);
    }

    // 2. Setup XR integration — await support check so isSupported is ready before UI renders
    xrSetup.init(world);
    await xrState.checkSupport();
    cityXRInput.init(world, experienceWorld.citySystem.interaction);

    // Listen to WebXR session lifecycle events directly from WebXRManager.
    // This is the primary path for cityXRInput and wristUIController session wiring.
    const webXRManager = (world.renderer as any)?.xr;
    if (webXRManager && typeof webXRManager.addEventListener === 'function') {
      webXRManager.addEventListener('sessionstart', () => {
        const session = webXRManager.getSession();
        if (session) {
          cityXRInput.onXRActive(session);
          wristUIController.onSessionStart(session);
          // Wire world into SoundBubbles for XR proximity detection
          if (experienceWorld) experienceWorld.onXRSessionStart(world);
        }
      });
      webXRManager.addEventListener('sessionend', () => {
        cityXRInput.onXREnded();
        wristUIController.onSessionEnd();
        if (experienceWorld) experienceWorld.onXRSessionEnd();
      });
    }

    // Secondary XR state subscriber: handles UI visibility and auto-audio-start.
    // Does NOT call cityXRInput/wristUIController (already done via webXRManager above).
    experienceState.subscribeXR((xrState) => {
      if (xrState === 'ACTIVE') {
        // Hide desktop overlay when XR session is live
        if (this.uiContainer) {
          this.uiContainer.style.opacity = '0';
          this.uiContainer.style.pointerEvents = 'none';
        }
        // Auto-start or resume audio if the user enters XR before pressing Play
        if (experienceState.phase === 'READY' || experienceState.phase === 'PAUSED' || experienceState.phase === 'LOADING') {
          audioEngine.play().catch((err) => {
            console.warn('[ExperienceApp] Autoplay on XR active handled:', err);
          });
        }
      } else if (xrState === 'ENDED' || xrState === 'NONE') {
        // Restore desktop overlay only if not actively playing (phase drives it otherwise)
        if (this.uiContainer && experienceState.phase !== 'PLAYING') {
          this.uiContainer.style.opacity = '1';
          this.uiContainer.style.pointerEvents = 'auto';
        }
      }
    });


    // 3. Setup Desktop Fallback input
    const canvas = document.querySelector('canvas') || (document.getElementById('scene-container') as HTMLElement);
    if (canvas && world.camera) {
      desktopInput.attach(world.camera, canvas, [
        experienceWorld.organicForms.primaryRibbon,
        experienceWorld.structures.grabOrbMesh,
      ]);
    }

    // 4. Create UI Overlays
    this.createUI();

    // 4.5 Initialize Wrist UI Controller
    wristUIController.init({
      audio: {
        play: () => audioEngine.play(),
        resume: () => audioEngine.resume(),
        pause: () => audioEngine.pause(),
        getCurrentTime: () => audioEngine.currentTime,
        isPlaying: () => audioEngine.isPlaying,
        seekRelative: (delta: number) => audioEngine.seekRelative(delta),
        setVolume: (v: number) => audioEngine.setVolume(v),
        getVolume: () => audioEngine.getVolume(),
      },
      excerpt: {
        sourceStart: musicExcerpt.sourceStart,
        sourceEnd: musicExcerpt.sourceEnd,
        duration: musicExcerpt.duration,
      },
      state: {
        getCurrentPhase: () => experienceState.phase,
        subscribePhase: (listener) => experienceState.subscribePhase(listener),
        subscribeXR: (listener) => experienceState.subscribeXR(listener),
      },
      replay: () => this.replay(),
      world,
      camera: world.camera,
    });

    // 5. Load audio
    experienceState.setPhase('LOADING');
    try {
      await audioEngine.load();
      experienceState.setPhase('READY');
      // Re-render start UI now that audio is ready, so XR support state is correctly reflected
      if (experienceState.phase === 'READY') {
        this.renderStartUI();
      }
    } catch (err) {
      console.error('[ExperienceApp] Audio load failed:', err);
      // Handled by experienceState
    }

    // 6. Listen for state changes
    experienceState.subscribePhase((phase) => this.onPhaseChanged(phase));

    // Auto-enable debug overlay if ?debug=1 is present in the URL
    if (window.location.search.includes('debug=1')) {
      this.showDebug = true;
      if (this.debugOverlay) {
        this.debugOverlay.style.display = 'block';
      }
    }

    // 7. Keyboard shortcuts (Space = Play/Pause, R = Replay, D = Debug)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyD') {
        this.toggleDebug();
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (experienceState.phase === 'READY' || experienceState.phase === 'PAUSED') {
          this.start();
        } else if (experienceState.phase === 'PLAYING') {
          audioEngine.pause();
        }
      } else if (e.code === 'KeyR') {
        if (experienceState.phase === 'COMPLETE' || experienceState.phase === 'PLAYING') {
          this.replay();
        }
      }
    });

    console.log('[ExperienceApp] Initialized successfully');

    // Desktop verification: dispatch Tab key after 1.5s to demonstrate open transition
    setTimeout(() => {
      console.log('[ExperienceApp] Dispatching Tab key to open Wrist UI...');
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', bubbles: true }));
    }, 1500);
  }

  /**
   * Called on every frame by the ExperienceSystem
   */
  update(deltaSec: number): void {
    performanceMonitor.update();

    // 1. Conductor update (samples audio.currentTime)
    const frameData = musicalConductor.update();

    // 2. Audio analyzer update (computes smoothed Level C metrics)
    const metrics = audioAnalyzer.update();

    // 3. Update interaction availability based on conductor timeline
    const norm = frameData.normalizedProgress;
    // Touch unlocked at Discovery (norm >= 0.10, 4s)
    // Grab unlocked at Development (norm >= 0.26, 10s)
    // Pull & Scale unlocked at Build (norm >= 0.47, 18s)
    interactionRegistry.setAvailability(
      norm >= 0.10 && norm < 0.96,
      norm >= 0.26 && norm < 0.96,
      norm >= 0.47 && norm < 0.96
    );

    // 4. Update visual world
    if (experienceWorld) {
      experienceWorld.update(frameData, metrics, deltaSec, this.world ?? undefined, this.world?.camera);
    }

    // 5. Update Wrist UI
    wristUIController.update(deltaSec);

    // 5.5 Update City XR Controller input
    cityXRInput.update(deltaSec);

    // 6. Update debug overlay if visible
    if (this.showDebug && this.debugOverlay) {
      this.updateDebugOverlay(frameData, metrics);
    }
  }

  async start(): Promise<void> {
    try {
      await audioEngine.play();
    } catch (err) {
      console.error('[ExperienceApp] Failed to start:', err);
    }
  }

  replay(): void {
    musicalConductor.reset();
    interactionRegistry.reset();
    experienceWorld?.reset();
    audioEngine.replay();
  }

  private onPhaseChanged(phase: ExperiencePhase): void {
    if (!this.uiContainer) return;

    if (phase === 'PLAYING') {
      this.uiContainer.style.opacity = '0';
      this.uiContainer.style.pointerEvents = 'none';
    } else if (phase === 'COMPLETE') {
      this.uiContainer.style.opacity = '1';
      this.uiContainer.style.pointerEvents = 'auto';
      this.renderReplayUI();
    } else if (phase === 'READY') {
      this.uiContainer.style.opacity = '1';
      this.uiContainer.style.pointerEvents = 'auto';
      this.renderStartUI();
    } else if (phase === 'ERROR') {
      this.uiContainer.style.opacity = '1';
      this.uiContainer.style.pointerEvents = 'auto';
      this.renderErrorUI();
    }
  }

  private createUI(): void {
    const container = document.createElement('div');
    container.id = 'experience-ui';
    container.style.cssText = `
      position: fixed;
      top: 0; left: 0; width: 100vw; height: 100vh;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: #ffffff; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      text-align: center; pointer-events: auto; z-index: 1000;
      background: radial-gradient(circle at center, rgba(14, 20, 38, 0.6) 0%, rgba(6, 9, 18, 0.9) 100%);
      transition: opacity 0.8s ease;
    `;
    document.body.appendChild(container);
    this.uiContainer = container;

    // Create debug overlay container
    const debug = document.createElement('div');
    debug.id = 'debug-overlay';
    debug.style.cssText = `
      position: fixed; bottom: 12px; left: 12px;
      padding: 10px 14px; background: rgba(0, 0, 0, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px;
      color: #79ffa8; font-family: monospace; font-size: 11px;
      line-height: 1.4; z-index: 9999; display: none; pointer-events: none;
    `;
    document.body.appendChild(debug);
    this.debugOverlay = debug;

    this.renderStartUI();
  }

  private renderStartUI(): void {
    if (!this.uiContainer) return;
    const hasVR = xrState.isSupported;

    this.uiContainer.innerHTML = `
      <div style="max-width: 480px; padding: 32px; background: rgba(255, 255, 255, 0.04); border-radius: 20px; border: 1px solid rgba(255, 255, 255, 0.12); backdrop-filter: blur(16px); box-shadow: 0 20px 50px rgba(0,0,0,0.5); text-align: center;">
        <h1 style="font-size: 38px; font-weight: 300; letter-spacing: 6px; margin: 0 0 8px 0; color: #f0f4ff; text-transform: uppercase;">A SKY FULL OF STARS</h1>
        <p style="font-size: 15px; font-weight: 400; letter-spacing: 2px; color: #a2b4e0; margin: 0 0 24px 0;">Coldplay / The Hit Crew Kids</p>

        <div style="display: flex; flex-direction: column; gap: 12px; align-items: center; margin-bottom: 24px;">
          <button id="btn-enter" style="
            background: linear-gradient(135deg, #4f68d9 0%, #7544b8 100%);
            border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 30px;
            color: #ffffff; padding: 16px 36px; font-size: 15px; font-weight: 600;
            letter-spacing: 2px; cursor: pointer; text-transform: uppercase;
            box-shadow: 0 8px 24px rgba(90, 70, 180, 0.4); transition: transform 0.2s, box-shadow 0.2s;
            width: 100%; max-width: 320px;
          ">${hasVR ? '🥽 ENTER IMMERSIVE VR' : '▶ PLAY EXPERIENCE'}</button>

          ${hasVR ? `
          <button id="btn-desktop" style="
            background: transparent;
            border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 30px;
            color: #9cb0dc; padding: 8px 20px; font-size: 12px; font-weight: 400;
            letter-spacing: 1px; cursor: pointer; transition: background 0.2s;
          ">Desktop 2D Preview</button>
          ` : ''}
        </div>

        <div style="font-size: 13px; color: #8fa0c8; line-height: 1.6; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 16px;">
          ${hasVR
            ? 'Put on your Meta Quest headset. Remain seated.<br/>Look around in 360° to explore the cosmic architecture.'
            : 'Remain seated. Look around.<br/>Interact with the world through touch, grab, and music.'}
        </div>
      </div>
    `;

    const enterBtn = document.getElementById('btn-enter');
    enterBtn?.addEventListener('click', () => {
      // 1. Kick off audio asynchronously within user gesture (do not await!)
      audioEngine.play().catch((err) => {
        console.warn('[ExperienceApp] Audio play on entry:', err);
      });

      if (hasVR) {
        // 2. Synchronously invoke launchXR() so navigator.xr.requestSession retains the user activation
        xrSetup.launchXR();
      } else {
        this.start();
      }
    });

    const desktopBtn = document.getElementById('btn-desktop');
    desktopBtn?.addEventListener('click', () => {
      this.start();
    });
  }

  private renderReplayUI(): void {
    if (!this.uiContainer) return;

    this.uiContainer.innerHTML = `
      <div style="max-width: 440px; padding: 32px; background: rgba(255, 255, 255, 0.04); border-radius: 20px; border: 1px solid rgba(255, 255, 255, 0.12); backdrop-filter: blur(16px); box-shadow: 0 20px 50px rgba(0,0,0,0.5);">
        <h2 style="font-size: 28px; font-weight: 300; letter-spacing: 4px; margin: 0 0 8px 0; color: #f0f4ff;">JOURNEY COMPLETE</h2>
        <p style="font-size: 14px; color: #a2b4e0; margin: 0 0 24px 0;">The music has settled back into calm.</p>

        <button id="btn-replay" style="
          background: linear-gradient(135deg, #4f68d9 0%, #7544b8 100%);
          border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 30px;
          color: #ffffff; padding: 14px 34px; font-size: 14px; font-weight: 600;
          letter-spacing: 2px; cursor: pointer; text-transform: uppercase;
          box-shadow: 0 8px 24px rgba(90, 70, 180, 0.4);
        ">Replay Experience</button>
      </div>
    `;

    document.getElementById('btn-replay')?.addEventListener('click', () => this.replay());
  }

  private renderErrorUI(): void {
    if (!this.uiContainer) return;
    const msg = experienceState.errorMessage || 'An error occurred during initialization.';

    this.uiContainer.innerHTML = `
      <div style="max-width: 460px; padding: 32px; background: rgba(50, 10, 15, 0.7); border-radius: 20px; border: 1px solid rgba(255, 100, 100, 0.3); backdrop-filter: blur(16px);">
        <h2 style="font-size: 22px; font-weight: 500; color: #ff8888; margin: 0 0 12px 0;">Audio Asset Required</h2>
        <p style="font-size: 13px; color: #fdd; line-height: 1.5; margin: 0 0 20px 0;">${msg}</p>
        <div style="font-size: 12px; color: #bbb;">Ensure <code>${EXPERIENCE_CONFIG.audioPath}</code> exists in the workspace.</div>
      </div>
    `;
  }

  private toggleDebug(): void {
    const isDev = import.meta.env.DEV;
    const hasQuery = window.location.search.includes('debug=1');
    if (!isDev && !hasQuery) return;

    this.showDebug = !this.showDebug;
    if (this.debugOverlay) {
      this.debugOverlay.style.display = this.showDebug ? 'block' : 'none';
    }
  }

  private updateDebugOverlay(frameData: any, metrics: any): void {
    if (!this.debugOverlay) return;
    const dbg = interactionDebugState.data;

    this.debugOverlay.innerHTML = `
      <b>EXPERIENCE INTERACTION DEBUG [D]</b><br/>
      FPS: ${performanceMonitor.getFPS()} (${performanceMonitor.getFrameTimeMs().toFixed(1)}ms)<br/>
      Audio time: ${audioEngine.currentTime.toFixed(2)}s / ${musicExcerpt.duration.toFixed(2)}s | Rel: ${frameData.relativeTime.toFixed(2)}s (${(frameData.normalizedProgress * 100).toFixed(1)}%)<br/>
      Cue: ${frameData.activeCue.id} (${frameData.activeCue.event}) | Phase: ${experienceState.phase}<br/>
      <hr style="border:0; border-top:1px solid #446; margin:4px 0;"/>
      <b>XR Session:</b> ${dbg.xrActive ? '<span style="color:#4f8;">ACTIVE</span>' : '<span style="color:#aaa;">NO</span>'} | Left: ${dbg.leftControllerDetected ? 'YES' : 'NO'} | Right: ${dbg.rightControllerDetected ? 'YES' : 'NO'}<br/>
      <b>Last Input Event:</b> ${dbg.lastInputEvent} (${dbg.lastEventSource})<br/>
      <b>Targeted Block:</b> ${dbg.currentlyTargetedBlock}<br/>
      <b>Block Grabbed:</b> ${dbg.blockGrabbed ? `<span style="color:#fa0;">YES (${dbg.grabbedBlockId})</span>` : 'NO'}<br/>
      <b>Last Release:</b> ${dbg.lastReleaseEvent}<br/>
      <hr style="border:0; border-top:1px solid #446; margin:4px 0;"/>
      <b>Wrist Poke Sphere:</b> ${dbg.wristActivationZoneExists ? '<span style="color:#4f8;">EXISTS</span>' : 'NO'} | Poke Detected: ${dbg.lastWristPokeDetected ? 'YES' : 'NO'}<br/>
      <b>Wrist Menu Open:</b> ${dbg.wristMenuOpen ? '<span style="color:#c8f;">OPEN</span>' : 'CLOSED'}<br/>
      <b>Errors:</b> ${dbg.lastError}
    `;
  }

}

export const experienceApp = new ExperienceApp();
