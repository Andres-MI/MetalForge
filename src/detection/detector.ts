/**
 * Streaming detector: feed it audio chunks of any size, get back attacks, identified notes and a
 * continuous pitch reading. Pure (no Web Audio) so the same code runs in the browser and in the bench.
 *
 * Events:
 *  - onset: something was plucked (enough for rhythm games).
 *  - note:  the pitch of that pluck, as soon as it is stable. `time` is the pluck, `emittedAt` is when
 *           we knew, so emittedAt - time is the detection latency.
 *  - pitch: periodic reading of the sustained pitch (tuner, bends).
 *  - strum: only when chord candidates are set (`setChordCandidates`): after an attack, once ~230 ms of audio
 *           have arrived, how clearly new energy appeared at each candidate note (see chord.ts). `time` is the
 *           attack (same as its onset event), `emittedAt` when we knew.
 */
import { fft, nextPow2 } from './fft';
import { detectPitch } from './pitch';
import { analyzeStrum, strumLayout, STRUM_PARAMS } from './chord';

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
  | { type: 'pitch'; time: number; freq: number; clarity: number; rms: number }
  | { type: 'strum'; time: number; emittedAt: number; strengths: Record<number, number>; shadowed: number[] };

export class Detector {
  private readonly o: Required<DetectorOptions>;
  private readonly ring: Float32Array;
  private readonly scratch: Float32Array;
  private written = 0; // total samples received
  private sinceHop = 0;
  private hopEnergy = 0;
  private history: number[] = []; // rms of the last hops, newest last
  private lastOnset = -Infinity; // sample index
  private pending: { at: number; lastMidi: number | null; agree: number; pre: Float32Array | null; preMidi: number | null } | null = null;
  private readonly fftSize: number;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly preMag: Float64Array;
  private readonly postMag: Float64Array;
  private hopCount = 0;
  private expectedMidis: number[] = [];
  // Chord verification: its own ring (the main one is too short for a 200 ms window plus the audio before it).
  private readonly chordRing: Float32Array;
  private readonly chordMask: number;
  private chordCandidates: { required: number[]; contradicting: number[] } | null = null;
  private strum: { at: number; required: number[]; contradicting: number[] } | null = null;

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
    const lay = strumLayout(this.o.sampleRate);
    this.chordRing = new Float32Array(nextPow2(lay.before + lay.end + 2 * this.o.hop));
    this.chordMask = this.chordRing.length - 1;
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
  private compareWithBefore(
    pre: Float32Array,
    post: Float32Array,
    len: number,
  ): { gain: (midi: number) => number; fresh: number | null; expected: () => number | null } {
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

    // Last resort, when the mix is too dense to read a pitch: check the notes the game is waiting for.
    // One of them counts if energy clearly appeared at its harmonics and NOT one or two octaves-ish
    // below (which would mean a lower note whose harmonics merely coincide with it).
    const diffs = new Float64Array(half);
    for (let k = 1; k < half; k++) diffs[k] = Math.max(0, postMag[k] - preMag[k]);
    const diffAt = (f: number) => {
      const i = Math.round(f / binHz);
      return i >= 1 && i + 1 < half ? Math.max(diffs[i - 1], diffs[i], diffs[i + 1]) : 0;
    };
    const expected = () => {
      let bestMidi: number | null = null;
      let bestStrength = 0;
      for (const midi of this.expectedMidis) {
        const f0 = 440 * Math.pow(2, (midi - 69) / 12);
        const own = diffAt(f0);
        if (gain(midi) < 2 || own <= 0) continue;
        if (diffAt(f0 / 2) > 0.5 * own || diffAt(f0 / 3) > 0.5 * own) continue;
        let strength = 0;
        for (let h = 1; h <= 4; h++) strength += diffAt(h * f0);
        if (strength > bestStrength) {
          bestStrength = strength;
          bestMidi = midi;
        }
      }
      return bestMidi;
    };

    // Autocorrelation of the difference = inverse FFT of its power spectrum.
    re.fill(0);
    im.fill(0);
    // Only the band where string partials live: rumble below the lowest note would hide the period.
    const kLo = Math.max(1, Math.floor((fmin * 0.8) / binHz));
    const kHi = Math.min(half - 1, Math.ceil(Math.min(6000, fmax * 6) / binHz));
    for (let k = kLo; k <= kHi; k++) {
      const d = Math.max(0, postMag[k] - preMag[k]);
      re[k] = d * d;
      re[fftSize - k] = d * d;
    }
    fft(re, im, true);
    const zero = re[0];
    if (zero <= 0) return { gain, fresh: null, expected };
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
    if (peaks.length === 0 || highest < 0.5 * zero) return { gain, fresh: null, expected };
    const chosen = peaks.find((q) => re[q] >= 0.85 * highest)!;
    const y0 = re[chosen - 1];
    const y1 = re[chosen];
    const y2 = re[chosen + 1];
    const denom = y0 - 2 * y1 + y2;
    const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
    const freq = sampleRate / (chosen + (Math.abs(shift) < 1 ? shift : 0));
    return { gain, fresh: Math.round(69 + 12 * Math.log2(freq / 440)), expected };
  }

