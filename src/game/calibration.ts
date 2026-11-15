/**
 * Calibration maths (pure). The player plays along with metronome clicks; the offset between each beat and
 * the onset nearest to it is the total latency of the chain (output + input + the player's own habit).
 * We take the MEDIAN after discarding outliers (missed beats matched to a neighbour, double detections).
 * Both lists are on the same timeline (AudioContext seconds).
 */

export const CAL_BPM = 75;
export const CAL_COUNT_IN = 4;
export const CAL_CLICKS = 10;
/**
 * Beat 0 (the first measured click) falls this many seconds after the first captured sample. Tying it to
 * the capture start (not to "now") makes the measurement repeatable when the microphone is a looped
 * test file: the file always starts at the capture start.
 */
export const CAL_BEAT0_AFTER_CAPTURE = 4.5;

export interface CalibrationResult {
  /** Seconds: positive = onsets arrive after the beat. Save as `latencyOffset`. */
  offset: number;
  /** Seconds: scatter of the kept offsets (1.4826 * MAD). Small = stable. */
  spread: number;
  /** Offsets kept after discarding outliers. */
  used: number;
  /** Beats that had an onset within the window. */
  matched: number;
  /** Beats offered. */
  beats: number;
  /** Enough clean data (at least 6 kept, 60% of the beats) to trust the offset. */
  ok: boolean;
  /** The kept offsets, in beat order. */
  offsets: number[];
}

export function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param onsets  onset times, seconds.
 * @param beats   beat times, seconds.
 * @param window  half-width (seconds) in which an onset can belong to a beat. Default 0.4.
 */
export function measureOffset(onsets: number[], beats: number[], window = 0.4): CalibrationResult {
  const free = [...onsets].sort((a, b) => a - b);
  const pairs: number[] = [];
  for (const b of beats) {
    let best = -1;
    for (let i = 0; i < free.length; i++) {
      if (Math.abs(free[i] - b) <= window && (best < 0 || Math.abs(free[i] - b) < Math.abs(free[best] - b))) best = i;
    }
    if (best >= 0) {
      pairs.push(free[best] - b);
      free.splice(best, 1); // one onset serves one beat
    }
  }
  const m0 = median(pairs);
  const mad = median(pairs.map((d) => Math.abs(d - m0)));
  const limit = Math.max(0.03, 3 * 1.4826 * mad);
  const kept = pairs.filter((d) => Math.abs(d - m0) <= limit);
  const offset = median(kept);
  const spread = 1.4826 * median(kept.map((d) => Math.abs(d - offset)));
  return {
    offset,
    spread,
    used: kept.length,
    matched: pairs.length,
    beats: beats.length,
    ok: kept.length >= 6 && kept.length >= 0.6 * beats.length,
    offsets: kept,
  };
}
