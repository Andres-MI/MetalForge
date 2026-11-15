/**
 * Monophonic pitch detection with the McLeod Pitch Method (normalised square difference function),
 * computed through an FFT autocorrelation. Pure function over a buffer: no Web Audio, runs in Node.
 */
import { fft, nextPow2 } from './fft';

export interface PitchResult {
  freq: number;
  /** 0..1, how periodic the signal is. Below ~0.8 the reading is not trustworthy. */
  clarity: number;
}

export interface PitchOptions {
  fmin: number;
  fmax: number;
  /** Fraction of the highest peak a candidate must reach; the first one that does wins. */
  peakThreshold?: number;
}

export function detectPitch(
  buf: Float32Array,
  sampleRate: number,
  opts: PitchOptions,
  start = 0,
  length = buf.length - start,
): PitchResult | null {
  const n = length;
  const minLag = Math.max(2, Math.floor(sampleRate / opts.fmax));
  // A lag is only reliable if at least two full periods fit in the buffer.
  const maxLag = Math.min(Math.ceil(sampleRate / opts.fmin), Math.floor(n / 2) - 1);
  if (maxLag <= minLag + 2) return null;

  const size = nextPow2(2 * n);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const v = buf[start + i];
    re[i] = v;
    energy += v * v;
  }
  if (energy / n < 1e-10) return null;

  fft(re, im);
  for (let i = 0; i < size; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft(re, im, true); // re[tau] is now the autocorrelation

  const nsdf = new Float64Array(maxLag + 2);
  let m = 2 * energy;
  nsdf[0] = 1;
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    const a = buf[start + tau - 1];
    const b = buf[start + n - tau];
    m -= a * a + b * b;
    nsdf[tau] = m > 1e-12 ? (2 * re[tau]) / m : 0;
  }

  // Key maxima: the highest point of each positive lobe after the first zero crossing.
  let tau = 1;
  while (tau <= maxLag && nsdf[tau] > 0) tau++;
  const peaks: number[] = [];
  let best = -1;
  let highest = 0;
  for (; tau <= maxLag; tau++) {
    if (nsdf[tau] > 0) {
      if (best < 0 || nsdf[tau] > nsdf[best]) best = tau;
    } else if (best >= 0) {
      if (best >= minLag) {
        peaks.push(best);
        if (nsdf[best] > highest) highest = nsdf[best];
      }
      best = -1;
    }
  }
  if (best >= minLag && best < maxLag && nsdf[best] > nsdf[best + 1]) {
    peaks.push(best);
    if (nsdf[best] > highest) highest = nsdf[best];
  }
  if (peaks.length === 0 || highest <= 0) return null;

  const cut = highest * (opts.peakThreshold ?? 0.9);
  const chosen = peaks.find((p) => nsdf[p] >= cut)!;

  // Parabolic interpolation around the chosen lag.
  const y0 = nsdf[chosen - 1];
  const y1 = nsdf[chosen];
  const y2 = nsdf[chosen + 1];
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  const lag = chosen + (Math.abs(shift) < 1 ? shift : 0);
  const clarity = Math.min(1, y1 - 0.25 * (y0 - y2) * shift);
  return { freq: sampleRate / lag, clarity };
}
