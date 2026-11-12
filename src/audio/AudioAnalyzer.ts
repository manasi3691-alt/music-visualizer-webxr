/**
 * AudioAnalyzer: Extracts normalized, smoothed FFT frequency metrics
 * Provides real-time frequency band analysis, dynamic section energy, and transient detection.
 */

export interface AudioMetrics {
  low: number;      // 20Hz - 220Hz (bass, kicks, low piano octaves)
  mid: number;      // 220Hz - 2800Hz (piano melody, vocals, synth chords)
  high: number;     // 2800Hz - 12000Hz (crystal harmonics, hi-hats, sparkles)
  overall: number;  // Instantaneous RMS energy [0, 1]
  energy: number;   // Smooth section dynamic intensity [0, 1] (build-up vs quiet passage)
  beat: number;     // Transient onset pulse [0, 1] (punch on note/beat attacks)
}

export class AudioAnalyzer {
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array | null = null;
  private timeData: Uint8Array | null = null;

  // Asymmetrically smoothed output values
  private _low = 0;
  private _mid = 0;
  private _high = 0;
  private _overall = 0;
  private _energy = 0;
  private _beat = 0;

  // Transient detection state
  private lastEnergy = 0;

  init(analyserNode: AnalyserNode): void {
    this.analyser = analyserNode;
    this.analyser.fftSize = 512;
    this.analyser.minDecibels = -85;
    this.analyser.maxDecibels = -25;
    this.analyser.smoothingTimeConstant = 0.65;
    const binCount = this.analyser.frequencyBinCount; // 256 bins for 512 fftSize
    this.freqData = new Uint8Array(binCount);
    this.timeData = new Uint8Array(binCount);
  }

  update(): AudioMetrics {
    if (!this.analyser || !this.freqData || !this.timeData) {
      return { low: 0, mid: 0, high: 0, overall: 0, energy: 0, beat: 0 };
    }

    this.analyser.getByteFrequencyData(this.freqData as unknown as Uint8Array<ArrayBuffer>);
    this.analyser.getByteTimeDomainData(this.timeData as unknown as Uint8Array<ArrayBuffer>);

    const binCount = this.freqData.length;
    // For 44.1kHz sample rate, each bin ~= 86.13 Hz
    // Low: bins 0 to 4 (approx 0 - 344 Hz)
    // Mid: bins 4 to 34 (approx 344 - 2928 Hz)
    // High: bins 34 to 140 (approx 2928 - 12000 Hz)
    const lowBinEnd = Math.max(3, Math.min(8, Math.floor(binCount * 0.035)));
    const midBinEnd = Math.max(lowBinEnd + 4, Math.floor(binCount * 0.24));
    const highBinEnd = Math.max(midBinEnd + 4, Math.floor(binCount * 0.75));

    let rawLow = 0;
    for (let i = 0; i < lowBinEnd; i++) {
      rawLow += this.freqData[i];
    }
    rawLow = lowBinEnd > 0 ? (rawLow / lowBinEnd) / 255 : 0;
    // Apply power curve to emphasize strong bass punch over noise floor
    rawLow = Math.pow(rawLow, 1.35);

    let rawMid = 0;
    for (let i = lowBinEnd; i < midBinEnd; i++) {
      rawMid += this.freqData[i];
    }
    rawMid = (midBinEnd - lowBinEnd) > 0 ? (rawMid / (midBinEnd - lowBinEnd)) / 255 : 0;
    rawMid = Math.pow(rawMid, 1.15);

    let rawHigh = 0;
    for (let i = midBinEnd; i < highBinEnd; i++) {
      rawHigh += this.freqData[i];
    }
    rawHigh = (highBinEnd - midBinEnd) > 0 ? (rawHigh / (highBinEnd - midBinEnd)) / 255 : 0;
    rawHigh = Math.pow(rawHigh, 1.1);

    // Time domain RMS calculation for overall energy
    let sumSq = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const normalized = (this.timeData[i] - 128) / 128;
      sumSq += normalized * normalized;
    }
    const rawOverall = Math.min(1.0, Math.sqrt(sumSq / this.timeData.length) * 2.5);

    // Asymmetric smoothing: fast attack (responsive to beats) and smooth cinematic decay
    const attack = 0.35;
    const decay = 0.09;

    this._low += (rawLow > this._low ? attack : decay) * (rawLow - this._low);
    this._mid += (rawMid > this._mid ? attack : decay) * (rawMid - this._mid);
    this._high += (rawHigh > this._high ? attack : decay) * (rawHigh - this._high);
    this._overall += (rawOverall > this._overall ? attack : decay) * (rawOverall - this._overall);

    // Long-term musical energy envelope (build-ups vs quiet passages)
    const energyTarget = (this._low * 0.35 + this._mid * 0.45 + this._high * 0.20);
    this._energy += (energyTarget > this._energy ? 0.05 : 0.02) * (energyTarget - this._energy);

    // Transient beat onset detection with exponential decay to prevent jitter
    const energyDelta = Math.max(0, this._overall - this.lastEnergy);
    this.lastEnergy = this._overall;
    if (energyDelta > 0.08) {
      this._beat = Math.min(1.0, this._beat + energyDelta * 2.0);
    } else {
      this._beat = Math.max(0.0, this._beat * 0.90 - 0.015);
    }

    return {
      low: Math.max(0, Math.min(1, this._low)),
      mid: Math.max(0, Math.min(1, this._mid)),
      high: Math.max(0, Math.min(1, this._high)),
      overall: Math.max(0, Math.min(1, this._overall)),
      energy: Math.max(0, Math.min(1, this._energy)),
      beat: Math.max(0, Math.min(1, this._beat)),
    };
  }

  getMetrics(): AudioMetrics {
    return {
      low: this._low,
      mid: this._mid,
      high: this._high,
      overall: this._overall,
      energy: this._energy,
      beat: this._beat,
    };
  }

  reset(): void {
    this._low = 0;
    this._mid = 0;
    this._high = 0;
    this._overall = 0;
    this._energy = 0;
    this._beat = 0;
    this.lastEnergy = 0;
  }
}

export const audioAnalyzer = new AudioAnalyzer();

