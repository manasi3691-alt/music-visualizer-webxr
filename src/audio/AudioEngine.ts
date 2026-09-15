/**
 * AudioEngine: AudioContext pipeline management, playback lifecycle,
 * and audio.currentTime clock authority.
 */

import { EXPERIENCE_CONFIG } from '../app/ExperienceConfig.js';
import { experienceState } from '../app/ExperienceState.js';
import { audioAnalyzer } from './AudioAnalyzer.js';
import { musicExcerpt } from './MusicExcerpt.js';

export class AudioEngine {
  private audioElement: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;

  private _isLoaded = false;
  private _isPlaying = false;
  private _userInitiated = false;

  get isLoaded(): boolean {
    return this._isLoaded;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get currentTime(): number {
    if (!this.audioElement) return 0;
    return this.audioElement.currentTime;
  }

  /**
   * Prepares the audio element and verifies file availability
   */
  async load(): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      this.audioElement = audio;
      audio.preload = 'auto';
      audio.src = EXPERIENCE_CONFIG.audioPath;

      const onCanPlay = () => {
        cleanup();
        this._isLoaded = true;
        console.log('[AudioEngine] Audio loaded successfully. Duration:', audio.duration);
        experienceState.setPhase('READY');
        resolve();
      };

      const onError = (e: Event) => {
        cleanup();
        const err = audio.error;
        let msg = `Failed to load audio from ${EXPERIENCE_CONFIG.audioPath}.`;
        if (err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          msg += ' The audio file was not found or format is unsupported. Ensure public/audio/experience.mp3 is present.';
        }
        console.error('[AudioEngine]', msg, err, e);
        experienceState.setError(msg);
        reject(new Error(msg));
      };

      const cleanup = () => {
        audio.removeEventListener('canplaythrough', onCanPlay);
        audio.removeEventListener('loadeddata', onCanPlay);
        audio.removeEventListener('error', onError);
      };

      audio.addEventListener('canplaythrough', onCanPlay, { once: true });
      audio.addEventListener('loadeddata', onCanPlay, { once: true });
      audio.addEventListener('error', onError, { once: true });

      audio.load();
    });
  }

  /**
   * Setup Web Audio graph on first explicit user gesture
   */
  private setupWebAudio(): void {
    if (this.audioContext || !this.audioElement) return;

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AudioContextClass();

    this.sourceNode = this.audioContext.createMediaElementSource(this.audioElement);
    this.analyserNode = this.audioContext.createAnalyser();
    this.gainNode = this.audioContext.createGain();

    this.gainNode.gain.value = 1.0;

    // Chain: MediaElementSource -> AnalyserNode -> GainNode -> Destination
    this.sourceNode.connect(this.analyserNode);
    this.analyserNode.connect(this.gainNode);
    this.gainNode.connect(this.audioContext.destination);

    audioAnalyzer.init(this.analyserNode);

    // Audio pause/ended handlers
    this.audioElement.addEventListener('pause', () => {
      if (this._isPlaying && !musicExcerpt.isComplete(this.currentTime)) {
        this._isPlaying = false;
        if (experienceState.phase === 'PLAYING') {
          experienceState.setPhase('PAUSED');
        }
      }
    });

    this.audioElement.addEventListener('ended', () => {
      this._isPlaying = false;
      experienceState.setPhase('COMPLETE');
    });
  }

  /**
   * Start playback at the authored excerpt start
   */
  async play(): Promise<void> {
    if (!this.audioElement) {
      throw new Error('AudioElement not initialized');
    }

    this._userInitiated = true;
    this.setupWebAudio();

    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // Seek to authored excerpt start
    this.audioElement.currentTime = musicExcerpt.sourceStart;
    try {
      await this.audioElement.play();
      this._isPlaying = true;
      experienceState.setPhase('PLAYING');
      console.log(`[AudioEngine] Playing from ${musicExcerpt.sourceStart}s`);
    } catch (err) {
      console.error('[AudioEngine] Play failed:', err);
      experienceState.setError('Audio playback failed to start. User interaction required.');
      throw err;
    }
  }

  pause(): void {
    if (this.audioElement && this._isPlaying) {
      this.audioElement.pause();
      this._isPlaying = false;
      experienceState.setPhase('PAUSED');
    }
  }

  resume(): void {
    if (this.audioElement && !this._isPlaying) {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
      this.audioElement.play().then(() => {
        this._isPlaying = true;
        experienceState.setPhase('PLAYING');
      }).catch((err) => {
        console.error('[AudioEngine] Resume failed:', err);
      });
    }
  }

  stop(): void {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.currentTime = musicExcerpt.sourceStart;
      this._isPlaying = false;
    }
    audioAnalyzer.reset();
  }

  replay(): void {
    this.stop();
    this.play();
  }
}

export const audioEngine = new AudioEngine();
