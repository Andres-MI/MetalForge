/**
 * The one game clock. Musical time is ALWAYS seconds on the AudioContext timeline (`context.currentTime`),
 * never `Date`/`setTimeout`. This file is pure: the time source is injected, so it is tested in Node.
 *
 * Beat numbering: beat 0 is the first beat of the exercise (`Target.beat`). The count-in occupies the
 * beats -N..-1 before it, so with a 4/4 count-in the clicks fall on -4, -3, -2, -1 and the exercise
 * starts on 0.
 *
 * Pause: `pause()` freezes the clock; `resume()` moves `beat0Time` forward by the paused duration, so
 * `beat()` continues where it stopped. Anything that cached `beat0Time` (the metronome, the session)
 * must re-read it after a resume.
 */

/** Anything with a monotonically increasing `now()` in seconds (an AudioContext, or a fake). */
export interface TimeSource {
  now(): number;
}

export interface ClockStart {
  bpm: number;
  /** Beats of count-in before beat 0. Default 4 (one 4/4 bar). 0 = none. */
  countInBeats?: number;
  /** Beats per bar, used for accents. Default 4. */
  beatsPerBar?: number;
  /** Seconds between `start()` and the first count-in beat, so the first click can be scheduled. Default 0.15. */
  lead?: number;
}

export type ClockState = 'idle' | 'running' | 'paused';

export class GameClock {
  private _state: ClockState = 'idle';
  private _bpm = 60;
  private _countIn = 4;
  private _beatsPerBar = 4;
  private _beat0 = 0;
  private pausedAt = 0;

  constructor(private readonly source: TimeSource) {}

  get state(): ClockState {
    return this._state;
  }
  get bpm(): number {
    return this._bpm;
  }
  get countInBeats(): number {
    return this._countIn;
  }
  get beatsPerBar(): number {
    return this._beatsPerBar;
  }
  /** Seconds per beat. */
  get spb(): number {
    return 60 / this._bpm;
  }
  /** Source time (seconds) at which beat 0 falls. Shifts forward on `resume()`. */
  get beat0Time(): number {
    return this._beat0;
  }
  /** Source time of the first count-in beat (= beat -countInBeats). */
  get startTime(): number {
    return this.beatToTime(-this._countIn);
  }

  start(opts: ClockStart): void {
    this._bpm = opts.bpm;
    this._countIn = opts.countInBeats ?? 4;
    this._beatsPerBar = opts.beatsPerBar ?? 4;
    this._beat0 = this.source.now() + (opts.lead ?? 0.15) + this._countIn * this.spb;
    this._state = 'running';
  }

  /** Starts with beat 0 at an exact source time (used by calibration to align with the capture start). */
  startAt(beat0Time: number, opts: Omit<ClockStart, 'lead'>): void {
    this._bpm = opts.bpm;
    this._countIn = opts.countInBeats ?? 4;
    this._beatsPerBar = opts.beatsPerBar ?? 4;
    this._beat0 = beat0Time;
    this._state = 'running';
  }

  stop(): void {
    this._state = 'idle';
  }

  pause(): void {
    if (this._state !== 'running') return;
    this.pausedAt = this.source.now();
    this._state = 'paused';
  }

  resume(): void {
    if (this._state !== 'paused') return;
    this._beat0 += this.source.now() - this.pausedAt;
    this._state = 'running';
  }

  /** Current source time, frozen while paused. */
  now(): number {
    return this._state === 'paused' ? this.pausedAt : this.source.now();
  }

  /** Beat (fractional) at a source time. Negative during the count-in. */
  timeToBeat(t: number): number {
    return (t - this._beat0) / this.spb;
  }

  /** Source time of a beat. */
  beatToTime(beat: number): number {
    return this._beat0 + beat * this.spb;
  }

  /** Beat position right now (frozen while paused). */
  beat(): number {
    return this.timeToBeat(this.now());
  }

  /** Seconds since beat 0 (negative during the count-in): the time base the Judge works in. */
  gameTime(t: number): number {
    return t - this._beat0;
  }

  /** True while the count-in is still sounding. */
  get inCountIn(): boolean {
    return this._state !== 'idle' && this.beat() < 0;
  }

  /** Accented beat: the first of each bar (counted from beat 0, so the count-in starts on an accent). */
  isAccent(beat: number): boolean {
    const b = Math.round(beat);
    return (((b % this._beatsPerBar) + this._beatsPerBar) % this._beatsPerBar) === 0;
  }
}