  /**
   * Tells the detector which notes the game is waiting for. It never changes a pitch that was read
   * clearly; it only helps when a pluck is buried under several ringing strings.
   */
  setExpected(midis: Iterable<number>): void {
    this.expectedMidis = [...new Set(midis)];
  }

  /**
   * Notes to check after every attack: the chord's tones (`required`) plus the notes that would make it another
   * chord (`contradicting`). While there are any, each attack produces one `strum` event with a strength for every
   * one of them. Empty clears it. The set is read when the attack happens, so changing it later does not affect
   * a strum already under analysis.
   */
  setChordCandidates(required: Iterable<number>, contradicting: Iterable<number> = []): void {
    const req = [...new Set(required)];
    const con = [...new Set(contradicting)].filter((m) => !req.includes(m));
    this.chordCandidates = req.length ? { required: req, contradicting: con } : null;
    if (!this.chordCandidates) this.strum = null;
  }

  process(chunk: Float32Array): DetectorEvent[] {
    const events: DetectorEvent[] = [];
    const { hop, windowSize } = this.o;
    for (let i = 0; i < chunk.length; i++) {
      const v = chunk[i];
      this.ring[this.written % windowSize] = v;
      this.chordRing[this.written & this.chordMask] = v;
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

  /** The `n` samples starting at absolute sample `start` (zeros before the stream began). */
  private chordSlice(start: number, n: number): Float32Array {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const idx = start + i;
      if (idx >= 0 && idx < this.written) out[i] = this.chordRing[idx & this.chordMask];
    }
    return out;
  }

  private finishStrum(now: number): DetectorEvent {
    const { at, required, contradicting } = this.strum!;
    const { sampleRate } = this.o;
    const lay = strumLayout(sampleRate);
    const post = this.chordSlice(at + lay.postStart, lay.n);
    const pre = this.chordSlice(at - lay.gap - lay.n, lay.n);
    const { strengths, shadowed } = analyzeStrum(post, pre, sampleRate, required, contradicting, STRUM_PARAMS);
    return { type: 'strum', time: at / sampleRate, emittedAt: now / sampleRate, strengths, shadowed };
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
      // What was the loudest pitch before the pluck? A reading equal to it needs proof that it is new.
      let preMidi: number | null = null;
      if (pre) {
        const before = detectPitch(pre, sampleRate, { fmin, fmax });
        if (before && before.clarity >= minClarity) preMidi = Math.round(69 + 12 * Math.log2(before.freq / 440));
      }
      this.pending = { at, lastMidi: null, agree: 0, pre, preMidi };
      events.push({ type: 'onset', time: at / sampleRate, rms });
      // The strings of one strum arrive over 50-80 ms and may trigger several attacks: they are one strum.
      const merging = this.strum !== null && at - this.strum.at < 0.1 * sampleRate;
      if (this.chordCandidates && !merging) this.strum = { at, ...this.chordCandidates };
    }
    h.push(rms);
    if (this.strum && now >= this.strum.at + strumLayout(sampleRate).end) {
      events.push(this.finishStrum(now));
      this.strum = null;
    }
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
        if (p.pre) {
          // The time-domain reading follows whatever is loudest. Two cases need the before/after comparison:
          //  - it reads the same pitch that was sounding before the pluck: a re-pluck, or just the old string?
          //  - it reads nothing for a while: the pluck is buried under several ringing strings.
          const sameAsBefore = midi !== null && midi === p.preMidi;
          const late = midi === null && now - p.at > 1.5 * windowSize;
          if (sameAsBefore && (len < 1024 || len < (3 * sampleRate) / freq)) {
            midi = null; // too short to compare yet
          } else if (sameAsBefore || late) {
            const cmp = this.compareWithBefore(p.pre, post, len);
            if (midi === null || cmp.gain(midi) < 1.25) {
              midi = cmp.fresh ?? cmp.expected();
              if (midi !== null) freq = 440 * Math.pow(2, (midi - 69) / 12);
            }
          }
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
