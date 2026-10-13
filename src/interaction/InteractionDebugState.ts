/**
 * InteractionDebugState: Tracks runtime XR input, controller detection,
 * block targeting/grabbing, and wrist poke events for debug inspection.
 */

export interface InteractionDebugData {
  xrActive: boolean;
  leftControllerDetected: boolean;
  rightControllerDetected: boolean;
  lastInputEvent: string; // e.g. "select (right)", "squeeze (left)", "poke (right->left)"
  lastEventSource: string;
  currentlyTargetedBlock: string;
  blockGrabbed: boolean;
  grabbedBlockId: string;
  lastReleaseEvent: string; // "placed (zone-front-right)" or "returned (invalid)"
  wristActivationZoneExists: boolean;
  lastWristPokeDetected: boolean;
  wristMenuOpen: boolean;
  lastError: string;
}

class InteractionDebugState {
  data: InteractionDebugData = {
    xrActive: false,
    leftControllerDetected: false,
    rightControllerDetected: false,
    lastInputEvent: 'none',
    lastEventSource: 'none',
    currentlyTargetedBlock: 'none',
    blockGrabbed: false,
    grabbedBlockId: 'none',
    lastReleaseEvent: 'none',
    wristActivationZoneExists: false,
    lastWristPokeDetected: false,
    wristMenuOpen: false,
    lastError: 'none',
  };

  private listeners: Set<(data: InteractionDebugData) => void> = new Set();

  set(partial: Partial<InteractionDebugData>): void {
    Object.assign(this.data, partial);
    this.listeners.forEach((l) => l(this.data));
  }

  logEvent(event: string, source: string): void {
    this.data.lastInputEvent = event;
    this.data.lastEventSource = source;
    console.log(`[InteractionDebug] ${event} from ${source}`);
    this.listeners.forEach((l) => l(this.data));
  }

  subscribe(listener: (data: InteractionDebugData) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const interactionDebugState = new InteractionDebugState();
