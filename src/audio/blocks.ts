/**
 * Pure part of the detector worker: turns capture blocks (samples + the AudioContext frame of their first
 * sample) into DetectorEvents whose times are on the AudioContext timeline.
 *
 * Time alignment: the Detector counts samples from the first one it is fed, so its time `t` means "t
 * seconds after the first sample". The first block's `frame / sampleRate` is that sample's AudioContext
 * time, so `contextTime = firstFrame / sampleRate + t`. If a block does not start where the previous one
 * ended (the input stalled), the gap is filled with zeros so the sample count keeps matching the context
 * frame count; a gap over `maxGap` seconds restarts the origin instead.
 */
import { Detector, type DetectorEvent, type DetectorOptions } from '../detection/detector';

export class BlockProcessor {
  private readonly detector: Detector;
  private readonly sr: number;
  private originFrame: number | null = null;
  private fed = 0; // samples fed to the detector since the origin
  private readonly maxGap: number;

  constructor(opts: DetectorOptions, maxGapSeconds = 1) {
    this.detector = new Detector(opts);
    this.sr = opts.sampleRate;
    this.maxGap = maxGapSeconds * opts.sampleRate;
  }

  /** Context time (seconds) of the first sample, or null before any block. */
  get origin(): number | null {
    return this.originFrame === null ? null : this.originFrame / this.sr;
  }

  /** Feeds one block; returns events (context-time) and how far the detector has now processed (context seconds). */
  push(samples: Float32Array, frame: number): { events: DetectorEvent[]; upTo: number } {
    const events: DetectorEvent[] = [];
    if (this.originFrame === null) this.originFrame = frame;
    const expected = this.originFrame + this.fed;
    const gap = frame - expected;
    if (gap > this.maxGap) {
      // Too long to bridge: start a fresh timeline (the detector keeps its state, which is harmless).
      this.originFrame = frame - this.fed;
    } else if (gap > 0) {
      events.push(...this.detector.process(new Float32Array(gap)));
      this.fed += gap;
    }
    events.push(...this.detector.process(samples));
    this.fed += samples.length;
    const shift = this.originFrame / this.sr;
    const shifted = events.map((e): DetectorEvent => {
      if (e.type === 'note') return { ...e, time: e.time + shift, emittedAt: e.emittedAt + shift };
      return { ...e, time: e.time + shift };
    });
    return { events: shifted, upTo: shift + this.fed / this.sr };
  }
}
