# Wrist UI Context Reconnaissance (Task 0)

This document provides exact technical answers to Section 1 of the task specification for the EXPERIENCE WebXR project.

---

## 1. package.json & SDK Details

- **WebXR / Interaction SDK:** `@iwsdk/core`
- **SDK Version (verbatim):** `"0.5.3"`
- **Three.js Dependency:** `"three": "npm:super-three@0.181.0"`
- **Supporting Packages:**
  - `@iwsdk/cli`: `"0.5.3"`
  - `@iwsdk/vite-plugin-dev`: `"0.5.3"`
  - `@iwsdk/reference`: `"0.5.3"`
  - `@meta-quest/metavr`: `"^1.3.2"`

---

## 2. Bootstrapping, Render Loop, & System Lifecycle

- **Entry Point:** `src/index.ts`
- **Master App Manager:** `src/app/ExperienceApp.ts` (singleton instance: `experienceApp`)
- **ECS System:** `src/world/ExperienceSystem.ts` (class `ExperienceSystem`)
- **How the XR session is started:**
  - Invoked via `xrSetup.launchXR()` in `src/xr/XRSetup.ts`, which calls `await this.world.launchXR()`.
  - Triggered in `src/app/ExperienceApp.ts` (`btn-xr` click handler).
  - Mode is set in `iwsdk.config.json` under `"world.xr.mode": "vr"` (`immersive-vr`).
- **How the render loop is driven:**
  - Driven internally by IWSDK's `World` runtime animation loop (`renderer.setAnimationLoop`).
  - Each frame tick executes the registered ECS systems in priority order.
  - `ExperienceSystem.update(delta)` calls `experienceApp.update(deltaSec)`.
- **How systems are registered / updated per frame:**
  - `src/index.ts`: `world.registerSystem(ExperienceSystem)`.
  - Every frame, IWSDK calls `ExperienceSystem.prototype.update(delta: number)`.

---

## 3. Audio Module

- **Object holding HTMLAudioElement:**
  - Class: `AudioEngine` in `src/audio/AudioEngine.ts` (exported singleton: `audioEngine`).
  - Property: `private audioElement: HTMLAudioElement | null = null;`.
- **How play / pause is invoked today:**
  - **Play / Resume:**
    - `audioEngine.play()`: Initial start / restart from excerpt beginning. Seeks to `musicExcerpt.sourceStart` (240.0s), resumes `AudioContext` if suspended, calls `this.audioElement.play()`, and sets `experienceState.setPhase('PLAYING')`.
    - `audioEngine.resume()`: Resumes playback from current position without resetting `currentTime`. Resumes `AudioContext` if suspended, calls `this.audioElement.play()`, and sets `experienceState.setPhase('PLAYING')`.
    - `experienceApp.start()`: Calls `await audioEngine.play()`.
  - **Pause:**
    - `audioEngine.pause()`: Calls `this.audioElement.pause()`, sets `this._isPlaying = false`, and sets `experienceState.setPhase('PAUSED')`.
- **How currentTime is read:**
  - Via the getter on `audioEngine`:
    ```typescript
    get currentTime(): number {
      if (!this.audioElement) return 0;
      return this.audioElement.currentTime;
    }
    ```
- **Names of excerpt start / end:**
  - In `src/app/ExperienceConfig.ts` (`EXPERIENCE_CONFIG.excerpt`):
    - `sourceStart`: `240.0` (seconds)
    - `sourceEnd`: `278.0` (seconds)
    - `duration`: `38.0` (seconds)
  - In `src/audio/MusicExcerpt.ts` (`musicExcerpt` instance of `MusicExcerpt`):
    - `musicExcerpt.sourceStart`: `240.0`
    - `musicExcerpt.sourceEnd`: `278.0`
    - `musicExcerpt.duration`: `38.0`

---

## 4. Cinematic State Module

- **Exact enum/type names:**
  - Application lifecycle phase: `ExperiencePhase` in `src/app/ExperienceState.ts`.
  - Cinematic timeline cues: `CinematicEventType` in `src/conductor/CueSheet.ts`.
  - State manager singleton: `experienceState` (`ExperienceStateManager`).
