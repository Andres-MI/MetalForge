/**
 * Chord verification, signal side. Pure (no Web Audio): buffers in, numbers out.
 *
 * We do NOT transcribe the chord. The game knows which notes should sound, so the only question is
 * "did new energy appear at these notes after the strum?". The caller (the Detector) gives the audio of the
 * strum, the audio just before it, the chord tones (`required`) and the notes that would turn it into a
 * different chord (`contradicting`). The answer is a strength 0..1 for each of them.
 *
 * METHOD
 *  1. Two Hann-windowed spectra of the same length, zero-padded 2x: the strum (`post`) and the audio just before
 *     the attack (`pre`). New energy = max(0, post - preWeight * pre): a string that was already ringing and only
 *     decays disappears, one that was plucked stays (same idea as Detector.compareWithBefore, with more resolution).
 *  2. Each note is a comb of harmonics. The evidence at a harmonic is the highest LOCAL MAXIMUM of the new energy within
 *     +-20 cents of it (the skirt of a strong neighbour is a slope, not a line, so it does not count).
 *  3. LOW NOTES AND COINCIDENCES. The lowest chord tones sit near 82 Hz, where a semitone is 5 Hz and the Hann main lobe
 *     of a 190 ms window is +-10 Hz wide: the fundamental alone cannot tell E2 from F2, and the comb of E2 (every 82 Hz)
 *     covers the whole spectrum (E2's 3rd harmonic IS B3; its 5th is 3 Hz from G#4 = the 2nd of G#3). We do not try to
 *     resolve them: a harmonic of a note is "contested" when a harmonic of ANOTHER chord tone (full combs up to 4 kHz, so
 *     no unmodelled partial passes for evidence) lies within max(2 bins, 25 cents). Only uncontested harmonics (the first
 *     6, below 2 kHz) are evidence. A foreign note loses a partial it shares with a chord tone; a chord tone never loses
 *     one to a foreign note (if the foreign note sounds the chord is wrong anyway, and the comb of a low foreign string
 *     would leave the chord tones nothing). G3 against G#3 (Em against E) works because at 196 and 208 Hz nothing else
 *     of the chord is near, while 392 vs 415 Hz is already 2 lobes apart.
 *  4. A note with no uncontested harmonic is "shadowed": an octave or fifth of a lower string (E3, E4, B3 in E major). Its
 *     strength is 0 and meaningless; it is listed in `shadowed` so the verifier does not blame the player for it. A muted
 *     string whose note is shadowed cannot be detected: that is a limit of the method, not of the threshold.
 *  5. Level of a note = mean dB of its 3 strongest uncontested harmonics (one stray leak cannot vouch for it).
 *     Strength = 1 at the level of the loudest note, 0 at rangeDb (48) below it: a relative scale, since strings and
 *     input gains differ. If even the loudest is not clearly above the noise floor (minSnrDb, minAmp), everything is 0.
 *
 * WINDOW LENGTH vs LATENCY (measured on the bench, correct chords accepted / worst chord, 16 trials per case):
 *   window 0.09 s: 74 % / 25 %   0.11: 88 % / 56 %   0.13: 97 % / 81 %   0.15: 95-96 % / 88 %   0.18-0.19: 99.5 % / 94 %
 * The verdict arrives `skip + window` (= 0.04 + 0.19 = 0.23 s) after the attack, plus up to one 5 ms hop. A longer window
 * has a narrower lobe (2/window Hz) and more owned harmonics; a shorter one answers sooner but, below ~0.13 s, the lobe
 * (+-15 Hz) swallows the 12 Hz between G3 and G#3 and the thirds start to fail. `skip` leaves out the first 40 ms, where
 * the strings are still being plucked: a pluck inside the window is an abrupt onset whose skirt (6 dB/octave) fills the
 * gaps between lines and makes absent notes look present. If the game needs an earlier verdict, window 0.13 gives 0.17 s
 * at about 97 % (one chord below 85 %).
 */
import { fft, nextPow2 } from './fft';

