/**
 * AudioAnalyzer: Extracts normalized, smoothed FFT frequency metrics
 * Provides Level C subtle micro-modulation (2-5% scale, gentle glow)
 */

export interface AudioMetrics {
  low: number;      // 20Hz - 250Hz (bass, low piano octaves)
  mid: number;      // 250Hz - 2500Hz (piano melody, cellos, violas)
  high: number;     // 2500Hz - 10000Hz (violin harmonics, air)
  overall: number;  // RMS / full-spectrum energy
}

export class AudioAnalyzer {
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array | null = null;
  private timeData: Uint8Array | null = null;

  // Smoothed output values
  private _low = 0;
  private _mid = 0;
  private _high = 0;
  private _overall = 0;

  // Smoothing factors: higher = smoother / less jitter
  private smoothingFactor = 0.82;

  init(analyserNode: AnalyserNode): void {
    this.analyser = analyserNode;
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.75;
    const binCount = this.analyser.frequencyBinCount;
    this.freqData = new Uint8Array(binCount);
    this.timeData = new Uint8Array(binCount);
  }

  update(): AudioMetrics {
    if (!this.analyser || !this.freqData || !this.timeData) {
      return { low: 0, mid: 0, high: 0, overall: 0 };
    }

    this.analyser.getByteFrequencyData(this.freqData as unknown as Uint8Array<ArrayBuffer>);
    this.analyser.getByteTimeDomainData(this.timeData as unknown as Uint8Array<ArrayBuffer>);

    const binCount = this.freqData.length;
    // For 44.1kHz sample rate, bin width = 44100 / 512 ~= 86.1 Hz
    // Low: bins 0 to 3 (~0 - 344 Hz)
    // Mid: bins 3 to 28 (~344 - 2400 Hz)
    // High: bins 28 to 116 (~2400 - 10000 Hz)
    const lowBinEnd = Math.max(2, Math.floor(binCount * 0.03));
    const midBinEnd = Math.max(lowBinEnd + 2, Math.floor(binCount * 0.22));
    const highBinEnd = Math.max(midBinEnd + 2, Math.floor(binCount * 0.80));

    let rawLow = 0;
    for (let i = 0; i < lowBinEnd; i++) {
      rawLow += this.freqData[i];
    }
    rawLow = lowBinEnd > 0 ? (rawLow / lowBinEnd) / 255 : 0;

    let rawMid = 0;
    for (let i = lowBinEnd; i < midBinEnd; i++) {
      rawMid += this.freqData[i];
    }
    rawMid = (midBinEnd - lowBinEnd) > 0 ? (rawMid / (midBinEnd - lowBinEnd)) / 255 : 0;

    let rawHigh = 0;
    for (let i = midBinEnd; i < highBinEnd; i++) {
      rawHigh += this.freqData[i];
    }
    rawHigh = (highBinEnd - midBinEnd) > 0 ? (rawHigh / (highBinEnd - midBinEnd)) / 255 : 0;

    // Time domain RMS calculation for overall energy
    let sumSq = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const normalized = (this.timeData[i] - 128) / 128;
      sumSq += normalized * normalized;
    }
    const rawOverall = Math.min(1, Math.sqrt(sumSq / this.timeData.length) * 2.2);

    // Exponential smoothing to eliminate jitter
    const s = this.smoothingFactor;
    const invS = 1 - s;

    this._low = this._low * s + rawLow * invS;
    this._mid = this._mid * s + rawMid * invS;
    this._high = this._high * s + rawHigh * invS;
    this._overall = this._overall * s + rawOverall * invS;

    return {
      low: this._low,
      mid: this._mid,
      high: this._high,
      overall: this._overall,
    };
  }

  getMetrics(): AudioMetrics {
    return {
      low: this._low,
      mid: this._mid,
      high: this._high,
      overall: this._overall,
    };
  }

  reset(): void {
    this._low = 0;
    this._mid = 0;
    this._high = 0;
    this._overall = 0;
  }
}

export const audioAnalyzer = new AudioAnalyzer();