- **All state values:**
  - `ExperiencePhase` values:
    - `'LOADING'`
    - `'READY'`
    - `'PLAYING'`
    - `'PAUSED'`
    - `'CLIMAX'`
    - `'RELEASE'`
    - `'COMPLETE'`
    - `'ERROR'`
  - `CinematicEventType` cue values (anchored in `CUE_SHEET`):
    - `'ARRIVAL'` (relative 0.0s, absolute 240.0s)
    - `'DISCOVERY'` (relative 4.0s, absolute 244.0s)
    - `'DEVELOPMENT'` (relative 10.0s, absolute 250.0s)
    - `'BUILD'` (relative 18.0s, absolute 258.0s)
    - `'CLIMAX_PREP'` (relative 28.0s, absolute 268.0s)
    - `'CLIMAX'` (relative 31.0s, absolute 271.0s)
    - `'RELEASE'` (relative 37.0s, absolute 277.0s)
    - `'COMPLETE'` (relative 38.0s, absolute 278.0s)

---

## 5. Replay / Reset Function

- **Exact name and signature:**
  - `replay(): void` on `experienceApp` (class `ExperienceApp`, instance `experienceApp`) in `src/app/ExperienceApp.ts` (lines 136–140).
- **What it resets:**
  ```typescript
  replay(): void {
    musicalConductor.reset();
    interactionRegistry.reset();
    audioEngine.replay();
  }
  ```
  1. `musicalConductor.reset()`: Sets `activeCueIndex = 0`, `lastCheckedAudioTime = -1`, and resets `cueExecutor`.
  2. `interactionRegistry.reset()`: Sets `activeGrabTarget = null`, resets availability of touch, grab, and pull/scale to `false`, and clears hover and interaction states.
  3. `audioEngine.replay()`: Calls `audioEngine.stop()` (which pauses audio, rewinds `audioElement.currentTime = musicExcerpt.sourceStart`, clears playing flag, and calls `audioAnalyzer.reset()`), followed by `audioEngine.play()`.

---

## 6. XR Interaction Layer

- **How poke / grab / pull / scale are currently implemented:**
  - Central coordinator: `InteractionRegistry` in `src/interaction/InteractionRegistry.ts` (singleton: `interactionRegistry`).
  - Target tracking:
    - `primary-ribbon`: Type `'TOUCH'`. Available at Discovery (`normProgress >= 0.10`). Handled by `TouchElement` or `interactionRegistry.onTouch(targetId, hitPoint)`, calling `experienceWorld.handleTouch(hitPoint)`.
    - `grab-orb`: Type `'GRAB'`. Available at Development (`normProgress >= 0.26`). Handled by `GrabElement` or `interactionRegistry.onGrabStart/Update/End`, calling `experienceWorld.handleGrab(dx, dy, dz)`.
    - `PullElement`: Maps controller displacement against `maxPullDisplacement` (0.45m) to progress `[0, 1]` and calls `experienceWorld.handleGrab(0, pullProgress * 0.25, 0)`.
    - `ScaleElement`: Clamps scaling between `minScaleFactor` (0.75x) and `maxScaleFactor` (1.5x) via `applyScaleDelta(factor)`.
  - Desktop fallback: `DesktopInput` in `src/desktop/DesktopInput.ts` simulates touch on mouse click, grab on mouse drag, and scale on mouse scroll.
- **Exact API used to attach an interactable to a mesh:**
  - IWSDK ECS component: `ExperienceInteractive` defined in `src/components/ExperienceComponents.ts` via `createComponent('ExperienceInteractive', { interactionType: { type: 'String', default: 'touch' } })`.
  - Core built-ins provided by `@iwsdk/core`: `OneHandGrabbable`, `TwoHandsGrabbable`, `DistanceGrabbable` (attached to entities via `entity.addComponent(...)`).
  - In Three.js procedural meshes, interactive meshes (`primaryRibbon`, `grabOrbMesh`) are held in `ExperienceWorld` submodules and target IDs are registered in `InteractionRegistry` and raycasted or checked directly.
- **How controllers are referenced (left/right):**
  - In IWSDK, controllers and tracking spaces live under `world.player` (`XROrigin`) and `world.playerSpaceEntities`:
    - Grip spaces: `world.player.gripSpaces.left` and `world.player.gripSpaces.right` (Three.js `Group` objects).
    - Ray spaces: `world.player.raySpaces.left` and `world.player.raySpaces.right` (Three.js `Group` objects).
    - Index tip spaces: `world.player.indexTipSpaces.left` and `world.player.indexTipSpaces.right` (for index fingertip poke interactions).
    - ECS Entities: `world.playerSpaceEntities.gripSpaces.left`, `world.playerSpaceEntities.gripSpaces.right`, etc.
    - XR input device handles: `world.input.xr` (`XRInputManager`), with devices `"controller-left"` and `"controller-right"`.
