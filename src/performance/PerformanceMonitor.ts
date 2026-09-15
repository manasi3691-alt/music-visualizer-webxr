/**
 * PerformanceMonitor: Frame rate tracking, draw call monitoring,
 * and budget violation alerts.
 */

export class PerformanceMonitor {
  private frameCount = 0;
  private lastFpsTime = performance.now();
  private currentFPS = 60;
  private currentFrameTimeMs = 16.6;

  update(): void {
    const now = performance.now();
    this.frameCount++;

    if (now - this.lastFpsTime >= 1000) {
      this.currentFPS = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
      this.currentFrameTimeMs = 1000 / Math.max(1, this.currentFPS);
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
  }

  getFPS(): number {
    return this.currentFPS;
  }

  getFrameTimeMs(): number {
    return this.currentFrameTimeMs;
  }
}

export const performanceMonitor = new PerformanceMonitor();
