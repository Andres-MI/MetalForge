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
import { fft, nextPow2 } from './fft';
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
  private pending: { at: number; lastMidi: number | null; agree: number; pre: Float32Array | null } | null = null;
  private readonly fftSize: number;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly preMag: Float64Array;
  private readonly postMag: Float64Array;
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
    this.fftSize = nextPow2(this.o.windowSize) * 4;
    this.re = new Float64Array(this.fftSize);
    this.im = new Float64Array(this.fftSize);
    this.preMag = new Float64Array(this.fftSize / 2);
    this.postMag = new Float64Array(this.fftSize / 2);
  }

  /** Hann-windowed magnitude spectrum of `n` samples, normalised so a steady tone reads the same at any n. */
  private spectrum(src: Float32Array, start: number, n: number, out: Float64Array): void {
    const { re, im, fftSize } = this;
    re.fill(0);
    im.fill(0);
    let wsum = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      re[i] = src[start + i] * w;
      wsum += w;
    }
    fft(re, im);
    for (let k = 0; k < fftSize / 2; k++) out[k] = Math.hypot(re[k], im[k]) / wsum;
  }

  /**
   * Tells old from new when other strings were already ringing at the attack. Compares the spectrum
   * after the pluck with the one just before it:
   *  - `gain(midi)`: how much the energy at that note's harmonics grew. A ringing string only decays,
   *    so a reading whose gain is about 1 or less is an old string, not the pluck.
   *  - `fresh`: the pitch of the energy that appeared, from the autocorrelation of the difference
   *    spectrum (the same periodicity method as the main detector, applied only to what is new).
   */
  private compareWithBefore(pre: Float32Array, post: Float32Array, len: number): { gain: (midi: number) => number; fresh: number | null } {
    const n = Math.min(len, pre.length);
    const { fftSize, re, im, preMag, postMag } = this;
    const half = fftSize / 2;
    const { sampleRate, fmin, fmax } = this.o;
    this.spectrum(pre, pre.length - n, n, preMag);
    this.spectrum(post, len - n, n, postMag);
    const binHz = sampleRate / fftSize;
    const gain = (midi: number) => {
      const f0 = 440 * Math.pow(2, (midi - 69) / 12);
      let before = 1e-9;
      let after = 0;
      for (let h = 1; h <= 4 && h * f0 < sampleRate / 2; h++) {
        const i = Math.round((h * f0) / binHz);
        before += preMag[i];
        after += postMag[i];
      }
      return after / before;
    };

    // Autocorrelation of the difference = inverse FFT of its power spectrum.
    re.fill(0);
    im.fill(0);
    for (let k = 1; k < half; k++) {
      const d = Math.max(0, postMag[k] - preMag[k]);
      re[k] = d * d;
      re[fftSize - k] = d * d;
    }
    fft(re, im, true);
    const zero = re[0];
    if (zero <= 0) return { gain, fresh: null };
    const minLag = Math.max(2, Math.floor(sampleRate / fmax));
    const maxLag = Math.min(Math.ceil(sampleRate / fmin), Math.floor(n / 2) - 1);
    let tau = 1;
    while (tau <= maxLag && re[tau] > 0) tau++;
    const peaks: number[] = [];
    let best = -1;
    let highest = 0;
    for (; tau <= maxLag; tau++) {
      if (re[tau] > 0) {
        if (best < 0 || re[tau] > re[best]) best = tau;
      } else if (best >= 0) {
        if (best >= minLag) {
          peaks.push(best);
          highest = Math.max(highest, re[best]);
        }
        best = -1;
      }
    }
    if (peaks.length === 0 || highest < 0.4 * zero) return { gain, fresh: null };
    const chosen = peaks.find((q) => re[q] >= 0.85 * highest)!;
    const y0 = re[chosen - 1];
    const y1 = re[chosen];
    const y2 = re[chosen + 1];
    const denom = y0 - 2 * y1 + y2;
    const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
    const freq = sampleRate / (chosen + (Math.abs(shift) < 1 ? shift : 0));
    return { gain, fresh: Math.round(69 + 12 * Math.log2(freq / 440)) };
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
      // If something was already sounding, keep the audio just before the pluck to tell old from new.
      let pre: Float32Array | null = null;
      if (past > this.o.silenceRms * 1.5 && this.written >= windowSize) {
        pre = this.tail(windowSize).slice(0, windowSize - hop);
      }
      this.pending = { at, lastMidi: null, agree: 0, pre };
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
        const post = this.tail(len);
        const r = detectPitch(post, sampleRate, { fmin, fmax }, 0, len);
        let midi: number | null = null;
        let freq = 0;
        let clarity = 0;
        if (r && r.clarity >= minClarity) {
          midi = Math.round(69 + 12 * Math.log2(r.freq / 440));
          freq = r.freq;
          clarity = r.clarity;
        }
        if (p.pre && len >= 1024) {
          // The time-domain reading follows whatever is loudest, which may be a string that was already
          // ringing. Keep it only if energy really appeared at that note; otherwise take what is new.
          const cmp = this.compareWithBefore(p.pre, post, len);
          if (midi === null || cmp.gain(midi) < 1.25) {
            midi = cmp.fresh;
            if (midi !== null) freq = 440 * Math.pow(2, (midi - 69) / 12);
          }
        } else if (p.pre) {
          midi = null; // too early to tell old from new
        }
        if (midi !== null) {
          if (p.lastMidi === midi) p.agree++;
          else {
            p.lastMidi = midi;
            p.agree = 1;
          }
          if (p.agree >= 2) {
            events.push({ type: 'note', time: p.at / sampleRate, emittedAt: now / sampleRate, freq, midi, clarity });
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