export const STRUM_PARAMS = {
  /** Seconds after the attack where the analysed window starts (the first string has sounded, the pick noise is gone). */
  skip: 0.04,
  /** Seconds of audio analysed. */
  window: 0.19,
  /** How much of the spectrum before the attack is subtracted (1 = all; less keeps a re-plucked ringing string). */
  preWeight: 0.85,
  /** Gap kept between the end of `pre` and the attack, seconds. */
  preGap: 0.002,
  /** Harmonics of a note that count as evidence, and the highest frequency used for that. */
  harmonics: 6,
  evidenceMaxFreq: 2000,
  /** Every harmonic of every candidate up to this frequency is modelled when looking for coincidences (the comb of a
   *  low string covers the whole spectrum: an unmodelled partial would be taken for evidence of some other note). */
  combMaxFreq: 4000,
  /** Peak search half-width around each harmonic, cents. */
  searchCents: 20,
  /** Two harmonics closer than this many bins (or `collideCents`) are one for us. */
  collideBins: 2,
  collideCents: 25,
  /** Candidates with fewer uncontested harmonics than this are shadowed. */
  minOwned: 1,
  /** dB below the reference at which the strength reaches 0. */
  rangeDb: 48,
  /** The reference must exceed the noise floor by this many dB, and this absolute amplitude. */
  minSnrDb: 12,
  minAmp: 2e-4,
};

export type StrumParams = typeof STRUM_PARAMS;

export interface StrumAnalysis {
  /** 0..1 per candidate MIDI note: how clearly new energy appeared at it. */
  strengths: Record<number, number>;
  /** Candidates whose harmonics all coincide with a lower candidate: strength is not independent evidence. */
  shadowed: number[];
}

/** Sample counts the Detector must keep: audio from `preStart` before the attack to `end` after it. */
export function strumLayout(sampleRate: number, p: StrumParams = STRUM_PARAMS) {
  const n = Math.round(p.window * sampleRate);
  const skip = Math.round(p.skip * sampleRate);
  const gap = Math.round(p.preGap * sampleRate);
  return { n, skip, gap, /** attack-relative index of the first sample of `post` */ postStart: skip, /** samples after the attack needed */ end: skip + n, /** samples before the attack needed */ before: n + gap };
}

function hannSpectrum(src: Float32Array, size: number): Float64Array {
  const n = src.length;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = src[i] * w;
    wsum += w;
  }
  fft(re, im);
  const out = new Float64Array(size / 2);
  for (let k = 0; k < out.length; k++) out[k] = Math.hypot(re[k], im[k]) / wsum;
  return out;
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));

/**
 * @param post  the strum: `strumLayout(sr).n` samples starting `skip` after the attack.
 * @param pre   the same number of samples ending just before the attack (null or silent when nothing was ringing).
 */
