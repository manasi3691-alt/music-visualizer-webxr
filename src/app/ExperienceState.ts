/**
 * State machines for EXPERIENCE and XR lifecycle
 */

export type ExperiencePhase =
  | 'LOADING'
  | 'READY'
  | 'PLAYING'
  | 'PAUSED'
  | 'CLIMAX'
  | 'RELEASE'
  | 'COMPLETE'
  | 'ERROR';

export type XRLifecycleState = 'NONE' | 'REQUESTING' | 'ACTIVE' | 'ENDED';

export type StateChangeListener<T> = (newState: T, previousState: T) => void;

export class ExperienceStateManager {
  private _experiencePhase: ExperiencePhase = 'LOADING';
  private _xrState: XRLifecycleState = 'NONE';
  private _errorMessage: string | null = null;

  private _phaseListeners: Set<StateChangeListener<ExperiencePhase>> = new Set();
  private _xrListeners: Set<StateChangeListener<XRLifecycleState>> = new Set();

  get phase(): ExperiencePhase {
    return this._experiencePhase;
  }

  get xrState(): XRLifecycleState {
    return this._xrState;
  }

  get errorMessage(): string | null {
    return this._errorMessage;
  }

  setPhase(next: ExperiencePhase): void {
    if (this._experiencePhase === next) return;
    const prev = this._experiencePhase;
    this._experiencePhase = next;
    console.log(`[ExperienceState] ${prev} -> ${next}`);
    this._phaseListeners.forEach((fn) => {
      try {
        fn(next, prev);
      } catch (err) {
        console.error('[ExperienceState] Listener error:', err);
      }
    });
  }

  setXRState(next: XRLifecycleState): void {
    if (this._xrState === next) return;
    const prev = this._xrState;
    this._xrState = next;
    console.log(`[XRState] ${prev} -> ${next}`);
    this._xrListeners.forEach((fn) => {
      try {
        fn(next, prev);
      } catch (err) {
        console.error('[XRState] Listener error:', err);
      }
    });
  }

  setError(msg: string): void {
    this._errorMessage = msg;
    this.setPhase('ERROR');
  }

  subscribePhase(fn: StateChangeListener<ExperiencePhase>): () => void {
    this._phaseListeners.add(fn);
    return () => this._phaseListeners.delete(fn);
  }

  subscribeXR(fn: StateChangeListener<XRLifecycleState>): () => void {
    this._xrListeners.add(fn);
    return () => this._xrListeners.delete(fn);
  }

  reset(): void {
    this._errorMessage = null;
    this.setPhase('READY');
  }
}

export const experienceState = new ExperienceStateManager();
