/**
 * Streaming detector: feed it audio chunks of any size, get back attacks, identified notes and a
 * continuous pitch reading. Pure (no Web Audio) so the same code runs in the browser and in the bench.
 *
 * Events:
 *  - onset: something was plucked (enough for rhythm games).
 *  - note:  the pitch of that pluck, as soon as it is stable. `time` is the pluck, `emittedAt` is when
 *           we knew, so emittedAt - time is the detection latency.
 *  - pitch: periodic reading of the sustained pitch (tuner, bends).
 */
import { detectPitch } from './pitch';

export interface DetectorOptions {
  sampleRate: number;
  fmin: number;
  fmax: number;
  /** Longest analysis window in samples. Must cover at least two periods of fmin. */
  windowSize: number;
  hop?: number;
  /** RMS below this is silence. */
  silenceRms?: number;
  /** Energy must jump by this factor over the recent past to count as an attack. */
  onsetRatio?: number;
  /** Seconds after an attack during which another one is ignored. */
  refractory?: number;
  minClarity?: number;
}

export type DetectorEvent =
  | { type: 'onset'; time: number; rms: number }
  | { type: 'note'; time: number; emittedAt: number; freq: number; midi: number; clarity: number }
  | { type: 'pitch'; time: number; freq: number; clarity: number; rms: number };

export class Detector {
  private readonly o: Required<DetectorOptions>;
  private readonly ring: Float32Array;
  private readonly scratch: Float32Array;
  private written = 0; // total samples received
  private sinceHop = 0;
  private hopEnergy = 0;
  private history: number[] = []; // rms of the last hops, newest last
  private lastOnset = -Infinity; // sample index
  private pending: { at: number; lastMidi: number | null; agree: number } | null = null;
  private hopCount = 0;

  constructor(opts: DetectorOptions) {
    this.o = {
      hop: 256,
      silenceRms: 0.004,
      onsetRatio: 1.7,
      refractory: 0.045,
      minClarity: 0.85,
      ...opts,
    };
    this.ring = new Float32Array(this.o.windowSize);
    this.scratch = new Float32Array(this.o.windowSize);
  }

  process(chunk: Float32Array): DetectorEvent[] {
    const events: DetectorEvent[] = [];
    const { hop, windowSize } = this.o;
    for (let i = 0; i < chunk.length; i++) {
      const v = chunk[i];
      this.ring[this.written % windowSize] = v;
      this.written++;
      this.hopEnergy += v * v;
      if (++this.sinceHop === hop) {
        this.onHop(Math.sqrt(this.hopEnergy / hop), events);
        this.sinceHop = 0;
        this.hopEnergy = 0;
      }
    }
    return events;
  }

  /** Copies the last `len` samples, oldest first, into the scratch buffer. */
  private tail(len: number): Float32Array {
    const { windowSize } = this.o;
    const startIdx = this.written - len;
    for (let i = 0; i < len; i++) this.scratch[i] = this.ring[(startIdx + i) % windowSize];
    return this.scratch;
  }

  private onHop(rms: number, events: DetectorEvent[]): void {
    const { sampleRate, hop, windowSize, fmin, fmax, minClarity } = this.o;
    const now = this.written;
    this.hopCount++;

    // --- attack: energy jump against the hops just before the previous one ---
    const h = this.history;
    const past = h.length >= 4 ? Math.max(h[h.length - 2], h[h.length - 3], h[h.length - 4]) : 0;
    const prev = h.length ? h[h.length - 1] : 0;
    const refractorySamples = this.o.refractory * sampleRate;
    if (
      rms > this.o.silenceRms * 2 &&
      rms > this.o.onsetRatio * Math.max(past, this.o.silenceRms) &&
      rms > prev &&
      now - this.lastOnset > refractorySamples
    ) {
      // The pluck happened somewhere inside this hop; its start is our best estimate.
      const at = now - hop;
      this.lastOnset = at;
      this.pending = { at, lastMidi: null, agree: 0 };
      events.push({ type: 'onset', time: at / sampleRate, rms });
    }
    h.push(rms);
    if (h.length > 8) h.shift();

    // --- pitch of the pending pluck: analyse only audio after the attack so the previous note
    //     does not contaminate it; the window grows until the pitch is stable ---
    if (this.pending) {
      const p = this.pending;
      const len = Math.min(now - p.at, windowSize);
      const tooLong = now - p.at > 0.2 * sampleRate;
      if (len >= 512) {
        const r = detectPitch(this.tail(len), sampleRate, { fmin, fmax }, 0, len);
        if (r && r.clarity >= minClarity) {
          const midiF = 69 + 12 * Math.log2(r.freq / 440);
          const midi = Math.round(midiF);
          if (p.lastMidi === midi) p.agree++;
          else {
            p.lastMidi = midi;
            p.agree = 1;
          }
          if (p.agree >= 2) {
            events.push({
              type: 'note',
              time: p.at / sampleRate,
              emittedAt: now / sampleRate,
              freq: r.freq,
              midi,
              clarity: r.clarity,
            });
            this.pending = null;
          }
        } else {
          p.agree = 0;
          p.lastMidi = null;
        }
      }
      if (this.pending && tooLong) this.pending = null; // unpitched attack (mute, noise)
    }

    // --- continuous reading, every 4 hops, on the full window ---
    if (this.hopCount % 4 === 0 && this.written >= windowSize && rms > this.o.silenceRms) {
      const r = detectPitch(this.tail(windowSize), sampleRate, { fmin, fmax }, 0, windowSize);
      if (r && r.clarity >= minClarity) {
        events.push({ type: 'pitch', time: now / sampleRate, freq: r.freq, clarity: r.clarity, rms });
      }
    }
  }
}