export function analyzeStrum(
  post: Float32Array,
  pre: Float32Array | null,
  sampleRate: number,
  required: readonly number[],
  contradicting: readonly number[] = [],
  params: StrumParams = STRUM_PARAMS,
): StrumAnalysis {
  const reqSet = new Set(required);
  const cands = [...new Set([...required, ...contradicting])].sort((a, b) => a - b);
  const strengths: Record<number, number> = {};
  for (const m of cands) strengths[m] = 0;
  if (cands.length === 0 || post.length < 256) return { strengths, shadowed: [] };

  const size = nextPow2(post.length) * 2;
  const binHz = sampleRate / size;
  const half = size / 2;
  const mPost = hannSpectrum(post, size);
  const diff = new Float64Array(half);
  if (pre) {
    const mPre = hannSpectrum(pre, size);
    // Ring that only decays keeps its lobe shape; a +-2 bin max filter tolerates small shifts of it.
    for (let k = 0; k < half; k++) {
      let r = 0;
      for (let j = Math.max(0, k - 2); j <= Math.min(half - 1, k + 2); j++) r = Math.max(r, mPre[j]);
      diff[k] = Math.max(0, mPost[k] - params.preWeight * r);
    }
  } else {
    diff.set(mPost);
  }

  // Noise floor: median of the strum spectrum in the band where strings live.
  const kLo = Math.floor(70 / binHz);
  const kHi = Math.min(half - 1, Math.floor(4000 / binHz));
  const band = Array.from(mPost.subarray(kLo, kHi + 1)).sort((a, b) => a - b);
  const floor = band[Math.floor(band.length / 2)] ?? 0;

  const combMax = Math.min(params.combMaxFreq, sampleRate * 0.45);
  const tolRatio = Math.pow(2, params.searchCents / 1200) - 1;
  const collideRatio = Math.pow(2, params.collideCents / 1200) - 1;
  const collideMin = (params.collideBins * sampleRate) / post.length; // bins of the analysis window, in Hz

  interface Partial {
    freq: number;
    owner: number; // index in cands
    contested: boolean;
    evidence: number;
    /** Counts as evidence (low enough harmonic); the others only exist to find coincidences. */
    used: boolean;
  }
  const partials: Partial[][] = cands.map((m, ci) => {
    const out: Partial[] = [];
    for (let h = 1; h * midiHz(m) <= combMax; h++) {
      const freq = h * midiHz(m);
      const used = h <= params.harmonics && freq <= params.evidenceMaxFreq;
      const tol = Math.max(freq * tolRatio, 2);
      const a = Math.max(1, Math.floor((freq - tol) / binHz));
      const b = Math.min(half - 2, Math.ceil((freq + tol) / binHz));
      // A line is a local maximum. The slope of a strong neighbour's skirt is not one: it counts as the window's minimum.
      let e = -1;
      let lowest = Infinity;
      for (let k = a; k <= b; k++) {
        lowest = Math.min(lowest, diff[k]);
        if (diff[k] >= diff[k - 1] && diff[k] > diff[k + 1]) e = Math.max(e, diff[k]);
      }
      if (e < 0) e = lowest;
      out.push({ freq, owner: ci, contested: false, evidence: e, used });
    }
    return out;
  });
  // Who can vouch for whom. Two chord tones that coincide vouch for each other, so both lose that partial. A chord tone
  // also vouches for a foreign note sitting on the same partial, so the foreign note loses it. The other way round
  // changes nothing: if the foreign note really sounds the chord is wrong anyway, so it must not take evidence
  // away from the chord tones (the comb of a low foreign string would leave them nothing). Two foreign notes ignore each other.
  for (let i = 0; i < partials.length; i++)
    for (let j = i + 1; j < partials.length; j++) {
      const ri = reqSet.has(cands[i]);
      const rj = reqSet.has(cands[j]);
      if (!ri && !rj) continue;
      for (const p of partials[i])
        for (const q of partials[j])
          if (Math.abs(p.freq - q.freq) < Math.max(collideMin, Math.min(p.freq, q.freq) * collideRatio)) {
            if (rj) p.contested = true;
            if (ri) q.contested = true;
          }
    }

  const levels: number[] = [];
  const shadowed: number[] = [];
  partials.forEach((ps, ci) => {
    const owned = ps.filter((p) => p.used && !p.contested);
    const isShadowed = owned.length < params.minOwned;
    if (isShadowed) shadowed.push(cands[ci]);
    const use = owned; // a shadowed candidate keeps only what is really its own (possibly nothing)
    const top = use
      .map((p) => db(p.evidence))
      .sort((x, y) => y - x)
      .slice(0, 3);
    levels.push(top.length ? top.reduce((s, x) => s + x, 0) / top.length : -240);
  });

  const sorted = levels.filter((_, ci) => !shadowed.includes(cands[ci])).sort((a, b) => b - a);
  const ref = sorted[0] ?? -240;
  const refAmp = Math.pow(10, ref / 20);
  const loud = refAmp >= params.minAmp && db(refAmp) - db(floor) >= params.minSnrDb;
  cands.forEach((m, ci) => {
    strengths[m] = loud ? Math.max(0, Math.min(1, 1 + (levels[ci] - ref) / params.rangeDb)) : 0;
  });
  return { strengths, shadowed };
}
